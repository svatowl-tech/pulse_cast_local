import React, { useMemo, useState } from 'react';
import type { CurrencyCode, StreamSnapshot } from '../types/stream.ts';

interface PublicDonateViewProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onBackToStudio: () => void;
}

const CURRENCIES: Array<{ code: CurrencyCode; label: string; symbol: string }> = [
  { code: 'RUB', label: 'Российский рубль (RUB)', symbol: '₽' },
  { code: 'USD', label: 'Доллар США (USD)', symbol: '$' },
  { code: 'EUR', label: 'Евро (EUR)', symbol: '€' },
  { code: 'KZT', label: 'Казахстанский тенге (KZT)', symbol: '₸' },
  { code: 'USDT', label: 'Tether Crypto (USDT)', symbol: 'USDT' },
  { code: 'BTC', label: 'Bitcoin (BTC)', symbol: '₿' },
];

export const PublicDonateView: React.FC<PublicDonateViewProps> = ({
  snapshot,
  apiPost,
  onBackToStudio,
}) => {
  const [donorName, setDonorName] = useState('AlexStream');
  const [amount, setAmount] = useState<number>(300);
  const [currency, setCurrency] = useState<CurrencyCode>('RUB');
  const [message, setMessage] = useState('На развитие канала и мощный стрим!');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaTitle, setMediaTitle] = useState('');
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const convertedRub = useMemo(() => {
    const rate =
      snapshot.fintech?.exchange_rates?.[currency] ??
      (currency === 'RUB'
        ? 1
        : currency === 'USD' || currency === 'USDT'
        ? 92.5
        : currency === 'EUR'
        ? 100.2
        : currency === 'KZT'
        ? 0.19
        : currency === 'BTC'
        ? 6250000
        : 1);
    return Math.round(amount * rate * 100) / 100;
  }, [amount, currency, snapshot.fintech?.exchange_rates]);

  const mediaMinRub = snapshot.media_share_config?.min_amount_rub ?? 200;
  const ttsMinRub = snapshot.tts_config?.min_amount_rub ?? 50;
  const qualifiesForMedia = convertedRub >= mediaMinRub;
  const qualifiesForTts = convertedRub >= ttsMinRub;
  const estimatedMediaSec = useMemo(() => {
    if (!qualifiesForMedia) return 0;
    const secPerRub = snapshot.media_share_config?.seconds_per_rub ?? 0.2;
    const maxSec = snapshot.media_share_config?.max_duration_sec ?? 120;
    return Math.min(maxSec, Math.max(15, Math.round(convertedRub * secPerRub)));
  }, [convertedRub, qualifiesForMedia, snapshot.media_share_config]);

  const handleSendDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/api/webhooks/donation', {
      source: 'PulseCast-DonatePage',
      username: donorName.trim() || 'Аноним',
      amount,
      currency,
      message,
      media_url: mediaUrl.trim() || null,
      media_title: mediaTitle.trim() || null,
      tts_enabled: true,
    });
    setSentNotice(
      `Донат ${amount} ${currency} (≈ ${Math.round(convertedRub)} ₽) отправлен в эфир!`,
    );
    setMediaUrl('');
    setMediaTitle('');
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 bg-slate-950 text-slate-100">
      <div className="w-full max-w-2xl bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        {/* Шапка страницы доната с возвратом в студию (Zero Dead Ends) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
              Персональная страница поддержки (/donate)
            </div>
            <h1 className="text-lg font-bold text-slate-100 mt-0.5">
              {snapshot.fintech?.donate_page_title || 'Поддержать эфир PulseCast Studio'}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {snapshot.fintech?.donate_page_bio ||
                'Все донаты мгновенно выводятся на экран стрима с озвучкой TTS и вашим роликом!'}
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToStudio}
            className="px-3.5 py-2 rounded-lg border border-slate-700 hover:border-blue-500 text-xs font-semibold text-slate-200"
          >
            ← Вернуться в пульт студии
          </button>
        </div>

        {/* Активная цель сбора */}
        {snapshot.goal && (
          <div className="p-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Цель эфира: {snapshot.goal.title}</span>
              <span className="font-mono tabular-nums text-emerald-400">
                {Math.round(snapshot.goal.current)} / {Math.round(snapshot.goal.target)}{' '}
                {snapshot.goal.unit}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((snapshot.goal.current / Math.max(1, snapshot.goal.target)) * 100),
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleSendDonation(e)} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-1">
              <span className="text-slate-400">Ваше имя / никнейм</span>
              <input
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-700 bg-[#0B0F17] font-semibold"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="text-slate-400">Сумма перевода</span>
              <input
                type="number"
                step="any"
                min={0.0001}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                className="w-full mt-1 px-3 py-2 font-mono tabular-nums rounded-lg border border-slate-700 bg-[#0B0F17] font-bold text-emerald-400"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="text-slate-400">Валюта оплаты</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-700 bg-[#0B0F17]"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Быстрые пресеты суммы и индикатор конвертации */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(snapshot.fintech?.preset_amounts || [100, 250, 500, 1000, 2500, 5000]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setCurrency('RUB');
                    setAmount(p);
                  }}
                  className="px-2.5 py-1 rounded-md border border-slate-700 bg-[#0B0F17] hover:border-emerald-500 font-mono tabular-nums"
                >
                  {p} ₽
                </button>
              ))}
            </div>
            <div className="font-mono tabular-nums text-slate-300">
              К зачислению в эфир:{' '}
              <strong className="text-emerald-400 text-sm">
                {Math.round(convertedRub).toLocaleString('ru-RU')} ₽
              </strong>
            </div>
          </div>

          <label className="block">
            <span className="text-slate-400">
              Сообщение стримеру (озвучка TTS от {ttsMinRub} ₽){' '}
              {qualifiesForTts ? (
                <span className="text-emerald-400">· 🔊 Будет озвучено в эфире</span>
              ) : (
                <span className="text-amber-400">· Без озвучки (меньше {ttsMinRub} ₽)</span>
              )}
            </span>
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Напишите сообщение для озвучки синтезатором речи..."
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-700 bg-[#0B0F17]"
            />
          </label>

          {/* Блок Media Share (прикрепление YouTube / VK / Audio) */}
          <div className="p-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                🎬 Прикрепить видео / музыку на стрим (Media Share от {mediaMinRub} ₽)
              </span>
              {qualifiesForMedia ? (
                <span className="font-mono tabular-nums text-emerald-400">
                  Автопоказ на оверлее: ~{estimatedMediaSec} сек
                </span>
              ) : (
                <span className="text-slate-500">
                  Добавьте ещё {Math.max(0, Math.ceil(mediaMinRub - convertedRub))} ₽ для показа видео
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="Ссылка YouTube / VK Видео / MP3..."
                className="px-3 py-1.5 font-mono rounded-lg border border-slate-700 bg-[#111827]"
              />
              <input
                value={mediaTitle}
                onChange={(e) => setMediaTitle(e.target.value)}
                placeholder="Название ролика (необязательно)"
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-[#111827]"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
          >
            Отправить донат {amount} {currency} ({Math.round(convertedRub)} ₽) в прямой эфир
          </button>

          {sentNotice && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-center font-medium">
              {sentNotice}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
