export type StreamEventKind = 'donation' | 'subscription' | 'follow' | 'raid' | 'system_alert';

export type ChatPlatform =
  | 'twitch'
  | 'youtube'
  | 'kick'
  | 'vk_live'
  | 'goodgame'
  | 'telegram'
  | 'tiktok'
  | 'rutube'
  | 'local';

export type ViewerRole = 'viewer' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster' | 'agent';

export type MiniGameKind =
  | 'none'
  | 'battle_royale'
  | 'boss_fight'
  | 'star_catch'
  | 'basketball'
  | 'duel'
  | 'roulette'
  | 'slots';

export interface StreamEvent {
  id: string;
  kind: StreamEventKind;
  source: string;
  username: string;
  amount: number;
  currency: string;
  original_amount?: number;
  original_currency?: string;
  media_url?: string | null;
  media_title?: string | null;
  media_duration_sec?: number;
  message: string;
  sound_id?: string | null;
  tts_enabled: boolean;
  variation_id?: string | null;
  created_at: string;
}

export type CurrencyCode = 'RUB' | 'USD' | 'EUR' | 'KZT' | 'USDT' | 'BTC';

export interface MediaShareItem {
  id: string;
  donor: string;
  amount_rub: number;
  media_url: string;
  media_kind: 'youtube' | 'vk' | 'audio';
  title: string;
  duration_sec: number;
  remaining_sec: number;
  status: 'playing' | 'queued' | 'paused' | 'skipped' | 'completed';
  created_at: string;
}

export interface MediaShareConfig {
  enabled: boolean;
  auto_play: boolean;
  min_amount_rub: number;
  seconds_per_rub: number;
  max_duration_sec: number;
  volume: number;
}

export interface TtsConfig {
  enabled: boolean;
  min_amount_rub: number;
  max_chars: number;
  voice_pitch: number;
  voice_rate: number;
  profanity_filter: boolean;
  blocked_words: string[];
}

export interface PredictionOutcome {
  id: string;
  label: string;
  pool: number;
  bettors_count: number;
  bets: Record<string, number>;
}

export interface PredictionState {
  active: boolean;
  locked: boolean;
  title: string;
  outcomes: PredictionOutcome[];
  winner_id: string | null;
}

export interface SlotsSpinResult {
  username: string;
  wager: number;
  reels: [string, string, string];
  multiplier: number;
  payout: number;
  ts: string;
}

export interface TickerConfig {
  enabled: boolean;
  speed_sec: number;
  show_top_donors: boolean;
  show_recent_events: boolean;
  custom_text: string;
  countdown_active: boolean;
  countdown_label: string;
  countdown_remaining_sec: number;
}

export interface PayoutRecord {
  id: string;
  method: 'SBP' | 'BankCard' | 'USDT_TRC20' | 'VKPay';
  destination: string;
  amount_rub: number;
  fee_rub: number;
  status: 'completed' | 'processing';
  created_at: string;
}

export interface FinTechState {
  balance_rub: number;
  daily_limit_rub: number;
  withdrawn_today_rub: number;
  exchange_rates: Record<string, number>;
  payouts: PayoutRecord[];
  donate_page_title: string;
  donate_page_bio: string;
  preset_amounts: number[];
}

export interface GameWebhookRule {
  id: string;
  name: string;
  game: string;
  enabled: boolean;
  min_amount_rub: number;
  keyword: string;
  transport: 'rcon' | 'http_webhook';
  target_url_or_host: string;
  command_or_payload: string;
  last_triggered_at: string | null;
  trigger_count: number;
}

export interface SuperThemePackage {
  id: string;
  name: string;
  category: string;
  description: string;
  accent_color: string;
  bg_surface: string;
  border_color: string;
  wrapper_preset: WidgetLayoutConfig['wrapper_preset'];
  enable_starfall: boolean;
}

export interface BridgeParserRule {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  priority: number;
  default_kind: StreamEventKind;
  pattern: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: 'image' | 'audio';
  mime_type: string;
  url: string;
  created_at: string;
}

export interface AlertVariation {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  source_filter: string;
  event_kind: StreamEventKind | null;
  min_amount: number;
  max_amount: number | null;
  keyword: string;
  image_url: string;
  sound_url: string;
  sound_id: string;
  title_template: string;
  tts_template: string;
  duration_ms: number;
  animation: 'pop' | 'slide_up' | 'zoom' | 'glitch';
  bg_color: string;
  accent_color: string;
  text_color: string;
}

export interface FeedConfig {
  title: string;
  max_items: number;
  min_amount: number;
  show_time: boolean;
  show_source: boolean;
  row_template: string;
}

export interface CustomOverlayElement {
  id: string;
  name: string;
  visible: boolean;
  x_pct: number;
  y_pct: number;
  width_px: number;
  z_index: number;
  image_url: string;
  html: string;
  css: string;
}

