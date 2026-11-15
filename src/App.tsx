import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { HotkeyBinding, StreamEvent, StreamSnapshot, WsBroadcast } from './types/stream.ts';
import { getAlertsVolumeMultiplier, playSynthTone, speakTts } from './components/audioSynth.ts';
import { OverlayMonitor } from './components/OverlayMonitor.tsx';
import { DeskAndChatTab } from './components/DeskAndChatTab.tsx';
import { AvatarsAndGamesTab } from './components/AvatarsAndGamesTab.tsx';
import { WidgetsAndAutomationTab } from './components/WidgetsAndAutomationTab.tsx';
import { PluginsAndLayoutTab } from './components/PluginsAndLayoutTab.tsx';
import { AgentAndThemesTab } from './components/AgentAndThemesTab.tsx';
import { PublicDonateView } from './components/PublicDonateView.tsx';
import { ObsDockView } from './components/ObsDockView.tsx';
import { PopoutWindowShell } from './components/PopoutWindowShell.tsx';
import { MultiChatPanel } from './components/MultiChatPanel.tsx';
import { StudioMixerAndHotkeysPanel } from './components/StudioMixerAndHotkeysPanel.tsx';
import { AgentAndFeedPopout } from './components/AgentAndFeedPopout.tsx';
import {
  dockPopoutWindow,
  getDetachedWindows,
  getServerWsUrl,
  getWindowLabel,
  hideMainToTray,
  initRuntime,
  isTauriRuntime,
  openPopoutWindow,
  POPOUT_MODULES,
  quitDesktopApp,
  resolveApiUrl,
  resolveAssetUrl,
  subscribeDetachedWindows,
  subscribeGlobalShortcuts,
  syncGlobalShortcutsToDesktop,
  type AppWindowMode,
  type PopoutModuleId,
} from './utils/runtime.ts';

type ActiveTab = 'desk' | 'avatars' | 'widgets' | 'plugins' | 'agent';

const NAV_TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'desk', label: 'Пульт и Чат' },
  { id: 'avatars', label: 'Аватары и Игры' },
  { id: 'widgets', label: 'Алерты и Виджеты' },
  { id: 'plugins', label: 'Плагины и Макет' },
  { id: 'agent', label: 'Агент и Темы' },
];

function detectInitialWindowMode(): { mode: AppWindowMode; isQueryPopout: boolean } {
  if (typeof window === 'undefined') return { mode: 'studio', isQueryPopout: false };
  const params = new URLSearchParams(window.location.search);
  const winParam = params.get('window');
  if (
    winParam === 'chat' ||
    winParam === 'obs_dock' ||
    winParam === 'mixer' ||
    winParam === 'agent_feed' ||
    winParam === 'donate' ||
    winParam === 'studio'
  ) {
    return { mode: winParam, isQueryPopout: winParam !== 'studio' };
  }

  const label = getWindowLabel();
  if (label === 'popout_chat') return { mode: 'chat', isQueryPopout: true };
  if (label === 'popout_obs_dock') return { mode: 'obs_dock', isQueryPopout: true };
  if (label === 'popout_mixer') return { mode: 'mixer', isQueryPopout: true };
  if (label === 'popout_agent_feed') return { mode: 'agent_feed', isQueryPopout: true };

  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/donate')) return { mode: 'donate', isQueryPopout: false };
  if (path.startsWith('/obs-dock')) return { mode: 'obs_dock', isQueryPopout: false };

  return { mode: 'studio', isQueryPopout: false };
}

