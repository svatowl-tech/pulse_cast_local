import React from 'react';
import type { StreamSnapshot } from '../types/stream.ts';
import { AiAgentConsolePanel } from './AiAgentConsolePanel.tsx';

interface AgentAndFeedPopoutProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

export const AgentAndFeedPopout: React.FC<AgentAndFeedPopoutProps> = ({
  snapshot,
  apiPost,
}) => {
  const events = snapshot.recent_events
    .filter((ev) => ev.amount >= (snapshot.feed_config?.min_amount || 0))
    .slice(-(snapshot.feed_config?.max_items || 12))
    .reverse();

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 overflow-hidden">
      {/* Живая лента донатов и событий эфира */}
      <section className="min-h-0 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 text-xs mb-2 shrink-0">
          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
            {snapshot.feed_config?.title || 'Лента событий эфира'}
          </span>
          <span className="font-mono tabular-nums text-slate-400 shrink-0">
            Цель: {Math.round(snapshot.goal.current)}/{Math.round(snapshot.goal.target)}{' '}
            {snapshot.goal.unit}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-1.5 text-xs pr-1">
          {events.length === 0 ? (
            <div className="text-slate-400 py-6 text-center">
              Событий и донатов пока нет
            </div>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start justify-between gap-2 py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-0"
              >
                <div className="min-w-0">
                  {snapshot.feed_config?.show_source && (
                    <span className="text-[10px] text-slate-400 mr-1.5">[{ev.source}]</span>
                  )}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {ev.username}
                  </span>
                  {ev.message && (
                    <span className="text-slate-500 dark:text-slate-400 ml-1.5 break-words">
                      {ev.message}
                    </span>
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
            ))
          )}
        </div>
      </section>

      {/* Локальный ИИ-режиссёр */}
      <AiAgentConsolePanel snapshot={snapshot} apiPost={apiPost} standalone />
    </div>
  );
};
