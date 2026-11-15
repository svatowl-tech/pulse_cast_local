import React, { useEffect, useState } from 'react';
import type { ChatPlatform, EmoteEntry, PlatformConnection, StreamSnapshot } from '../types/stream.ts';

interface PlatformAuthHubProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  onInsertEmote?: (code: string) => void;
}

type AuthProvider = 'twitch' | 'youtube' | 'kick' | 'vk_live';

const PROVIDER_META: Record<
  AuthProvider,
  { title: string; badge: string; placeholder: string }
> = {
  twitch: {
    title: 'Twitch (IRC / OAuth 2.0)',
    badge: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    placeholder: 'Имя канала (например: xqc, bratishkinoff)',
  },
  youtube: {
    title: 'YouTube Live (Google OAuth / Live ID)',
    badge: 'text-red-400 border-red-500/30 bg-red-500/10',
    placeholder: 'Канал или ID трансляции YouTube',
  },
  kick: {
    title: 'Kick (OAuth / Pusher WS)',
    badge: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    placeholder: 'Ник канала на Kick',
  },
  vk_live: {
    title: 'VK Видео Live (OAuth / Канал)',
    badge: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
    placeholder: 'Канал VK Видео Live',
  },
};

export const PlatformAuthHub: React.FC<PlatformAuthHubProps> = ({
  snapshot,
  apiPost,
  onInsertEmote,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<AuthProvider>('twitch');
  const [channelInput, setChannelInput] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [sendRelay, setSendRelay] = useState(true);
  const [emoteChannel, setEmoteChannel] = useState('xqc');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showRedirectInfo, setShowRedirectInfo] = useState(false);

  const connections: PlatformConnection[] = snapshot.platform_connections || [];
  const currentConn = connections.find((c) => c.platform === selectedProvider);

  useEffect(() => {
    if (currentConn) {
      setChannelInput(currentConn.channel_name || '');
      setClientIdInput(currentConn.client_id || '');
      setSendRelay(currentConn.send_relay);
    }
  }, [selectedProvider, currentConn?.channel_name]);

  // Слушаем postMessage от OAuth Popup окна (/auth/callback)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; provider?: string } | undefined;
      if (data?.type === 'OAUTH_AUTH_SUCCESS') {
        setStatusMsg(`OAuth-авторизация ${data.provider || ''} успешно завершена!`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleOAuthPopup = async (provider: AuthProvider) => {
    try {
      const qs = new URLSearchParams({
        provider,
        channel: channelInput.trim() || `${provider}_streamer`,
        client_id: clientIdInput.startsWith('••') ? '' : clientIdInput.trim(),
      });
      const res = await fetch(`/api/auth/url?${qs.toString()}`);
      if (!res.ok) throw new Error('Не удалось получить OAuth URL');
      const { url } = (await res.json()) as { url: string };
      const popup = window.open(url, 'pulsecast_oauth_popup', 'width=620,height=720');
      if (!popup) {
        setStatusMsg('Разрешите всплывающие окна (Popup) в браузере для OAuth-входа.');
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Ошибка запуска OAuth');
    }
  };

  const handleManualConnect = async () => {
    const ch = channelInput.trim() || `${selectedProvider}_channel`;
    await apiPost('/api/platforms/connect', {
      platform: selectedProvider,
      channel_name: ch,
      auth_mode: 'token',
      client_id: clientIdInput.startsWith('••') ? '' : clientIdInput.trim(),
      send_relay: sendRelay,
    });
    setStatusMsg(`Канал «${ch}» (${selectedProvider}) подключён к мультичату.`);
  };

  const handleDisconnect = async (platform: AuthProvider) => {
    await apiPost('/api/platforms/disconnect', { platform });
    setStatusMsg(`Платформа ${platform} отключена.`);
  };

  const handleFetchEmotes = async () => {
    const ch = emoteChannel.trim() || channelInput.trim() || 'global';
    setStatusMsg(`Загружаю смайлики 7TV / BTTV / FFZ для «${ch}»...`);
    const res = (await apiPost('/api/emotes/fetch', { channel: ch })) as {
      added?: number;
      total?: number;
    };
    setStatusMsg(
      `Смайлики синхронизированы: добавлено ${res?.added ?? 0}, всего в кэше ${
        res?.total ?? snapshot.emotes?.length ?? 0
      } шт.`,
    );
  };

  const emotes: EmoteEntry[] = snapshot.emotes || [];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-slate-800 dark:text-slate-100">
          Авторизация платформ мультичата и смайлики 7TV / BTTV / FFZ
        </div>
        <button
          type="button"
          onClick={() => setShowRedirectInfo((v) => !v)}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showRedirectInfo ? 'Скрыть Redirect URI' : 'OAuth Redirect URI'}
        </button>
      </div>

      {showRedirectInfo && (
        <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
          <div className="font-medium text-slate-700 dark:text-slate-200">
            Укажите эти Callback URL в кабинете разработчика Twitch / Google / Kick / VK:
          </div>
          <div className="font-mono text-[10px] text-blue-500 select-all break-all">
            https://ais-dev-2idzlyi7t3igqaz2jodf6m-13199952792.us-east5.run.app/auth/callback
          </div>
          <div className="font-mono text-[10px] text-emerald-500 select-all break-all">
            https://ais-pre-2idzlyi7t3igqaz2jodf6m-13199952792.us-east5.run.app/auth/callback
          </div>
        </div>
      )}

      {/* Переключатель 4 платформ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {(['twitch', 'youtube', 'kick', 'vk_live'] as const).map((plat) => {
          const conn = connections.find((c) => c.platform === plat);
          const active = selectedProvider === plat;
          return (
            <button
              key={plat}
              type="button"
              onClick={() => setSelectedProvider(plat)}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-600/10 text-slate-900 dark:text-white'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-[10px]">{plat}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    conn?.connected ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
                  }`}
                />
              </div>
              <div className="truncate text-[10px] opacity-80 mt-0.5">
                {conn?.connected ? conn.channel_name : 'Не подключён'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Настройка выбранной платформы */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
        <input
          type="text"
          value={channelInput}
          onChange={(e) => setChannelInput(e.target.value)}
          placeholder={PROVIDER_META[selectedProvider].placeholder}
          className="sm:col-span-5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs"
        />
        <input
          type="text"
          value={clientIdInput}
          onChange={(e) => setClientIdInput(e.target.value)}
          placeholder="Client ID / OAuth Token (опц.)"
          className="sm:col-span-4 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs"
        />
        <label className="sm:col-span-3 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={sendRelay}
            onChange={(e) => setSendRelay(e.target.checked)}
          />
          Отправка ответов
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleOAuthPopup(selectedProvider)}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs"
        >
          Войти через OAuth ({selectedProvider.toUpperCase()})
        </button>
        <button
          type="button"
          onClick={() => void handleManualConnect()}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs"
        >
          Подключить по каналу / токену
        </button>
        {currentConn?.connected && (
          <button
            type="button"
            onClick={() => void handleDisconnect(selectedProvider)}
            className="px-2.5 py-1.5 rounded-lg bg-rose-600/15 text-rose-400 hover:bg-rose-600/25 text-xs"
          >
            Отключить
          </button>
        )}
      </div>

      {/* Автозагрузка смайликов 7TV / BTTV / FFZ и быстрая панель вставки в чат */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={emoteChannel}
            onChange={(e) => setEmoteChannel(e.target.value)}
            placeholder="Ник канала для 7TV / BTTV / FFZ"
            className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs w-44"
          />
          <button
            type="button"
            onClick={() => void handleFetchEmotes()}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs"
          >
            Загрузить смайлики 7TV / BTTV / FFZ
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            В кэше: <strong>{emotes.length}</strong> эмоутов (клик — вставить в чат)
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {emotes.slice(0, 28).map((em) => (
            <button
              key={em.code}
              type="button"
              onClick={() => onInsertEmote?.(em.code)}
              title={`${em.code} (${em.provider})`}
              className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 shrink-0"
            >
              <img src={em.url} alt={em.code} className="h-4 w-auto object-contain" />
              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">{em.code}</span>
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{statusMsg}</div>
      )}
    </div>
  );
};
