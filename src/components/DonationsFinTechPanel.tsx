import React, { useMemo, useState } from 'react';
import type {
  GameWebhookRule,
  MediaShareConfig,
  PayoutRecord,
  StreamSnapshot,
  TtsConfig,
} from '../types/stream.ts';

interface DonationsFinTechPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onOpenDonatePage?: () => void;
}

export const DonationsFinTechPanel: React.FC<DonationsFinTechPanelProps> = ({
  snapshot,
  apiPost,
  onOpenDonatePage,
}) => {
  const [mediaCfg, setMediaCfg] = useState<MediaShareConfig>(snapshot.media_share_config);
  const [ttsCfg, setTtsCfg] = useState<TtsConfig>(snapshot.tts_config);
  const [stopWordsInput, setStopWordsInput] = useState(
    (snapshot.tts_config?.blocked_words || []).join(', '),
  );

  // Фильтры архива транзакций
  const [searchDonor, setSearchDonor] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('ALL');
  const [minAmountFilter, setMinAmountFilter] = useState<number>(0);

  // Форма вывода средств
  const [withdrawMethod, setWithdrawMethod] = useState<PayoutRecord['method']>('SBP');
  const [withdrawDest, setWithdrawDest] = useState('+7 (999) 123-45-67');
  const [withdrawAmount, setWithdrawAmount] = useState(2500);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Новое правило игрового вебхука / RCON
  const [newGwName, setNewGwName] = useState('Minecraft: Спавн Зомби');
  const [newGwGame, setNewGwGame] = useState('Minecraft (RCON)');
  const [newGwMinRub, setNewGwMinRub] = useState(250);
  const [newGwTransport, setNewGwTransport] = useState<'rcon' | 'http_webhook'>('rcon');
  const [newGwHost, setNewGwHost] = useState('127.0.0.1:25575');
  const [newGwCmd, setNewGwCmd] = useState('/execute at @p run summon minecraft:zombie ~ ~1 ~');

  const activeMedia = useMemo(
    () =>
      (snapshot.media_queue || []).find(
        (m) => m.status === 'playing' || m.status === 'paused',
      ) || null,
    [snapshot.media_queue],
  );

  const filteredTransactions = useMemo(() => {
    return (snapshot.recent_events || [])
      .filter((ev) => ev.kind === 'donation')
      .filter((ev) => {
        if (searchDonor.trim()) {
          const q = searchDonor.trim().toLowerCase();
          if (
            !ev.username.toLowerCase().includes(q) &&
            !ev.message.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        if (currencyFilter !== 'ALL') {
          const orig = (ev.original_currency || ev.currency || '₽').toUpperCase();
          if (orig !== currencyFilter) return false;
        }
        if (ev.amount < minAmountFilter) return false;
        return true;
      })
      .slice()
      .reverse();
  }, [snapshot.recent_events, searchDonor, currencyFilter, minAmountFilter]);

  const handleSaveMediaAndTts = async () => {
    await apiPost('/api/media/config', mediaCfg);
    await apiPost('/api/tts/config', {
      ...ttsCfg,
      blocked_words: stopWordsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setStatusNote('Настройки Media Share и TTS успешно сохранены.');
  };

  const handleWithdraw = async () => {
    const res = (await apiPost('/api/fintech/withdraw', {
      amount_rub: withdrawAmount,
      method: withdrawMethod,
      destination: withdrawDest,
    })) as { ok?: boolean; error?: string };
    if (res?.ok) {
      setStatusNote(`Заявка на вывод ${withdrawAmount} ₽ (${withdrawMethod}) выполнена.`);
    } else if (res?.error) {
      setStatusNote(`Ошибка: ${res.error}`);
    }
  };

  const handleAddGameWebhook = async () => {
    if (!newGwName.trim() || !newGwCmd.trim()) return;
    const rule: GameWebhookRule = {
      id: `gw_${Date.now()}`,
      name: newGwName.trim(),
      game: newGwGame.trim() || 'Minecraft (RCON)',
      enabled: true,
      min_amount_rub: Math.max(0, Number(newGwMinRub) || 100),
      keyword: '',
      transport: newGwTransport,
      target_url_or_host: newGwHost.trim(),
      command_or_payload: newGwCmd.trim(),
      last_triggered_at: null,
      trigger_count: 0,
    };
    await apiPost('/api/game-webhooks/upsert', rule);
    setStatusNote(`Игровой триггер «${rule.name}» добавлен.`);
  };

  return (
    <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Медиа-запросы (Media Share YouTube/VK/Audio) и пульт автовоспроизведения */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Медиа-запросы (Media Share YouTube / VK / Audio) и Фильтр TTS
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Автозапуск клипов на оверлее при донате от порога суммы
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveMediaAndTts()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
          >
            Сохранить Media & TTS
          </button>
        </div>

        {/* Текущий ролик на оверлее */}
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {activeMedia
                ? `▶ В эфире: ${activeMedia.title} (от ${activeMedia.donor})`
                : 'Очередь Media Share ожидает клипов'}
            </span>
            {activeMedia && (
              <span className="font-mono tabular-nums text-emerald-500 font-semibold">
                {activeMedia.remaining_sec}с / {activeMedia.duration_sec}с ({activeMedia.status})
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void apiPost('/api/media/control', { action: 'toggle_pause' })}
              className="px-2.5 py-1 rounded bg-slate-800 text-white hover:bg-slate-700 font-medium"
            >
              {activeMedia?.status === 'playing' ? '⏸ Пауза' : '▶ Старт / Продолжить'}
            </button>
            <button
              type="button"
              onClick={() => void apiPost('/api/media/control', { action: 'skip' })}
              className="px-2.5 py-1 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 font-medium"
            >
              ⏭ Пропустить ролик
            </button>
            <button
              type="button"
              onClick={() =>
                void apiPost('/api/webhooks/donation', {
                  username: 'KiraDev',
                  amount: 300,
                  currency: 'RUB',
                  media_url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
                  media_title: 'Synthwave Live Track (Тест Media Share)',
                  message: 'Поставь этот трек на стрим!',
                })
              }
              className="px-2.5 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 font-medium"
            >
              + Тест доната с YouTube-клипом
            </button>
          </div>

          {(snapshot.media_queue || []).length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1 max-h-28 overflow-y-auto custom-scroll">
              {snapshot.media_queue.slice(-5).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">
                    <strong className="text-blue-400">[{item.media_kind.toUpperCase()}]</strong>{' '}
                    {item.title} · {item.donor} ({Math.round(item.amount_rub)} ₽)
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono tabular-nums text-slate-400">
                      {item.remaining_sec}с · {item.status}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void apiPost('/api/media/control', { action: 'play_now', id: item.id })
                      }
                      className="px-1.5 py-0.5 rounded border border-slate-700 hover:border-blue-500 text-[10px]"
                    >
                      Запустить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Параметры порога Media Share и TTS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[11px] text-slate-400">Мин. сумма для видео (₽)</span>
            <input
              type="number"
              value={mediaCfg.min_amount_rub}
              onChange={(e) =>
                setMediaCfg({ ...mediaCfg, min_amount_rub: Number(e.target.value) || 0 })
              }
              className="w-full mt-0.5 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Макс. длительность (сек)</span>
            <input
              type="number"
              value={mediaCfg.max_duration_sec}
              onChange={(e) =>
                setMediaCfg({ ...mediaCfg, max_duration_sec: Number(e.target.value) || 60 })
              }
              className="w-full mt-0.5 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Мин. сумма TTS озвучки (₽)</span>
            <input
              type="number"
              value={ttsCfg.min_amount_rub}
              onChange={(e) =>
                setTtsCfg({ ...ttsCfg, min_amount_rub: Number(e.target.value) || 0 })
              }
              className="w-full mt-0.5 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={mediaCfg.auto_play}
              onChange={(e) => setMediaCfg({ ...mediaCfg, auto_play: e.target.checked })}
            />
            <span>Автовоспроизведение видео сразу после доната</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ttsCfg.profanity_filter}
              onChange={(e) => setTtsCfg({ ...ttsCfg, profanity_filter: e.target.checked })}
            />
            <span>Фильтр мата и стоп-слов в TTS (замена на ***)</span>
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] text-slate-400">
            Стоп-слова для TTS фильтра (через запятую)
          </span>
          <input
            value={stopWordsInput}
            onChange={(e) => setStopWordsInput(e.target.value)}
            className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </label>
      </section>

      {/* 2. FinTech-ядро DonationAlerts: Баланс, Конвертация Валют, Лимиты и Вывод средств */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              FinTech и Выплаты (RUB / USD / EUR / KZT / Crypto)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Мультивалютный баланс, лимиты и персональная страница приёма донатов
            </p>
          </div>
          {onOpenDonatePage && (
            <button
              type="button"
              onClick={onOpenDonatePage}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              Открыть страницу /donate
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-400">Доступный баланс</div>
            <div className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
              {Math.round(snapshot.fintech?.balance_rub || 0).toLocaleString('ru-RU')} ₽
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-400">Выведено за сутки</div>
            <div className="text-base font-bold font-mono tabular-nums text-slate-200 mt-0.5">
              {Math.round(snapshot.fintech?.withdrawn_today_rub || 0).toLocaleString('ru-RU')} ₽
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-400">Суточный лимит</div>
            <div className="text-base font-bold font-mono tabular-nums text-blue-400 mt-0.5">
              {Math.round(snapshot.fintech?.daily_limit_rub || 150000).toLocaleString('ru-RU')} ₽
            </div>
          </div>
        </div>

        {/* Курсы автоматической конвертации в ₽ */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono">
          <span>Курсы к ₽:</span>
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-800">
            1 USD = {snapshot.fintech?.exchange_rates?.USD ?? 92.5} ₽
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-800">
            1 EUR = {snapshot.fintech?.exchange_rates?.EUR ?? 100.2} ₽
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-800">
            100 KZT = {Math.round((snapshot.fintech?.exchange_rates?.KZT ?? 0.19) * 100)} ₽
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-800">
            1 USDT = {snapshot.fintech?.exchange_rates?.USDT ?? 92.5} ₽
          </span>
        </div>

        {/* Оформление выплаты */}
        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="font-semibold">Вывод средств (СБП / Карта / Крипто USDT)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={withdrawMethod}
              onChange={(e) => setWithdrawMethod(e.target.value as PayoutRecord['method'])}
              className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
            >
              <option value="SBP">СБП (0% комиссия)</option>
              <option value="BankCard">Банковская карта (2.5%)</option>
              <option value="USDT_TRC20">Крипто USDT TRC-20 (1.5%)</option>
              <option value="VKPay">VK Pay</option>
            </select>
            <input
              value={withdrawDest}
              onChange={(e) => setWithdrawDest(e.target.value)}
              placeholder="Реквизиты / Номер / Кошелёк"
              className="px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Number(e.target.value) || 0)}
                className="w-24 px-2 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
              <button
                type="button"
                onClick={() => void handleWithdraw()}
                className="flex-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold whitespace-nowrap"
              >
                Вывести
              </button>
            </div>
          </div>
          {(snapshot.fintech?.payouts || []).slice(0, 2).map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-1"
            >
              <span>
                {p.method} · {p.destination}
              </span>
              <span className="font-mono tabular-nums text-emerald-400">
                -{p.amount_rub} ₽ (комиссия {p.fee_rub} ₽) · {p.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Архив транзакций с фильтрами по сумме, валюте и отправителю */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Архив транзакций и фильтры (DonationAlerts)</h2>
          <span className="font-mono tabular-nums text-slate-400">
            Найдено: {filteredTransactions.length}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={searchDonor}
            onChange={(e) => setSearchDonor(e.target.value)}
            placeholder="Поиск по нику или тексту..."
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          >
            <option value="ALL">Все валюты (RUB/USD/EUR/KZT/USDT)</option>
            <option value="₽">Только RUB / ₽</option>
            <option value="USD">Только USD ($)</option>
            <option value="EUR">Только EUR (€)</option>
            <option value="KZT">Только KZT (₸)</option>
            <option value="USDT">Только USDT</option>
          </select>
          <input
            type="number"
            min={0}
            value={minAmountFilter}
            onChange={(e) => setMinAmountFilter(Number(e.target.value) || 0)}
            placeholder="Мин. сумма в ₽"
            className="px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>

        <div className="max-h-48 overflow-y-auto custom-scroll space-y-1.5 pr-1">
          {filteredTransactions.map((ev) => (
            <div
              key={ev.id}
              className="p-2 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {ev.username}{' '}
                  <span className="text-[10px] font-normal text-slate-400">
                    [{ev.source}] · {new Date(ev.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-slate-500 dark:text-slate-400 truncate">
                  {ev.message || 'Без сообщения'}
                  {ev.media_url && (
                    <span className="ml-1.5 text-blue-400 font-mono">[🎬 Медиа]</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono tabular-nums font-bold text-emerald-400">
                  {Math.round(ev.amount)} ₽
                </div>
                {ev.original_currency && ev.original_currency !== '₽' && (
                  <div className="text-[10px] font-mono tabular-nums text-slate-400">
                    ({ev.original_amount} {ev.original_currency})
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Игровые вебхуки и RCON-триггеры (Minecraft спавн моба / предмет при донате) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">
              Игровые интеграции: Вебхуки и RCON (Minecraft / Моды)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Автоматическое выполнение команд в игре при поступлении доната
            </p>
          </div>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scroll pr-1">
          {(snapshot.game_webhooks || []).map((gw) => (
            <div
              key={gw.id}
              className="p-2 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {gw.name}{' '}
                  <span className="text-[10px] font-mono text-amber-400">
                    ≥ {gw.min_amount_rub} ₽ · сработало: {gw.trigger_count}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-400 truncate">
                  {gw.transport.toUpperCase()} {gw.target_url_or_host} → {gw.command_or_payload}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void apiPost('/api/game-webhooks/test', { id: gw.id })}
                  className="px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-medium"
                >
                  Тест
                </button>
                <button
                  type="button"
                  onClick={() => void apiPost('/api/game-webhooks/delete', { id: gw.id })}
                  className="px-1.5 py-1 text-rose-400 hover:text-rose-300"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            value={newGwName}
            onChange={(e) => setNewGwName(e.target.value)}
            placeholder="Название триггера"
            className="col-span-2 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <select
            value={newGwTransport}
            onChange={(e) => setNewGwTransport(e.target.value as 'rcon' | 'http_webhook')}
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          >
            <option value="rcon">Minecraft RCON</option>
            <option value="http_webhook">HTTP Webhook</option>
          </select>
          <input
            type="number"
            value={newGwMinRub}
            onChange={(e) => setNewGwMinRub(Number(e.target.value) || 100)}
            placeholder="Мин. ₽"
            className="px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <input
            value={newGwHost}
            onChange={(e) => setNewGwHost(e.target.value)}
            placeholder="127.0.0.1:25575 или URL"
            className="px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <input
            value={newGwCmd}
            onChange={(e) => setNewGwCmd(e.target.value)}
            placeholder="Команда RCON или JSON..."
            className="col-span-2 px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="button"
            onClick={() => void handleAddGameWebhook()}
            className="px-2.5 py-1 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold"
          >
            + Добавить
          </button>
        </div>

        {statusNote && <div className="text-[11px] text-emerald-400">{statusNote}</div>}
      </section>
    </div>
  );
};
