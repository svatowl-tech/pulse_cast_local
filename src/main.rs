//! Точка входа локальной стриминговой платформы PulseCast Local.
//! Запускает Axum HTTP/WebSocket-сервер (`127.0.0.1:8080` по умолчанию),
//! раздаёт статические интерфейсы дашборда и OBS-оверлея (`/overlay`),
//! подключает OBS WebSocket (`obws`), чат-бот, Whisper и локальный ИИ-агент.

mod agent;
mod bot;
mod bridges;
mod obs;
mod plugins;
mod state;
mod whisper_sub;

use crate::agent::handle_agent_prompt;
use crate::bot::{process_incoming_chat, process_stream_event, send_system_chat};
use crate::bridges::{parse_raw_alert, save_media_asset_bytes, BridgeDeduplicator};
use crate::obs::ObsBridge;
use crate::state::{
    AlertVariation, AppState, AutomationScenario, BridgeParserRule, ChatPlatform, ClipMarker,
    CustomOverlayElement, FeedConfig, GameWebhookRule, GoalWidget, HotkeyBinding, LlmConfig,
    MediaShareConfig, MiniGameKind, OverlayPlugin, PayoutRecord, PollOption, PredictionOutcome,
    SlotsSpinResult, StreamEvent, StreamEventKind, StreamRecap, StreamSnapshot, ThemeConfig,
    TickerConfig, TtsConfig, ViewerRole, WidgetLayoutConfig, WsBroadcast,
};
use crate::whisper_sub::WhisperController;
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

/// Общий контекст зависимостей, доступный во всех Axum-хендлерах.
#[derive(Clone)]
struct ServerContext {
    state: Arc<AppState>,
    obs: Arc<ObsBridge>,
    whisper: Arc<WhisperController>,
    dedup: Arc<BridgeDeduplicator>,
    assets_dir: PathBuf,
}

#[tokio::main]
async fn main() {
    // 1. Загружаем .env (если присутствует) и инициализируем структурированное логирование
    let _ = dotenvy::dotenv();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pulsecast_local=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let host = std::env::var("PULSECAST_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("PULSECAST_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let static_dir = PathBuf::from(std::env::var("PULSECAST_STATIC_DIR").unwrap_or_else(|_| "static".to_string()));
    let profile_path = PathBuf::from(
        std::env::var("PULSECAST_DATA_FILE").unwrap_or_else(|_| "pulsecast_profile.json".to_string()),
    );

    let llm_cfg = LlmConfig {
        backend: std::env::var("LLM_BACKEND").unwrap_or_else(|_| "http".to_string()),
        server_url: std::env::var("LLAMA_SERVER_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8081/v1/chat/completions".to_string()),
        model_name: std::env::var("LLAMA_MODEL_NAME").unwrap_or_else(|_| "local-model".to_string()),
        model_path: std::env::var("LLAMA_MODEL_PATH")
            .unwrap_or_else(|_| "models/qwen2.5-3b-instruct-q4_k_m.gguf".to_string()),
    };

    let obs_host = std::env::var("OBS_WS_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let obs_port: u16 = std::env::var("OBS_WS_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4455);
    let obs_password = std::env::var("OBS_WS_PASSWORD").ok();

    let whisper_model = PathBuf::from(
        std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| "models/ggml-base.bin".to_string()),
    );
    let whisper_lang = std::env::var("WHISPER_LANGUAGE").unwrap_or_else(|_| "ru".to_string());
    let whisper_autostart = std::env::var("WHISPER_AUTO_START").unwrap_or_else(|_| "false".to_string()) == "true";

    // 2. Инициализируем AppState, OBS-мост и контроллер Whisper
    let state = AppState::new(profile_path, llm_cfg, format!("{}:{}", obs_host, obs_port));
    let obs = ObsBridge::new(obs_host, obs_port, obs_password);
    let whisper = WhisperController::new(whisper_model, whisper_lang);

    // Фоновая попытка подключения к OBS Studio (не блокирует старт сервера)
    {
        let obs_bg = Arc::clone(&obs);
        let st_bg = Arc::clone(&state);
        tokio::spawn(async move {
            obs_bg.try_connect(&st_bg).await;
        });
    }

    // Автозапуск субтитров Whisper, если включено в .env
    if whisper_autostart {
        whisper.set_enabled(&state, true).await;
    }

    // Фоновый тикер Subathon, Media Share и Ticker-таймера (1 раз в секунду)
    {
        let st_timer = Arc::clone(&state);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let (maybe_engagement, maybe_seda) = {
                    let mut guard = st_timer.snapshot.write().await;
                    let mut eng_changed = false;
                    if guard.subathon.running && guard.subathon.remaining_seconds > 0 {
                        guard.subathon.remaining_seconds -= 1;
                        eng_changed = true;
                    }

                    let mut seda_changed = false;
                    if let Some(pos) = guard.media_queue.iter().position(|m| m.status == "playing") {
                        seda_changed = true;
                        if guard.media_queue[pos].remaining_sec > 1 {
                            guard.media_queue[pos].remaining_sec -= 1;
                        } else {
                            guard.media_queue[pos].remaining_sec = 0;
                            guard.media_queue[pos].status = "done".to_string();
                            if guard.media_share_config.auto_play {
                                if let Some(next) = guard.media_queue.iter_mut().find(|m| m.status == "queued") {
                                    next.status = "playing".to_string();
                                }
                            }
                        }
                    }

                    if guard.ticker.countdown_active && guard.ticker.countdown_remaining_sec > 0 {
                        guard.ticker.countdown_remaining_sec -= 1;
                        seda_changed = true;
                        if guard.ticker.countdown_remaining_sec == 0 {
                            guard.ticker.countdown_active = false;
                        }
                    }

                    let eng = if eng_changed {
                        Some((
                            guard.goal.clone(),
                            guard.subathon.clone(),
                            guard.stream_boss.clone(),
                            guard.poll.clone(),
                            guard.giveaway.clone(),
                        ))
                    } else {
                        None
                    };
                    let seda = if seda_changed {
                        Some(WsBroadcast::SeDaUpdated {
                            media_share_config: guard.media_share_config.clone(),
                            media_queue: guard.media_queue.clone(),
                            tts_config: guard.tts_config.clone(),
                            prediction: guard.prediction.clone(),
                            last_slots_spin: guard.last_slots_spin.clone(),
                            ticker: guard.ticker.clone(),
                            fintech: guard.fintech.clone(),
                            game_webhooks: guard.game_webhooks.clone(),
                        })
                    } else {
                        None
                    };
                    (eng, seda)
                };
                if let Some((goal, subathon, boss, poll, giveaway)) = maybe_engagement {
                    let _ = st_timer.tx.send(WsBroadcast::EngagementUpdated {
                        goal,
                        subathon,
                        stream_boss: boss,
                        poll,
                        giveaway,
                    });
                }
                if let Some(seda_msg) = maybe_seda {
                    let _ = st_timer.tx.send(seda_msg);
                }
            }
        });
    }

    let assets_dir = PathBuf::from(
        std::env::var("PULSECAST_ASSETS_DIR").unwrap_or_else(|_| "assets".to_string()),
    );
    let _ = std::fs::create_dir_all(&assets_dir);

    let ctx = ServerContext {
        state: Arc::clone(&state),
        obs: Arc::clone(&obs),
        whisper: Arc::clone(&whisper),
        dedup: BridgeDeduplicator::new(),
        assets_dir: assets_dir.clone(),
    };

    let index_file = static_dir.join("index.html");
    let overlay_file = static_dir.join("overlay.html");

    // 3. Собираем Axum-маршрутизатор
    let app = Router::new()
        .route_service("/", ServeFile::new(index_file.clone()))
        .route_service("/donate", ServeFile::new(index_file.clone()))
        .route_service("/obs-dock", ServeFile::new(index_file))
        .route_service("/overlay", ServeFile::new(overlay_file))
        .nest_service("/static", ServeDir::new(static_dir.clone()))
        .nest_service("/assets", ServeDir::new(assets_dir))
        .route("/ws", get(ws_handler))
        .route("/api/state", get(api_get_state))
        .route("/api/webhooks/donation", post(api_donation_webhook))
        .route("/api/bridges/ingest", post(api_bridge_ingest))
        .route("/api/bridges/rules", post(api_save_parser_rules))
        .route("/api/assets", post(api_upload_asset))
        .route("/api/assets/delete", post(api_delete_asset))
        .route("/api/alerts/variations", post(api_save_alert_variations))
        .route("/api/goals", post(api_save_goals))
        .route("/api/scenarios", post(api_save_scenarios))
        .route("/api/feed-config", post(api_save_feed_config))
        .route("/api/overlay/elements", post(api_save_custom_elements))
        .route("/api/events/replay", post(api_replay_event))
        .route("/api/chat/ingest", post(api_chat_ingest))
        .route("/api/scene", post(api_change_scene))
        .route("/api/obs/connect", post(api_obs_connect))
        .route("/api/obs/disconnect", post(api_obs_disconnect))
        .route("/api/audio/mixer", post(api_audio_mixer))
        .route("/api/hotkeys", post(api_save_hotkeys))
        .route("/api/analytics/export.csv", get(api_analytics_export_csv))
        .route("/api/deck/trigger", post(api_deck_trigger))
        .route("/api/sound/play", post(api_play_sound))
        .route("/api/poll", post(api_manage_poll))
        .route("/api/poll/vote", post(api_vote_poll))
        .route("/api/wheel/spin", post(api_spin_wheel))
        .route("/api/giveaway", post(api_manage_giveaway))
        .route("/api/subathon/toggle", post(api_subathon_toggle))
        .route("/api/clip", post(api_mark_clip))
        .route("/api/minigame", post(api_start_minigame))
        .route("/api/avatar/action", post(api_avatar_action))
        .route("/api/plugins/upsert", post(api_upsert_plugin))
        .route("/api/plugins/toggle", post(api_toggle_plugin))
        .route("/api/plugins/trigger", post(api_trigger_plugin))
        .route("/api/layouts", post(api_update_layouts))
        .route("/api/themes", post(api_upsert_theme))
        .route("/api/themes/select", post(api_select_theme))
        .route("/api/superthemes/apply", post(api_apply_supertheme))
        .route("/api/media/config", post(api_media_config))
        .route("/api/media/control", post(api_media_control))
        .route("/api/tts/config", post(api_tts_config))
        .route("/api/predictions/manage", post(api_predictions_manage))
        .route("/api/predictions/bet", post(api_predictions_bet))
        .route("/api/slots/spin", post(api_slots_spin))
        .route("/api/ticker/config", post(api_ticker_config))
        .route("/api/fintech/config", post(api_fintech_config))
        .route("/api/fintech/withdraw", post(api_fintech_withdraw))
        .route("/api/game-webhooks/upsert", post(api_game_webhook_upsert))
        .route("/api/game-webhooks/delete", post(api_game_webhook_delete))
        .route("/api/game-webhooks/test", post(api_game_webhook_test))
        .route("/api/ai-bot/config", post(api_ai_bot_config))
        .route("/api/ai-bot/recap", post(api_ai_bot_recap))
        .route("/api/auth/url", get(api_auth_url))
        .route("/auth/callback", get(api_auth_callback))
        .route("/api/platforms/connect", post(api_platforms_connect))
        .route("/api/platforms/disconnect", post(api_platforms_disconnect))
        .route("/api/emotes/fetch", post(api_emotes_fetch))
        .route("/api/bot/commands", post(api_bot_commands_replace))
        .route("/api/bot/commands/upsert", post(api_bot_command_upsert))
        .route("/api/bot/commands/delete", post(api_bot_command_delete))
        .route("/api/bot/timers", post(api_bot_timers_replace))
        .route("/api/bot/timers/upsert", post(api_bot_timer_upsert))
        .route("/api/bot/moderation", post(api_bot_moderation))
        .route("/api/bot/shop", post(api_bot_shop_replace))
        .route("/api/bot/shop/redeem", post(api_bot_shop_redeem))
        .route("/api/bot/channel-points", post(api_bot_channel_points_replace))
        .route("/api/bot/channel-points/trigger", post(api_bot_channel_points_trigger))
        .route("/api/bot/trivia", post(api_bot_trivia))
        .route("/api/profile/export", get(api_export_profile))
        .route("/api/profile/import", post(api_import_profile))
        .route("/api/profile/reset", post(api_reset_profile))
        .route("/api/agent", post(api_agent_prompt))
        .route("/api/whisper/toggle", post(api_whisper_toggle))
        .route("/api/whisper/emit", post(api_whisper_emit))
        .route("/api/whisper/wav", post(api_whisper_wav))
        .route("/api/counters/update", post(api_counters_update))
        .route("/api/pngtuber/config", post(api_pngtuber_config))
        .route("/api/obs/audio", post(api_obs_audio))
        .fallback_service(ServeDir::new(static_dir))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(ctx);

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("Некорректный адрес привязки сервера");

    tracing::info!("PulseCast Local запущен: http://{}", addr);
    tracing::info!("OBS Browser Source URL: http://{}/overlay", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Не удалось занять сетевой порт");
    axum::serve(listener, app)
        .await
        .expect("Критическая ошибка HTTP-сервера Axum");
}

