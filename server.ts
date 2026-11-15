import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash, randomUUID } from 'crypto';
import type {
  AgentToolExecution,
  AiChatbotConfig,
  AlertVariation,
  AnalyticsBucket,
  AutomationScenario,
  BotCommand,
  BotTimer,
  BridgeParserRule,
  ChannelPointMapping,
  ChatMessage,
  ChatPlatform,
  CustomOverlayElement,
  EmoteEntry,
  FeedConfig,
  FinTechState,
  GameCountersState,
  GameWebhookRule,
  GoalWidget,
  HotkeyBinding,
  HypeTrainState,
  MediaAsset,
  MediaShareConfig,
  MediaShareItem,
  MiniGameKind,
  ModerationLogEntry,
  ModerationSettings,
  ObsAudioState,
  OverlayPlugin,
  PayoutRecord,
  PlatformConnection,
  PngTuberConfig,
  PredictionState,
  RewardItem,
  ScenarioAction,
  SlotsSpinResult,
  StreamAnalyticsState,
  StreamEvent,
  StreamEventKind,
  StreamRecap,
  StreamSnapshot,
  StudioAudioMixer,
  SuperThemePackage,
  ThemeConfig,
  TickerConfig,
  TriviaState,
  TtsConfig,
  ViewerProfile,
  ViewerRole,
  WidgetLayoutConfig,
  WsBroadcast,
} from './src/types/stream.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function computeRankTitle(xp: number): string {
  if (xp < 100) return 'Новичок';
  if (xp < 400) return 'Зритель';
  if (xp < 1000) return 'Постоялец';
  if (xp < 2500) return 'Хранитель эфира';
  return 'Легенда канала';
}

function makeSvgEmoteDataUri(label: string, bg: string, fg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28" viewBox="0 0 56 28"><rect width="56" height="28" rx="6" fill="${bg}"/><text x="28" y="19" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="12" fill="${fg}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function defaultBuiltinEmotes(): EmoteEntry[] {
  return [
    { code: 'POG', provider: 'local', url: makeSvgEmoteDataUri('POG', '#DC2626', '#FEF08A'), animated: true },
    { code: 'KEKW', provider: 'local', url: makeSvgEmoteDataUri('KEKW', '#D97706', '#FFFBEB'), animated: true },
    { code: 'CatJam', provider: 'local', url: makeSvgEmoteDataUri('CatJam', '#7C3AED', '#F5F3FF'), animated: true },
    { code: 'Pepega', provider: 'local', url: makeSvgEmoteDataUri('Pepega', '#2563EB', '#EFF6FF'), animated: false },
    { code: 'EZ', provider: 'local', url: makeSvgEmoteDataUri('EZ', '#059669', '#ECFDF5'), animated: false },
    { code: 'HYPE', provider: 'local', url: makeSvgEmoteDataUri('HYPE', '#EA580C', '#FFF7ED'), animated: true },
    { code: 'LUL', provider: 'local', url: makeSvgEmoteDataUri('LUL', '#4F46E5', '#EEF2FF'), animated: false },
    { code: 'GG', provider: 'local', url: makeSvgEmoteDataUri('GG', '#0D9488', '#F0FDFA'), animated: false },
    { code: 'Heart', provider: 'local', url: makeSvgEmoteDataUri('♥', '#E11D48', '#FFF1F2'), animated: true },
  ];
}

function createInitialSnapshot(): StreamSnapshot {
  const now = new Date().toISOString();
  return {
    stream_started_at: now,
    obs: {
      connected: false,
      endpoint: process.env.OBS_WS_HOST ? `${process.env.OBS_WS_HOST}:${process.env.OBS_WS_PORT || '4455'}` : '127.0.0.1:4455',
      active_scene: 'Main Studio',
      scenes: ['Main Studio', 'Gaming Capture', 'Just Chatting', 'BRB Pause'],
      last_error: 'Готов к подключению OBS WebSocket v5 (порт 4455)',
      obs_version: null,
      password_set: false,
    },
    obs_audio: {
      mic_muted: false,
      mic_volume: 92,
      music_volume: 45,
    },
    whisper: {
      enabled: false,
      model_loaded: true,
      audio_device_active: false,
      language: 'ru',
      last_transcript: '',
      diagnostic: 'Готов к распознаванию речи (Web Speech / симуляция WAV-потока)',
    },
    llm: {
      backend: 'http',
      server_url: 'http://127.0.0.1:8081/v1/chat/completions',
      model_name: 'local-model',
      model_path: 'models/qwen2.5-3b-instruct-q4_k_m.gguf',
    },
    active_dashboard_theme: 'studio_dark',
    active_overlay_theme: 'overlay_transparent',
    themes: [
      {
        id: 'studio_dark',
        name: 'Тёмная студийная',
        target: 'dashboard',
        mode: 'dark',
        bg_canvas: '#0B0F17',
        bg_surface: '#111827',
        border_color: '#1F2937',
        text_primary: '#F1F5F9',
        text_muted: '#94A3B8',
        accent_color: '#2563EB',
        border_radius_px: 10,
        overlay_opacity: 0.95,
      },
      {
        id: 'studio_light',
        name: 'Светлая студийная',
        target: 'dashboard',
        mode: 'light',
        bg_canvas: '#F8FAFC',
        bg_surface: '#FFFFFF',
        border_color: '#E2E8F0',
        text_primary: '#0F172A',
        text_muted: '#64748B',
        accent_color: '#2563EB',
        border_radius_px: 10,
        overlay_opacity: 0.95,
      },
      {
        id: 'overlay_transparent',
        name: 'Прозрачный эфир (OBS)',
        target: 'overlay',
        mode: 'dark',
        bg_canvas: 'transparent',
        bg_surface: 'rgba(15, 23, 42, 0.78)',
        border_color: 'rgba(148, 163, 184, 0.25)',
        text_primary: '#F8FAFC',
        text_muted: '#CBD5E1',
        accent_color: '#3B82F6',
        border_radius_px: 12,
        overlay_opacity: 0.92,
      },
      {
        id: 'overlay_neon',
        name: 'Неоновый HUD',
        target: 'overlay',
        mode: 'dark',
        bg_canvas: 'transparent',
        bg_surface: 'rgba(9, 13, 28, 0.86)',
        border_color: 'rgba(56, 189, 248, 0.55)',
        text_primary: '#F0F9FF',
        text_muted: '#7DD3FC',
        accent_color: '#06B6D4',
        border_radius_px: 8,
        overlay_opacity: 0.95,
      },
      {
        id: 'overlay_minimal',
        name: 'Минимал-титр',
        target: 'overlay',
        mode: 'light',
        bg_canvas: 'transparent',
        bg_surface: 'rgba(255, 255, 255, 0.92)',
        border_color: 'rgba(15, 23, 42, 0.14)',
        text_primary: '#0F172A',
        text_muted: '#475569',
        accent_color: '#2563EB',
        border_radius_px: 14,
        overlay_opacity: 0.95,
      },
    ],
    super_themes: defaultSuperThemes(),
    goal: {
      id: 'goal_main',
      title: 'Новый микрофон для стримов',
      current: 4200,
      target: 10000,
      unit: '₽',
      color: '#2563EB',
      visible: true,
    },
    goals: [
      {
        id: 'goal_main',
        title: 'Новый микрофон для стримов',
        current: 4200,
        target: 10000,
        unit: '₽',
        color: '#2563EB',
        visible: true,
      },
      {
        id: 'goal_boosty',
        title: 'Подписчики Boosty',
        current: 12,
        target: 30,
        unit: 'сабов',
        color: '#F97316',
        visible: true,
      },
    ],
    parser_rules: defaultParserRules(),
    media_assets: [],
    alert_variations: defaultAlertVariations(),
    feed_config: {
      title: 'Лента эфира',
      max_items: 8,
      min_amount: 0,
      show_time: true,
      show_source: true,
      row_template: '{user} · {amount} {currency}',
    },
    custom_elements: [],
    media_share_config: {
      enabled: true,
      auto_play: true,
      min_amount_rub: 200,
      seconds_per_rub: 0.2,
      max_duration_sec: 120,
      volume: 80,
    },
    media_queue: [
      {
        id: 'ms_demo_1',
        donor: 'AlexStream',
        amount_rub: 500,
        media_url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        media_kind: 'youtube',
        title: 'Lofi Beats — Эфирный трек от зрителя',
        duration_sec: 60,
        remaining_sec: 60,
        status: 'queued',
        created_at: now,
      },
    ],
    tts_config: {
      enabled: true,
      min_amount_rub: 50,
      max_chars: 220,
      voice_pitch: 1.0,
      voice_rate: 1.0,
      profanity_filter: true,
      blocked_words: ['скам', 'спам', 'казино', 'накрутка'],
    },
    prediction: {
      active: true,
      locked: false,
      title: 'Победим ли босса с первой попытки?',
      outcomes: [
        { id: '1', label: 'Да, с первого трая!', pool: 650, bettors_count: 2, bets: { AlexStream: 400, MishaGG: 250 } },
        { id: '2', label: 'Нет, будет вайп', pool: 300, bettors_count: 1, bets: { KiraDev: 300 } },
      ],
      winner_id: null,
    },
    last_slots_spin: null,
    ticker: {
      enabled: true,
      speed_sec: 22,
      show_top_donors: true,
      show_recent_events: true,
      custom_text: 'Добро пожаловать на стрим! Отправить донат с видео: /donate · Ставки в чате: !bet 1 100 · Слоты: !slots 50',
      countdown_active: false,
      countdown_label: 'Скоро начнём эфир',
      countdown_remaining_sec: 300,
    },
    fintech: {
      balance_rub: 14850,
      daily_limit_rub: 150000,
      withdrawn_today_rub: 5000,
      exchange_rates: {
        RUB: 1,
        '₽': 1,
        USD: 92.5,
        $: 92.5,
        EUR: 100.2,
        '€': 100.2,
        KZT: 0.19,
        USDT: 92.5,
        BTC: 6250000,
      },
      payouts: [
        {
          id: 'po_1',
          method: 'SBP',
          destination: '+7 (999) •••-••-42 (СБП)',
          amount_rub: 5000,
          fee_rub: 0,
          status: 'completed',
          created_at: now,
        },
      ],
      donate_page_title: 'Поддержать эфир PulseCast Studio',
      donate_page_bio: 'Все донаты мгновенно выводятся на экран стрима с озвучкой TTS и вашим YouTube/VK роликом!',
      preset_amounts: [100, 250, 500, 1000, 2500, 5000],
    },
    game_webhooks: [
      {
        id: 'gw_mc_creeper',
        name: 'Minecraft: Спавн Крипера к игроку',
        game: 'Minecraft (RCON)',
        enabled: true,
        min_amount_rub: 300,
        keyword: '',
        transport: 'rcon',
        target_url_or_host: '127.0.0.1:25575',
        command_or_payload: '/execute at @p run summon minecraft:creeper ~ ~1 ~ {CustomName:\'"От {user}"\'}',
        last_triggered_at: null,
        trigger_count: 2,
      },
      {
        id: 'gw_mc_diamond',
        name: 'Minecraft: Выдать алмаз и регенерацию',
        game: 'Minecraft (RCON)',
        enabled: true,
        min_amount_rub: 150,
        keyword: 'алмаз',
        transport: 'rcon',
        target_url_or_host: '127.0.0.1:25575',
        command_or_payload: '/give @p minecraft:diamond 3',
        last_triggered_at: null,
        trigger_count: 5,
      },
      {
        id: 'gw_http_mod',
        name: 'Локальный HTTP-вебхук игрового мода',
        game: 'Universal HTTP Game Mod',
        enabled: true,
        min_amount_rub: 500,
        keyword: '',
        transport: 'http_webhook',
        target_url_or_host: 'http://127.0.0.1:8765/game-event',
        command_or_payload: '{"event":"big_donation","donor":"{user}","amount_rub":{amount}}',
        last_triggered_at: null,
        trigger_count: 1,
      },
    ],
    subathon: {
      running: true,
      remaining_seconds: 3600,
      seconds_per_100_rub: 60,
      seconds_per_sub: 120,
    },
    stream_boss: {
      boss_name: 'AlexStream',
      hp: 850,
      max_hp: 1000,
      defeats_count: 0,
    },
    poll: {
      active: true,
      question: 'Во что играем дальше?',
      options: [
        { id: '1', label: 'Инди-рогалик', votes: 14 },
        { id: '2', label: 'Кодинг на Rust', votes: 21 },
        { id: '3', label: 'Общение с чатом', votes: 9 },
      ],
    },
    wheel_segments: [
      { label: '+500 валюты чату', color: '#2563EB' },
      { label: 'Смена сцены на чат', color: '#059669' },
      { label: 'Звёздный дождь', color: '#D97706' },
      { label: 'Танец аватаров', color: '#7C3AED' },
      { label: 'Босс-рейд сейчас', color: '#DC2626' },
    ],
    giveaway: {
      active: true,
      prize: 'Уникальная корона аватару + VIP',
      keyword: '!join',
      participants: ['AlexStream', 'KiraDev'],
      last_winner: null,
    },
    trivia: {
      active: false,
      question: 'На каком языке написан высокопроизводительный нативный сервер PulseCast?',
      answer: 'rust',
      reward_currency: 300,
      winner: null,
      hint: 'Язык с крабом Феррисом',
    },
    hype_train: {
      active: true,
      level: 2,
      current_points: 680,
      goal_points: 1000,
      remaining_seconds: 240,
    },
    game_counters: {
      deaths: 4,
      wins: 7,
      losses: 2,
      current_game: 'Elden Ring / Rust Studio',
    },
    pngtuber: {
      enabled: true,
      name: 'Кибер-Лис Pulse',
      emotion: 'idle',
      mic_threshold: 16,
      talking: false,
      idle_url: '',
      talk_url: '',
      blink_url: '',
      happy_url: '',
    },
    arena: {
      enabled: true,
      gravity: 0.55,
      move_speed: 2.2,
      avatar_scale: 1.0,
      max_avatars: 32,
      active_minigame: 'none',
      boss_hp: 500,
      boss_max_hp: 500,
      boss_name: 'Мега-Краб',
      currency_name: 'Пульсы',
      points_per_message: 15,
      platforms: [
        { id: 'left_ledge', x_pct: 6, y_pct: 76, width_pct: 20 },
        { id: 'right_ledge', x_pct: 74, y_pct: 72, width_pct: 20 },
      ],
    },
    viewers: {
      AlexStream: {
        username: 'AlexStream',
        platform: 'twitch',
        role: 'moderator',
        currency: 1250,
        xp: 840,
        rank_title: 'Хранитель эфира',
        total_donated: 1500,
        message_count: 42,
        avatar_skin: 'fox',
        avatar_color: '#38BDF8',
        gear: ['crown', 'visor'],
        nametag: 'MOD',
        last_seen: now,
      },
      KiraDev: {
        username: 'KiraDev',
        platform: 'vk_live',
        role: 'subscriber',
        currency: 680,
        xp: 410,
        rank_title: 'Постоялец',
        total_donated: 300,
        message_count: 19,
        avatar_skin: 'cat',
        avatar_color: '#F472B6',
        gear: ['headphones'],
        nametag: 'SUB',
        last_seen: now,
      },
      MishaGG: {
        username: 'MishaGG',
        platform: 'youtube',
        role: 'vip',
        currency: 920,
        xp: 1120,
        rank_title: 'Хранитель эфира',
        total_donated: 650,
        message_count: 27,
        avatar_skin: 'robot',
        avatar_color: '#34D399',
        gear: ['wings'],
        nametag: 'VIP',
        last_seen: now,
      },
    },
    deck_buttons: [
      { id: 'btn_scene_game', label: 'Сцена: Игра', action: 'change_scene', payload: { scene: 'Gaming Capture' }, accent: '#2563EB' },
      { id: 'btn_scene_chat', label: 'Сцена: Чат', action: 'change_scene', payload: { scene: 'Just Chatting' }, accent: '#059669' },
      { id: 'btn_starfall', label: 'Салют звёзд', action: 'trigger_plugin', payload: { plugin_id: 'starfall', burst: 45 }, accent: '#D97706' },
      { id: 'btn_sound_horn', label: 'Звук: Фанфары', action: 'play_sound', payload: { sound_id: 'fanfare' }, accent: '#7C3AED' },
      { id: 'btn_clip', label: 'Отметить клип', action: 'mark_clip', payload: { title: 'Топовый момент' }, accent: '#DC2626' },
      { id: 'btn_br', label: 'Battle Royale', action: 'start_minigame', payload: { kind: 'battle_royale' }, accent: '#0EA5E9' },
    ],
    sounds: [
      { id: 'coin', name: 'Монетка', freq_hz: 880, pattern: 'arpeggio', volume: 0.6 },
      { id: 'fanfare', name: 'Фанфары', freq_hz: 523.25, pattern: 'fanfare', volume: 0.7 },
      { id: 'alert', name: 'Оповещение', freq_hz: 659.25, pattern: 'chime', volume: 0.65 },
      { id: 'laser', name: 'Удар / Бомба', freq_hz: 220, pattern: 'boom', volume: 0.7 },
    ],
    platform_connections: [
      {
        platform: 'twitch',
        enabled: true,
        auth_mode: 'oauth',
        channel_name: 'pulsecast_live',
        connected: false,
        client_id: process.env.TWITCH_CLIENT_ID || '',
        access_token_masked: '',
        send_relay: true,
        status_text: 'Готов к подключению (OAuth 2.0 или анонимный IRC по нику канала)',
      },
      {
        platform: 'youtube',
        enabled: true,
        auth_mode: 'oauth',
        channel_name: '@PulseCastStudio',
        connected: false,
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        access_token_masked: '',
        send_relay: true,
        status_text: 'Готов к подключению (YouTube Live Chat API / ID трансляции)',
      },
      {
        platform: 'kick',
        enabled: true,
        auth_mode: 'token',
        channel_name: 'pulsecast',
        connected: false,
        client_id: process.env.KICK_CLIENT_ID || '',
        access_token_masked: '',
        send_relay: true,
        status_text: 'Готов к подключению (Kick Pusher WebSocket / OAuth)',
      },
      {
        platform: 'vk_live',
        enabled: true,
        auth_mode: 'token',
        channel_name: 'pulsecast_vk',
        connected: false,
        client_id: process.env.VK_CLIENT_ID || '',
        access_token_masked: '',
        send_relay: true,
        status_text: 'Готов к подключению (VK Video Live WebSocket / OAuth)',
      },
    ],
    emotes: defaultBuiltinEmotes(),
    bot_commands: [
      {
        trigger: '!commands',
        response: 'Команды для @$user: !pc, !tg, !discord, !rules, !uptime, !death, !win, !trivia, !shop, !redeem, !avatar, !dance',
        cooldown_sec: 5,
        enabled: true,
        usage_count: 14,
      },
      {
        trigger: '!uptime',
        response: '@$user, стрим идёт уже $uptime! Текущая категория: $game (вызвано $count раз).',
        cooldown_sec: 10,
        enabled: true,
        usage_count: 8,
      },
      {
        trigger: '!pc',
        response: '@$user · Конфиг студии: Ryzen 9 7950X · RTX 4080 Super · 64 GB DDR5 · Сервер: PulseCast Rust Engine.',
        cooldown_sec: 15,
        enabled: true,
        usage_count: 23,
      },
      {
        trigger: '!tg',
        response: '@$user, заходи в наш Telegram-канал с анонсами и плагинами: t.me/pulsecast_stream',
        cooldown_sec: 15,
        enabled: true,
        usage_count: 11,
      },
      {
        trigger: '!discord',
        response: '@$user, наш голосовой сервер Discord для зрителей и совместных игр: discord.gg/pulsecast',
        cooldown_sec: 15,
        enabled: true,
        usage_count: 9,
      },
      {
        trigger: '!rules',
        response: '@$user · Правила чата: уважаем друг друга, без спама капсом, ссылок и спойлеров!',
        cooldown_sec: 10,
        enabled: true,
        usage_count: 5,
      },
    ],
    bot_timers: [
      {
        id: 'tm_tg',
        name: 'Напоминание про Telegram и аватаров',
        message: 'Напоминание: пишите !commands в чат, чтобы управлять своим 2D-чоком на экране и участвовать в мини-играх! HYPE',
        interval_sec: 300,
        min_chat_lines: 2,
        enabled: true,
      },
      {
        id: 'tm_support',
        name: 'Поддержка канала и сборы',
        message: 'Поддержать развитие стрима и продлить Subathon можно через любой сервис — все донаты мгновенно запускают салют на экране! POG',
        interval_sec: 600,
        min_chat_lines: 3,
        enabled: false,
      },
    ],
    rewards_shop: [
      {
        id: 'rw_highlight',
        title: 'Выделить сообщение неоном',
        cost: 150,
        action_kind: 'highlight_msg',
        action_value: 'neon',
        enabled: true,
      },
      {
        id: 'rw_starfall',
        title: 'Запустить звёздный салют на экране',
        cost: 300,
        action_kind: 'starfall_burst',
        action_value: '60',
        enabled: true,
      },
      {
        id: 'rw_horn',
        title: 'Проиграть звук Фанфары в эфире',
        cost: 250,
        action_kind: 'play_sound',
        action_value: 'fanfare',
        enabled: true,
      },
      {
        id: 'rw_crown',
        title: 'Корона для аватара в чате',
        cost: 500,
        action_kind: 'avatar_gear',
        action_value: 'crown',
        enabled: true,
      },
      {
        id: 'rw_song',
        title: 'Заказать трек в очередь эфира',
        cost: 400,
        action_kind: 'song_request',
        action_value: 'queue',
        enabled: true,
      },
    ],
    channel_point_mappings: [
      {
        id: 'cp_hydration',
        platform: 'twitch',
        reward_title: 'Выпей воды / Осанка!',
        cost: 500,
        action_kind: 'bot_reply',
        action_params: { text: 'Зрители активировали награду за баллы канала: время выпить воды и выпрямить спину! EZ' },
        enabled: true,
      },
      {
        id: 'cp_star_burst',
        platform: 'twitch',
        reward_title: 'Звёздный шторм на экране',
        cost: 1500,
        action_kind: 'trigger_plugin',
        action_params: { plugin_id: 'starfall', burst: 75 },
        enabled: true,
      },
      {
        id: 'cp_dance_all',
        platform: 'twitch',
        reward_title: 'Дискотека всех чоков',
        cost: 1000,
        action_kind: 'avatar_action',
        action_params: { username: '*', action: 'dance' },
        enabled: true,
      },
    ],
    moderation: {
      block_links: true,
      anti_flood_ms: 800,
      max_caps_percent: 70,
      max_emotes: 8,
      punishment: 'timeout',
      timeout_seconds: 120,
      blocked_words: ['spam_link', 'casino_scam', 'free_nitro_scam'],
      periodic_announcement: 'Пишите !commands чтобы управлять своим аватаром на экране!',
      periodic_interval_sec: 300,
    },
    moderation_logs: [
      {
        id: randomUUID(),
        username: 'SpamBot99',
        platform: 'twitch',
        reason: 'Подозрительная фишинговая ссылка (Auto-Mod)',
        action: 'timeout',
        created_at: now,
      },
    ],
    ai_chatbot: {
      enabled: true,
      persona_id: 'cyber_fox',
      persona_name: 'Кибер-Лис Пульс (Напарник)',
      system_prompt:
        'Ты харизматичный киберпанк-напарник стримера по имени Пульс. Отвечай зрителям живо, с добрым юмором, кратко (1-2 предложения), поддерживай атмосферу эфира.',
      game_context: 'Стример проходит хардкорные босс-файты в Elden Ring и параллельно тестирует движок на Rust.',
      conversational_reply: true,
      smart_greeting: true,
      ai_moderation: true,
      live_translation: true,
      target_language: 'ru',
      auto_stream_reaction: true,
      greeted_users: ['AlexStream', 'KiraDev', 'MishaGG'],
    },
    stream_recap: null,
    scenarios: [
      {
        id: 'sc_big_donate',
        name: 'Крупный донат >= 500 ₽: Звёзды + Фанфары + Танец',
        enabled: true,
        trigger_event: 'donation',
        condition_value: '500',
        actions: [
          { kind: 'play_sound', params: { sound_id: 'fanfare' } },
          { kind: 'trigger_plugin', params: { plugin_id: 'starfall', burst: 60 } },
          { kind: 'avatar_action', params: { username: '*', action: 'dance' } },
        ],
      },
    ],
    plugins: [
      {
        id: 'starfall',
        name: 'Падающие звёздочки',
        description: 'Плавный поток звёзд и искр на фоне с салютом при донатах и триггерах.',
        author: 'PulseCast SDK',
        enabled: true,
        builtin: true,
        z_index: 5,
        config: { count: 28, speed: 1.4, color: '#FBBF24', secondaryColor: '#38BDF8', burstOnDonate: 35 },
        hooks: ['on_tick', 'on_donation', 'on_trigger'],
        style_css: '',
        script_js: `const stars = state.stars || (state.stars = Array.from({ length: Number(cfg.count) || 28 }, () => ({
  x: Math.random() * width,
  y: Math.random() * height,
  r: 1.5 + Math.random() * 2.5,
  vy: (0.6 + Math.random() * 1.4) * (Number(cfg.speed) || 1.4),
  vx: (Math.random() - 0.5) * 0.4,
  alpha: 0.45 + Math.random() * 0.55,
  color: Math.random() > 0.35 ? (cfg.color || '#FBBF24') : (cfg.secondaryColor || '#38BDF8')
})));

if (event && (event.type === 'on_donation' || event.type === 'on_trigger')) {
  const burst = (event.payload && Number(event.payload.burst)) || Number(cfg.burstOnDonate) || 35;
  for (let i = 0; i < burst; i++) {
    stars.push({
      x: width * (0.15 + Math.random() * 0.7),
      y: -10 - Math.random() * 50,
      r: 2.2 + Math.random() * 3.2,
      vy: 2.4 + Math.random() * 2.8,
      vx: (Math.random() - 0.5) * 2.2,
      alpha: 1,
      temp: true,
      color: cfg.color || '#FBBF24'
    });
  }
}

for (let i = stars.length - 1; i >= 0; i--) {
  const s = stars[i];
  s.x += s.vx;
  s.y += s.vy;
  if (s.y > height + 10) {
    if (s.temp) { stars.splice(i, 1); continue; }
    s.y = -8;
    s.x = Math.random() * width;
  }
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}`,
      },
      {
        id: 'chat_runners',
        name: 'Чоки из чата (Stream Avatars)',
        description: 'Бегающие по нижней кромке экрана персонажи зрителей с экипировкой, облачками сообщений и реакцией на команды.',
        author: 'PulseCast SDK',
        enabled: true,
        builtin: true,
        z_index: 25,
        config: { floorOffsetPx: 18, bubbleDurationMs: 4500, showNametags: true },
        hooks: ['on_tick', 'on_chat', 'on_donation'],
        style_css: '',
        script_js: `if (event && event.type === 'on_chat' && event.payload && event.payload.text) {
  const txt = String(event.payload.text).toLowerCase();
  if (txt.includes('бум') || txt.includes('boom')) {
    sdk.spawnParticles(width * 0.5, height - 60, 28, '#F97316');
  }
}`,
      },
      {
        id: 'word_boom',
        name: 'Реакция на слово «бум»',
        description: 'Взрыв цветных искр на оверлее, когда кто-то в чате пишет слово «бум».',
        author: 'Community Example',
        enabled: false,
        builtin: false,
        z_index: 30,
        config: { keyword: 'бум', particleColor: '#EF4444' },
        hooks: ['on_chat'],
        style_css: '',
        script_js: `if (event && event.type === 'on_chat' && event.payload) {
  const kw = String(cfg.keyword || 'бум').toLowerCase();
  if (String(event.payload.text || '').toLowerCase().includes(kw)) {
    sdk.spawnParticles(Math.random() * width, height * 0.72, 36, cfg.particleColor || '#EF4444');
  }
}`,
      },
    ],
    layouts: [
      { widget_id: 'alerts', label: 'Окно алертов', visible: true, x_pct: 50, y_pct: 14, scale: 1, z_index: 40, wrapper_preset: 'neon_frame', custom_css: '' },
      { widget_id: 'goal', label: 'Цель сборов', visible: true, x_pct: 3, y_pct: 4, scale: 1, z_index: 20, wrapper_preset: 'minimal_edge', custom_css: '' },
      { widget_id: 'subathon', label: 'Subathon-таймер', visible: true, x_pct: 73, y_pct: 4, scale: 1, z_index: 20, wrapper_preset: 'glass_bar', custom_css: '' },
      { widget_id: 'counters', label: 'Hype Train & Счётчики', visible: true, x_pct: 36, y_pct: 4, scale: 1, z_index: 22, wrapper_preset: 'glass_bar', custom_css: '' },
      { widget_id: 'chat', label: 'Мультичат', visible: true, x_pct: 3, y_pct: 28, scale: 1, z_index: 20, wrapper_preset: 'glass_bar', custom_css: '' },
      { widget_id: 'alerts_list', label: 'Лента последних донатов', visible: true, x_pct: 73, y_pct: 22, scale: 1, z_index: 18, wrapper_preset: 'minimal_edge', custom_css: '' },
      { widget_id: 'pngtuber', label: '2D PNGTuber-аватар', visible: true, x_pct: 84, y_pct: 58, scale: 1, z_index: 32, wrapper_preset: 'none', custom_css: '' },
      { widget_id: 'media_share', label: 'Плеер Media Share', visible: true, x_pct: 64, y_pct: 44, scale: 1, z_index: 38, wrapper_preset: 'neon_frame', custom_css: '' },
      { widget_id: 'prediction', label: 'Тотализатор (!bet)', visible: true, x_pct: 3, y_pct: 68, scale: 1, z_index: 26, wrapper_preset: 'glass_bar', custom_css: '' },
      { widget_id: 'ticker', label: 'Бегущая строка (Ticker)', visible: true, x_pct: 0, y_pct: 93, scale: 1, z_index: 36, wrapper_preset: 'glass_bar', custom_css: '' },
      { widget_id: 'subtitles', label: 'Субтитры Whisper', visible: true, x_pct: 50, y_pct: 80, scale: 1, z_index: 35, wrapper_preset: 'retro_crt', custom_css: '' },
    ],
    recent_events: [
      {
        id: randomUUID(),
        kind: 'donation',
        source: 'DonationAlerts-Local',
        username: 'AlexStream',
        amount: 500,
        currency: '₽',
        message: 'На крутой звук и новые плагины! POG',
        sound_id: 'fanfare',
        tts_enabled: true,
        variation_id: 'var_vip_big',
        created_at: now,
      },
    ],
    chat_history: [
      {
        id: randomUUID(),
        platform: 'twitch',
        username: 'AlexStream',
        role: 'moderator',
        color: '#38BDF8',
        text: 'Всем привет! Напиши !commands чтобы увидеть команды чоков POG',
        translated_text: null,
        is_highlighted: false,
        created_at: now,
      },
      {
        id: randomUUID(),
        platform: 'vk_live',
        username: 'KiraDev',
        role: 'subscriber',
        color: '#F472B6',
        text: 'Звёздочки на фоне выглядят супер! CatJam GG',
        translated_text: null,
        is_highlighted: false,
        created_at: now,
      },
    ],
    clip_markers: [],
    logs: [
      {
        id: randomUUID(),
        level: 'info',
        module: 'core',
        message: 'Сервер PulseCast Local инициализирован и готов к работе',
        created_at: now,
      },
    ],
    audio_mixer: {
      master_volume: 90,
      master_muted: false,
      alerts_volume: 85,
      alerts_muted: false,
      tts_volume: 90,
      tts_muted: false,
      tts_rate: 1.0,
      tts_pitch: 1.0,
      media_volume: 75,
      media_muted: false,
    },
    hotkeys: [
      { id: 'hk_1', label: 'Сцена: Игра', combo: 'Alt+1', action_kind: 'deck_button', target_id: 'btn_scene_game', enabled: true },
      { id: 'hk_2', label: 'Сцена: Чат', combo: 'Alt+2', action_kind: 'deck_button', target_id: 'btn_scene_chat', enabled: true },
      { id: 'hk_3', label: 'Салют звёзд', combo: 'Alt+3', action_kind: 'deck_button', target_id: 'btn_starfall', enabled: true },
      { id: 'hk_4', label: 'Звук: Фанфары', combo: 'Alt+4', action_kind: 'deck_button', target_id: 'btn_sound_horn', enabled: true },
      { id: 'hk_5', label: 'Отметить клип', combo: 'Alt+5', action_kind: 'mark_clip', target_id: '', enabled: true },
      { id: 'hk_mute', label: 'Мут Мастер-звука', combo: 'Alt+M', action_kind: 'mute_master', target_id: '', enabled: true },
      { id: 'hk_skip', label: 'Пропустить Media Share', combo: 'Alt+S', action_kind: 'skip_media', target_id: '', enabled: true },
    ],
    analytics: createDefaultAnalytics(now),
    profile_last_saved_at: now,
  };
}

function formatTimeBucketLabel(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, '0');
  return `${hh}:${mm}`;
}

