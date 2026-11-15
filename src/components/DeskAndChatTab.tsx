import React, { useState } from 'react';
import type { ChatPlatform, EmoteEntry, HotkeyBinding, StreamSnapshot } from '../types/stream.ts';
import { playSynthTone } from './audioSynth.ts';
import { PlatformAuthHub } from './PlatformAuthHub.tsx';
import { ChatBotManagerPanel } from './ChatBotManagerPanel.tsx';
import { StudioMixerAndHotkeysPanel } from './StudioMixerAndHotkeysPanel.tsx';
import { StreamAnalyticsPanel } from './StreamAnalyticsPanel.tsx';

interface DeskAndChatTabProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  soundMuted: boolean;
  onToggleSoundMute: () => void;
  onTriggerHotkey?: (binding: HotkeyBinding) => void;
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

export const DeskAndChatTab: React.FC<DeskAndChatTabProps> = ({
  snapshot,
  apiPost,
  soundMuted,
  onToggleSoundMute,
  onTriggerHotkey,
}) => {
  const [donUser, setDonUser] = useState('KiraDev');
  const [donAmount, setDonAmount] = useState('500');
  const [donMsg, setDonMsg] = useState('Топовый эфир! Включай звёздочки POG');

  const [chatPlatform, setChatPlatform] = useState<ChatPlatform>('twitch');
  const [chatUser, setChatUser] = useState('AlexStream');
  const [chatText, setChatText] = useState('');
  const [chatFilter, setChatFilter] = useState<string>('all');
  const [chatError, setChatError] = useState<string | null>(null);

  const [clipTitle, setClipTitle] = useState('');

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
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Левый столбец: Web Stream Deck, Сцены, Саундборд, Эмуляция доната */}
        <div className="flex flex-col gap-4">
          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Web Stream Deck (LAN Пульт)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Сцена: {snapshot.obs.active_scene} · OBS Bridge: {snapshot.obs.connected ? 'Подключён' : 'Автономно'}
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleSoundMute}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                {soundMuted ? 'Включить звук' : 'Заглушить звук'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {snapshot.deck_buttons.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => void apiPost('/api/deck/trigger', { button_id: btn.id })}
                  className="min-h-[48px] px-3 py-2 text-left rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-[#0B0F17] hover:border-blue-500 transition-colors text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5">
              {snapshot.obs.scenes.map((scene) => (
                <button
                  key={scene}
                  type="button"
                  onClick={() => void apiPost('/api/scene', { scene })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    snapshot.obs.active_scene === scene
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {scene}
                </button>
              ))}
            </div>
          </section>

          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Локальный саундборд и Маркеры клипов
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {snapshot.sounds.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (!soundMuted) playSynthTone(s.freq_hz, s.pattern, s.volume, snapshot.audio_mixer);
                    void apiPost('/api/sound/play', { sound_id: s.id });
                  }}
                  className="min-h-[42px] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] hover:border-blue-500 text-xs font-medium truncate"
                >
                  {s.name}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={clipTitle}
                onChange={(e) => setClipTitle(e.target.value)}
                placeholder="Название хайлайта..."
                className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <button
                type="button"
                onClick={() => {
                  void apiPost('/api/clip', { title: clipTitle || 'Хайлайт эфира', author: 'Стример' });
                  setClipTitle('');
                }}
                className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Отметить клип
              </button>
            </div>
            {snapshot.clip_markers.length > 0 && (
              <div className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 space-y-1 max-h-20 overflow-y-auto custom-scroll">
                {snapshot.clip_markers.slice(-4).reverse().map((c) => (
                  <div key={c.id} className="flex justify-between font-mono tabular-nums">
                    <span className="truncate">{c.title}</span>
                    <span>+{c.stream_elapsed_sec}с</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Вебхук донатов (DonationAlerts / DonatePay)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <input
                value={donUser}
                onChange={(e) => setDonUser(e.target.value)}
                placeholder="Ник отправителя"
                className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <input
                type="number"
                value={donAmount}
                onChange={(e) => setDonAmount(e.target.value)}
                placeholder="Сумма"
                className="px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <button
                type="button"
                onClick={() =>
                  void apiPost('/api/webhooks/donation', {
                    username: donUser,
                    amount: Number(donAmount) || 100,
                    currency: '₽',
                    message: donMsg,
                  })
                }
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap"
              >
                Отправить донат
              </button>
            </div>
            <input
              value={donMsg}
              onChange={(e) => setDonMsg(e.target.value)}
              placeholder="Текст сообщения доната..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
            />
          </section>
        </div>

        {/* Правый столбец: Объединённый мультичат RutonyChat + команды Stream Avatars */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col min-h-[460px] max-h-[680px]">
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Мультичат, ИИ-Собеседник и Смайлики 7TV/BTTV/FFZ
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ИИ-Персонаж: {snapshot.ai_chatbot?.persona_name || 'Кибер-Лис'} · Перевод:{' '}
                {snapshot.ai_chatbot?.live_translation ? 'ВКЛ' : 'ВЫКЛ'}
              </p>
            </div>
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
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scroll space-y-2 pr-1 border-y border-slate-100 dark:border-slate-800 py-3">
            {filteredMessages.map((m) => (
              <div key={m.id} className="text-xs leading-relaxed">
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
            ))}
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
                  className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {chatError && <div className="text-xs text-red-500">{chatError}</div>}

            <form onSubmit={(e) => void handleSendChat(e)} className="flex flex-col sm:flex-row gap-2">
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
                className="sm:w-28 px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
              />
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Сообщение, !команда или @bot вопрос..."
                className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
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
      </div>

      {/* Студийный аудио-микшер (4 канала) и глобальные горячие клавиши */}
      <StudioMixerAndHotkeysPanel
        snapshot={snapshot}
        apiPost={apiPost}
        onTriggerHotkey={onTriggerHotkey}
      />

      {/* Графики аналитики донатов, зрителей и активности чата */}
      <StreamAnalyticsPanel snapshot={snapshot} />

      {/* Хаб авторизации платформ (Twitch / YouTube / Kick / VK Live) + 7TV/BTTV/FFZ эмоуты */}
      <PlatformAuthHub
        snapshot={snapshot}
        apiPost={apiPost}
        onInsertEmote={(code) => setChatText((prev) => `${prev ? `${prev} ` : ''}${code}`)}
      />

      {/* Классический менеджер чат-бота (!команды, таймеры, автомодерация, магазин лояльности, викторина) */}
      <ChatBotManagerPanel snapshot={snapshot} apiPost={apiPost} />
    </div>
  );
};

