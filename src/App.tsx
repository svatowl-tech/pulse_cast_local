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

type ActiveTab = 'desk' | 'avatars' | 'widgets' | 'plugins' | 'agent';
type ViewMode = 'studio' | 'donate' | 'obs_dock';

const NAV_TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'desk', label: 'Пульт и Чат' },
  { id: 'avatars', label: 'Аватары и Игры' },
  { id: 'widgets', label: 'Алерты и Виджеты' },
  { id: 'plugins', label: 'Плагины и Макет' },
  { id: 'agent', label: 'Агент и Темы' },
];

export default function App() {
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('desk');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith('/donate')) return 'donate';
    if (path.startsWith('/obs-dock')) return 'obs_dock';
    return 'studio';
  });
  const [activeAlert, setActiveAlert] = useState<StreamEvent | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [wheelResult, setWheelResult] = useState<{ index: number; label: string; ts: number } | null>(null);
  const [lastWsEvent, setLastWsEvent] = useState<WsBroadcast | null>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const [mobileMonitorOpen, setMobileMonitorOpen] = useState(false);
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [hotkeyToast, setHotkeyToast] = useState<string | null>(null);

  const alertQueueRef = useRef<StreamEvent[]>([]);
  const alertBusyRef = useRef(false);
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;
  const snapshotRef = useRef<StreamSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const switchViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    const nextPath = mode === 'donate' ? '/donate' : mode === 'obs_dock' ? '/obs-dock' : '/';
    try {
      window.history.pushState({}, '', nextPath);
    } catch {
      // ignore in sandboxed iframe
    }
  }, []);

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

    if (!soundMutedRef.current) {
      const mixer = snapshotRef.current?.audio_mixer;
      const alertGain = getAlertsVolumeMultiplier(mixer);
      if (alertGain > 0.001) {
        if (matched?.sound_url) {
          try {
            const a = new Audio(matched.sound_url);
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
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let subtitleTimer: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

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
              return {
                ...prev,
                ...msg.payload,
              };
            case 'counters_updated':
              return {
                ...prev,
                hype_train: msg.payload.hype_train,
                game_counters: msg.payload.game_counters,
                pngtuber: msg.payload.pngtuber,
                obs_audio: msg.payload.obs_audio,
              };
            case 'se_da_updated':
              return {
                ...prev,
                ...msg.payload,
              };
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
        } else if (msg.type === 'play_sound' && !soundMutedRef.current) {
          playSynthTone(
            msg.payload.freq_hz,
            msg.payload.pattern,
            msg.payload.volume,
            snapshotRef.current?.audio_mixer,
          );
        }
      };

      ws.onclose = () => {
        reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(subtitleTimer);
      ws?.close();
    };
  }, [showNextAlert]);

  const apiPost = useCallback(async (url: string, body: unknown = {}) => {
    const res = await fetch(url, {
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
    return (
      <ObsDockView
        snapshot={snapshot}
        apiPost={apiPost}
        onExitDock={() => switchViewMode('studio')}
      />
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Однострочная 3-зонная верхняя шапка */}
      <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-5 flex items-center justify-between gap-4">
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

        <nav className="hidden md:flex items-center gap-6 overflow-x-auto">
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
          <button
            type="button"
            onClick={() => switchViewMode('donate')}
            className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold whitespace-nowrap transition-colors"
          >
            Страница /donate
          </button>
          <button
            type="button"
            onClick={() => switchViewMode('obs_dock')}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-xs font-medium whitespace-nowrap transition-colors"
          >
            OBS Dock
          </button>
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
          {activeTab === 'agent' && <AgentAndThemesTab snapshot={snapshot} apiPost={apiPost} />}
        </div>

        {/* Постоянный живой OBS Монитор (справа на десктопе, по кнопке на мобильных) */}
        <aside
          className={`lg:w-[460px] xl:w-[520px] shrink-0 p-4 lg:pl-0 flex flex-col gap-3 min-h-0 ${
            mobileMonitorOpen ? 'flex-1 flex' : 'hidden lg:flex'
          }`}
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

          <div className="flex-1 min-h-0 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between text-xs mb-2 shrink-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {snapshot.feed_config?.title || 'Лента событий эфира'}
              </span>
              <span className="font-mono tabular-nums text-slate-400">
                Цель: {Math.round(snapshot.goal.current)}/{Math.round(snapshot.goal.target)} {snapshot.goal.unit}
              </span>
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
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{ev.username}</span>
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