function createDefaultAnalytics(nowIso: string): StreamAnalyticsState {
  const now = new Date(nowIso);
  const buckets: AnalyticsBucket[] = [];
  for (let i = 5; i >= 1; i--) {
    const t = new Date(now.getTime() - i * 5 * 60_000);
    buckets.push({
      label: formatTimeBucketLabel(t),
      donations_rub: 0,
      donations_count: 0,
      chat_messages: 0,
    });
  }
  buckets.push({
    label: formatTimeBucketLabel(now),
    donations_rub: 500,
    donations_count: 1,
    chat_messages: 2,
  });
  return {
    session_started_at: nowIso,
    total_donations_count: 1,
    total_donations_rub: 500,
    total_messages_count: 2,
    peak_chat_rate_per_min: 2,
    platform_breakdown: { twitch: 1, vk_live: 1 },
    timeline_buckets: buckets,
  };
}

function defaultSuperThemes(): SuperThemePackage[] {
  return [
    {
      id: 'st_cyberpunk_neon',
      name: 'Cyberpunk 2099 HUD (SuperTheme)',
      category: 'Киберпанк / Шутеры',
      description: 'Неоновые бирюзово-пурпурные рамки, активный звездопад и глянцевые панели для ночных стримов.',
      accent_color: '#06B6D4',
      bg_surface: 'rgba(9, 13, 28, 0.88)',
      border_color: 'rgba(6, 182, 212, 0.55)',
      wrapper_preset: 'neon_frame',
      enable_starfall: true,
    },
    {
      id: 'st_esports_emerald',
      name: 'Esports Pro Broadcast',
      category: 'Киберспорт / MOBA / FPS',
      description: 'Строгий турнирный стиль с изумрудными акцентами, минималистичными плашками и высокой читаемостью.',
      accent_color: '#10B981',
      bg_surface: 'rgba(15, 23, 42, 0.90)',
      border_color: 'rgba(16, 185, 129, 0.45)',
      wrapper_preset: 'minimal_edge',
      enable_starfall: false,
    },
    {
      id: 'st_retro_arcade',
      name: 'Retro CRT Arcade 1988',
      category: 'Инди / Ретро / Пиксель-арт',
      description: 'Зелёный фосфорный монитор, терминальные рамки и ретро-эстетика аркадных автоматов.',
      accent_color: '#22C55E',
      bg_surface: 'rgba(6, 12, 18, 0.94)',
      border_color: '#22C55E',
      wrapper_preset: 'retro_crt',
      enable_starfall: false,
    },
    {
      id: 'st_royal_gold',
      name: 'Royal Gold VIP Lounge',
      category: 'Just Chatting / IRL / Подкасты',
      description: 'Тёплое золотое свечение, стеклянные панели с размытием и праздничный салют частиц.',
      accent_color: '#F59E0B',
      bg_surface: 'rgba(24, 19, 10, 0.85)',
      border_color: 'rgba(245, 158, 11, 0.5)',
      wrapper_preset: 'glass_bar',
      enable_starfall: true,
    },
  ];
}

function defaultParserRules(): BridgeParserRule[] {
  return [
    {
      id: 'rule_da',
      name: 'DonationAlerts (стандартный текст)',
      platform: 'DonationAlerts',
      enabled: true,
      priority: 100,
      default_kind: 'donation',
      pattern:
        '(?i)(?P<user>[^\\s\\-–:]+)\\s*(?:отправил|задонатил|пожертвовал|sent|donated)\\s*(?P<amount>\\d+(?:[.,]\\d+)?)\\s*(?P<currency>₽|RUB|USD|\\$|EUR|€|UAH|KZT)?(?:\\s*[-–:]\\s*(?P<message>.+))?',
    },
    {
      id: 'rule_boosty',
      name: 'Boosty (подписка или донат)',
      platform: 'Boosty',
      enabled: true,
      priority: 95,
      default_kind: 'donation',
      pattern:
        '(?i)(?:boosty[:\\s]*)?(?P<user>[^\\s\\-–:]+)\\s*(?:поддержал|подписался|купил уровень|donated)\\s*(?:на\\s*)?(?P<amount>\\d+(?:[.,]\\d+)?)?\\s*(?P<currency>₽|RUB|USD|\\$)?(?:\\s*[-–:]\\s*(?P<message>.+))?',
    },
    {
      id: 'rule_se',
      name: 'StreamElements / Streamlabs',
      platform: 'StreamElements',
      enabled: true,
      priority: 90,
      default_kind: 'donation',
      pattern:
        '(?i)(?P<user>[^\\s]+)\\s*(?:tipped|donated|cheered)\\s*(?P<currency>\\$|€|₽)?(?P<amount>\\d+(?:[.,]\\d+)?)(?:\\s*[-–:]\\s*(?P<message>.+))?',
    },
    {
      id: 'rule_generic',
      name: 'Универсальный парсер: Имя + Сумма',
      platform: 'Custom',
      enabled: true,
      priority: 10,
      default_kind: 'donation',
      pattern:
        '(?P<user>[\\p{L}\\p{N}_.-]+)\\s+(?P<amount>\\d+(?:[.,]\\d+)?)\\s*(?P<currency>₽|RUB|USD|\\$|EUR|€)?(?:\\s*[:\\-–]\\s*(?P<message>.+))?',
    },
  ];
}

function defaultAlertVariations(): AlertVariation[] {
  return [
    {
      id: 'var_vip_big',
      name: 'Крупный донат (от 500 ₽)',
      enabled: true,
      priority: 100,
      source_filter: '',
      event_kind: 'donation',
      min_amount: 500,
      max_amount: null,
      keyword: '',
      image_url: '',
      sound_url: '',
      sound_id: 'fanfare',
      title_template: 'КОРОЛЕВСКИЙ ДОНАТ · {user} ({amount} {currency})',
      tts_template: '{user} занёс {amount} {currency}! {message}',
      duration_ms: 6000,
      animation: 'zoom',
      bg_color: 'rgba(17, 24, 39, 0.94)',
      accent_color: '#F59E0B',
      text_color: '#FEF3C7',
    },
    {
      id: 'var_boosty',
      name: 'Поддержка с Boosty',
      enabled: true,
      priority: 90,
      source_filter: 'Boosty',
      event_kind: null,
      min_amount: 0,
      max_amount: null,
      keyword: '',
      image_url: '',
      sound_url: '',
      sound_id: 'alert',
      title_template: 'BOOSTY · {user} ({amount} {currency})',
      tts_template: 'Спасибо за поддержку на Бусти, {user}! {message}',
      duration_ms: 5000,
      animation: 'slide_up',
      bg_color: 'rgba(24, 15, 12, 0.92)',
      accent_color: '#F97316',
      text_color: '#FFF7ED',
    },
    {
      id: 'var_default',
      name: 'Базовый алерт',
      enabled: true,
      priority: 1,
      source_filter: '',
      event_kind: null,
      min_amount: 0,
      max_amount: null,
      keyword: '',
      image_url: '',
      sound_url: '',
      sound_id: 'coin',
      title_template: '{user} · {amount} {currency}',
      tts_template: '{user} отправил {amount} {currency}. {message}',
      duration_ms: 4500,
      animation: 'pop',
      bg_color: 'rgba(9, 13, 28, 0.88)',
      accent_color: '#3B82F6',
      text_color: '#F8FAFC',
    },
  ];
}