// ============================================================================
// WebSocket-обработчик реального времени
// ============================================================================

async fn ws_handler(ws: WebSocketUpgrade, State(ctx): State<ServerContext>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_client(socket, ctx))
}

async fn handle_ws_client(socket: WebSocket, ctx: ServerContext) {
    let (mut sender, mut receiver) = socket.split();

    // Отправляем клиенту полный начальный снимок состояния
    let snapshot = ctx.state.snapshot.read().await.clone();
    if let Ok(init_json) = serde_json::to_string(&WsBroadcast::SyncState(snapshot)) {
        if sender.send(Message::Text(init_json.into())).await.is_err() {
            return;
        }
    }

    let mut rx = ctx.state.tx.subscribe();
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                if sender.send(Message::Text(json_str.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Обработка входящих команд от клиентов (например, ping или быстрые действия)
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Close(_) = msg {
            break;
        }
    }
    send_task.abort();
}

// ============================================================================
// HTTP API обработчики
// ============================================================================

async fn api_get_state(State(ctx): State<ServerContext>) -> Json<StreamSnapshot> {
    Json(ctx.state.snapshot.read().await.clone())
}

#[derive(Deserialize)]
struct DonationPayload {
    kind: Option<StreamEventKind>,
    source: Option<String>,
    username: String,
    amount: Option<f64>,
    currency: Option<String>,
    message: Option<String>,
    sound_id: Option<String>,
    tts_enabled: Option<bool>,
    media_url: Option<String>,
    media_title: Option<String>,
    media_duration_sec: Option<u64>,
}

async fn api_donation_webhook(
    State(ctx): State<ServerContext>,
    Json(body): Json<DonationPayload>,
) -> (StatusCode, Json<StreamEvent>) {
    let raw_amt = body.amount.unwrap_or(100.0).max(0.0);
    let raw_cur = body.currency.unwrap_or_else(|| "₽".to_string());
    let event = StreamEvent {
        id: Uuid::new_v4(),
        kind: body.kind.unwrap_or(StreamEventKind::Donation),
        source: body.source.unwrap_or_else(|| "DonationAlerts-Local".to_string()),
        username: if body.username.trim().is_empty() {
            "Аноним".to_string()
        } else {
            body.username.trim().to_string()
        },
        amount: raw_amt,
        currency: raw_cur.clone(),
        original_amount: Some(raw_amt),
        original_currency: Some(raw_cur),
        message: body.message.unwrap_or_default(),
        sound_id: body.sound_id.or_else(|| Some("coin".to_string())),
        tts_enabled: body.tts_enabled.unwrap_or(true),
        variation_id: None,
        media_url: body.media_url,
        media_title: body.media_title,
        media_duration_sec: body.media_duration_sec,
        created_at: Utc::now(),
    };
    process_stream_event(&ctx.state, &ctx.obs, event.clone()).await;
    ctx.state.persist_profile().await;
    (StatusCode::CREATED, Json(event))
}

#[derive(Deserialize)]
struct BridgeIngestPayload {
    raw_text: Option<String>,
    source: Option<String>,
    username: Option<String>,
    amount: Option<f64>,
    currency: Option<String>,
    message: Option<String>,
    kind: Option<StreamEventKind>,
}

/// Универсальный шлюз приёма уведомлений от Userscript-наблюдателей и OCR-захвата экрана.
async fn api_bridge_ingest(
    State(ctx): State<ServerContext>,
    Json(body): Json<BridgeIngestPayload>,
) -> Json<Value> {
    let dedup_key = if let Some(raw) = &body.raw_text {
        format!("{}:{}", body.source.as_deref().unwrap_or("auto"), raw)
    } else {
        format!(
            "{}:{}:{}:{}",
            body.source.as_deref().unwrap_or("bridge"),
            body.username.as_deref().unwrap_or(""),
            body.amount.unwrap_or(0.0),
            body.message.as_deref().unwrap_or("")
        )
    };

    if !ctx.dedup.check_and_record(&dedup_key).await {
        return Json(json!({ "ok": true, "deduplicated": true }));
    }

    let event = if let Some(raw) = &body.raw_text {
        let rules = { ctx.state.snapshot.read().await.parser_rules.clone() };
        parse_raw_alert(raw, body.source.as_deref(), &rules)
    } else {
        body.username.map(|u| {
            let amt = body.amount.unwrap_or(100.0);
            let cur = body.currency.clone().unwrap_or_else(|| "₽".to_string());
            StreamEvent {
                id: Uuid::new_v4(),
                kind: body.kind.clone().unwrap_or(StreamEventKind::Donation),
                source: body.source.clone().unwrap_or_else(|| "External-Bridge".to_string()),
                username: u,
                amount: amt,
                currency: cur.clone(),
                original_amount: Some(amt),
                original_currency: Some(cur),
                message: body.message.clone().unwrap_or_default(),
                sound_id: None,
                tts_enabled: true,
                variation_id: None,
                media_url: None,
                media_title: None,
                media_duration_sec: None,
                created_at: Utc::now(),
            }
        })
    };

    if let Some(ev) = event {
        process_stream_event(&ctx.state, &ctx.obs, ev.clone()).await;
        ctx.state.persist_profile().await;
        Json(json!({ "ok": true, "deduplicated": false, "event": ev }))
    } else {
        Json(json!({ "ok": false, "error": "Текст не совпал ни с одним правилом парсера" }))
    }
}

async fn broadcast_customization(state: &Arc<AppState>) {
    let payload = {
        let g = state.snapshot.read().await;
        WsBroadcast::CustomizationUpdated {
            goals: g.goals.clone(),
            parser_rules: g.parser_rules.clone(),
            media_assets: g.media_assets.clone(),
            alert_variations: g.alert_variations.clone(),
            feed_config: g.feed_config.clone(),
            custom_elements: g.custom_elements.clone(),
            scenarios: g.scenarios.clone(),
        }
    };
    let _ = state.tx.send(payload);
    state.persist_profile().await;
}

async fn api_save_parser_rules(
    State(ctx): State<ServerContext>,
    Json(rules): Json<Vec<BridgeParserRule>>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.parser_rules = rules;
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct AssetUploadPayload {
    name: String,
    mime_type: String,
    data_base64: Option<String>,
    external_url: Option<String>,
}

async fn api_upload_asset(
    State(ctx): State<ServerContext>,
    Json(body): Json<AssetUploadPayload>,
) -> Json<Value> {
    if let Some(url) = body.external_url.filter(|u| !u.trim().is_empty()) {
        let asset = crate::state::MediaAsset {
            id: Uuid::new_v4().to_string(),
            name: body.name,
            kind: if body.mime_type.starts_with("audio/") { "audio".to_string() } else { "image".to_string() },
            mime_type: body.mime_type,
            url,
            created_at: Utc::now(),
        };
        {
            let mut guard = ctx.state.snapshot.write().await;
            guard.media_assets.push(asset.clone());
        }
        broadcast_customization(&ctx.state).await;
        return Json(json!({ "ok": true, "asset": asset }));
    }

    if let Some(b64) = body.data_base64 {
        let raw_b64 = b64.split(',').next_back().unwrap_or(&b64);
        if let Ok(decoded) = decode_base64_simple(raw_b64) {
            match save_media_asset_bytes(&ctx.assets_dir, &body.name, &body.mime_type, &decoded) {
                Ok(asset) => {
                    {
                        let mut guard = ctx.state.snapshot.write().await;
                        guard.media_assets.push(asset.clone());
                    }
                    broadcast_customization(&ctx.state).await;
                    return Json(json!({ "ok": true, "asset": asset }));
                }
                Err(err) => return Json(json!({ "ok": false, "error": err })),
            }
        }
    }
    Json(json!({ "ok": false, "error": "Передайте файл или URL ассета" }))
}

#[derive(Deserialize)]
struct DeleteIdPayload {
    id: String,
}

async fn api_delete_asset(State(ctx): State<ServerContext>, Json(body): Json<DeleteIdPayload>) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.media_assets.retain(|a| a.id != body.id);
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_save_alert_variations(
    State(ctx): State<ServerContext>,
    Json(vars): Json<Vec<AlertVariation>>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.alert_variations = vars;
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_save_goals(State(ctx): State<ServerContext>, Json(goals): Json<Vec<GoalWidget>>) -> Json<Value> {
    let (goal, subathon, boss, poll, giveaway) = {
        let mut guard = ctx.state.snapshot.write().await;
        guard.goals = goals;
        if let Some(first) = guard.goals.first() {
            guard.goal = first.clone();
        }
        (
            guard.goal.clone(),
            guard.subathon.clone(),
            guard.stream_boss.clone(),
            guard.poll.clone(),
            guard.giveaway.clone(),
        )
    };
    let _ = ctx.state.tx.send(WsBroadcast::EngagementUpdated {
        goal,
        subathon,
        stream_boss: boss,
        poll,
        giveaway,
    });
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_save_scenarios(
    State(ctx): State<ServerContext>,
    Json(scenarios): Json<Vec<AutomationScenario>>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.scenarios = scenarios;
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_save_feed_config(
    State(ctx): State<ServerContext>,
    Json(cfg): Json<FeedConfig>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.feed_config = cfg;
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_save_custom_elements(
    State(ctx): State<ServerContext>,
    Json(elems): Json<Vec<CustomOverlayElement>>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.custom_elements = elems;
    }
    broadcast_customization(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_replay_event(State(ctx): State<ServerContext>, Json(body): Json<DeleteIdPayload>) -> Json<Value> {
    let found = {
        let guard = ctx.state.snapshot.read().await;
        guard.recent_events.iter().find(|e| e.id.to_string() == body.id).cloned()
    };
    if let Some(ev) = found {
        let _ = ctx.state.tx.send(WsBroadcast::NewEvent(ev));
        return Json(json!({ "ok": true }));
    }
    Json(json!({ "ok": false, "error": "Событие не найдено" }))
}

fn decode_base64_simple(input: &str) -> Result<Vec<u8>, ()> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [255u8; 256];
    for (i, &b) in TABLE.iter().enumerate() {
        rev[b as usize] = i as u8;
    }
    let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity((clean.len() * 3) / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in clean {
        if b == b'=' {
            break;
        }
        let v = rev[b as usize];
        if v == 255 {
            return Err(());
        }
        buf = (buf << 6) | (v as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ChatIngestPayload {
    platform: Option<ChatPlatform>,
    username: String,
    role: Option<ViewerRole>,
    text: String,
}

async fn api_chat_ingest(
    State(ctx): State<ServerContext>,
    Json(body): Json<ChatIngestPayload>,
) -> impl IntoResponse {
    match process_incoming_chat(
        &ctx.state,
        &ctx.obs,
        body.platform.unwrap_or(ChatPlatform::Local),
        body.username,
        body.role.unwrap_or(ViewerRole::Viewer),
        body.text,
    )
    .await
    {
        Ok(msg) => (StatusCode::OK, Json(json!({ "ok": true, "message": msg }))),
        Err(reason) => (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": reason }))),
    }
}

#[derive(Deserialize)]
struct ScenePayload {
    scene: String,
}

async fn api_change_scene(State(ctx): State<ServerContext>, Json(body): Json<ScenePayload>) -> Json<Value> {
    let synced = ctx.obs.set_scene(&body.scene, &ctx.state).await;
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.obs.active_scene = body.scene.clone();
    }
    let _ = ctx.state.tx.send(WsBroadcast::SceneChanged {
        scene: body.scene.clone(),
        obs_synced: synced,
    });
    ctx.state.push_log("info", "scene", format!("Активная сцена: {}", body.scene)).await;
    Json(json!({ "ok": true, "scene": body.scene, "obs_synced": synced }))
}

#[derive(Deserialize)]
struct DeckTriggerPayload {
    button_id: String,
}

async fn api_deck_trigger(
    State(ctx): State<ServerContext>,
    Json(body): Json<DeckTriggerPayload>,
) -> Json<Value> {
    let btn = {
        let guard = ctx.state.snapshot.read().await;
        guard.deck_buttons.iter().find(|b| b.id == body.button_id).cloned()
    };
    let Some(button) = btn else {
        return Json(json!({ "ok": false, "error": "Кнопка не найдена" }));
    };

    let calls = vec![(button.action.clone(), button.payload.clone())];
    // Маппим сокращённый action кнопки на инструмент агента
    let mapped: Vec<(String, Value)> = calls
        .into_iter()
        .map(|(a, p)| match a.as_str() {
            "trigger_plugin" => ("trigger_plugin_effect".to_string(), json!({ "plugin_id": p["plugin_id"], "payload": p })),
            other => (other.to_string(), p),
        })
        .collect();
    let executed = crate::agent::execute_tool_calls(&ctx.state, &ctx.obs, &ctx.whisper, mapped).await;
    Json(json!({ "ok": true, "executed": executed }))
}

#[derive(Deserialize)]
struct SoundPayload {
    sound_id: String,
}

async fn api_play_sound(State(ctx): State<ServerContext>, Json(body): Json<SoundPayload>) -> Json<Value> {
    let sound = {
        let guard = ctx.state.snapshot.read().await;
        guard.sounds.iter().find(|s| s.id == body.sound_id).cloned()
    };
    if let Some(s) = sound {
        let _ = ctx.state.tx.send(WsBroadcast::PlaySound {
            sound_id: s.id,
            name: s.name.clone(),
            freq_hz: s.freq_hz,
            pattern: s.pattern,
            volume: s.volume,
        });
        Json(json!({ "ok": true, "sound": s.name }))
    } else {
        Json(json!({ "ok": false, "error": "Звук не найден" }))
    }
}

#[derive(Deserialize)]
struct PollManagePayload {
    active: bool,
    question: Option<String>,
    options: Option<Vec<String>>,
}

async fn api_manage_poll(State(ctx): State<ServerContext>, Json(body): Json<PollManagePayload>) -> Json<Value> {
    let (goal, subathon, boss, poll, giveaway) = {
        let mut guard = ctx.state.snapshot.write().await;
        guard.poll.active = body.active;
        if let Some(q) = body.question {
            guard.poll.question = q;
        }
        if let Some(opts) = body.options {
            guard.poll.options = opts
                .into_iter()
                .enumerate()
                .map(|(i, label)| PollOption {
                    id: (i + 1).to_string(),
                    label,
                    votes: 0,
                })
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
    let _ = ctx.state.tx.send(WsBroadcast::EngagementUpdated {
        goal,
        subathon,
        stream_boss: boss,
        poll: poll.clone(),
        giveaway,
    });
    Json(json!({ "ok": true, "poll": poll }))
}

#[derive(Deserialize)]
struct VotePayload {
    option_id: String,
}

async fn api_vote_poll(State(ctx): State<ServerContext>, Json(body): Json<VotePayload>) -> Json<Value> {
    let (goal, subathon, boss, poll, giveaway) = {
        let mut guard = ctx.state.snapshot.write().await;
        if let Some(opt) = guard.poll.options.iter_mut().find(|o| o.id == body.option_id) {
            opt.votes += 1;
        }
        (
            guard.goal.clone(),
            guard.subathon.clone(),
            guard.stream_boss.clone(),
            guard.poll.clone(),
            guard.giveaway.clone(),
        )
    };
    let _ = ctx.state.tx.send(WsBroadcast::EngagementUpdated {
        goal,
        subathon,
        stream_boss: boss,
        poll: poll.clone(),
        giveaway,
    });
    Json(json!({ "ok": true, "poll": poll }))
}

async fn api_spin_wheel(State(ctx): State<ServerContext>) -> Json<Value> {
    let segments = { ctx.state.snapshot.read().await.wheel_segments.clone() };
    if segments.is_empty() {
        return Json(json!({ "ok": false, "error": "Нет секторов колеса" }));
    }
    let idx = (Utc::now().timestamp_subsec_nanos() as usize) % segments.len();
    let label = segments[idx].label.clone();
    let _ = ctx.state.tx.send(WsBroadcast::WheelSpin {
        winner_index: idx,
        winner_label: label.clone(),
    });
    ctx.state.push_log("info", "wheel", format!("Колесо фортуны выбрало: {}", label)).await;
    Json(json!({ "ok": true, "winner_index": idx, "winner_label": label }))
}

#[derive(Deserialize)]
struct GiveawayPayload {
    action: String,
    prize: Option<String>,
    keyword: Option<String>,
}

async fn api_manage_giveaway(State(ctx): State<ServerContext>, Json(body): Json<GiveawayPayload>) -> Json<Value> {
    let executed = crate::agent::execute_tool_calls(
        &ctx.state,
        &ctx.obs,
        &ctx.whisper,
        vec![("manage_giveaway".to_string(), json!({
            "action": body.action,
            "prize": body.prize,
            "keyword": body.keyword,
        }))],
    )
    .await;
    Json(json!({ "ok": true, "result": executed }))
}

#[derive(Deserialize)]
struct ClipPayload {
    title: Option<String>,
    author: Option<String>,
}

async fn api_mark_clip(State(ctx): State<ServerContext>, Json(body): Json<ClipPayload>) -> Json<ClipMarker> {
    let _ = ctx.obs.save_replay_buffer().await;
    let elapsed = {
        let guard = ctx.state.snapshot.read().await;
        (Utc::now() - guard.stream_started_at).num_seconds().max(0) as u64
    };
    let clip = ClipMarker {
        id: Uuid::new_v4(),
        title: body.title.unwrap_or_else(|| "Хайлайт эфира".to_string()),
        author: body.author.unwrap_or_else(|| "Стример".to_string()),
        stream_elapsed_sec: elapsed,
        created_at: Utc::now(),
    };
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.clip_markers.push_back(clip.clone());
    }
    let _ = ctx.state.tx.send(WsBroadcast::ClipMarked(clip.clone()));
    ctx.state.persist_profile().await;
    Json(clip)
}

#[derive(Deserialize)]
struct MinigamePayload {
    kind: MiniGameKind,
    initiator: Option<String>,
}

async fn api_start_minigame(State(ctx): State<ServerContext>, Json(body): Json<MinigamePayload>) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.arena.active_minigame = body.kind.clone();
        if body.kind == MiniGameKind::BossFight {
            guard.arena.boss_hp = guard.arena.boss_max_hp;
        }
    }
    let _ = ctx.state.tx.send(WsBroadcast::MinigameStarted {
        kind: body.kind.clone(),
        initiator: body.initiator.unwrap_or_else(|| "Пульт".to_string()),
        details: json!({}),
    });
    Json(json!({ "ok": true, "kind": body.kind }))
}

#[derive(Deserialize)]
struct AvatarActionPayload {
    username: String,
    action: String,
    target: Option<String>,
}

async fn api_avatar_action(State(ctx): State<ServerContext>, Json(body): Json<AvatarActionPayload>) -> Json<Value> {
    let _ = ctx.state.tx.send(WsBroadcast::AvatarAction {
        username: body.username,
        action: body.action,
        target: body.target,
        text: None,
    });
    Json(json!({ "ok": true }))
}

async fn api_upsert_plugin(State(ctx): State<ServerContext>, Json(plugin): Json<OverlayPlugin>) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        if let Some(existing) = guard.plugins.iter_mut().find(|p| p.id == plugin.id) {
            *existing = plugin.clone();
        } else {
            guard.plugins.push(plugin.clone());
        }
    }
    let _ = ctx.state.tx.send(WsBroadcast::PluginUpdated(plugin.clone()));
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true, "plugin": plugin }))
}

#[derive(Deserialize)]
struct PluginTogglePayload {
    plugin_id: String,
    enabled: bool,
}

async fn api_toggle_plugin(State(ctx): State<ServerContext>, Json(body): Json<PluginTogglePayload>) -> Json<Value> {
    let updated = {
        let mut guard = ctx.state.snapshot.write().await;
        if let Some(p) = guard.plugins.iter_mut().find(|p| p.id == body.plugin_id) {
            p.enabled = body.enabled;
            Some(p.clone())
        } else {
            None
        }
    };
    if let Some(p) = updated {
        let _ = ctx.state.tx.send(WsBroadcast::PluginUpdated(p.clone()));
        ctx.state.persist_profile().await;
        Json(json!({ "ok": true, "plugin": p }))
    } else {
        Json(json!({ "ok": false, "error": "Плагин не найден" }))
    }
}

#[derive(Deserialize)]
struct PluginTriggerPayload {
    plugin_id: String,
    data: Option<Value>,
}

async fn api_trigger_plugin(State(ctx): State<ServerContext>, Json(body): Json<PluginTriggerPayload>) -> Json<Value> {
    let _ = ctx.state.tx.send(WsBroadcast::PluginTriggered {
        plugin_id: body.plugin_id,
        data: body.data.unwrap_or_else(|| json!({ "burst": 45 })),
    });
    Json(json!({ "ok": true }))
}

async fn api_update_layouts(
    State(ctx): State<ServerContext>,
    Json(layouts): Json<Vec<WidgetLayoutConfig>>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.layouts = layouts.clone();
    }
    let _ = ctx.state.tx.send(WsBroadcast::LayoutUpdated(layouts));
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true }))
}

