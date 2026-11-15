//! Модуль локального чат-бота, анти-спам модерации, экономики Stream Avatars,
//! рангов лояльности, мини-игр и сценариев автоматизации RutonyChat.

use crate::obs::ObsBridge;
use crate::state::{
    record_analytics_chat, record_analytics_donation, AppState, ChatMessage, ChatPlatform,
    MediaShareItem, MiniGameKind, ScenarioAction, SlotsSpinResult, StreamEvent, StreamEventKind,
    TtsConfig, ViewerProfile, ViewerRole, WsBroadcast, MAX_CHAT_HISTORY, MAX_EVENTS_HISTORY,
};
use chrono::Utc;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

/// Конвертирует входную сумму в базовую валюту студии (RUB).
pub fn convert_to_rub(amount: f64, currency: &str) -> f64 {
    let cur = currency.trim().to_uppercase();
    let mult = match cur.as_str() {
        "USD" | "$" => 92.0,
        "EUR" | "€" => 100.0,
        "KZT" | "₸" => 0.2,
        "USDT" | "TON" | "BTC" | "CRYPTO" => 92.0,
        _ => 1.0,
    };
    (amount * mult).round().max(0.0)
}

/// Очищает текст доната для TTS согласно настройкам анти-мата.
pub fn sanitize_tts_message(msg: &str, cfg: &TtsConfig) -> String {
    if !cfg.profanity_filter {
        return msg.to_string();
    }
    let mut out = msg.to_string();
    for bad in &cfg.blocked_words {
        let w = bad.trim();
        if !w.is_empty() {
            let lower = out.to_lowercase();
            let w_low = w.to_lowercase();
            if let Some(pos) = lower.find(&w_low) {
                let end = pos + w_low.len();
                if end <= out.len() {
                    out.replace_range(pos..end, "***");
                }
            }
        }
    }
    out
}

/// Вычисляет ранг зрителя на основе накопленного опыта (XP).
pub fn compute_rank_title(xp: u64) -> String {
    match xp {
        0..=99 => "Новичок".to_string(),
        100..=399 => "Зритель".to_string(),
        400..=999 => "Постоялец".to_string(),
        1000..=2499 => "Хранитель эфира".to_string(),
        _ => "Легенда канала".to_string(),
    }
}