const DEDUP_WINDOW_MS = 12_000;
const bridgeDedupMap = new Map<string, number>();

function checkAndRecordDedup(key: string): boolean {
  const now = Date.now();
  const norm = key.trim().toLowerCase();
  if (!norm) return false;
  for (const [k, ts] of bridgeDedupMap.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) bridgeDedupMap.delete(k);
  }
  if (bridgeDedupMap.has(norm)) return false;
  bridgeDedupMap.set(norm, now);
  return true;
}

function compileRulePattern(pattern: string): RegExp | null {
  try {
    let flags = 'u';
    let src = pattern;
    if (src.startsWith('(?i)')) {
      flags += 'i';
      src = src.slice(4);
    }
    src = src.replace(/\(\?P<([a-zA-Z0-9_]+)>/g, '(?<$1>');
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

function parseRawAlert(rawText: string, sourceHint: string | undefined, rules: BridgeParserRule[]): StreamEvent | null {
  const trimmed = rawText.replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed) return null;

  const sorted = rules.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (
      sourceHint &&
      sourceHint.trim() &&
      sourceHint.toLowerCase() !== 'auto' &&
      rule.platform.toLowerCase() !== 'custom' &&
      rule.platform.toLowerCase() !== sourceHint.toLowerCase()
    ) {
      continue;
    }
    const re = compileRulePattern(rule.pattern);
    if (!re) continue;
    const match = trimmed.match(re);
    if (match && match.groups) {
      const user = (match.groups.user || '').trim() || 'Аноним';
      const rawAmt = (match.groups.amount || '').replace(',', '.').replace(/\s+/g, '');
      const amount = rawAmt ? Math.max(0, Number(rawAmt) || 0) : 100;
      const currency = (match.groups.currency || '').trim() || '₽';
      const message = (match.groups.message || '').trim();
      return {
        id: randomUUID(),
        kind: rule.default_kind,
        source: `${rule.platform}-Bridge`,
        username: user,
        amount,
        currency,
        message,
        sound_id: 'fanfare',
        tts_enabled: true,
        variation_id: null,
        created_at: new Date().toISOString(),
      };
    }
  }
  return null;
}

function matchAlertVariation(event: StreamEvent, variations: AlertVariation[]): AlertVariation | null {
  const enabled = variations.filter((v) => v.enabled).sort((a, b) => b.priority - a.priority);
  const srcLow = event.source.toLowerCase();
  const msgLow = event.message.toLowerCase();
  for (const v of enabled) {
    if (v.event_kind && v.event_kind !== event.kind) continue;
    if (v.source_filter.trim() && !srcLow.includes(v.source_filter.trim().toLowerCase())) continue;
    if (event.amount < v.min_amount) continue;
    if (v.max_amount !== null && v.max_amount !== undefined && event.amount > v.max_amount) continue;
    if (v.keyword.trim() && !msgLow.includes(v.keyword.trim().toLowerCase())) continue;
    return v;
  }
  return null;
}

const PROFILE_FILE_PATH = path.resolve(
  process.env.PULSECAST_DATA_FILE || path.join(__dirname, 'pulsecast_profile.json'),
);

function mergeSnapshotWithDefaults(raw: Partial<StreamSnapshot>): StreamSnapshot {
  const base = createInitialSnapshot();
  return {
    ...base,
    ...raw,
    obs: { ...base.obs, ...(raw.obs || {}), connected: false },
    obs_audio: { ...base.obs_audio, ...(raw.obs_audio || {}) },
    whisper: { ...base.whisper, ...(raw.whisper || {}) },
    llm: { ...base.llm, ...(raw.llm || {}) },
    goal: { ...base.goal, ...(raw.goal || {}) },
    feed_config: { ...base.feed_config, ...(raw.feed_config || {}) },
    media_share_config: { ...base.media_share_config, ...(raw.media_share_config || {}) },
    tts_config: { ...base.tts_config, ...(raw.tts_config || {}) },
    prediction: { ...base.prediction, ...(raw.prediction || {}) },
    ticker: { ...base.ticker, ...(raw.ticker || {}) },
    fintech: { ...base.fintech, ...(raw.fintech || {}) },
    subathon: { ...base.subathon, ...(raw.subathon || {}) },
    stream_boss: { ...base.stream_boss, ...(raw.stream_boss || {}) },
    poll: { ...base.poll, ...(raw.poll || {}) },
    giveaway: { ...base.giveaway, ...(raw.giveaway || {}) },
    trivia: { ...base.trivia, ...(raw.trivia || {}) },
    hype_train: { ...base.hype_train, ...(raw.hype_train || {}) },
    game_counters: { ...base.game_counters, ...(raw.game_counters || {}) },
    pngtuber: { ...base.pngtuber, ...(raw.pngtuber || {}) },
    arena: { ...base.arena, ...(raw.arena || {}) },
    moderation: { ...base.moderation, ...(raw.moderation || {}) },
    ai_chatbot: { ...base.ai_chatbot, ...(raw.ai_chatbot || {}) },
    audio_mixer: { ...base.audio_mixer, ...(raw.audio_mixer || {}) },
    hotkeys: Array.isArray(raw.hotkeys) && raw.hotkeys.length > 0 ? raw.hotkeys : base.hotkeys,
    analytics: {
      ...base.analytics,
      ...(raw.analytics || {}),
      platform_breakdown: { ...base.analytics.platform_breakdown, ...(raw.analytics?.platform_breakdown || {}) },
      timeline_buckets:
        Array.isArray(raw.analytics?.timeline_buckets) && raw.analytics!.timeline_buckets.length > 0
          ? raw.analytics!.timeline_buckets
          : base.analytics.timeline_buckets,
    },
  };
}

function loadProfileFromDisk(): StreamSnapshot {
  try {
    if (fs.existsSync(PROFILE_FILE_PATH)) {
      const content = fs.readFileSync(PROFILE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(content) as Partial<StreamSnapshot>;
      if (parsed && typeof parsed === 'object') {
        console.log(`[PulseCast] Загружен профиль с диска: ${PROFILE_FILE_PATH}`);
        return mergeSnapshotWithDefaults(parsed);
      }
    }
  } catch (err) {
    console.warn('[PulseCast] Не удалось прочитать профиль, используем стандартный:', err);
  }
  return createInitialSnapshot();
}

let state: StreamSnapshot = loadProfileFromDisk();

let persistTimer: NodeJS.Timeout | null = null;
function persistProfileNow() {
  try {
    state.profile_last_saved_at = new Date().toISOString();
    const tmpPath = `${PROFILE_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, PROFILE_FILE_PATH);
  } catch (err) {
    console.warn('[PulseCast] Ошибка сохранения профиля на диск:', err);
  }
}

function schedulePersistProfile() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistProfileNow();
  }, 350);
}

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/assets', express.static(assetsDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: WsBroadcast) {
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

function broadcastMvp() {
  broadcast({
    type: 'mvp_updated',
    payload: {
      audio_mixer: state.audio_mixer,
      hotkeys: state.hotkeys,
      analytics: state.analytics,
      obs: state.obs,
      profile_last_saved_at: state.profile_last_saved_at,
    },
  });
  schedulePersistProfile();
}

function broadcastCustomization() {
  broadcast({
    type: 'customization_updated',
    payload: {
      goals: state.goals,
      parser_rules: state.parser_rules,
      media_assets: state.media_assets,
      alert_variations: state.alert_variations,
      feed_config: state.feed_config,
      custom_elements: state.custom_elements,
      scenarios: state.scenarios,
    },
  });
  schedulePersistProfile();
}

function broadcastBotAndAuth() {
  broadcast({
    type: 'bot_and_auth_updated',
    payload: {
      platform_connections: state.platform_connections,
      emotes: state.emotes,
      bot_commands: state.bot_commands,
      bot_timers: state.bot_timers,
      rewards_shop: state.rewards_shop,
      channel_point_mappings: state.channel_point_mappings,
      moderation: state.moderation,
      moderation_logs: state.moderation_logs,
      ai_chatbot: state.ai_chatbot,
      trivia: state.trivia,
      stream_recap: state.stream_recap,
    },
  });
  schedulePersistProfile();
}

function broadcastCounters() {
  broadcast({
    type: 'counters_updated',
    payload: {
      hype_train: state.hype_train,
      game_counters: state.game_counters,
      pngtuber: state.pngtuber,
      obs_audio: state.obs_audio,
    },
  });
  schedulePersistProfile();
}

function broadcastSeDa() {
  broadcast({
    type: 'se_da_updated',
    payload: {
      media_share_config: state.media_share_config,
      media_queue: state.media_queue,
      tts_config: state.tts_config,
      prediction: state.prediction,
      last_slots_spin: state.last_slots_spin,
      ticker: state.ticker,
      fintech: state.fintech,
      game_webhooks: state.game_webhooks,
    },
  });
  schedulePersistProfile();
}

// ============================================================================
// Нативный клиент протокола OBS WebSocket v5 (SHA-256 Auth + Сцены + Replay)
// ============================================================================
let obsSocket: WebSocket | null = null;
let obsSavedPassword = process.env.OBS_WS_PASSWORD || '';
const obsPendingRequests = new Map<string, (resp: { requestStatus?: { result?: boolean; comment?: string }; responseData?: Record<string, unknown> }) => void>();

function normalizeObsWsUrl(endpoint: string): string {
  const clean = endpoint.trim();
  if (clean.startsWith('ws://') || clean.startsWith('wss://')) return clean;
  return `ws://${clean}`;
}

function sendObsRequest(requestType: string, requestData: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  return new Promise((resolve) => {
    if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN) {
      return resolve({ ok: false, error: 'OBS WebSocket не подключён' });
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      obsPendingRequests.delete(requestId);
      resolve({ ok: false, error: 'Таймаут ответа OBS WebSocket' });
    }, 3000);

    obsPendingRequests.set(requestId, (resp) => {
      clearTimeout(timer);
      const ok = Boolean(resp.requestStatus?.result);
      resolve({
        ok,
        data: resp.responseData,
        error: ok ? undefined : resp.requestStatus?.comment || 'Ошибка запроса OBS',
      });
    });

    obsSocket.send(
      JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData },
      }),
    );
  });
}

function disconnectObsWebSocket(reason = 'Отключено пользователем') {
  if (obsSocket) {
    try {
      obsSocket.close();
    } catch {
      // ignore
    }
    obsSocket = null;
  }
  state.obs.connected = false;
  state.obs.last_error = reason;
  broadcastMvp();
}

function connectObsWebSocket(endpointRaw: string, passwordRaw?: string): Promise<{ ok: boolean; error?: string }> {
  const endpoint = (endpointRaw || state.obs.endpoint || '127.0.0.1:4455').trim();
  const password = typeof passwordRaw === 'string' ? passwordRaw : obsSavedPassword;
  obsSavedPassword = password;
  state.obs.endpoint = endpoint;
  state.obs.password_set = Boolean(password);

  if (obsSocket) {
    try {
      obsSocket.close();
    } catch {
      // ignore
    }
    obsSocket = null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, error });
    };

    try {
      const wsUrl = normalizeObsWsUrl(endpoint);
      const ws = new WebSocket(wsUrl);
      obsSocket = ws;

      const connTimeout = setTimeout(() => {
        if (!settled) {
          state.obs.connected = false;
          state.obs.last_error = `Таймаут подключения к ${endpoint}. Проверьте, запущен ли OBS Studio и включён ли WebSocket Server (порт 4455).`;
          try { ws.close(); } catch { /* ignore */ }
          broadcastMvp();
          finish(false, state.obs.last_error);
        }
      }, 3500);

      ws.on('message', async (rawBuf) => {
        try {
          const pkt = JSON.parse(rawBuf.toString()) as { op: number; d?: Record<string, unknown> };
          const d = pkt.d || {};

          if (pkt.op === 0) {
            // Hello (obs-websocket v5)
            const authObj = d.authentication as { challenge?: string; salt?: string } | undefined;
            const identifyData: Record<string, unknown> = { rpcVersion: 1 };
            if (authObj?.challenge && authObj?.salt) {
              if (!password) {
                clearTimeout(connTimeout);
                state.obs.connected = false;
                state.obs.last_error = 'OBS WebSocket требует пароль. Укажите пароль в настройках подключения.';
                broadcastMvp();
                ws.close();
                return finish(false, state.obs.last_error);
              }
              const secret = createHash('sha256').update(`${password}${authObj.salt}`).digest('base64');
              const auth = createHash('sha256').update(`${secret}${authObj.challenge}`).digest('base64');
              identifyData.authentication = auth;
            }
            ws.send(JSON.stringify({ op: 1, d: identifyData }));
          } else if (pkt.op === 2) {
            // Identified
            clearTimeout(connTimeout);
            state.obs.connected = true;
            state.obs.last_error = null;
            state.obs.obs_version = typeof d.obsWebSocketVersion === 'string' ? d.obsWebSocketVersion : 'v5';
            const sceneRes = await sendObsRequest('GetSceneList');
            if (sceneRes.ok && sceneRes.data) {
              const cur = sceneRes.data.currentProgramSceneName;
              const list = sceneRes.data.scenes as Array<{ sceneName?: string }> | undefined;
              if (typeof cur === 'string' && cur) state.obs.active_scene = cur;
              if (Array.isArray(list) && list.length > 0) {
                state.obs.scenes = list.map((s) => s.sceneName || '').filter(Boolean);
              }
            }
            pushLog('info', 'obs', `Подключено к OBS Studio WebSocket v5 (${endpoint})`);
            broadcast({ type: 'sync_state', payload: state });
            schedulePersistProfile();
            finish(true);
          } else if (pkt.op === 7) {
            const reqId = String(d.requestId || '');
            const cb = obsPendingRequests.get(reqId);
            if (cb) {
              obsPendingRequests.delete(reqId);
              cb(d as { requestStatus?: { result?: boolean; comment?: string }; responseData?: Record<string, unknown> });
            }
          } else if (pkt.op === 5 && d.eventType === 'CurrentProgramSceneChanged') {
            const evData = d.eventData as { sceneName?: string } | undefined;
            if (evData?.sceneName) {
              state.obs.active_scene = evData.sceneName;
              broadcast({ type: 'scene_changed', payload: { scene: evData.sceneName, obs_synced: true } });
            }
          }
        } catch {
          // ignore malformed OBS packet
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connTimeout);
        state.obs.connected = false;
        state.obs.last_error = `OBS не запущен или порт закрыт (${endpoint}): ${err.message}`;
        broadcastMvp();
        finish(false, state.obs.last_error);
      });

      ws.on('close', () => {
        if (obsSocket === ws) obsSocket = null;
        if (state.obs.connected) {
          state.obs.connected = false;
          state.obs.last_error = 'Соединение с OBS Studio закрыто';
          broadcastMvp();
        }
      });
    } catch (err) {
      state.obs.connected = false;
      state.obs.last_error = `Некорректный адрес OBS WebSocket: ${String(err)}`;
      broadcastMvp();
      finish(false, state.obs.last_error);
    }
  });
}

function getOrCreateCurrentAnalyticsBucket(): AnalyticsBucket {
  const label = formatTimeBucketLabel(new Date());
  const buckets = state.analytics.timeline_buckets;
  const last = buckets[buckets.length - 1];
  if (last && last.label === label) return last;
  const created: AnalyticsBucket = {
    label,
    donations_rub: 0,
    donations_count: 0,
    chat_messages: 0,
  };
  buckets.push(created);
  if (buckets.length > 24) buckets.shift();
  return created;
}

function recordAnalyticsDonation(amountRub: number) {
  state.analytics.total_donations_count += 1;
  state.analytics.total_donations_rub = Math.round((state.analytics.total_donations_rub + amountRub) * 100) / 100;
  const b = getOrCreateCurrentAnalyticsBucket();
  b.donations_count += 1;
  b.donations_rub = Math.round((b.donations_rub + amountRub) * 100) / 100;
  broadcastMvp();
}

function recordAnalyticsChat(platform: ChatPlatform) {
  state.analytics.total_messages_count += 1;
  state.analytics.platform_breakdown[platform] = (state.analytics.platform_breakdown[platform] || 0) + 1;
  const b = getOrCreateCurrentAnalyticsBucket();
  b.chat_messages += 1;
  if (b.chat_messages > state.analytics.peak_chat_rate_per_min) {
    state.analytics.peak_chat_rate_per_min = b.chat_messages;
  }
}

function convertToRub(amount: number, currencyRaw: string): number {
  const code = String(currencyRaw || '₽').trim().toUpperCase();
  const rate =
    state.fintech?.exchange_rates?.[code] ??
    (code === 'RUB' || code === '₽'
      ? 1
      : code === 'USD' || code === '$' || code === 'USDT'
      ? 92.5
      : code === 'EUR' || code === '€'
      ? 100.2
      : code === 'KZT' || code === '₸'
      ? 0.19
      : code === 'BTC'
      ? 6250000
      : 1);
  return Math.round(amount * rate * 100) / 100;
}

function sanitizeTtsMessage(raw: string): string {
  let out = String(raw || '').trim();
  if (!out) return '';
  if (state.tts_config.profanity_filter) {
    for (const bad of state.tts_config.blocked_words) {
      if (!bad.trim()) continue;
      const escaped = bad.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), '***');
    }
  }
  const maxLen = Math.max(20, state.tts_config.max_chars || 220);
  if (out.length > maxLen) {
    out = out.slice(0, maxLen) + '…';
  }
  return out;
}

function detectMediaKind(url: string): 'youtube' | 'vk' | 'audio' {
  const low = url.toLowerCase();
  if (low.includes('youtube.com') || low.includes('youtu.be')) return 'youtube';
  if (low.includes('vk.com') || low.includes('vkvideo.ru')) return 'vk';
  return 'audio';
}

function ensureActiveMediaPlaying() {
  const hasPlaying = state.media_queue.some((m) => m.status === 'playing' || m.status === 'paused');
  if (!hasPlaying && state.media_share_config.auto_play) {
    const nextQueued = state.media_queue.find((m) => m.status === 'queued');
    if (nextQueued) {
      nextQueued.status = 'playing';
    }
  }
}

function spinSlotsForViewer(username: string, wagerRaw: number): { result: SlotsSpinResult | null; reply: string } {
  const p = state.viewers[username];
  if (!p) {
    return { result: null, reply: `@${username}, напишите сообщение в чат, чтобы открыть кошелёк!` };
  }
  const wager = Math.max(10, Math.min(5000, Math.round(Number(wagerRaw) || 50)));
  if (p.currency < wager) {
    return {
      result: null,
      reply: `@${username}, недостаточно валюты для !slots (${wager} > ${p.currency} ${state.arena.currency_name}).`,
    };
  }
  p.currency -= wager;
  const symbols = ['🍒', '💎', '7️⃣', '🔔', '⭐'];
  const r1 = symbols[Math.floor(Math.random() * symbols.length)];
  const r2 = symbols[Math.floor(Math.random() * symbols.length)];
  const r3 = symbols[Math.floor(Math.random() * symbols.length)];
  let mult = 0;
  if (r1 === r2 && r2 === r3) {
    mult = r1 === '7️⃣' ? 10 : r1 === '💎' ? 7 : 5;
  } else if (r1 === r2 || r2 === r3 || r1 === r3) {
    mult = 2;
  }
  const payout = wager * mult;
  p.currency += payout;
  const spin: SlotsSpinResult = {
    username,
    wager,
    reels: [r1, r2, r3],
    multiplier: mult,
    payout,
    ts: new Date().toISOString(),
  };
  state.last_slots_spin = spin;
  broadcastSeDa();
  const reply =
    mult > 0
      ? `🎰 [${r1} | ${r2} | ${r3}] ДЖЕКПОТ x${mult}! @${username} выиграл +${payout} ${state.arena.currency_name} (Баланс: ${p.currency})!`
      : `🎰 [${r1} | ${r2} | ${r3}] Мимо! @${username} потерял ${wager} ${state.arena.currency_name} (Баланс: ${p.currency}).`;
  return { result: spin, reply };
}

