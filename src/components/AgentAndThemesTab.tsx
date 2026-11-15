import React, { useState } from 'react';
import type { AgentResponse, StreamSnapshot, ThemeConfig } from '../types/stream.ts';
import { AiBotAndRecapPanel } from './AiBotAndRecapPanel.tsx';
import { ObsWizardAndProfilePanel } from './ObsWizardAndProfilePanel.tsx';

interface AgentAndThemesTabProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

const PRESET_PROMPTS = [
  'Включи звёздочки, смени сцену на Gaming Capture и отметь клип',
  'Запусти Battle Royale и заставь всех чоков танцевать',
  'Активируй плагин реакции на слово бум и включи тему Неон',
  'Выведи тестовый донат алерт и включи субтитры',
];

export const AgentAndThemesTab: React.FC<AgentAndThemesTabProps> = ({ snapshot, apiPost }) => {
  const [backend, setBackend] = useState<'http' | 'embedded'>(snapshot.llm.backend);
  const [serverUrl, setServerUrl] = useState(snapshot.llm.server_url);
  const [prompt, setPrompt] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const [customThemeName, setCustomThemeName] = useState('Моя тема оверлея');
  const [customAccent, setCustomAccent] = useState('#10B981');
  const [customSurface, setCustomSurface] = useState('#0F172A');
  const [customTarget, setCustomTarget] = useState<'dashboard' | 'overlay'>('overlay');

  const runAgent = async (text?: string) => {
    const q = (text ?? prompt).trim();
    if (!q) return;
    setBusy(true);
    try {
      const resp = (await apiPost('/api/agent', {
        prompt: q,
        backend,
        server_url: serverUrl,
      })) as AgentResponse;
      setLastResponse(resp);
      if (!text) setPrompt('');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomTheme = () => {
    const theme: ThemeConfig = {
      id: `custom_${Date.now()}`,
      name: customThemeName || 'Кастомная тема',
      target: customTarget,
      mode: 'dark',
      bg_canvas: customTarget === 'overlay' ? 'transparent' : '#0B0F17',
      bg_surface: customTarget === 'overlay' ? `${customSurface}CC` : customSurface,
      border_color: `${customAccent}66`,
      text_primary: '#F8FAFC',
      text_muted: '#94A3B8',
      accent_color: customAccent,
      border_radius_px: 12,
      overlay_opacity: 0.94,
    };
    void apiPost('/api/themes', theme);
  };

  return (
    <div className="space-y-4">
      <ObsWizardAndProfilePanel snapshot={snapshot} apiPost={apiPost} />

      <AiBotAndRecapPanel snapshot={snapshot} apiPost={apiPost} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Локальный ИИ-агент с Function Calling */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Локальный ИИ-Агент (Function Calling)</h2>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setBackend('http')}
                className={`px-2.5 py-1 rounded-md ${backend === 'http' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
              >
                HTTP llama-server
              </button>
              <button
                type="button"
                onClick={() => setBackend('embedded')}
                className={`px-2.5 py-1 rounded-md ${backend === 'embedded' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
              >
                Embedded llama-cpp-2
              </button>
            </div>
          </div>

          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://127.0.0.1:8081/v1/chat/completions"
            className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />

          <div className="flex flex-wrap gap-1.5">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void runAgent(p)}
                className="px-2.5 py-1 text-[11px] text-left rounded-md bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-blue-500"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Дайте команду ИИ-режиссёру..."
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAgent()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {busy ? 'Выполняю...' : 'Выполнить'}
            </button>
          </div>

          {lastResponse && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs space-y-2">
              <div className="font-medium text-slate-900 dark:text-slate-100">{lastResponse.reply}</div>
              <div className="text-[11px] font-mono text-slate-400">Режим: {lastResponse.backend_used}</div>
              {lastResponse.tool_calls_executed.map((t, i) => (
                <div key={i} className="font-mono text-[11px] text-emerald-500">
                  → {t.name}: {t.result}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Темы оформления, кастомный конструктор и Бэкап профиля */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2">Готовые пакеты SuperThemes (StreamElements 1-клик)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {(snapshot.super_themes || []).map((st) => (
                <div
                  key={st.id}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex flex-col justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{st.name}</span>
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: st.accent_color }}
                      />
                    </div>
                    <div className="text-[10px] text-blue-400 font-mono">{st.category}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{st.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void apiPost('/api/superthemes/apply', { id: st.id })}
                    className="w-full py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px]"
                  >
                    Установить SuperTheme
                  </button>
                </div>
              ))}
            </div>

            <h2 className="text-sm font-semibold mb-2">Темы дашборда и оверлея OBS</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {snapshot.themes.map((t) => {
                const isActive =
                  (t.target === 'dashboard' && snapshot.active_dashboard_theme === t.id) ||
                  (t.target === 'overlay' && snapshot.active_overlay_theme === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void apiPost('/api/themes/select', { target: t.target, theme_id: t.id })}
                    className={`p-2.5 text-left rounded-lg border text-xs transition-colors ${
                      isActive
                        ? 'border-blue-500 bg-blue-600/10'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17]'
                    }`}
                  >
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {t.target === 'dashboard' ? 'Дашборд' : 'OBS Оверлей'} · {t.mode}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Создать свою тему</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
              <input
                value={customThemeName}
                onChange={(e) => setCustomThemeName(e.target.value)}
                className="col-span-2 px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <select
                value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value as 'dashboard' | 'overlay')}
                className="px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              >
                <option value="overlay">Оверлей</option>
                <option value="dashboard">Дашборд</option>
              </select>
              <div className="flex items-center gap-2">
                <input type="color" value={customAccent} onChange={(e) => setCustomAccent(e.target.value)} className="h-7 w-9 rounded" />
                <input type="color" value={customSurface} onChange={(e) => setCustomSurface(e.target.value)} className="h-7 w-9 rounded" />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveCustomTheme}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
            >
              Применить кастомную тему
            </button>
          </div>
        </section>

        {/* Структурированный журнал событий */}
        <section className="lg:col-span-2 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-2">Журнал событий сервера</h2>
          <div className="max-h-36 overflow-y-auto custom-scroll space-y-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {snapshot.logs.slice(-25).reverse().map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-slate-400 shrink-0">{new Date(l.created_at).toLocaleTimeString()}</span>
                <span className="text-blue-500 shrink-0">[{l.module}]</span>
                <span className="text-slate-700 dark:text-slate-300">{l.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