/// Обрабатывает входящее сообщение мультичата:
/// 1) Проверяет анти-спам/ссылки/стоп-слова
/// 2) Создаёт/обновляет профиль зрителя (валюта, опыт, ранг, аватар)
/// 3) Рассылает сообщение по WebSocket
/// 4) Исполняет команды Stream Avatars (`!dance`, `!hug`, `!duel`, `!battleroyale`...) и RutonyChat (`!join`, `!commands`)
/// 5) Запускает подходящие сценарии автоматизации
pub async fn process_incoming_chat(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    platform: ChatPlatform,
    username: String,
    role: ViewerRole,
    text: String,
) -> Result<ChatMessage, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Пустое сообщение отклонено".to_string());
    }

    // 1. Детерминированная модерация (анти-спам и стоп-слова)
    {
        let guard = state.snapshot.read().await;
        if role != ViewerRole::Broadcaster && role != ViewerRole::Moderator {
            let lower = trimmed.to_lowercase();
            if guard.moderation.block_links
                && (lower.contains("http://") || lower.contains("https://") || lower.contains(".ru/") || lower.contains(".com/"))
            {
                state
                    .push_log("warn", "moderation", format!("Заблокирована ссылка от {}", username))
                    .await;
                return Err("Ссылки запрещены настройками модерации".to_string());
            }
            for bad in &guard.moderation.blocked_words {
                if !bad.is_empty() && lower.contains(&bad.to_lowercase()) {
                    state
                        .push_log("warn", "moderation", format!("Стоп-слово от {}", username))
                        .await;
                    return Err("Сообщение содержит запрещённое слово".to_string());
                }
            }
        }
    }

    // 2. Обновление профиля зрителя, начисление валюты и XP
    let (msg, matched_scenarios, mvp_broadcast) = {
        let mut guard = state.snapshot.write().await;
        let pts = guard.arena.points_per_message;
        let profile = guard
            .viewers
            .entry(username.clone())
            .or_insert_with(|| ViewerProfile {
                username: username.clone(),
                platform: platform.clone(),
                role: role.clone(),
                currency: 150,
                xp: 0,
                rank_title: "Новичок".to_string(),
                total_donated: 0.0,
                message_count: 0,
                avatar_skin: "fox".to_string(),
                avatar_color: "#38BDF8".to_string(),
                gear: Vec::new(),
                nametag: match role {
                    ViewerRole::Moderator => "MOD".to_string(),
                    ViewerRole::Subscriber => "SUB".to_string(),
                    ViewerRole::Vip => "VIP".to_string(),
                    ViewerRole::Broadcaster => "HOST".to_string(),
                    _ => String::new(),
                },
                last_seen: Utc::now(),
            });

        profile.currency += pts;
        profile.xp += 10;
        profile.message_count += 1;
        profile.rank_title = compute_rank_title(profile.xp);
        profile.last_seen = Utc::now();
        let color = profile.avatar_color.clone();

        let msg = ChatMessage {
            id: Uuid::new_v4(),
            platform: platform.clone(),
            username: username.clone(),
            role: role.clone(),
            color,
            text: trimmed.clone(),
            translated_text: None,
            is_highlighted: trimmed.starts_with('!'),
            created_at: Utc::now(),
        };

        if guard.chat_history.len() >= MAX_CHAT_HISTORY {
            guard.chat_history.pop_front();
        }
        guard.chat_history.push_back(msg.clone());
        record_analytics_chat(&mut guard, &platform);

        // Проверка участия в активном розыгрыше RutonyChat
        if guard.giveaway.active
            && trimmed.eq_ignore_ascii_case(&guard.giveaway.keyword)
            && !guard.giveaway.participants.contains(&username)
        {
            guard.giveaway.participants.push(username.clone());
        }

        // Проверка ответа в активной викторине (Trivia)
        if guard.trivia.active
            && !guard.trivia.answer.trim().is_empty()
            && trimmed.eq_ignore_ascii_case(guard.trivia.answer.trim())
        {
            guard.trivia.active = false;
            guard.trivia.winner = Some(username.clone());
            let reward = guard.trivia.reward_currency;
            if let Some(p) = guard.viewers.get_mut(&username) {
                p.currency += reward;
            }
        }

        // Поиск сценариев автоматизации по ключевому слову
        let lower = trimmed.to_lowercase();
        let matched: Vec<Vec<ScenarioAction>> = guard
            .scenarios
            .iter()
            .filter(|s| s.enabled && s.trigger_event == "chat_keyword" && lower.contains(&s.condition_value.to_lowercase()))
            .map(|s| s.actions.clone())
            .collect();

        let mvp = WsBroadcast::MvpUpdated {
            audio_mixer: guard.audio_mixer.clone(),
            hotkeys: guard.hotkeys.clone(),
            analytics: guard.analytics.clone(),
            obs: guard.obs.clone(),
            profile_last_saved_at: guard.profile_last_saved_at,
        };

        (msg, matched, mvp)
    };

    let _ = state.tx.send(WsBroadcast::ChatMessage(msg.clone()));
    let _ = state.tx.send(mvp_broadcast);

    // Уведомляем оверлей, чтобы аватар «чока» произнёс реплику над головой
    let _ = state.tx.send(WsBroadcast::AvatarAction {
        username: username.clone(),
        action: "speak".to_string(),
        target: None,
        text: Some(trimmed.clone()),
    });

    // 3. Обработка команд чата (`!команды`)
    if trimmed.starts_with('!') {
        handle_chat_command(state, obs, &username, &trimmed).await;
    }

    // 4. Выполнение сценариев автоматизации
    for actions in matched_scenarios {
        execute_scenario_actions(state, obs, &actions).await;
    }

    Ok(msg)
}

