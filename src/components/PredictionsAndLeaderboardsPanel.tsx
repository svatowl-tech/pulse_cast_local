import React, { useMemo, useState } from 'react';
import type { StreamSnapshot } from '../types/stream.ts';

interface PredictionsAndLeaderboardsPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

export const PredictionsAndLeaderboardsPanel: React.FC<PredictionsAndLeaderboardsPanelProps> = ({
  snapshot,
  apiPost,
}) => {
  const [predTitle, setPredTitle] = useState(
    snapshot.prediction?.title || 'Победим ли босса с первой попытки?',
  );
  const [outcome1, setOutcome1] = useState(
    snapshot.prediction?.outcomes?.[0]?.label || 'Да, с первого трая!',
  );
  const [outcome2, setOutcome2] = useState(
    snapshot.prediction?.outcomes?.[1]?.label || 'Нет, будет вайп',
  );
  const [betAmount, setBetAmount] = useState(100);
  const [slotsWager, setSlotsWager] = useState(50);
  const [leaderMetric, setLeaderMetric] = useState<'currency' | 'donated' | 'messages'>('currency');

  const pred = snapshot.prediction;
  const totalPool = useMemo(
    () => (pred?.outcomes || []).reduce((acc, o) => acc + o.pool, 0),
    [pred],
  );

  const sortedLeaders = useMemo(() => {
    const list = Object.values(snapshot.viewers || {});
    if (leaderMetric === 'donated') {
      return list.sort((a, b) => b.total_donated - a.total_donated);
    }
    if (leaderMetric === 'messages') {
      return list.sort((a, b) => b.message_count - a.message_count);
    }
    return list.sort((a, b) => b.currency - a.currency);
  }, [snapshot.viewers, leaderMetric]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
      {/* 1. Тотализатор и пари StreamElements (!bet) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Тотализатор и Ставки (!bet 1 100)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Банк: <strong className="font-mono tabular-nums">{totalPool}</strong>{' '}
              {snapshot.arena.currency_name} ·{' '}
              {pred?.active ? (pred.locked ? '🔒 Ставки закрыты' : '🟢 Приём ставок') : 'Завершено'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void apiPost('/api/predictions/manage', { action: 'lock' })}
            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 font-medium"
          >
            {pred?.locked ? 'Открыть' : 'Заблокировать'}
          </button>
        </div>

        <input
          value={predTitle}
          onChange={(e) => setPredTitle(e.target.value)}
          placeholder="Вопрос пари..."
          className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] font-medium"
        />

        <div className="grid grid-cols-2 gap-2">
          {(pred?.outcomes || []).map((o, idx) => {
            const pct = totalPool > 0 ? Math.round((o.pool / totalPool) * 100) : 50;
            const odds = o.pool > 0 ? (totalPool / o.pool).toFixed(2) : '2.00';
            return (
              <div
                key={o.id}
                className={`p-2.5 rounded-lg border space-y-1.5 ${
                  idx === 0
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-rose-500/40 bg-rose-500/5'
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate">
                    #{o.id} {o.label}
                  </span>
                  <span className="font-mono tabular-nums text-amber-400">{odds}x</span>
                </div>
                <div className="font-mono tabular-nums text-[11px] text-slate-400">
                  Пул: {o.pool} ({pct}%) · Игроков: {o.bettors_count}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      void apiPost('/api/predictions/bet', {
                        username: 'AlexStream',
                        outcome_id: o.id,
                        amount: betAmount,
                      })
                    }
                    className="flex-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono tabular-nums text-[11px]"
                  >
                    !bet {o.id} {betAmount}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void apiPost('/api/predictions/manage', {
                        action: 'resolve',
                        winner_id: o.id,
                      })
                    }
                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px]"
                    title="Объявить победителем и выплатить банк"
                  >
                    Победа
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <input
            value={outcome1}
            onChange={(e) => setOutcome1(e.target.value)}
            placeholder="Исход #1"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <input
            value={outcome2}
            onChange={(e) => setOutcome2(e.target.value)}
            placeholder="Исход #2"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="text-slate-400">Ставка:</span>
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(Math.max(10, Number(e.target.value) || 50))}
              className="w-20 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/predictions/manage', {
                  action: 'create',
                  title: predTitle,
                  outcome_1: outcome1,
                  outcome_2: outcome2,
                })
              }
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              Новое пари
            </button>
            <button
              type="button"
              onClick={() => void apiPost('/api/predictions/manage', { action: 'cancel' })}
              className="px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-rose-400"
            >
              Возврат
            </button>
          </div>
        </div>
      </section>

      {/* 2. Слот-машина StreamElements (!slots) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Слот-машина (!slots)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Джекпот до 10x с выводом барабана на OBS-оверлей
              </p>
            </div>
            <span className="font-mono text-[11px] text-amber-400">7️⃣7️⃣7️⃣ = 10x</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-2">
            <div className="flex items-center justify-center gap-3 text-3xl py-2">
              {(snapshot.last_slots_spin?.reels || ['🍒', '💎', '7️⃣']).map((sym, i) => (
                <span
                  key={i}
                  className="w-14 h-14 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-700 shadow-inner"
                >
                  {sym}
                </span>
              ))}
            </div>
            {snapshot.last_slots_spin ? (
              <div className="text-xs font-mono tabular-nums">
                <span className="text-slate-300">@{snapshot.last_slots_spin.username}:</span>{' '}
                {snapshot.last_slots_spin.multiplier > 0 ? (
                  <span className="text-emerald-400 font-bold">
                    ВЫИГРЫШ +{snapshot.last_slots_spin.payout} (x{snapshot.last_slots_spin.multiplier})
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Ставка {snapshot.last_slots_spin.wager} — без совпадений
                  </span>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                Напишите в чат <code className="text-blue-400">!slots 50</code> или нажмите кнопку ниже
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={5000}
            value={slotsWager}
            onChange={(e) => setSlotsWager(Number(e.target.value) || 50)}
            className="w-24 px-2.5 py-1.5 font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="button"
            onClick={() =>
              void apiPost('/api/slots/spin', { username: 'AlexStream', wager: slotsWager })
            }
            className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
          >
            🎰 Крутить слоты ({slotsWager} {snapshot.arena.currency_name})
          </button>
        </div>
      </section>

      {/* 3. Таблица лидеров StreamElements (!top / !leaderboard) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Таблица лидеров (!top)
          </h2>
          <div className="flex rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-0.5 border border-slate-200 dark:border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setLeaderMetric('currency')}
              className={`px-2 py-0.5 rounded ${
                leaderMetric === 'currency' ? 'bg-blue-600 text-white' : 'text-slate-400'
              }`}
            >
              Очки
            </button>
            <button
              type="button"
              onClick={() => setLeaderMetric('donated')}
              className={`px-2 py-0.5 rounded ${
                leaderMetric === 'donated' ? 'bg-blue-600 text-white' : 'text-slate-400'
              }`}
            >
              Донаты
            </button>
            <button
              type="button"
              onClick={() => setLeaderMetric('messages')}
              className={`px-2 py-0.5 rounded ${
                leaderMetric === 'messages' ? 'bg-blue-600 text-white' : 'text-slate-400'
              }`}
            >
              Чат
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scroll pr-1">
          {sortedLeaders.map((v, idx) => (
            <div
              key={v.username}
              className="p-2 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-200 font-mono text-[11px] flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div className="truncate">
                  <span className="font-semibold" style={{ color: v.avatar_color }}>
                    {v.username}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1.5">{v.rank_title}</span>
                </div>
              </div>
              <div className="font-mono tabular-nums font-semibold text-right shrink-0">
                {leaderMetric === 'currency' && `${v.currency} ${snapshot.arena.currency_name}`}
                {leaderMetric === 'donated' && `${Math.round(v.total_donated)} ₽`}
                {leaderMetric === 'messages' && `${v.message_count} сообщ.`}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
