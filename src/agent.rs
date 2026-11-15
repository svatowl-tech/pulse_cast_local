//! Модуль локального ИИ-агента с поддержкой Function Calling / Tool Use.
//! Поддерживает два режима работы через переключатель конфигурации (`LLM_BACKEND`):
//! 1. `http` — OpenAI-совместимый API (`llama-server` / LM Studio / Ollama) через `reqwest`.
//! 2. `embedded` — прямой запуск локальной GGUF-модели в процессе через `llama-cpp-2`.
//! При недоступности LLM-сервера/файла модели срабатывает безопасный детерминированный парсер команд.

use crate::bot::{process_stream_event, send_system_chat};
use crate::obs::ObsBridge;
use crate::state::{
    AppState, AutomationScenario, ClipMarker, MiniGameKind, OverlayPlugin, PollOption,
    ScenarioAction, StreamEvent, StreamEventKind, ViewerRole, WsBroadcast,
};
use crate::whisper_sub::WhisperController;
use chrono::Utc;
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel, Special},
    sampling::LlamaSampler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{num::NonZeroU32, path::Path, sync::Arc};
use uuid::Uuid;

/// Ответ ИИ-агента для отображения в дашборде.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub reply: String,
    pub backend_used: String,
    pub tool_calls_executed: Vec<ExecutedTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutedTool {
    pub name: String,
    pub arguments: Value,
    pub result: String,
}

