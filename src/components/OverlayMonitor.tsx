import React, { useEffect, useRef, useState } from 'react';
import type {
  AlertVariation,
  ChatMessage,
  CustomOverlayElement,
  StreamEvent,
  StreamSnapshot,
  WidgetLayoutConfig,
  WsBroadcast,
} from '../types/stream.ts';
import { resolveApiUrl, resolveAssetUrl } from '../utils/runtime.ts';

interface OverlayMonitorProps {
  snapshot: StreamSnapshot;
  activeAlert: StreamEvent | null;
  activeSubtitle: string | null;
  wheelResult: { index: number; label: string; ts: number } | null;
  lastWsEvent: WsBroadcast | null;
  soundMuted: boolean;
  layoutEditMode?: boolean;
  onToggleLayoutEdit?: () => void;
  apiPost?: (url: string, body?: unknown) => Promise<unknown>;
}

interface AvatarEntity {
  username: string;
  color: string;
  skin: string;
  gear: string[];
  nametag: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bubble: string;
  bubbleUntil: number;
  danceUntil: number;
  hp: number;
  alive: boolean;
}

interface StarDrop {
  x: number;
  y: number;
  vy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  r: number;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function getWrapperStyle(preset: WidgetLayoutConfig['wrapper_preset'], accent: string, surface: string, border: string): React.CSSProperties {
  switch (preset) {
    case 'neon_frame':
      return {
        background: 'rgba(9, 13, 28, 0.88)',
        border: `1px solid ${accent}`,
        boxShadow: `0 0 18px ${accent}44`,
        borderRadius: '10px',
      };
    case 'retro_crt':
      return {
        background: 'rgba(6, 12, 18, 0.92)',
        border: '1.5px solid #22C55E',
        borderRadius: '4px',
        fontFamily: 'var(--font-mono)',
      };
    case 'glass_bar':
      return {
        background: surface,
        border: `1px solid ${border}`,
        backdropFilter: 'blur(8px)',
        borderRadius: '10px',
      };
    case 'minimal_edge':
      return {
        background: surface,
        border: `1px solid ${border}`,
        borderRadius: '6px',
      };
    default:
      return { background: 'transparent', border: 'none' };
  }
}

function formatAlertTpl(tpl: string, ev: StreamEvent): string {
  return String(tpl || '{user} · {amount} {currency}')
    .replace(/\{user\}/g, ev.username || '')
    .replace(/\{amount\}/g, String(Math.round(ev.amount || 0)))
    .replace(/\{currency\}/g, ev.currency || '₽')
    .replace(/\{message\}/g, ev.message || '')
    .replace(/\{source\}/g, ev.source || '');
}

function parseInlineCss(cssText: string): React.CSSProperties {
  const out: Record<string, string> = {};
  if (!cssText) return out;
  for (const part of cssText.split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const rawKey = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!rawKey || !val) continue;
    const camel = rawKey.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    out[camel] = val;
  }
  return out as React.CSSProperties;
}