async fn api_upsert_theme(State(ctx): State<ServerContext>, Json(theme): Json<ThemeConfig>) -> Json<Value> {
    let (d, o, themes) = {
        let mut guard = ctx.state.snapshot.write().await;
        if let Some(t) = guard.themes.iter_mut().find(|t| t.id == theme.id) {
            *t = theme.clone();
        } else {
            guard.themes.push(theme.clone());
        }
        if theme.target == "dashboard" {
            guard.active_dashboard_theme = theme.id.clone();
        } else {
            guard.active_overlay_theme = theme.id.clone();
        }
        (
            guard.active_dashboard_theme.clone(),
            guard.active_overlay_theme.clone(),
            guard.themes.clone(),
        )
    };
    let _ = ctx.state.tx.send(WsBroadcast::ThemeChanged {
        dashboard_theme: d,
        overlay_theme: o,
        themes,
    });
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct SelectThemePayload {
    target: String,
    theme_id: String,
}

async fn api_select_theme(State(ctx): State<ServerContext>, Json(body): Json<SelectThemePayload>) -> Json<Value> {
    let (d, o, themes) = {
        let mut guard = ctx.state.snapshot.write().await;
        if body.target == "dashboard" {
            guard.active_dashboard_theme = body.theme_id;
        } else {
            guard.active_overlay_theme = body.theme_id;
        }
        (
            guard.active_dashboard_theme.clone(),
            guard.active_overlay_theme.clone(),
            guard.themes.clone(),
        )
    };
    let _ = ctx.state.tx.send(WsBroadcast::ThemeChanged {
        dashboard_theme: d,
        overlay_theme: o,
        themes,
    });
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true }))
}

