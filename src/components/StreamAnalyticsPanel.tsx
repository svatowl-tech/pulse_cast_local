import React, { useState } from 'react';
import type { StreamSnapshot } from '../types/stream.ts';

interface StreamAnalyticsPanelProps {
  snapshot: StreamSnapshot;
}

export const StreamAnalyticsPanel: React.FC<StreamAnalyticsPanelProps> = ({ snapshot }) => {
  const analytics = snapshot.analytics;
  const buckets = analytics?.timeline_buckets || [];
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxDonation = Math.max(100, ...buckets.map((b) => b.donations_rub));
  const maxChat = Math.max(5, ...buckets.map((b) => b.chat_messages));

  const chartW = 640;
  const chartH = 156;
  const padX = 28;
  const padY = 16;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padY * 2;

  const linePoints =
    buckets.length > 0
      ? buckets
          .map((b, i) => {
            const x = padX + ((i + 0.5) / buckets.length) * innerW;
            const y = padY + innerH - (b.chat_messages / maxChat) * innerH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  const platformEntries = Object.entries(analytics?.platform_breakdown || {}).sort((a, b) => b[1] - a[1]);
  const totalPlatformMsgs = Math.max(
    1,
    platformEntries.reduce((acc, [, count]) => acc + count, 0),
  );

  const hovered = hoveredIdx !== null ? buckets[hoveredIdx] : null;

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Аналитика стрима: донаты и активность чата
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Живая динамика по временным интервалам и распределение по площадкам
          </p>
        </div>
        <a
          href="/api/analytics/export.csv"
          download="pulsecast_analytics.csv"
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-semibold whitespace-nowrap transition-colors"
        >
          Скачать отчёт CSV
        </a>
      </div>

      {/* Ключевые метрики стрима */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
        <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="text-[11px] text-slate-400">Собрано за сессию</div>
          <div className="font-mono tabular-nums text-base font-bold text-emerald-500 mt-0.5">
            {Math.round(analytics?.total_donations_rub || 0)} ₽
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="text-[11px] text-slate-400">Донатов</div>
          <div className="font-mono tabular-nums text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {analytics?.total_donations_count || 0}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="text-[11px] text-slate-400">Сообщений чата</div>
          <div className="font-mono tabular-nums text-base font-bold text-blue-500 mt-0.5">
            {analytics?.total_messages_count || 0}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="text-[11px] text-slate-400">Пик активности</div>
          <div className="font-mono tabular-nums text-base font-bold text-amber-500 mt-0.5">
            {analytics?.peak_chat_rate_per_min || 0}/инт
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]">
          <div className="text-[11px] text-slate-400">Баланс FinTech</div>
          <div className="font-mono tabular-nums text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {Math.round(snapshot.fintech?.balance_rub || 0)} ₽
          </div>
        </div>
      </div>

      {/* Основной график + Разбивка по платформам */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50/70 dark:bg-[#0B0F17]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80 inline-block" /> Донаты (₽)
              </span>
              <span className="flex items-center gap-1.5 text-sky-400 font-medium">
                <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> Сообщения чата
              </span>
            </div>
            <div className="font-mono tabular-nums text-slate-400">
              {hovered
                ? `${hovered.label}: ${Math.round(hovered.donations_rub)} ₽ (${hovered.donations_count}) · ${hovered.chat_messages} сообщ.`
                : 'Наведите на столбец для детализации'}
            </div>
          </div>

          {buckets.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-slate-400">
              Нет данных за текущую сессию — отправьте сообщение в чат или тестовый донат
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="w-full h-40 overflow-visible"
              role="img"
              aria-label="График донатов и активности чата"
            >
              {[0.25, 0.5, 0.75, 1].map((step) => {
                const y = padY + innerH * (1 - step);
                return (
                  <line
                    key={step}
                    x1={padX}
                    x2={chartW - padX}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="3 3"
                  />
                );
              })}

              {buckets.map((b, i) => {
                const slotW = innerW / buckets.length;
                const barW = Math.max(10, Math.min(34, slotW * 0.56));
                const barH = Math.max(b.donations_rub > 0 ? 4 : 0, (b.donations_rub / maxDonation) * innerH);
                const x = padX + i * slotW + (slotW - barW) / 2;
                const y = padY + innerH - barH;
                const cx = padX + i * slotW + slotW / 2;
                const cy = padY + innerH - (b.chat_messages / maxChat) * innerH;
                return (
                  <g
                    key={b.label}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={padX + i * slotW}
                      y={padY}
                      width={slotW}
                      height={innerH}
                      fill="transparent"
                    />
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx={4}
                      fill={hoveredIdx === i ? '#10B981' : 'rgba(16, 185, 129, 0.65)'}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={hoveredIdx === i ? 4.5 : 3}
                      fill="#38BDF8"
                    />
                    <text
                      x={cx}
                      y={chartH - 2}
                      textAnchor="middle"
                      fontSize="10"
                      className="fill-slate-400 font-mono"
                    >
                      {b.label}
                    </text>
                  </g>
                );
              })}

              {buckets.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={linePoints}
                  className="pointer-events-none"
                />
              )}
            </svg>
          )}
        </div>

        {/* Разбивка по платформам */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50/70 dark:bg-[#0B0F17] space-y-2.5">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Активность по площадкам
          </div>
          {platformEntries.length === 0 ? (
            <div className="text-xs text-slate-400 py-6 text-center">
              Сообщений с площадок пока нет
            </div>
          ) : (
            <div className="space-y-2">
              {platformEntries.map(([platform, count]) => {
                const pct = Math.round((count / totalPlatformMsgs) * 100);
                return (
                  <div key={platform} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700 dark:text-slate-200 uppercase text-[11px]">
                        {platform}
                      </span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
