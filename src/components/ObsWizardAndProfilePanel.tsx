import React, { useState } from 'react';
import type { StreamSnapshot } from '../types/stream.ts';

interface ObsWizardAndProfilePanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

export const ObsWizardAndProfilePanel: React.FC<ObsWizardAndProfilePanelProps> = ({
  snapshot,
  apiPost,
}) => {
  const [endpoint, setEndpoint] = useState(snapshot.obs.endpoint || '127.0.0.1:4455');
  const [password, setPassword] = useState('');
  const [obsBusy, setObsBusy] = useState(false);
  const [obsFeedback, setObsFeedback] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      setCopiedKey(null);
    }
  };

  const handleConnectObs = async (e: React.FormEvent) => {
    e.preventDefault();
    setObsBusy(true);
    setObsFeedback(null);
    try {
      const res = (await apiPost('/api/obs/connect', {
        endpoint: endpoint.trim() || '127.0.0.1:4455',
        password,
      })) as { ok?: boolean; error?: string };
      if (res?.ok) {
        setObsFeedback('OBS Studio WebSocket v5 подключён и сцены синхронизированы.');
      } else if (res?.error) {
        setObsFeedback(res.error);
      }
    } finally {
      setObsBusy(false);
    }
  };

  const handleDisconnectObs = async () => {
    setObsBusy(true);
    try {
      await apiPost('/api/obs/disconnect', {});
      setObsFeedback('OBS WebSocket отключён.');
    } finally {
      setObsBusy(false);
    }
  };

  const handleExportProfile = async () => {
    const res = await fetch('/api/profile/export');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulsecast_profile_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setProfileStatus('Профиль экспортирован в JSON.');
  };

  const handleImportProfile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileStatus(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = (await apiPost('/api/profile/import', parsed)) as { ok?: boolean; error?: string };
      if (res?.ok) {
        setProfileStatus('Профиль успешно импортирован и сохранён на диск.');
      } else {
        setProfileStatus(res?.error || 'Некорректный формат файла профиля.');
      }
    } catch {
      setProfileStatus('Ошибка чтения JSON: проверьте синтаксис файла.');
    } finally {
      e.target.value = '';
    }
  };

  const handleResetProfile = async () => {
    await apiPost('/api/profile/reset', {});
    setConfirmReset(false);
    setProfileStatus('Настройки студии сброшены к значениям по умолчанию.');
  };

  const quickLinks = [
    {
      id: 'overlay',
      title: '1. Browser Source (Оверлей OBS)',
      hint: '1920×1080 · 60 FPS · «Управление аудио через OBS»',
      url: `${origin}/overlay`,
    },
    {
      id: 'dock',
      title: '2. Пользовательская док-панель (OBS Dock)',
      hint: 'Панель браузера внутри OBS (Доки → Пользовательские)',
      url: `${origin}/obs-dock`,
    },
    {
      id: 'donate',
      title: '3. Публичная страница приёма донатов',
      hint: 'Для описания под стримом (RUB / USD / EUR / KZT / Crypto)',
      url: `${origin}/donate`,
    },
    {
      id: 'webhook',
      title: '4. Webhook API (Донаты и игровые события)',
      hint: 'POST JSON { username, amount, currency, message }',
      url: `${origin}/api/webhooks/donation`,
    },
  ];

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Подключение реального OBS Studio WebSocket v5 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                OBS Studio WebSocket v5 (Живое управление)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Двусторонняя синхронизация сцен и статуса с локальным OBS 28+
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap ${
                snapshot.obs.connected
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {snapshot.obs.connected
                ? `OBS подключён${snapshot.obs.obs_version ? ` (v${snapshot.obs.obs_version})` : ''}`
                : 'Автономно'}
            </span>
          </div>

          <form onSubmit={(e) => void handleConnectObs(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="127.0.0.1:4455"
              className="px-3 py-2 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={snapshot.obs.password_set ? 'Пароль задан (введите новый)' : 'Пароль OBS WebSocket (если задан)'}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={obsBusy}
                className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {obsBusy ? 'Подключение...' : snapshot.obs.connected ? 'Переподключить' : 'Подключить OBS'}
              </button>
              {snapshot.obs.connected && (
                <button
                  type="button"
                  onClick={() => void handleDisconnectObs()}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-rose-500 text-rose-400 font-medium whitespace-nowrap"
                >
                  Откл.
                </button>
              )}
            </div>
          </form>

          {(obsFeedback || snapshot.obs.last_error) && (
            <div
              className={`text-xs px-3 py-2 rounded-lg border ${
                snapshot.obs.connected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              }`}
            >
              {obsFeedback || snapshot.obs.last_error}
            </div>
          )}

          {/* Профиль на диске: автосохранение, экспорт, импорт, сброс */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Автосохранение на диск (pulsecast_profile.json)
                </span>
                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                  Последнее сохранение:{' '}
                  {snapshot.profile_last_saved_at
                    ? new Date(snapshot.profile_last_saved_at).toLocaleTimeString()
                    : 'активно'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExportProfile()}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-medium whitespace-nowrap"
                >
                  Экспорт JSON
                </button>
                <label className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-medium cursor-pointer whitespace-nowrap">
                  Импорт JSON
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(e) => void handleImportProfile(e)}
                    className="hidden"
                  />
                </label>
                {!confirmReset ? (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs font-medium whitespace-nowrap"
                  >
                    Сброс
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleResetProfile()}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      Подтвердить сброс
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs whitespace-nowrap"
                    >
                      Отмена
                    </button>
                  </div>
                )}
              </div>
            </div>
            {profileStatus && (
              <div className="text-xs text-blue-400">{profileStatus}</div>
            )}
          </div>
        </div>

        {/* Мастер быстрого старта и копирования ссылок для OBS Studio */}
        <div className="space-y-2.5 xl:border-l xl:border-slate-200 xl:dark:border-slate-800 xl:pl-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Мастер быстрого старта OBS Studio
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Скопируйте ссылки в OBS в 1 клик — единый Browser Source экономит CPU
            </p>
          </div>

          <div className="space-y-2">
            {quickLinks.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="text-[11px] text-slate-400">{item.hint}</div>
                  <div className="font-mono text-[11px] text-blue-400 truncate mt-0.5">{item.url}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyValue(item.id, item.url)}
                  className={`px-3 py-1.5 rounded-md font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    copiedKey === item.id
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 dark:border-slate-700 hover:border-blue-500'
                  }`}
                >
                  {copiedKey === item.id ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