/// Разбирает и исполняет чат-команды Stream Avatars и RutonyChat.
async fn handle_chat_command(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    username: &str,
    raw: &str,
) {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.is_empty() {
        return;
    }
    let cmd = parts[0].to_lowercase();
    let arg1 = parts.get(1).copied().unwrap_or("");
    let arg2 = parts.get(2).copied().unwrap_or("");

    let mut bot_reply: Option<String> = None;

    match cmd.as_str() {
        "!dance" | "!jump" | "!sit" | "!stand" | "!fart" => {
            let action = cmd.trim_start_matches('!').to_string();
            let _ = state.tx.send(WsBroadcast::AvatarAction {
                username: username.to_string(),
                action,
                target: None,
                text: None,
            });
        }
        "!hug" | "!attack" | "!bomb" => {
            let target = arg1.trim_start_matches('@').to_string();
            if !target.is_empty() {
                let _ = state.tx.send(WsBroadcast::AvatarAction {
                    username: username.to_string(),
                    action: cmd.trim_start_matches('!').to_string(),
                    target: Some(target),
                    text: None,
                });
            }
        }
        "!avatar" => {
            if !arg1.is_empty() {
                let mut guard = state.snapshot.write().await;
                if let Some(p) = guard.viewers.get_mut(username) {
                    p.avatar_skin = arg1.to_lowercase();
                    bot_reply = Some(format!("@{} сменил скин аватара на '{}'", username, p.avatar_skin));
                }
            }
        }
        "!color" => {
            if !arg1.is_empty() {
                let mut guard = state.snapshot.write().await;
                if let Some(p) = guard.viewers.get_mut(username) {
                    p.avatar_color = arg1.to_string();
                    bot_reply = Some(format!("@{} выбрал цвет {}", username, p.avatar_color));
                }
            }
        }
        "!gear" => {
            if !arg1.is_empty() {
                let mut guard = state.snapshot.write().await;
                if let Some(p) = guard.viewers.get_mut(username) {
                    let item = arg1.to_lowercase();
                    if !p.gear.contains(&item) {
                        p.gear.push(item.clone());
                    }
                    bot_reply = Some(format!("@{} надел экипировку: {}", username, item));
                }
            }
        }
        "!nametag" => {
            if !arg1.is_empty() {
                let mut guard = state.snapshot.write().await;
                if let Some(p) = guard.viewers.get_mut(username) {
                    p.nametag = arg1.to_uppercase();
                    bot_reply = Some(format!("@{} установил неймтег [{}]", username, p.nametag));
                }
            }
        }
        "!currency" | "!rank" => {
            let guard = state.snapshot.read().await;
            if let Some(p) = guard.viewers.get(username) {
                bot_reply = Some(format!(
                    "@{} · Баланс: {} {} · Ранг: {} ({} XP)",
                    username, p.currency, guard.arena.currency_name, p.rank_title, p.xp
                ));
            }
        }
        "!shop" => {
            bot_reply = Some("Магазин аватара: !redeem <id>, !gear crown (100), !gear visor (80), !gear wings (150), !avatar knight|fox|cat|robot".to_string());
        }
        "!death" | "!deaths" => {
            let mut guard = state.snapshot.write().await;
            guard.game_counters.deaths += 1;
            let d = guard.game_counters.deaths;
            let g = guard.game_counters.current_game.clone();
            let _ = state.tx.send(WsBroadcast::CountersUpdated {
                hype_train: guard.hype_train.clone(),
                game_counters: guard.game_counters.clone(),
                pngtuber: guard.pngtuber.clone(),
                obs_audio: guard.obs_audio.clone(),
            });
            bot_reply = Some(format!("Счётчик смертей в «{}»: {} 💀", g, d));
        }
        "!win" => {
            let mut guard = state.snapshot.write().await;
            guard.game_counters.wins += 1;
            let w = guard.game_counters.wins;
            let l = guard.game_counters.losses;
            let _ = state.tx.send(WsBroadcast::CountersUpdated {
                hype_train: guard.hype_train.clone(),
                game_counters: guard.game_counters.clone(),
                pngtuber: guard.pngtuber.clone(),
                obs_audio: guard.obs_audio.clone(),
            });
            bot_reply = Some(format!("Победа засчитана! Счёт: {}W / {}L EZ", w, l));
        }
        "!loss" => {
            let mut guard = state.snapshot.write().await;
            guard.game_counters.losses += 1;
            let w = guard.game_counters.wins;
            let l = guard.game_counters.losses;
            let _ = state.tx.send(WsBroadcast::CountersUpdated {
                hype_train: guard.hype_train.clone(),
                game_counters: guard.game_counters.clone(),
                pngtuber: guard.pngtuber.clone(),
                obs_audio: guard.obs_audio.clone(),
            });
            bot_reply = Some(format!("Поражение засчитано. Счёт: {}W / {}L", w, l));
        }
        "!battleroyale" | "!boss" | "!spawn" | "!basketball" => {
            let kind = match cmd.as_str() {
                "!battleroyale" => MiniGameKind::BattleRoyale,
                "!boss" => MiniGameKind::BossFight,
                "!spawn" => MiniGameKind::StarCatch,
                _ => MiniGameKind::Basketball,
            };
            {
                let mut guard = state.snapshot.write().await;
                guard.arena.active_minigame = kind.clone();
                if kind == MiniGameKind::BossFight {
                    guard.arena.boss_hp = guard.arena.boss_max_hp;
                }
            }
            let _ = state.tx.send(WsBroadcast::MinigameStarted {
                kind: kind.clone(),
                initiator: username.to_string(),
                details: serde_json::json!({ "source": "chat_command" }),
            });
            bot_reply = Some(format!("Мини-игра {:?} запущена игроком @{}!", kind, username));
        }
        "!duel" => {
            let target = arg1.trim_start_matches('@');
            let wager: i64 = arg2.parse().unwrap_or(50).clamp(10, 10000);
            if !target.is_empty() && target != username {
                let _ = state.tx.send(WsBroadcast::MinigameStarted {
                    kind: MiniGameKind::Duel,
                    initiator: username.to_string(),
                    details: serde_json::json!({ "opponent": target, "wager": wager }),
                });
                bot_reply = Some(format!("@{} вызывает @{} на дуэль со ставкой {}!", username, target, wager));
            }
        }
        "!bet" => {
            let outcome_id = if arg1.is_empty() { "1" } else { arg1 };
            let wager: i64 = if arg2.is_empty() {
                arg1.parse().unwrap_or(50)
            } else {
                arg2.parse().unwrap_or(50)
            }
            .clamp(5, 10000);

            let mut se_da_msg: Option<WsBroadcast> = None;
            {
                let mut guard = state.snapshot.write().await;
                if guard.prediction.active && !guard.prediction.locked {
                    let has_enough = guard
                        .viewers
                        .get(username)
                        .map(|p| p.currency >= wager)
                        .unwrap_or(false);
                    if !has_enough {
                        bot_reply = Some(format!("@{}, недостаточно валюты для ставки {}", username, wager));
                    } else if let Some(idx) = guard.prediction.outcomes.iter().position(|o| o.id == outcome_id) {
                        if let Some(p) = guard.viewers.get_mut(username) {
                            p.currency -= wager;
                        }
                        guard.prediction.outcomes[idx].pool += wager;
                        guard.prediction.outcomes[idx].bettors += 1;
                        let lbl = guard.prediction.outcomes[idx].label.clone();
                        bot_reply = Some(format!("@{} поставил {} на исход #{} ({})!", username, wager, outcome_id, lbl));
                        se_da_msg = Some(WsBroadcast::SeDaUpdated {
                            media_share_config: guard.media_share_config.clone(),
                            media_queue: guard.media_queue.clone(),
                            tts_config: guard.tts_config.clone(),
                            prediction: guard.prediction.clone(),
                            last_slots_spin: guard.last_slots_spin.clone(),
                            ticker: guard.ticker.clone(),
                            fintech: guard.fintech.clone(),
                            game_webhooks: guard.game_webhooks.clone(),
                        });
                    } else {
                        bot_reply = Some("Укажите исход: !bet 1 100 или !bet 2 100".to_string());
                    }
                } else {
                    bot_reply = Some("Сейчас нет открытого пари для ставок".to_string());
                }
            }
            if let Some(msg) = se_da_msg {
                let _ = state.tx.send(msg);
            }
        }
        "!slots" => {
            let wager: i64 = arg1.parse().unwrap_or(25).clamp(5, 5000);
            let symbols = ["💎", "🍒", "⭐", "🔔", "🔥"];
            let mut se_da_msg: Option<WsBroadcast> = None;
            {
                let mut guard = state.snapshot.write().await;
                let can_bet = guard.viewers.get(username).map(|p| p.currency >= wager).unwrap_or(false);
                if can_bet {
                    let t = Utc::now().timestamp_subsec_nanos() as usize;
                    let r0 = symbols[t % symbols.len()].to_string();
                    let r1 = symbols[(t / 7 + 1) % symbols.len()].to_string();
                    let r2 = symbols[(t / 13 + 2) % symbols.len()].to_string();
                    let mult = if r0 == r1 && r1 == r2 {
                        if r0 == "💎" { 10 } else { 5 }
                    } else if r0 == r1 || r1 == r2 || r0 == r2 {
                        2
                    } else {
                        0
                    };
                    let payout = wager * mult;
                    if let Some(p) = guard.viewers.get_mut(username) {
                        p.currency = p.currency - wager + payout;
                        let spin = SlotsSpinResult {
                            username: username.to_string(),
                            reels: [r0.clone(), r1.clone(), r2.clone()],
                            wager,
                            payout,
                            multiplier: mult,
                            ts: Utc::now(),
                        };
                        guard.last_slots_spin = Some(spin);
                        bot_reply = Some(if mult > 0 {
                            format!("🎰 @{} [{} {} {}] ДЖЕКПОТ +{} (x{})! Баланс: {}", username, r0, r1, r2, payout, mult, p.currency)
                        } else {
                            format!("🎰 @{} [{} {} {}] Мимо (-{}). Баланс: {}", username, r0, r1, r2, wager, p.currency)
                        });
                        se_da_msg = Some(WsBroadcast::SeDaUpdated {
                            media_share_config: guard.media_share_config.clone(),
                            media_queue: guard.media_queue.clone(),
                            tts_config: guard.tts_config.clone(),
                            prediction: guard.prediction.clone(),
                            last_slots_spin: guard.last_slots_spin.clone(),
                            ticker: guard.ticker.clone(),
                            fintech: guard.fintech.clone(),
                            game_webhooks: guard.game_webhooks.clone(),
                        });
                    }
                } else {
                    bot_reply = Some(format!("@{}, недостаточно валюты для !slots {}", username, wager));
                }
            }
            if let Some(msg) = se_da_msg {
                let _ = state.tx.send(msg);
            }
        }
        "!top" | "!leaderboard" => {
            let guard = state.snapshot.read().await;
            let mut list: Vec<&ViewerProfile> = guard.viewers.values().collect();
            list.sort_by(|a, b| b.currency.cmp(&a.currency));
            let top_str: Vec<String> = list
                .into_iter()
                .take(5)
                .enumerate()
                .map(|(i, v)| format!("{}. {} ({})", i + 1, v.username, v.currency))
                .collect();
            bot_reply = Some(format!("🏆 Топ зрителей: {}", top_str.join(" · ")));
        }
        "!goal" => {
            let guard = state.snapshot.read().await;
            bot_reply = Some(format!(
                "Цель «{}»: {:.0} / {:.0} {}",
                guard.goal.title, guard.goal.current, guard.goal.target, guard.goal.unit
            ));
        }
        "!clip" => {
            let clip = crate::state::ClipMarker {
                id: Uuid::new_v4(),
                title: if arg1.is_empty() { "Хайлайт из чата".to_string() } else { parts[1..].join(" ") },
                author: username.to_string(),
                stream_elapsed_sec: 0,
                created_at: Utc::now(),
            };
            let _ = obs.save_replay_buffer().await;
            {
                let mut guard = state.snapshot.write().await;
                guard.clip_markers.push_back(clip.clone());
            }
            let _ = state.tx.send(WsBroadcast::ClipMarked(clip));
            bot_reply = Some(format!("Маркер клипа сохранён по запросу @{}!", username));
        }
        _ => {
            // Поиск пользовательской команды RutonyChat с подстановкой переменных ($user, $uptime, $count, $game)
            let mut guard = state.snapshot.write().await;
            let uptime_min = (Utc::now() - guard.stream_started_at).num_minutes().max(1);
            let game = guard.game_counters.current_game.clone();
            if let Some(found) = guard.bot_commands.iter_mut().find(|c| c.enabled && c.trigger.eq_ignore_ascii_case(&cmd)) {
                found.usage_count += 1;
                let expanded = found
                    .response
                    .replace("$user", username)
                    .replace("$target", if arg1.is_empty() { username } else { arg1.trim_start_matches('@') })
                    .replace("$uptime", &format!("{} мин", uptime_min))
                    .replace("$count", &found.usage_count.to_string())
                    .replace("$game", &game);
                bot_reply = Some(expanded);
            }
        }
    }

    if let Some(reply_text) = bot_reply {
        send_system_chat(state, "PulseBot", ViewerRole::Agent, reply_text).await;
    }
}