async fn api_export_profile(State(ctx): State<ServerContext>) -> Json<StreamSnapshot> {
    Json(ctx.state.snapshot.read().await.clone())
}

async fn api_import_profile(
    State(ctx): State<ServerContext>,
    Json(new_snapshot): Json<StreamSnapshot>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        *guard = new_snapshot.clone();
    }
    let _ = ctx.state.tx.send(WsBroadcast::SyncState(new_snapshot));
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct AgentPromptPayload {
    prompt: String,
    backend: Option<String>,
}

async fn api_agent_prompt(State(ctx): State<ServerContext>, Json(body): Json<AgentPromptPayload>) -> Json<Value> {
    if let Some(backend) = body.backend {
        let mut guard = ctx.state.snapshot.write().await;
        guard.llm.backend = backend;
    }
    let resp = handle_agent_prompt(&ctx.state, &ctx.obs, &ctx.whisper, &body.prompt).await;
    send_system_chat(&ctx.state, "AI-Режиссёр", ViewerRole::Agent, resp.reply.clone()).await;
    Json(json!(resp))
}

#[derive(Deserialize)]
struct WhisperTogglePayload {
    enabled: bool,
}

async fn api_whisper_toggle(State(ctx): State<ServerContext>, Json(body): Json<WhisperTogglePayload>) -> Json<Value> {
    let status = ctx.whisper.set_enabled(&ctx.state, body.enabled).await;
    Json(json!({ "ok": true, "status": status }))
}

