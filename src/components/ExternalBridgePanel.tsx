import React, { useEffect, useRef, useState } from 'react';
import type { BridgeParserRule, StreamEventKind, StreamSnapshot } from '../types/stream.ts';
import { getServerHttpOrigin } from '../utils/runtime.ts';

interface ExternalBridgePanelProps {
  snapshot: StreamSnapshot;
  apiPost: (url: string, body?: unknown) => Promise<unknown>;
}

interface OcrCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ExternalBridgePanel: React.FC<ExternalBridgePanelProps> = ({ snapshot, apiPost }) => {
  const [subMode, setSubMode] = useState<'ocr' | 'script' | 'rules'>('ocr');
  const [sourcePlatform, setSourcePlatform] = useState<string>('auto');
  const [rawTestText, setRawTestText] = useState('AlexStream отправил 500 ₽ - На развитие канала!');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);

  // Экранный захват + локальный OCR
  const [capturing, setCapturing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [lastOcrText, setLastOcrText] = useState('');
  const [crop, setCrop] = useState<OcrCrop>({ x: 15, y: 20, w: 70, h: 45 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<{
    recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<unknown>;
  } | null>(null);
  const lastSentTextRef = useRef('');

  // Локальное состояние правил парсинга
  const [rules, setRules] = useState<BridgeParserRule[]>(snapshot.parser_rules || []);
  useEffect(() => {
    setRules(snapshot.parser_rules || []);
  }, [snapshot.parser_rules]);

  const stopScreenOcr = async () => {
    setCapturing(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (workerRef.current) {
      try {
        await workerRef.current.terminate();
      } catch {
        // Игнорируем ошибку остановки воркера
      }
      workerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      void stopScreenOcr();
    };
  }, []);

  const startScreenOcr = async () => {
    setStatusNote(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatusNote('Захват экрана не поддерживается в текущем браузере.');
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      mediaStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        void stopScreenOcr();
      });

      setOcrBusy(true);
      setStatusNote('Инициализация локального OCR-движка (rus+eng)...');
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('rus+eng');
      workerRef.current = worker as unknown as typeof workerRef.current;
      setOcrBusy(false);
      setCapturing(true);
      setStatusNote('Экранный OCR-мост активен: выделенная область сканируется каждые 2 секунды.');
    } catch (err) {
      setOcrBusy(false);
      setStatusNote(`Не удалось запустить захват экрана: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Периодический цикл сканирования выделенной области кадра
  useEffect(() => {
    if (!capturing) return;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      const worker = workerRef.current;
      if (!video || !worker || video.readyState < 2 || ocrBusy) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      const sx = Math.round((crop.x / 100) * vw);
      const sy = Math.round((crop.y / 100) * vh);
      const sw = Math.max(20, Math.round((crop.w / 100) * vw));
      const sh = Math.max(20, Math.round((crop.h / 100) * vh));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

      try {
        setOcrBusy(true);
        const res = await worker.recognize(canvas);
        const text = res.data.text.replace(/\s+/g, ' ').trim();
        setLastOcrText(text);
        if (text && text.length >= 4 && text !== lastSentTextRef.current) {
          lastSentTextRef.current = text;
          await apiPost('/api/bridges/ingest', {
            raw_text: text,
            source: sourcePlatform,
          });
        }
      } catch {
        // Пропускаем сбой отдельного кадра
      } finally {
        setOcrBusy(false);
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [capturing, crop, ocrBusy, sourcePlatform, apiPost]);

  const handleTestIngest = async () => {
    if (!rawTestText.trim()) return;
    const resp = (await apiPost('/api/bridges/ingest', {
      raw_text: rawTestText.trim(),
      source: sourcePlatform,
    })) as { ok?: boolean; deduplicated?: boolean; error?: string; event?: { username: string; amount: number; currency: string } };

    if (resp?.deduplicated) {
      setStatusNote('Дубль отфильтрован (окно защиты 12 сек).');
    } else if (resp?.ok && resp.event) {
      setStatusNote(`Распознано и отправлено: ${resp.event.username} · ${resp.event.amount} ${resp.event.currency}`);
    } else {
      setStatusNote(resp?.error || 'Строка не подошла под активные правила.');
    }
  };

  const ingestUrl = `${getServerHttpOrigin()}/api/bridges/ingest`;
  const userscriptCode = `// ==UserScript==
// @name         PulseCast Alert Bridge (DonationAlerts / Boosty / SE)
// @match        *://*.donationalerts.com/*
// @match        *://*.boosty.to/*
// @match        *://*.streamelements.com/*
// @match        *://*.donatepay.ru/*
// ==/UserScript==
(function() {
  const ENDPOINT = "${ingestUrl}";
  let lastSeen = "";
  const sendAlert = (rawText) => {
    const clean = String(rawText || "").replace(/\\s+/g, " ").trim();
    if (!clean || clean === lastSeen || clean.length < 4) return;
    lastSeen = clean;
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: clean, source: location.hostname })
    }).catch(() => {});
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.innerText) sendAlert(node.innerText);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();`;

  const updateRule = (id: string, patch: Partial<BridgeParserRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `rule_${Date.now()}`,
        name: 'Новая платформа',
        platform: 'Custom',
        enabled: true,
        priority: 50,
        default_kind: 'donation',
        pattern: '(?i)(?P<user>[^\\s]+)\\s+(?P<amount>\\d+)\\s*(?P<currency>₽|\\$)?(?:\\s*[-–:]\\s*(?P<message>.+))?',
      },
    ]);
  };

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Универсальный захват алертов (DonationAlerts · Boosty · StreamElements · Любая сцена)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Считывайте донаты без API: либо через скрипт в Browser Source / Tampermonkey, либо через экранный OCR-захват.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {[
            { id: 'ocr', label: 'Экранный захват + OCR' },
            { id: 'script', label: 'Браузерный скрипт' },
            { id: 'rules', label: `Правила парсера (${rules.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubMode(tab.id as 'ocr' | 'script' | 'rules')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                subMode === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Тестер парсера в реальном времени */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <select
          value={sourcePlatform}
          onChange={(e) => setSourcePlatform(e.target.value)}
          className="px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
        >
          <option value="auto">Авто-определение</option>
          <option value="DonationAlerts">DonationAlerts</option>
          <option value="Boosty">Boosty</option>
          <option value="StreamElements">StreamElements</option>
          <option value="Custom">Своя площадка</option>
        </select>
        <input
          value={rawTestText}
          onChange={(e) => setRawTestText(e.target.value)}
          placeholder="Вставьте строку уведомления со сцены (например: Ivan задонатил 300 ₽ - Привет!)"
          className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
        />
        <button
          type="button"
          onClick={() => void handleTestIngest()}
          className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap"
        >
          Распознать и запустить
        </button>
      </div>

      {statusNote && <div className="text-xs text-blue-500">{statusNote}</div>}

      {subMode === 'ocr' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="md:col-span-2 relative aspect-video bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
            <video ref={videoRef} muted playsInline className="w-full h-full object-contain" />
            <div
              className="absolute border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
              style={{
                left: `${crop.x}%`,
                top: `${crop.y}%`,
                width: `${crop.w}%`,
                height: `${crop.h}%`,
              }}
            />
            {!capturing && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 px-4 text-center">
                Нажмите «Выбрать окно / вкладку», чтобы считывать текст уведомления прямо с видеопотока сцены оплаты.
              </div>
            )}
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex gap-2">
              {!capturing ? (
                <button
                  type="button"
                  onClick={() => void startScreenOcr()}
                  className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold"
                >
                  Выбрать окно / вкладку
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void stopScreenOcr()}
                  className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white font-semibold"
                >
                  Остановить захват
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label key={k} className="block">
                  <span className="text-[11px] text-slate-400 uppercase">Зона {k} (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={crop[k]}
                    onChange={(e) => setCrop((c) => ({ ...c, [k]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                    className="w-full mt-0.5 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
                  />
                </label>
              ))}
            </div>

            <div>
              <div className="text-[11px] text-slate-400 mb-1">Последний распознанный OCR-текст:</div>
              <div className="p-2 rounded bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 font-mono text-[11px] min-h-[54px] break-words">
                {lastOcrText || 'Ожидание кадра...'}
              </div>
            </div>
          </div>
        </div>
      )}

      {subMode === 'script' && (
        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Вставьте этот код в OBS Browser Source (Custom JS) или Tampermonkey для перехвата DOM-уведомлений:
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(userscriptCode);
                setCopiedScript(true);
                window.setTimeout(() => setCopiedScript(false), 2000);
              }}
              className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold whitespace-nowrap"
            >
              {copiedScript ? 'Скопировано' : 'Копировать скрипт'}
            </button>
          </div>
          <textarea
            readOnly
            rows={8}
            value={userscriptCode}
            className="w-full p-2.5 text-[11px] font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17]"
          />
        </div>
      )}

      {subMode === 'rules' && (
        <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Используйте именованные группы: (?P&lt;user&gt;...), (?P&lt;amount&gt;...), (?P&lt;currency&gt;...), (?P&lt;message&gt;...)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addRule}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Добавить правило
              </button>
              <button
                type="button"
                onClick={() => {
                  void apiPost('/api/bridges/rules', rules);
                  setStatusNote('Правила парсера сохранены.');
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
              >
                Сохранить правила
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto custom-scroll pr-1">
            {rules.map((r) => (
              <div
                key={r.id}
                className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
                  />
                  <input
                    value={r.name}
                    onChange={(e) => updateRule(r.id, { name: e.target.value })}
                    className="flex-1 min-w-[140px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] font-semibold"
                  />
                  <input
                    value={r.platform}
                    onChange={(e) => updateRule(r.id, { platform: e.target.value })}
                    placeholder="Платформа"
                    className="w-32 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                  <select
                    value={r.default_kind}
                    onChange={(e) => updateRule(r.id, { default_kind: e.target.value as StreamEventKind })}
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  >
                    <option value="donation">donation</option>
                    <option value="subscription">subscription</option>
                    <option value="follow">follow</option>
                    <option value="raid">raid</option>
                  </select>
                  <input
                    type="number"
                    value={r.priority}
                    onChange={(e) => updateRule(r.id, { priority: Number(e.target.value) })}
                    className="w-16 px-2 py-1 font-mono tabular-nums rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  />
                  <button
                    type="button"
                    onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                    className="px-2 py-1 text-red-500 hover:bg-red-500/10 rounded"
                  >
                    Удалить
                  </button>
                </div>
                <input
                  value={r.pattern}
                  onChange={(e) => updateRule(r.id, { pattern: e.target.value })}
                  className="w-full px-2 py-1 font-mono text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