export default function App() {
  const [{ mode: viewMode, isQueryPopout }, setViewState] = useState(detectInitialWindowMode);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('desk');
  const [detachedWindows, setDetachedWindows] = useState<PopoutModuleId[]>([]);
  const [windowsMenuOpen, setWindowsMenuOpen] = useState(false);

  const [activeAlert, setActiveAlert] = useState<StreamEvent | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [wheelResult, setWheelResult] = useState<{ index: number; label: string; ts: number } | null>(null);
  const [lastWsEvent, setLastWsEvent] = useState<WsBroadcast | null>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const [mobileMonitorOpen, setMobileMonitorOpen] = useState(false);
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [hotkeyToast, setHotkeyToast] = useState<string | null>(null);

  const windowsMenuRef = useRef<HTMLDivElement | null>(null);
  const alertQueueRef = useRef<StreamEvent[]>([]);
  const alertBusyRef = useRef(false);
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;
  const snapshotRef = useRef<StreamSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const viewModeRef = useRef<AppWindowMode>(viewMode);
  viewModeRef.current = viewMode;

  const isDesktop = isTauriRuntime();

  // Инициализация адреса встроенного Axum-сервера (в Tauri это http://127.0.0.1:<port>)
  useEffect(() => {
    let active = true;
    void initRuntime().then(async () => {
      if (!active) return;
      setRuntimeReady(true);
      const list = await getDetachedWindows();
      if (active) setDetachedWindows(list);
    });
    return () => {
      active = false;
    };
  }, []);

  // Подписка на синхронизацию списка вынесенных окон между главным окном и pop-out окнами
  useEffect(() => {
    const unsub = subscribeDetachedWindows((list) => {
      setDetachedWindows(list);
    });
    return unsub;
  }, []);

  // Закрытие выпадающего меню «Окна» при клике вне или нажатии Escape
  useEffect(() => {
    if (!windowsMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (windowsMenuRef.current && !windowsMenuRef.current.contains(e.target as Node)) {
        setWindowsMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWindowsMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [windowsMenuOpen]);

  const switchViewMode = useCallback((mode: AppWindowMode) => {
    setViewState({ mode, isQueryPopout: false });
    const nextPath =
      mode === 'donate'
        ? '/donate'
        : mode === 'obs_dock'
          ? '/obs-dock'
          : mode === 'studio'
            ? '/'
            : `/?window=${mode}`;
    try {
      window.history.pushState({}, '', nextPath);
    } catch {
      // Игнорируем в изолированном iframe
    }
  }, []);

  const handleOpenPopout = useCallback(async (id: PopoutModuleId) => {
    const updated = await openPopoutWindow(id);
    setDetachedWindows(updated);
    setWindowsMenuOpen(false);
  }, []);

  const handleDockPopout = useCallback(async (id: PopoutModuleId, focusMain = false) => {
    const updated = await dockPopoutWindow(id, focusMain);
    setDetachedWindows(updated);
    if (!isTauriRuntime() && focusMain) {
      if (window.opener && !window.opener.closed) {
        window.close();
      } else {
        switchViewMode('studio');
      }
    }
  }, [switchViewMode]);

  const showNextAlert = useCallback(() => {
    if (alertQueueRef.current.length === 0) {
      alertBusyRef.current = false;
      setActiveAlert(null);
      return;
    }
    alertBusyRef.current = true;
    const next = alertQueueRef.current.shift()!;
    setActiveAlert(next);

    const vars = snapshotRef.current?.alert_variations || [];
    const matched =
      (next.variation_id && vars.find((v) => v.id === next.variation_id)) ||
      vars.find((v) => v.enabled);

    // Звук и TTS воспроизводятся только в главном окне студии, чтобы не дублироваться в pop-out окнах
    if (viewModeRef.current === 'studio' && !soundMutedRef.current) {
      const mixer = snapshotRef.current?.audio_mixer;
      const alertGain = getAlertsVolumeMultiplier(mixer);
      if (alertGain > 0.001) {
        if (matched?.sound_url) {
          try {
            const a = new Audio(resolveAssetUrl(matched.sound_url));
            a.volume = alertGain;
            void a.play().catch(() => playSynthTone(523.25, 'fanfare', 0.6, mixer));
          } catch {
            playSynthTone(523.25, 'fanfare', 0.6, mixer);
          }
        } else {
          playSynthTone(523.25, 'fanfare', 0.6, mixer);
        }
      }

      if (next.tts_enabled && (next.message || matched?.tts_template)) {
        const ttsText = matched?.tts_template
          ? matched.tts_template
              .replace(/\{user\}/g, next.username)
              .replace(/\{amount\}/g, String(Math.round(next.amount)))
              .replace(/\{currency\}/g, next.currency)
              .replace(/\{message\}/g, next.message || '')
              .replace(/\{source\}/g, next.source || '')
          : `${next.username} отправил ${Math.round(next.amount)} ${next.currency}. ${next.message}`;
        speakTts(ttsText.trim(), mixer);
      }
    }
    setTimeout(showNextAlert, matched?.duration_ms || 4500);
  }, []);

  // Синхронизация .dark класса <html> с выбранной темой дашборда
  useEffect(() => {
    if (!snapshot) return;
    const theme = snapshot.themes.find((t) => t.id === snapshot.active_dashboard_theme);
    const isDark = theme ? theme.mode === 'dark' : true;
    document.documentElement.classList.toggle('dark', isDark);
  }, [snapshot?.active_dashboard_theme, snapshot?.themes]);

  // Реальное WebSocket-подключение с автопереподключением
  useEffect(() => {
    if (!runtimeReady) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let subtitleTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(getServerWsUrl());

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as WsBroadcast;
        setLastWsEvent(msg);

        if (msg.type === 'sync_state') {
          setSnapshot(msg.payload);
          return;
        }

        setSnapshot((prev) => {
          if (!prev) return prev;
          switch (msg.type) {
            case 'new_event':
              return { ...prev, recent_events: [...prev.recent_events.slice(-99), msg.payload] };
            case 'chat_message':
              return { ...prev, chat_history: [...prev.chat_history.slice(-199), msg.payload] };
            case 'scene_changed':
              return { ...prev, obs: { ...prev.obs, active_scene: msg.payload.scene } };
            case 'theme_changed':
              return {
                ...prev,
                active_dashboard_theme: msg.payload.dashboard_theme,
                active_overlay_theme: msg.payload.overlay_theme,
                themes: msg.payload.themes,
              };
            case 'plugin_updated': {
              const exists = prev.plugins.some((p) => p.id === msg.payload.id);
              const plugins = exists
                ? prev.plugins.map((p) => (p.id === msg.payload.id ? msg.payload : p))
                : [...prev.plugins, msg.payload];
              return { ...prev, plugins };
            }
            case 'layout_updated':
              return { ...prev, layouts: msg.payload };
            case 'engagement_updated':
              return {
                ...prev,
                goal: msg.payload.goal,
                subathon: msg.payload.subathon,
                stream_boss: msg.payload.stream_boss,
                poll: msg.payload.poll,
                giveaway: msg.payload.giveaway,
              };
            case 'customization_updated':
              return {
                ...prev,
                goals: msg.payload.goals,
                parser_rules: msg.payload.parser_rules,
                media_assets: msg.payload.media_assets,
                alert_variations: msg.payload.alert_variations,
                feed_config: msg.payload.feed_config,
                custom_elements: msg.payload.custom_elements,
                scenarios: msg.payload.scenarios,
              };
            case 'bot_and_auth_updated':
              return { ...prev, ...msg.payload };
            case 'counters_updated':
              return {
                ...prev,
                hype_train: msg.payload.hype_train,
                game_counters: msg.payload.game_counters,
                pngtuber: msg.payload.pngtuber,
                obs_audio: msg.payload.obs_audio,
              };
            case 'se_da_updated':
              return { ...prev, ...msg.payload };
            case 'mvp_updated':
              return {
                ...prev,
                audio_mixer: msg.payload.audio_mixer,
                hotkeys: msg.payload.hotkeys,
                analytics: msg.payload.analytics,
                obs: msg.payload.obs,
                profile_last_saved_at: msg.payload.profile_last_saved_at,
              };
            case 'minigame_started':
              return { ...prev, arena: { ...prev.arena, active_minigame: msg.payload.kind } };
            case 'clip_marked':
              return { ...prev, clip_markers: [...prev.clip_markers, msg.payload] };
            case 'whisper_status_updated':
              return { ...prev, whisper: msg.payload };
            case 'log_entry':
              return { ...prev, logs: [...prev.logs.slice(-149), msg.payload] };
            default:
              return prev;
          }
        });

        if (msg.type === 'new_event') {
          alertQueueRef.current.push(msg.payload);
          if (!alertBusyRef.current) showNextAlert();
        } else if (msg.type === 'subtitle') {
          setActiveSubtitle(msg.payload.text);
          window.clearTimeout(subtitleTimer);
          subtitleTimer = window.setTimeout(() => setActiveSubtitle(null), 5500);
        } else if (msg.type === 'wheel_spin') {
          setWheelResult({ index: msg.payload.winner_index, label: msg.payload.winner_label, ts: Date.now() });
        } else if (
          msg.type === 'play_sound' &&
          viewModeRef.current === 'studio' &&
          !soundMutedRef.current
        ) {
          playSynthTone(
            msg.payload.freq_hz,
            msg.payload.pattern,
            msg.payload.volume,
            snapshotRef.current?.audio_mixer,
          );
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(subtitleTimer);
      ws?.close();
    };
  }, [runtimeReady, showNextAlert]);

  const apiPost = useCallback(async (url: string, body: unknown = {}) => {
    const res = await fetch(resolveApiUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  const triggerHotkeyBinding = useCallback(
    (binding: HotkeyBinding) => {
      const snap = snapshotRef.current;
      if (!snap) return;
      switch (binding.action_kind) {
        case 'deck_button':
          void apiPost('/api/deck/trigger', { button_id: binding.target_id });
          break;
        case 'change_scene':
          void apiPost('/api/scene', { scene: binding.target_id });
          break;
        case 'mute_master':
          void apiPost('/api/audio/mixer', { master_muted: !snap.audio_mixer.master_muted });
          break;
        case 'mute_alerts':
          void apiPost('/api/audio/mixer', { alerts_muted: !snap.audio_mixer.alerts_muted });
          break;
        case 'skip_media':
          void apiPost('/api/media/control', { action: 'skip' });
          break;
        case 'mark_clip':
          void apiPost('/api/clip', { title: `Хайлайт (${binding.combo})`, author: 'Hotkey' });
          break;
        case 'toggle_subtitles':
          void apiPost('/api/whisper/toggle', { enabled: !snap.whisper.enabled });
          break;
      }
      setHotkeyToast(`${binding.combo} → ${binding.label}`);
    },
    [apiPost],
  );

  useEffect(() => {
    if (!hotkeyToast) return;
    const t = window.setTimeout(() => setHotkeyToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [hotkeyToast]);

  // Синхронизируем системные горячие клавиши с хостом Tauri (работают даже при сворачивании в трей)
  useEffect(() => {
    if (!runtimeReady || viewMode !== 'studio' || !snapshot?.hotkeys) return;
    void syncGlobalShortcutsToDesktop(snapshot.hotkeys);
  }, [runtimeReady, viewMode, snapshot?.hotkeys]);

  useEffect(() => {
    if (viewMode !== 'studio') return;
    const unsub = subscribeGlobalShortcuts((hotkeyId) => {
      const matched = snapshotRef.current?.hotkeys?.find((h) => h.id === hotkeyId && h.enabled);
      if (matched) triggerHotkeyBinding(matched);
    });
    return unsub;
  }, [viewMode, triggerHotkeyBinding]);

  // Локальная обработка клавиш внутри сфокусированного окна
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable ||
          target.getAttribute('data-hotkey-recording') === 'true'
        ) {
          return;
        }
      }
      const key = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key);
      const combo = parts.join('+').toLowerCase();

      const bindings = snapshotRef.current?.hotkeys || [];
      const matched = bindings.find((b) => b.enabled && b.combo.trim().toLowerCase() === combo);
      if (matched) {
        e.preventDefault();
        triggerHotkeyBinding(matched);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [triggerHotkeyBinding]);

  if (!snapshot) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] text-slate-600 dark:text-slate-400 text-sm">
        Подключение к локальному серверу PulseCast...
      </div>
    );
  }

  if (viewMode === 'donate') {
    return (
      <PublicDonateView
        snapshot={snapshot}
        apiPost={apiPost}
        onBackToStudio={() => switchViewMode('studio')}
      />
    );
  }

  if (viewMode === 'obs_dock') {
    const isStandalonePopout = isDesktop || isQueryPopout;
    return (
      <ObsDockView
        snapshot={snapshot}
        apiPost={apiPost}
        isPopout={isStandalonePopout}
        onExitDock={() => {
          if (isStandalonePopout) {
            void handleDockPopout('obs_dock', true);
          } else {
            switchViewMode('studio');
          }
        }}
      />
    );
  }

  if (viewMode === 'chat') {
    return (
      <PopoutWindowShell
        moduleId="chat"
        title="Мультичат"
        subtitle="7TV/BTTV/FFZ · @bot"
        onDock={() => void handleDockPopout('chat', true)}
      >
        <MultiChatPanel snapshot={snapshot} apiPost={apiPost} standalone />
      </PopoutWindowShell>
    );
  }

  if (viewMode === 'mixer') {
    return (
      <PopoutWindowShell
        moduleId="mixer"
        title="Аудио-микшер и Хоткеи"
        subtitle="4 канала + глобальные клавиши"
        onDock={() => void handleDockPopout('mixer', true)}
      >
        <StudioMixerAndHotkeysPanel
          snapshot={snapshot}
          apiPost={apiPost}
          onTriggerHotkey={triggerHotkeyBinding}
          standalone
        />
      </PopoutWindowShell>
    );
  }

  if (viewMode === 'agent_feed') {
    return (
      <PopoutWindowShell
        moduleId="agent_feed"
        title="ИИ-Агент и Лента событий"
        subtitle="Function Calling + Донаты"
        onDock={() => void handleDockPopout('agent_feed', true)}
      >
        <AgentAndFeedPopout snapshot={snapshot} apiPost={apiPost} />
      </PopoutWindowShell>
    );
  }

  const chatDetached = detachedWindows.includes('chat');
  const mixerDetached = detachedWindows.includes('mixer');
  const agentFeedDetached = detachedWindows.includes('agent_feed');

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Однострочная 3-зонная верхняя шапка */}
      <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-4 lg:px-5 flex items-center justify-between gap-4">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            switchViewMode('studio');
          }}
          className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          PulseCast Local
        </a>

        <nav className="hidden md:flex items-center gap-5 xl:gap-6 overflow-x-auto">
          {NAV_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'text-slate-900 dark:text-slate-100 border-blue-600'
                  : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {/* Контекстный поповер управления окнами и треем (без спама модальными окнами) */}
          <div className="relative" ref={windowsMenuRef}>
            <button
              type="button"
              onClick={() => setWindowsMenuOpen((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                detachedWindows.length > 0 || windowsMenuOpen
                  ? 'border-blue-500/60 bg-blue-500/10 text-blue-500 dark:text-blue-400'
                  : 'border-slate-300 dark:border-slate-700 hover:border-blue-500'
              }`}
            >
              {detachedWindows.length > 0 ? `Окна (${detachedWindows.length})` : 'Окна'}
            </button>

            {windowsMenuOpen && (
              <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-xl z-50 p-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Независимые окна модулей
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setWindowsMenuOpen(false);
                      switchViewMode('donate');
                    }}
                    className="text-[11px] font-medium text-emerald-500 hover:underline whitespace-nowrap"
                  >
                    Страница /donate
                  </button>
                </div>

                <div className="space-y-1.5">
                  {POPOUT_MODULES.map((mod) => {
                    const isDetached = detachedWindows.includes(mod.id);
                    return (
                      <div
                        key={mod.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {mod.title}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{mod.subtitle}</div>
                        </div>
                        {isDetached ? (
                          <button
                            type="button"
                            onClick={() => void handleDockPopout(mod.id, false)}
                            className="px-2.5 py-1 rounded-md bg-blue-600/15 text-blue-500 hover:bg-blue-600/25 font-semibold whitespace-nowrap shrink-0"
                          >
                            Вернуть
                          </button>
                        ) : isDesktop ? (
                          <button
                            type="button"
                            onClick={() => void handleOpenPopout(mod.id)}
                            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:border-blue-500 font-medium whitespace-nowrap shrink-0"
                          >
                            Вынести
                          </button>
                        ) : (
                          <a
                            href={`/?window=${mod.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => void handleOpenPopout(mod.id)}
                            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:border-blue-500 font-medium whitespace-nowrap shrink-0"
                          >
                            Вынести
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isDesktop && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setWindowsMenuOpen(false);
                        void hideMainToTray();
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-blue-500 font-medium whitespace-nowrap"
                    >
                      Свернуть в трей
                    </button>
                    <button
                      type="button"
                      onClick={() => void quitDesktopApp()}
                      className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-medium whitespace-nowrap"
                    >
                      Выход
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {isDesktop ? (
            <button
              type="button"
              onClick={() => void handleOpenPopout('obs_dock')}
              className="hidden sm:inline-flex px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-xs font-medium whitespace-nowrap transition-colors"
            >
              OBS Dock
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchViewMode('obs_dock')}
              className="hidden sm:inline-flex px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-xs font-medium whitespace-nowrap transition-colors"
            >
              OBS Dock
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              void apiPost('/api/webhooks/donation', {
                username: 'AlexStream',
                amount: 500,
                currency: '₽',
                message: 'Проверка эфирного алерта и салюта звёзд!',
              })
            }
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            Тест доната
          </button>
        </div>
      </header>

      {/* Мобильная навигация */}
      <div className="md:hidden flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-x-auto shrink-0">
        {NAV_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActiveTab(t.id);
              setMobileMonitorOpen(false);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              !mobileMonitorOpen && activeTab === t.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMobileMonitorOpen(!mobileMonitorOpen)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            mobileMonitorOpen
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          OBS Монитор
        </button>
      </div>

      {/* Основная рабочая область без двойного скролла */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div
          className={`flex-1 min-h-0 overflow-y-auto custom-scroll p-4 ${
            mobileMonitorOpen ? 'hidden lg:block' : 'block'
          }`}
        >
          {activeTab === 'desk' && (
            <DeskAndChatTab
              snapshot={snapshot}
              apiPost={apiPost}
              soundMuted={soundMuted || Boolean(snapshot.audio_mixer?.master_muted)}
              onToggleSoundMute={() => {
                const next = !(soundMuted || Boolean(snapshot.audio_mixer?.master_muted));
                setSoundMuted(next);
                void apiPost('/api/audio/mixer', { master_muted: next });
              }}
              onTriggerHotkey={triggerHotkeyBinding}
              chatDetached={chatDetached}
              mixerDetached={mixerDetached}
              onPopoutChat={() => void handleOpenPopout('chat')}
              onPopoutMixer={() => void handleOpenPopout('mixer')}
            />
          )}
          {activeTab === 'avatars' && <AvatarsAndGamesTab snapshot={snapshot} apiPost={apiPost} />}
          {activeTab === 'widgets' && (
            <WidgetsAndAutomationTab
              snapshot={snapshot}
              apiPost={apiPost}
              onOpenDonatePage={() => switchViewMode('donate')}
            />
          )}
          {activeTab === 'plugins' && (
            <PluginsAndLayoutTab
              snapshot={snapshot}
              apiPost={apiPost}
              layoutEditMode={layoutEditMode}
              onToggleLayoutEdit={() => setLayoutEditMode((v) => !v)}
            />
          )}
          {activeTab === 'agent' && (
            <AgentAndThemesTab
              snapshot={snapshot}
              apiPost={apiPost}
              agentFeedDetached={agentFeedDetached}
              onPopoutAgentFeed={() => void handleOpenPopout('agent_feed')}
            />
          )}
        </div>

        {/* Постоянный живой OBS Монитор (справа на десктопе, по кнопке на мобильных) */}
        <aside
          className={`lg:w-[440px] xl:w-[500px] shrink-0 p-4 lg:pl-0 flex flex-col gap-3 min-h-0 ${
            mobileMonitorOpen ? 'flex-1 flex' : 'hidden lg:flex'
          } ${agentFeedDetached ? 'justify-center' : ''}`}
        >
          <div className="aspect-video w-full shrink-0">
            <OverlayMonitor
              snapshot={snapshot}
              activeAlert={activeAlert}
              activeSubtitle={activeSubtitle}
              wheelResult={wheelResult}
              lastWsEvent={lastWsEvent}
              soundMuted={soundMuted}
              layoutEditMode={layoutEditMode}
              onToggleLayoutEdit={() => setLayoutEditMode((v) => !v)}
              apiPost={apiPost}
            />
          </div>

          {!agentFeedDetached && (
            <div className="flex-1 min-h-0 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between text-xs mb-2 shrink-0 gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {snapshot.feed_config?.title || 'Лента событий эфира'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono tabular-nums text-slate-400">
                    Цель: {Math.round(snapshot.goal.current)}/{Math.round(snapshot.goal.target)}{' '}
                    {snapshot.goal.unit}
                  </span>
                  {isDesktop ? (
                    <button
                      type="button"
                      onClick={() => void handleOpenPopout('agent_feed')}
                      className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-[11px] font-medium whitespace-nowrap"
                      title="Вынести ленту и ИИ-агента в отдельное окно"
                    >
                      В окно
                    </button>
                  ) : (
                    <a
                      href="/?window=agent_feed"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void handleOpenPopout('agent_feed')}
                      className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-[11px] font-medium whitespace-nowrap"
                      title="Открыть ленту и ИИ-агента в отдельном окне"
                    >
                      В окно
                    </a>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-1.5 text-xs">
                {snapshot.recent_events
                  .filter((ev) => ev.amount >= (snapshot.feed_config?.min_amount || 0))
                  .slice(-(snapshot.feed_config?.max_items || 8))
                  .reverse()
                  .map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0"
                    >
                      <div className="min-w-0">
                        {snapshot.feed_config?.show_source && (
                          <span className="text-[10px] text-slate-400 mr-1.5">[{ev.source}]</span>
                        )}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {ev.username}
                        </span>
                        {ev.message && (
                          <span className="text-slate-500 dark:text-slate-400 ml-1.5">{ev.message}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          {Math.round(ev.amount)} {ev.currency}
                        </span>
                        <button
                          type="button"
                          onClick={() => void apiPost('/api/events/replay', { id: ev.id })}
                          className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 hover:text-blue-500 hover:border-blue-500"
                          title="Повторить алерт на оверлее"
                        >
                          Повтор
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </aside>
      </main>

      {hotkeyToast && (
        <div className="fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-mono shadow-lg border border-slate-700 dark:border-slate-300">
          ⌨ {hotkeyToast}
        </div>
      )}
    </div>
  );
}