async fn api_whisper_wav(State(ctx): State<ServerContext>, bytes: Bytes) -> Json<Value> {
    match ctx.whisper.transcribe_wav_bytes(&ctx.state, &bytes).await {
        Ok(text) => Json(json!({ "ok": true, "text": text })),
        Err(err) => Json(json!({ "ok": false, "error": err })),
    }
}

async fn api_counters_update(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let executed = crate::agent::execute_tool_calls(
        &ctx.state,
        &ctx.obs,
        &ctx.whisper,
        vec![("update_counters".to_string(), body)],
    )
    .await;
    Json(json!({ "ok": true, "executed": executed }))
}

async fn api_pngtuber_config(
    State(ctx): State<ServerContext>,
    Json(cfg): Json<crate::state::PngTuberConfig>,
) -> Json<Value> {
    let (ht, gc, pt, oa) = {
        let mut guard = ctx.state.snapshot.write().await;
        guard.pngtuber = cfg;
        (
            guard.hype_train.clone(),
            guard.game_counters.clone(),
            guard.pngtuber.clone(),
            guard.obs_audio.clone(),
        )
    };
    let _ = ctx.state.tx.send(WsBroadcast::CountersUpdated {
        hype_train: ht,
        game_counters: gc,
        pngtuber: pt.clone(),
        obs_audio: oa,
    });
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true, "pngtuber": pt }))
}

async fn api_obs_audio(
    State(ctx): State<ServerContext>,
    Json(audio): Json<crate::state::ObsAudioState>,
) -> Json<Value> {
    {
        let mut guard = ctx.state.snapshot.write().await;
        guard.obs_audio = audio.clone();
    }
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true, "obs_audio": audio }))
}

async fn broadcast_mvp(state: &Arc<AppState>) {
    let msg = {
        let g = state.snapshot.read().await;
        WsBroadcast::MvpUpdated {
            audio_mixer: g.audio_mixer.clone(),
            hotkeys: g.hotkeys.clone(),
            analytics: g.analytics.clone(),
            obs: g.obs.clone(),
            profile_last_saved_at: g.profile_last_saved_at,
        }
    };
    let _ = state.tx.send(msg);
    state.persist_profile().await;
}

async fn broadcast_seda(state: &Arc<AppState>) {
    let msg = {
        let g = state.snapshot.read().await;
        WsBroadcast::SeDaUpdated {
            media_share_config: g.media_share_config.clone(),
            media_queue: g.media_queue.clone(),
            tts_config: g.tts_config.clone(),
            prediction: g.prediction.clone(),
            last_slots_spin: g.last_slots_spin.clone(),
            ticker: g.ticker.clone(),
            fintech: g.fintech.clone(),
            game_webhooks: g.game_webhooks.clone(),
        }
    };
    let _ = state.tx.send(msg);
    state.persist_profile().await;
}

async fn broadcast_bot_and_auth(state: &Arc<AppState>) {
    let msg = {
        let g = state.snapshot.read().await;
        WsBroadcast::BotAndAuthUpdated {
            platform_connections: g.platform_connections.clone(),
            emotes: g.emotes.clone(),
            bot_commands: g.bot_commands.clone(),
            bot_timers: g.bot_timers.clone(),
            rewards_shop: g.rewards_shop.clone(),
            channel_point_mappings: g.channel_point_mappings.clone(),
            moderation: g.moderation.clone(),
            moderation_logs: g.moderation_logs.clone(),
            ai_chatbot: g.ai_chatbot.clone(),
            trivia: g.trivia.clone(),
            stream_recap: g.stream_recap.clone(),
        }
    };
    let _ = state.tx.send(msg);
    state.persist_profile().await;
}

#[derive(Deserialize)]
struct ObsConnectPayload {
    endpoint: Option<String>,
    password: Option<String>,
}

async fn api_obs_connect(
    State(ctx): State<ServerContext>,
    Json(body): Json<ObsConnectPayload>,
) -> Json<Value> {
    let ep = body.endpoint.unwrap_or_else(|| "127.0.0.1:4455".to_string());
    let res = ctx.obs.reconnect(&ep, body.password, &ctx.state).await;
    broadcast_mvp(&ctx.state).await;
    let obs = { ctx.state.snapshot.read().await.obs.clone() };
    match res {
        Ok(_) => Json(json!({ "ok": true, "obs": obs })),
        Err(err) => Json(json!({ "ok": false, "error": err, "obs": obs })),
    }
}

async fn api_obs_disconnect(State(ctx): State<ServerContext>) -> Json<Value> {
    ctx.obs.disconnect(&ctx.state, "Отключено пользователем").await;
    broadcast_mvp(&ctx.state).await;
    let obs = { ctx.state.snapshot.read().await.obs.clone() };
    Json(json!({ "ok": true, "obs": obs }))
}