/// Описание инструментов (Function Calling JSON Schema) для OpenAI-совместимого API `llama.cpp`.
pub fn agent_tools_schema() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "change_scene",
                "description": "Переключить активную сцену стрима (и в OBS Studio, если подключён).",
                "parameters": {
                    "type": "object",
                    "properties": { "scene": { "type": "string" } },
                    "required": ["scene"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "trigger_alert",
                "description": "Вывести алерт доната или системного уведомления на оверлей OBS.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "username": { "type": "string" },
                        "amount": { "type": "number" },
                        "message": { "type": "string" }
                    },
                    "required": ["username", "message"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "send_chat_message",
                "description": "Отправить сообщение в объединённый мультичат от имени агента.",
                "parameters": {
                    "type": "object",
                    "properties": { "text": { "type": "string" } },
                    "required": ["text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "toggle_subtitles",
                "description": "Включить или выключить распознавание субтитров Whisper.",
                "parameters": {
                    "type": "object",
                    "properties": { "enabled": { "type": "boolean" } },
                    "required": ["enabled"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_theme",
                "description": "Переключить тему дашборда или OBS-оверлея.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target": { "type": "string", "enum": ["dashboard", "overlay"] },
                        "theme_id": { "type": "string" }
                    },
                    "required": ["target", "theme_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "play_sound",
                "description": "Проиграть звук с локального саундборда (coin, fanfare, alert, laser).",
                "parameters": {
                    "type": "object",
                    "properties": { "sound_id": { "type": "string" } },
                    "required": ["sound_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_poll",
                "description": "Создать или завершить опрос зрителей.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "active": { "type": "boolean" },
                        "question": { "type": "string" },
                        "options": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["active"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_goal_or_timer",
                "description": "Добавить время к Subathon-таймеру или изменить прогресс цели сборов.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "add_subathon_seconds": { "type": "integer" },
                        "subathon_running": { "type": "boolean" },
                        "add_goal_amount": { "type": "number" }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "mark_clip",
                "description": "Сохранить маркер хайлайта/клипа и буфер повтора OBS.",
                "parameters": {
                    "type": "object",
                    "properties": { "title": { "type": "string" } },
                    "required": ["title"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "start_minigame",
                "description": "Запустить мини-игру Stream Avatars (battle_royale, boss_fight, star_catch, basketball, none).",
                "parameters": {
                    "type": "object",
                    "properties": { "kind": { "type": "string" } },
                    "required": ["kind"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "avatar_action",
                "description": "Заставить аватара или всех чоков выполнить действие (dance, jump, sit, bomb, hug).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "username": { "type": "string" },
                        "action": { "type": "string" },
                        "target": { "type": "string" }
                    },
                    "required": ["username", "action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_giveaway",
                "description": "Запустить розыгрыш или выбрать победителя среди участников.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "enum": ["start", "pick_winner", "stop"] },
                        "prize": { "type": "string" },
                        "keyword": { "type": "string" }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "toggle_plugin",
                "description": "Включить или выключить плагин оверлея (например, starfall или chat_runners).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "plugin_id": { "type": "string" },
                        "enabled": { "type": "boolean" }
                    },
                    "required": ["plugin_id", "enabled"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "configure_plugin",
                "description": "Обновить JSON-настройки плагина оверлея (скорость, цвета, интенсивность).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "plugin_id": { "type": "string" },
                        "config": { "type": "object" }
                    },
                    "required": ["plugin_id", "config"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "trigger_plugin_effect",
                "description": "Вызвать разовый эффект плагина (например, салют звёзд).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "plugin_id": { "type": "string" },
                        "payload": { "type": "object" }
                    },
                    "required": ["plugin_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "upsert_custom_plugin",
                "description": "Создать или обновить кастомный JS/Canvas/CSS плагин на оверлее.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "description": { "type": "string" },
                        "script_js": { "type": "string" },
                        "style_css": { "type": "string" },
                        "hooks": { "type": "array", "items": { "type": "string" } },
                        "enabled": { "type": "boolean" }
                    },
                    "required": ["id", "name", "script_js"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_widget_layout",
                "description": "Переместить виджет оверлея или сменить его визуальную обёртку.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "widget_id": { "type": "string" },
                        "x_pct": { "type": "number" },
                        "y_pct": { "type": "number" },
                        "scale": { "type": "number" },
                        "wrapper_preset": { "type": "string" },
                        "visible": { "type": "boolean" }
                    },
                    "required": ["widget_id"]
                }
            }
        }
    ])
}

/// Главная точка входа ИИ-агента: выбирает режим (`http` или `embedded`) и исполняет инструменты.
pub async fn handle_agent_prompt(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    whisper: &Arc<WhisperController>,
    prompt: &str,
) -> AgentResponse {
    let llm_cfg = { state.snapshot.read().await.llm.clone() };

    if llm_cfg.backend.eq_ignore_ascii_case("embedded") {
        match run_embedded_llama(&llm_cfg.model_path, prompt).await {
            Ok((reply, calls)) => {
                let executed = execute_tool_calls(state, obs, whisper, calls).await;
                return AgentResponse {
                    reply,
                    backend_used: "embedded (llama-cpp-2)".to_string(),
                    tool_calls_executed: executed,
                };
            }
            Err(err) => {
                state.push_log("warn", "agent", format!("Embedded llama-cpp-2 недоступен ({}), использую локальный парсер", err)).await;
            }
        }
    } else {
        match run_http_llama_server(state, &llm_cfg.server_url, &llm_cfg.model_name, prompt).await {
            Ok((reply, calls)) => {
                let executed = execute_tool_calls(state, obs, whisper, calls).await;
                return AgentResponse {
                    reply,
                    backend_used: "http (llama-server)".to_string(),
                    tool_calls_executed: executed,
                };
            }
            Err(err) => {
                state.push_log("warn", "agent", format!("HTTP llama-server недоступен ({}), использую локальный парсер", err)).await;
            }
        }
    }

    // Гарантированный детерминированный фоллбэк, чтобы все команды работали даже без запущенного LLM-процесса
    let (reply, calls) = deterministic_command_fallback(prompt);
    let executed = execute_tool_calls(state, obs, whisper, calls).await;
    AgentResponse {
        reply,
        backend_used: "local-deterministic-fallback".to_string(),
        tool_calls_executed: executed,
    }
}

/// Запрос к локальному `llama-server` с OpenAI-совместимым Function Calling.
async fn run_http_llama_server(
    state: &Arc<AppState>,
    url: &str,
    model: &str,
    prompt: &str,
) -> Result<(String, Vec<(String, Value)>), String> {
    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Ты локальный ИИ-режиссёр стриминговой платформы PulseCast. Используй предоставленные инструменты для управления сценами, алертами, чатом, мини-играми Stream Avatars, плагинами и макетом оверлея. Отвечай кратко на русском."
            },
            { "role": "user", "content": prompt }
        ],
        "tools": agent_tools_schema(),
        "tool_choice": "auto",
        "temperature": 0.2
    });

    let resp = state
        .http_client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP статус {}", resp.status()));
    }

    let json_resp: Value = resp.json().await.map_err(|e| e.to_string())?;
    let message = &json_resp["choices"][0]["message"];
    let content = message["content"].as_str().unwrap_or("Команда обработана.").to_string();

    let mut calls = Vec::new();
    if let Some(arr) = message["tool_calls"].as_array() {
        for tc in arr {
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args_raw = tc["function"]["arguments"].as_str().unwrap_or("{}");
            let args: Value = serde_json::from_str(args_raw).unwrap_or_else(|_| json!({}));
            if !name.is_empty() {
                calls.push((name, args));
            }
        }
    }

    Ok((content, calls))
}

/// Прямой инференс GGUF-модели в процессе через `llama-cpp-2` (внутри `spawn_blocking`).
async fn run_embedded_llama(
    model_path: &str,
    prompt: &str,
) -> Result<(String, Vec<(String, Value)>), String> {
    if !Path::new(model_path).exists() {
        return Err(format!("Файл GGUF-модели не найден: {}", model_path));
    }
    let m_path = model_path.to_string();
    let user_prompt = prompt.to_string();

    tokio::task::spawn_blocking(move || {
        let backend = LlamaBackend::init().map_err(|e| format!("LlamaBackend::init: {:?}", e))?;
        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, &m_path, &model_params)
            .map_err(|e| format!("load_from_file: {:?}", e))?;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(NonZeroU32::new(2048).unwrap()));
        let mut ctx = model
            .new_context(&backend, ctx_params)
            .map_err(|e| format!("new_context: {:?}", e))?;

        let system_prompt = format!(
            "Верни ТОЛЬКО JSON: {{\"reply\":\"...\",\"tool_calls\":[{{\"name\":\"...\",\"arguments\":{{...}}}}]}}. Доступные инструменты: change_scene, trigger_alert, send_chat_message, toggle_subtitles, set_theme, play_sound, start_minigame, avatar_action, toggle_plugin, configure_plugin, trigger_plugin_effect, upsert_custom_plugin, update_widget_layout. Запрос: {}\nJSON:",
            user_prompt
        );

        let tokens = model
            .str_to_token(&system_prompt, AddBos::Always)
            .map_err(|e| format!("str_to_token: {:?}", e))?;

        let mut batch = LlamaBatch::new(2048, 1);
        let last_idx = tokens.len().saturating_sub(1);
        for (i, &tok) in tokens.iter().enumerate() {
            batch
                .add(tok, i as i32, &[0], i == last_idx)
                .map_err(|e| format!("batch.add: {:?}", e))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode: {:?}", e))?;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(0.2),
            LlamaSampler::dist(42),
        ]);

        let mut raw_out = String::new();
        let mut n_cur = tokens.len() as i32;
        for _ in 0..256 {
            let tok = sampler.sample(&ctx, batch.n_tokens() - 1);
            if model.is_eog_token(tok) {
                break;
            }
            if let Ok(piece) = model.token_to_str(tok, Special::Plaintext) {
                raw_out.push_str(&piece);
                if raw_out.ends_with('}') && serde_json::from_str::<Value>(&raw_out).is_ok() {
                    break;
                }
            }
            batch.clear();
            batch
                .add(tok, n_cur, &[0], true)
                .map_err(|e| format!("batch.add step: {:?}", e))?;
            n_cur += 1;
            ctx.decode(&mut batch).map_err(|e| format!("decode step: {:?}", e))?;
        }

        let parsed: Value = serde_json::from_str(raw_out.trim())
            .map_err(|_| format!("Модель вернула не-JSON ответ: {}", raw_out))?;
        let reply = parsed["reply"].as_str().unwrap_or("Выполнено локальной моделью.").to_string();
        let mut calls = Vec::new();
        if let Some(arr) = parsed["tool_calls"].as_array() {
            for tc in arr {
                let name = tc["name"].as_str().unwrap_or("").to_string();
                let args = tc["arguments"].clone();
                if !name.is_empty() {
                    calls.push((name, args));
                }
            }
        }
        Ok((reply, calls))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Исполняет список вызовов инструментов на состоянии сервера.
pub async fn execute_tool_calls(
    state: &Arc<AppState>,
    obs: &Arc<ObsBridge>,
    whisper: &Arc<WhisperController>,
    calls: Vec<(String, Value)>,
) -> Vec<ExecutedTool> {
    let mut results = Vec::new();
    for (name, args) in calls {
        let res_msg = match name.as_str() {
            "change_scene" => {
                let scene = args["scene"].as_str().unwrap_or("Main Studio");
                let synced = obs.set_scene(scene, state).await;
                {
                    let mut guard = state.snapshot.write().await;
                    guard.obs.active_scene = scene.to_string();
                }
                let _ = state.tx.send(WsBroadcast::SceneChanged {
                    scene: scene.to_string(),
                    obs_synced: synced,
                });
                format!("Сцена изменена на '{}' (OBS sync: {})", scene, synced)
            }
            "trigger_alert" => {
                let username = args["username"].as_str().unwrap_or("Аноним").to_string();
                let amount = args["amount"].as_f64().unwrap_or(100.0);
                let message = args["message"].as_str().unwrap_or("Тестовый алерт от агента").to_string();
                let ev = StreamEvent {
                    id: Uuid::new_v4(),
                    kind: StreamEventKind::Donation,
                    source: "ai_agent".to_string(),
                    username: username.clone(),
                    amount,
                    currency: "₽".to_string(),
                    original_amount: Some(amount),
                    original_currency: Some("₽".to_string()),
                    message,
                    sound_id: Some("fanfare".to_string()),
                    tts_enabled: true,
                    variation_id: None,
                    media_url: None,
                    media_title: None,
                    media_duration_sec: None,
                    created_at: Utc::now(),
                };
                process_stream_event(state, obs, ev).await;
                format!("Алерт для '{}' ({:.0} ₽) отправлен на оверлей", username, amount)
            }
            "send_chat_message" => {
                let text = args["text"].as_str().unwrap_or("Привет, чат!").to_string();
                send_system_chat(state, "AI-Режиссёр", ViewerRole::Agent, text.clone()).await;
                format!("Отправлено в чат: {}", text)
            }
            "toggle_subtitles" => {
                let enabled = args["enabled"].as_bool().unwrap_or(true);
                let status = whisper.set_enabled(state, enabled).await;
                format!("Субтитры Whisper: {} ({})", status.enabled, status.diagnostic)
            }
            "set_theme" => {
                let target = args["target"].as_str().unwrap_or("overlay");
                let theme_id = args["theme_id"].as_str().unwrap_or("overlay_neon");
                let (d_theme, o_theme, themes) = {
                    let mut guard = state.snapshot.write().await;
                    if target == "dashboard" {
                        guard.active_dashboard_theme = theme_id.to_string();
                    } else {
                        guard.active_overlay_theme = theme_id.to_string();
                    }
                    (
                        guard.active_dashboard_theme.clone(),
                        guard.active_overlay_theme.clone(),
                        guard.themes.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::ThemeChanged {
                    dashboard_theme: d_theme,
                    overlay_theme: o_theme,
                    themes,
                });
                format!("Тема {} переключена на '{}'", target, theme_id)
            }
            "play_sound" => {
                let sound_id = args["sound_id"].as_str().unwrap_or("fanfare");
                let sound = {
                    let guard = state.snapshot.read().await;
                    guard.sounds.iter().find(|s| s.id == sound_id).cloned()
                };
                if let Some(s) = sound {
                    let _ = state.tx.send(WsBroadcast::PlaySound {
                        sound_id: s.id.clone(),
                        name: s.name.clone(),
                        freq_hz: s.freq_hz,
                        pattern: s.pattern,
                        volume: s.volume,
                    });
                    format!("Звук '{}' воспроизведён", s.name)
                } else {
                    format!("Звук '{}' не найден", sound_id)
                }
            }
            "manage_poll" => {
                let active = args["active"].as_bool().unwrap_or(true);
                let (goal, subathon, boss, poll, giveaway) = {
                    let mut guard = state.snapshot.write().await;
                    guard.poll.active = active;
                    if let Some(q) = args["question"].as_str() {
                        guard.poll.question = q.to_string();
                    }
                    if let Some(opts) = args["options"].as_array() {
                        guard.poll.options = opts
                            .iter()
                            .enumerate()
                            .filter_map(|(i, v)| v.as_str().map(|s| PollOption {
                                id: (i + 1).to_string(),
                                label: s.to_string(),
                                votes: 0,
                            }))
                            .collect();
                    }
                    (
                        guard.goal.clone(),
                        guard.subathon.clone(),
                        guard.stream_boss.clone(),
                        guard.poll.clone(),
                        guard.giveaway.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::EngagementUpdated {
                    goal,
                    subathon,
                    stream_boss: boss,
                    poll,
                    giveaway,
                });
                format!("Опрос обновлён (active={})", active)
            }
            "update_goal_or_timer" => {
                let (goal, subathon, boss, poll, giveaway) = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(secs) = args["add_subathon_seconds"].as_u64() {
                        guard.subathon.remaining_seconds += secs;
                    }
                    if let Some(run) = args["subathon_running"].as_bool() {
                        guard.subathon.running = run;
                    }
                    if let Some(amt) = args["add_goal_amount"].as_f64() {
                        guard.goal.current += amt;
                    }
                    (
                        guard.goal.clone(),
                        guard.subathon.clone(),
                        guard.stream_boss.clone(),
                        guard.poll.clone(),
                        guard.giveaway.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::EngagementUpdated {
                    goal,
                    subathon,
                    stream_boss: boss,
                    poll,
                    giveaway,
                });
                "Цель / Subathon-таймер обновлены".to_string()
            }
            "mark_clip" => {
                let title = args["title"].as_str().unwrap_or("Момент от ИИ-агента").to_string();
                let _ = obs.save_replay_buffer().await;
                let clip = ClipMarker {
                    id: Uuid::new_v4(),
                    title: title.clone(),
                    author: "AI-Режиссёр".to_string(),
                    stream_elapsed_sec: 0,
                    created_at: Utc::now(),
                };
                {
                    let mut guard = state.snapshot.write().await;
                    guard.clip_markers.push_back(clip.clone());
                }
                let _ = state.tx.send(WsBroadcast::ClipMarked(clip));
                format!("Сохранён маркер клипа: '{}'", title)
            }
            "start_minigame" => {
                let kind_str = args["kind"].as_str().unwrap_or("battle_royale");
                let kind = match kind_str {
                    "battle_royale" => MiniGameKind::BattleRoyale,
                    "boss_fight" => MiniGameKind::BossFight,
                    "star_catch" => MiniGameKind::StarCatch,
                    "basketball" => MiniGameKind::Basketball,
                    _ => MiniGameKind::None,
                };
                {
                    let mut guard = state.snapshot.write().await;
                    guard.arena.active_minigame = kind.clone();
                }
                let _ = state.tx.send(WsBroadcast::MinigameStarted {
                    kind: kind.clone(),
                    initiator: "AI-Режиссёр".to_string(),
                    details: args.clone(),
                });
                format!("Мини-игра {:?} запущена", kind)
            }
            "avatar_action" => {
                let username = args["username"].as_str().unwrap_or("*").to_string();
                let action = args["action"].as_str().unwrap_or("dance").to_string();
                let target = args["target"].as_str().map(str::to_string);
                let _ = state.tx.send(WsBroadcast::AvatarAction {
                    username: username.clone(),
                    action: action.clone(),
                    target,
                    text: None,
                });
                format!("Команда '{}' отправлена аватарам ({})", action, username)
            }
            "manage_giveaway" => {
                let act = args["action"].as_str().unwrap_or("start");
                let (goal, subathon, boss, poll, giveaway, msg) = {
                    let mut guard = state.snapshot.write().await;
                    let mut out = String::new();
                    match act {
                        "start" => {
                            guard.giveaway.active = true;
                            if let Some(p) = args["prize"].as_str() {
                                guard.giveaway.prize = p.to_string();
                            }
                            if let Some(k) = args["keyword"].as_str() {
                                guard.giveaway.keyword = k.to_string();
                            }
                            guard.giveaway.participants.clear();
                            out = format!("Розыгрыш '{}' открыт! Ключевое слово: {}", guard.giveaway.prize, guard.giveaway.keyword);
                        }
                        "pick_winner" => {
                            guard.giveaway.active = false;
                            if guard.giveaway.participants.is_empty() {
                                out = "Участников розыгрыша пока нет".to_string();
                            } else {
                                let idx = (Utc::now().timestamp_subsec_millis() as usize) % guard.giveaway.participants.len();
                                let winner = guard.giveaway.participants[idx].clone();
                                guard.giveaway.last_winner = Some(winner.clone());
                                out = format!("Победитель розыгрыша: {}!", winner);
                            }
                        }
                        _ => {
                            guard.giveaway.active = false;
                            out = "Розыгрыш остановлен".to_string();
                        }
                    }
                    (
                        guard.goal.clone(),
                        guard.subathon.clone(),
                        guard.stream_boss.clone(),
                        guard.poll.clone(),
                        guard.giveaway.clone(),
                        out,
                    )
                };
                let _ = state.tx.send(WsBroadcast::EngagementUpdated {
                    goal,
                    subathon,
                    stream_boss: boss,
                    poll,
                    giveaway,
                });
                msg
            }
            "toggle_plugin" => {
                let plugin_id = args["plugin_id"].as_str().unwrap_or("starfall");
                let enabled = args["enabled"].as_bool().unwrap_or(true);
                let updated = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(p) = guard.plugins.iter_mut().find(|p| p.id == plugin_id) {
                        p.enabled = enabled;
                        Some(p.clone())
                    } else {
                        None
                    }
                };
                if let Some(p) = updated {
                    let _ = state.tx.send(WsBroadcast::PluginUpdated(p));
                    format!("Плагин '{}' {}", plugin_id, if enabled { "включён" } else { "выключен" })
                } else {
                    format!("Плагин '{}' не найден", plugin_id)
                }
            }
            "configure_plugin" => {
                let plugin_id = args["plugin_id"].as_str().unwrap_or("starfall");
                let cfg = &args["config"];
                let updated = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(p) = guard.plugins.iter_mut().find(|p| p.id == plugin_id) {
                        if let (Some(dst), Some(src)) = (p.config.as_object_mut(), cfg.as_object()) {
                            for (k, v) in src {
                                dst.insert(k.clone(), v.clone());
                            }
                        }
                        Some(p.clone())
                    } else {
                        None
                    }
                };
                if let Some(p) = updated {
                    let _ = state.tx.send(WsBroadcast::PluginUpdated(p));
                    format!("Параметры плагина '{}' обновлены", plugin_id)
                } else {
                    format!("Плагин '{}' не найден", plugin_id)
                }
            }
            "trigger_plugin_effect" => {
                let plugin_id = args["plugin_id"].as_str().unwrap_or("starfall").to_string();
                let payload = args.get("payload").cloned().unwrap_or_else(|| json!({ "burst": 45 }));
                let _ = state.tx.send(WsBroadcast::PluginTriggered {
                    plugin_id: plugin_id.clone(),
                    data: payload,
                });
                format!("Эффект плагина '{}' запущен", plugin_id)
            }
            "upsert_custom_plugin" => {
                let id = args["id"].as_str().unwrap_or("custom_fx").to_string();
                let plugin = OverlayPlugin {
                    id: id.clone(),
                    name: args["name"].as_str().unwrap_or("Кастомный эффект").to_string(),
                    description: args["description"].as_str().unwrap_or("Создано ИИ-агентом").to_string(),
                    author: "AI-Режиссёр".to_string(),
                    enabled: args["enabled"].as_bool().unwrap_or(true),
                    builtin: false,
                    z_index: 32,
                    config: args.get("config").cloned().unwrap_or_else(|| json!({})),
                    hooks: args["hooks"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                        .unwrap_or_else(|| vec!["on_tick".to_string(), "on_chat".to_string()]),
                    style_css: args["style_css"].as_str().unwrap_or("").to_string(),
                    script_js: args["script_js"].as_str().unwrap_or("").to_string(),
                };
                {
                    let mut guard = state.snapshot.write().await;
                    if let Some(existing) = guard.plugins.iter_mut().find(|p| p.id == id) {
                        *existing = plugin.clone();
                    } else {
                        guard.plugins.push(plugin.clone());
                    }
                }
                let _ = state.tx.send(WsBroadcast::PluginUpdated(plugin));
                format!("Кастомный плагин '{}' сохранён и активирован", id)
            }
            "update_widget_layout" => {
                let widget_id = args["widget_id"].as_str().unwrap_or("chat");
                let layouts = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(w) = guard.layouts.iter_mut().find(|w| w.widget_id == widget_id) {
                        if let Some(x) = args["x_pct"].as_f64() { w.x_pct = x as f32; }
                        if let Some(y) = args["y_pct"].as_f64() { w.y_pct = y as f32; }
                        if let Some(s) = args["scale"].as_f64() { w.scale = s as f32; }
                        if let Some(vis) = args["visible"].as_bool() { w.visible = vis; }
                        if let Some(wrap) = args["wrapper_preset"].as_str() { w.wrapper_preset = wrap.to_string(); }
                    }
                    guard.layouts.clone()
                };
                let _ = state.tx.send(WsBroadcast::LayoutUpdated(layouts));
                format!("Макет виджета '{}' обновлён", widget_id)
            }
            "upsert_custom_element" => {
                let id = args["id"].as_str().unwrap_or("el_ai").to_string();
                let elem = crate::state::CustomOverlayElement {
                    id: id.clone(),
                    name: args["name"].as_str().unwrap_or("Элемент от ИИ").to_string(),
                    visible: args["visible"].as_bool().unwrap_or(true),
                    x_pct: args["x_pct"].as_f64().unwrap_or(20.0) as f32,
                    y_pct: args["y_pct"].as_f64().unwrap_or(20.0) as f32,
                    width_px: args["width_px"].as_u64().unwrap_or(180) as u32,
                    z_index: args["z_index"].as_i64().unwrap_or(28) as i32,
                    image_url: args["image_url"].as_str().unwrap_or("").to_string(),
                    html: args["html"].as_str().unwrap_or("").to_string(),
                    css: args["css"].as_str().unwrap_or("").to_string(),
                };
                {
                    let mut guard = state.snapshot.write().await;
                    if let Some(ex) = guard.custom_elements.iter_mut().find(|x| x.id == id) {
                        *ex = elem;
                    } else {
                        guard.custom_elements.push(elem);
                    }
                    let _ = state.tx.send(WsBroadcast::CustomizationUpdated {
                        goals: guard.goals.clone(),
                        parser_rules: guard.parser_rules.clone(),
                        media_assets: guard.media_assets.clone(),
                        alert_variations: guard.alert_variations.clone(),
                        feed_config: guard.feed_config.clone(),
                        custom_elements: guard.custom_elements.clone(),
                        scenarios: guard.scenarios.clone(),
                    });
                }
                format!("Кастомный элемент оверлея '{}' обновлён", id)
            }
            "start_timer" => {
                let secs = args["seconds"].as_u64().unwrap_or(300);
                let (goal, subathon, boss, poll, giveaway) = {
                    let mut guard = state.snapshot.write().await;
                    guard.subathon.remaining_seconds = secs;
                    guard.subathon.running = true;
                    (
                        guard.goal.clone(),
                        guard.subathon.clone(),
                        guard.stream_boss.clone(),
                        guard.poll.clone(),
                        guard.giveaway.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::EngagementUpdated {
                    goal,
                    subathon,
                    stream_boss: boss,
                    poll,
                    giveaway,
                });
                format!("Таймер запущен на {} сек.", secs)
            }
            "set_obs_audio" => {
                let audio = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(m) = args["mic_muted"].as_bool() {
                        guard.obs_audio.mic_muted = m;
                    }
                    if let Some(v) = args["music_volume"].as_u64() {
                        guard.obs_audio.music_volume = (v as u8).min(100);
                    }
                    guard.obs_audio.clone()
                };
                format!(
                    "OBS Аудио: микрофон {}, музыка {}%",
                    if audio.mic_muted { "ВЫКЛ" } else { "ВКЛ" },
                    audio.music_volume
                )
            }
            "set_pngtuber_emotion" => {
                let emotion = args["emotion"].as_str().unwrap_or("happy").to_string();
                let (ht, gc, pt, oa) = {
                    let mut guard = state.snapshot.write().await;
                    guard.pngtuber.emotion = emotion.clone();
                    if let Some(t) = args["talking"].as_bool() {
                        guard.pngtuber.talking = t;
                    }
                    (
                        guard.hype_train.clone(),
                        guard.game_counters.clone(),
                        guard.pngtuber.clone(),
                        guard.obs_audio.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::CountersUpdated {
                    hype_train: ht,
                    game_counters: gc,
                    pngtuber: pt,
                    obs_audio: oa,
                });
                format!("Эмоция PNGTuber: {}", emotion)
            }
            "update_counters" => {
                let (ht, gc, pt, oa) = {
                    let mut guard = state.snapshot.write().await;
                    if let Some(d) = args["deaths_delta"].as_i64() {
                        guard.game_counters.deaths = (guard.game_counters.deaths as i64 + d).max(0) as u32;
                    }
                    if let Some(w) = args["wins_delta"].as_i64() {
                        guard.game_counters.wins = (guard.game_counters.wins as i64 + w).max(0) as u32;
                    }
                    if let Some(l) = args["losses_delta"].as_i64() {
                        guard.game_counters.losses = (guard.game_counters.losses as i64 + l).max(0) as u32;
                    }
                    if let Some(p) = args["hype_progress_delta"].as_u64() {
                        guard.hype_train.active = true;
                        guard.hype_train.current_points =
                            (guard.hype_train.current_points + p).min(guard.hype_train.goal_points);
                    }
                    (
                        guard.hype_train.clone(),
                        guard.game_counters.clone(),
                        guard.pngtuber.clone(),
                        guard.obs_audio.clone(),
                    )
                };
                let _ = state.tx.send(WsBroadcast::CountersUpdated {
                    hype_train: ht,
                    game_counters: gc.clone(),
                    pngtuber: pt,
                    obs_audio: oa,
                });
                format!("Счётчики: смертей={}, побед={}", gc.deaths, gc.wins)
            }
            other => format!("Неизвестный инструмент: {}", other),
        };

        state.push_log("info", "agent_tool", format!("{} -> {}", name, res_msg)).await;
        results.push(ExecutedTool {
            name,
            arguments: args,
            result: res_msg,
        });
    }
    state.persist_profile().await;
    results
}

/// Детерминированный разбор команд на русском/английском при отсутствии внешнего LLM-сервера.
fn deterministic_command_fallback(prompt: &str) -> (String, Vec<(String, Value)>) {
    let lower = prompt.to_lowercase();
    let mut calls = Vec::new();
    let mut notes = Vec::new();

    if lower.contains("сцен") {
        let scene = if lower.contains("игр") || lower.contains("gam") {
            "Gaming Capture"
        } else if lower.contains("чат") || lower.contains("общен") {
            "Just Chatting"
        } else if lower.contains("пауз") || lower.contains("brb") {
            "BRB Pause"
        } else {
            "Main Studio"
        };
        calls.push(("change_scene".to_string(), json!({ "scene": scene })));
        notes.push(format!("переключил сцену на «{}»", scene));
    }

    if lower.contains("звёзд") || lower.contains("звезд") || lower.contains("салют") {
        calls.push(("toggle_plugin".to_string(), json!({ "plugin_id": "starfall", "enabled": true })));
        calls.push(("trigger_plugin_effect".to_string(), json!({ "plugin_id": "starfall", "payload": { "burst": 55 } })));
        notes.push("запустил плагин «Падающие звёздочки»".to_string());
    }

    if lower.contains("чок") || lower.contains("аватар") || lower.contains("танц") {
        calls.push(("toggle_plugin".to_string(), json!({ "plugin_id": "chat_runners", "enabled": true })));
        calls.push(("avatar_action".to_string(), json!({ "username": "*", "action": "dance" })));
        notes.push("активировал бегающих чоков и танец".to_string());
    }

    if lower.contains("алерт") || lower.contains("донат") {
        calls.push((
            "trigger_alert".to_string(),
            json!({ "username": "Режиссёр", "amount": 500, "message": "Поддержка эфира от ИИ-пульта!" }),
        ));
        notes.push("вывел алерт на оверлей".to_string());
    }

    if lower.contains("battle") || lower.contains("королев") || lower.contains("роял") {
        calls.push(("start_minigame".to_string(), json!({ "kind": "battle_royale" })));
        notes.push("запустил мини-игру Battle Royale".to_string());
    } else if lower.contains("босс") || lower.contains("boss") {
        calls.push(("start_minigame".to_string(), json!({ "kind": "boss_fight" })));
        notes.push("запустил рейд Boss Fight".to_string());
    }

    if lower.contains("клип") || lower.contains("момент") {
        calls.push(("mark_clip".to_string(), json!({ "title": "Отметка от ИИ-агента" })));
        notes.push("сохранил маркер клипа".to_string());
    }

    if lower.contains("субтитр") {
        let on = !lower.contains("выкл");
        calls.push(("toggle_subtitles".to_string(), json!({ "enabled": on })));
        notes.push(if on { "включил субтитры" } else { "выключил субтитры" }.to_string());
    }

    if lower.contains("таймер") {
        calls.push(("start_timer".to_string(), json!({ "seconds": 300 })));
        notes.push("запустил таймер на 5 минут".to_string());
    }

    if lower.contains("микрофон") || lower.contains("музык") {
        let mute = lower.contains("выкл") || lower.contains("мут");
        calls.push(("set_obs_audio".to_string(), json!({ "mic_muted": mute, "music_volume": 25 })));
        notes.push("обновил параметры OBS Аудио".to_string());
    }

    if lower.contains("смерт") || lower.contains("death") {
        calls.push(("update_counters".to_string(), json!({ "deaths_delta": 1 })));
        notes.push("увеличил счётчик смертей".to_string());
    }

    if lower.contains("бум") && (lower.contains("созда") || lower.contains("плагин")) {
        calls.push(("toggle_plugin".to_string(), json!({ "plugin_id": "word_boom", "enabled": true })));
        notes.push("включил плагин реакции на слово «бум»".to_string());
    }

    if calls.is_empty() {
        calls.push(("send_chat_message".to_string(), json!({ "text": format!("Принято: {}", prompt) })));
        return (
            "Выполнил команду в автономном режиме и отправил подтверждение в чат.".to_string(),
            calls,
        );
    }

    (format!("Готово: {}.", notes.join(", ")), calls)
}
