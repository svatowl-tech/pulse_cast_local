//! Модуль состояния приложения (`AppState`) и доменных моделей PulseCast Local.
//! Содержит все структуры для эфира, донатов, мультичата, Stream Avatars,
//! RutonyChat-автоматизации, плагинов оверлея, тем оформления и персистентности.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

/// Максимальное количество хранимых сообщений чата, событий и логов в памяти.
pub const MAX_CHAT_HISTORY: usize = 200;
pub const MAX_EVENTS_HISTORY: usize = 100;
pub const MAX_LOGS_HISTORY: usize = 150;

/// Тип входящего стримингового события (донаты, подписки, фолловеры, алерты).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventKind {
    Donation,
    Subscription,
    Follow,
    Raid,
    SystemAlert,
}

/// Платформа-источник сообщения или события (модель мультичата RutonyChat).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPlatform {
    Twitch,
    Youtube,
    Kick,
    VkLive,
    Goodgame,
    Telegram,
    Tiktok,
    Rutube,
    Local,
}

/// Роль зрителя в локальной системе рангов и чата.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewerRole {
    Viewer,
    Subscriber,
    Vip,
    Moderator,
    Broadcaster,
    Agent,
}

/// Событие доната / подписки / системного алерта.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub id: Uuid,
    pub kind: StreamEventKind,
    pub source: String,
    pub username: String,
    pub amount: f64,
    pub currency: String,
    #[serde(default)]
    pub original_amount: Option<f64>,
    #[serde(default)]
    pub original_currency: Option<String>,
    pub message: String,
    pub sound_id: Option<String>,
    pub tts_enabled: bool,
    pub variation_id: Option<String>,
    #[serde(default)]
    pub media_url: Option<String>,
    #[serde(default)]
    pub media_title: Option<String>,
    #[serde(default)]
    pub media_duration_sec: Option<u64>,
    pub created_at: DateTime<Utc>,
}

/// Правило регулярного парсинга уведомлений со сторонней сцены (DonationAlerts, Boosty, SE).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeParserRule {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub enabled: bool,
    pub priority: i32,
    pub default_kind: StreamEventKind,
    pub pattern: String,
}

/// Локальный медиа-ассет (картинка, GIF, звук) в библиотеке.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaAsset {
    pub id: String,
    pub name: String,
    pub kind: String, // "image" | "audio"
    pub mime_type: String,
    pub url: String,
    pub created_at: DateTime<Utc>,
}

/// Условная вариация алерта (разные картинки, звуки, TTS и стили под сумму/источник).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertVariation {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i32,
    pub source_filter: String,
    pub event_kind: Option<StreamEventKind>,
    pub min_amount: f64,
    pub max_amount: Option<f64>,
    pub keyword: String,
    pub image_url: String,
    pub sound_url: String,
    pub sound_id: String,
    pub title_template: String,
    pub tts_template: String,
    pub duration_ms: u64,
    pub animation: String,
    pub bg_color: String,
    pub accent_color: String,
    pub text_color: String,
}

/// Настройки отображаемой ленты событий эфира.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedConfig {
    pub title: String,
    pub max_items: usize,
    pub min_amount: f64,
    pub show_time: bool,
    pub show_source: bool,
    pub row_template: String,
}

/// Произвольный кастомный элемент на оверлее (картинка, стикер или HTML/CSS-блок).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomOverlayElement {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub x_pct: f32,
    pub y_pct: f32,
    pub width_px: u32,
    pub z_index: i32,
    pub image_url: String,
    pub html: String,
    pub css: String,
}

/// Сообщение объединённого мультичата.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: Uuid,
    pub platform: ChatPlatform,
    pub username: String,
    pub role: ViewerRole,
    pub color: String,
    pub text: String,
    pub translated_text: Option<String>,
    pub is_highlighted: bool,
    pub created_at: DateTime<Utc>,
}

/// Профиль зрителя: экономика, ранги, скин и экипировка Stream Avatars.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewerProfile {
    pub username: String,
    pub platform: ChatPlatform,
    pub role: ViewerRole,
    pub currency: i64,
    pub xp: u64,
    pub rank_title: String,
    pub total_donated: f64,
    pub message_count: u64,
    pub avatar_skin: String,
    pub avatar_color: String,
    pub gear: Vec<String>,
    pub nametag: String,
    pub last_seen: DateTime<Utc>,
}

/// Активная мини-игра на арене Stream Avatars.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniGameKind {
    None,
    BattleRoyale,
    BossFight,
    StarCatch,
    Basketball,
    Duel,
    Roulette,
    Slots,
}

/// Настройки физики и состояния арены Stream Avatars.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvatarArenaState {
    pub enabled: bool,
    pub gravity: f32,
    pub move_speed: f32,
    pub avatar_scale: f32,
    pub max_avatars: usize,
    pub active_minigame: MiniGameKind,
    pub boss_hp: i64,
    pub boss_max_hp: i64,
    pub boss_name: String,
    pub currency_name: String,
    pub points_per_message: i64,
    pub platforms: Vec<ArenaPlatform>,
}

/// Платформа-препятствие на оверлее для физики аватаров.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArenaPlatform {
    pub id: String,
    pub x_pct: f32,
    pub y_pct: f32,
    pub width_pct: f32,
}

/// Цель сборов (Donation / Sub / Boosty Goal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalWidget {
    pub id: String,
    pub title: String,
    pub current: f64,
    pub target: f64,
    pub unit: String,
    pub color: String,
    pub visible: bool,
}

/// Таймер субафона (Subathon) с автодобавлением времени.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubathonState {
    pub running: bool,
    pub remaining_seconds: u64,
    pub seconds_per_100_rub: u64,
    pub seconds_per_sub: u64,
}

/// Stream Boss — геймифицированный босс донатов и сабов.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamBossState {
    pub boss_name: String,
    pub hp: f64,
    pub max_hp: f64,
    pub defeats_count: u32,
}

/// Вариант ответа в опросе зрителей.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollOption {
    pub id: String,
    pub label: String,
    pub votes: u32,
}

/// Интерактивный опрос зрителей.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollState {
    pub active: bool,
    pub question: String,
    pub options: Vec<PollOption>,
}

/// Сектор колеса фортуны (Spin Wheel).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WheelSegment {
    pub label: String,
    pub color: String,
}

/// Состояние розыгрыша (Giveaway — функционал RutonyChat).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiveawayState {
    pub active: bool,
    pub prize: String,
    pub keyword: String,
    pub participants: Vec<String>,
    pub last_winner: Option<String>,
}