/// Отправляет сообщение в мультичат от имени бота или ИИ-агента.
pub async fn send_system_chat(
    state: &Arc<AppState>,
    username: &str,
    role: ViewerRole,
    text: String,
) {
    let msg = ChatMessage {
        id: Uuid::new_v4(),
        platform: ChatPlatform::Local,
        username: username.to_string(),
        role,
        color: "#60A5FA".to_string(),
        text,
        translated_text: None,
        is_highlighted: true,
        created_at: Utc::now(),
    };
    {
        let mut guard = state.snapshot.write().await;
        if guard.chat_history.len() >= MAX_CHAT_HISTORY {
            guard.chat_history.pop_front();
        }
        guard.chat_history.push_back(msg.clone());
    }
    let _ = state.tx.send(WsBroadcast::ChatMessage(msg));
}

/// Обрабатывает входящий донат / подписку: обновляет цель, Subathon, Stream Boss, Media Share, FinTech, аналитику и сценарии.
pub async fn process_stream_event(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    mut event: StreamEvent,
) {
    let (
        goal,
        goals,
        subathon,
        boss,
        poll,
        giveaway,
        matched_scenarios,
        parser_rules,
        media_assets,
        alert_variations,
        feed_config,
        custom_elements,
        scenarios,
        se_da_msg,
        mvp_msg,
    ) = {
        let mut guard = state.snapshot.write().await;

        // 1. Мультивалютная нормализация в рубли
        let orig_cur = event
            .original_currency
            .clone()
            .unwrap_or_else(|| event.currency.clone());
        let orig_amt = event.original_amount.unwrap_or(event.amount);
        let amount_rub = convert_to_rub(orig_amt, &orig_cur);
        event.original_amount = Some(orig_amt);
        event.original_currency = Some(orig_cur);
        event.amount = amount_rub;
        event.currency = "₽".to_string();

        // 2. TTS-фильтр и порог
        if !event.message.is_empty() {
            event.message = sanitize_tts_message(&event.message, &guard.tts_config);
        }
        if !guard.tts_config.enabled || amount_rub < guard.tts_config.min_amount_rub {
            event.tts_enabled = false;
        }

        // 3. Автоматическая очередь Media Share
        if let Some(m_url) = event.media_url.as_ref().map(|u| u.trim()).filter(|u| !u.is_empty()) {
            if guard.media_share_config.enabled && amount_rub >= guard.media_share_config.min_amount_rub {
                let lower_u = m_url.to_lowercase();
                let kind = if lower_u.contains("vk.com") || lower_u.contains("vkvideo") {
                    "vk"
                } else if lower_u.ends_with(".mp3") || lower_u.ends_with(".wav") || lower_u.ends_with(".ogg") {
                    "audio"
                } else {
                    "youtube"
                };
                let dur = event
                    .media_duration_sec
                    .unwrap_or(60)
                    .min(guard.media_share_config.max_duration_sec.max(10));
                let has_active = guard
                    .media_queue
                    .iter()
                    .any(|m| m.status == "playing" || m.status == "paused");
                let status = if !has_active && guard.media_share_config.auto_play {
                    "playing"
                } else {
                    "queued"
                };
                let item = MediaShareItem {
                    id: Uuid::new_v4().to_string(),
                    donor: event.username.clone(),
                    amount_rub,
                    url: m_url.to_string(),
                    title: event
                        .media_title
                        .clone()
                        .filter(|t| !t.trim().is_empty())
                        .unwrap_or_else(|| format!("Медиа-клип от {}", event.username)),
                    media_kind: kind.to_string(),
                    duration_sec: dur,
                    remaining_sec: dur,
                    status: status.to_string(),
                    created_at: Utc::now(),
                };
                guard.media_queue.push(item);
            }
        }

        if event.variation_id.is_none() {
            if let Some(var) = crate::bridges::match_alert_variation(&event, &guard.alert_variations) {
                event.variation_id = Some(var.id);
                if event.sound_id.is_none() && !var.sound_id.is_empty() {
                    event.sound_id = Some(var.sound_id);
                }
            }
        }

        if guard.recent_events.len() >= MAX_EVENTS_HISTORY {
            guard.recent_events.pop_front();
        }
        guard.recent_events.push_back(event.clone());

        // Hype Train прогресс
        guard.hype_train.active = true;
        guard.hype_train.remaining_seconds = 300;
        guard.hype_train.current_points += (event.amount as u64).max(100);
        while guard.hype_train.current_points >= guard.hype_train.goal_points {
            guard.hype_train.current_points -= guard.hype_train.goal_points;
            guard.hype_train.level += 1;
            guard.hype_train.goal_points = ((guard.hype_train.goal_points as f64) * 1.35) as u64;
        }

        // Начисляем валюту и донат-статус зрителю
        let profile = guard
            .viewers
            .entry(event.username.clone())
            .or_insert_with(|| ViewerProfile {
                username: event.username.clone(),
                platform: ChatPlatform::Local,
                role: ViewerRole::Vip,
                currency: 300,
                xp: 100,
                rank_title: "Зритель".to_string(),
                total_donated: 0.0,
                message_count: 0,
                avatar_skin: "fox".to_string(),
                avatar_color: "#FBBF24".to_string(),
                gear: vec!["crown".to_string()],
                nametag: "VIP".to_string(),
                last_seen: Utc::now(),
            });
        profile.total_donated += event.amount;
        profile.currency += (event.amount as i64).max(50);
        profile.xp += ((event.amount / 10.0) as u64).max(25);
        profile.rank_title = compute_rank_title(profile.xp);

        // Обновление целей сборов, FinTech, аналитики и игровых вебхуков
        if event.kind == StreamEventKind::Donation && event.amount > 0.0 {
            guard.goal.current += event.amount;
            for g in &mut guard.goals {
                if g.unit == "₽" || g.unit == "RUB" || g.unit == event.currency {
                    g.current += event.amount;
                }
            }
            let net = (event.amount * (1.0 - guard.fintech.commission_pct / 100.0)).round();
            guard.fintech.balance_rub += net;
            record_analytics_donation(&mut guard, event.amount);

            for rule in &mut guard.game_webhooks {
                if rule.enabled && rule.event_key == "donation" && event.amount >= rule.min_amount_rub {
                    rule.trigger_count += 1;
                }
            }

            let added_secs = ((event.amount / 100.0) * guard.subathon.seconds_per_100_rub as f64) as u64;
            guard.subathon.remaining_seconds += added_secs;

            // Урон Stream Boss
            guard.stream_boss.hp -= event.amount;
            if guard.stream_boss.hp <= 0.0 {
                guard.stream_boss.defeats_count += 1;
                guard.stream_boss.boss_name = event.username.clone();
                guard.stream_boss.max_hp = (guard.stream_boss.max_hp * 1.25).round();
                guard.stream_boss.hp = guard.stream_boss.max_hp;
            }
        } else if event.kind == StreamEventKind::Subscription {
            guard.subathon.remaining_seconds += guard.subathon.seconds_per_sub;
            for g in &mut guard.goals {
                if g.unit == "сабов" || g.unit == "subs" {
                    g.current += 1.0;
                }
            }
        }

        let matched: Vec<Vec<ScenarioAction>> = guard
            .scenarios
            .iter()
            .filter(|s| {
                if !s.enabled {
                    return false;
                }
                if s.trigger_event == "donation" && event.kind == StreamEventKind::Donation {
                    let threshold: f64 = s.condition_value.parse().unwrap_or(0.0);
                    return event.amount >= threshold;
                }
                s.trigger_event == "subscription" && event.kind == StreamEventKind::Subscription
            })
            .map(|s| s.actions.clone())
            .collect();

        let se_da_msg = WsBroadcast::SeDaUpdated {
            media_share_config: guard.media_share_config.clone(),
            media_queue: guard.media_queue.clone(),
            tts_config: guard.tts_config.clone(),
            prediction: guard.prediction.clone(),
            last_slots_spin: guard.last_slots_spin.clone(),
            ticker: guard.ticker.clone(),
            fintech: guard.fintech.clone(),
            game_webhooks: guard.game_webhooks.clone(),
        };

        let mvp_msg = WsBroadcast::MvpUpdated {
            audio_mixer: guard.audio_mixer.clone(),
            hotkeys: guard.hotkeys.clone(),
            analytics: guard.analytics.clone(),
            obs: guard.obs.clone(),
            profile_last_saved_at: guard.profile_last_saved_at,
        };

        (
            guard.goal.clone(),
            guard.goals.clone(),
            guard.subathon.clone(),
            guard.stream_boss.clone(),
            guard.poll.clone(),
            guard.giveaway.clone(),
            matched,
            guard.parser_rules.clone(),
            guard.media_assets.clone(),
            guard.alert_variations.clone(),
            guard.feed_config.clone(),
            guard.custom_elements.clone(),
            guard.scenarios.clone(),
            se_da_msg,
            mvp_msg,
        )
    };

    let _ = state.tx.send(WsBroadcast::NewEvent(event.clone()));
    let _ = state.tx.send(WsBroadcast::EngagementUpdated {
        goal,
        subathon,
        stream_boss: boss,
        poll,
        giveaway,
    });
    let _ = state.tx.send(WsBroadcast::CustomizationUpdated {
        goals,
        parser_rules,
        media_assets,
        alert_variations,
        feed_config,
        custom_elements,
        scenarios,
    });
    let _ = state.tx.send(se_da_msg);
    let _ = state.tx.send(mvp_msg);

    state
        .push_log(
            "info",
            "events",
            format!("Событие {:?} от {} ({:.0} {})", event.kind, event.username, event.amount, event.currency),
        )
        .await;

    for actions in matched_scenarios {
        execute_scenario_actions(state, obs, &actions).await;
    }
}