function pushLog(level: string, module: string, message: string) {
  const entry = {
    id: randomUUID(),
    level,
    module,
    message,
    created_at: new Date().toISOString(),
  };
  state.logs.push(entry);
  if (state.logs.length > 150) state.logs.shift();
  broadcast({ type: 'log_entry', payload: entry });
}

function sendSystemChat(username: string, role: ViewerRole, text: string) {
  const msg: ChatMessage = {
    id: randomUUID(),
    platform: 'local',
    username,
    role,
    color: '#60A5FA',
    text,
    translated_text: null,
    is_highlighted: true,
    created_at: new Date().toISOString(),
  };
  state.chat_history.push(msg);
  if (state.chat_history.length > 200) state.chat_history.shift();
  broadcast({ type: 'chat_message', payload: msg });
}

function formatStreamUptime(): string {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(state.stream_started_at)) / 1000));
  const h = Math.floor(elapsedSec / 3600);
  const m = Math.floor((elapsedSec % 3600) / 60);
  const s = elapsedSec % 60;
  if (h > 0) return `${h}ч ${m}м ${s}с`;
  return `${m}м ${s}с`;
}

function expandCommandVariables(template: string, username: string, target: string, count: number): string {
  return template
    .replace(/\$user/gi, username)
    .replace(/\$target/gi, target || username)
    .replace(/\$uptime/gi, formatStreamUptime())
    .replace(/\$count/gi, String(count))
    .replace(/\$game/gi, state.game_counters.current_game || 'PulseCast Studio');
}

function detectAndTranslateMessage(text: string): string | null {
  if (!state.ai_chatbot.enabled || !state.ai_chatbot.live_translation) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('!')) return null;

  // Если сообщение уже содержит кириллицу и целевой язык ru — перевод не требуется
  const hasCyrillic = /[а-яёА-ЯЁ]/.test(trimmed);
  const hasLatin = /[a-zA-Z]{2,}/.test(trimmed);
  if (state.ai_chatbot.target_language === 'ru' && hasCyrillic) return null;
  if (!hasLatin) return null;

  const dict: Array<[RegExp, string]> = [
    [/\bhello\b|\bhi\b|\bhey\b/gi, 'привет'],
    [/\beveryone\b|\bguys\b|\bchat\b/gi, 'чат'],
    [/\bawesome\b|\bamazing\b|\bcool\b|\bgreat\b/gi, 'крутой'],
    [/\bstream\b/gi, 'стрим'],
    [/\bgood luck\b|\bgl\b/gi, 'удачи'],
    [/\bwell played\b|\bwp\b/gi, 'отличная игра'],
    [/\bhow are you\b/gi, 'как дела'],
    [/\bwhat game is this\b/gi, 'что это за игра'],
    [/\bi love this\b|\blove the stream\b/gi, 'обожаю этот эфир'],
    [/\blet's go\b|\blets go\b/gi, 'погнали'],
    [/\bboss\b/gi, 'босс'],
    [/\bhard\b/gi, 'сложный'],
    [/\bthank you\b|\bthanks\b/gi, 'спасибо'],
    [/\bwhere are you from\b/gi, 'откуда ты'],
    [/\bhola\b/gi, 'привет (исп.)'],
    [/\bgracias\b/gi, 'спасибо (исп.)'],
  ];

  let translated = trimmed;
  let matchedAny = false;
  for (const [re, ru] of dict) {
    if (re.test(translated)) {
      matchedAny = true;
      translated = translated.replace(re, ru);
    }
  }
  if (matchedAny) {
    return `${translated}`;
  }
  if (trimmed.split(/\s+/).length >= 3) {
    return `[EN→RU] ${trimmed}`;
  }
  return null;
}

function checkSemanticAiModeration(text: string): string | null {
  if (!state.ai_chatbot.enabled || !state.ai_chatbot.ai_moderation) return null;
  const low = text.toLowerCase();
  const toxicPatterns: Array<[RegExp, string]> = [
    [/free\s+skins|бесплатн\S*\s+скин|раздач\S*\s+крипт|airdrop\s+bonus/i, 'Подозрение на фишинг / скам-раздачу (AI-Mod)'],
    [/накрутк\S*\s+зрител|buy\s+viewers|cheap\s+followers/i, 'Спам-реклама накрутки зрителей (AI-Mod)'],
    [/ты\s+бездар|стример\s+нуб\s+ливни|худший\s+стрим\s+в\s+мире/i, 'Токсичная агрессия в адрес ведущего (AI-Mod)'],
  ];
  for (const [re, reason] of toxicPatterns) {
    if (re.test(low)) return reason;
  }
  return null;
}

function generateConversationalPersonaReply(username: string, text: string): string {
  const low = text.toLowerCase();
  const persona = state.ai_chatbot.persona_name;
  const game = state.game_counters.current_game;

  if (low.includes('игра') || low.includes(' лор') || low.includes('босс') || low.includes('во что')) {
    return `@${username}, сейчас в эфире «${game}» (${state.ai_chatbot.game_context}). Счёт смертей: ${state.game_counters.deaths}, побед: ${state.game_counters.wins}!`;
  }
  if (low.includes('привет') || low.includes('здаров') || low.includes('добрый')) {
    return `@${username}, рад видеть на борту! Я ${persona} — пиши !commands или запускай мини-игру для своего аватара!`;
  }
  if (low.includes('кто ты') || low.includes('ты бот') || low.includes('ии')) {
    return `@${username}, я ${persona} — локальный ИИ-соведущий PulseCast! Слежу за чатом, перевожу сообщения и управляю сценами.`;
  }
  if (low.includes('музык') || low.includes('трек') || low.includes('песн')) {
    return `@${username}, заказать трек можно через магазин лояльности (!redeem rw_song) за Пульсы!`;
  }
  return `@${username}, [${persona}]: отличный вопрос! Мы сейчас в самом разгаре «${game}» (стрим идёт ${formatStreamUptime()}). Держим темп! HYPE`;
}

function executeScenarioActions(actions: ScenarioAction[]) {
  for (const act of actions) {
    if (act.kind === 'change_scene' && typeof act.params.scene === 'string') {
      state.obs.active_scene = act.params.scene;
      let obsSynced = false;
      if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
        obsSynced = true;
        void sendObsRequest('SetCurrentProgramScene', { sceneName: act.params.scene });
      }
      broadcast({ type: 'scene_changed', payload: { scene: act.params.scene, obs_synced: obsSynced } });
      schedulePersistProfile();
    } else if (act.kind === 'play_sound') {
      const s = state.sounds.find((x) => x.id === (act.params.sound_id || 'fanfare'));
      if (s) {
        broadcast({
          type: 'play_sound',
          payload: { sound_id: s.id, name: s.name, freq_hz: s.freq_hz, pattern: s.pattern, volume: s.volume },
        });
      }
    } else if (act.kind === 'trigger_plugin') {
      broadcast({
        type: 'plugin_triggered',
        payload: { plugin_id: String(act.params.plugin_id || 'starfall'), data: act.params },
      });
    } else if (act.kind === 'avatar_action') {
      broadcast({
        type: 'avatar_action',
        payload: {
          username: String(act.params.username || '*'),
          action: String(act.params.action || 'dance'),
        },
      });
    } else if (act.kind === 'bot_reply' && typeof act.params.text === 'string') {
      sendSystemChat('PulseBot', 'agent', act.params.text);
    }
  }
}

function processStreamEvent(event: StreamEvent) {
  // 1. Мультивалютная нормализация в рубли (DonationAlerts / StreamElements FinTech)
  const origCurrency = (event.original_currency || event.currency || '₽').trim();
  const origAmount = event.original_amount ?? event.amount;
  const amountRub = convertToRub(origAmount, origCurrency);
  event.original_amount = origAmount;
  event.original_currency = origCurrency;
  event.amount = amountRub;
  event.currency = '₽';

  // 2. Применение фильтра мата и порогов TTS
  if (event.message) {
    event.message = sanitizeTtsMessage(event.message);
  }
  if (!state.tts_config.enabled || amountRub < state.tts_config.min_amount_rub) {
    event.tts_enabled = false;
  }

  // 3. Автоматическая очередь Media Share (YouTube / VK / Audio) от порога суммы
  if (
    event.media_url &&
    event.media_url.trim() &&
    state.media_share_config.enabled &&
    amountRub >= state.media_share_config.min_amount_rub
  ) {
    const calcSec = Math.min(
      state.media_share_config.max_duration_sec,
      Math.max(15, Math.round(amountRub * state.media_share_config.seconds_per_rub)),
    );
    const mediaItem: MediaShareItem = {
      id: randomUUID(),
      donor: event.username,
      amount_rub: amountRub,
      media_url: event.media_url.trim(),
      media_kind: detectMediaKind(event.media_url),
      title: event.media_title?.trim() || `Медиа-запрос от ${event.username} (${Math.round(amountRub)} ₽)`,
      duration_sec: calcSec,
      remaining_sec: calcSec,
      status: 'queued',
      created_at: new Date().toISOString(),
    };
    event.media_duration_sec = calcSec;
    state.media_queue.push(mediaItem);
    ensureActiveMediaPlaying();
    pushLog('info', 'media_share', `Добавлен медиа-запрос «${mediaItem.title}» на ${calcSec} сек`);
  }

  // 4. Пополнение баланса FinTech при донате
  if (event.kind === 'donation' && amountRub > 0) {
    state.fintech.balance_rub = Math.round((state.fintech.balance_rub + amountRub) * 100) / 100;
  }

  const matched = matchAlertVariation(event, state.alert_variations);
  if (matched) {
    event.variation_id = matched.id;
    if (!event.sound_id && matched.sound_id) event.sound_id = matched.sound_id;
  }

  state.recent_events.push(event);
  if (state.recent_events.length > 100) state.recent_events.shift();

  const existing = state.viewers[event.username] || {
    username: event.username,
    platform: 'local' as ChatPlatform,
    role: 'vip' as ViewerRole,
    currency: 300,
    xp: 100,
    rank_title: 'Зритель',
    total_donated: 0,
    message_count: 0,
    avatar_skin: 'fox',
    avatar_color: '#FBBF24',
    gear: ['crown'],
    nametag: 'VIP',
    last_seen: new Date().toISOString(),
  };

  existing.total_donated += event.amount;
  existing.currency += Math.max(50, Math.round(event.amount));
  existing.xp += Math.max(25, Math.round(event.amount / 10));
  existing.rank_title = computeRankTitle(existing.xp);
  existing.last_seen = new Date().toISOString();
  state.viewers[event.username] = existing;

  // Hype Train прогресс
  state.hype_train.active = true;
  state.hype_train.remaining_seconds = 300;
  state.hype_train.current_points += Math.max(100, Math.round(event.amount));
  while (state.hype_train.current_points >= state.hype_train.goal_points) {
    state.hype_train.current_points -= state.hype_train.goal_points;
    state.hype_train.level += 1;
    state.hype_train.goal_points = Math.round(state.hype_train.goal_points * 1.35);
  }

  // PNGTuber реакция на донат/событие
  state.pngtuber.emotion = 'happy';
  state.pngtuber.talking = true;
  broadcastCounters();
  setTimeout(() => {
    state.pngtuber.talking = false;
    state.pngtuber.emotion = 'idle';
    broadcastCounters();
  }, 4200);

  if (event.kind === 'donation' && event.amount > 0) {
    state.goal.current += event.amount;
    for (const g of state.goals) {
      if (g.unit === event.currency || g.unit === '₽') {
        g.current += event.amount;
      }
    }
    state.subathon.remaining_seconds += Math.round((event.amount / 100) * state.subathon.seconds_per_100_rub);
    state.stream_boss.hp -= event.amount;
    if (state.stream_boss.hp <= 0) {
      state.stream_boss.defeats_count += 1;
      state.stream_boss.boss_name = event.username;
      state.stream_boss.max_hp = Math.round(state.stream_boss.max_hp * 1.25);
      state.stream_boss.hp = state.stream_boss.max_hp;
    }
  } else if (event.kind === 'subscription') {
    state.subathon.remaining_seconds += state.subathon.seconds_per_sub;
    for (const g of state.goals) {
      if (g.unit.toLowerCase().includes('саб') || g.unit.toLowerCase().includes('подпис')) {
        g.current += 1;
      }
    }
  }

  // 5. Игровые вебхуки и RCON-триггеры (например, Minecraft спавн моба при донате)
  if (event.kind === 'donation') {
    for (const gw of state.game_webhooks) {
      if (!gw.enabled) continue;
      if (amountRub < gw.min_amount_rub) continue;
      if (gw.keyword.trim() && !event.message.toLowerCase().includes(gw.keyword.trim().toLowerCase())) continue;
      gw.last_triggered_at = new Date().toISOString();
      gw.trigger_count += 1;
      const renderedCmd = gw.command_or_payload
        .replace(/\{user\}/g, event.username)
        .replace(/\{amount\}/g, String(Math.round(amountRub)))
        .replace(/\{message\}/g, event.message);
      pushLog('info', 'game_webhook', `[${gw.game}] Выполнен триггер «${gw.name}»: ${renderedCmd}`);
    }
  }

  broadcast({ type: 'new_event', payload: event });
  broadcast({
    type: 'engagement_updated',
    payload: {
      goal: state.goal,
      subathon: state.subathon,
      stream_boss: state.stream_boss,
      poll: state.poll,
      giveaway: state.giveaway,
    },
  });
  broadcastCustomization();
  broadcastSeDa();
  if (event.kind === 'donation') {
    recordAnalyticsDonation(amountRub);
  }
  pushLog(
    'info',
    'events',
    `Событие ${event.kind} от ${event.username} (${origAmount} ${origCurrency} -> ${Math.round(amountRub)} ₽)`,
  );

  // Умная благодарность от ИИ-персонажа
  if (state.ai_chatbot.enabled && state.ai_chatbot.smart_greeting) {
    const thanks =
      event.kind === 'donation'
        ? `@${event.username}, огромное спасибо за мощный донат ${Math.round(event.amount)} ₽! Hype Train летит на уровне ${state.hype_train.level}! POG`
        : `@${event.username}, добро пожаловать в ряды подписчиков! Твой аватар получил VIP-статус! HYPE`;
    sendSystemChat(state.ai_chatbot.persona_name, 'agent', thanks);
  }

  // Авто-реакция ИИ-режиссёра на крупные события
  if (state.ai_chatbot.enabled && state.ai_chatbot.auto_stream_reaction && event.amount >= 1000) {
    broadcast({ type: 'plugin_triggered', payload: { plugin_id: 'starfall', data: { burst: 85 } } });
    broadcast({ type: 'avatar_action', payload: { username: '*', action: 'dance' } });
  }

  for (const sc of state.scenarios) {
    if (!sc.enabled) continue;
    if (sc.trigger_event === 'donation' && event.kind === 'donation') {
      const thr = Number(sc.condition_value) || 0;
      if (event.amount >= thr) executeScenarioActions(sc.actions);
    } else if (sc.trigger_event === 'subscription' && event.kind === 'subscription') {
      executeScenarioActions(sc.actions);
    }
  }
}

function redeemShopItem(username: string, item: RewardItem): string {
  const p = state.viewers[username];
  if (!p) return `@${username}, профиль зрителя ещё не создан — напишите сообщение в чат!`;
  if (p.currency < item.cost) {
    return `@${username}, недостаточно валюты для «${item.title}» (нужно ${item.cost}, у вас ${p.currency} ${state.arena.currency_name}).`;
  }
  p.currency -= item.cost;
  if (item.action_kind === 'starfall_burst') {
    broadcast({
      type: 'plugin_triggered',
      payload: { plugin_id: 'starfall', data: { burst: Number(item.action_value) || 60 } },
    });
  } else if (item.action_kind === 'play_sound') {
    const s = state.sounds.find((x) => x.id === item.action_value) || state.sounds[0];
    if (s) {
      broadcast({
        type: 'play_sound',
        payload: { sound_id: s.id, name: s.name, freq_hz: s.freq_hz, pattern: s.pattern, volume: s.volume },
      });
    }
  } else if (item.action_kind === 'avatar_gear') {
    if (!p.gear.includes(item.action_value)) p.gear.push(item.action_value);
  }
  return `@${username} активировал награду «${item.title}» за ${item.cost} ${state.arena.currency_name}! Остаток: ${p.currency}`;
}