/// Викторина / угадайка слов в чате (Trivia).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriviaState {
    pub active: bool,
    pub question: String,
    pub answer: String,
    pub reward_currency: i64,
    pub winner: Option<String>,
    pub hint: String,
}

/// Полоса прогресса ажиотажа (Hype Train).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypeTrainState {
    pub active: bool,
    pub level: u32,
    pub current_points: u64,
    pub goal_points: u64,
    pub remaining_seconds: u64,
}

/// Игровые счётчики смертей и побед/поражений на оверлее.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameCountersState {
    pub deaths: u32,
    pub wins: u32,
    pub losses: u32,
    pub current_game: String,
}

/// Конфигурация 2D PNGTuber-аватара с липсинком от микрофона.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PngTuberConfig {
    pub enabled: bool,
    pub name: String,
    pub emotion: String, // "idle" | "talk" | "blink" | "happy"
    pub mic_threshold: u8,
    pub talking: bool,
    pub idle_url: String,
    pub talk_url: String,
    pub blink_url: String,
    pub happy_url: String,
}

/// Состояние громкости источников звука OBS Studio.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsAudioState {
    pub mic_muted: bool,
    pub mic_volume: u8,
    pub music_volume: u8,
}

/// Маркер клипа / хайлайта (Replay / Clip Marker).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipMarker {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    pub stream_elapsed_sec: u64,
    pub created_at: DateTime<Utc>,
}

/// Кнопка локального Web Stream Deck для управления с ПК и смартфона.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckButton {
    pub id: String,
    pub label: String,
    pub action: String,
    pub payload: Value,
    pub accent: String,
}

/// Звуковой эффект локального саундборда.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundClip {
    pub id: String,
    pub name: String,
    pub freq_hz: f32,
    pub pattern: String,
    pub volume: f32,
}

/// Подключение к платформе мультичата (OAuth 2.0 или ручной токен/канал).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformConnection {
    pub platform: ChatPlatform,
    pub enabled: bool,
    pub auth_mode: String, // "oauth" | "token" | "anonymous"
    pub channel_name: String,
    pub connected: bool,
    pub client_id: String,
    pub access_token_masked: String,
    pub send_relay: bool,
    pub status_text: String,
}

/// Кастомный смайлик (7TV / BetterTTV / FrankerFaceZ / Local).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmoteEntry {
    pub code: String,
    pub provider: String, // "7tv" | "bttv" | "ffz" | "local"
    pub url: String,
    pub animated: bool,
}

/// Пользовательская команда локального чат-бота с поддержкой переменных ($user, $uptime, $count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotCommand {
    pub trigger: String,
    pub response: String,
    pub cooldown_sec: u64,
    pub enabled: bool,
    #[serde(default)]
    pub usage_count: u64,
}

/// Периодический таймер автосообщений в чат.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotTimer {
    pub id: String,
    pub name: String,
    pub message: String,
    pub interval_sec: u64,
    pub min_chat_lines: u32,
    pub enabled: bool,
}

/// Товар в магазине лояльности за внутреннюю валюту.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardItem {
    pub id: String,
    pub title: String,
    pub cost: i64,
    pub action_kind: String,
    pub action_value: String,
    pub enabled: bool,
}

/// Привязка награды за баллы канала (Channel Points) к действию в студии.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelPointMapping {
    pub id: String,
    pub platform: ChatPlatform,
    pub reward_title: String,
    pub cost: u32,
    pub action_kind: String,
    pub action_params: Value,
    pub enabled: bool,
}

/// Настройки анти-спама и модерации мультичата.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModerationSettings {
    pub block_links: bool,
    pub anti_flood_ms: u64,
    #[serde(default)]
    pub max_caps_percent: Option<u8>,
    #[serde(default)]
    pub max_emotes: Option<u8>,
    #[serde(default)]
    pub punishment: Option<String>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    pub blocked_words: Vec<String>,
    pub periodic_announcement: String,
    pub periodic_interval_sec: u64,
}

/// Запись в журнале автомодерации и ИИ-модерации.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModerationLogEntry {
    pub id: String,
    pub username: String,
    pub platform: ChatPlatform,
    pub reason: String,
    pub action: String,
    pub created_at: DateTime<Utc>,
}

/// Конфигурация ИИ-модулей чат-бота (Персона, живой диалог, умное приветствие, ИИ-модерация, перевод).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChatbotConfig {
    pub enabled: bool,
    pub persona_id: String,
    pub persona_name: String,
    pub system_prompt: String,
    pub game_context: String,
    pub conversational_reply: bool,
    pub smart_greeting: bool,
    pub ai_moderation: bool,
    pub live_translation: bool,
    pub target_language: String,
    pub auto_stream_reaction: bool,
    pub greeted_users: Vec<String>,
}

/// Итоговая сводка стрима (End-of-Stream Recap).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamRecap {
    pub generated_at: DateTime<Utc>,
    pub duration_min: u64,
    pub total_messages: usize,
    pub total_donations_rub: f64,
    pub top_chatters: Vec<String>,
    pub highlights: Vec<String>,
    pub summary_text: String,
}

/// Сценарий автоматизации RutonyChat: Триггер -> Условие -> Действия.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationScenario {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub trigger_event: String, // "donation", "chat_keyword", "subscription"
    pub condition_value: String,
    pub actions: Vec<ScenarioAction>,
}

/// Действие внутри сценария автоматизации.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioAction {
    pub kind: String, // "change_scene", "play_sound", "trigger_plugin", "avatar_action", "bot_reply"
    pub params: Value,
}

/// Кастомный плагин оверлея (Canvas 2D / DOM / CSS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub builtin: bool,
    pub z_index: i32,
    pub config: Value,
    pub hooks: Vec<String>,
    pub style_css: String,
    pub script_js: String,
}

/// Настройки расположения и визуальной обёртки виджета на оверлее.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetLayoutConfig {
    pub widget_id: String,
    pub label: String,
    pub visible: bool,
    pub x_pct: f32,
    pub y_pct: f32,
    pub scale: f32,
    pub z_index: i32,
    pub wrapper_preset: String, // "none", "neon_frame", "retro_crt", "glass_bar", "minimal_edge", "custom"
    pub custom_css: String,
}

/// Токены темы оформления (для дашборда и оверлея).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    pub id: String,
    pub name: String,
    pub target: String, // "dashboard" или "overlay"
    pub mode: String,   // "dark" или "light"
    pub bg_canvas: String,
    pub bg_surface: String,
    pub border_color: String,
    pub text_primary: String,
    pub text_muted: String,
    pub accent_color: String,
    pub border_radius_px: u16,
    pub overlay_opacity: f32,
}