/// Исполняет цепочку действий сценария автоматизации RutonyChat.
pub async fn execute_scenario_actions(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    actions: &[ScenarioAction],
) {
    for act in actions {
        match act.kind.as_str() {
            "change_scene" => {
                if let Some(scene) = act.params.get("scene").and_then(Value::as_str) {
                    let synced = obs.set_scene(scene, state).await;
                    {
                        let mut guard = state.snapshot.write().await;
                        guard.obs.active_scene = scene.to_string();
                    }
                    let _ = state.tx.send(WsBroadcast::SceneChanged {
                        scene: scene.to_string(),
                        obs_synced: synced,
                    });
                }
            }
            "play_sound" => {
                let sound_id = act.params.get("sound_id").and_then(Value::as_str).unwrap_or("fanfare");
                let sound = {
                    let guard = state.snapshot.read().await;
                    guard.sounds.iter().find(|s| s.id == sound_id).cloned()
                };
                if let Some(s) = sound {
                    let _ = state.tx.send(WsBroadcast::PlaySound {
                        sound_id: s.id,
                        name: s.name,
                        freq_hz: s.freq_hz,
                        pattern: s.pattern,
                        volume: s.volume,
                    });
                }
            }
            "trigger_plugin" => {
                let plugin_id = act.params.get("plugin_id").and_then(Value::as_str).unwrap_or("starfall");
                let _ = state.tx.send(WsBroadcast::PluginTriggered {
                    plugin_id: plugin_id.to_string(),
                    data: act.params.clone(),
                });
            }
            "avatar_action" => {
                let username = act.params.get("username").and_then(Value::as_str).unwrap_or("*");
                let action = act.params.get("action").and_then(Value::as_str).unwrap_or("dance");
                let _ = state.tx.send(WsBroadcast::AvatarAction {
                    username: username.to_string(),
                    action: action.to_string(),
                    target: None,
                    text: None,
                });
            }
            "bot_reply" => {
                if let Some(txt) = act.params.get("text").and_then(Value::as_str) {
                    send_system_chat(state, "PulseBot", ViewerRole::Agent, txt.to_string()).await;
                }
            }
            _ => {}
        }
    }
}