async fn api_audio_mixer(
    State(ctx): State<ServerContext>,
    Json(patch): Json<Value>,
) -> Json<Value> {
    let mixer = {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(v) = patch["master_volume"].as_u64() { g.audio_mixer.master_volume = (v as u8).min(100); }
        if let Some(m) = patch["master_muted"].as_bool() { g.audio_mixer.master_muted = m; }
        if let Some(v) = patch["alerts_volume"].as_u64() { g.audio_mixer.alerts_volume = (v as u8).min(100); }
        if let Some(m) = patch["alerts_muted"].as_bool() { g.audio_mixer.alerts_muted = m; }
        if let Some(v) = patch["tts_volume"].as_u64() { g.audio_mixer.tts_volume = (v as u8).min(100); }
        if let Some(m) = patch["tts_muted"].as_bool() { g.audio_mixer.tts_muted = m; }
        if let Some(r) = patch["tts_rate"].as_f64() {
            g.audio_mixer.tts_rate = r as f32;
            g.tts_config.voice_rate = r as f32;
        }
        if let Some(p) = patch["tts_pitch"].as_f64() {
            g.audio_mixer.tts_pitch = p as f32;
            g.tts_config.voice_pitch = p as f32;
        }
        if let Some(v) = patch["media_volume"].as_u64() {
            g.audio_mixer.media_volume = (v as u8).min(100);
            g.media_share_config.volume = (v as u8).min(100);
        }
        if let Some(m) = patch["media_muted"].as_bool() { g.audio_mixer.media_muted = m; }
        g.audio_mixer.clone()
    };
    broadcast_mvp(&ctx.state).await;
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true, "audio_mixer": mixer }))
}

async fn api_save_hotkeys(
    State(ctx): State<ServerContext>,
    Json(hotkeys): Json<Vec<HotkeyBinding>>,
) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.hotkeys = hotkeys.clone();
    }
    broadcast_mvp(&ctx.state).await;
    Json(json!({ "ok": true, "hotkeys": hotkeys }))
}

async fn api_analytics_export_csv(State(ctx): State<ServerContext>) -> impl IntoResponse {
    let g = ctx.state.snapshot.read().await;
    let mut lines = vec![
        "Тип,Метка,Количество,Сумма_RUB,Источник_или_Платформа,Сообщение,Время".to_string(),
        format!(
            "Сводка,Всего сообщений,{},0,all,Пик: {} сообщ/интервал,{}",
            g.analytics.total_messages_count,
            g.analytics.peak_chat_rate_per_min,
            g.analytics.session_started_at.to_rfc3339()
        ),
        format!(
            "Сводка,Всего донатов,{},{:.2},all,Баланс FinTech: {:.2} RUB,{}",
            g.analytics.total_donations_count,
            g.analytics.total_donations_rub,
            g.fintech.balance_rub,
            Utc::now().to_rfc3339()
        ),
    ];
    for (plat, cnt) in &g.analytics.platform_breakdown {
        lines.push(format!("Платформа,{},{},0,{},,", plat, cnt, plat));
    }
    for b in &g.analytics.timeline_buckets {
        lines.push(format!(
            "Интервал,{},{},{:.2},timeline,Донатов: {},",
            b.label, b.chat_messages, b.donations_rub, b.donations_count
        ));
    }
    for ev in &g.recent_events {
        let safe_msg = format!("\"{}\"", ev.message.replace('"', "\"\""));
        let safe_user = format!("\"{}\"", ev.username.replace('"', "\"\""));
        lines.push(format!(
            "Событие,{},1,{:.2},{},{},{}",
            safe_user,
            ev.amount,
            ev.source,
            safe_msg,
            ev.created_at.to_rfc3339()
        ));
    }
    let body = format!("\u{FEFF}{}", lines.join("\n"));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"pulsecast_analytics.csv\""),
        ],
        body,
    )
}

async fn api_reset_profile(State(ctx): State<ServerContext>) -> Json<Value> {
    ctx.obs.disconnect(&ctx.state, "Профиль сброшен к настройкам по умолчанию").await;
    let fresh = ctx.state.reset_to_default().await;
    let saved_at = fresh.profile_last_saved_at;
    let _ = ctx.state.tx.send(WsBroadcast::SyncState(fresh));
    Json(json!({ "ok": true, "profile_last_saved_at": saved_at }))
}

async fn api_subathon_toggle(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let (goal, subathon, boss, poll, giveaway) = {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(run) = body["running"].as_bool() {
            g.subathon.running = run;
        }
        if let Some(add) = body["add_seconds"].as_i64() {
            g.subathon.remaining_seconds = (g.subathon.remaining_seconds as i64 + add).max(0) as u64;
        }
        (g.goal.clone(), g.subathon.clone(), g.stream_boss.clone(), g.poll.clone(), g.giveaway.clone())
    };
    let _ = ctx.state.tx.send(WsBroadcast::EngagementUpdated {
        goal,
        subathon: subathon.clone(),
        stream_boss: boss,
        poll,
        giveaway,
    });
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true, "subathon": subathon }))
}

