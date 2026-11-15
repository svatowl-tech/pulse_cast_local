import React, { useEffect, useState } from 'react';
import type {
  CustomOverlayElement,
  OverlayPlugin,
  StreamSnapshot,
  WidgetLayoutConfig,
} from '../types/stream.ts';

interface PluginsAndLayoutTabProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  layoutEditMode: boolean;
  onToggleLayoutEdit: () => void;
}

const WRAPPER_OPTIONS: Array<{ id: WidgetLayoutConfig['wrapper_preset']; label: string }> = [
  { id: 'none', label: 'Без рамки' },
  { id: 'neon_frame', label: 'Неоновая рамка' },
  { id: 'retro_crt', label: 'Ретро-монитор' },
  { id: 'glass_bar', label: 'Матовое стекло' },
  { id: 'minimal_edge', label: 'Минимал-контур' },
];

export const PluginsAndLayoutTab: React.FC<PluginsAndLayoutTabProps> = ({
  snapshot,
  apiPost,
  layoutEditMode,
  onToggleLayoutEdit,
}) => {
  const [selectedPluginId, setSelectedPluginId] = useState<string>(snapshot.plugins[0]?.id || 'starfall');
  const activePlugin = snapshot.plugins.find((p) => p.id === selectedPluginId) || snapshot.plugins[0];

  const [draftName, setDraftName] = useState(activePlugin?.name || '');
  const [draftConfig, setDraftConfig] = useState(JSON.stringify(activePlugin?.config || {}, null, 2));
  const [draftScript, setDraftScript] = useState(activePlugin?.script_js || '');
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const [elements, setElements] = useState<CustomOverlayElement[]>(snapshot.custom_elements || []);
  const [elemNote, setElemNote] = useState<string | null>(null);

  useEffect(() => {
    setElements(snapshot.custom_elements || []);
  }, [snapshot.custom_elements]);

  const selectPlugin = (p: OverlayPlugin) => {
    setSelectedPluginId(p.id);
    setDraftName(p.name);
    setDraftConfig(JSON.stringify(p.config || {}, null, 2));
    setDraftScript(p.script_js || '');
    setSaveNote(null);
  };

  const handleSavePlugin = async () => {
    if (!activePlugin) return;
    let parsedCfg = activePlugin.config;
    try {
      parsedCfg = JSON.parse(draftConfig);
    } catch {
      setSaveNote('Ошибка в JSON-конфигурации плагина');
      return;
    }
    await apiPost('/api/plugins/upsert', {
      ...activePlugin,
      name: draftName || activePlugin.name,
      config: parsedCfg,
      script_js: draftScript,
    });
    setSaveNote('Плагин сохранён и обновлён на оверлее');
  };

  const handleCreateCustom = async () => {
    const id = `custom_${Date.now()}`;
    const newPlugin: OverlayPlugin = {
      id,
      name: 'Свой эффект частиц',
      description: 'Пользовательский плагин Canvas 2D SDK',
      author: 'Streamer',
      enabled: true,
      builtin: false,
      z_index: 32,
      config: { color: '#A855F7', burst: 25 },
      hooks: ['on_chat', 'on_trigger'],
      style_css: '',
      script_js: `// Вызывается на событии чата или ручном триггере
if (event) {
  sdk.spawnParticles(width * (0.2 + Math.random() * 0.6), height * 0.4, cfg.burst || 25, cfg.color || '#A855F7');
}`,
    };
    await apiPost('/api/plugins/upsert', newPlugin);
    selectPlugin(newPlugin);
  };

  const updateWidget = (widgetId: string, patch: Partial<WidgetLayoutConfig>) => {
    const updated = snapshot.layouts.map((w) => (w.widget_id === widgetId ? { ...w, ...patch } : w));
    void apiPost('/api/layouts', updated);
  };

  const addCustomElement = (preset: 'image' | 'html') => {
    const firstImg = (snapshot.media_assets || []).find((a) => a.kind === 'image')?.url || '';
    const item: CustomOverlayElement =
      preset === 'image'
        ? {
            id: `elem_${Date.now()}`,
            name: 'Стикер / Картинка',
            visible: true,
            x_pct: 42,
            y_pct: 36,
            width_px: 140,
            z_index: 28,
            image_url: firstImg,
            html: '',
            css: 'border-radius: 10px;',
          }
        : {
            id: `elem_${Date.now()}`,
            name: 'HTML/CSS Плашка',
            visible: true,
            x_pct: 35,
            y_pct: 86,
            width_px: 240,
            z_index: 28,
            image_url: '',
            html: '<div style="font-weight:700;font-size:13px;">TG: @channel · Boosty</div>',
            css: 'background: rgba(15,23,42,0.85); border: 1px solid #3B82F6; border-radius: 8px; padding: 6px 12px; color: #F8FAFC;',
          };
    const next = [...elements, item];
    setElements(next);
    void apiPost('/api/overlay/elements', next);
    setElemNote('Элемент добавлен. Можно перетаскивать его мышью в режиме «Двигать макет».');
  };

  const updateElement = (id: string, patch: Partial<CustomOverlayElement>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const imageAssets = (snapshot.media_assets || []).filter((a) => a.kind === 'image');

  return (
    <div className="flex flex-col gap-4">
      {/* Мастерская плагинов SDK */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Мастерская плагинов оверлея (Canvas / DOM SDK)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Доступные объекты в скрипте: ctx, width, height, cfg, state, event, sdk.spawnParticles(...)
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateCustom()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold whitespace-nowrap"
          >
            Создать плагин
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            {snapshot.plugins.map((p) => (
              <div
                key={p.id}
                onClick={() => selectPlugin(p)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  activePlugin?.id === p.id
                    ? 'border-blue-500 bg-blue-600/10'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{p.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void apiPost('/api/plugins/toggle', { plugin_id: p.id, enabled: !p.enabled });
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      p.enabled
                        ? 'bg-emerald-600/20 text-emerald-500'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {p.enabled ? 'Вкл' : 'Выкл'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void apiPost('/api/plugins/trigger', { plugin_id: p.id, data: { burst: 50 } });
                    }}
                    className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500"
                  >
                    Запустить эффект
                  </button>
                </div>
              </div>
            ))}
          </div>

          {activePlugin && (
            <div className="lg:col-span-2 space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Название плагина"
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                />
                <button
                  type="button"
                  onClick={() => void handleSavePlugin()}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap"
                >
                  Сохранить и применить
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">JSON-параметры (cfg)</label>
                  <textarea
                    rows={8}
                    value={draftConfig}
                    onChange={(e) => setDraftConfig(e.target.value)}
                    className="w-full p-2.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">JS-код плагина (Canvas 2D SDK)</label>
                  <textarea
                    rows={8}
                    value={draftScript}
                    onChange={(e) => setDraftScript(e.target.value)}
                    className="w-full p-2.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  />
                </div>
              </div>
              {saveNote && <div className="text-xs text-blue-500">{saveNote}</div>}
            </div>
          )}
        </div>
      </section>

      {/* Конструктор кастомных элементов интерфейса оверлея (Картинки / HTML / CSS) */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Конструктор кастомных элементов оверлея (Картинки · Стикеры · HTML/CSS)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Размещайте любые свои картинки, логотипы и HTML/CSS-блоки прямо поверх сцены и двигайте мышью.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addCustomElement('image')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              + Картинка / GIF
            </button>
            <button
              type="button"
              onClick={() => addCustomElement('html')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              + HTML/CSS блок
            </button>
            <button
              type="button"
              onClick={() => {
                void apiPost('/api/overlay/elements', elements);
                setElemNote('Кастомные элементы оверлея сохранены.');
              }}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Сохранить элементы
            </button>
          </div>
        </div>

        {elemNote && <div className="text-xs text-blue-500">{elemNote}</div>}

        <div className="space-y-2.5">
          {elements.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 py-3">
              Пока нет кастомных элементов. Добавьте картинку или HTML/CSS-плашку кнопками выше.
            </div>
          ) : (
            elements.map((el) => (
              <div
                key={el.id}
                className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={el.visible}
                    onChange={(e) => updateElement(el.id, { visible: e.target.checked })}
                  />
                  <input
                    value={el.name}
                    onChange={(e) => updateElement(el.id, { name: e.target.value })}
                    className="flex-1 min-w-[140px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-semibold"
                  />
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">X%</span>
                    <input
                      type="number"
                      value={el.x_pct}
                      onChange={(e) => updateElement(el.id, { x_pct: Number(e.target.value) })}
                      className="w-16 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">Y%</span>
                    <input
                      type="number"
                      value={el.y_pct}
                      onChange={(e) => updateElement(el.id, { y_pct: Number(e.target.value) })}
                      className="w-16 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">Ширина</span>
                    <input
                      type="number"
                      value={el.width_px}
                      onChange={(e) => updateElement(el.id, { width_px: Number(e.target.value) || 120 })}
                      className="w-20 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setElements((prev) => prev.filter((x) => x.id !== el.id))}
                    className="text-red-500 px-2"
                  >
                    Удалить
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="flex gap-1">
                    <input
                      value={el.image_url}
                      onChange={(e) => updateElement(el.id, { image_url: e.target.value })}
                      placeholder="URL картинки (/assets/...)"
                      className="flex-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />
                    {imageAssets.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => e.target.value && updateElement(el.id, { image_url: e.target.value })}
                        className="w-20 px-1 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                      >
                        <option value="">Файл</option>
                        {imageAssets.map((a) => (
                          <option key={a.id} value={a.url}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <input
                    value={el.html}
                    onChange={(e) => updateElement(el.id, { html: e.target.value })}
                    placeholder="HTML разметка (опционально)"
                    className="px-2 py-1 font-mono text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                  <input
                    value={el.css}
                    onChange={(e) => updateElement(el.id, { css: e.target.value })}
                    placeholder="CSS стили (border: 1px solid ...)"
                    className="px-2 py-1 font-mono text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Конструктор макета и визуальных обёрток виджетов */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Позиционирование и обёртки виджетов на оверлее
          </h2>
          <button
            type="button"
            onClick={onToggleLayoutEdit}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              layoutEditMode
                ? 'bg-blue-600 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            {layoutEditMode ? 'Завершить Drag-and-Drop' : 'Перетаскивать виджеты на мониторе'}
          </button>
        </div>

        <div className="space-y-2.5">
          {snapshot.layouts.map((w) => (
            <div
              key={w.widget_id}
              className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs"
            >
              <label className="flex items-center gap-2 font-medium sm:col-span-2">
                <input
                  type="checkbox"
                  checked={w.visible}
                  onChange={(e) => updateWidget(w.widget_id, { visible: e.target.checked })}
                  className="rounded"
                />
                <span>{w.label}</span>
              </label>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">X%</span>
                <input
                  type="number"
                  value={w.x_pct}
                  onChange={(e) => updateWidget(w.widget_id, { x_pct: Number(e.target.value) })}
                  className="w-full px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Y%</span>
                <input
                  type="number"
                  value={w.y_pct}
                  onChange={(e) => updateWidget(w.widget_id, { y_pct: Number(e.target.value) })}
                  className="w-full px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Масштаб</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="2"
                  value={w.scale}
                  onChange={(e) => updateWidget(w.widget_id, { scale: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </div>

              <select
                value={w.wrapper_preset}
                onChange={(e) =>
                  updateWidget(w.widget_id, {
                    wrapper_preset: e.target.value as WidgetLayoutConfig['wrapper_preset'],
                  })
                }
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                {WRAPPER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