/// Статус подсистемы Whisper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperStatus {
    pub enabled: bool,
    pub model_loaded: bool,
    pub audio_device_active: bool,
    pub language: String,
    pub last_transcript: String,
    pub diagnostic: String,
}

/// Статус подключения к OBS Studio (`obs-websocket` v5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsStatus {
    pub connected: bool,
    pub endpoint: String,
    pub active_scene: String,
    pub scenes: Vec<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub obs_version: Option<String>,
    #[serde(default)]
    pub password_set: bool,
}

/// Элемент очереди Media Share (YouTube / VK / Audio).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaShareItem {
    pub id: String,
    pub donor: String,
    pub amount_rub: f64,
    pub url: String,
    pub title: String,
    pub media_kind: String, // "youtube" | "vk" | "audio"
    pub duration_sec: u64,
    pub remaining_sec: u64,
    pub status: String, // "queued" | "playing" | "paused" | "done" | "skipped"
    pub created_at: DateTime<Utc>,
}

/// Конфигурация Media Share.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaShareConfig {
    pub enabled: bool,
    pub min_amount_rub: f64,
    pub max_duration_sec: u64,
    pub allow_youtube: bool,
    pub allow_vk: bool,
    pub allow_audio: bool,
    pub auto_play: bool,
    pub volume: u8,
}

impl Default for MediaShareConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_amount_rub: 100.0,
            max_duration_sec: 180,
            allow_youtube: true,
            allow_vk: true,
            allow_audio: true,
            auto_play: true,
            volume: 65,
        }
    }
}

/// Конфигурация TTS-озвучки донатов.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsConfig {
    pub enabled: bool,
    pub min_amount_rub: f64,
    pub voice_rate: f32,
    pub voice_pitch: f32,
    pub profanity_filter: bool,
    pub blocked_words: Vec<String>,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_amount_rub: 50.0,
            voice_rate: 1.02,
            voice_pitch: 1.0,
            profanity_filter: true,
            blocked_words: vec!["казино".to_string(), "скам".to_string()],
        }
    }
}

/// Исход пари (!bet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictionOutcome {
    pub id: String,
    pub label: String,
    pub pool: i64,
    pub bettors: u32,
}

/// Состояние тотализатора (!bet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictionState {
    pub active: bool,
    pub locked: bool,
    pub title: String,
    pub outcomes: Vec<PredictionOutcome>,
    pub winner_id: Option<String>,
}

impl Default for PredictionState {
    fn default() -> Self {
        Self {
            active: true,
            locked: false,
            title: "Пройдёт ли босса с первой попытки?".to_string(),
            outcomes: vec![
                PredictionOutcome { id: "1".to_string(), label: "Да, с первой!".to_string(), pool: 350, bettors: 2 },
                PredictionOutcome { id: "2".to_string(), label: "Нет, будет вайп".to_string(), pool: 200, bettors: 1 },
            ],
            winner_id: None,
        }
    }
}

/// Результат слот-машины (!slots).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotsSpinResult {
    pub username: String,
    pub reels: [String; 3],
    pub wager: i64,
    pub payout: i64,
    pub multiplier: i64,
    pub ts: DateTime<Utc>,
}

/// Настройки бегущей строки и таймера.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickerConfig {
    pub enabled: bool,
    pub mode: String, // "latest_donors" | "top_donors" | "custom"
    pub custom_text: String,
    pub countdown_active: bool,
    pub countdown_label: String,
    pub countdown_remaining_sec: u64,
}

impl Default for TickerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: "latest_donors".to_string(),
            custom_text: "Поддержка эфира: /donate · Команды чата: !bet, !slots, !top, !commands".to_string(),
            countdown_active: false,
            countdown_label: "Скоро начнём".to_string(),
            countdown_remaining_sec: 300,
        }
    }
}

/// Запись о выводе средств (FinTech).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayoutRecord {
    pub id: String,
    pub amount_rub: f64,
    pub method: String,
    pub destination: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

/// Финансовый баланс и вывод средств.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinTechState {
    pub balance_rub: f64,
    pub min_payout_rub: f64,
    pub commission_pct: f64,
    pub payout_method: String,
    pub payout_destination: String,
    pub payout_history: Vec<PayoutRecord>,
}

impl Default for FinTechState {
    fn default() -> Self {
        Self {
            balance_rub: 4200.0,
            min_payout_rub: 100.0,
            commission_pct: 3.5,
            payout_method: "СБП (Банк РФ)".to_string(),
            payout_destination: "+7 900 ***-**-42".to_string(),
            payout_history: Vec::new(),
        }
    }
}

/// Игровой вебхук / RCON правило.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameWebhookRule {
    pub id: String,
    pub name: String,
    pub game: String,
    pub event_key: String,
    pub min_amount_rub: f64,
    pub action_type: String,
    pub command_template: String,
    pub enabled: bool,
    pub trigger_count: u32,
}

/// Готовый пакет оформления SuperTheme.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuperThemePackage {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub accent_color: String,
    pub bg_surface: String,
    pub border_color: String,
    pub wrapper_preset: String,
    pub enable_starfall: bool,
}

/// 4-канальный студийный аудио-микшер (Master, Alerts/SFX, TTS, Media Share).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioAudioMixer {
    pub master_volume: u8,
    pub master_muted: bool,
    pub alerts_volume: u8,
    pub alerts_muted: bool,
    pub tts_volume: u8,
    pub tts_muted: bool,
    pub tts_rate: f32,
    pub tts_pitch: f32,
    pub media_volume: u8,
    pub media_muted: bool,
}

impl Default for StudioAudioMixer {
    fn default() -> Self {
        Self {
            master_volume: 90,
            master_muted: false,
            alerts_volume: 85,
            alerts_muted: false,
            tts_volume: 80,
            tts_muted: false,
            tts_rate: 1.02,
            tts_pitch: 1.0,
            media_volume: 65,
            media_muted: false,
        }
    }
}

/// Назначаемая глобальная горячая клавиша.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub id: String,
    pub label: String,
    pub combo: String,
    pub action_kind: String, // "deck_button" | "change_scene" | "mute_master" | "mute_alerts" | "skip_media" | "mark_clip" | "toggle_subtitles"
    pub target_id: String,
    pub enabled: bool,
}

/// Временной срез аналитики стрима.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsBucket {
    pub label: String,
    pub donations_rub: f64,
    pub donations_count: u32,
    pub chat_messages: u32,
}