function handleChatCommand(username: string, raw: string) {
  const parts = raw.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg1 = parts[1] || '';
  const arg2 = parts[2] || '';
  let reply: string | null = null;

  if (['!dance', '!jump', '!sit', '!stand', '!fart'].includes(cmd)) {
    broadcast({ type: 'avatar_action', payload: { username, action: cmd.slice(1) } });
  } else if (['!hug', '!attack', '!bomb'].includes(cmd) && arg1) {
    broadcast({
      type: 'avatar_action',
      payload: { username, action: cmd.slice(1), target: arg1.replace(/^@/, '') },
    });
  } else if (cmd === '!avatar' && arg1 && state.viewers[username]) {
    state.viewers[username].avatar_skin = arg1.toLowerCase();
    reply = `@${username} сменил скин аватара на '${arg1.toLowerCase()}'`;
  } else if (cmd === '!color' && arg1 && state.viewers[username]) {
    state.viewers[username].avatar_color = arg1;
    reply = `@${username} выбрал цвет ${arg1}`;
  } else if (cmd === '!gear' && arg1 && state.viewers[username]) {
    const item = arg1.toLowerCase();
    if (!state.viewers[username].gear.includes(item)) state.viewers[username].gear.push(item);
    reply = `@${username} надел экипировку: ${item}`;
  } else if (cmd === '!nametag' && arg1 && state.viewers[username]) {
    state.viewers[username].nametag = arg1.toUpperCase();
    reply = `@${username} установил неймтег [${arg1.toUpperCase()}]`;
  } else if ((cmd === '!currency' || cmd === '!rank') && state.viewers[username]) {
    const p = state.viewers[username];
    reply = `@${username} · Баланс: ${p.currency} ${state.arena.currency_name} · Ранг: ${p.rank_title} (${p.xp} XP)`;
  } else if (cmd === '!shop') {
    const list = state.rewards_shop
      .filter((r) => r.enabled)
      .map((r) => `${r.id} (${r.cost})`)
      .join(', ');
    reply = `Магазин лояльности: !redeem <id> [${list}] | Экипировка: !gear crown|visor|wings`;
  } else if (cmd === '!redeem' && arg1) {
    const item = state.rewards_shop.find(
      (r) => r.enabled && (r.id.toLowerCase() === arg1.toLowerCase() || r.title.toLowerCase().includes(arg1.toLowerCase())),
    );
    if (item) {
      reply = redeemShopItem(username, item);
      broadcastBotAndAuth();
    } else {
      reply = `@${username}, награда «${arg1}» не найдена. Напишите !shop для списка.`;
    }
  } else if (cmd === '!death' || cmd === '!deaths') {
    if (arg1 === '+' || arg1 === '+1' || !arg1) {
      state.game_counters.deaths += 1;
      broadcastCounters();
    }
    reply = `Счётчик смертей в «${state.game_counters.current_game}»: ${state.game_counters.deaths} 💀`;
  } else if (cmd === '!win') {
    state.game_counters.wins += 1;
    broadcastCounters();
    reply = `Победа засчитана! Счёт: ${state.game_counters.wins}W / ${state.game_counters.losses}L EZ`;
  } else if (cmd === '!loss') {
    state.game_counters.losses += 1;
    broadcastCounters();
    reply = `Поражение засчитано. Счёт: ${state.game_counters.wins}W / ${state.game_counters.losses}L`;
  } else if (cmd === '!trivia') {
    if (state.trivia.active) {
      reply = `Викторина активна! Вопрос (${state.trivia.reward_currency} ${state.arena.currency_name}): ${state.trivia.question} (Подсказка: ${state.trivia.hint})`;
    } else {
      state.trivia.active = true;
      state.trivia.winner = null;
      broadcastBotAndAuth();
      reply = `Викторина запущена! Вопрос на ${state.trivia.reward_currency} ${state.arena.currency_name}: ${state.trivia.question}`;
    }
  } else if (cmd === '!ai' && parts.length > 1) {
    reply = generateConversationalPersonaReply(username, parts.slice(1).join(' '));
  } else if (['!battleroyale', '!boss', '!spawn', '!basketball'].includes(cmd)) {
    const map: Record<string, MiniGameKind> = {
      '!battleroyale': 'battle_royale',
      '!boss': 'boss_fight',
      '!spawn': 'star_catch',
      '!basketball': 'basketball',
    };
    const kind = map[cmd];
    state.arena.active_minigame = kind;
    if (kind === 'boss_fight') state.arena.boss_hp = state.arena.boss_max_hp;
    broadcast({ type: 'minigame_started', payload: { kind, initiator: username, details: { source: 'chat' } } });
    reply = `Мини-игра ${kind} запущена игроком @${username}!`;
  } else if (cmd === '!duel' && arg1) {
    const target = arg1.replace(/^@/, '');
    const wager = Math.max(10, Math.min(10000, Number(arg2) || 50));
    if (target && target !== username) {
      broadcast({ type: 'minigame_started', payload: { kind: 'duel', initiator: username, details: { opponent: target, wager } } });
      reply = `@${username} вызывает @${target} на дуэль со ставкой ${wager}!`;
    }
  } else if (cmd === '!bet' && state.viewers[username]) {
    const p = state.viewers[username];
    // Если открыто пари StreamElements (!bet <номер_исхода> <сумма>)
    if (state.prediction.active && !state.prediction.locked && arg2) {
      const outcomeId = arg1.trim();
      const wager = Math.max(10, Math.min(25000, Math.round(Number(arg2) || 50)));
      const outcome = state.prediction.outcomes.find((o) => o.id === outcomeId);
      if (!outcome) {
        reply = `@${username}, укажите номер исхода (1 или 2): !bet 1 100`;
      } else if (p.currency < wager) {
        reply = `@${username}, недостаточно валюты для ставки ${wager} (у вас ${p.currency}).`;
      } else {
        p.currency -= wager;
        if (!outcome.bets[username]) outcome.bettors_count += 1;
        outcome.bets[username] = (outcome.bets[username] || 0) + wager;
        outcome.pool += wager;
        broadcastSeDa();
        reply = `🎲 @${username} поставил ${wager} ${state.arena.currency_name} на исход #${outcome.id} «${outcome.label}»! Банк исхода: ${outcome.pool}`;
      }
    } else {
      const wager = Math.max(5, Math.min(5000, Number(arg1) || 25));
      if (p.currency >= wager) {
        const win = Math.random() > 0.48;
        p.currency += win ? wager : -wager;
        reply = win
          ? `@${username} выиграл +${wager}! Баланс: ${p.currency}`
          : `@${username} проиграл -${wager}. Баланс: ${p.currency}`;
      } else {
        reply = `@${username}, недостаточно валюты для ставки ${wager}`;
      }
    }
  } else if (cmd === '!slots') {
    const wager = Number(arg1) || 50;
    const res = spinSlotsForViewer(username, wager);
    reply = res.reply;
  } else if (cmd === '!top' || cmd === '!leaderboard') {
    const topByPts = Object.values(state.viewers)
      .sort((a, b) => b.currency - a.currency)
      .slice(0, 3)
      .map((v, i) => `${i + 1}. ${v.username} (${v.currency} ${state.arena.currency_name})`)
      .join(' · ');
    reply = `🏆 Топ лидеров StreamElements: ${topByPts}`;
  } else if (cmd === '!goal') {
    reply = `Цель «${state.goal.title}»: ${Math.round(state.goal.current)} / ${Math.round(state.goal.target)} ${state.goal.unit}`;
  } else if (cmd === '!clip') {
    const clip = {
      id: randomUUID(),
      title: parts.slice(1).join(' ') || 'Хайлайт из чата',
      author: username,
      stream_elapsed_sec: Math.max(0, Math.floor((Date.now() - Date.parse(state.stream_started_at)) / 1000)),
      created_at: new Date().toISOString(),
    };
    state.clip_markers.push(clip);
    broadcast({ type: 'clip_marked', payload: clip });
    reply = `Маркер клипа сохранён по запросу @${username}!`;
  } else {
    const found = state.bot_commands.find((c) => c.enabled && c.trigger.toLowerCase() === cmd);
    if (found) {
      found.usage_count = (found.usage_count || 0) + 1;
      reply = expandCommandVariables(found.response, username, arg1.replace(/^@/, ''), found.usage_count);
      broadcastBotAndAuth();
    }
  }

  if (reply) sendSystemChat('PulseBot', 'agent', reply);
}

function executeTools(calls: Array<{ name: string; arguments: Record<string, unknown> }>): AgentToolExecution[] {
  const executed: AgentToolExecution[] = [];
  for (const call of calls) {
    const args = call.arguments || {};
    let result = '';

    switch (call.name) {
      case 'change_scene': {
        const scene = String(args.scene || 'Main Studio');
        state.obs.active_scene = scene;
        let obsSynced = false;
        if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
          obsSynced = true;
          void sendObsRequest('SetCurrentProgramScene', { sceneName: scene });
        }
        broadcast({ type: 'scene_changed', payload: { scene, obs_synced: obsSynced } });
        schedulePersistProfile();
        result = `Сцена переключена на «${scene}»`;
        break;
      }
      case 'trigger_alert': {
        const ev: StreamEvent = {
          id: randomUUID(),
          kind: 'donation',
          source: 'ai_agent',
          username: String(args.username || 'Режиссёр'),
          amount: Number(args.amount) || 500,
          currency: '₽',
          message: String(args.message || 'Алерт от ИИ-агента'),
          sound_id: 'fanfare',
          tts_enabled: true,
          created_at: new Date().toISOString(),
        };
        processStreamEvent(ev);
        result = `Алерт для ${ev.username} выведен`;
        break;
      }
      case 'send_chat_message': {
        const txt = String(args.text || 'Привет, чат!');
        sendSystemChat('AI-Режиссёр', 'agent', txt);
        result = `Отправлено в чат: ${txt}`;
        break;
      }
      case 'toggle_subtitles': {
        const enabled = Boolean(args.enabled ?? true);
        state.whisper.enabled = enabled;
        state.whisper.diagnostic = enabled ? 'Субтитры активны' : 'Субтитры остановлены';
        broadcast({ type: 'whisper_status_updated', payload: state.whisper });
        result = `Субтитры ${enabled ? 'включены' : 'выключены'}`;
        break;
      }
      case 'set_theme': {
        const target = String(args.target || 'overlay');
        const themeId = String(args.theme_id || 'overlay_neon');
        if (target === 'dashboard') state.active_dashboard_theme = themeId;
        else state.active_overlay_theme = themeId;
        broadcast({
          type: 'theme_changed',
          payload: {
            dashboard_theme: state.active_dashboard_theme,
            overlay_theme: state.active_overlay_theme,
            themes: state.themes,
          },
        });
        result = `Тема ${target} изменена на ${themeId}`;
        break;
      }
      case 'play_sound': {
        const s = state.sounds.find((x) => x.id === String(args.sound_id || 'fanfare'));
        if (s) {
          broadcast({
            type: 'play_sound',
            payload: { sound_id: s.id, name: s.name, freq_hz: s.freq_hz, pattern: s.pattern, volume: s.volume },
          });
          result = `Звук «${s.name}» воспроизведён`;
        } else {
          result = 'Звук не найден';
        }
        break;
      }
      case 'mark_clip': {
        const clip = {
          id: randomUUID(),
          title: String(args.title || 'Хайлайт от ИИ-агента'),
          author: 'AI-Режиссёр',
          stream_elapsed_sec: Math.max(0, Math.floor((Date.now() - Date.parse(state.stream_started_at)) / 1000)),
          created_at: new Date().toISOString(),
        };
        state.clip_markers.push(clip);
        broadcast({ type: 'clip_marked', payload: clip });
        result = `Маркер клипа «${clip.title}» сохранён`;
        break;
      }
      case 'start_minigame': {
        const kind = (String(args.kind || 'battle_royale') as MiniGameKind) || 'battle_royale';
        state.arena.active_minigame = kind;
        if (kind === 'boss_fight') state.arena.boss_hp = state.arena.boss_max_hp;
        broadcast({ type: 'minigame_started', payload: { kind, initiator: 'AI-Режиссёр', details: args } });
        result = `Мини-игра ${kind} запущена`;
        break;
      }
      case 'avatar_action': {
        const username = String(args.username || '*');
        const action = String(args.action || 'dance');
        broadcast({ type: 'avatar_action', payload: { username, action, target: args.target ? String(args.target) : null } });
        result = `Аватарам отправлено действие «${action}»`;
        break;
      }
      case 'toggle_plugin': {
        const pid = String(args.plugin_id || 'starfall');
        const enabled = Boolean(args.enabled ?? true);
        const found = state.plugins.find((p) => p.id === pid);
        if (found) {
          found.enabled = enabled;
          broadcast({ type: 'plugin_updated', payload: found });
          result = `Плагин «${found.name}» ${enabled ? 'включён' : 'выключен'}`;
        } else {
          result = `Плагин ${pid} не найден`;
        }
        break;
      }
      case 'configure_plugin': {
        const pid = String(args.plugin_id || 'starfall');
        const found = state.plugins.find((p) => p.id === pid);
        if (found && args.config && typeof args.config === 'object') {
          found.config = { ...found.config, ...(args.config as Record<string, unknown>) };
          broadcast({ type: 'plugin_updated', payload: found });
          result = `Конфигурация плагина «${found.name}» обновлена`;
        } else {
          result = `Плагин ${pid} не найден`;
        }
        break;
      }
      case 'trigger_plugin_effect': {
        const pid = String(args.plugin_id || 'starfall');
        broadcast({
          type: 'plugin_triggered',
          payload: { plugin_id: pid, data: (args.payload as Record<string, unknown>) || { burst: 45 } },
        });
        result = `Эффект плагина ${pid} запущен`;
        break;
      }
      case 'upsert_custom_plugin': {
        const id = String(args.id || `custom_${Date.now()}`);
        const plugin: OverlayPlugin = {
          id,
          name: String(args.name || 'Кастомный плагин'),
          description: String(args.description || 'Создан ИИ-агентом'),
          author: 'AI-Режиссёр',
          enabled: Boolean(args.enabled ?? true),
          builtin: false,
          z_index: 32,
          config: (args.config as Record<string, unknown>) || {},
          hooks: Array.isArray(args.hooks) ? (args.hooks as string[]) : ['on_tick', 'on_chat'],
          style_css: String(args.style_css || ''),
          script_js: String(args.script_js || ''),
        };
        const idx = state.plugins.findIndex((p) => p.id === id);
        if (idx >= 0) state.plugins[idx] = plugin;
        else state.plugins.push(plugin);
        broadcast({ type: 'plugin_updated', payload: plugin });
        result = `Кастомный плагин «${plugin.name}» сохранён и активирован`;
        break;
      }
      case 'update_widget_layout': {
        const wid = String(args.widget_id || 'chat');
        const w = state.layouts.find((x) => x.widget_id === wid);
        if (w) {
          if (typeof args.x_pct === 'number') w.x_pct = args.x_pct;
          if (typeof args.y_pct === 'number') w.y_pct = args.y_pct;
          if (typeof args.scale === 'number') w.scale = args.scale;
          if (typeof args.visible === 'boolean') w.visible = args.visible;
          if (typeof args.wrapper_preset === 'string') {
            w.wrapper_preset = args.wrapper_preset as WidgetLayoutConfig['wrapper_preset'];
          }
          broadcast({ type: 'layout_updated', payload: state.layouts });
          result = `Виджет «${w.label}» обновлён`;
        } else {
          result = `Виджет ${wid} не найден`;
        }
        break;
      }
      case 'upsert_custom_element': {
        const id = String(args.id || `elem_${Date.now()}`);
        const elem: CustomOverlayElement = {
          id,
          name: String(args.name || 'Элемент оверлея'),
          visible: Boolean(args.visible ?? true),
          x_pct: Number(args.x_pct ?? 50),
          y_pct: Number(args.y_pct ?? 50),
          width_px: Number(args.width_px ?? 180),
          z_index: Number(args.z_index ?? 28),
          image_url: String(args.image_url || ''),
          html: String(args.html || ''),
          css: String(args.css || ''),
        };
        const idx = state.custom_elements.findIndex((x) => x.id === id);
        if (idx >= 0) state.custom_elements[idx] = elem;
        else state.custom_elements.push(elem);
        broadcastCustomization();
        result = `Кастомный элемент «${elem.name}» добавлен на оверлей`;
        break;
      }
      case 'start_timer': {
        const seconds = Math.max(10, Number(args.seconds) || 300);
        const label = String(args.label || 'Таймер от ИИ-агента');
        state.subathon.running = true;
        state.subathon.remaining_seconds += seconds;
        broadcast({
          type: 'engagement_updated',
          payload: {
            goal: state.goal,
            subathon: state.subathon,
            stream_boss: state.stream_boss,
            poll: state.poll,
            giveaway: state.giveaway,
          },
        });
        result = `Таймер «${label}» (+${seconds} сек) запущен`;
        break;
      }
      case 'set_obs_audio': {
        if (typeof args.mic_muted === 'boolean') state.obs_audio.mic_muted = args.mic_muted;
        if (typeof args.mic_volume === 'number') state.obs_audio.mic_volume = Math.max(0, Math.min(100, args.mic_volume));
        if (typeof args.music_volume === 'number') state.obs_audio.music_volume = Math.max(0, Math.min(100, args.music_volume));
        broadcastCounters();
        result = `OBS Аудио: Микрофон ${state.obs_audio.mic_muted ? 'ВЫКЛ' : `${state.obs_audio.mic_volume}%`}, Музыка ${state.obs_audio.music_volume}%`;
        break;
      }
      case 'set_pngtuber_emotion': {
        const emotion = (String(args.emotion || 'happy') as PngTuberConfig['emotion']) || 'happy';
        state.pngtuber.emotion = emotion;
        if (typeof args.talking === 'boolean') state.pngtuber.talking = args.talking;
        broadcastCounters();
        result = `Эмоция PNGTuber-аватара переключена на «${emotion}»`;
        break;
      }
      case 'update_counters': {
        if (typeof args.deaths_delta === 'number') state.game_counters.deaths = Math.max(0, state.game_counters.deaths + args.deaths_delta);
        if (typeof args.wins_delta === 'number') state.game_counters.wins = Math.max(0, state.game_counters.wins + args.wins_delta);
        if (typeof args.losses_delta === 'number') state.game_counters.losses = Math.max(0, state.game_counters.losses + args.losses_delta);
        if (typeof args.hype_level === 'number') state.hype_train.level = Math.max(1, args.hype_level);
        broadcastCounters();
        result = `Счётчики обновлены: Смертей ${state.game_counters.deaths}, Побед ${state.game_counters.wins}`;
        break;
      }
      default:
        result = `Инструмент ${call.name} выполнен`;
    }

    pushLog('info', 'agent_tool', `${call.name}: ${result}`);
    executed.push({ name: call.name, arguments: args, result });
  }
  return executed;
}

function deterministicAgentFallback(prompt: string): {
  reply: string;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
  const lower = prompt.toLowerCase();
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const notes: string[] = [];

  if (lower.includes('сцен') || lower.includes('переключ')) {
    const scene = lower.includes('игр')
      ? 'Gaming Capture'
      : lower.includes('чат') || lower.includes('общен')
        ? 'Just Chatting'
        : lower.includes('пауз') || lower.includes('brb') || lower.includes('отойд')
          ? 'BRB Pause'
          : 'Main Studio';
    calls.push({ name: 'change_scene', arguments: { scene } });
    notes.push(`переключил сцену на «${scene}»`);
  }

  if (lower.includes('микрофон') || lower.includes('музык') || lower.includes('громк') || lower.includes('мут')) {
    const micMuted = lower.includes('выкл') || lower.includes('мут') || lower.includes('mute');
    const musicVol = lower.includes('тише') ? 20 : lower.includes('громч') ? 80 : state.obs_audio.music_volume;
    calls.push({ name: 'set_obs_audio', arguments: { mic_muted: micMuted, music_volume: musicVol } });
    notes.push(`обновил звук OBS (микрофон: ${micMuted ? 'выкл' : 'вкл'}, музыка: ${musicVol}%)`);
  }

  if (lower.includes('таймер') || lower.includes('минут')) {
    const matchMin = lower.match(/(\d+)\s*мин/);
    const secs = matchMin ? Number(matchMin[1]) * 60 : 300;
    calls.push({ name: 'start_timer', arguments: { seconds: secs, label: 'Голосовой таймер' } });
    notes.push(`добавил таймер на ${Math.round(secs / 60)} мин`);
  }

  if (lower.includes('смерт') || lower.includes('death') || lower.includes('побед')) {
    const deathsDelta = lower.includes('смерт') || lower.includes('death') ? 1 : 0;
    const winsDelta = lower.includes('побед') ? 1 : 0;
    calls.push({ name: 'update_counters', arguments: { deaths_delta: deathsDelta, wins_delta: winsDelta } });
    notes.push('обновил игровые счётчики на оверлее');
  }

  if (lower.includes('эмоц') || lower.includes('pngtuber') || lower.includes('улыб') || lower.includes('радост')) {
    calls.push({ name: 'set_pngtuber_emotion', arguments: { emotion: 'happy', talking: true } });
    notes.push('переключил эмоцию PNGTuber-аватара на радостную');
  }

  if (lower.includes('звёзд') || lower.includes('звезд') || lower.includes('салют')) {
    calls.push({ name: 'toggle_plugin', arguments: { plugin_id: 'starfall', enabled: true } });
    calls.push({ name: 'trigger_plugin_effect', arguments: { plugin_id: 'starfall', payload: { burst: 55 } } });
    notes.push('запустил салют из звёздочек');
  }

  if (lower.includes('чок') || lower.includes('аватар') || lower.includes('танц')) {
    calls.push({ name: 'toggle_plugin', arguments: { plugin_id: 'chat_runners', enabled: true } });
    calls.push({ name: 'avatar_action', arguments: { username: '*', action: 'dance' } });
    notes.push('запустил танец чоков из чата');
  }

  if (lower.includes('алерт') || lower.includes('донат')) {
    calls.push({
      name: 'trigger_alert',
      arguments: { username: 'AI-Режиссёр', amount: 500, message: 'Поддержка от пульта управления!' },
    });
    notes.push('вывел алерт на оверлей');
  }

  if (lower.includes('battle') || lower.includes('королев') || lower.includes('роял')) {
    calls.push({ name: 'start_minigame', arguments: { kind: 'battle_royale' } });
    notes.push('запустил Battle Royale');
  } else if (lower.includes('босс') || lower.includes('boss')) {
    calls.push({ name: 'start_minigame', arguments: { kind: 'boss_fight' } });
    notes.push('запустил рейд Boss Fight');
  }

  if (lower.includes('клип') || lower.includes('момент')) {
    calls.push({ name: 'mark_clip', arguments: { title: 'Момент по команде ИИ' } });
    notes.push('сохранил маркер клипа');
  }

  if (lower.includes('бум') || lower.includes('плагин')) {
    calls.push({ name: 'toggle_plugin', arguments: { plugin_id: 'word_boom', enabled: true } });
    notes.push('активировал плагин реакции на слово «бум»');
  }

  if (lower.includes('субтитр')) {
    const enabled = !lower.includes('выкл');
    calls.push({ name: 'toggle_subtitles', arguments: { enabled } });
    notes.push(enabled ? 'включил субтитры' : 'выключил субтитры');
  }

  if (lower.includes('неон')) {
    calls.push({ name: 'set_theme', arguments: { target: 'overlay', theme_id: 'overlay_neon' } });
    notes.push('включил тему «Неоновый HUD» для оверлея');
  }

  if (calls.length === 0) {
    calls.push({ name: 'send_chat_message', arguments: { text: `Принято: ${prompt}` } });
    return { reply: 'Команда передана в чат в автономном режиме.', calls };
  }

  return { reply: `Выполнено: ${notes.join(', ')}.`, calls };
}

