import React, { useEffect, useState } from 'react';
import type { AlertVariation, StreamEventKind, StreamSnapshot } from '../types/stream.ts';
import { resolveAssetUrl } from '../utils/runtime.ts';

interface AlertDesignerPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

export const AlertDesignerPanel: React.FC<AlertDesignerPanelProps> = ({ snapshot, apiPost }) => {
  const [variations, setVariations] = useState<AlertVariation[]>(snapshot.alert_variations || []);
  const [selectedId, setSelectedId] = useState<string>(snapshot.alert_variations?.[0]?.id || '');
  const [assetUrlInput, setAssetUrlInput] = useState('');
  const [assetNameInput, setAssetNameInput] = useState('');
  const [assetKindInput, setAssetKindInput] = useState<'image' | 'audio'>('image');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setVariations(snapshot.alert_variations || []);
  }, [snapshot.alert_variations]);

  const activeVar = variations.find((v) => v.id === selectedId) || variations[0];

  const updateVar = (id: string, patch: Partial<AlertVariation>) => {
    setVariations((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const data_base64 = String(reader.result || '');
      const resp = (await apiPost('/api/assets', {
        name: file.name,
        mime_type: file.type || (file.name.endsWith('.mp3') ? 'audio/mpeg' : 'image/png'),
        data_base64,
      })) as { ok?: boolean; error?: string };
      setNote(resp?.ok ? `Файл «${file.name}» добавлен в локальную библиотеку.` : resp?.error || 'Ошибка загрузки');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddExternalAsset = async () => {
    if (!assetUrlInput.trim()) return;
    const resp = (await apiPost('/api/assets', {
      name: assetNameInput.trim() || 'Внешний ассет',
      mime_type: assetKindInput === 'audio' ? 'audio/mpeg' : 'image/png',
      external_url: assetUrlInput.trim(),
    })) as { ok?: boolean };
    if (resp?.ok) {
      setAssetUrlInput('');
      setAssetNameInput('');
      setNote('URL-ассет добавлен в библиотеку.');
    }
  };

  const addVariation = () => {
    const id = `var_${Date.now()}`;
    const newVar: AlertVariation = {
      id,
      name: 'Новая вариация',
      enabled: true,
      priority: 50,
      source_filter: '',
      event_kind: 'donation',
      min_amount: 100,
      max_amount: null,
      keyword: '',
      image_url: '',
      sound_url: '',
      sound_id: 'fanfare',
      title_template: '{user} · {amount} {currency}',
      tts_template: '{user} прислал {amount} {currency}! {message}',
      duration_ms: 5000,
      animation: 'pop',
      bg_color: 'rgba(15, 23, 42, 0.92)',
      accent_color: '#3B82F6',
      text_color: '#F8FAFC',
    };
    setVariations((prev) => [newVar, ...prev]);
    setSelectedId(id);
  };

  const testVariation = async (v: AlertVariation) => {
    await apiPost('/api/alerts/variations', variations);
    await apiPost('/api/webhooks/donation', {
      kind: v.event_kind || 'donation',
      source: v.source_filter || 'DonationAlerts-Local',
      username: 'TestViewer',
      amount: Math.max(100, v.min_amount || 100),
      currency: '₽',
      message: v.keyword ? `Тест ${v.keyword} для проверки вариации!` : `Тест вариации «${v.name}»`,
      sound_id: v.sound_id || 'fanfare',
      tts_enabled: true,
    });
    setNote(`Запущен тест вариации «${v.name}» на оверлее.`);
  };

  const imageAssets = (snapshot.media_assets || []).filter((a) => a.kind === 'image');
  const audioAssets = (snapshot.media_assets || []).filter((a) => a.kind === 'audio');

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Локальная библиотека медиа и конструктор вариаций алертов
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Загружайте свои GIF, картинки и звуки, настраивайте условия по сумме, платформе и слову.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addVariation}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
          >
            Добавить вариацию
          </button>
          <button
            type="button"
            onClick={() => {
              void apiPost('/api/alerts/variations', variations);
              setNote('Вариации алертов сохранены и применены.');
            }}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
          >
            Сохранить вариации
          </button>
        </div>
      </div>

      {/* Локальная библиотека ассетов */}
      <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold cursor-pointer">
            Загрузить файл (PNG/GIF/MP3/WAV)
            <input type="file" accept="image/*,audio/*" onChange={handleFileUpload} className="hidden" />
          </label>
          <input
            value={assetNameInput}
            onChange={(e) => setAssetNameInput(e.target.value)}
            placeholder="Название ассета"
            className="w-36 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
          />
          <select
            value={assetKindInput}
            onChange={(e) => setAssetKindInput(e.target.value as 'image' | 'audio')}
            className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
          >
            <option value="image">Картинка / GIF</option>
            <option value="audio">Звук</option>
          </select>
          <input
            value={assetUrlInput}
            onChange={(e) => setAssetUrlInput(e.target.value)}
            placeholder="Или вставьте URL картинки / звука..."
            className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
          />
          <button
            type="button"
            onClick={() => void handleAddExternalAsset()}
            className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-semibold"
          >
            Добавить URL
          </button>
        </div>

        {(snapshot.media_assets || []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {snapshot.media_assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs"
              >
                {asset.kind === 'image' ? (
                  <img src={resolveAssetUrl(asset.url)} alt={asset.name} className="w-7 h-7 rounded object-cover" />
                ) : (
                  <button
                    type="button"
                    onClick={() => void new Audio(resolveAssetUrl(asset.url)).play()}
                    className="px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-500 font-mono text-[10px]"
                  >
                    Play
                  </button>
                )}
                <span className="max-w-[120px] truncate">{asset.name}</span>
                <button
                  type="button"
                  onClick={() => void apiPost('/api/assets/delete', { id: asset.id })}
                  className="text-red-500 text-[11px]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {note && <div className="text-xs text-blue-500">{note}</div>}

      {/* Мастер условных вариаций алертов */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="space-y-1.5 max-h-96 overflow-y-auto custom-scroll pr-1">
          {variations.map((v) => (
            <div
              key={v.id}
              onClick={() => setSelectedId(v.id)}
              className={`p-2.5 rounded-lg border cursor-pointer text-xs ${
                activeVar?.id === v.id
                  ? 'border-blue-500 bg-blue-600/10'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate">{v.name}</span>
                <span className="font-mono text-[11px] text-slate-400">P:{v.priority}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                От {v.min_amount} ₽ · {v.source_filter || 'Любой источник'}
              </div>
            </div>
          ))}
        </div>

        {activeVar && (
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800">
            <label className="block">
              <span className="text-[11px] text-slate-400">Название вариации</span>
              <input
                value={activeVar.name}
                onChange={(e) => updateVar(activeVar.id, { name: e.target.value })}
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="text-[11px] text-slate-400">Приоритет</span>
                <input
                  type="number"
                  value={activeVar.priority}
                  onChange={(e) => updateVar(activeVar.id, { priority: Number(e.target.value) })}
                  className="w-full mt-0.5 px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </label>
              <label className="flex items-center gap-1.5 pb-1.5">
                <input
                  type="checkbox"
                  checked={activeVar.enabled}
                  onChange={(e) => updateVar(activeVar.id, { enabled: e.target.checked })}
                />
                <span>Активна</span>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] text-slate-400">Фильтр площадки (Boosty, DonationAlerts...)</span>
              <input
                value={activeVar.source_filter}
                onChange={(e) => updateVar(activeVar.id, { source_filter: e.target.value })}
                placeholder="Пусто = любая"
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Тип события</span>
              <select
                value={activeVar.event_kind || ''}
                onChange={(e) =>
                  updateVar(activeVar.id, { event_kind: (e.target.value || null) as StreamEventKind | null })
                }
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                <option value="">Любое событие</option>
                <option value="donation">donation</option>
                <option value="subscription">subscription</option>
                <option value="follow">follow</option>
                <option value="raid">raid</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Мин. сумма</span>
              <input
                type="number"
                value={activeVar.min_amount}
                onChange={(e) => updateVar(activeVar.id, { min_amount: Number(e.target.value) })}
                className="w-full mt-0.5 px-2.5 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Ключевое слово в тексте</span>
              <input
                value={activeVar.keyword}
                onChange={(e) => updateVar(activeVar.id, { keyword: e.target.value })}
                placeholder="Опционально"
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Картинка / GIF (URL или из библиотеки)</span>
              <div className="flex gap-1 mt-0.5">
                <input
                  value={activeVar.image_url}
                  onChange={(e) => updateVar(activeVar.id, { image_url: e.target.value })}
                  placeholder="/assets/... или https://..."
                  className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
                {imageAssets.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && updateVar(activeVar.id, { image_url: e.target.value })}
                    className="w-24 px-1.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  >
                    <option value="">Выбрать</option>
                    {imageAssets.map((a) => (
                      <option key={a.id} value={a.url}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Звук (URL или из библиотеки)</span>
              <div className="flex gap-1 mt-0.5">
                <input
                  value={activeVar.sound_url}
                  onChange={(e) => updateVar(activeVar.id, { sound_url: e.target.value })}
                  placeholder="Пусто = встроенный синтез"
                  className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
                {audioAssets.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && updateVar(activeVar.id, { sound_url: e.target.value })}
                    className="w-24 px-1.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  >
                    <option value="">Выбрать</option>
                    {audioAssets.map((a) => (
                      <option key={a.id} value={a.url}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Шаблон заголовка ({'{user}, {amount}, {currency}'})</span>
              <input
                value={activeVar.title_template}
                onChange={(e) => updateVar(activeVar.id, { title_template: e.target.value })}
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-400">Шаблон озвучки TTS</span>
              <input
                value={activeVar.tts_template}
                onChange={(e) => updateVar(activeVar.id, { tts_template: e.target.value })}
                className="w-full mt-0.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-slate-400">Анимация</span>
                <select
                  value={activeVar.animation}
                  onChange={(e) =>
                    updateVar(activeVar.id, { animation: e.target.value as AlertVariation['animation'] })
                  }
                  className="w-full mt-0.5 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                >
                  <option value="pop">Pop</option>
                  <option value="slide_up">Slide Up</option>
                  <option value="zoom">Zoom</option>
                  <option value="glitch">Glitch</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Длительность (мс)</span>
                <input
                  type="number"
                  value={activeVar.duration_ms}
                  onChange={(e) => updateVar(activeVar.id, { duration_ms: Number(e.target.value) || 4500 })}
                  className="w-full mt-0.5 px-2 py-1.5 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[11px] text-slate-400">Фон</span>
                <input
                  value={activeVar.bg_color}
                  onChange={(e) => updateVar(activeVar.id, { bg_color: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1.5 font-mono text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Акцент</span>
                <input
                  type="color"
                  value={activeVar.accent_color}
                  onChange={(e) => updateVar(activeVar.id, { accent_color: e.target.value })}
                  className="w-full mt-0.5 h-8 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Текст</span>
                <input
                  type="color"
                  value={activeVar.text_color}
                  onChange={(e) => updateVar(activeVar.id, { text_color: e.target.value })}
                  className="w-full mt-0.5 h-8 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </label>
            </div>

            <div className="sm:col-span-2 flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={() => {
                  const next = variations.filter((v) => v.id !== activeVar.id);
                  setVariations(next);
                  setSelectedId(next[0]?.id || '');
                }}
                className="px-3 py-1.5 rounded border border-red-500/30 text-red-500 text-xs"
              >
                Удалить вариацию
              </button>
              <button
                type="button"
                onClick={() => void testVariation(activeVar)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
              >
                Тестировать вариацию на оверлее
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