/// Состояние аналитики эфира.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamAnalyticsState {
    pub session_started_at: DateTime<Utc>,
    pub total_donations_count: u32,
    pub total_donations_rub: f64,
    pub total_messages_count: u64,
    pub peak_chat_rate_per_min: u32,
    pub platform_breakdown: HashMap<String, u64>,
    pub timeline_buckets: Vec<AnalyticsBucket>,
}

impl Default for StreamAnalyticsState {
    fn default() -> Self {
        let label = Utc::now().format("%H:%M").to_string();
        Self {
            session_started_at: Utc::now(),
            total_donations_count: 0,
            total_donations_rub: 0.0,
            total_messages_count: 0,
            peak_chat_rate_per_min: 0,
            platform_breakdown: HashMap::new(),
            timeline_buckets: vec![AnalyticsBucket {
                label,
                donations_rub: 0.0,
                donations_count: 0,
                chat_messages: 0,
            }],
        }
    }
}

/// Конфигурация локальной LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub backend: String, // "http" или "embedded"
    pub server_url: String,
    pub model_name: String,
    pub model_path: String,
}

/// Запись структурированного журнала событий.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLogEntry {
    pub id: Uuid,
    pub level: String,
    pub module: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

/// Снимок состояния эфира, отдаваемый при старте и синхронизации.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamSnapshot {
    pub stream_started_at: DateTime<Utc>,
    pub obs: ObsStatus,
    pub obs_audio: ObsAudioState,
    pub whisper: WhisperStatus,
    pub llm: LlmConfig,
    pub active_dashboard_theme: String,
    pub active_overlay_theme: String,
    pub themes: Vec<ThemeConfig>,
    #[serde(default = "crate::plugins::default_super_themes")]
    pub super_themes: Vec<SuperThemePackage>,
    pub goal: GoalWidget,
    pub goals: Vec<GoalWidget>,
    pub parser_rules: Vec<BridgeParserRule>,
    pub media_assets: Vec<MediaAsset>,
    pub alert_variations: Vec<AlertVariation>,
    pub feed_config: FeedConfig,
    pub custom_elements: Vec<CustomOverlayElement>,
    #[serde(default)]
    pub media_share_config: MediaShareConfig,
    #[serde(default)]
    pub media_queue: Vec<MediaShareItem>,
    #[serde(default)]
    pub tts_config: TtsConfig,
    #[serde(default)]
    pub prediction: PredictionState,
    #[serde(default)]
    pub last_slots_spin: Option<SlotsSpinResult>,
    #[serde(default)]
    pub ticker: TickerConfig,
    #[serde(default)]
    pub fintech: FinTechState,
    #[serde(default)]
    pub game_webhooks: Vec<GameWebhookRule>,
    pub subathon: SubathonState,
    pub stream_boss: StreamBossState,
    pub poll: PollState,
    pub wheel_segments: Vec<WheelSegment>,
    pub giveaway: GiveawayState,
    pub trivia: TriviaState,
    pub hype_train: HypeTrainState,
    pub game_counters: GameCountersState,
    pub pngtuber: PngTuberConfig,
    pub arena: AvatarArenaState,
    pub viewers: HashMap<String, ViewerProfile>,
    pub deck_buttons: Vec<DeckButton>,
    pub sounds: Vec<SoundClip>,
    pub platform_connections: Vec<PlatformConnection>,
    pub emotes: Vec<EmoteEntry>,
    pub bot_commands: Vec<BotCommand>,
    pub bot_timers: Vec<BotTimer>,
    pub rewards_shop: Vec<RewardItem>,
    pub channel_point_mappings: Vec<ChannelPointMapping>,
    pub moderation: ModerationSettings,
    pub moderation_logs: Vec<ModerationLogEntry>,
    pub ai_chatbot: AiChatbotConfig,
    pub stream_recap: Option<StreamRecap>,
    pub scenarios: Vec<AutomationScenario>,
    pub plugins: Vec<OverlayPlugin>,
    pub layouts: Vec<WidgetLayoutConfig>,
    pub recent_events: VecDeque<StreamEvent>,
    pub chat_history: VecDeque<ChatMessage>,
    pub clip_markers: VecDeque<ClipMarker>,
    pub logs: VecDeque<EventLogEntry>,
    #[serde(default)]
    pub audio_mixer: StudioAudioMixer,
    #[serde(default = "default_hotkeys")]
    pub hotkeys: Vec<HotkeyBinding>,
    #[serde(default)]
    pub analytics: StreamAnalyticsState,
    #[serde(default)]
    pub profile_last_saved_at: Option<DateTime<Utc>>,
}

/// Типы сообщений, рассылаемых по WebSocket всем клиентам (дашборд и OBS-оверлей).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum WsBroadcast {
    SyncState(StreamSnapshot),
    NewEvent(StreamEvent),
    ChatMessage(ChatMessage),
    Subtitle {
        text: String,
        is_final: bool,
        timestamp: DateTime<Utc>,
    },
    SceneChanged {
        scene: String,
        obs_synced: bool,
    },
    ThemeChanged {
        dashboard_theme: String,
        overlay_theme: String,
        themes: Vec<ThemeConfig>,
    },
    PlaySound {
        sound_id: String,
        name: String,
        freq_hz: f32,
        pattern: String,
        volume: f32,
    },
    AvatarAction {
        username: String,
        action: String,
        target: Option<String>,
        text: Option<String>,
    },
    MinigameStarted {
        kind: MiniGameKind,
        initiator: String,
        details: Value,
    },
    WheelSpin {
        winner_index: usize,
        winner_label: String,
    },
    PluginUpdated(OverlayPlugin),
    PluginTriggered {
        plugin_id: String,
        data: Value,
    },
    LayoutUpdated(Vec<WidgetLayoutConfig>),
    EngagementUpdated {
        goal: GoalWidget,
        subathon: SubathonState,
        stream_boss: StreamBossState,
        poll: PollState,
        giveaway: GiveawayState,
    },
    CustomizationUpdated {
        goals: Vec<GoalWidget>,
        parser_rules: Vec<BridgeParserRule>,
        media_assets: Vec<MediaAsset>,
        alert_variations: Vec<AlertVariation>,
        feed_config: FeedConfig,
        custom_elements: Vec<CustomOverlayElement>,
        scenarios: Vec<AutomationScenario>,
    },
    BotAndAuthUpdated {
        platform_connections: Vec<PlatformConnection>,
        emotes: Vec<EmoteEntry>,
        bot_commands: Vec<BotCommand>,
        bot_timers: Vec<BotTimer>,
        rewards_shop: Vec<RewardItem>,
        channel_point_mappings: Vec<ChannelPointMapping>,
        moderation: ModerationSettings,
        moderation_logs: Vec<ModerationLogEntry>,
        ai_chatbot: AiChatbotConfig,
        trivia: TriviaState,
        stream_recap: Option<StreamRecap>,
    },
    CountersUpdated {
        hype_train: HypeTrainState,
        game_counters: GameCountersState,
        pngtuber: PngTuberConfig,
        obs_audio: ObsAudioState,
    },
    SeDaUpdated {
        media_share_config: MediaShareConfig,
        media_queue: Vec<MediaShareItem>,
        tts_config: TtsConfig,
        prediction: PredictionState,
        last_slots_spin: Option<SlotsSpinResult>,
        ticker: TickerConfig,
        fintech: FinTechState,
        game_webhooks: Vec<GameWebhookRule>,
    },
    MvpUpdated {
        audio_mixer: StudioAudioMixer,
        hotkeys: Vec<HotkeyBinding>,
        analytics: StreamAnalyticsState,
        obs: ObsStatus,
        profile_last_saved_at: Option<DateTime<Utc>>,
    },
    ClipMarked(ClipMarker),
    WhisperStatusUpdated(WhisperStatus),
    LogEntry(EventLogEntry),
}