export interface ChatMessage {
  id: string;
  platform: ChatPlatform;
  username: string;
  role: ViewerRole;
  color: string;
  text: string;
  translated_text?: string | null;
  ai_flagged?: boolean;
  is_highlighted: boolean;
  created_at: string;
}

export interface ViewerProfile {
  username: string;
  platform: ChatPlatform;
  role: ViewerRole;
  currency: number;
  xp: number;
  rank_title: string;
  total_donated: number;
  message_count: number;
  avatar_skin: string;
  avatar_color: string;
  gear: string[];
  nametag: string;
  last_seen: string;
}

export interface ArenaPlatform {
  id: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
}

export interface AvatarArenaState {
  enabled: boolean;
  gravity: number;
  move_speed: number;
  avatar_scale: number;
  max_avatars: number;
  active_minigame: MiniGameKind;
  boss_hp: number;
  boss_max_hp: number;
  boss_name: string;
  currency_name: string;
  points_per_message: number;
  platforms: ArenaPlatform[];
}

export interface GoalWidget {
  id: string;
  title: string;
  current: number;
  target: number;
  unit: string;
  color: string;
  visible: boolean;
}

export interface SubathonState {
  running: boolean;
  remaining_seconds: number;
  seconds_per_100_rub: number;
  seconds_per_sub: number;
}

export interface StreamBossState {
  boss_name: string;
  hp: number;
  max_hp: number;
  defeats_count: number;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface PollState {
  active: boolean;
  question: string;
  options: PollOption[];
}

export interface WheelSegment {
  label: string;
  color: string;
}

export interface GiveawayState {
  active: boolean;
  prize: string;
  keyword: string;
  participants: string[];
  last_winner: string | null;
}

export interface ClipMarker {
  id: string;
  title: string;
  author: string;
  stream_elapsed_sec: number;
  created_at: string;
}

export interface DeckButton {
  id: string;
  label: string;
  action: string;
  payload: Record<string, unknown>;
  accent: string;
}

export interface SoundClip {
  id: string;
  name: string;
  freq_hz: number;
  pattern: string;
  volume: number;
}

export interface BotCommand {
  trigger: string;
  response: string;
  cooldown_sec: number;
  enabled: boolean;
  usage_count?: number;
}

export interface BotTimer {
  id: string;
  name: string;
  message: string;
  interval_sec: number;
  min_chat_lines: number;
  enabled: boolean;
}

export interface ModerationSettings {
  block_links: boolean;
  anti_flood_ms: number;
  max_caps_percent?: number;
  max_emotes?: number;
  punishment?: 'warn' | 'timeout' | 'ban';
  timeout_seconds?: number;
  blocked_words: string[];
  periodic_announcement: string;
  periodic_interval_sec: number;
}

export interface ModerationLogEntry {
  id: string;
  username: string;
  platform: ChatPlatform;
  reason: string;
  action: 'warn' | 'timeout' | 'ban';
  created_at: string;
}

export interface RewardItem {
  id: string;
  title: string;
  cost: number;
  action_kind: 'highlight_msg' | 'play_sound' | 'starfall_burst' | 'avatar_gear' | 'song_request';
  action_value: string;
  enabled: boolean;
}

export interface ChannelPointMapping {
  id: string;
  platform: ChatPlatform;
  reward_title: string;
  cost: number;
  action_kind: 'change_scene' | 'play_sound' | 'trigger_plugin' | 'avatar_action' | 'bot_reply';
  action_params: Record<string, unknown>;
  enabled: boolean;
}

export interface TriviaState {
  active: boolean;
  question: string;
  answer: string;
  reward_currency: number;
  winner: string | null;
  hint: string;
}

export interface PlatformConnection {
  platform: ChatPlatform;
  enabled: boolean;
  auth_mode: 'oauth' | 'token' | 'anonymous';
  channel_name: string;
  connected: boolean;
  client_id: string;
  access_token_masked: string;
  send_relay: boolean;
  status_text: string;
}

export interface EmoteEntry {
  code: string;
  provider: '7tv' | 'bttv' | 'ffz' | 'local';
  url: string;
  animated: boolean;
}

export interface AiChatbotConfig {
  enabled: boolean;
  persona_id: string;
  persona_name: string;
  system_prompt: string;
  game_context: string;
  conversational_reply: boolean;
  smart_greeting: boolean;
  ai_moderation: boolean;
  live_translation: boolean;
  target_language: string;
  auto_stream_reaction: boolean;
  greeted_users: string[];
}

export interface StreamRecap {
  generated_at: string;
  duration_min: number;
  total_messages: number;
  total_donations_rub: number;
  top_chatters: string[];
  highlights: string[];
  summary_text: string;
}

export interface HypeTrainState {
  active: boolean;
  level: number;
  current_points: number;
  goal_points: number;
  remaining_seconds: number;
}

export interface GameCountersState {
  deaths: number;
  wins: number;
  losses: number;
  current_game: string;
}

export interface PngTuberConfig {
  enabled: boolean;
  name: string;
  emotion: 'idle' | 'talk' | 'blink' | 'happy';
  mic_threshold: number;
  talking: boolean;
  idle_url: string;
  talk_url: string;
  blink_url: string;
  happy_url: string;
}

export interface ObsAudioState {
  mic_muted: boolean;
  mic_volume: number;
  music_volume: number;
}

export interface ScenarioAction {
  kind: string;
  params: Record<string, unknown>;
}

export interface AutomationScenario {
  id: string;
  name: string;
  enabled: boolean;
  trigger_event: string;
  condition_value: string;
  actions: ScenarioAction[];
}

export interface OverlayPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  enabled: boolean;
  builtin: boolean;
  z_index: number;
  config: Record<string, unknown>;
  hooks: string[];
  style_css: string;
  script_js: string;
}

