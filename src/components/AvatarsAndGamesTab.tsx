import React from 'react';
import type { MiniGameKind, StreamSnapshot } from '../types/stream.ts';
import { PredictionsAndLeaderboardsPanel } from './PredictionsAndLeaderboardsPanel.tsx';

interface AvatarsAndGamesTabProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

const MINIGAMES: Array<{ kind: MiniGameKind; title: string; cmd: string }> = [
  { kind: 'battle_royale', title: 'Battle Royale', cmd: '!battleroyale' },
  { kind: 'boss_fight', title: 'Boss Fight (Рейд)', cmd: '!boss' },
  { kind: 'star_catch', title: 'Ловля звёзд', cmd: '!spawn' },
  { kind: 'basketball', title: 'Баскетбол', cmd: '!basketball' },
  { kind: 'duel', title: 'Дуэль 1v1', cmd: '!duel' },
  { kind: 'none', title: 'Остановить игру', cmd: 'stop' },
];

export const AvatarsAndGamesTab: React.FC<AvatarsAndGamesTabProps> = ({ snapshot, apiPost }) => {
  const viewersList = Object.values(snapshot.viewers).sort((a, b) => b.xp - a.xp);

  return (
    <div className="flex flex-col gap-4">
      <PredictionsAndLeaderboardsPanel snapshot={snapshot} apiPost={apiPost} />
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Мини-игры Stream Avatars на оверлее
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Активно: {snapshot.arena.active_minigame} · Клик по монитору подбрасывает аватаров
            </p>
          </div>
          <div className="flex gap-1.5">
            {['dance', 'jump', 'hug', 'bomb', 'fart'].map((act) => (
              <button
                key={act}
                type="button"
                onClick={() => void apiPost('/api/avatar/action', { username: '*', action: act })}
                className="px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 hover:border-blue-500"
              >
                !{act}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {MINIGAMES.map((g) => (
            <button
              key={g.kind}
              type="button"
              onClick={() => void apiPost('/api/minigame', { kind: g.kind, initiator: 'Пульт' })}
              className={`min-h-[52px] px-3 py-2 text-left rounded-lg border transition-colors ${
                snapshot.arena.active_minigame === g.kind
                  ? 'border-blue-500 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] hover:border-slate-400'
              }`}
            >
              <div className="text-xs font-semibold">{g.title}</div>
              <div className="text-[11px] font-mono text-slate-400 mt-0.5">{g.cmd}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Таблица рангов RutonyChat и профилей экипировки Stream Avatars */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Зрители, ранги лояльности и экипировка аватаров
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Участников: {viewersList.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3 font-medium">Зритель</th>
                <th className="py-2 px-3 font-medium">Ранг / Неймтег</th>
                <th className="py-2 px-3 font-medium">Скин и экипировка</th>
                <th className="py-2 px-3 font-medium text-right">Валюта</th>
                <th className="py-2 pl-3 font-medium text-right">XP / Донаты</th>
              </tr>
            </thead>
            <tbody>
              {viewersList.map((v) => (
                <tr
                  key={v.username}
                  className="border-b border-slate-100 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  <td className="py-2.5 pr-3 font-semibold" style={{ color: v.avatar_color }}>
                    {v.username}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-400">· {v.platform}</span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                    {v.rank_title}
                    {v.nametag ? ` · [${v.nametag}]` : ''}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">
                    {v.avatar_skin}
                    {v.gear.length > 0 ? ` (${v.gear.join(', ')})` : ''}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                    {v.currency} {snapshot.arena.currency_name}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {v.xp} XP · {Math.round(v.total_donated)} ₽
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