/// Стартовые горячие клавиши пульта и сцен.
pub fn default_hotkeys() -> Vec<HotkeyBinding> {
    vec![
        HotkeyBinding {
            id: "hk_scene_game".to_string(),
            label: "Сцена: Игра".to_string(),
            combo: "Alt+1".to_string(),
            action_kind: "change_scene".to_string(),
            target_id: "Gaming Capture".to_string(),
            enabled: true,
        },
        HotkeyBinding {
            id: "hk_scene_chat".to_string(),
            label: "Сцена: Чат".to_string(),
            combo: "Alt+2".to_string(),
            action_kind: "change_scene".to_string(),
            target_id: "Just Chatting".to_string(),
            enabled: true,
        },
        HotkeyBinding {
            id: "hk_starfall".to_string(),
            label: "Салют звёзд".to_string(),
            combo: "Alt+3".to_string(),
            action_kind: "deck_button".to_string(),
            target_id: "btn_starfall".to_string(),
            enabled: true,
        },
        HotkeyBinding {
            id: "hk_clip".to_string(),
            label: "Отметить клип".to_string(),
            combo: "Alt+4".to_string(),
            action_kind: "mark_clip".to_string(),
            target_id: "".to_string(),
            enabled: true,
        },
        HotkeyBinding {
            id: "hk_mute".to_string(),
            label: "Mute Мастер".to_string(),
            combo: "Alt+M".to_string(),
            action_kind: "mute_master".to_string(),
            target_id: "".to_string(),
            enabled: true,
        },
        HotkeyBinding {
            id: "hk_skip_media".to_string(),
            label: "Пропуск Media Share".to_string(),
            combo: "Alt+S".to_string(),
            action_kind: "skip_media".to_string(),
            target_id: "".to_string(),
            enabled: true,
        },
    ]
}

/// Фиксирует донат в аналитике эфира по текущему минутному интервалу.
pub fn record_analytics_donation(snapshot: &mut StreamSnapshot, amount_rub: f64) {
    snapshot.analytics.total_donations_count += 1;
    snapshot.analytics.total_donations_rub += amount_rub;
    let label = Utc::now().format("%H:%M").to_string();
    if let Some(last) = snapshot.analytics.timeline_buckets.last_mut().filter(|b| b.label == label) {
        last.donations_rub += amount_rub;
        last.donations_count += 1;
    } else {
        snapshot.analytics.timeline_buckets.push(AnalyticsBucket {
            label,
            donations_rub: amount_rub,
            donations_count: 1,
            chat_messages: 0,
        });
        if snapshot.analytics.timeline_buckets.len() > 24 {
            snapshot.analytics.timeline_buckets.remove(0);
        }
    }
}

/// Фиксирует сообщение чата в аналитике эфира и обновляет пик активности.
pub fn record_analytics_chat(snapshot: &mut StreamSnapshot, platform: &ChatPlatform) {
    snapshot.analytics.total_messages_count += 1;
    let plat_key = serde_json::to_value(platform)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "local".to_string());
    *snapshot.analytics.platform_breakdown.entry(plat_key).or_insert(0) += 1;

    let label = Utc::now().format("%H:%M").to_string();
    let count_now = if let Some(last) = snapshot.analytics.timeline_buckets.last_mut().filter(|b| b.label == label) {
        last.chat_messages += 1;
        last.chat_messages
    } else {
        snapshot.analytics.timeline_buckets.push(AnalyticsBucket {
            label,
            donations_rub: 0.0,
            donations_count: 0,
            chat_messages: 1,
        });
        if snapshot.analytics.timeline_buckets.len() > 24 {
            snapshot.analytics.timeline_buckets.remove(0);
        }
        1
    };
    if count_now > snapshot.analytics.peak_chat_rate_per_min {
        snapshot.analytics.peak_chat_rate_per_min = count_now;
    }
}

/// Разделяемое состояние всего Rust-сервера.
pub struct AppState {
    pub snapshot: RwLock<StreamSnapshot>,
    pub tx: broadcast::Sender<WsBroadcast>,
    pub profile_path: PathBuf,
    pub http_client: reqwest::Client,
}

impl AppState {
    /// Инициализирует состояние с загрузкой профиля с диска или созданием пресетов по умолчанию.
    pub fn new(profile_path: PathBuf, llm: LlmConfig, obs_endpoint: String) -> Arc<Self> {
        let (tx, _) = broadcast::channel(512);
        let mut snapshot = Self::default_snapshot(llm.clone(), obs_endpoint.clone());

        if profile_path.exists() {
            match std::fs::read_to_string(&profile_path) {
                Ok(raw) => match serde_json::from_str::<StreamSnapshot>(&raw) {
                    Ok(mut loaded) => {
                        loaded.llm = llm;
                        loaded.obs.endpoint = obs_endpoint;
                        snapshot = loaded;
                        tracing::info!("Загружен профиль кастомизации из {:?}", profile_path);
                    }
                    Err(err) => {
                        tracing::warn!("Не удалось разобрать сохранённый профиль ({}): {}", profile_path.display(), err);
                    }
                },
                Err(err) => {
                    tracing::warn!("Ошибка чтения файла профиля: {}", err);
                }
            }
        }

        Arc::new(Self {
            snapshot: RwLock::new(snapshot),
            tx,
            profile_path,
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        })
    }

