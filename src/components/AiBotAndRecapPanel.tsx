import React, { useState } from 'react';
import type { AiChatbotConfig, StreamSnapshot } from '../types/stream.ts';

interface AiBotAndRecapPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

const PERSONA_PRESETS: Array<{ name: string; prompt: string }> = [
  {
    name: 'Кибер-Лис Пульс',
    prompt:
      'Ты — Кибер-Лис Пульс, энергичный цифровой соведущий стримера. Отвечай с юмором, поддерживай хайп и помогай чату.',
  },
  {
    name: 'Средневековый трактирщик',
    prompt:
      'Ты — старый добрый трактирщик у камина. Называй зрителей путниками, предлагай эль и рассказывай легенды об игре.',
  },
  {
    name: 'Аниме-ведущая',
    prompt:
      'Ты — милая и бодрая аниме-ведущая эфира! Поддерживай стримера и радуйся каждому сообщению и донату.',
  },
  {
    name: 'Техно-модератор',
    prompt:
      'Ты — лаконичный бортовой ИИ-модератор студии. Отвечай точно по делу, следи за порядком и выдавай аналитику.',
  },
];

export const AiBotAndRecapPanel: React.FC<AiBotAndRecapPanelProps> = ({ snapshot, apiPost }) => {
  const aiCfg: AiChatbotConfig = snapshot.ai_chatbot;
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const updateAi = async (patch: Partial<AiChatbotConfig>) => {
    await apiPost('/api/ai-bot/config', { ...aiCfg, ...patch });
  };

  const handleVoiceCommand = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceStatus('Браузерный SpeechRecognition недоступен — используйте кнопки быстрых голосовых команд ниже.');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'ru-RU';
      setVoiceStatus('Слушаю голосовую команду микрофона...');
      rec.onresult = (ev: any) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || '';
        setVoiceStatus(`Распознано: «${transcript}»`);
        if (transcript) {
          void apiPost('/api/agent', { prompt: transcript });
        }
      };
      rec.onerror = () => setVoiceStatus('Не удалось распознать голос, попробуйте ещё раз.');
      rec.start();
    } catch {
      setVoiceStatus('Ошибка доступа к микрофону.');
    }
  };

  const recap = snapshot.stream_recap;

  return (
    <div className="space-y-4">
      {/* Секция 3: ИИ Чат-бот нового поколения (Next-Gen AI Bot Features) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              ИИ Чат-бот нового поколения (Персонаж, Контекст, Перевод, ИИ-модерация)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Работает через локальный <code>llama.cpp</code> с мгновенным детерминированным офлайн-фоллбэком
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PERSONA_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => void updateAi({ persona_name: p.name, system_prompt: p.prompt })}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
                  aiCfg.persona_name === p.name
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Характер и роль бота (System Persona Prompt)
            </label>
            <textarea
              rows={2}
              value={aiCfg.system_prompt}
              onChange={(e) => void updateAi({ system_prompt: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Контекст текущей игры / стрима (бот отвечает зрителям без !команд)
            </label>
            <textarea
              rows={2}
              value={aiCfg.game_context}
              onChange={(e) => void updateAi({ game_context: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs"
            />
          </div>
        </div>

        {/* Тумблеры модулей ИИ-бота */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-1">
          {(
            [
              ['conversational_reply', 'Диалог в чате (@bot / вопросы)'],
              ['smart_greeting', 'Умное приветствие новичков и донатов'],
              ['ai_moderation', 'Контекстная ИИ-модерация токсичности'],
              ['live_translation', 'Живой автоперевод чата (EN/ES → RU)'],
              ['auto_stream_reaction', 'Авто-реакция агента на события'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(aiCfg[key])}
                onChange={(e) => void updateAi({ [key]: e.target.checked })}
              />
              <span className="text-[11px] leading-tight font-medium">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Секция 4: Голосовое управление стримом, OBS Аудио и Генератор сводки (Recap) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Голосовое управление агентом и OBS Аудио</h3>
            <button
              type="button"
              onClick={handleVoiceCommand}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs"
            >
              🎙 Сказать команду голосом
            </button>
          </div>
          {voiceStatus && <div className="text-[11px] text-amber-400">{voiceStatus}</div>}

          <div className="flex flex-wrap gap-1.5">
            {[
              'Бот, запусти опрос на выбор следующей игры',
              'Бот, поставь таймер на 5 минут и переключи сцену на перерыв',
              'Бот, выключи микрофон и убавь музыку до 20%',
              'Бот, сохрани клип и добавь +1 смерть',
            ].map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => void apiPost('/api/agent', { prompt: cmd })}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-[11px] transition-colors"
              >
                «{cmd}»
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={snapshot.obs_audio?.mic_muted ?? false}
                onChange={(e) =>
                  void apiPost('/api/obs/audio', {
                    ...snapshot.obs_audio,
                    mic_muted: e.target.checked,
                  })
                }
              />
              <span className="font-medium">
                Микрофон OBS: {snapshot.obs_audio?.mic_muted ? '🔇 ВЫКЛ' : '🎙 ВКЛ'}
              </span>
            </label>
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <span>Музыка OBS:</span>
              <input
                type="range"
                min={0}
                max={100}
                value={snapshot.obs_audio?.music_volume ?? 65}
                onChange={(e) =>
                  void apiPost('/api/obs/audio', {
                    ...snapshot.obs_audio,
                    music_volume: Number(e.target.value),
                  })
                }
                className="flex-1"
              />
              <span className="font-mono w-9 text-right">
                {snapshot.obs_audio?.music_volume ?? 65}%
              </span>
            </div>
          </div>
        </div>

        {/* Генерация сводки эфира (Stream Recap) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Генерация сводки стрима (AI Stream Recap)</h3>
              <p className="text-[11px] text-slate-500">
                Краткое резюме эфира, лучшие моменты, топ-донатеры и статистика чата
              </p>
            </div>
            <button
              type="button"
              onClick={() => void apiPost('/api/ai-bot/recap', {})}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shrink-0"
            >
              Сформировать сводку
            </button>
          </div>

          {recap ? (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="font-semibold text-blue-400">{recap.summary_text}</div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400">Топ чата:</span>{' '}
                  {recap.top_chatters.join(', ') || '—'}
                </div>
                <div>
                  <span className="text-slate-400">Хайлайты:</span>{' '}
                  {recap.highlights.join(' · ') || '—'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 italic">
              Нажмите «Сформировать сводку», чтобы ИИ-агент проанализировал чат, клипы и донаты за эфир.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