export const OverlayMonitor: React.FC<OverlayMonitorProps> = ({
  snapshot,
  activeAlert,
  activeSubtitle,
  wheelResult,
  lastWsEvent,
  soundMuted,
  layoutEditMode = false,
  onToggleLayoutEdit,
  apiPost,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const avatarsRef = useRef<Map<string, AvatarEntity>>(new Map());
  const pluginStatesRef = useRef<Record<string, Record<string, unknown>>>({});
  const particlesRef = useRef<Particle[]>([]);
  const starsDropRef = useRef<StarDrop[]>([]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const [dragState, setDragState] = useState<{
    kind: 'widget' | 'element';
    id: string;
    startClientX: number;
    startClientY: number;
    origXPct: number;
    origYPct: number;
    currXPct: number;
    currYPct: number;
  } | null>(null);

  const overlayTheme =
    snapshot.themes.find((t) => t.id === snapshot.active_overlay_theme) ||
    snapshot.themes.find((t) => t.target === 'overlay') ||
    snapshot.themes[0];

  // Синхронизируем список аватаров при изменении профилей зрителей
  useEffect(() => {
    const canvas = canvasRef.current;
    const width = canvas?.width || 960;
    const height = canvas?.height || 540;
    const map = avatarsRef.current;

    Object.values(snapshot.viewers).forEach((v) => {
      const existing = map.get(v.username);
      if (!existing) {
        map.set(v.username, {
          username: v.username,
          color: v.avatar_color,
          skin: v.avatar_skin,
          gear: v.gear,
          nametag: v.nametag,
          x: 60 + Math.random() * Math.max(200, width - 120),
          y: height - 30,
          vx: (Math.random() > 0.5 ? 1 : -1) * 1.3,
          vy: 0,
          bubble: '',
          bubbleUntil: 0,
          danceUntil: 0,
          hp: 100,
          alive: true,
        });
      } else {
        existing.color = v.avatar_color;
        existing.skin = v.avatar_skin;
        existing.gear = v.gear;
        existing.nametag = v.nametag;
      }
    });
  }, [snapshot.viewers]);

  // Реагируем на входящие события WebSocket (плагины, аватары, мини-игры)
  useEffect(() => {
    if (!lastWsEvent) return;
    const canvas = canvasRef.current;
    const width = canvas?.width || 960;
    const height = canvas?.height || 540;

    const sdk = {
      spawnParticles: (x: number, y: number, count = 20, color = '#FBBF24') => {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1.4 + Math.random() * 3.8;
          particlesRef.current.push({
            x,
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 1.8,
            life: 1,
            color,
            r: 2 + Math.random() * 2.8,
          });
        }
      },
    };

    const runPluginHook = (hookName: string, payload: unknown) => {
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      for (const p of snapshotRef.current.plugins) {
        if (!p.enabled || !p.hooks.includes(hookName)) continue;
        try {
          const st = pluginStatesRef.current[p.id] || (pluginStatesRef.current[p.id] = {});
          const fn = new Function('ctx', 'width', 'height', 'cfg', 'state', 'event', 'sdk', p.script_js);
          fn(ctx, width, height, p.config || {}, st, { type: hookName, payload }, sdk);
        } catch (err) {
          console.error('[Overlay Plugin Error]', p.id, err);
        }
      }
    };

    if (lastWsEvent.type === 'chat_message') {
      const msg: ChatMessage = lastWsEvent.payload;
      const av = avatarsRef.current.get(msg.username);
      if (av) {
        av.bubble = msg.text;
        av.bubbleUntil = Date.now() + 4500;
      }
      runPluginHook('on_chat', msg);
    } else if (lastWsEvent.type === 'new_event') {
      runPluginHook('on_donation', lastWsEvent.payload);
    } else if (lastWsEvent.type === 'plugin_triggered') {
      runPluginHook('on_trigger', lastWsEvent.payload.data);
    } else if (lastWsEvent.type === 'avatar_action') {
      const { username, action } = lastWsEvent.payload;
      avatarsRef.current.forEach((av, key) => {
        if (username === '*' || key === username) {
          if (action === 'jump') av.vy = -10.5;
          if (action === 'dance') av.danceUntil = Date.now() + 4200;
          if (action === 'fart') sdk.spawnParticles(av.x, av.y - 10, 14, '#84CC16');
          if (action === 'bomb') sdk.spawnParticles(av.x, av.y - 16, 26, '#EF4444');
          if (action === 'hug') sdk.spawnParticles(av.x, av.y - 24, 14, '#F472B6');
          if (action === 'attack') av.vy = -6;
        }
      });
    } else if (lastWsEvent.type === 'minigame_started') {
      const kind = lastWsEvent.payload.kind;
      avatarsRef.current.forEach((av) => {
        av.hp = 100;
        av.alive = true;
        av.vy = -7;
      });
      if (kind === 'star_catch') {
        starsDropRef.current = Array.from({ length: 10 }, () => ({
          x: 60 + Math.random() * Math.max(200, width - 120),
          y: -20 - Math.random() * 160,
          vy: 1.4 + Math.random() * 1.4,
        }));
      }
    }
  }, [lastWsEvent]);

  // Основной цикл 60 FPS для Canvas-плагинов и физики Stream Avatars
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = Math.max(480, Math.round(rect.width));
        canvas.height = Math.max(270, Math.round(rect.height));
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const sdk = {
      spawnParticles: (x: number, y: number, count = 20, color = '#FBBF24') => {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1.4 + Math.random() * 3.8;
          particlesRef.current.push({
            x,
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 1.8,
            life: 1,
            color,
            r: 2 + Math.random() * 2.8,
          });
        }
      },
    };

    const tick = () => {
      const w = canvas.width;
      const h = canvas.height;
      const snap = snapshotRef.current;
      const now = Date.now();
      ctx.clearRect(0, 0, w, h);

      // 1. Запуск on_tick активных плагинов оверлея (Звёздочки, пользовательские скрипты)
      for (const p of snap.plugins) {
        if (!p.enabled || !p.hooks.includes('on_tick')) continue;
        try {
          const st = pluginStatesRef.current[p.id] || (pluginStatesRef.current[p.id] = {});
          const fn = new Function('ctx', 'width', 'height', 'cfg', 'state', 'event', 'sdk', p.script_js);
          fn(ctx, w, h, p.config || {}, st, null, sdk);
        } catch {
          // Изоляция ошибок плагина
        }
      }

      // 2. Общие частицы (взрывы, слова-триггеры, эффекты)
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const pt = particlesRef.current[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.12;
        pt.life -= 0.022;
        if (pt.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = pt.life;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 3. Платформы арены Stream Avatars
      if (snap.arena.enabled) {
        ctx.save();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
        for (const pl of snap.arena.platforms) {
          const px = (pl.x_pct / 100) * w;
          const py = (pl.y_pct / 100) * h;
          const pw = (pl.width_pct / 100) * w;
          ctx.fillRect(px, py, pw, 6);
          ctx.strokeRect(px, py, pw, 6);
        }
        ctx.restore();
      }

      // 4. Падающие призовые звёзды для мини-игры Star Catch
      if (snap.arena.active_minigame === 'star_catch') {
        for (let i = starsDropRef.current.length - 1; i >= 0; i--) {
          const st = starsDropRef.current[i];
          st.y += st.vy;
          ctx.save();
          ctx.fillStyle = '#FACC15';
          ctx.beginPath();
          ctx.arc(st.x, st.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          avatarsRef.current.forEach((av) => {
            if (Math.hypot(av.x - st.x, av.y - 16 - st.y) < 22) {
              sdk.spawnParticles(st.x, st.y, 14, '#FACC15');
              st.y = -20;
              st.x = 50 + Math.random() * Math.max(150, w - 100);
            }
          });
          if (st.y > h) {
            st.y = -20;
            st.x = 50 + Math.random() * Math.max(150, w - 100);
          }
        }
      }

      // 5. Мини-игра Boss Fight / Battle Royale индикатор на арене
      if (snap.arena.active_minigame === 'boss_fight') {
        ctx.save();
        const bx = w * 0.5;
        const by = h - 72;
        ctx.fillStyle = '#DC2626';
        ctx.beginPath();
        ctx.arc(bx, by, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FEF2F2';
        ctx.font = '700 11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`БОСС: ${snap.arena.boss_name}`, bx, by - 34);
        ctx.restore();
      }

      // 6. Физика и отрисовка «чоков» Stream Avatars
      if (snap.arena.enabled) {
        const floorY = h - 24;
        const scale = snap.arena.avatar_scale || 1;
        avatarsRef.current.forEach((av) => {
          av.x += av.vx * (snap.arena.move_speed / 2);
          av.vy += snap.arena.gravity;
          av.y += av.vy;

          // Проверка коллизий с платформами сверху
          for (const pl of snap.arena.platforms) {
            const px = (pl.x_pct / 100) * w;
            const py = (pl.y_pct / 100) * h;
            const pw = (pl.width_pct / 100) * w;
            if (av.vy >= 0 && av.x >= px && av.x <= px + pw && av.y >= py && av.y <= py + 12) {
              av.y = py;
              av.vy = 0;
            }
          }

          if (av.y >= floorY) {
            av.y = floorY;
            av.vy = 0;
            if (Math.random() < 0.008) av.vy = -7.5;
          }
          if (av.x < 28 || av.x > w - 28) av.vx *= -1;

          const hop = av.danceUntil > now ? Math.abs(Math.sin(now * 0.015)) * 10 : 0;
          const r = 13 * scale;
          const cy = av.y - r - hop;

          ctx.save();
          // Крылья (gear: wings)
          if (av.gear.includes('wings')) {
            ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
            ctx.beginPath();
            ctx.ellipse(av.x - r - 4, cy, 8, 5, -0.3, 0, Math.PI * 2);
            ctx.ellipse(av.x + r + 4, cy, 8, 5, 0.3, 0, Math.PI * 2);
            ctx.fill();
          }

          // Тело аватара
          ctx.fillStyle = av.color;
          ctx.beginPath();
          ctx.arc(av.x, cy, r, 0, Math.PI * 2);
          ctx.fill();

          // Глазки
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(av.x - 5, cy - 3, 3, 3);
          ctx.fillRect(av.x + 2, cy - 3, 3, 3);

          // Очки (gear: visor)
          if (av.gear.includes('visor')) {
            ctx.fillStyle = '#0EA5E9';
            ctx.fillRect(av.x - 7, cy - 4, 14, 4);
          }

          // Корона (gear: crown)
          if (av.gear.includes('crown')) {
            ctx.fillStyle = '#FACC15';
            ctx.beginPath();
            ctx.moveTo(av.x - 7, cy - r);
            ctx.lineTo(av.x - 4, cy - r - 7);
            ctx.lineTo(av.x, cy - r - 2);
            ctx.lineTo(av.x + 4, cy - r - 7);
            ctx.lineTo(av.x + 7, cy - r);
            ctx.closePath();
            ctx.fill();
          }

          // Неймтег и ник
          ctx.font = '600 10px DM Sans, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#F8FAFC';
          const tagPrefix = av.nametag ? `[${av.nametag}] ` : '';
          ctx.fillText(`${tagPrefix}${av.username}`, av.x, av.y + 12);

          // Облачко сообщения над головой
          if (av.bubble && av.bubbleUntil > now) {
            const label = av.bubble.length > 24 ? av.bubble.slice(0, 23) + '…' : av.bubble;
            const bw = Math.max(76, label.length * 6.5 + 16);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.fillRect(av.x - bw / 2, cy - r - 30, bw, 20);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.strokeRect(av.x - bw / 2, cy - r - 30, bw, 20);
            ctx.fillStyle = '#F8FAFC';
            ctx.fillText(label, av.x, cy - r - 17);
          }
          ctx.restore();
        });
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Глобальное перетаскивание виджетов и кастомных элементов в режиме макета
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const dxPct = ((e.clientX - dragState.startClientX) / Math.max(1, rect.width)) * 100;
      const dyPct = ((e.clientY - dragState.startClientY) / Math.max(1, rect.height)) * 100;
      const nextX = Math.max(0, Math.min(95, Math.round((dragState.origXPct + dxPct) * 10) / 10));
      const nextY = Math.max(0, Math.min(95, Math.round((dragState.origYPct + dyPct) * 10) / 10));
      setDragState((prev) => (prev ? { ...prev, currXPct: nextX, currYPct: nextY } : null));
    };
    const onUp = () => {
      if (apiPost) {
        if (dragState.kind === 'widget') {
          const updated = snapshotRef.current.layouts.map((w) =>
            w.widget_id === dragState.id ? { ...w, x_pct: dragState.currXPct, y_pct: dragState.currYPct } : w,
          );
          void apiPost('/api/layouts', updated);
        } else {
          const updated = snapshotRef.current.custom_elements.map((el) =>
            el.id === dragState.id ? { ...el, x_pct: dragState.currXPct, y_pct: dragState.currYPct } : el,
          );
          void apiPost('/api/overlay/elements', updated);
        }
      }
      setDragState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, apiPost]);

  const layoutMap = Object.fromEntries(snapshot.layouts.map((l) => [l.widget_id, l]));
  const getCoords = (kind: 'widget' | 'element', id: string, fallbackX: number, fallbackY: number) => {
    if (dragState && dragState.kind === kind && dragState.id === id) {
      return { x: dragState.currXPct, y: dragState.currYPct };
    }
    return { x: fallbackX, y: fallbackY };
  };

  const startDrag = (kind: 'widget' | 'element', id: string, x: number, y: number, e: React.PointerEvent) => {
    if (!layoutEditMode) return;
    e.stopPropagation();
    setDragState({
      kind,
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXPct: x,
      origYPct: y,
      currXPct: x,
      currYPct: y,
    });
  };

  const visibleGoals = (snapshot.goals && snapshot.goals.length > 0 ? snapshot.goals : [snapshot.goal]).filter(
    (g) => g.visible !== false,
  );

  const feedCfg = snapshot.feed_config || {
    title: 'Последние донаты',
    max_items: 4,
    min_amount: 0,
    show_time: false,
    show_source: false,
    row_template: '{user} · {amount} {currency}',
  };
  const filteredFeedEvents = snapshot.recent_events
    .filter((ev) => ev.amount >= (feedCfg.min_amount || 0))
    .slice(-(feedCfg.max_items || 4))
    .reverse();

  const matchedVariation: AlertVariation | undefined = activeAlert
    ? snapshot.alert_variations.find((v) => v.id === activeAlert.variation_id) ||
      snapshot.alert_variations.find((v) => v.enabled)
    : undefined;

  const dragClass = layoutEditMode
    ? 'pointer-events-auto cursor-move ring-1 ring-blue-400/70'
    : 'pointer-events-none';

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 shrink-0">
        <div className="flex items-center gap-2 truncate">
          <span className="font-medium text-slate-100">Предпросмотр OBS (/overlay)</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-slate-400">Сцена: {snapshot.obs.active_scene}</span>
          {snapshot.arena.active_minigame !== 'none' && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400 font-medium">Игра: {snapshot.arena.active_minigame}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {onToggleLayoutEdit && (
            <button
              type="button"
              onClick={onToggleLayoutEdit}
              className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                layoutEditMode ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {layoutEditMode ? 'Готово (Drag)' : 'Двигать макет'}
            </button>
          )}
          <span className="text-slate-400 hidden sm:inline">{soundMuted ? 'Звук выкл' : 'Звук вкл'}</span>
          <a
            href={resolveApiUrl('/overlay')}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
          >
            Открыть слой OBS
          </a>
        </div>
      </div>

      {/* Эфирное полотно 16:9 с имитацией игровой сцены под прозрачным оверлеем */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{
          background:
            'radial-gradient(circle at 22% 28%, rgba(37, 99, 235, 0.16), transparent 48%), radial-gradient(circle at 80% 72%, rgba(16, 185, 129, 0.12), transparent 44%), #070B12',
          color: overlayTheme.text_primary,
        }}
        onClick={(e) => {
          if (layoutEditMode) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          avatarsRef.current.forEach((av) => {
            if (Math.abs(av.x - cx) < 60) av.vy = -9;
          });
          particlesRef.current.push({
            x: cx,
            y: cy,
            vx: 0,
            vy: -1.5,
            life: 0.9,
            color: overlayTheme.accent_color,
            r: 4,
          });
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-20" />

        {/* Кастомные элементы конструктора оверлея (картинки / HTML / CSS) */}
        {(snapshot.custom_elements || [])
          .filter((el: CustomOverlayElement) => el.visible)
          .map((el) => {
            const pos = getCoords('element', el.id, el.x_pct, el.y_pct);
            return (
              <div
                key={el.id}
                onPointerDown={(e) => startDrag('element', el.id, el.x_pct, el.y_pct, e)}
                className={`absolute ${dragClass}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  width: `${el.width_px || 160}px`,
                  zIndex: el.z_index || 28,
                  ...parseInlineCss(el.css),
                }}
              >
                {el.image_url && (
                  <img src={resolveAssetUrl(el.image_url)} alt={el.name} className="w-full h-auto block rounded-lg pointer-events-none" />
                )}
                {el.html && <div dangerouslySetInnerHTML={{ __html: el.html }} />}
              </div>
            );
          })}

        {/* Виджет: Цели сборов */}
        {layoutMap.goal?.visible && visibleGoals.length > 0 && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'goal', layoutMap.goal.x_pct, layoutMap.goal.y_pct, e)
            }
            className={`absolute px-3 py-2 w-56 z-10 space-y-1.5 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'goal', layoutMap.goal.x_pct, layoutMap.goal.y_pct).x}%`,
              top: `${getCoords('widget', 'goal', layoutMap.goal.x_pct, layoutMap.goal.y_pct).y}%`,
              transform: `scale(${layoutMap.goal.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.goal.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            {visibleGoals.map((g) => {
              const pct = Math.min(100, Math.round((g.current / Math.max(1, g.target)) * 100));
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between text-[11px] font-medium mb-0.5">
                    <span className="truncate">{g.title}</span>
                    <span className="font-mono tabular-nums ml-2 shrink-0">
                      {Math.round(g.current)}/{Math.round(g.target)}
                      {g.unit}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: g.color || overlayTheme.accent_color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Виджет: Subathon-таймер */}
        {layoutMap.subathon?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'subathon', layoutMap.subathon.x_pct, layoutMap.subathon.y_pct, e)
            }
            className={`absolute px-3 py-1.5 z-10 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'subathon', layoutMap.subathon.x_pct, layoutMap.subathon.y_pct).x}%`,
              top: `${getCoords('widget', 'subathon', layoutMap.subathon.x_pct, layoutMap.subathon.y_pct).y}%`,
              transform: `scale(${layoutMap.subathon.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.subathon.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            <div className="text-[10px]" style={{ color: overlayTheme.text_muted }}>
              Subathon {snapshot.subathon.running ? 'идёт' : 'пауза'}
            </div>
            <div className="font-mono tabular-nums text-base font-bold">
              {formatClock(snapshot.subathon.remaining_seconds)}
            </div>
          </div>
        )}

        {/* Виджет: Лента последних донатов */}
        {layoutMap.alerts_list?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'alerts_list', layoutMap.alerts_list.x_pct, layoutMap.alerts_list.y_pct, e)
            }
            className={`absolute px-3 py-2 w-56 z-10 text-[11px] ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'alerts_list', layoutMap.alerts_list.x_pct, layoutMap.alerts_list.y_pct).x}%`,
              top: `${getCoords('widget', 'alerts_list', layoutMap.alerts_list.x_pct, layoutMap.alerts_list.y_pct).y}%`,
              transform: `scale(${layoutMap.alerts_list.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.alerts_list.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            <div className="text-[10px] mb-1 truncate" style={{ color: overlayTheme.text_muted }}>
              {feedCfg.title} · Босс: {snapshot.stream_boss.boss_name}
            </div>
            {filteredFeedEvents.map((ev) => (
              <div key={ev.id} className="flex justify-between gap-2 py-0.5 border-b border-white/10 last:border-0">
                <span className="truncate">
                  {feedCfg.show_source && <span className="opacity-60 mr-1">[{ev.source}]</span>}
                  {ev.username}
                </span>
                <span className="font-mono tabular-nums shrink-0">
                  {Math.round(ev.amount)} {ev.currency}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Виджет: Мультичат на оверлее с 7TV/BTTV/FFZ смайликами и живым переводом */}
        {layoutMap.chat?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'chat', layoutMap.chat.x_pct, layoutMap.chat.y_pct, e)
            }
            className={`absolute px-3 py-2 w-64 max-h-44 overflow-hidden z-10 flex flex-col gap-1 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'chat', layoutMap.chat.x_pct, layoutMap.chat.y_pct).x}%`,
              top: `${getCoords('widget', 'chat', layoutMap.chat.x_pct, layoutMap.chat.y_pct).y}%`,
              transform: `scale(${layoutMap.chat.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.chat.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            {snapshot.chat_history.slice(-5).map((m) => {
              const emoteMap = new Map((snapshot.emotes || []).map((e) => [e.code, e.url]));
              return (
                <div key={m.id} className="text-[11px] leading-snug">
                  <span className="opacity-60 mr-1">[{m.platform}]</span>
                  <span className="font-semibold mr-1" style={{ color: m.color }}>
                    {m.username}:
                  </span>
                  <span>
                    {m.text.split(/(\s+)/).map((tok, idx) => {
                      const url = emoteMap.get(tok);
                      if (url) {
                        return (
                          <img
                            key={idx}
                            src={url}
                            alt={tok}
                            title={tok}
                            className="inline-block h-4 w-auto align-middle mx-0.5"
                          />
                        );
                      }
                      return <React.Fragment key={idx}>{tok}</React.Fragment>;
                    })}
                  </span>
                  {m.translated_text && (
                    <span className="ml-1 text-[10px] text-sky-400">[{m.translated_text}]</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Виджет: Hype Train и Счётчики игры (Смерти / Победы) */}
        {layoutMap.counters?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'counters', layoutMap.counters.x_pct, layoutMap.counters.y_pct, e)
            }
            className={`absolute px-3 py-2 w-48 z-10 text-[11px] space-y-1.5 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'counters', layoutMap.counters.x_pct, layoutMap.counters.y_pct).x}%`,
              top: `${getCoords('widget', 'counters', layoutMap.counters.x_pct, layoutMap.counters.y_pct).y}%`,
              transform: `scale(${layoutMap.counters.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.counters.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            {snapshot.hype_train?.active && (
              <div>
                <div className="flex items-center justify-between text-[10px] font-bold text-amber-400 mb-0.5">
                  <span>🚂 Hype Train Ур.{snapshot.hype_train.level}</span>
                  <span className="font-mono tabular-nums">
                    {Math.min(
                      100,
                      Math.round(
                        ((snapshot.hype_train.current_points || 0) /
                          Math.max(1, snapshot.hype_train.goal_points || 500)) *
                          100,
                      ),
                    )}
                    %
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((snapshot.hype_train.current_points || 0) /
                            Math.max(1, snapshot.hype_train.goal_points || 500)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between font-semibold">
              <span>
                💀 Смерти:{' '}
                <strong className="font-mono tabular-nums">{snapshot.game_counters?.deaths ?? 0}</strong>
              </span>
              <span>
                🏆 W/L:{' '}
                <strong className="font-mono tabular-nums">
                  {snapshot.game_counters?.wins ?? 0}/{snapshot.game_counters?.losses ?? 0}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Виджет: Слоёный 2D PNGTuber-аватар с липсинком от микрофона */}
        {layoutMap.pngtuber?.visible && snapshot.pngtuber?.enabled && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'pngtuber', layoutMap.pngtuber.x_pct, layoutMap.pngtuber.y_pct, e)
            }
            className={`absolute z-30 text-center ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'pngtuber', layoutMap.pngtuber.x_pct, layoutMap.pngtuber.y_pct).x}%`,
              top: `${getCoords('widget', 'pngtuber', layoutMap.pngtuber.x_pct, layoutMap.pngtuber.y_pct).y}%`,
              transform: `scale(${layoutMap.pngtuber.scale})`,
              transformOrigin: 'top left',
            }}
          >
            <div
              className={`transition-transform duration-100 ${
                snapshot.pngtuber.talking || snapshot.pngtuber.emotion === 'happy'
                  ? '-translate-y-1.5 scale-105'
                  : ''
              }`}
            >
              {(() => {
                const pt = snapshot.pngtuber;
                const customUrl = pt.talking
                  ? pt.talk_url || pt.idle_url
                  : pt.emotion === 'happy'
                  ? pt.happy_url || pt.idle_url
                  : pt.idle_url;
                if (customUrl) {
                  return (
                    <img
                      src={resolveAssetUrl(customUrl)}
                      alt={pt.name}
                      className="w-24 h-24 object-contain mx-auto pointer-events-none"
                    />
                  );
                }
                const earColor = pt.emotion === 'happy' ? '#F59E0B' : '#38BDF8';
                const mouthH = pt.talking ? 10 : pt.emotion === 'happy' ? 7 : 2;
                return (
                  <svg width="88" height="88" viewBox="0 0 96 96" className="mx-auto drop-shadow">
                    <polygon points="16,38 28,10 42,34" fill={earColor} />
                    <polygon points="80,38 68,10 54,34" fill={earColor} />
                    <circle cx="48" cy="54" r="30" fill="#1E293B" stroke={earColor} strokeWidth="3" />
                    <circle cx="37" cy="48" r="4.5" fill="#38BDF8" />
                    <circle cx="59" cy="48" r="4.5" fill="#38BDF8" />
                    <rect x="40" y="62" width="16" height={mouthH} rx="4" fill="#F43F5E" />
                  </svg>
                );
              })()}
              <div className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900/80 text-slate-100 inline-block">
                {snapshot.pngtuber.name}
                {snapshot.pngtuber.talking && <span className="ml-1 text-emerald-400">● MIC</span>}
              </div>
            </div>
          </div>
        )}

        {/* Виджет: Всплывающий алерт доната с поддержкой условных вариаций и медиа */}
        {(activeAlert || layoutEditMode) && layoutMap.alerts?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'alerts', layoutMap.alerts.x_pct, layoutMap.alerts.y_pct, e)
            }
            className={`absolute px-4 py-2.5 min-w-[260px] max-w-[380px] text-center z-40 transition-all duration-300 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'alerts', layoutMap.alerts.x_pct, layoutMap.alerts.y_pct).x}%`,
              top: `${getCoords('widget', 'alerts', layoutMap.alerts.x_pct, layoutMap.alerts.y_pct).y}%`,
              transform: `translate(-50%, 0) scale(${layoutMap.alerts.scale})`,
              ...getWrapperStyle(
                layoutMap.alerts.wrapper_preset,
                matchedVariation?.accent_color || overlayTheme.accent_color,
                matchedVariation?.bg_color || overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
              ...(matchedVariation
                ? {
                    background: matchedVariation.bg_color,
                    borderColor: matchedVariation.accent_color,
                  }
                : {}),
            }}
          >
            {matchedVariation?.image_url && (
              <img
                src={resolveAssetUrl(matchedVariation.image_url)}
                alt=""
                className="max-h-24 mx-auto mb-1.5 rounded object-contain"
              />
            )}
            <div
              className="text-sm font-bold"
              style={{ color: matchedVariation?.accent_color || overlayTheme.accent_color }}
            >
              {activeAlert
                ? matchedVariation
                  ? formatAlertTpl(matchedVariation.title_template, activeAlert)
                  : `${activeAlert.username} · ${Math.round(activeAlert.amount)} ${activeAlert.currency}`
                : 'Окно алертов (Drag)'}
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: matchedVariation?.text_color || overlayTheme.text_primary }}
            >
              {activeAlert ? activeAlert.message || 'Спасибо за поддержку!' : 'Позиция всплывающих донатов'}
            </div>
          </div>
        )}

        {/* Виджет: Колесо фортуны */}
        {wheelResult && Date.now() - wheelResult.ts < 6000 && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-5 py-3 z-40 text-center pointer-events-none"
            style={getWrapperStyle('neon_frame', overlayTheme.accent_color, overlayTheme.bg_surface, overlayTheme.border_color)}
          >
            <div className="text-[11px]" style={{ color: overlayTheme.text_muted }}>
              Колесо фортуны выбрало
            </div>
            <div className="text-base font-bold mt-0.5">{wheelResult.label}</div>
          </div>
        )}

        {/* Виджет: Автовоспроизводимый плеер Media Share (YouTube / VK / Audio) */}
        {(() => {
          const activeMedia = (snapshot.media_queue || []).find(
            (m) => m.status === 'playing' || m.status === 'paused',
          );
          if (!layoutMap.media_share?.visible || (!activeMedia && !layoutEditMode)) return null;
          const pct = activeMedia
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    ((activeMedia.duration_sec - activeMedia.remaining_sec) /
                      Math.max(1, activeMedia.duration_sec)) *
                      100,
                  ),
                ),
              )
            : 40;
          return (
            <div
              onPointerDown={(e) =>
                startDrag(
                  'widget',
                  'media_share',
                  layoutMap.media_share.x_pct,
                  layoutMap.media_share.y_pct,
                  e,
                )
              }
              className={`absolute px-3 py-2 w-60 z-30 text-[11px] space-y-1.5 ${dragClass}`}
              style={{
                left: `${
                  getCoords(
                    'widget',
                    'media_share',
                    layoutMap.media_share.x_pct,
                    layoutMap.media_share.y_pct,
                  ).x
                }%`,
                top: `${
                  getCoords(
                    'widget',
                    'media_share',
                    layoutMap.media_share.x_pct,
                    layoutMap.media_share.y_pct,
                  ).y
                }%`,
                transform: `scale(${layoutMap.media_share.scale})`,
                transformOrigin: 'top left',
                ...getWrapperStyle(
                  layoutMap.media_share.wrapper_preset,
                  overlayTheme.accent_color,
                  overlayTheme.bg_surface,
                  overlayTheme.border_color,
                ),
              }}
            >
              <div className="flex items-center justify-between font-bold text-[10px] text-emerald-400">
                <span>
                  🎬 MEDIA SHARE ({activeMedia?.media_kind?.toUpperCase() || 'YOUTUBE'}) ·{' '}
                  {snapshot.audio_mixer?.master_muted || snapshot.audio_mixer?.media_muted
                    ? 'MUTE'
                    : `${Math.round(
                        ((snapshot.audio_mixer?.master_volume ?? 100) / 100) *
                          (snapshot.audio_mixer?.media_volume ?? 100),
                      )}%`}
                </span>
                <span className="font-mono tabular-nums">
                  {activeMedia ? `${activeMedia.remaining_sec}с` : '60с'}
                </span>
              </div>
              <div className="truncate font-semibold">
                {activeMedia ? activeMedia.title : 'Плеер Media Share (Drag)'}
              </div>
              <div className="text-[10px] opacity-75 truncate">
                Отправил: {activeMedia ? `${activeMedia.donor} (${Math.round(activeMedia.amount_rub)} ₽)` : 'AlexStream'}
              </div>
              <div className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        {/* Виджет: Тотализатор и пари StreamElements (!bet) */}
        {layoutMap.prediction?.visible && (snapshot.prediction?.active || layoutEditMode) && (
          <div
            onPointerDown={(e) =>
              startDrag(
                'widget',
                'prediction',
                layoutMap.prediction.x_pct,
                layoutMap.prediction.y_pct,
                e,
              )
            }
            className={`absolute px-3 py-2 w-60 z-25 text-[11px] space-y-1 ${dragClass}`}
            style={{
              left: `${
                getCoords(
                  'widget',
                  'prediction',
                  layoutMap.prediction.x_pct,
                  layoutMap.prediction.y_pct,
                ).x
              }%`,
              top: `${
                getCoords(
                  'widget',
                  'prediction',
                  layoutMap.prediction.x_pct,
                  layoutMap.prediction.y_pct,
                ).y
              }%`,
              transform: `scale(${layoutMap.prediction.scale})`,
              transformOrigin: 'top left',
              ...getWrapperStyle(
                layoutMap.prediction.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-violet-400">
              <span>🎲 ПАРИ (!bet 1 / 2)</span>
              <span>{snapshot.prediction?.locked ? '🔒 ЗАКРЫТО' : '🟢 ОТКРЫТО'}</span>
            </div>
            <div className="font-semibold truncate">{snapshot.prediction?.title}</div>
            {(snapshot.prediction?.outcomes || []).map((o) => (
              <div key={o.id} className="flex items-center justify-between text-[10px]">
                <span className="truncate">
                  #{o.id} {o.label}
                </span>
                <span className="font-mono tabular-nums font-bold text-amber-300 ml-2">
                  {o.pool}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Виджет: Слот-машина (!slots) при недавнем вращении */}
        {snapshot.last_slots_spin &&
          Date.now() - Date.parse(snapshot.last_slots_spin.ts) < 9000 && (
            <div
              className="absolute left-1/2 top-[34%] -translate-x-1/2 px-4 py-2.5 z-40 text-center pointer-events-none"
              style={getWrapperStyle(
                'neon_frame',
                '#F59E0B',
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              )}
            >
              <div className="text-[10px] font-bold text-amber-400">
                🎰 СЛОТЫ @{snapshot.last_slots_spin.username}
              </div>
              <div className="text-xl my-1 tracking-widest">
                {snapshot.last_slots_spin.reels.join(' · ')}
              </div>
              <div className="text-[11px] font-mono tabular-nums">
                {snapshot.last_slots_spin.multiplier > 0
                  ? `ДЖЕКПОТ +${snapshot.last_slots_spin.payout} (x${snapshot.last_slots_spin.multiplier})`
                  : `Ставка ${snapshot.last_slots_spin.wager} — мимо`}
              </div>
            </div>
          )}

        {/* Виджет: Бегущая строка (Ticker) и Экранный таймер («Скоро начнём») */}
        {layoutMap.ticker?.visible && snapshot.ticker?.enabled && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'ticker', layoutMap.ticker.x_pct, layoutMap.ticker.y_pct, e)
            }
            className={`absolute left-0 right-0 px-3 py-1 z-30 flex items-center justify-between gap-3 text-[11px] ${dragClass}`}
            style={{
              top: `${
                getCoords('widget', 'ticker', layoutMap.ticker.x_pct, layoutMap.ticker.y_pct).y
              }%`,
              background: 'rgba(9, 13, 28, 0.88)',
              borderTop: `1px solid ${overlayTheme.border_color}`,
            }}
          >
            {snapshot.ticker.countdown_active && (
              <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-mono tabular-nums font-bold shrink-0">
                ⏱ {snapshot.ticker.countdown_label}:{' '}
                {formatClock(snapshot.ticker.countdown_remaining_sec)}
              </span>
            )}
            <div className="truncate text-slate-200 font-medium">
              {snapshot.ticker.custom_text}
            </div>
          </div>
        )}

        {/* Виджет: Субтитры Whisper */}
        {(activeSubtitle || layoutEditMode) && layoutMap.subtitles?.visible && (
          <div
            onPointerDown={(e) =>
              startDrag('widget', 'subtitles', layoutMap.subtitles.x_pct, layoutMap.subtitles.y_pct, e)
            }
            className={`absolute px-4 py-1.5 max-w-[80%] text-center text-sm font-medium z-30 ${dragClass}`}
            style={{
              left: `${getCoords('widget', 'subtitles', layoutMap.subtitles.x_pct, layoutMap.subtitles.y_pct).x}%`,
              top: `${getCoords('widget', 'subtitles', layoutMap.subtitles.x_pct, layoutMap.subtitles.y_pct).y}%`,
              transform: `translate(-50%, 0) scale(${layoutMap.subtitles.scale})`,
              ...getWrapperStyle(
                layoutMap.subtitles.wrapper_preset,
                overlayTheme.accent_color,
                overlayTheme.bg_surface,
                overlayTheme.border_color,
              ),
            }}
          >
            {activeSubtitle || 'Субтитры Whisper (Drag)'}
          </div>
        )}
      </div>
    </div>
  );
};