    /// Асинхронно и атомарно сохраняет текущую конфигурацию и профиль на диск.
    pub async fn persist_profile(&self) {
        let now = Utc::now();
        let snapshot_clone = {
            let mut guard = self.snapshot.write().await;
            guard.profile_last_saved_at = Some(now);
            guard.clone()
        };
        let path = self.profile_path.clone();
        if let Err(err) = tokio::task::spawn_blocking(move || {
            let tmp_path = path.with_extension("json.tmp");
            let json = serde_json::to_string_pretty(&snapshot_clone)?;
            std::fs::write(&tmp_path, json)?;
            std::fs::rename(&tmp_path, &path)?;
            Ok::<_, anyhow::Error>(())
        })
        .await
        {
            tracing::error!("Ошибка фонового сохранения профиля: {}", err);
        }
    }

    /// Сбрасывает профиль к настройкам по умолчанию и сохраняет на диск.
    pub async fn reset_to_default(&self) -> StreamSnapshot {
        let (llm, endpoint) = {
            let guard = self.snapshot.read().await;
            (guard.llm.clone(), guard.obs.endpoint.clone())
        };
        let fresh = Self::default_snapshot(llm, endpoint);
        {
            let mut guard = self.snapshot.write().await;
            *guard = fresh.clone();
        }
        self.persist_profile().await;
        self.snapshot.read().await.clone()
    }

    /// Пишет событие в журнал приложения и рассылает по WebSocket.
    pub async fn push_log(&self, level: &str, module: &str, message: impl Into<String>) {
        let entry = EventLogEntry {
            id: Uuid::new_v4(),
            level: level.to_string(),
            module: module.to_string(),
            message: message.into(),
            created_at: Utc::now(),
        };
        {
            let mut guard = self.snapshot.write().await;
            if guard.logs.len() >= MAX_LOGS_HISTORY {
                guard.logs.pop_front();
            }
            guard.logs.push_back(entry.clone());
        }
        let _ = self.tx.send(WsBroadcast::LogEntry(entry));
    }

