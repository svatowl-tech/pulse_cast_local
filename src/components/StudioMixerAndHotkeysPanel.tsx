import React, { useState } from 'react';
import type { HotkeyActionKind, HotkeyBinding, StreamSnapshot, StudioAudioMixer } from '../types/stream.ts';
import { playSynthTone, speakTts } from './audioSynth.ts';

interface StudioMixerAndHotkeysPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onTriggerHotkey?: (binding: HotkeyBinding) => void;
}

const ACTION_LABELS: Record<HotkeyActionKind, string> = {
  deck_button: 'Кнопка пульта',
  change_scene: 'Смена сцены OBS',
  mute_master: 'Mute Мастер',
  mute_alerts: 'Mute Алерты',
  skip_media: 'Пропуск Media Share',
  mark_clip: 'Маркер клипа',
  toggle_subtitles: 'Вкл/Выкл субтитры',
};

function formatKeyCombo(e: React.KeyboardEvent<HTMLButtonElement>): string | null {
  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const normKey =
    key === ' '
      ? 'Space'
      : key.length === 1
        ? key.toUpperCase()
        : key;
  parts.push(normKey);
  return parts.join('+');
}

export const StudioMixerAndHotkeysPanel: React.FC<StudioMixerAndHotkeysPanelProps> = ({
  snapshot,
  apiPost,
  onTriggerHotkey,
}) => {
  const mixer = snapshot.audio_mixer;
  const hotkeys = snapshot.hotkeys || [];

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newCombo, setNewCombo] = useState('Alt+6');
  const [newKind, setNewKind] = useState<HotkeyActionKind>('deck_button');
  const [newTarget, setNewTarget] = useState(snapshot.deck_buttons[0]?.id || '');

  const patchMixer = (patch: Partial<StudioAudioMixer>) => {
    void apiPost('/api/audio/mixer', patch);
  };

  const saveHotkeys = (next: HotkeyBinding[]) => {
    void apiPost('/api/hotkeys', next);
  };

  const handleRecordKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecordingId(null);
      return;
    }
    const combo = formatKeyCombo(e);
    if (!combo) return;
    const next = hotkeys.map((h) => (h.id === id ? { ...h, combo } : h));
    saveHotkeys(next);
    setRecordingId(null);
  };

  const handleAddHotkey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCombo.trim()) return;
    const binding: HotkeyBinding = {
      id: `hk_${Date.now()}`,
      label: newLabel.trim() || ACTION_LABELS[newKind],
      combo: newCombo.trim(),
      action_kind: newKind,
      target_id:
        newKind === 'deck_button'
          ? newTarget || snapshot.deck_buttons[0]?.id || ''
          : newKind === 'change_scene'
            ? newTarget || snapshot.obs.scenes[0] || ''
            : '',
      enabled: true,
    };
    saveHotkeys([...hotkeys, binding]);
    setNewLabel('');
  };

  const channels: Array<{
    key: 'master' | 'alerts' | 'tts' | 'media';
    title: string;
    subtitle: string;
    volume: number;
    muted: boolean;
    onVolume: (v: number) => void;
    onToggleMute: () => void;
    accentClass: string;
  }> = [
    {
      key: 'master',
      title: 'Мастер',
      subtitle: 'Общая шина',
      volume: mixer.master_volume,
      muted: mixer.master_muted,
      onVolume: (v) => patchMixer({ master_volume: v }),
      onToggleMute: () => patchMixer({ master_muted: !mixer.master_muted }),
      accentClass: 'accent-blue-600',
    },
    {
      key: 'alerts',
      title: 'Алерты и SFX',
      subtitle: 'Донаты, саундборд',
      volume: mixer.alerts_volume,
      muted: mixer.alerts_muted,
      onVolume: (v) => patchMixer({ alerts_volume: v }),
      onToggleMute: () => patchMixer({ alerts_muted: !mixer.alerts_muted }),
      accentClass: 'accent-emerald-500',
    },
    {
      key: 'tts',
      title: 'TTS Озвучка',
      subtitle: 'Голос донатов',
      volume: mixer.tts_volume,
      muted: mixer.tts_muted,
      onVolume: (v) => patchMixer({ tts_volume: v }),
      onToggleMute: () => patchMixer({ tts_muted: !mixer.tts_muted }),
      accentClass: 'accent-violet-500',
    },
    {
      key: 'media',
      title: 'Media Share',
      subtitle: 'Видео и музыка',
      volume: mixer.media_volume,
      muted: mixer.media_muted,
      onVolume: (v) => patchMixer({ media_volume: v }),
      onToggleMute: () => patchMixer({ media_muted: !mixer.media_muted }),
      accentClass: 'accent-amber-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* 4-канальный студийный аудио-микшер */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Студийный аудио-микшер (4 канала)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Раздельная громкость для пульта и OBS Browser Source
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => playSynthTone(587.33, 'fanfare', 0.65, mixer)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-xs font-medium whitespace-nowrap"
            >
              Тест SFX
            </button>
            <button
              type="button"
              onClick={() => speakTts('Проверка уровня громкости синтезатора речи PulseCast.', mixer)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-violet-500 text-xs font-medium whitespace-nowrap"
            >
              Тест TTS
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {channels.map((ch) => (
            <div key={ch.key} className="py-2.5 first:pt-1 last:pb-1 flex items-center gap-3">
              <div className="w-32 shrink-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{ch.title}</div>
                <div className="text-[11px] text-slate-400">{ch.subtitle}</div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={ch.volume}
                onChange={(e) => ch.onVolume(Number(e.target.value))}
                className={`flex-1 min-w-0 cursor-pointer ${ch.accentClass}`}
              />
              <span className="w-11 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-200 shrink-0">
                {ch.muted ? 'MUTE' : `${ch.volume}%`}
              </span>
              <button
                type="button"
                onClick={ch.onToggleMute}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  ch.muted
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {ch.muted ? 'Вкл' : 'Mute'}
              </button>
            </div>
          ))}
        </div>

        {/* Тонкая настройка TTS скорости и высоты */}
        <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Скорость TTS</span>
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={mixer.tts_rate}
              onChange={(e) => patchMixer({ tts_rate: Number(e.target.value) })}
              className="flex-1 accent-violet-500"
            />
            <span className="font-mono tabular-nums w-10 text-right">{mixer.tts_rate.toFixed(2)}x</span>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Тон голоса</span>
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={mixer.tts_pitch}
              onChange={(e) => patchMixer({ tts_pitch: Number(e.target.value) })}
              className="flex-1 accent-violet-500"
            />
            <span className="font-mono tabular-nums w-10 text-right">{mixer.tts_pitch.toFixed(2)}</span>
          </label>
        </div>
      </section>

      {/* Глобальные горячие клавиши для пульта и сцен */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Глобальные горячие клавиши
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Работают во всей студии (кликните по комбинации для переназначения)
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs text-slate-400">{hotkeys.length} шт.</span>
        </div>

        <div className="max-h-56 overflow-y-auto custom-scroll divide-y divide-slate-100 dark:divide-slate-800 pr-1">
          {hotkeys.map((hk) => {
            const isRecording = recordingId === hk.id;
            return (
              <div key={hk.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hk.enabled}
                    onChange={() =>
                      saveHotkeys(hotkeys.map((x) => (x.id === hk.id ? { ...x, enabled: !x.enabled } : x)))
                    }
                    className="rounded accent-blue-600 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{hk.label}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {ACTION_LABELS[hk.action_kind]}
                      {hk.target_id ? ` · ${hk.target_id}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-hotkey-recording={isRecording ? 'true' : undefined}
                    onClick={() => setRecordingId(isRecording ? null : hk.id)}
                    onKeyDown={(e) => {
                      if (isRecording) handleRecordKeyDown(e, hk.id);
                    }}
                    className={`px-2.5 py-1 rounded-md font-mono text-[11px] border whitespace-nowrap transition-colors ${
                      isRecording
                        ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] hover:border-blue-500'
                    }`}
                  >
                    {isRecording ? 'Нажмите клавиши...' : hk.combo}
                  </button>
                  {onTriggerHotkey && (
                    <button
                      type="button"
                      onClick={() => onTriggerHotkey(hk)}
                      className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-[11px] whitespace-nowrap"
                    >
                      Тест
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => saveHotkeys(hotkeys.filter((x) => x.id !== hk.id))}
                    className="px-2 py-1 rounded-md text-slate-400 hover:text-rose-500 text-[11px]"
                    title="Удалить горячую клавишу"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={handleAddHotkey}
          className="pt-2.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs"
        >
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Название"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <select
            value={newKind}
            onChange={(e) => {
              const kind = e.target.value as HotkeyActionKind;
              setNewKind(kind);
              if (kind === 'deck_button') setNewTarget(snapshot.deck_buttons[0]?.id || '');
              else if (kind === 'change_scene') setNewTarget(snapshot.obs.scenes[0] || '');
              else setNewTarget('');
            }}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          >
            {Object.entries(ACTION_LABELS).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>
          {newKind === 'deck_button' ? (
            <select
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            >
              {snapshot.deck_buttons.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          ) : newKind === 'change_scene' ? (
            <select
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            >
              {snapshot.obs.scenes.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={newCombo}
              onChange={(e) => setNewCombo(e.target.value)}
              placeholder="Alt+6"
              className="px-2.5 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          )}
          <div className="flex gap-1.5">
            {(newKind === 'deck_button' || newKind === 'change_scene') && (
              <input
                value={newCombo}
                onChange={(e) => setNewCombo(e.target.value)}
                placeholder="Alt+6"
                className="w-20 px-2 py-1.5 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
            )}
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold whitespace-nowrap"
            >
              + Клавиша
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