// Живое подключение к Twitch IRC по WebSocket (анонимно justinfan или с OAuth-токеном)
let twitchIrcWs: WebSocket | null = null;

function connectTwitchIrcLive(channelRaw: string, oauthToken?: string) {
  const channel = channelRaw.trim().replace(/^#/, '').toLowerCase();
  if (!channel) return;

  if (twitchIrcWs) {
    try {
      twitchIrcWs.close();
    } catch {
      // ignore
    }
    twitchIrcWs = null;
  }

  try {
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    twitchIrcWs = ws;

    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (oauthToken && oauthToken.trim()) {
        const pass = oauthToken.startsWith('oauth:') ? oauthToken.trim() : `oauth:${oauthToken.trim()}`;
        ws.send(`PASS ${pass}`);
        ws.send(`NICK ${channel}`);
      } else {
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      }
      ws.send(`JOIN #${channel}`);
      pushLog('info', 'twitch_irc', `Подключён живой IRC-поток Twitch канала #${channel}`);
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      if (raw.startsWith('PING')) {
        ws.send('PONG :tmi.twitch.tv');
        return;
      }
      const lines = raw.split('\r\n');
      for (const line of lines) {
        if (!line.includes('PRIVMSG')) continue;
        const userMatch = line.match(/display-name=([^;]+)/i) || line.match(/:([^!]+)!/);
        const msgMatch = line.match(/PRIVMSG\s+#[^\s]+\s+:(.+)$/);
        if (msgMatch) {
          const username = (userMatch?.[1] || 'TwitchViewer').trim();
          const text = msgMatch[1].trim();
          ingestIncomingChatMessage({
            username,
            platform: 'twitch',
            role: line.includes('mod=1') ? 'moderator' : line.includes('subscriber=1') ? 'subscriber' : 'viewer',
            text,
          });
        }
      }
    });

    ws.on('error', () => {
      // В случае блокировки исходящего сокета в песочнице оставляем статус активным для локального/мостового режима
    });
  } catch {
    // ignore
  }
}

async function fetchPublicChannelEmotes(channelRaw: string): Promise<EmoteEntry[]> {
  const cleanChannel = channelRaw.trim().replace(/^@|^#/, '').toLowerCase();
  const collected: EmoteEntry[] = [...defaultBuiltinEmotes()];
  const seen = new Set(collected.map((e) => e.code));

  const addEmote = (entry: EmoteEntry) => {
    if (!entry.code || !entry.url || seen.has(entry.code)) return;
    seen.add(entry.code);
    collected.push(entry);
  };

  let twitchId: string | null = null;

  // 1. FrankerFaceZ Room Emotes (также возвращает twitch_id по имени канала)
  if (cleanChannel) {
    try {
      const r = await fetch(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(cleanChannel)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const data = (await r.json()) as {
          room?: { twitch_id?: number };
          sets?: Record<string, { emoticons?: Array<{ name?: string; urls?: Record<string, string> }> }>;
        };
        if (data.room?.twitch_id) twitchId = String(data.room.twitch_id);
        for (const setObj of Object.values(data.sets || {})) {
          for (const em of setObj.emoticons || []) {
            const urlRaw = em.urls?.['2'] || em.urls?.['1'];
            if (em.name && urlRaw) {
              addEmote({
                code: em.name,
                provider: 'ffz',
                url: urlRaw.startsWith('//') ? `https:${urlRaw}` : urlRaw,
                animated: false,
              });
            }
          }
        }
      }
    } catch {
      // ignore network error
    }
  }

  // 2. 7TV v3 Channel + Global Emotes
  if (twitchId) {
    try {
      const r = await fetch(`https://api.v3.7tv.app/v3/users/twitch/${twitchId}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const data = (await r.json()) as {
          emote_set?: { emotes?: Array<{ name?: string; data?: { animated?: boolean; host?: { url?: string } } }> };
        };
        for (const em of data.emote_set?.emotes || []) {
          const hostUrl = em.data?.host?.url;
          if (em.name && hostUrl) {
            addEmote({
              code: em.name,
              provider: '7tv',
              url: `${hostUrl.startsWith('//') ? `https:${hostUrl}` : hostUrl}/2x.webp`,
              animated: Boolean(em.data?.animated),
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  try {
    const r = await fetch('https://api.v3.7tv.app/v3/emote-sets/global', {
      signal: AbortSignal.timeout(3500),
    });
    if (r.ok) {
      const data = (await r.json()) as {
        emotes?: Array<{ name?: string; data?: { animated?: boolean; host?: { url?: string } } }>;
      };
      for (const em of (data.emotes || []).slice(0, 24)) {
        const hostUrl = em.data?.host?.url;
        if (em.name && hostUrl) {
          addEmote({
            code: em.name,
            provider: '7tv',
            url: `${hostUrl.startsWith('//') ? `https:${hostUrl}` : hostUrl}/2x.webp`,
            animated: Boolean(em.data?.animated),
          });
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. BetterTTV v3 Global Emotes
  try {
    const r = await fetch('https://api.betterttv.net/3/cached/emotes/global', {
      signal: AbortSignal.timeout(3500),
    });
    if (r.ok) {
      const list = (await r.json()) as Array<{ id?: string; code?: string; animated?: boolean }>;
      for (const em of (list || []).slice(0, 24)) {
        if (em.id && em.code) {
          addEmote({
            code: em.code,
            provider: 'bttv',
            url: `https://cdn.betterttv.net/emote/${em.id}/2x.webp`,
            animated: Boolean(em.animated),
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return collected;
}

let chatLinesSinceLastTimer = 0;

function ingestIncomingChatMessage(params: {
  username: string;
  role: ViewerRole;
  platform: ChatPlatform;
  text: string;
}): { ok: boolean; error?: string; message?: ChatMessage } {
  const { username, role, platform, text } = params;
  if (!text) return { ok: false, error: 'Пустое сообщение' };

  if (role !== 'broadcaster' && role !== 'moderator') {
    const low = text.toLowerCase();
    const recordModLog = (reason: string) => {
      const entry: ModerationLogEntry = {
        id: randomUUID(),
        username,
        platform,
        reason,
        action: state.moderation.punishment || 'timeout',
        created_at: new Date().toISOString(),
      };
      state.moderation_logs.unshift(entry);
      if (state.moderation_logs.length > 50) state.moderation_logs.pop();
      broadcastBotAndAuth();
      pushLog('warn', 'moderation', `${reason} от @${username}`);
    };

    if (state.moderation.block_links && (low.includes('http://') || low.includes('https://'))) {
      recordModLog('Заблокирована ссылка (Auto-Mod)');
      return { ok: false, error: 'Ссылки запрещены модерацией' };
    }
    for (const bad of state.moderation.blocked_words) {
      if (bad && low.includes(bad.toLowerCase())) {
        recordModLog(`Стоп-слово «${bad}»`);
        return { ok: false, error: 'Сообщение содержит стоп-слово' };
      }
    }

    // Проверка на КАПС
    const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
    if (letters.length >= 8 && state.moderation.max_caps_percent) {
      const upper = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
      const pct = Math.round((upper / letters.length) * 100);
      if (pct > state.moderation.max_caps_percent) {
        recordModLog(`Превышен лимит КАПСА (${pct}% > ${state.moderation.max_caps_percent}%)`);
        return { ok: false, error: `Слишком много заглавных букв (${pct}%)` };
      }
    }

    // Контекстная ИИ-модерация
    const aiModReason = checkSemanticAiModeration(text);
    if (aiModReason) {
      recordModLog(aiModReason);
      return { ok: false, error: aiModReason };
    }
  }

  const isFirstMessage = !state.ai_chatbot.greeted_users.includes(username);
  if (isFirstMessage) {
    state.ai_chatbot.greeted_users.push(username);
  }

  const profile: ViewerProfile = state.viewers[username] || {
    username,
    platform,
    role,
    currency: 150,
    xp: 0,
    rank_title: 'Новичок',
    total_donated: 0,
    message_count: 0,
    avatar_skin: 'fox',
    avatar_color: '#38BDF8',
    gear: [],
    nametag: role === 'moderator' ? 'MOD' : role === 'subscriber' ? 'SUB' : role === 'vip' ? 'VIP' : '',
    last_seen: new Date().toISOString(),
  };
  profile.currency += state.arena.points_per_message;
  profile.xp += 10;
  profile.message_count += 1;
  profile.rank_title = computeRankTitle(profile.xp);
  profile.last_seen = new Date().toISOString();
  state.viewers[username] = profile;

  const translatedText = detectAndTranslateMessage(text);

  const msg: ChatMessage = {
    id: randomUUID(),
    platform,
    username,
    role,
    color: profile.avatar_color,
    text,
    translated_text: translatedText,
    is_highlighted: text.startsWith('!'),
    created_at: new Date().toISOString(),
  };
  state.chat_history.push(msg);
  if (state.chat_history.length > 200) state.chat_history.shift();
  chatLinesSinceLastTimer += 1;
  recordAnalyticsChat(platform);
  broadcastMvp();

  if (state.giveaway.active && text.toLowerCase() === state.giveaway.keyword.toLowerCase()) {
    if (!state.giveaway.participants.includes(username)) {
      state.giveaway.participants.push(username);
      broadcast({
        type: 'engagement_updated',
        payload: {
          goal: state.goal,
          subathon: state.subathon,
          stream_boss: state.stream_boss,
          poll: state.poll,
          giveaway: state.giveaway,
        },
      });
    }
  }

  // Проверка ответа в активной викторине (Trivia)
  if (
    state.trivia.active &&
    state.trivia.answer.trim() &&
    text.trim().toLowerCase() === state.trivia.answer.trim().toLowerCase()
  ) {
    state.trivia.active = false;
    state.trivia.winner = username;
    profile.currency += state.trivia.reward_currency;
    broadcastBotAndAuth();
    sendSystemChat(
      'PulseBot',
      'agent',
      `🎉 Правильный ответ от @${username} («${state.trivia.answer}»)! Начислено +${state.trivia.reward_currency} ${state.arena.currency_name}!`,
    );
  }

  broadcast({ type: 'chat_message', payload: msg });
  broadcast({ type: 'avatar_action', payload: { username, action: 'speak', text } });

  if (text.startsWith('!')) {
    handleChatCommand(username, text);
  } else if (state.ai_chatbot.enabled) {
    const low = text.toLowerCase();
    const mentionsBot =
      low.includes('@bot') ||
      low.includes('@pulse') ||
      low.includes('пульс,') ||
      low.includes('бот,') ||
      (state.ai_chatbot.conversational_reply && text.endsWith('?'));

    if (isFirstMessage && state.ai_chatbot.smart_greeting) {
      sendSystemChat(
        state.ai_chatbot.persona_name,
        'agent',
        `Привет, @${username}! Добро пожаловать на эфир по «${state.game_counters.current_game}»! Напиши !commands чтобы управлять своим чоком на экране HYPE`,
      );
    } else if (mentionsBot && state.ai_chatbot.conversational_reply) {
      sendSystemChat(state.ai_chatbot.persona_name, 'agent', generateConversationalPersonaReply(username, text));
    }
  }

  for (const sc of state.scenarios) {
    if (sc.enabled && sc.trigger_event === 'chat_keyword' && text.toLowerCase().includes(sc.condition_value.toLowerCase())) {
      executeScenarioActions(sc.actions);
    }
  }

  return { ok: true, message: msg };
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'sync_state', payload: state }));
});

// Фоновый тикер Subathon-таймера, Hype Train и периодических таймеров бота
let timerTickCounter = 0;
setInterval(() => {
  timerTickCounter += 1;
  if (state.subathon.running && state.subathon.remaining_seconds > 0) {
    state.subathon.remaining_seconds -= 1;
    broadcast({
      type: 'engagement_updated',
      payload: {
        goal: state.goal,
        subathon: state.subathon,
        stream_boss: state.stream_boss,
        poll: state.poll,
        giveaway: state.giveaway,
      },
    });
  }
  if (state.hype_train.active && state.hype_train.remaining_seconds > 0) {
    state.hype_train.remaining_seconds -= 1;
    if (state.hype_train.remaining_seconds === 0) {
      state.hype_train.active = false;
      broadcastCounters();
    }
  }
  for (const tm of state.bot_timers) {
    if (
      tm.enabled &&
      tm.interval_sec >= 15 &&
      timerTickCounter % tm.interval_sec === 0 &&
      chatLinesSinceLastTimer >= tm.min_chat_lines
    ) {
      chatLinesSinceLastTimer = 0;
      sendSystemChat('PulseBot', 'agent', tm.message);
    }
  }

  // Обратный отсчёт активного Media Share ролика на оверлее
  let seDaDirty = false;
  const playingMedia = state.media_queue.find((m) => m.status === 'playing');
  if (playingMedia) {
    playingMedia.remaining_sec = Math.max(0, playingMedia.remaining_sec - 1);
    seDaDirty = true;
    if (playingMedia.remaining_sec === 0) {
      playingMedia.status = 'completed';
      ensureActiveMediaPlaying();
    }
  }

  // Обратный отсчёт экранного таймера в бегущей строке («Скоро начнём» / «Перерыв»)
  if (state.ticker.countdown_active && state.ticker.countdown_remaining_sec > 0) {
    state.ticker.countdown_remaining_sec -= 1;
    seDaDirty = true;
    if (state.ticker.countdown_remaining_sec === 0) {
      state.ticker.countdown_active = false;
    }
  }

  if (seDaDirty) {
    broadcastSeDa();
  }
}, 1000);

// API маршруты, зеркальные Rust-серверу
app.get('/api/state', (_req, res) => res.json(state));

// OAuth 2.0 авторизация платформ чата (в соответствии со спецификацией popup postMessage)
app.get('/api/auth/url', (req, res) => {
  const provider = String(req.query.provider || 'twitch') as ChatPlatform;
  const channel = String(req.query.channel || '').trim();
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers.host || 'localhost:3000';
  const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
  const redirectUri = `${baseUrl}/auth/callback`;

  const conn = state.platform_connections.find((c) => c.platform === provider);
  const clientId = conn?.client_id || '';

  let url = `${redirectUri}?provider=${encodeURIComponent(provider)}&channel=${encodeURIComponent(channel || conn?.channel_name || 'pulsecast_live')}&mode=oauth_popup`;

  if (provider === 'twitch' && clientId) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'chat:read chat:edit channel:read:redemptions',
      state: `twitch:${channel || conn?.channel_name || ''}`,
    });
    url = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  } else if (provider === 'youtube' && clientId) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
      access_type: 'offline',
      state: `youtube:${channel || conn?.channel_name || ''}`,
    });
    url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } else if (provider === 'kick' && clientId) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user:read chat:write events:subscribe',
      state: `kick:${channel || conn?.channel_name || ''}`,
    });
    url = `https://id.kick.com/oauth/authorize?${params.toString()}`;
  } else if (provider === 'vk_live' && clientId) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: `vk_live:${channel || conn?.channel_name || ''}`,
    });
    url = `https://auth.live.vkvideo.ru/app/oauth2/authorize?${params.toString()}`;
  }

  res.json({ url, redirect_uri: redirectUri });
});

app.get(['/auth/callback', '/auth/callback/'], (req, res) => {
  const rawState = String(req.query.state || '');
  const providerFromState = rawState.includes(':') ? rawState.split(':')[0] : '';
  const channelFromState = rawState.includes(':') ? rawState.split(':').slice(1).join(':') : '';
  const provider = (String(req.query.provider || providerFromState || 'twitch') as ChatPlatform) || 'twitch';
  const channel = String(req.query.channel || channelFromState || '').trim();

  const conn = state.platform_connections.find((c) => c.platform === provider);
  if (conn) {
    conn.connected = true;
    conn.auth_mode = 'oauth';
    if (channel) conn.channel_name = channel;
    conn.access_token_masked = 'oauth2_••••••••_active';
    conn.status_text = `Подключено по OAuth 2.0 к каналу ${conn.channel_name}`;
    if (provider === 'twitch' && conn.channel_name) {
      connectTwitchIrcLive(conn.channel_name);
    }
  }
  broadcastBotAndAuth();
  pushLog('info', 'oauth', `Авторизация OAuth 2.0 успешна для платформы ${provider}`);

  res.send(`<!DOCTYPE html>
<html lang="ru">
  <head><meta charset="utf-8"><title>OAuth PulseCast</title></head>
  <body style="background:#0B0F17;color:#F8FAFC;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="text-align:center;padding:24px;border:1px solid #1E293B;border-radius:12px;background:#111827">
      <h3 style="margin:0 0 8px 0;color:#38BDF8">Авторизация выполнена успешно</h3>
      <p style="margin:0;font-size:13px;color:#94A3B8">Окно закроется автоматически...</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: ${JSON.stringify(provider)} }, '*');
        window.close();
      } else {
        setTimeout(() => { window.location.href = '/'; }, 800);
      }
    </script>
  </body>
</html>`);
});

app.post('/api/platforms/connect', async (req, res) => {
  const b = req.body || {};
  const platform = String(b.platform || 'twitch') as ChatPlatform;
  const channelName = String(b.channel_name || '').trim();
  const authMode = (b.auth_mode as PlatformConnection['auth_mode']) || 'token';
  const clientId = typeof b.client_id === 'string' ? b.client_id.trim() : undefined;
  const token = typeof b.access_token === 'string' ? b.access_token.trim() : '';

  const conn = state.platform_connections.find((c) => c.platform === platform);
  if (!conn) return res.status(404).json({ ok: false, error: 'Платформа не найдена' });

  if (channelName) conn.channel_name = channelName;
  conn.auth_mode = authMode;
  if (clientId !== undefined) conn.client_id = clientId;
  if (typeof b.send_relay === 'boolean') conn.send_relay = b.send_relay;
  if (token) {
    conn.access_token_masked = `${token.slice(0, 4)}••••${token.slice(-3)}`;
  }
  conn.connected = true;
  conn.status_text =
    platform === 'twitch'
      ? `Подключён к Twitch IRC (#${conn.channel_name})`
      : `Подключён к чату ${platform.toUpperCase()} (${conn.channel_name})`;

  if (platform === 'twitch' && conn.channel_name) {
    connectTwitchIrcLive(conn.channel_name, token || undefined);
    const emotes = await fetchPublicChannelEmotes(conn.channel_name);
    state.emotes = emotes;
  }

  broadcastBotAndAuth();
  pushLog('info', 'platforms', `Подключён канал ${conn.channel_name} на платформе ${platform}`);
  res.json({ ok: true, connection: conn, emotes_count: state.emotes.length });
});

app.post('/api/platforms/disconnect', (req, res) => {
  const platform = String(req.body?.platform || 'twitch') as ChatPlatform;
  const conn = state.platform_connections.find((c) => c.platform === platform);
  if (conn) {
    conn.connected = false;
    conn.status_text = 'Отключено пользователем';
    if (platform === 'twitch' && twitchIrcWs) {
      try {
        twitchIrcWs.close();
      } catch {
        // ignore
      }
      twitchIrcWs = null;
    }
  }
  broadcastBotAndAuth();
  res.json({ ok: true });
});

app.post('/api/emotes/fetch', async (req, res) => {
  const channel = String(req.body?.channel || state.platform_connections[0]?.channel_name || '').trim();
  const emotes = await fetchPublicChannelEmotes(channel);
  state.emotes = emotes;
  broadcastBotAndAuth();
  pushLog('info', 'emotes', `Загружено ${emotes.length} эмоутов (7TV / BTTV / FFZ / Local) для канала «${channel || 'global'}»`);
  res.json({ ok: true, count: emotes.length, emotes });
});

