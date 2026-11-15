import React, { useEffect, useRef, useState } from 'react';
import type {
  AutomationScenario,
  FeedConfig,
  GoalWidget,
  ScenarioAction,
  StreamSnapshot,
} from '../types/stream.ts';
import { ExternalBridgePanel } from './ExternalBridgePanel.tsx';
import { AlertDesignerPanel } from './AlertDesignerPanel.tsx';
import { DonationsFinTechPanel } from './DonationsFinTechPanel.tsx';

interface WidgetsAndAutomationTabProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onOpenDonatePage?: () => void;
}

function formatTimer(sec: number): string {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const WidgetsAndAutomationTab: React.FC<WidgetsAndAutomationTabProps> = ({
  snapshot,
  apiPost,
  onOpenDonatePage,
}) => {
  const [subInput, setSubInput] = useState('');
  const [pollQuestion, setPollQuestion] = useState(snapshot.poll.question);
  const [giveawayPrize, setGiveawayPrize] = useState(snapshot.giveaway.prize);
  const [goals, setGoals] = useState<GoalWidget[]>(snapshot.goals || [snapshot.goal]);
  const [scenarios, setScenarios] = useState<AutomationScenario[]>(snapshot.scenarios || []);
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(snapshot.feed_config);
  const [tickerText, setTickerText] = useState(
    snapshot.ticker?.custom_text ||
      'Добро пожаловать на стрим! Отправить донат с видео: /donate · Ставки в чате: !bet 1 100',
  );
  const [countdownLabel, setCountdownLabel] = useState(
    snapshot.ticker?.countdown_label || 'Скоро начнём эфир',
  );
  const [countdownSec, setCountdownSec] = useState(
    snapshot.ticker?.countdown_remaining_sec || 300,
  );
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setGoals(snapshot.goals && snapshot.goals.length > 0 ? snapshot.goals : [snapshot.goal]);
  }, [snapshot.goals, snapshot.goal]);

  useEffect(() => {
    setScenarios(snapshot.scenarios || []);
  }, [snapshot.scenarios]);

  useEffect(() => {
    if (snapshot.feed_config) setFeedCfg(snapshot.feed_config);
  }, [snapshot.feed_config]);

  const toggleMicSubtitles = (enable: boolean) => {
    void apiPost('/api/whisper/toggle', { enabled: enable });
    if (!enable) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      return;
    }
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (SpeechRec) {
      const rec = new SpeechRec() as {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        start: () => void;
        stop: () => void;
      };
      rec.lang = 'ru-RU';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const text = last?.[0]?.transcript;
        if (text) void apiPost('/api/whisper/emit', { text });
      };
      try {
        rec.start();
        recognitionRef.current = rec;
      } catch {
        // Браузер без разрешения микрофона
      }
    }
  };

  const addGoal = () => {
    setGoals((prev) => [
      ...prev,
      {
        id: `goal_${Date.now()}`,
        title: 'Новый сбор средств',
        current: 0,
        target: 5000,
        unit: '₽',
        color: '#10B981',
        visible: true,
      },
    ]);
  };

  const addScenario = () => {
    setScenarios((prev) => [
      ...prev,
      {
        id: `sc_${Date.now()}`,
        name: 'Новый сценарий автоматизации',
        enabled: true,
        trigger_event: 'donation',
        condition_value: '100',
        actions: [{ kind: 'play_sound', params: { sound_id: 'fanfare' } }],
      },
    ]);
  };

  const updateScenarioAction = (scId: string, idx: number, patch: Partial<ScenarioAction>) => {
    setScenarios((prev) =>
      prev.map((sc) =>
        sc.id === scId
          ? {
              ...sc,
              actions: sc.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
            }
          : sc,
      ),
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Панель Media Share, мультивалютного FinTech-ядра DonationAlerts, архива транзакций и RCON-триггеров */}
      <DonationsFinTechPanel
        snapshot={snapshot}
        apiPost={apiPost}
        onOpenDonatePage={onOpenDonatePage}
      />

      {/* Бегущая строка (Ticker) и Экранный таймер («Скоро начнём» / «Перерыв») */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 lg:col-span-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              Бегущая строка (Ticker) и Экранный таймер («Скоро начнём» / «Перерыв»)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Автоматический вывод топ-спонсоров, последних событий и таймера ожидания на оверлей
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={snapshot.ticker?.enabled ?? true}
              onChange={(e) =>
                void apiPost('/api/ticker/config', {
                  ...snapshot.ticker,
                  enabled: e.target.checked,
                })
              }
            />
            <span>Показывать бегущую строку на OBS</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={tickerText}
            onChange={(e) => setTickerText(e.target.value)}
            placeholder="Текст бегущей строки..."
            className="md:col-span-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="button"
            onClick={() =>
              void apiPost('/api/ticker/config', {
                ...snapshot.ticker,
                custom_text: tickerText,
              })
            }
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
          >
            Обновить бегущую строку
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center pt-1">
          <input
            value={countdownLabel}
            onChange={(e) => setCountdownLabel(e.target.value)}
            placeholder="Скоро начнём / Перерыв"
            className="sm:col-span-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <input
            type="number"
            value={countdownSec}
            onChange={(e) => setCountdownSec(Math.max(10, Number(e.target.value) || 300))}
            className="px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="button"
            onClick={() =>
              void apiPost('/api/ticker/config', {
                ...snapshot.ticker,
                countdown_active: !snapshot.ticker?.countdown_active,
                countdown_label: countdownLabel,
                countdown_remaining_sec: countdownSec,
              })
            }
            className={`px-3 py-1.5 rounded font-semibold ${
              snapshot.ticker?.countdown_active
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-100'
            }`}
          >
            {snapshot.ticker?.countdown_active
              ? `⏱ Стоп (${snapshot.ticker.countdown_remaining_sec}с)`
              : '⏱ Запустить таймер на экране'}
          </button>
        </div>
      </section>

      {/* Универсальный мост захвата алертов (DonationAlerts / Boosty / OCR / Userscript) */}
      <ExternalBridgePanel snapshot={snapshot} apiPost={apiPost} />

      {/* Локальная библиотека медиа и конструктор вариаций алертов */}
      <AlertDesignerPanel snapshot={snapshot} apiPost={apiPost} />

      {/* Конструктор множественных целей сборов */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Цели сборов (Goals)</h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={addGoal}
              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              Добавить сбор
            </button>
            <button
              type="button"
              onClick={() => {
                void apiPost('/api/goals', goals);
                setSaveMsg('Цели сборов сохранены.');
              }}
              className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold"
            >
              Сохранить
            </button>
          </div>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto custom-scroll pr-1">
          {goals.map((g) => (
            <div
              key={g.id}
              className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={g.visible}
                  onChange={(e) =>
                    setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, visible: e.target.checked } : x)))
                  }
                />
                <input
                  value={g.title}
                  onChange={(e) =>
                    setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, title: e.target.value } : x)))
                  }
                  className="flex-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-semibold"
                />
                <input
                  type="color"
                  value={g.color || '#2563EB'}
                  onChange={(e) =>
                    setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, color: e.target.value } : x)))
                  }
                  className="w-8 h-7 rounded border border-slate-200 dark:border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => setGoals((prev) => prev.filter((x) => x.id !== g.id))}
                  className="text-red-500 px-1.5"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] text-slate-400">Собрано</span>
                  <input
                    type="number"
                    value={g.current}
                    onChange={(e) =>
                      setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, current: Number(e.target.value) } : x)))
                    }
                    className="w-full px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Цель</span>
                  <input
                    type="number"
                    value={g.target}
                    onChange={(e) =>
                      setGoals((prev) =>
                        prev.map((x) => (x.id === g.id ? { ...x, target: Math.max(1, Number(e.target.value)) } : x)),
                      )
                    }
                    className="w-full px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">Ед. изм.</span>
                  <input
                    value={g.unit}
                    onChange={(e) =>
                      setGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, unit: e.target.value } : x)))
                    }
                    className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Настройки ленты событий эфира */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Настройки ленты событий эфира</h2>
          <button
            type="button"
            onClick={() => {
              void apiPost('/api/feed-config', feedCfg);
              setSaveMsg('Настройки ленты событий сохранены.');
            }}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold"
          >
            Применить
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <label className="block col-span-2">
            <span className="text-[11px] text-slate-400">Заголовок ленты</span>
            <input
              value={feedCfg.title}
              onChange={(e) => setFeedCfg({ ...feedCfg, title: e.target.value })}
              className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Максимум строк</span>
            <input
              type="number"
              min={1}
              max={30}
              value={feedCfg.max_items}
              onChange={(e) => setFeedCfg({ ...feedCfg, max_items: Number(e.target.value) || 8 })}
              className="w-full mt-0.5 px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Мин. сумма для показа</span>
            <input
              type="number"
              min={0}
              value={feedCfg.min_amount}
              onChange={(e) => setFeedCfg({ ...feedCfg, min_amount: Number(e.target.value) || 0 })}
              className="w-full mt-0.5 px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={feedCfg.show_source}
              onChange={(e) => setFeedCfg({ ...feedCfg, show_source: e.target.checked })}
            />
            <span>Показывать источник (Boosty/DA)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={feedCfg.show_time}
              onChange={(e) => setFeedCfg({ ...feedCfg, show_time: e.target.checked })}
            />
            <span>Показывать время события</span>
          </label>
        </div>
        {saveMsg && <div className="text-xs text-blue-500">{saveMsg}</div>}
      </section>

      {/* Сценарии автоматизации RutonyChat (полный CRUD) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Конструктор сценариев автоматизации (Event → Action)</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addScenario}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              Добавить сценарий
            </button>
            <button
              type="button"
              onClick={() => {
                void apiPost('/api/scenarios', scenarios);
                setSaveMsg('Сценарии автоматизации сохранены.');
              }}
              className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold"
            >
              Сохранить сценарии
            </button>
          </div>
        </div>
        <div className="space-y-2.5">
          {scenarios.map((sc) => (
            <div
              key={sc.id}
              className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={sc.enabled}
                  onChange={(e) =>
                    setScenarios((prev) => prev.map((x) => (x.id === sc.id ? { ...x, enabled: e.target.checked } : x)))
                  }
                />
                <input
                  value={sc.name}
                  onChange={(e) =>
                    setScenarios((prev) => prev.map((x) => (x.id === sc.id ? { ...x, name: e.target.value } : x)))
                  }
                  className="flex-1 min-w-[180px] px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-semibold"
                />
                <select
                  value={sc.trigger_event}
                  onChange={(e) =>
                    setScenarios((prev) =>
                      prev.map((x) => (x.id === sc.id ? { ...x, trigger_event: e.target.value } : x)),
                    )
                  }
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                >
                  <option value="donation">Донат (сумма ≥)</option>
                  <option value="chat_keyword">Слово в чате</option>
                  <option value="subscription">Подписка</option>
                </select>
                <input
                  value={sc.condition_value}
                  onChange={(e) =>
                    setScenarios((prev) =>
                      prev.map((x) => (x.id === sc.id ? { ...x, condition_value: e.target.value } : x)),
                    )
                  }
                  placeholder="Условие (500 или слово)"
                  className="w-32 px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
                <button
                  type="button"
                  onClick={() => setScenarios((prev) => prev.filter((x) => x.id !== sc.id))}
                  className="text-red-500 px-2"
                >
                  Удалить
                </button>
              </div>

              <div className="space-y-1.5 pl-4 border-l border-slate-200 dark:border-slate-800">
                {sc.actions.map((act, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <select
                      value={act.kind}
                      onChange={(e) => updateScenarioAction(sc.id, idx, { kind: e.target.value })}
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    >
                      <option value="play_sound">Воспроизвести звук</option>
                      <option value="trigger_plugin">Эффект плагина</option>
                      <option value="avatar_action">Действие аватара</option>
                      <option value="change_scene">Сменить сцену OBS</option>
                      <option value="bot_reply">Ответ бота в чат</option>
                    </select>
                    <input
                      value={JSON.stringify(act.params)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          updateScenarioAction(sc.id, idx, { params: parsed });
                        } catch {
                          // Ждём валидного JSON
                        }
                      }}
                      className="flex-1 min-w-[200px] px-2 py-1 font-mono text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setScenarios((prev) =>
                          prev.map((x) =>
                            x.id === sc.id ? { ...x, actions: x.actions.filter((_, i) => i !== idx) } : x,
                          ),
                        )
                      }
                      className="text-slate-400 hover:text-red-500 px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setScenarios((prev) =>
                      prev.map((x) =>
                        x.id === sc.id
                          ? { ...x, actions: [...x.actions, { kind: 'play_sound', params: { sound_id: 'coin' } }] }
                          : x,
                      ),
                    )
                  }
                  className="text-[11px] text-blue-500 hover:underline"
                >
                  + Добавить действие
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Subathon, Stream Boss и Колесо фортуны */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Subathon-таймер и Stream Boss
          </h2>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatTimer(snapshot.subathon.remaining_seconds)}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void apiPost('/api/subathon/toggle', { running: !snapshot.subathon.running })}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
              >
                {snapshot.subathon.running ? 'Пауза' : 'Старт'}
              </button>
              <button
                type="button"
                onClick={() => void apiPost('/api/subathon/toggle', { add_seconds: 60 })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono"
              >
                +60с
              </button>
              <button
                type="button"
                onClick={() => void apiPost('/api/subathon/toggle', { add_seconds: 300 })}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono"
              >
                +5м
              </button>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span>
              Текущий Stream Boss: <strong>{snapshot.stream_boss.boss_name}</strong>
            </span>
            <span className="font-mono tabular-nums">
              {Math.round(snapshot.stream_boss.hp)} / {Math.round(snapshot.stream_boss.max_hp)} HP
            </span>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Колесо фортуны (Spin Wheel)</h3>
            <button
              type="button"
              onClick={() => void apiPost('/api/wheel/spin', {})}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
            >
              Крутить колесо
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            {snapshot.wheel_segments.map((seg, i) => (
              <span
                key={i}
                className="px-2 py-1 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800"
              >
                {seg.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Опросы и Розыгрыши RutonyChat */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Опрос зрителей</h2>
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/poll', {
                  active: !snapshot.poll.active,
                  question: pollQuestion,
                })
              }
              className="px-3 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {snapshot.poll.active ? 'Закрыть опрос' : 'Запустить опрос'}
            </button>
          </div>
          <input
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] mb-2"
          />
          <div className="space-y-1.5">
            {snapshot.poll.options.map((opt) => (
              <div key={opt.id} className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => void apiPost('/api/poll/vote', { option_id: opt.id })}
                  className="flex-1 text-left px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-blue-500"
                >
                  {opt.label}
                </button>
                <span className="font-mono tabular-nums w-12 text-right">{opt.votes}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Розыгрыш (Giveaway · {snapshot.giveaway.keyword})</h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Участников: {snapshot.giveaway.participants.length}
            </span>
          </div>
          <input
            value={giveawayPrize}
            onChange={(e) => setGiveawayPrize(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] mb-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apiPost('/api/giveaway', { action: 'start', prize: giveawayPrize })}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Открыть набор
            </button>
            <button
              type="button"
              onClick={() => void apiPost('/api/giveaway', { action: 'pick_winner' })}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Выбрать победителя
            </button>
          </div>
          {snapshot.giveaway.last_winner && (
            <div className="mt-2 text-xs text-emerald-500 font-medium">
              Последний победитель: @{snapshot.giveaway.last_winner}
            </div>
          )}
        </div>
      </section>

      {/* Hype Train, Счётчики смертей/побед и 2D PNGTuber-аватар с липсинком от микрофона */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Hype Train и Счётчики эфира (!death, !win, !loss)</h2>
            <button
              type="button"
              onClick={() => void apiPost('/api/counters/update', { hype_progress_delta: 20 })}
              className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 font-semibold"
            >
              🚂 +20% Hype Train
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-center space-y-1">
              <div className="text-slate-400">💀 Смерти (!death)</div>
              <div className="text-lg font-bold font-mono">{snapshot.game_counters?.deaths ?? 0}</div>
              <div className="flex justify-center gap-1">
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { deaths_delta: 1 })}
                  className="px-2 py-0.5 rounded bg-rose-600 text-white"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { deaths_delta: -1 })}
                  className="px-2 py-0.5 rounded bg-slate-700 text-slate-200"
                >
                  -1
                </button>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-center space-y-1">
              <div className="text-slate-400">🏆 Победы (!win)</div>
              <div className="text-lg font-bold font-mono text-emerald-400">{snapshot.game_counters?.wins ?? 0}</div>
              <div className="flex justify-center gap-1">
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { wins_delta: 1 })}
                  className="px-2 py-0.5 rounded bg-emerald-600 text-white"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { wins_delta: -1 })}
                  className="px-2 py-0.5 rounded bg-slate-700 text-slate-200"
                >
                  -1
                </button>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-center space-y-1">
              <div className="text-slate-400">Поражения (!loss)</div>
              <div className="text-lg font-bold font-mono text-slate-300">{snapshot.game_counters?.losses ?? 0}</div>
              <div className="flex justify-center gap-1">
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { losses_delta: 1 })}
                  className="px-2 py-0.5 rounded bg-blue-600 text-white"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => void apiPost('/api/counters/update', { losses_delta: -1 })}
                  className="px-2 py-0.5 rounded bg-slate-700 text-slate-200"
                >
                  -1
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2D PNGTuber-аватар с реакцией на голос и события */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Слоёный 2D PNGTuber-аватар на оверлее</h2>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={snapshot.pngtuber?.enabled ?? true}
                onChange={(e) =>
                  void apiPost('/api/pngtuber/config', {
                    ...snapshot.pngtuber,
                    enabled: e.target.checked,
                  })
                }
              />
              <span>Показывать на OBS</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={snapshot.pngtuber?.name || 'Кибер-Лис'}
              onChange={(e) =>
                void apiPost('/api/pngtuber/config', {
                  ...snapshot.pngtuber,
                  name: e.target.value,
                })
              }
              placeholder="Имя PNGTuber-аватара"
              className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <select
              value={snapshot.pngtuber?.idle_url || ''}
              onChange={(e) =>
                void apiPost('/api/pngtuber/config', {
                  ...snapshot.pngtuber,
                  idle_url: e.target.value,
                })
              }
              className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            >
              <option value="">Встроенный SVG Кибер-Лис</option>
              {(snapshot.media_assets || [])
                .filter((a) => a.kind === 'image')
                .map((a) => (
                  <option key={a.id} value={a.url}>
                    Спрайт: {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/pngtuber/config', {
                  ...snapshot.pngtuber,
                  talking: !snapshot.pngtuber?.talking,
                })
              }
              className={`px-3 py-1 rounded font-semibold ${
                snapshot.pngtuber?.talking ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200'
              }`}
            >
              {snapshot.pngtuber?.talking ? '🎙 Липсинк активен (Рот открыт)' : '🎙 Тест липсинка (Голос)'}
            </button>
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/pngtuber/config', {
                  ...snapshot.pngtuber,
                  emotion: snapshot.pngtuber?.emotion === 'happy' ? 'idle' : 'happy',
                })
              }
              className="px-3 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 font-medium"
            >
              Эмоция: {snapshot.pngtuber?.emotion === 'happy' ? 'Радость ★' : 'Спокойствие'}
            </button>
          </div>
        </div>
      </section>

      {/* Потоковые субтитры Whisper */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Субтитры Whisper</h2>
          <button
            type="button"
            onClick={() => toggleMicSubtitles(!snapshot.whisper.enabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              snapshot.whisper.enabled ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
            }`}
          >
            {snapshot.whisper.enabled ? 'Остановить микрофон' : 'Включить распознавание'}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{snapshot.whisper.diagnostic}</p>
        <div className="flex gap-2">
          <input
            value={subInput}
            onChange={(e) => setSubInput(e.target.value)}
            placeholder="Отправить тестовую фразу субтитров на оверлей..."
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="button"
            onClick={() => {
              if (!subInput.trim()) return;
              void apiPost('/api/whisper/emit', { text: subInput.trim() });
              setSubInput('');
            }}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
          >
            Показать
          </button>
        </div>
      </section>
    </div>
  );
};