async fn api_media_config(State(ctx): State<ServerContext>, Json(cfg): Json<MediaShareConfig>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.media_share_config = cfg;
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_media_control(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let action = body["action"].as_str().unwrap_or("");
    {
        let mut g = ctx.state.snapshot.write().await;
        match action {
            "skip" => {
                if let Some(pos) = g.media_queue.iter().position(|m| m.status == "playing" || m.status == "paused") {
                    g.media_queue[pos].status = "skipped".to_string();
                    g.media_queue[pos].remaining_sec = 0;
                }
                if g.media_share_config.auto_play {
                    if let Some(next) = g.media_queue.iter_mut().find(|m| m.status == "queued") {
                        next.status = "playing".to_string();
                    }
                }
            }
            "toggle_pause" => {
                if let Some(active) = g.media_queue.iter_mut().find(|m| m.status == "playing" || m.status == "paused") {
                    active.status = if active.status == "playing" { "paused" } else { "playing" }.to_string();
                } else if let Some(next) = g.media_queue.iter_mut().find(|m| m.status == "queued") {
                    next.status = "playing".to_string();
                }
            }
            "clear" => {
                g.media_queue.clear();
            }
            _ => {}
        }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_tts_config(State(ctx): State<ServerContext>, Json(cfg): Json<TtsConfig>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.audio_mixer.tts_rate = cfg.voice_rate;
        g.audio_mixer.tts_pitch = cfg.voice_pitch;
        g.tts_config = cfg;
    }
    broadcast_seda(&ctx.state).await;
    broadcast_mvp(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_predictions_manage(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let action = body["action"].as_str().unwrap_or("");
    {
        let mut g = ctx.state.snapshot.write().await;
        match action {
            "start" => {
                g.prediction.active = true;
                g.prediction.locked = false;
                g.prediction.winner_id = None;
                if let Some(t) = body["title"].as_str() {
                    g.prediction.title = t.to_string();
                }
                g.prediction.outcomes = vec![
                    PredictionOutcome { id: "1".to_string(), label: body["option1"].as_str().unwrap_or("Да").to_string(), pool: 0, bettors: 0 },
                    PredictionOutcome { id: "2".to_string(), label: body["option2"].as_str().unwrap_or("Нет").to_string(), pool: 0, bettors: 0 },
                ];
            }
            "lock" => g.prediction.locked = true,
            "resolve" => {
                g.prediction.active = false;
                g.prediction.locked = true;
                g.prediction.winner_id = body["winner_id"].as_str().map(str::to_string);
            }
            "cancel" => g.prediction.active = false,
            _ => {}
        }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_predictions_bet(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let oid = body["outcome_id"].as_str().unwrap_or("1");
    let wager = body["amount"].as_i64().unwrap_or(50).clamp(5, 10000);
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(o) = g.prediction.outcomes.iter_mut().find(|x| x.id == oid) {
            o.pool += wager;
            o.bettors += 1;
        }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_slots_spin(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let user = body["username"].as_str().unwrap_or("Streamer").to_string();
    let wager = body["wager"].as_i64().unwrap_or(50).clamp(5, 5000);
    let symbols = ["💎", "🍒", "⭐", "🔔", "🔥"];
    let t = Utc::now().timestamp_subsec_nanos() as usize;
    let r0 = symbols[t % symbols.len()].to_string();
    let r1 = symbols[(t / 7 + 1) % symbols.len()].to_string();
    let r2 = symbols[(t / 13 + 2) % symbols.len()].to_string();
    let mult = if r0 == r1 && r1 == r2 { if r0 == "💎" { 10 } else { 5 } } else if r0 == r1 || r1 == r2 || r0 == r2 { 2 } else { 0 };
    let spin = SlotsSpinResult {
        username: user,
        reels: [r0, r1, r2],
        wager,
        payout: wager * mult,
        multiplier: mult,
        ts: Utc::now(),
    };
    {
        let mut g = ctx.state.snapshot.write().await;
        g.last_slots_spin = Some(spin.clone());
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true, "spin": spin }))
}

async fn api_ticker_config(State(ctx): State<ServerContext>, Json(cfg): Json<TickerConfig>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.ticker = cfg;
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_fintech_config(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(m) = body["payout_method"].as_str() { g.fintech.payout_method = m.to_string(); }
        if let Some(d) = body["payout_destination"].as_str() { g.fintech.payout_destination = d.to_string(); }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_fintech_withdraw(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let req_amt = body["amount_rub"].as_f64().unwrap_or(0.0);
    let rec = {
        let mut g = ctx.state.snapshot.write().await;
        let amt = if req_amt > 0.0 { req_amt.min(g.fintech.balance_rub) } else { g.fintech.balance_rub };
        if amt < g.fintech.min_payout_rub {
            return Json(json!({ "ok": false, "error": "Минимальная сумма вывода 100 ₽" }));
        }
        g.fintech.balance_rub = (g.fintech.balance_rub - amt).max(0.0);
        let r = PayoutRecord {
            id: Uuid::new_v4().to_string(),
            amount_rub: amt,
            method: g.fintech.payout_method.clone(),
            destination: g.fintech.payout_destination.clone(),
            status: "completed".to_string(),
            created_at: Utc::now(),
        };
        g.fintech.payout_history.insert(0, r.clone());
        r
    };
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true, "payout": rec }))
}

async fn api_game_webhook_upsert(State(ctx): State<ServerContext>, Json(rule): Json<GameWebhookRule>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(ex) = g.game_webhooks.iter_mut().find(|r| r.id == rule.id) {
            *ex = rule;
        } else {
            g.game_webhooks.push(rule);
        }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_game_webhook_delete(State(ctx): State<ServerContext>, Json(body): Json<DeleteIdPayload>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.game_webhooks.retain(|r| r.id != body.id);
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_game_webhook_test(State(ctx): State<ServerContext>, Json(body): Json<DeleteIdPayload>) -> Json<Value> {
    let mut cmd = String::new();
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(r) = g.game_webhooks.iter_mut().find(|x| x.id == body.id) {
            r.trigger_count += 1;
            cmd = r.command_template.replace("{user}", "TestGamer").replace("{amount}", "500");
        }
    }
    broadcast_seda(&ctx.state).await;
    Json(json!({ "ok": true, "command": cmd }))
}

async fn api_apply_supertheme(State(ctx): State<ServerContext>, Json(body): Json<DeleteIdPayload>) -> Json<Value> {
    let (d, o, themes, layouts, star) = {
        let mut g = ctx.state.snapshot.write().await;
        let Some(pkg) = g.super_themes.iter().find(|s| s.id == body.id).cloned() else {
            return Json(json!({ "ok": false, "error": "SuperTheme не найдена" }));
        };
        let tid = format!("super_{}", pkg.id);
        let th = ThemeConfig {
            id: tid.clone(),
            name: pkg.name.clone(),
            target: "overlay".to_string(),
            mode: "dark".to_string(),
            bg_canvas: "transparent".to_string(),
            bg_surface: pkg.bg_surface,
            border_color: pkg.border_color,
            text_primary: "#F8FAFC".to_string(),
            text_muted: "#94A3B8".to_string(),
            accent_color: pkg.accent_color,
            border_radius_px: 12,
            overlay_opacity: 0.94,
        };
        if let Some(ex) = g.themes.iter_mut().find(|t| t.id == tid) { *ex = th; } else { g.themes.push(th); }
        g.active_overlay_theme = tid;
        for l in &mut g.layouts {
            if l.widget_id != "pngtuber" {
                l.wrapper_preset = pkg.wrapper_preset.clone();
            }
        }
        let mut star_out = None;
        if let Some(p) = g.plugins.iter_mut().find(|x| x.id == "starfall") {
            p.enabled = pkg.enable_starfall;
            star_out = Some(p.clone());
        }
        (g.active_dashboard_theme.clone(), g.active_overlay_theme.clone(), g.themes.clone(), g.layouts.clone(), star_out)
    };
    if let Some(p) = star { let _ = ctx.state.tx.send(WsBroadcast::PluginUpdated(p)); }
    let _ = ctx.state.tx.send(WsBroadcast::ThemeChanged { dashboard_theme: d, overlay_theme: o, themes });
    let _ = ctx.state.tx.send(WsBroadcast::LayoutUpdated(layouts));
    ctx.state.persist_profile().await;
    Json(json!({ "ok": true }))
}

async fn api_ai_bot_config(State(ctx): State<ServerContext>, Json(cfg): Json<crate::state::AiChatbotConfig>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.ai_chatbot = cfg;
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_ai_bot_recap(State(ctx): State<ServerContext>) -> Json<Value> {
    let recap = {
        let mut g = ctx.state.snapshot.write().await;
        let mins = ((Utc::now() - g.stream_started_at).num_minutes().max(1)) as u64;
        let r = StreamRecap {
            generated_at: Utc::now(),
            duration_min: mins,
            total_messages: g.chat_history.len(),
            total_donations_rub: g.analytics.total_donations_rub,
            top_chatters: g.viewers.keys().take(3).cloned().collect(),
            highlights: g.clip_markers.iter().map(|c| c.title.clone()).collect(),
            summary_text: format!(
                "Стрим длился {} мин. Сообщений: {}, донатов на {:.0} ₽.",
                mins, g.analytics.total_messages_count, g.analytics.total_donations_rub
            ),
        };
        g.stream_recap = Some(r.clone());
        r
    };
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "recap": recap }))
}

async fn api_bot_command_upsert(State(ctx): State<ServerContext>, Json(cmd): Json<crate::state::BotCommand>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(ex) = g.bot_commands.iter_mut().find(|c| c.trigger == cmd.trigger) { *ex = cmd; } else { g.bot_commands.push(cmd); }
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_bot_command_delete(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let trig = body["trigger"].as_str().unwrap_or("");
    {
        let mut g = ctx.state.snapshot.write().await;
        g.bot_commands.retain(|c| c.trigger != trig);
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_bot_timer_upsert(State(ctx): State<ServerContext>, Json(tm): Json<crate::state::BotTimer>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(ex) = g.bot_timers.iter_mut().find(|t| t.id == tm.id) { *ex = tm; } else { g.bot_timers.push(tm); }
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_bot_moderation(State(ctx): State<ServerContext>, Json(m): Json<crate::state::ModerationSettings>) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.moderation = m;
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

fn parse_chat_platform(raw: &str) -> ChatPlatform {
    match raw.to_lowercase().as_str() {
        "twitch" => ChatPlatform::Twitch,
        "youtube" => ChatPlatform::Youtube,
        "kick" => ChatPlatform::Kick,
        "vk_live" | "vklive" => ChatPlatform::VkLive,
        "goodgame" => ChatPlatform::Goodgame,
        "telegram" => ChatPlatform::Telegram,
        "tiktok" => ChatPlatform::Tiktok,
        "rutube" => ChatPlatform::Rutube,
        _ => ChatPlatform::Local,
    }
}

#[derive(Deserialize)]
struct AuthUrlQuery {
    provider: Option<String>,
    channel: Option<String>,
}

async fn api_auth_url(State(ctx): State<ServerContext>, Query(q): Query<AuthUrlQuery>) -> Json<Value> {
    let provider_str = q.provider.unwrap_or_else(|| "twitch".to_string());
    let platform = parse_chat_platform(&provider_str);
    let g = ctx.state.snapshot.read().await;
    let conn = g.platform_connections.iter().find(|c| c.platform == platform);
    let ch = q
        .channel
        .filter(|s| !s.trim().is_empty())
        .or_else(|| conn.map(|c| c.channel_name.clone()))
        .unwrap_or_else(|| "pulsecast_live".to_string());
    let cid = conn.map(|c| c.client_id.clone()).unwrap_or_default();
    let host = std::env::var("PULSECAST_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PULSECAST_PORT").unwrap_or_else(|_| "8080".to_string());
    let redirect = format!("http://{}:{}/auth/callback", host, port);

    let url = if !cid.is_empty() && provider_str == "twitch" {
        format!(
            "https://id.twitch.tv/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope=chat:read+chat:edit&state=twitch:{}",
            cid, redirect, ch
        )
    } else {
        format!("{}?provider={}&channel={}&mode=oauth_popup", redirect, provider_str, ch)
    };
    Json(json!({ "url": url, "redirect_uri": redirect }))
}

#[derive(Deserialize)]
struct AuthCallbackQuery {
    provider: Option<String>,
    channel: Option<String>,
    state: Option<String>,
}

async fn api_auth_callback(
    State(ctx): State<ServerContext>,
    Query(q): Query<AuthCallbackQuery>,
) -> Html<String> {
    let raw_state = q.state.unwrap_or_default();
    let provider = q.provider.unwrap_or_else(|| {
        raw_state.split(':').next().filter(|s| !s.is_empty()).unwrap_or("twitch").to_string()
    });
    let channel = q.channel.unwrap_or_else(|| {
        raw_state.split(':').nth(1).unwrap_or("").to_string()
    });
    let platform = parse_chat_platform(&provider);
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(c) = g.platform_connections.iter_mut().find(|p| p.platform == platform) {
            c.connected = true;
            c.auth_mode = "oauth".to_string();
            if !channel.trim().is_empty() {
                c.channel_name = channel.trim().to_string();
            }
            c.access_token_masked = "oauth2_••••••••_active".to_string();
            c.status_text = format!("Подключено по OAuth 2.0 к каналу {}", c.channel_name);
        }
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Html(format!(
        "<!DOCTYPE html><html lang=\"ru\"><body style=\"background:#0B0F17;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh\"><div><h3>Авторизация OAuth выполнена</h3><script>if(window.opener){{window.opener.postMessage({{type:'OAUTH_AUTH_SUCCESS',provider:'{}'}},'*');window.close();}}else{{window.location.href='/';}}</script></div></body></html>",
        provider
    ))
}

async fn api_platforms_connect(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let platform_str = body["platform"].as_str().unwrap_or("twitch");
    let platform = parse_chat_platform(platform_str);
    let ch = body["channel_name"].as_str().unwrap_or("").trim().to_string();
    let mode = body["auth_mode"].as_str().unwrap_or("token").to_string();
    let cid = body["client_id"].as_str().map(str::to_string);
    let tok = body["access_token"].as_str().unwrap_or("").trim().to_string();
    let relay = body["send_relay"].as_bool();

    let updated = {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(c) = g.platform_connections.iter_mut().find(|p| p.platform == platform) {
            if !ch.is_empty() {
                c.channel_name = ch;
            }
            c.auth_mode = mode;
            if let Some(id) = cid {
                c.client_id = id;
            }
            if let Some(r) = relay {
                c.send_relay = r;
            }
            if !tok.is_empty() {
                let prefix: String = tok.chars().take(4).collect();
                c.access_token_masked = format!("{}••••", prefix);
            }
            c.connected = true;
            c.status_text = format!("Подключён к {} ({})", platform_str.to_uppercase(), c.channel_name);
            Some(c.clone())
        } else {
            None
        }
    };
    broadcast_bot_and_auth(&ctx.state).await;
    match updated {
        Some(c) => Json(json!({ "ok": true, "connection": c })),
        None => Json(json!({ "ok": false, "error": "Платформа не найдена" })),
    }
}

async fn api_platforms_disconnect(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let platform = parse_chat_platform(body["platform"].as_str().unwrap_or("twitch"));
    {
        let mut g = ctx.state.snapshot.write().await;
        if let Some(c) = g.platform_connections.iter_mut().find(|p| p.platform == platform) {
            c.connected = false;
            c.status_text = "Отключено пользователем".to_string();
        }
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true }))
}

async fn api_emotes_fetch(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let _channel = body["channel"].as_str().unwrap_or("global");
    let emotes = { ctx.state.snapshot.read().await.emotes.clone() };
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "added": 0, "total": emotes.len(), "emotes": emotes }))
}

async fn api_bot_commands_replace(
    State(ctx): State<ServerContext>,
    Json(cmds): Json<Vec<crate::state::BotCommand>>,
) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.bot_commands = cmds.clone();
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "bot_commands": cmds }))
}