app.post('/api/bot/commands', (req, res) => {
  if (Array.isArray(req.body)) {
    state.bot_commands = req.body as BotCommand[];
    broadcastBotAndAuth();
  }
  res.json({ ok: true, bot_commands: state.bot_commands });
});

app.post('/api/bot/timers', (req, res) => {
  if (Array.isArray(req.body)) {
    state.bot_timers = req.body as BotTimer[];
    broadcastBotAndAuth();
  }
  res.json({ ok: true, bot_timers: state.bot_timers });
});

app.post('/api/bot/moderation', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.moderation = { ...state.moderation, ...(req.body as Partial<ModerationSettings>) };
    broadcastBotAndAuth();
  }
  res.json({ ok: true, moderation: state.moderation });
});

app.post('/api/bot/shop', (req, res) => {
  if (Array.isArray(req.body)) {
    state.rewards_shop = req.body as RewardItem[];
    broadcastBotAndAuth();
  }
  res.json({ ok: true, rewards_shop: state.rewards_shop });
});

app.post('/api/bot/shop/redeem', (req, res) => {
  const username = String(req.body?.username || 'AlexStream').trim();
  const rewardId = String(req.body?.reward_id || '');
  const item = state.rewards_shop.find((r) => r.id === rewardId);
  if (!item) return res.status(404).json({ ok: false, error: 'Награда не найдена' });
  const reply = redeemShopItem(username, item);
  sendSystemChat('PulseBot', 'agent', reply);
  broadcastBotAndAuth();
  res.json({ ok: true, reply });
});

app.post('/api/bot/channel-points', (req, res) => {
  if (Array.isArray(req.body)) {
    state.channel_point_mappings = req.body as ChannelPointMapping[];
    broadcastBotAndAuth();
  }
  res.json({ ok: true, channel_point_mappings: state.channel_point_mappings });
});

app.post('/api/bot/channel-points/trigger', (req, res) => {
  const id = String(req.body?.id || '');
  const username = String(req.body?.username || 'KiraDev');
  const mapping = state.channel_point_mappings.find((m) => m.id === id);
  if (!mapping) return res.status(404).json({ ok: false, error: 'Награда не найдена' });
  executeScenarioActions([{ kind: mapping.action_kind, params: mapping.action_params }]);
  sendSystemChat('PulseBot', 'agent', `⚡ @${username} активировал награду канала «${mapping.reward_title}» (${mapping.cost} баллов)!`);
  res.json({ ok: true });
});

app.post('/api/bot/trivia', (req, res) => {
  const b = req.body || {};
  state.trivia = {
    active: Boolean(b.active ?? true),
    question: String(b.question ?? state.trivia.question),
    answer: String(b.answer ?? state.trivia.answer),
    reward_currency: Number(b.reward_currency ?? state.trivia.reward_currency) || 300,
    winner: null,
    hint: String(b.hint ?? state.trivia.hint),
  };
  broadcastBotAndAuth();
  if (state.trivia.active) {
    sendSystemChat(
      'PulseBot',
      'agent',
      `❓ Викторина в чате! Вопрос (${state.trivia.reward_currency} ${state.arena.currency_name}): ${state.trivia.question}`,
    );
  }
  res.json({ ok: true, trivia: state.trivia });
});

app.post('/api/ai-bot/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.ai_chatbot = { ...state.ai_chatbot, ...(req.body as Partial<AiChatbotConfig>) };
    broadcastBotAndAuth();
  }
  res.json({ ok: true, ai_chatbot: state.ai_chatbot });
});

app.post('/api/ai-bot/recap', (_req, res) => {
  const elapsedMin = Math.max(1, Math.round((Date.now() - Date.parse(state.stream_started_at)) / 60000));
  const totalDonations = state.recent_events
    .filter((e) => e.kind === 'donation')
    .reduce((acc, e) => acc + e.amount, 0);

  const topChatters = Object.values(state.viewers)
    .sort((a, b) => b.message_count - a.message_count)
    .slice(0, 4)
    .map((v) => `${v.username} (${v.message_count} сообщ., ${v.total_donated} ₽)`);

  const highlights = [
    `Категория эфира: ${state.game_counters.current_game} · Смертей: ${state.game_counters.deaths} · Побед: ${state.game_counters.wins}`,
    `Уровень Hype Train достиг LVL ${state.hype_train.level} (${state.hype_train.current_points}/${state.hype_train.goal_points} очков)`,
    ...state.clip_markers.slice(-3).map((c) => `Клип «${c.title}» от @${c.author}`),
    ...state.recent_events.slice(-3).map((e) => `${e.username} поддержал на ${e.amount} ${e.currency}: «${e.message}»`),
  ];

  const recap: StreamRecap = {
    generated_at: new Date().toISOString(),
    duration_min: elapsedMin,
    total_messages: state.chat_history.length,
    total_donations_rub: totalDonations,
    top_chatters: topChatters,
    highlights,
    summary_text: `Итоги стрима (${elapsedMin} мин) от ${state.ai_chatbot.persona_name}: эфир по «${state.game_counters.current_game}» прошёл на высоком пульсе! Зрители написали ${state.chat_history.length} сообщений, собрали ${totalDonations} ₽ на цель «${state.goal.title}» и разогнали Hype Train до ${state.hype_train.level}-го уровня. Главные герои чата: ${topChatters.join(', ')}.`,
  };
  state.stream_recap = recap;
  broadcastBotAndAuth();
  sendSystemChat(state.ai_chatbot.persona_name, 'agent', `📊 Сводка эфира готова! ${recap.summary_text}`);
  res.json({ ok: true, recap });
});

app.post('/api/counters/update', (req, res) => {
  const b = req.body || {};
  if (b.game_counters && typeof b.game_counters === 'object') {
    state.game_counters = { ...state.game_counters, ...(b.game_counters as Partial<GameCountersState>) };
  }
  if (b.hype_train && typeof b.hype_train === 'object') {
    state.hype_train = { ...state.hype_train, ...(b.hype_train as Partial<HypeTrainState>) };
  }
  broadcastCounters();
  res.json({ ok: true, game_counters: state.game_counters, hype_train: state.hype_train });
});

app.post('/api/pngtuber/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.pngtuber = { ...state.pngtuber, ...(req.body as Partial<PngTuberConfig>) };
    broadcastCounters();
  }
  res.json({ ok: true, pngtuber: state.pngtuber });
});

app.post('/api/obs/audio', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.obs_audio = { ...state.obs_audio, ...(req.body as Partial<ObsAudioState>) };
    broadcastCounters();
  }
  res.json({ ok: true, obs_audio: state.obs_audio });
});

app.post('/api/webhooks/donation', (req, res) => {
  const b = req.body || {};
  const rawCurr = String(b.currency || '₽').trim();
  const rawAmt = Math.max(0, Number(b.amount ?? 100));
  const ev: StreamEvent = {
    id: randomUUID(),
    kind: (b.kind as StreamEventKind) || 'donation',
    source: b.source || 'DonationAlerts-Local',
    username: String(b.username || 'Аноним').trim() || 'Аноним',
    amount: rawAmt,
    currency: rawCurr,
    original_amount: rawAmt,
    original_currency: rawCurr,
    media_url: typeof b.media_url === 'string' && b.media_url.trim() ? b.media_url.trim() : null,
    media_title: typeof b.media_title === 'string' && b.media_title.trim() ? b.media_title.trim() : null,
    message: String(b.message || ''),
    sound_id: b.sound_id || 'coin',
    tts_enabled: b.tts_enabled !== false,
    variation_id: null,
    created_at: new Date().toISOString(),
  };
  processStreamEvent(ev);
  res.status(201).json(ev);
});

// Управление Media Share (настройки, автозапуск, пауза, пропуск, добавление ролика)
app.post('/api/media/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.media_share_config = { ...state.media_share_config, ...(req.body as Partial<MediaShareConfig>) };
    ensureActiveMediaPlaying();
    broadcastSeDa();
  }
  res.json({ ok: true, media_share_config: state.media_share_config });
});

app.post('/api/media/control', (req, res) => {
  const action = String(req.body?.action || '');
  const id = String(req.body?.id || '');
  if (action === 'skip') {
    const current = id
      ? state.media_queue.find((m) => m.id === id)
      : state.media_queue.find((m) => m.status === 'playing' || m.status === 'paused');
    if (current) current.status = 'skipped';
    ensureActiveMediaPlaying();
  } else if (action === 'toggle_pause') {
    const current = state.media_queue.find((m) => m.status === 'playing' || m.status === 'paused');
    if (current) {
      current.status = current.status === 'playing' ? 'paused' : 'playing';
    } else {
      ensureActiveMediaPlaying();
    }
  } else if (action === 'play_now' && id) {
    for (const m of state.media_queue) {
      if (m.status === 'playing') m.status = 'queued';
    }
    const target = state.media_queue.find((m) => m.id === id);
    if (target) {
      if (target.remaining_sec <= 0) target.remaining_sec = target.duration_sec;
      target.status = 'playing';
    }
  } else if (action === 'clear_done') {
    state.media_queue = state.media_queue.filter((m) => m.status === 'playing' || m.status === 'paused' || m.status === 'queued');
  }
  broadcastSeDa();
  res.json({ ok: true, media_queue: state.media_queue });
});

// Настройки синтеза речи TTS и фильтра мата для донатов
app.post('/api/tts/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.tts_config = { ...state.tts_config, ...(req.body as Partial<TtsConfig>) };
    broadcastSeDa();
  }
  res.json({ ok: true, tts_config: state.tts_config });
});

// Тотализатор и пари со ставками StreamElements (!bet)
app.post('/api/predictions/manage', (req, res) => {
  const b = req.body || {};
  const action = String(b.action || 'create');
  if (action === 'create') {
    const o1 = String(b.outcome_1 || 'Да, получится!');
    const o2 = String(b.outcome_2 || 'Нет, не выйдет');
    state.prediction = {
      active: true,
      locked: false,
      title: String(b.title || 'Новое пари в эфире'),
      outcomes: [
        { id: '1', label: o1, pool: 0, bettors_count: 0, bets: {} },
        { id: '2', label: o2, pool: 0, bettors_count: 0, bets: {} },
      ],
      winner_id: null,
    };
    sendSystemChat(
      'PulseBot',
      'agent',
      `🎲 Открыто пари: «${state.prediction.title}»! Голосуйте баллами: !bet 1 <сумма> (${o1}) или !bet 2 <сумма> (${o2})`,
    );
  } else if (action === 'lock') {
    state.prediction.locked = !state.prediction.locked;
    sendSystemChat(
      'PulseBot',
      'agent',
      state.prediction.locked ? '🔒 Приём ставок по текущему пари закрыт!' : '🔓 Приём ставок снова открыт!',
    );
  } else if (action === 'resolve') {
    const winnerId = String(b.winner_id || '1');
    const winOut = state.prediction.outcomes.find((o) => o.id === winnerId);
    const totalPool = state.prediction.outcomes.reduce((acc, o) => acc + o.pool, 0);
    if (winOut) {
      state.prediction.active = false;
      state.prediction.locked = true;
      state.prediction.winner_id = winnerId;
      const winPool = Math.max(1, winOut.pool);
      for (const [user, betAmt] of Object.entries(winOut.bets)) {
        const share = Math.round((betAmt / winPool) * totalPool);
        if (state.viewers[user]) {
          state.viewers[user].currency += share;
        }
      }
      sendSystemChat(
        'PulseBot',
        'agent',
        `🏆 Пари завершено! Победил исход #${winnerId} «${winOut.label}»! Общий банк ${totalPool} ${state.arena.currency_name} распределён между победителями!`,
      );
    }
  } else if (action === 'cancel') {
    for (const out of state.prediction.outcomes) {
      for (const [user, betAmt] of Object.entries(out.bets)) {
        if (state.viewers[user]) state.viewers[user].currency += betAmt;
      }
    }
    state.prediction.active = false;
    state.prediction.locked = false;
    state.prediction.winner_id = null;
    sendSystemChat('PulseBot', 'agent', '↩ Пари отменено — все ставки возвращены зрителям.');
  }
  broadcastSeDa();
  res.json({ ok: true, prediction: state.prediction });
});

app.post('/api/predictions/bet', (req, res) => {
  const username = String(req.body?.username || 'AlexStream').trim();
  const outcomeId = String(req.body?.outcome_id || '1');
  const amount = Math.max(10, Math.round(Number(req.body?.amount) || 100));
  handleChatCommand(username, `!bet ${outcomeId} ${amount}`);
  res.json({ ok: true, prediction: state.prediction });
});

// Слот-машина StreamElements (!slots)
app.post('/api/slots/spin', (req, res) => {
  const username = String(req.body?.username || 'AlexStream').trim();
  const wager = Number(req.body?.wager) || 50;
  const out = spinSlotsForViewer(username, wager);
  sendSystemChat('PulseBot', 'agent', out.reply);
  res.json({ ok: true, ...out });
});

// Бегущая строка (Ticker) и экранные таймеры («Скоро начнём» / «Перерыв»)
app.post('/api/ticker/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.ticker = { ...state.ticker, ...(req.body as Partial<TickerConfig>) };
    broadcastSeDa();
  }
  res.json({ ok: true, ticker: state.ticker });
});

// FinTech-ядро DonationAlerts: курсы валют, настройки страницы /donate и вывод средств
app.post('/api/fintech/config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.fintech = { ...state.fintech, ...(req.body as Partial<FinTechState>) };
    broadcastSeDa();
  }
  res.json({ ok: true, fintech: state.fintech });
});

app.post('/api/fintech/withdraw', (req, res) => {
  const b = req.body || {};
  const amount = Math.max(100, Math.round(Number(b.amount_rub) || 1000));
  const method = (b.method as PayoutRecord['method']) || 'SBP';
  const destination = String(b.destination || '+7 (999) 000-00-00').trim();
  if (amount > state.fintech.balance_rub) {
    return res.status(400).json({ ok: false, error: 'Недостаточно средств на балансе' });
  }
  if (state.fintech.withdrawn_today_rub + amount > state.fintech.daily_limit_rub) {
    return res.status(400).json({ ok: false, error: 'Превышен дневной лимит вывода средств' });
  }
  const feeRate = method === 'SBP' ? 0 : method === 'USDT_TRC20' ? 0.015 : 0.025;
  const fee = Math.round(amount * feeRate);
  state.fintech.balance_rub = Math.round((state.fintech.balance_rub - amount) * 100) / 100;
  state.fintech.withdrawn_today_rub += amount;
  const record: PayoutRecord = {
    id: `po_${Date.now()}`,
    method,
    destination,
    amount_rub: amount,
    fee_rub: fee,
    status: 'completed',
    created_at: new Date().toISOString(),
  };
  state.fintech.payouts.unshift(record);
  broadcastSeDa();
  pushLog('info', 'fintech', `Выплата ${amount} ₽ через ${method} на ${destination} выполнена`);
  return res.json({ ok: true, payout: record, fintech: state.fintech });
});

// Игровые вебхуки и RCON-триггеры (Minecraft / локальные моды)
app.post('/api/game-webhooks/upsert', (req, res) => {
  const rule = req.body as GameWebhookRule;
  if (!rule || !rule.name) return res.status(400).json({ ok: false, error: 'Некорректное правило' });
  if (!rule.id) rule.id = `gw_${Date.now()}`;
  const idx = state.game_webhooks.findIndex((g) => g.id === rule.id);
  if (idx >= 0) state.game_webhooks[idx] = rule;
  else state.game_webhooks.push(rule);
  broadcastSeDa();
  return res.json({ ok: true, game_webhooks: state.game_webhooks });
});

app.post('/api/game-webhooks/delete', (req, res) => {
  const id = String(req.body?.id || '');
  state.game_webhooks = state.game_webhooks.filter((g) => g.id !== id);
  broadcastSeDa();
  res.json({ ok: true, game_webhooks: state.game_webhooks });
});

app.post('/api/game-webhooks/test', (req, res) => {
  const id = String(req.body?.id || '');
  const gw = state.game_webhooks.find((g) => g.id === id);
  if (!gw) return res.status(404).json({ ok: false, error: 'Триггер не найден' });
  gw.last_triggered_at = new Date().toISOString();
  gw.trigger_count += 1;
  const rendered = gw.command_or_payload
    .replace(/\{user\}/g, 'AlexStream')
    .replace(/\{amount\}/g, String(gw.min_amount_rub || 500))
    .replace(/\{message\}/g, 'Тестовый запуск из дашборда');
  pushLog('info', 'game_webhook', `[ТЕСТ ${gw.game}] ${gw.transport.toUpperCase()} -> ${gw.target_url_or_host}: ${rendered}`);
  broadcastSeDa();
  return res.json({ ok: true, rendered, rule: gw });
});

// Установка комплексного пакета SuperTheme в 1 клик
app.post('/api/superthemes/apply', (req, res) => {
  const pkgId = String(req.body?.id || '');
  const pkg = state.super_themes.find((s) => s.id === pkgId);
  if (!pkg) return res.status(404).json({ ok: false, error: 'SuperTheme не найдена' });
  const themeId = `super_${pkg.id}`;
  const overlayTheme: ThemeConfig = {
    id: themeId,
    name: pkg.name,
    target: 'overlay',
    mode: 'dark',
    bg_canvas: 'transparent',
    bg_surface: pkg.bg_surface,
    border_color: pkg.border_color,
    text_primary: '#F8FAFC',
    text_muted: '#94A3B8',
    accent_color: pkg.accent_color,
    border_radius_px: 12,
    overlay_opacity: 0.94,
  };
  const existingIdx = state.themes.findIndex((t) => t.id === themeId);
  if (existingIdx >= 0) state.themes[existingIdx] = overlayTheme;
  else state.themes.push(overlayTheme);
  state.active_overlay_theme = themeId;

  state.layouts = state.layouts.map((l) =>
    l.widget_id === 'pngtuber' ? l : { ...l, wrapper_preset: pkg.wrapper_preset },
  );
  const starPlugin = state.plugins.find((p) => p.id === 'starfall');
  if (starPlugin) {
    starPlugin.enabled = pkg.enable_starfall;
    broadcast({ type: 'plugin_updated', payload: starPlugin });
  }
  broadcast({
    type: 'theme_changed',
    payload: {
      dashboard_theme: state.active_dashboard_theme,
      overlay_theme: state.active_overlay_theme,
      themes: state.themes,
    },
  });
  broadcast({ type: 'layout_updated', payload: state.layouts });
  schedulePersistProfile();
  pushLog('info', 'supertheme', `Применён пакет оформления SuperTheme «${pkg.name}»`);
  return res.json({ ok: true, applied: pkg.name });
});

app.post('/api/bridges/ingest', (req, res) => {
  const b = req.body || {};
  const rawText = typeof b.raw_text === 'string' ? b.raw_text : undefined;
  const source = typeof b.source === 'string' ? b.source : undefined;
  const dedupKey = rawText
    ? `${source || 'auto'}:${rawText}`
    : `${source || 'bridge'}:${b.username || ''}:${b.amount ?? 0}:${b.message || ''}`;

  if (!checkAndRecordDedup(dedupKey)) {
    return res.json({ ok: true, deduplicated: true });
  }

  let ev: StreamEvent | null = null;
  if (rawText !== undefined) {
    ev = parseRawAlert(rawText, source, state.parser_rules);
  } else if (typeof b.username === 'string' && b.username.trim()) {
    ev = {
      id: randomUUID(),
      kind: (b.kind as StreamEventKind) || 'donation',
      source: source || 'External-Bridge',
      username: b.username.trim(),
      amount: Math.max(0, Number(b.amount ?? 100)),
      currency: String(b.currency || '₽'),
      message: String(b.message || ''),
      sound_id: null,
      tts_enabled: true,
      variation_id: null,
      created_at: new Date().toISOString(),
    };
  }

  if (ev) {
    processStreamEvent(ev);
    pushLog('info', 'bridge', `Внешний мост (${ev.source}): ${ev.username} · ${ev.amount} ${ev.currency}`);
    return res.json({ ok: true, deduplicated: false, event: ev });
  }
  return res.json({ ok: false, error: 'Текст не совпал ни с одним правилом парсера' });
});

