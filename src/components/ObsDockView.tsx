import React, { useEffect, useState } from 'react';
import type { StreamSnapshot } from '../types/stream.ts';
import { notifyBrowserPopoutLifecycle } from '../utils/runtime.ts';

interface ObsDockViewProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onExitDock: () => void;
  isPopout?: boolean;
}

export const ObsDockView: React.FC<ObsDockViewProps> = ({
  snapshot,
  apiPost,
  onExitDock,
  isPopout = false,
}) => {
  const [quickChat, setQuickChat] = useState('');
  const activeMedia = (snapshot.media_queue || []).find(
    (m) => m.status === 'playing' || m.status === 'paused',
  );

  useEffect(() => {
    if (!isPopout) return;
    notifyBrowserPopoutLifecycle('obs_dock', true);
    const onUnload = () => notifyBrowserPopoutLifecycle('obs_dock', false);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      notifyBrowserPopoutLifecycle('obs_dock', false);
    };
  }, [isPopout]);

  const handleSendQuickChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickChat.trim()) return;
    await apiPost('/api/chat/ingest', {
      username: 'Streamer',
      role: 'broadcaster',
      platform: 'local',
      text: quickChat.trim(),
    });
    setQuickChat('');
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-[#090A0F] text-slate-100 text-xs overflow-hidden">
      {/* Компактная адаптивная шапка док-панели OBS Studio (аналог SE.Live) */}
      <header className="px-2.5 py-2 border-b border-slate-800 bg-[#11131C] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap shrink-0 ${
              snapshot.obs.connected
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {snapshot.obs.connected ? 'OBS v5' : 'Автономно'}
          </span>
          <span className="font-bold tracking-tight truncate">OBS Dock</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() =>
              void apiPost('/api/audio/mixer', {
                master_muted: !snapshot.audio_mixer?.master_muted,
              })
            }
            className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
              snapshot.audio_mixer?.master_muted
                ? 'bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Отключить/включить общую шину звука"
          >
            {snapshot.audio_mixer?.master_muted ? 'Mute Мастер' : 'Мастер'}
          </button>
          <button
            type="button"
            onClick={() =>
              void apiPost('/api/audio/mixer', {
                alerts_muted: !snapshot.audio_mixer?.alerts_muted,
              })
            }
            className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
              snapshot.audio_mixer?.alerts_muted
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Отключить/включить звуки алертов"
          >
            {snapshot.audio_mixer?.alerts_muted ? 'Mute Алерты' : 'Алерты'}
          </button>
          <span className="font-mono tabular-nums text-[11px] text-amber-400 px-1">
            Ур.{snapshot.hype_train?.level ?? 1}
          </span>
          <button
            type="button"
            onClick={onExitDock}
            className="px-2 py-1 rounded border border-slate-700 hover:border-blue-500 text-[11px] whitespace-nowrap"
          >
            {isPopout ? 'Вернуть в студию' : 'Полный пульт'}
          </button>
        </div>
      </header>

      {/* Быстрое переключение сцен OBS и счётчиков */}
      <div className="p-2.5 border-b border-slate-800 bg-[#11131C]/60 space-y-2 shrink-0">
        <div className="flex flex-wrap gap-1">
          {snapshot.obs.scenes.map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => void apiPost('/api/scene', { scene: sc })}
              className={`px-2 py-1 rounded text-[11px] font-medium ${
                snapshot.obs.active_scene === sc
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {sc}
            </button>
          ))}
        </div>

        {/* Контроль активного Media Share и Пари (!bet) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
          <div className="truncate text-[11px]">
            {activeMedia ? (
              <span className="text-emerald-400 font-medium">
                🎬 {activeMedia.title} ({activeMedia.remaining_sec}с)
              </span>
            ) : (
              <span className="text-slate-400">Media Share: пусто</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void apiPost('/api/media/control', { action: 'toggle_pause' })}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px]"
            >
              ⏯ Пауза
            </button>
            <button
              type="button"
              onClick={() => void apiPost('/api/media/control', { action: 'skip' })}
              className="px-2 py-0.5 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 text-[11px]"
            >
              ⏭ Скип
            </button>
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/counters/update', {
                  game_counters: {
                    ...snapshot.game_counters,
                    deaths: (snapshot.game_counters?.deaths ?? 0) + 1,
                  },
                })
              }
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono tabular-nums text-[11px]"
            >
              💀 {snapshot.game_counters?.deaths ?? 0} (+1)
            </button>
          </div>
        </div>
      </div>

      {/* Двухсекционный вертикальный стек: Лента донатов + Живой чат */}
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-2 p-2.5 overflow-hidden">
        {/* Верхняя половина: Лента алертов и ставок */}
        <div className="bg-[#11131C] border border-slate-800 rounded-xl p-2.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1.5 shrink-0">
            <span className="font-semibold text-slate-200">Донаты и События (Activity Feed)</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {Math.round(snapshot.goal.current)}/{Math.round(snapshot.goal.target)} ₽
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-1.5 pr-1">
            {snapshot.recent_events
              .slice(-15)
              .reverse()
              .map((ev) => (
                <div
                  key={ev.id}
                  className="p-2 rounded-lg bg-[#090A0F] border border-slate-800/90 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {ev.username}{' '}
                      <span className="text-[10px] text-slate-500">[{ev.source}]</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{ev.message}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono tabular-nums font-bold text-emerald-400">
                      {Math.round(ev.amount)} ₽
                    </span>
                    <button
                      type="button"
                      onClick={() => void apiPost('/api/events/replay', { id: ev.id })}
                      className="px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500 text-[10px]"
                    >
                      Повтор
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Нижняя половина: Мультичат */}
        <div className="bg-[#11131C] border border-slate-800 rounded-xl p-2.5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1.5 shrink-0">
            <span className="font-semibold text-slate-200">Мультичат эфира</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  void apiPost('/api/predictions/manage', { action: 'resolve', winner_id: '1' })
                }
                className="px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 text-[10px]"
              >
                Победа #1
              </button>
              <button
                type="button"
                onClick={() =>
                  void apiPost('/api/predictions/manage', { action: 'resolve', winner_id: '2' })
                }
                className="px-1.5 py-0.5 rounded bg-rose-600/20 text-rose-400 text-[10px]"
              >
                Победа #2
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-1 pr-1">
            {snapshot.chat_history.slice(-30).map((m) => (
              <div key={m.id} className="text-[11px] leading-snug">
                <span className="text-[10px] text-slate-500 mr-1">[{m.platform}]</span>
                <span className="font-semibold mr-1" style={{ color: m.color }}>
                  {m.username}:
                </span>
                <span className="text-slate-200">{m.text}</span>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => void handleSendQuickChat(e)} className="mt-2 flex gap-1.5 shrink-0">
            <input
              value={quickChat}
              onChange={(e) => setQuickChat(e.target.value)}
              placeholder="Написать в чат или !bet / !slots..."
              className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-[#090A0F]"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