    /// Формирует стартовый профиль со всеми темами, плагинами, кнопками и виджетами.
    pub fn default_snapshot(llm: LlmConfig, obs_endpoint: String) -> StreamSnapshot {
        let themes = crate::plugins::default_themes();
        let plugins = crate::plugins::default_plugins();
        let layouts = crate::plugins::default_layouts();

        let mut viewers = HashMap::new();
        viewers.insert(
            "AlexStream".to_string(),
            ViewerProfile {
                username: "AlexStream".to_string(),
                platform: ChatPlatform::Twitch,
                role: ViewerRole::Moderator,
                currency: 1250,
                xp: 840,
                rank_title: "Хранитель эфира".to_string(),
                total_donated: 1500.0,
                message_count: 42,
                avatar_skin: "fox".to_string(),
                avatar_color: "#38BDF8".to_string(),
                gear: vec!["crown".to_string(), "visor".to_string()],
                nametag: "MOD".to_string(),
                last_seen: Utc::now(),
            },
        );
        viewers.insert(
            "KiraDev".to_string(),
            ViewerProfile {
                username: "KiraDev".to_string(),
                platform: ChatPlatform::VkLive,
                role: ViewerRole::Subscriber,
                currency: 680,
                xp: 410,
                rank_title: "Постоялец".to_string(),
                total_donated: 300.0,
                message_count: 19,
                avatar_skin: "cat".to_string(),
                avatar_color: "#F472B6".to_string(),
                gear: vec!["headphones".to_string()],
                nametag: "SUB".to_string(),
                last_seen: Utc::now(),
            },
        );

        StreamSnapshot {
            stream_started_at: Utc::now(),
            obs: ObsStatus {
                connected: false,
                endpoint: obs_endpoint,
                active_scene: "Main Studio".to_string(),
                scenes: vec![
                    "Main Studio".to_string(),
                    "Gaming Capture".to_string(),
                    "Just Chatting".to_string(),
                    "BRB Pause".to_string(),
                ],
                last_error: None,
                obs_version: None,
                password_set: false,
            },
            obs_audio: ObsAudioState {
                mic_muted: false,
                mic_volume: 92,
                music_volume: 45,
            },
            whisper: WhisperStatus {
                enabled: false,
                model_loaded: false,
                audio_device_active: false,
                language: "ru".to_string(),
                last_transcript: String::new(),
                diagnostic: "Ожидание запуска микрофона или загрузки WAV-клипа".to_string(),
            },
            llm,
            active_dashboard_theme: "studio_dark".to_string(),
            active_overlay_theme: "overlay_transparent".to_string(),
            themes,
            super_themes: crate::plugins::default_super_themes(),
            goal: GoalWidget {
                id: "goal_main".to_string(),
                title: "Новый микрофон для стримов".to_string(),
                current: 4200.0,
                target: 10000.0,
                unit: "₽".to_string(),
                color: "#2563EB".to_string(),
                visible: true,
            },
            goals: vec![
                GoalWidget {
                    id: "goal_main".to_string(),
                    title: "Новый микрофон для стримов".to_string(),
                    current: 4200.0,
                    target: 10000.0,
                    unit: "₽".to_string(),
                    color: "#2563EB".to_string(),
                    visible: true,
                },
                GoalWidget {
                    id: "goal_boosty".to_string(),
                    title: "Подписчики Boosty".to_string(),
                    current: 12.0,
                    target: 30.0,
                    unit: "сабов".to_string(),
                    color: "#F97316".to_string(),
                    visible: true,
                },
            ],
            parser_rules: crate::bridges::default_parser_rules(),
            media_assets: Vec::new(),
            alert_variations: crate::bridges::default_alert_variations(),
            feed_config: FeedConfig {
                title: "Лента эфира".to_string(),
                max_items: 8,
                min_amount: 0.0,
                show_time: true,
                show_source: true,
                row_template: "{user} · {amount} {currency}".to_string(),
            },
            custom_elements: Vec::new(),
            media_share_config: MediaShareConfig::default(),
            media_queue: Vec::new(),
            tts_config: TtsConfig::default(),
            prediction: PredictionState::default(),
            last_slots_spin: None,
            ticker: TickerConfig::default(),
            fintech: FinTechState::default(),
            game_webhooks: vec![
                GameWebhookRule {
                    id: "gw_mc_creeper".to_string(),
                    name: "Minecraft: Призвать Крипера".to_string(),
                    game: "Minecraft (RCON)".to_string(),
                    event_key: "donation".to_string(),
                    min_amount_rub: 200.0,
                    action_type: "minecraft_rcon".to_string(),
                    command_template: "/execute at @p run summon creeper ~ ~ ~ {CustomName:\"\\\"{user}\\\"\"}".to_string(),
                    enabled: true,
                    trigger_count: 0,
                },
                GameWebhookRule {
                    id: "gw_gta_chaos".to_string(),
                    name: "GTA / Unity Mod: Хаос-эффект".to_string(),
                    game: "Custom Game HTTP".to_string(),
                    event_key: "donation".to_string(),
                    min_amount_rub: 500.0,
                    action_type: "http_post".to_string(),
                    command_template: "effect=low_gravity&sender={user}&amount={amount}".to_string(),
                    enabled: true,
                    trigger_count: 0,
                },
            ],
            subathon: SubathonState {
                running: false,
                remaining_seconds: 3600,
                seconds_per_100_rub: 60,
                seconds_per_sub: 120,
            },
            stream_boss: StreamBossState {
                boss_name: "AlexStream".to_string(),
                hp: 850.0,
                max_hp: 1000.0,
                defeats_count: 0,
            },
            poll: PollState {
                active: false,
                question: "Во что играем дальше?".to_string(),
                options: vec![
                    PollOption { id: "1".to_string(), label: "Инди-рогалик".to_string(), votes: 0 },
                    PollOption { id: "2".to_string(), label: "Кодинг на Rust".to_string(), votes: 0 },
                    PollOption { id: "3".to_string(), label: "Общение с чатом".to_string(), votes: 0 },
                ],
            },
            wheel_segments: vec![
                WheelSegment { label: "+500 валюты чату".to_string(), color: "#2563EB".to_string() },
                WheelSegment { label: "Смена сцены на чат".to_string(), color: "#059669".to_string() },
                WheelSegment { label: "Звёздный дождь".to_string(), color: "#D97706".to_string() },
                WheelSegment { label: "Танец всех аватаров".to_string(), color: "#7C3AED".to_string() },
                WheelSegment { label: "Босс-рейд прямо сейчас".to_string(), color: "#DC2626".to_string() },
            ],
            giveaway: GiveawayState {
                active: false,
                prize: "Уникальная роль + корона аватару".to_string(),
                keyword: "!join".to_string(),
                participants: Vec::new(),
                last_winner: None,
            },
            trivia: TriviaState {
                active: false,
                question: "На каком языке написан высокопроизводительный нативный сервер PulseCast?".to_string(),
                answer: "rust".to_string(),
                reward_currency: 300,
                winner: None,
                hint: "Язык с крабом Феррисом".to_string(),
            },
            hype_train: HypeTrainState {
                active: true,
                level: 2,
                current_points: 680,
                goal_points: 1000,
                remaining_seconds: 240,
            },
            game_counters: GameCountersState {
                deaths: 4,
                wins: 7,
                losses: 2,
                current_game: "Elden Ring / Rust Studio".to_string(),
            },
            pngtuber: PngTuberConfig {
                enabled: true,
                name: "Кибер-Лис Pulse".to_string(),
                emotion: "idle".to_string(),
                mic_threshold: 16,
                talking: false,
                idle_url: String::new(),
                talk_url: String::new(),
                blink_url: String::new(),
                happy_url: String::new(),
            },
            arena: AvatarArenaState {
                enabled: true,
                gravity: 0.55,
                move_speed: 2.2,
                avatar_scale: 1.0,
                max_avatars: 32,
                active_minigame: MiniGameKind::None,
                boss_hp: 500,
                boss_max_hp: 500,
                boss_name: "Мега-Краб".to_string(),
                currency_name: "Пульсы".to_string(),
                points_per_message: 15,
                platforms: vec![
                    ArenaPlatform { id: "left_ledge".to_string(), x_pct: 8.0, y_pct: 78.0, width_pct: 18.0 },
                    ArenaPlatform { id: "right_ledge".to_string(), x_pct: 74.0, y_pct: 74.0, width_pct: 18.0 },
                ],
            },
            viewers,
            deck_buttons: vec![
                DeckButton {
                    id: "btn_scene_game".to_string(),
                    label: "Сцена: Игра".to_string(),
                    action: "change_scene".to_string(),
                    payload: serde_json::json!({ "scene": "Gaming Capture" }),
                    accent: "#2563EB".to_string(),
                },
                DeckButton {
                    id: "btn_scene_chat".to_string(),
                    label: "Сцена: Чат".to_string(),
                    action: "change_scene".to_string(),
                    payload: serde_json::json!({ "scene": "Just Chatting" }),
                    accent: "#059669".to_string(),
                },
                DeckButton {
                    id: "btn_starfall".to_string(),
                    label: "Салют звёзд".to_string(),
                    action: "trigger_plugin".to_string(),
                    payload: serde_json::json!({ "plugin_id": "starfall", "burst": 40 }),
                    accent: "#D97706".to_string(),
                },
                DeckButton {
                    id: "btn_sound_horn".to_string(),
                    label: "Звук: Фанфары".to_string(),
                    action: "play_sound".to_string(),
                    payload: serde_json::json!({ "sound_id": "fanfare" }),
                    accent: "#7C3AED".to_string(),
                },
                DeckButton {
                    id: "btn_clip".to_string(),
                    label: "Отметить клип".to_string(),
                    action: "mark_clip".to_string(),
                    payload: serde_json::json!({ "title": "Топовый момент" }),
                    accent: "#DC2626".to_string(),
                },
                DeckButton {
                    id: "btn_br".to_string(),
                    label: "Battle Royale".to_string(),
                    action: "start_minigame".to_string(),
                    payload: serde_json::json!({ "kind": "battle_royale" }),
                    accent: "#0EA5E9".to_string(),
                },
            ],
            sounds: vec![
                SoundClip { id: "coin".to_string(), name: "Монетка".to_string(), freq_hz: 880.0, pattern: "arpeggio".to_string(), volume: 0.6 },
                SoundClip { id: "fanfare".to_string(), name: "Фанфары".to_string(), freq_hz: 523.25, pattern: "fanfare".to_string(), volume: 0.7 },
                SoundClip { id: "alert".to_string(), name: "Оповещение".to_string(), freq_hz: 659.25, pattern: "chime".to_string(), volume: 0.65 },
                SoundClip { id: "laser".to_string(), name: "Удар / Бомба".to_string(), freq_hz: 220.0, pattern: "boom".to_string(), volume: 0.7 },
            ],
            platform_connections: vec![
                PlatformConnection {
                    platform: ChatPlatform::Twitch,
                    enabled: true,
                    auth_mode: "oauth".to_string(),
                    channel_name: "pulsecast_live".to_string(),
                    connected: false,
                    client_id: std::env::var("TWITCH_CLIENT_ID").unwrap_or_default(),
                    access_token_masked: String::new(),
                    send_relay: true,
                    status_text: "Готов к подключению (OAuth 2.0 / Twitch IRC)".to_string(),
                },
                PlatformConnection {
                    platform: ChatPlatform::Youtube,
                    enabled: true,
                    auth_mode: "oauth".to_string(),
                    channel_name: "@PulseCastStudio".to_string(),
                    connected: false,
                    client_id: std::env::var("YOUTUBE_CLIENT_ID").unwrap_or_default(),
                    access_token_masked: String::new(),
                    send_relay: true,
                    status_text: "Готов к подключению (YouTube Live Chat)".to_string(),
                },
                PlatformConnection {
                    platform: ChatPlatform::Kick,
                    enabled: true,
                    auth_mode: "token".to_string(),
                    channel_name: "pulsecast".to_string(),
                    connected: false,
                    client_id: std::env::var("KICK_CLIENT_ID").unwrap_or_default(),
                    access_token_masked: String::new(),
                    send_relay: true,
                    status_text: "Готов к подключению (Kick Chat)".to_string(),
                },
                PlatformConnection {
                    platform: ChatPlatform::VkLive,
                    enabled: true,
                    auth_mode: "token".to_string(),
                    channel_name: "pulsecast_vk".to_string(),
                    connected: false,
                    client_id: std::env::var("VK_CLIENT_ID").unwrap_or_default(),
                    access_token_masked: String::new(),
                    send_relay: true,
                    status_text: "Готов к подключению (VK Video Live)".to_string(),
                },
            ],
            emotes: Vec::new(),
            bot_commands: vec![
                BotCommand {
                    trigger: "!commands".to_string(),
                    response: "Команды для @$user: !pc, !tg, !discord, !rules, !uptime, !death, !win, !trivia, !shop, !redeem, !avatar, !dance".to_string(),
                    cooldown_sec: 5,
                    enabled: true,
                    usage_count: 14,
                },
                BotCommand {
                    trigger: "!uptime".to_string(),
                    response: "@$user, стрим идёт уже $uptime! Категория: $game (вызвано $count раз).".to_string(),
                    cooldown_sec: 10,
                    enabled: true,
                    usage_count: 8,
                },
                BotCommand {
                    trigger: "!pc".to_string(),
                    response: "@$user · Конфиг студии: Ryzen 9 7950X · RTX 4080 Super · 64 GB DDR5 · Сервер: PulseCast Rust Engine.".to_string(),
                    cooldown_sec: 15,
                    enabled: true,
                    usage_count: 23,
                },
            ],
            bot_timers: vec![
                BotTimer {
                    id: "tm_tg".to_string(),
                    name: "Напоминание про Telegram и аватаров".to_string(),
                    message: "Напоминание: пишите !commands в чат, чтобы управлять своим 2D-чоком на экране! HYPE".to_string(),
                    interval_sec: 300,
                    min_chat_lines: 2,
                    enabled: true,
                },
            ],
            rewards_shop: vec![
                RewardItem {
                    id: "rw_highlight".to_string(),
                    title: "Выделить сообщение неоном".to_string(),
                    cost: 150,
                    action_kind: "highlight_msg".to_string(),
                    action_value: "neon".to_string(),
                    enabled: true,
                },
                RewardItem {
                    id: "rw_starfall".to_string(),
                    title: "Запустить звёздный салют на экране".to_string(),
                    cost: 300,
                    action_kind: "starfall_burst".to_string(),
                    action_value: "60".to_string(),
                    enabled: true,
                },
                RewardItem {
                    id: "rw_crown".to_string(),
                    title: "Корона для аватара в чате".to_string(),
                    cost: 500,
                    action_kind: "avatar_gear".to_string(),
                    action_value: "crown".to_string(),
                    enabled: true,
                },
            ],
            channel_point_mappings: vec![
                ChannelPointMapping {
                    id: "cp_hydration".to_string(),
                    platform: ChatPlatform::Twitch,
                    reward_title: "Выпей воды / Осанка!".to_string(),
                    cost: 500,
                    action_kind: "bot_reply".to_string(),
                    action_params: serde_json::json!({ "text": "Награда за баллы канала: время выпить воды! EZ" }),
                    enabled: true,
                },
            ],
            moderation: ModerationSettings {
                block_links: true,
                anti_flood_ms: 800,
                max_caps_percent: Some(70),
                max_emotes: Some(8),
                punishment: Some("timeout".to_string()),
                timeout_seconds: Some(120),
                blocked_words: vec!["spam_link".to_string(), "casino_scam".to_string()],
                periodic_announcement: "Пишите !commands чтобы управлять своим аватаром на экране!".to_string(),
                periodic_interval_sec: 300,
            },
            moderation_logs: Vec::new(),
            ai_chatbot: AiChatbotConfig {
                enabled: true,
                persona_id: "cyber_fox".to_string(),
                persona_name: "Кибер-Лис Пульс (Напарник)".to_string(),
                system_prompt: "Ты харизматичный киберпанк-напарник стримера по имени Пульс.".to_string(),
                game_context: "Стример проходит хардкорные босс-файты в Elden Ring и тестирует движок на Rust.".to_string(),
                conversational_reply: true,
                smart_greeting: true,
                ai_moderation: true,
                live_translation: true,
                target_language: "ru".to_string(),
                auto_stream_reaction: true,
                greeted_users: vec!["AlexStream".to_string(), "KiraDev".to_string()],
            },
            stream_recap: None,
            scenarios: vec![
                AutomationScenario {
                    id: "sc_big_donate".to_string(),
                    name: "Крупный донат >= 500 ₽: Звёзды + Фанфары".to_string(),
                    enabled: true,
                    trigger_event: "donation".to_string(),
                    condition_value: "500".to_string(),
                    actions: vec![
                        ScenarioAction {
                            kind: "play_sound".to_string(),
                            params: serde_json::json!({ "sound_id": "fanfare" }),
                        },
                        ScenarioAction {
                            kind: "trigger_plugin".to_string(),
                            params: serde_json::json!({ "plugin_id": "starfall", "burst": 60 }),
                        },
                        ScenarioAction {
                            kind: "avatar_action".to_string(),
                            params: serde_json::json!({ "username": "*", "action": "dance" }),
                        },
                    ],
                },
            ],
            plugins,
            layouts,
            recent_events: VecDeque::new(),
            chat_history: VecDeque::new(),
            clip_markers: VecDeque::new(),
            logs: VecDeque::new(),
            audio_mixer: StudioAudioMixer::default(),
            hotkeys: default_hotkeys(),
            analytics: StreamAnalyticsState::default(),
            profile_last_saved_at: Some(Utc::now()),
        }
    }
}