export interface WidgetLayoutConfig {
  widget_id: string;
  label: string;
  visible: boolean;
  x_pct: number;
  y_pct: number;
  scale: number;
  z_index: number;
  wrapper_preset: 'none' | 'neon_frame' | 'retro_crt' | 'glass_bar' | 'minimal_edge' | 'custom';
  custom_css: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  target: 'dashboard' | 'overlay';
  mode: 'dark' | 'light';
  bg_canvas: string;
  bg_surface: string;
  border_color: string;
  text_primary: string;
  text_muted: string;
  accent_color: string;
  border_radius_px: number;
  overlay_opacity: number;
}

export interface WhisperStatus {
  enabled: boolean;
  model_loaded: boolean;
  audio_device_active: boolean;
  language: string;
  last_transcript: string;
  diagnostic: string;
}

export interface ObsStatus {
  connected: boolean;
  endpoint: string;
  active_scene: string;
  scenes: string[];
  last_error: string | null;
  obs_version?: string | null;
  password_set?: boolean;
}

export interface StudioAudioMixer {
  master_volume: number;
  master_muted: boolean;
  alerts_volume: number;
  alerts_muted: boolean;
  tts_volume: number;
  tts_muted: boolean;
  tts_rate: number;
  tts_pitch: number;
  media_volume: number;
  media_muted: boolean;
}

export type HotkeyActionKind =
  | 'deck_button'
  | 'change_scene'
  | 'mute_master'
  | 'mute_alerts'
  | 'skip_media'
  | 'mark_clip'
  | 'toggle_subtitles';

export interface HotkeyBinding {
  id: string;
  label: string;
  combo: string;
  action_kind: HotkeyActionKind;
  target_id: string;
  enabled: boolean;
}

export interface AnalyticsBucket {
  label: string;
  donations_rub: number;
  donations_count: number;
  chat_messages: number;
}

export interface StreamAnalyticsState {
  session_started_at: string;
  total_donations_count: number;
  total_donations_rub: number;
  total_messages_count: number;
  peak_chat_rate_per_min: number;
  platform_breakdown: Record<string, number>;
  timeline_buckets: AnalyticsBucket[];
}

export interface LlmConfig {
  backend: 'http' | 'embedded';
  server_url: string;
  model_name: string;
  model_path: string;
}

export interface EventLogEntry {
  id: string;
  level: string;
  module: string;
  message: string;
  created_at: string;
}

export interface StreamSnapshot {
  stream_started_at: string;
  obs: ObsStatus;
  obs_audio: ObsAudioState;
  whisper: WhisperStatus;
  llm: LlmConfig;
  active_dashboard_theme: string;
  active_overlay_theme: string;
  themes: ThemeConfig[];
  super_themes: SuperThemePackage[];
  goal: GoalWidget;
  goals: GoalWidget[];
  parser_rules: BridgeParserRule[];
  media_assets: MediaAsset[];
  alert_variations: AlertVariation[];
  feed_config: FeedConfig;
  custom_elements: CustomOverlayElement[];
  media_share_config: MediaShareConfig;
  media_queue: MediaShareItem[];
  tts_config: TtsConfig;
  prediction: PredictionState;
  last_slots_spin: SlotsSpinResult | null;
  ticker: TickerConfig;
  fintech: FinTechState;
  game_webhooks: GameWebhookRule[];
  subathon: SubathonState;
  stream_boss: StreamBossState;
  poll: PollState;
  wheel_segments: WheelSegment[];
  giveaway: GiveawayState;
  trivia: TriviaState;
  hype_train: HypeTrainState;
  game_counters: GameCountersState;
  pngtuber: PngTuberConfig;
  arena: AvatarArenaState;
  viewers: Record<string, ViewerProfile>;
  deck_buttons: DeckButton[];
  sounds: SoundClip[];
  platform_connections: PlatformConnection[];
  emotes: EmoteEntry[];
  bot_commands: BotCommand[];
  bot_timers: BotTimer[];
  rewards_shop: RewardItem[];
  channel_point_mappings: ChannelPointMapping[];
  moderation: ModerationSettings;
  moderation_logs: ModerationLogEntry[];
  ai_chatbot: AiChatbotConfig;
  stream_recap: StreamRecap | null;
  scenarios: AutomationScenario[];
  plugins: OverlayPlugin[];
  layouts: WidgetLayoutConfig[];
  recent_events: StreamEvent[];
  chat_history: ChatMessage[];
  clip_markers: ClipMarker[];
  logs: EventLogEntry[];
  audio_mixer: StudioAudioMixer;
  hotkeys: HotkeyBinding[];
  analytics: StreamAnalyticsState;
  profile_last_saved_at?: string;
}