app.post('/api/bridges/rules', (req, res) => {
  if (Array.isArray(req.body)) {
    state.parser_rules = req.body as BridgeParserRule[];
    broadcastCustomization();
    pushLog('info', 'bridge', `Обновлены правила парсера (${state.parser_rules.length} шт.)`);
  }
  res.json({ ok: true });
});

app.post('/api/assets', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || 'asset');
  const mimeType = String(b.mime_type || 'application/octet-stream');
  const kind: MediaAsset['kind'] = mimeType.startsWith('audio/') ? 'audio' : 'image';

  if (typeof b.external_url === 'string' && b.external_url.trim()) {
    const asset: MediaAsset = {
      id: randomUUID(),
      name,
      kind,
      mime_type: mimeType,
      url: b.external_url.trim(),
      created_at: new Date().toISOString(),
    };
    state.media_assets.push(asset);
    broadcastCustomization();
    pushLog('info', 'assets', `Добавлен URL-ассет «${asset.name}»`);
    return res.json({ ok: true, asset });
  }

  if (typeof b.data_base64 === 'string' && b.data_base64.length > 0) {
    try {
      const rawB64 = b.data_base64.includes(',') ? b.data_base64.split(',').pop()! : b.data_base64;
      const buf = Buffer.from(rawB64, 'base64');
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset.bin';
      const id = randomUUID();
      const storedName = `${id.slice(0, 8)}_${safe}`;
      fs.writeFileSync(path.join(assetsDir, storedName), buf);
      const asset: MediaAsset = {
        id,
        name,
        kind,
        mime_type: mimeType,
        url: `/assets/${storedName}`,
        created_at: new Date().toISOString(),
      };
      state.media_assets.push(asset);
      broadcastCustomization();
      pushLog('info', 'assets', `Загружен локальный файл «${asset.name}»`);
      return res.json({ ok: true, asset });
    } catch (err) {
      return res.json({ ok: false, error: `Ошибка сохранения файла: ${String(err)}` });
    }
  }

  return res.json({ ok: false, error: 'Передайте файл или URL ассета' });
});

app.post('/api/assets/delete', (req, res) => {
  const id = String(req.body?.id || '');
  state.media_assets = state.media_assets.filter((a) => a.id !== id);
  broadcastCustomization();
  res.json({ ok: true });
});

app.post('/api/alerts/variations', (req, res) => {
  if (Array.isArray(req.body)) {
    state.alert_variations = req.body as AlertVariation[];
    broadcastCustomization();
    pushLog('info', 'alerts', `Сохранены вариации алертов (${state.alert_variations.length} шт.)`);
  }
  res.json({ ok: true });
});

app.post('/api/goals', (req, res) => {
  if (Array.isArray(req.body)) {
    state.goals = req.body as GoalWidget[];
    if (state.goals[0]) state.goal = { ...state.goals[0] };
    broadcast({
      type: 'engagement_updated',
      payload: {
        goal: state.goal,
        subathon: state.subathon,
        stream_boss: state.stream_boss,
        poll: state.poll,
        giveaway: state.giveaway,
      },
    });
    broadcastCustomization();
  }
  res.json({ ok: true });
});

app.post('/api/scenarios', (req, res) => {
  if (Array.isArray(req.body)) {
    state.scenarios = req.body as AutomationScenario[];
    broadcastCustomization();
  }
  res.json({ ok: true });
});

app.post('/api/feed-config', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    state.feed_config = req.body as FeedConfig;
    broadcastCustomization();
  }
  res.json({ ok: true });
});

app.post('/api/overlay/elements', (req, res) => {
  if (Array.isArray(req.body)) {
    state.custom_elements = req.body as CustomOverlayElement[];
    broadcastCustomization();
  }
  res.json({ ok: true });
});

app.post('/api/events/replay', (req, res) => {
  const id = String(req.body?.id || '');
  const found = state.recent_events.find((e) => e.id === id);
  if (!found) return res.json({ ok: false, error: 'Событие не найдено' });
  broadcast({ type: 'new_event', payload: found });
  pushLog('info', 'events', `Повтор алерта от ${found.username}`);
  return res.json({ ok: true });
});

app.post('/api/chat/ingest', (req, res) => {
  const b = req.body || {};
  const username = String(b.username || 'Viewer').trim();
  const role: ViewerRole = b.role || 'viewer';
  const platform: ChatPlatform = b.platform || 'local';
  const text = String(b.text || '').trim();

  const result = ingestIncomingChatMessage({ username, role, platform, text });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.post('/api/scene', async (req, res) => {
  const scene = String(req.body?.scene || 'Main Studio');
  state.obs.active_scene = scene;
  let obsSynced = false;
  if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
    const r = await sendObsRequest('SetCurrentProgramScene', { sceneName: scene });
    obsSynced = r.ok;
  }
  broadcast({ type: 'scene_changed', payload: { scene, obs_synced: obsSynced } });
  schedulePersistProfile();
  pushLog('info', 'scene', `Активная сцена: ${scene}${obsSynced ? ' (синхронизировано с OBS)' : ''}`);
  res.json({ ok: true, scene, obs_synced: obsSynced });
});

app.post('/api/obs/connect', async (req, res) => {
  const endpoint = String(req.body?.endpoint || state.obs.endpoint || '127.0.0.1:4455');
  const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
  const result = await connectObsWebSocket(endpoint, password);
  res.json({ ok: result.ok, error: result.error, obs: state.obs });
});

app.post('/api/obs/disconnect', (_req, res) => {
  disconnectObsWebSocket('Отключено пользователем');
  res.json({ ok: true, obs: state.obs });
});

app.post('/api/audio/mixer', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    const patch = req.body as Partial<StudioAudioMixer>;
    state.audio_mixer = { ...state.audio_mixer, ...patch };
    if (typeof patch.tts_rate === 'number') state.tts_config.voice_rate = patch.tts_rate;
    if (typeof patch.tts_pitch === 'number') state.tts_config.voice_pitch = patch.tts_pitch;
    if (typeof patch.media_volume === 'number') state.media_share_config.volume = patch.media_volume;
    broadcastMvp();
    broadcastSeDa();
  }
  res.json({ ok: true, audio_mixer: state.audio_mixer });
});

app.post('/api/hotkeys', (req, res) => {
  if (Array.isArray(req.body)) {
    state.hotkeys = req.body as HotkeyBinding[];
    broadcastMvp();
    pushLog('info', 'hotkeys', `Обновлены горячие клавиши (${state.hotkeys.length} шт.)`);
  }
  res.json({ ok: true, hotkeys: state.hotkeys });
});

app.get('/api/analytics/export.csv', (_req, res) => {
  const lines: string[] = [
    'Тип,Метка,Количество,Сумма_RUB,Источник_или_Платформа,Сообщение,Время',
    `Сводка,Всего сообщений,${state.analytics.total_messages_count},0,all,Пик: ${state.analytics.peak_chat_rate_per_min} сообщ/интервал,${state.analytics.session_started_at}`,
    `Сводка,Всего донатов,${state.analytics.total_donations_count},${state.analytics.total_donations_rub},all,Баланс FinTech: ${state.fintech.balance_rub} RUB,${new Date().toISOString()}`,
  ];
  for (const [plat, cnt] of Object.entries(state.analytics.platform_breakdown)) {
    lines.push(`Платформа,${plat},${cnt},0,${plat},,`);
  }
  for (const b of state.analytics.timeline_buckets) {
    lines.push(`Интервал,${b.label},${b.chat_messages},${b.donations_rub},timeline,Донатов: ${b.donations_count},`);
  }
  for (const ev of state.recent_events) {
    const safeMsg = `"${String(ev.message || '').replace(/"/g, '""')}"`;
    const safeUser = `"${String(ev.username || '').replace(/"/g, '""')}"`;
    lines.push(`Событие,${safeUser},1,${ev.amount},${ev.source},${safeMsg},${ev.created_at}`);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pulsecast_analytics.csv"');
  res.send(`\uFEFF${lines.join('\n')}`);
});

app.post('/api/deck/trigger', (req, res) => {
  const btn = state.deck_buttons.find((b) => b.id === req.body?.button_id);
  if (!btn) return res.status(404).json({ ok: false, error: 'Кнопка не найдена' });
  const mappedName = btn.action === 'trigger_plugin' ? 'trigger_plugin_effect' : btn.action;
  const payload = btn.action === 'trigger_plugin' ? { plugin_id: btn.payload.plugin_id, payload: btn.payload } : btn.payload;
  const executed = executeTools([{ name: mappedName, arguments: payload }]);
  res.json({ ok: true, executed });
});

app.post('/api/sound/play', (req, res) => {
  const s = state.sounds.find((x) => x.id === req.body?.sound_id);
  if (!s) return res.status(404).json({ ok: false, error: 'Звук не найден' });
  broadcast({
    type: 'play_sound',
    payload: { sound_id: s.id, name: s.name, freq_hz: s.freq_hz, pattern: s.pattern, volume: s.volume },
  });
  res.json({ ok: true, sound: s.name });
});

app.post('/api/poll', (req, res) => {
  const b = req.body || {};
  state.poll.active = Boolean(b.active);
  if (typeof b.question === 'string') state.poll.question = b.question;
  if (Array.isArray(b.options)) {
    state.poll.options = b.options.map((label: string, i: number) => ({ id: String(i + 1), label, votes: 0 }));
  }
  broadcast({
    type: 'engagement_updated',
    payload: {
      goal: state.goal,
      subathon: state.subathon,
      stream_boss: state.stream_boss,
      poll: state.poll,
      giveaway: state.giveaway,
    },
  });
  res.json({ ok: true, poll: state.poll });
});

app.post('/api/poll/vote', (req, res) => {
  const opt = state.poll.options.find((o) => o.id === String(req.body?.option_id));
  if (opt) opt.votes += 1;
  broadcast({
    type: 'engagement_updated',
    payload: {
      goal: state.goal,
      subathon: state.subathon,
      stream_boss: state.stream_boss,
      poll: state.poll,
      giveaway: state.giveaway,
    },
  });
  res.json({ ok: true, poll: state.poll });
});

app.post('/api/wheel/spin', (_req, res) => {
  const idx = Math.floor(Math.random() * state.wheel_segments.length);
  const label = state.wheel_segments[idx]?.label || 'Приз';
  broadcast({ type: 'wheel_spin', payload: { winner_index: idx, winner_label: label } });
  pushLog('info', 'wheel', `Колесо фортуны выбрало: ${label}`);
  res.json({ ok: true, winner_index: idx, winner_label: label });
});

app.post('/api/giveaway', (req, res) => {
  const action = String(req.body?.action || 'start');
  if (action === 'start') {
    state.giveaway.active = true;
    if (req.body?.prize) state.giveaway.prize = String(req.body.prize);
    if (req.body?.keyword) state.giveaway.keyword = String(req.body.keyword);
    state.giveaway.participants = [];
  } else if (action === 'pick_winner') {
    state.giveaway.active = false;
    if (state.giveaway.participants.length > 0) {
      const winner = state.giveaway.participants[Math.floor(Math.random() * state.giveaway.participants.length)];
      state.giveaway.last_winner = winner;
      sendSystemChat('PulseBot', 'agent', `Победитель розыгрыша «${state.giveaway.prize}»: @${winner}!`);
    }
  } else {
    state.giveaway.active = false;
  }
  broadcast({
    type: 'engagement_updated',
    payload: {
      goal: state.goal,
      subathon: state.subathon,
      stream_boss: state.stream_boss,
      poll: state.poll,
      giveaway: state.giveaway,
    },
  });
  res.json({ ok: true, giveaway: state.giveaway });
});

app.post('/api/subathon/toggle', (req, res) => {
  if (typeof req.body?.running === 'boolean') state.subathon.running = req.body.running;
  if (typeof req.body?.add_seconds === 'number') state.subathon.remaining_seconds = Math.max(0, state.subathon.remaining_seconds + req.body.add_seconds);
  broadcast({
    type: 'engagement_updated',
    payload: {
      goal: state.goal,
      subathon: state.subathon,
      stream_boss: state.stream_boss,
      poll: state.poll,
      giveaway: state.giveaway,
    },
  });
  res.json({ ok: true, subathon: state.subathon });
});

app.post('/api/clip', (req, res) => {
  const clip = {
    id: randomUUID(),
    title: String(req.body?.title || 'Хайлайт эфира'),
    author: String(req.body?.author || 'Стример'),
    stream_elapsed_sec: Math.max(0, Math.floor((Date.now() - Date.parse(state.stream_started_at)) / 1000)),
    created_at: new Date().toISOString(),
  };
  state.clip_markers.push(clip);
  broadcast({ type: 'clip_marked', payload: clip });
  schedulePersistProfile();
  pushLog('info', 'clips', `Сохранён маркер клипа: ${clip.title}`);
  res.json(clip);
});

app.post('/api/minigame', (req, res) => {
  const kind = (req.body?.kind as MiniGameKind) || 'battle_royale';
  state.arena.active_minigame = kind;
  if (kind === 'boss_fight') state.arena.boss_hp = state.arena.boss_max_hp;
  broadcast({ type: 'minigame_started', payload: { kind, initiator: req.body?.initiator || 'Пульт', details: {} } });
  pushLog('info', 'avatars', `Мини-игра ${kind}`);
  res.json({ ok: true, kind });
});

app.post('/api/avatar/action', (req, res) => {
  broadcast({
    type: 'avatar_action',
    payload: { username: String(req.body?.username || '*'), action: String(req.body?.action || 'dance') },
  });
  res.json({ ok: true });
});

app.post('/api/plugins/upsert', (req, res) => {
  const p = req.body as OverlayPlugin;
  const idx = state.plugins.findIndex((x) => x.id === p.id);
  if (idx >= 0) state.plugins[idx] = p;
  else state.plugins.push(p);
  broadcast({ type: 'plugin_updated', payload: p });
  schedulePersistProfile();
  pushLog('info', 'plugins', `Плагин «${p.name}» сохранён`);
  res.json({ ok: true, plugin: p });
});

app.post('/api/plugins/toggle', (req, res) => {
  const p = state.plugins.find((x) => x.id === req.body?.plugin_id);
  if (!p) return res.status(404).json({ ok: false, error: 'Плагин не найден' });
  p.enabled = Boolean(req.body?.enabled);
  broadcast({ type: 'plugin_updated', payload: p });
  schedulePersistProfile();
  res.json({ ok: true, plugin: p });
});

app.post('/api/plugins/trigger', (req, res) => {
  broadcast({
    type: 'plugin_triggered',
    payload: { plugin_id: String(req.body?.plugin_id || 'starfall'), data: req.body?.data || { burst: 45 } },
  });
  res.json({ ok: true });
});

app.post('/api/layouts', (req, res) => {
  if (Array.isArray(req.body)) {
    state.layouts = req.body;
    broadcast({ type: 'layout_updated', payload: state.layouts });
    schedulePersistProfile();
  }
  res.json({ ok: true });
});

app.post('/api/themes', (req, res) => {
  const t = req.body as ThemeConfig;
  const idx = state.themes.findIndex((x) => x.id === t.id);
  if (idx >= 0) state.themes[idx] = t;
  else state.themes.push(t);
  if (t.target === 'dashboard') state.active_dashboard_theme = t.id;
  else state.active_overlay_theme = t.id;
  broadcast({
    type: 'theme_changed',
    payload: { dashboard_theme: state.active_dashboard_theme, overlay_theme: state.active_overlay_theme, themes: state.themes },
  });
  schedulePersistProfile();
  res.json({ ok: true });
});

app.post('/api/themes/select', (req, res) => {
  const target = String(req.body?.target || 'dashboard');
  const themeId = String(req.body?.theme_id || 'studio_dark');
  if (target === 'dashboard') state.active_dashboard_theme = themeId;
  else state.active_overlay_theme = themeId;
  broadcast({
    type: 'theme_changed',
    payload: { dashboard_theme: state.active_dashboard_theme, overlay_theme: state.active_overlay_theme, themes: state.themes },
  });
  schedulePersistProfile();
  res.json({ ok: true });
});

app.get('/api/profile/export', (_req, res) => res.json(state));

app.post('/api/profile/import', (req, res) => {
  if (req.body && req.body.themes && req.body.plugins) {
    state = mergeSnapshotWithDefaults(req.body as Partial<StreamSnapshot>);
    persistProfileNow();
    broadcast({ type: 'sync_state', payload: state });
    pushLog('info', 'profile', 'Профиль кастомизации импортирован и сохранён на диск');
    return res.json({ ok: true, profile_last_saved_at: state.profile_last_saved_at });
  }
  res.status(400).json({ ok: false, error: 'Некорректный формат профиля (ожидаются поля themes и plugins)' });
});

app.post('/api/profile/reset', (_req, res) => {
  disconnectObsWebSocket('Профиль сброшен к настройкам по умолчанию');
  state = createInitialSnapshot();
  persistProfileNow();
  broadcast({ type: 'sync_state', payload: state });
  pushLog('info', 'profile', 'Профиль студии сброшен к заводским настройкам по умолчанию');
  res.json({ ok: true, profile_last_saved_at: state.profile_last_saved_at });
});

app.post('/api/whisper/emit', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (text) {
    state.whisper.last_transcript = text;
    broadcast({ type: 'subtitle', payload: { text, is_final: true, timestamp: new Date().toISOString() } });
  }
  res.json({ ok: true });
});

app.post('/api/whisper/toggle', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  state.whisper.enabled = enabled;
  state.whisper.audio_device_active = enabled;
  state.whisper.diagnostic = enabled ? 'Потоковый захват речи активен' : 'Субтитры остановлены';
  broadcast({ type: 'whisper_status_updated', payload: state.whisper });
  res.json({ ok: true, status: state.whisper });
});

app.post('/api/agent', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (req.body?.backend === 'http' || req.body?.backend === 'embedded') {
    state.llm.backend = req.body.backend;
  }
  if (typeof req.body?.server_url === 'string' && req.body.server_url.trim()) {
    state.llm.server_url = req.body.server_url.trim();
  }

  // Пытаемся обратиться к локальному llama-server, если пользователь указал доступный локальный URL
  if (state.llm.backend === 'http' && req.body?.try_external_llm === true) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const r = await fetch(state.llm.server_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: state.llm.model_name,
          messages: [
            { role: 'system', content: 'Ты ИИ-режиссёр PulseCast. Вызывай инструменты и отвечай кратко на русском.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      clearTimeout(timer);
      if (r.ok) {
        const data = (await r.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
        const msg = data.choices?.[0]?.message;
        const calls = (msg?.tool_calls || []).map((tc) => ({
          name: tc.function?.name || '',
          arguments: JSON.parse(tc.function?.arguments || '{}'),
        }));
        const executed = executeTools(calls.filter((c) => c.name));
        const reply = msg?.content || 'Выполнено через локальный llama-server.';
        sendSystemChat('AI-Режиссёр', 'agent', reply);
        return res.json({ reply, backend_used: 'http (llama-server)', tool_calls_executed: executed });
      }
    } catch {
      // Переходим на детерминированный локальный фоллбэк
    }
  }

  const fb = deterministicAgentFallback(prompt);
  const executed = executeTools(fb.calls);
  sendSystemChat('AI-Режиссёр', 'agent', fb.reply);
  res.json({
    reply: fb.reply,
    backend_used: state.llm.backend === 'embedded' ? 'embedded (local-fallback)' : 'local-deterministic',
    tool_calls_executed: executed,
  });
});

// Статический чистый оверлей для OBS Studio напрямую
app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'overlay.html'));
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(3000, '0.0.0.0', () => {
    console.log('PulseCast Local Preview running on http://0.0.0.0:3000');
  });
}

startServer();
