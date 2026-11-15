import React, { useState } from 'react';
import type {
  BotCommand,
  BotTimer,
  ChannelPointMapping,
  RewardItem,
  StreamSnapshot,
  ViewerRole,
} from '../types/stream.ts';

interface ChatBotManagerPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

export const ChatBotManagerPanel: React.FC<ChatBotManagerPanelProps> = ({ snapshot, apiPost }) => {
  const [subTab, setSubTab] = useState<'commands' | 'timers' | 'moderation' | 'shop' | 'trivia'>('commands');

  // Новая команда
  const [cmdTrigger, setCmdTrigger] = useState('!tg');
  const [cmdResponse, setCmdResponse] = useState('Телеграм-канал стримера: t.me/pulsecast_live ($count)');
  const [cmdCooldown, setCmdCooldown] = useState(5);

  // Новый таймер
  const [timerName, setTimerName] = useState('Напоминание про соцсети');
  const [timerMsg, setTimerMsg] = useState('Залетайте в наш Discord и пишите !commands в чат!');
  const [timerSec, setTimerSec] = useState(300);

  // Новая награда за баллы канала
  const [cpTitle, setCpTitle] = useState('Запустить звездопад');
  const [cpCost, setCpCost] = useState(500);
  const [cpAction, setCpAction] = useState<ChannelPointMapping['action_kind']>('trigger_plugin');
  const [cpTarget, setCpTarget] = useState('starfall');

  // Викторина
  const [triviaQ, setTriviaQ] = useState(
    snapshot.trivia?.question || 'Какой язык используется в ядре локального сервера PulseCast?',
  );
  const [triviaA, setTriviaA] = useState(snapshot.trivia?.answer || 'rust');
  const [triviaHint, setTriviaHint] = useState(snapshot.trivia?.hint || 'Краб Феррис');
  const [triviaReward, setTriviaReward] = useState(snapshot.trivia?.reward_currency || 250);

  const commands: BotCommand[] = snapshot.bot_commands || [];
  const timers: BotTimer[] = snapshot.bot_timers || [];
  const mod = snapshot.moderation;
  const shop: RewardItem[] = snapshot.rewards_shop || [];
  const cpMappings: ChannelPointMapping[] = snapshot.channel_point_mappings || [];

  const handleAddCommand = async () => {
    if (!cmdTrigger.trim() || !cmdResponse.trim()) return;
    const trig = cmdTrigger.trim().startsWith('!') ? cmdTrigger.trim() : `!${cmdTrigger.trim()}`;
    const next: BotCommand[] = [
      ...commands.filter((c) => c.trigger !== trig),
      {
        trigger: trig,
        response: cmdResponse.trim(),
        cooldown_sec: cmdCooldown,
        enabled: true,
        usage_count: 0,
      },
    ];
    await apiPost('/api/bot/commands', next);
    setCmdTrigger('');
  };

  const handleToggleCommand = async (trigger: string) => {
    const next = commands.map((c) => (c.trigger === trigger ? { ...c, enabled: !c.enabled } : c));
    await apiPost('/api/bot/commands', next);
  };

  const handleDeleteCommand = async (trigger: string) => {
    const next = commands.filter((c) => c.trigger !== trigger);
    await apiPost('/api/bot/commands', next);
  };

  const handleAddTimer = async () => {
    if (!timerMsg.trim()) return;
    const next: BotTimer[] = [
      ...timers,
      {
        id: `tm_${Date.now()}`,
        name: timerName.trim() || 'Таймер',
        message: timerMsg.trim(),
        interval_sec: Math.max(15, timerSec),
        min_chat_lines: 2,
        enabled: true,
      },
    ];
    await apiPost('/api/bot/timers', next);
  };

  const handleToggleTimer = async (id: string) => {
    const next = timers.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t));
    await apiPost('/api/bot/timers', next);
  };

  const handleDeleteTimer = async (id: string) => {
    const next = timers.filter((t) => t.id !== id);
    await apiPost('/api/bot/timers', next);
  };

  const handleAddChannelPoint = async () => {
    if (!cpTitle.trim()) return;
    const next: ChannelPointMapping[] = [
      ...cpMappings,
      {
        id: `cp_${Date.now()}`,
        platform: 'twitch',
        reward_title: cpTitle.trim(),
        cost: cpCost,
        action_kind: cpAction,
        action_params: {
          plugin_id: cpTarget.trim() || 'starfall',
          sound_id: cpTarget.trim() || 'fanfare',
          scene: cpTarget.trim() || 'Main Studio',
          action: cpTarget.trim() || 'dance',
          username: '*',
        },
        enabled: true,
      },
    ];
    await apiPost('/api/bot/channel-points', next);
  };

  const handleStartTrivia = async (active: boolean) => {
    await apiPost('/api/bot/trivia', {
      active,
      question: triviaQ,
      answer: triviaA,
      hint: triviaHint,
      reward_currency: triviaReward,
      winner: null,
    });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          Классический стрим-бот (Команды, Таймеры, Автомодерация, Награды, Викторина)
        </span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['commands', '!Команды'],
              ['timers', 'Таймеры'],
              ['moderation', 'Модерация'],
              ['shop', 'Магазин и Баллы'],
              ['trivia', 'Викторина'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-2 py-1 rounded text-[11px] font-medium ${
                subTab === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {subTab === 'commands' && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Переменные: <code className="text-blue-400">$user</code>,{' '}
            <code className="text-blue-400">$uptime</code>,{' '}
            <code className="text-blue-400">$count</code>,{' '}
            <code className="text-blue-400">$target</code>,{' '}
            <code className="text-blue-400">$game</code>. Плюс встроенные: <code>!death</code>,{' '}
            <code>!win</code>, <code>!loss</code>, <code>!dance</code>, <code>!jump</code>,{' '}
            <code>!clip</code>.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
            <input
              type="text"
              value={cmdTrigger}
              onChange={(e) => setCmdTrigger(e.target.value)}
              placeholder="!команда"
              className="sm:col-span-3 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="text"
              value={cmdResponse}
              onChange={(e) => setCmdResponse(e.target.value)}
              placeholder="Ответ бота с переменными ($user, $uptime, $count)"
              className="sm:col-span-6 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="number"
              value={cmdCooldown}
              onChange={(e) => setCmdCooldown(Number(e.target.value))}
              placeholder="КД с"
              className="sm:col-span-1 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <button
              type="button"
              onClick={() => void handleAddCommand()}
              className="sm:col-span-2 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              + Сохранить
            </button>
          </div>

          <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
            {commands.map((c) => (
              <div key={c.trigger} className="flex items-center justify-between py-1.5 gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-mono font-bold text-blue-500 mr-2">{c.trigger}</span>
                  <span className="text-slate-600 dark:text-slate-300 truncate">{c.response}</span>
                  <span className="ml-2 text-[10px] text-slate-400">
                    (вызовов: {c.usage_count ?? 0})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      void apiPost('/api/chat/ingest', {
                        platform: 'local',
                        username: 'Стример',
                        role: 'broadcaster',
                        text: c.trigger,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px]"
                  >
                    Тест
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleCommand(c.trigger)}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      c.enabled ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {c.enabled ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCommand(c.trigger)}
                    className="text-rose-400 hover:underline text-[10px]"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'timers' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
            <input
              type="text"
              value={timerName}
              onChange={(e) => setTimerName(e.target.value)}
              placeholder="Название таймера"
              className="sm:col-span-3 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="text"
              value={timerMsg}
              onChange={(e) => setTimerMsg(e.target.value)}
              placeholder="Периодическое сообщение в чат"
              className="sm:col-span-6 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="number"
              value={timerSec}
              onChange={(e) => setTimerSec(Number(e.target.value))}
              className="sm:col-span-1 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <button
              type="button"
              onClick={() => void handleAddTimer()}
              className="sm:col-span-2 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              + Таймер
            </button>
          </div>
          <div className="space-y-1">
            {timers.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-1 px-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              >
                <div className="truncate">
                  <strong className="mr-2">{t.name}</strong>
                  <span className="text-slate-500">({t.interval_sec}с):</span> {t.message}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggleTimer(t.id)}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      t.enabled ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {t.enabled ? 'Активен' : 'Пауза'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteTimer(t.id)}
                    className="text-rose-400 text-[10px]"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'moderation' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={mod.block_links}
                onChange={(e) =>
                  void apiPost('/api/bot/moderation', { ...mod, block_links: e.target.checked })
                }
              />
              Блок ссылок
            </label>
            <label className="flex items-center gap-1.5">
              <span>Капс %:</span>
              <input
                type="number"
                value={mod.max_caps_percent ?? 75}
                onChange={(e) =>
                  void apiPost('/api/bot/moderation', {
                    ...mod,
                    max_caps_percent: Number(e.target.value),
                  })
                }
                className="w-14 px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span>Санкция:</span>
              <select
                value={mod.punishment || 'timeout'}
                onChange={(e) =>
                  void apiPost('/api/bot/moderation', { ...mod, punishment: e.target.value })
                }
                className="px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              >
                <option value="warn">Предупреждение</option>
                <option value="timeout">Тайм-аут</option>
                <option value="ban">Бан</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span>Стоп-слова:</span>
              <input
                type="text"
                value={(mod.blocked_words || []).join(', ')}
                onChange={(e) =>
                  void apiPost('/api/bot/moderation', {
                    ...mod,
                    blocked_words: e.target.value
                      .split(',')
                      .map((w) => w.trim())
                      .filter(Boolean),
                  })
                }
                className="w-28 px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              />
            </label>
          </div>

          <div className="text-[11px] font-medium text-slate-500">
            Журнал автомодерации ({snapshot.moderation_logs?.length || 0}):
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {(snapshot.moderation_logs || []).slice(0, 8).map((l) => (
              <div
                key={l.id}
                className="text-[11px] px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 flex justify-between"
              >
                <span>
                  <strong>{l.username}</strong> [{l.platform}]: {l.reason}
                </span>
                <span className="uppercase font-mono text-[10px]">{l.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'shop' && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Магазин лояльности (за внутреннюю валюту чата):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {shop.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                <div>
                  <div className="font-semibold">{item.title}</div>
                  <div className="text-[10px] text-amber-500 font-mono">{item.cost} монет</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void apiPost('/api/bot/shop/redeem', {
                      reward_id: item.id,
                      username: 'NeoStream',
                    })
                  }
                  className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-[11px]"
                >
                  Активировать
                </button>
              </div>
            ))}
          </div>

          <div className="pt-1 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Привязка наград за баллы канала (Twitch Channel Points → Сцены / Звуки / Эффекты):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
              <input
                type="text"
                value={cpTitle}
                onChange={(e) => setCpTitle(e.target.value)}
                placeholder="Название награды"
                className="sm:col-span-4 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              />
              <select
                value={cpAction}
                onChange={(e) =>
                  setCpAction(e.target.value as ChannelPointMapping['action_kind'])
                }
                className="sm:col-span-3 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              >
                <option value="trigger_plugin">Эффект плагина</option>
                <option value="play_sound">Звук саундборда</option>
                <option value="change_scene">Смена сцены OBS</option>
                <option value="avatar_action">Действие чоков</option>
              </select>
              <input
                type="text"
                value={cpTarget}
                onChange={(e) => setCpTarget(e.target.value)}
                placeholder="ID цели (starfall / fanfare)"
                className="sm:col-span-3 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
              />
              <button
                type="button"
                onClick={() => void handleAddChannelPoint()}
                className="sm:col-span-2 px-2 py-1 rounded bg-blue-600 text-white font-medium"
              >
                + Привязать
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cpMappings.map((cp) => (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() =>
                    void apiPost('/api/bot/channel-points/trigger', {
                      id: cp.id,
                      username: 'Зритель_VIP',
                    })
                  }
                  className="px-2.5 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-[11px]"
                >
                  ⚡ Тест «{cp.reward_title}» ({cp.cost})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'trivia' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
            <input
              type="text"
              value={triviaQ}
              onChange={(e) => setTriviaQ(e.target.value)}
              placeholder="Вопрос викторины для чата"
              className="sm:col-span-6 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="text"
              value={triviaA}
              onChange={(e) => setTriviaA(e.target.value)}
              placeholder="Ответ"
              className="sm:col-span-2 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <input
              type="number"
              value={triviaReward}
              onChange={(e) => setTriviaReward(Number(e.target.value))}
              placeholder="Приз"
              className="sm:col-span-2 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800"
            />
            <button
              type="button"
              onClick={() => void handleStartTrivia(true)}
              className="sm:col-span-2 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              Запустить
            </button>
          </div>
          {snapshot.trivia?.active && (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
              <span>
                Викторина идёт: <strong>{snapshot.trivia.question}</strong> (ответ:{' '}
                <code>{snapshot.trivia.answer}</code>)
              </span>
              <button
                type="button"
                onClick={() => void handleStartTrivia(false)}
                className="text-rose-400 underline text-[11px]"
              >
                Остановить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
