import React, { useState } from 'react';
import type { ChatPlatform, EmoteEntry, StreamSnapshot } from '../types/stream.ts';
import { isTauriRuntime } from '../utils/runtime.ts';

interface MultiChatPanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  standalone?: boolean;
  onPopout?: () => void;
  draftText?: string;
  onDraftTextChange?: (next: string) => void;
}

const PLATFORMS: Array<{ id: ChatPlatform; label: string }> = [
  { id: 'twitch', label: 'Twitch' },
  { id: 'vk_live', label: 'VK Video Live' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'kick', label: 'Kick' },
  { id: 'goodgame', label: 'GoodGame' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'rutube', label: 'Rutube' },
  { id: 'local', label: 'Local' },
];

function renderWithEmotes(text: string, emotes: EmoteEntry[]): React.ReactNode {
  const map = new Map((emotes || []).map((e) => [e.code, e.url]));
  return text.split(/(\s+)/).map((word, idx) => {
    const url = map.get(word);
    if (url) {
      return (
        <img
          key={idx}
          src={url}
          alt={word}
          title={word}
          className="inline-block h-5 w-auto align-middle mx-0.5"
        />
      );
    }
    return <React.Fragment key={idx}>{word}</React.Fragment>;
  });
}

export const MultiChatPanel: React.FC<MultiChatPanelProps> = ({
  snapshot,
  apiPost,
  standalone = false,
  onPopout,
  draftText,
  onDraftTextChange,
}) => {
  const [chatPlatform, setChatPlatform] = useState<ChatPlatform>('twitch');
  const [chatUser, setChatUser] = useState('AlexStream');
  const [internalText, setInternalText] = useState('');
  const [chatFilter, setChatFilter] = useState<string>('all');
  const [chatError, setChatError] = useState<string | null>(null);

  const chatText = draftText !== undefined ? draftText : internalText;
  const setChatText = onDraftTextChange || setInternalText;

  const handleSendChat = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const txt = (overrideText ?? chatText).trim();
    if (!txt) return;
    setChatError(null);
    const res = (await apiPost('/api/chat/ingest', {
      platform: chatPlatform,
      username: chatUser || 'Viewer',
      role: 'viewer',
      text: txt,
    })) as { ok?: boolean; error?: string };
    if (res && res.ok === false) {
      setChatError(res.error || 'Сообщение отклонено модерацией');
    } else if (!overrideText) {
      setChatText('');
    }
  };

  const filteredMessages = snapshot.chat_history.filter((m) =>
    chatFilter === 'all' ? true : m.platform === chatFilter,
  );

  return (
    <section
      className={`bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col min-h-0 ${
        standalone ? 'flex-1 h-full' : 'min-h-[460px] max-h-[680px]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            Мультичат, ИИ-Собеседник и Смайлики 7TV/BTTV/FFZ
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            ИИ-Персонаж: {snapshot.ai_chatbot?.persona_name || 'Кибер-Лис'} · Перевод:{' '}
            {snapshot.ai_chatbot?.live_translation ? 'ВКЛ' : 'ВЫКЛ'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={chatFilter}
            onChange={(e) => setChatFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          >
            <option value="all">Все площадки</option>
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {!standalone && onPopout && (
            isTauriRuntime() ? (
              <button
                type="button"
                onClick={onPopout}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 whitespace-nowrap"
                title="Вынести мультичат в отдельное окно"
              >
                В окно
              </button>
            ) : (
              <a
                href="/?window=chat"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onPopout()}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 whitespace-nowrap"
                title="Открыть мультичат в отдельном окне"
              >
                В окно
              </a>
            )
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-2 pr-1 border-y border-slate-100 dark:border-slate-800 py-3">
        {filteredMessages.length === 0 ? (
          <div className="text-xs text-slate-400 py-8 text-center">
            Сообщений пока нет — напишите в чат или выберите другую площадку
          </div>
        ) : (
          filteredMessages.map((m) => (
            <div key={m.id} className="text-xs leading-relaxed break-words">
              <span className="font-mono text-[11px] text-slate-400 mr-1.5">[{m.platform}]</span>
              <span className="font-semibold mr-1.5" style={{ color: m.color }}>
                {m.username}
              </span>
              <span className="text-slate-700 dark:text-slate-200">
                {renderWithEmotes(m.text, snapshot.emotes)}
              </span>
              {m.translated_text && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 text-[11px]">
                  [Перевод: {m.translated_text}]
                </span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="pt-3 shrink-0 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            '!dance',
            '!jump',
            '!death',
            '!win',
            '!commands',
            '@bot какая сейчас игра?',
            'Hello streamer, amazing stream POG KEKW',
            'бум',
          ].map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => void handleSendChat(undefined, cmd)}
              className="px-2 py-1 text-[11px] font-mono rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
            >
              {cmd}
            </button>
          ))}
        </div>

        {chatError && <div className="text-xs text-red-500">{chatError}</div>}

        <form onSubmit={(e) => void handleSendChat(e)} className="flex flex-wrap sm:flex-nowrap gap-2">
          <select
            value={chatPlatform}
            onChange={(e) => setChatPlatform(e.target.value as ChatPlatform)}
            className="px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={chatUser}
            onChange={(e) => setChatUser(e.target.value)}
            placeholder="Ник"
            className="w-24 sm:w-28 px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Сообщение, !команда или @bot..."
            className="flex-1 min-w-[140px] px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap"
          >
            Отправить
          </button>
        </form>
      </div>
    </section>
  );
};