async fn api_bot_timers_replace(
    State(ctx): State<ServerContext>,
    Json(timers): Json<Vec<crate::state::BotTimer>>,
) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.bot_timers = timers.clone();
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "bot_timers": timers }))
}

async fn api_bot_shop_replace(
    State(ctx): State<ServerContext>,
    Json(items): Json<Vec<crate::state::RewardItem>>,
) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.rewards_shop = items.clone();
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "rewards_shop": items }))
}

async fn api_bot_shop_redeem(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let username = body["username"].as_str().unwrap_or("AlexStream").to_string();
    let reward_id = body["reward_id"].as_str().unwrap_or("");
    let item = {
        let g = ctx.state.snapshot.read().await;
        g.rewards_shop.iter().find(|r| r.id == reward_id).cloned()
    };
    let Some(item) = item else {
        return Json(json!({ "ok": false, "error": "Награда не найдена" }));
    };
    let reply = format!("🎁 @{} активировал награду «{}» ({} монет)!", username, item.title, item.cost);
    send_system_chat(&ctx.state, "PulseBot", ViewerRole::Agent, reply.clone()).await;
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "reply": reply }))
}

async fn api_bot_channel_points_replace(
    State(ctx): State<ServerContext>,
    Json(mappings): Json<Vec<crate::state::ChannelPointMapping>>,
) -> Json<Value> {
    {
        let mut g = ctx.state.snapshot.write().await;
        g.channel_point_mappings = mappings.clone();
    }
    broadcast_bot_and_auth(&ctx.state).await;
    Json(json!({ "ok": true, "channel_point_mappings": mappings }))
}

async fn api_bot_channel_points_trigger(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let id = body["id"].as_str().unwrap_or("");
    let username = body["username"].as_str().unwrap_or("KiraDev");
    let mapping = {
        let g = ctx.state.snapshot.read().await;
        g.channel_point_mappings.iter().find(|m| m.id == id).cloned()
    };
    let Some(m) = mapping else {
        return Json(json!({ "ok": false, "error": "Награда не найдена" }));
    };
    let _ = crate::agent::execute_tool_calls(
        &ctx.state,
        &ctx.obs,
        &ctx.whisper,
        vec![(m.action_kind.clone(), m.action_params.clone())],
    )
    .await;
    send_system_chat(
        &ctx.state,
        "PulseBot",
        ViewerRole::Agent,
        format!("⚡ @{} активировал награду канала «{}» ({} баллов)!", username, m.reward_title, m.cost),
    )
    .await;
    Json(json!({ "ok": true }))
}

async fn api_bot_trivia(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let trivia = {
        let mut g = ctx.state.snapshot.write().await;
        g.trivia.active = body["active"].as_bool().unwrap_or(true);
        if let Some(q) = body["question"].as_str() { g.trivia.question = q.to_string(); }
        if let Some(a) = body["answer"].as_str() { g.trivia.answer = a.to_string(); }
        if let Some(h) = body["hint"].as_str() { g.trivia.hint = h.to_string(); }
        if let Some(r) = body["reward_currency"].as_i64() { g.trivia.reward_currency = r; }
        g.trivia.winner = None;
        (g.trivia.clone(), g.arena.currency_name.clone())
    };
    broadcast_bot_and_auth(&ctx.state).await;
    if trivia.0.active {
        send_system_chat(
            &ctx.state,
            "PulseBot",
            ViewerRole::Agent,
            format!("❓ Викторина в чате! Вопрос ({} {}): {}", trivia.0.reward_currency, trivia.1, trivia.0.question),
        )
        .await;
    }
    Json(json!({ "ok": true, "trivia": trivia.0 }))
}

async fn api_whisper_emit(State(ctx): State<ServerContext>, Json(body): Json<Value>) -> Json<Value> {
    let text = body["text"].as_str().unwrap_or("").trim().to_string();
    if !text.is_empty() {
        {
            let mut g = ctx.state.snapshot.write().await;
            g.whisper.last_transcript = text.clone();
        }
        let _ = ctx.state.tx.send(WsBroadcast::Subtitle {
            text,
            is_final: true,
            timestamp: Utc::now(),
        });
    }
    Json(json!({ "ok": true }))
}