export type WsBroadcast =
  | { type: 'sync_state'; payload: StreamSnapshot }
  | { type: 'new_event'; payload: StreamEvent }
  | { type: 'chat_message'; payload: ChatMessage }
  | { type: 'subtitle'; payload: { text: string; is_final: boolean; timestamp: string } }
  | { type: 'scene_changed'; payload: { scene: string; obs_synced: boolean } }
  | {
      type: 'theme_changed';
      payload: { dashboard_theme: string; overlay_theme: string; themes: ThemeConfig[] };
    }
  | {
      type: 'play_sound';
      payload: { sound_id: string; name: string; freq_hz: number; pattern: string; volume: number };
    }
  | {
      type: 'avatar_action';
      payload: { username: string; action: string; target?: string | null; text?: string | null };
    }
  | {
      type: 'minigame_started';
      payload: { kind: MiniGameKind; initiator: string; details: Record<string, unknown> };
    }
  | { type: 'wheel_spin'; payload: { winner_index: number; winner_label: string } }
  | { type: 'plugin_updated'; payload: OverlayPlugin }
  | { type: 'plugin_triggered'; payload: { plugin_id: string; data: Record<string, unknown> } }
  | { type: 'layout_updated'; payload: WidgetLayoutConfig[] }
  | {
      type: 'engagement_updated';
      payload: {
        goal: GoalWidget;
        subathon: SubathonState;
        stream_boss: StreamBossState;
        poll: state_poll_alias;
        giveaway: GiveawayState;
      };
    }
  | {
      type: 'customization_updated';
      payload: {
        goals: GoalWidget[];
        parser_rules: BridgeParserRule[];
        media_assets: MediaAsset[];
        alert_variations: AlertVariation[];
        feed_config: FeedConfig;
        custom_elements: CustomOverlayElement[];
        scenarios: AutomationScenario[];
      };
    }
  | {
      type: 'bot_and_auth_updated';
      payload: {
        platform_connections: PlatformConnection[];
        emotes: EmoteEntry[];
        bot_commands: BotCommand[];
        bot_timers: BotTimer[];
        rewards_shop: RewardItem[];
        channel_point_mappings: ChannelPointMapping[];
        moderation: ModerationSettings;
        moderation_logs: ModerationLogEntry[];
        ai_chatbot: AiChatbotConfig;
        trivia: TriviaState;
        stream_recap: StreamRecap | null;
      };
    }
  | {
      type: 'counters_updated';
      payload: {
        hype_train: HypeTrainState;
        game_counters: GameCountersState;
        pngtuber: PngTuberConfig;
        obs_audio: ObsAudioState;
      };
    }
  | {
      type: 'se_da_updated';
      payload: {
        media_share_config: MediaShareConfig;
        media_queue: MediaShareItem[];
        tts_config: TtsConfig;
        prediction: PredictionState;
        last_slots_spin: SlotsSpinResult | null;
        ticker: TickerConfig;
        fintech: FinTechState;
        game_webhooks: GameWebhookRule[];
      };
    }
  | {
      type: 'mvp_updated';
      payload: {
        audio_mixer: StudioAudioMixer;
        hotkeys: HotkeyBinding[];
        analytics: StreamAnalyticsState;
        obs: ObsStatus;
        profile_last_saved_at?: string;
      };
    }
  | { type: 'clip_marked'; payload: ClipMarker }
  | { type: 'whisper_status_updated'; payload: WhisperStatus }
  | { type: 'log_entry'; payload: EventLogEntry };

type state_poll_alias = PollState;

export interface AgentToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface AgentResponse {
  reply: string;
  backend_used: string;
  tool_calls_executed: AgentToolExecution[];
}


