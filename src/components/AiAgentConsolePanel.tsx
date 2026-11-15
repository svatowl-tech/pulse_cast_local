import React, { useState } from 'react';
import type { AgentResponse, StreamSnapshot } from '../types/stream.ts';
import { isTauriRuntime } from '../utils/runtime.ts';

interface AiAgentConsolePanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
  standalone?: boolean;
  onPopout?: () => void;
}

const PRESET_PROMPTS = [
  'Включи звёздочки, смени сцену на Gaming Capture и отметь клип',
  'Запусти Battle Royale и заставь всех чоков танцевать',
  'Активируй плагин реакции на слово бум и включи тему Неон',
  'Выведи тестовый донат алерт и включи субтитры',
];

export const AiAgentConsolePanel: React.FC<AiAgentConsolePanelProps> = ({
  snapshot,
  apiPost,
  standalone = false,
  onPopout,
}) => {
  const [backend, setBackend] = useState<'http' | 'embedded'>(snapshot.llm.backend);
  const [serverUrl, setServerUrl] = useState(snapshot.llm.server_url);
  const [prompt, setPrompt] = useState('');
  const [lastResponse, setLastResponse] = useState<AgentResponse | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section
      className={`bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-3 ${
        standalone ? 'min-h-0 flex-1 overflow-y-auto custom-scroll' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Локальный ИИ-Агент (Function Calling)
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setBackend('http')}
              className={`px-2 py-1 rounded-md ${
                backend === 'http' ? 'bg-blue-600 text-white' : 'text-slate-500'
              }`}
            >
              HTTP llama-server
            </button>
            <button
              type="button"
              onClick={() => setBackend('embedded')}
              className={`px-2 py-1 rounded-md ${
                backend === 'embedded' ? 'bg-blue-600 text-white' : 'text-slate-500'
              }`}
            >
              Embedded llama-cpp-2
            </button>
          </div>
          {!standalone && onPopout && (
            isTauriRuntime() ? (
              <button
                type="button"
                onClick={onPopout}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 whitespace-nowrap"
              >
                В окно
              </button>
            ) : (
              <a
                href="/?window=agent_feed"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onPopout()}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 whitespace-nowrap"
              >
                В окно
              </a>
            )
          )}
        </div>
      </div>

      <input
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        placeholder="http://127.0.0.1:8081/v1/chat/completions"
        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] shrink-0"
      />

      <div className="flex flex-wrap gap-1.5 shrink-0">
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

      <div className="flex gap-2 shrink-0">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runAgent();
            }
          }}
          placeholder="Дайте команду ИИ-режиссёру..."
          className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
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
          <div className="text-[11px] font-mono text-slate-400">
            Режим: {lastResponse.backend_used}
          </div>
          {lastResponse.tool_calls_executed.map((t, i) => (
            <div key={i} className="font-mono text-[11px] text-emerald-500">
              → {t.name}: {t.result}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
