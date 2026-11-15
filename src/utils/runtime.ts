import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { HotkeyBinding } from '../types/stream.ts';

export type PopoutModuleId = 'chat' | 'obs_dock' | 'mixer' | 'agent_feed';
export type AppWindowMode = 'studio' | PopoutModuleId | 'donate';

export interface PopoutModuleMeta {
  id: PopoutModuleId;
  title: string;
  subtitle: string;
}

export const POPOUT_MODULES: PopoutModuleMeta[] = [
  {
    id: 'chat',
    title: 'Мультичат',
    subtitle: 'Чат площадок, @bot, фильтры и смайлики',
  },
  {
    id: 'obs_dock',
    title: 'OBS Dock',
    subtitle: 'Сцены, Media Share, лента донатов и быстрый чат',
  },
  {
    id: 'mixer',
    title: 'Микшер и Хоткеи',
    subtitle: '4-канальный аудио-микшер и глобальные клавиши',
  },
  {
    id: 'agent_feed',
    title: 'ИИ-Агент и Лента',
    subtitle: 'Локальный ИИ-режиссёр и лента событий эфира',
  },
];

interface ServerInfo {
  http_origin: string;
  ws_url: string;
  host: string;
  port: number;
}

let cachedHttpOrigin = '';
let cachedWsUrl = '';
let initPromise: Promise<void> | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getWindowLabel(): string {
  if (!isTauriRuntime()) return 'browser';
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
}

function getBrowserHttpOrigin(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8080';
  return window.location.origin;
}

function getBrowserWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8080/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export async function initRuntime(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (isTauriRuntime()) {
      try {
        const info = await invoke<ServerInfo>('get_server_info');
        cachedHttpOrigin = info.http_origin;
        cachedWsUrl = info.ws_url;
        return;
      } catch (err) {
        console.error('[Runtime] Не удалось получить адрес встроенного сервера Tauri:', err);
      }
    }
    cachedHttpOrigin = getBrowserHttpOrigin();
    cachedWsUrl = getBrowserWsUrl();
  })();
  return initPromise;
}

export function getServerHttpOrigin(): string {
  return cachedHttpOrigin || getBrowserHttpOrigin();
}

export function getServerWsUrl(): string {
  return cachedWsUrl || getBrowserWsUrl();
}

export function resolveApiUrl(path: string): string {
  if (!path) return path;
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  ) {
    return path;
  }
  const base = getServerHttpOrigin().replace(/\/$/, '');
  const norm = path.startsWith('/') ? path : `/${path}`;
  return `${base}${norm}`;
}

export function resolveAssetUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('/')) {
    return resolveApiUrl(url);
  }
  return url;
}

const BROADCAST_CHANNEL = 'pulsecast_windows_sync';
const browserDetachedSet = new Set<PopoutModuleId>();

function broadcastBrowserDetached() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.postMessage({
      type: 'windows_changed',
      detached: Array.from(browserDetachedSet),
    });
    ch.close();
  } catch {
    // Игнорируем ограничения BroadcastChannel
  }
}

export function notifyBrowserPopoutLifecycle(moduleId: PopoutModuleId, active: boolean) {
  if (isTauriRuntime()) return;
  if (active) browserDetachedSet.add(moduleId);
  else browserDetachedSet.delete(moduleId);
  broadcastBrowserDetached();
}

export async function getDetachedWindows(): Promise<PopoutModuleId[]> {
  if (isTauriRuntime()) {
    try {
      const list = await invoke<string[]>('get_detached_windows');
      return list.filter((x): x is PopoutModuleId =>
        x === 'chat' || x === 'obs_dock' || x === 'mixer' || x === 'agent_feed',
      );
    } catch {
      return [];
    }
  }
  return Array.from(browserDetachedSet);
}

export async function openPopoutWindow(moduleId: PopoutModuleId): Promise<PopoutModuleId[]> {
  if (isTauriRuntime()) {
    const list = await invoke<string[]>('open_popout_window', { moduleId });
    return list as PopoutModuleId[];
  }
  browserDetachedSet.add(moduleId);
  broadcastBrowserDetached();
  return Array.from(browserDetachedSet);
}

export async function dockPopoutWindow(
  moduleId: PopoutModuleId,
  focusMain = false,
): Promise<PopoutModuleId[]> {
  if (isTauriRuntime()) {
    const list = await invoke<string[]>('dock_popout_window', { moduleId, focusMain });
    return list as PopoutModuleId[];
  }
  browserDetachedSet.delete(moduleId);
  broadcastBrowserDetached();
  return Array.from(browserDetachedSet);
}

export function subscribeDetachedWindows(
  onChange: (modules: PopoutModuleId[]) => void,
): () => void {
  if (isTauriRuntime()) {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    void listen<string[]>('pulsecast://windows-changed', (event) => {
      const valid = (event.payload || []).filter(
        (x): x is PopoutModuleId =>
          x === 'chat' || x === 'obs_dock' || x === 'mixer' || x === 'agent_feed',
      );
      onChange(valid);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }

  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(BROADCAST_CHANNEL);
  ch.onmessage = (ev) => {
    const data = ev.data as { type?: string; detached?: PopoutModuleId[] } | undefined;
    if (data?.type === 'windows_changed' && Array.isArray(data.detached)) {
      browserDetachedSet.clear();
      data.detached.forEach((m) => browserDetachedSet.add(m));
      onChange(Array.from(browserDetachedSet));
    }
  };
  return () => ch.close();
}

export async function hideMainToTray(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('hide_main_to_tray');
}

export async function showMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('show_main_window');
}

export async function quitDesktopApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('quit_app');
}

export async function syncGlobalShortcutsToDesktop(hotkeys: HotkeyBinding[]): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('sync_global_shortcuts', {
      shortcuts: hotkeys.map((h) => ({
        id: h.id,
        combo: h.combo,
        enabled: h.enabled,
      })),
    });
  } catch (err) {
    console.warn('[Runtime] Ошибка синхронизации глобальных шорткатов:', err);
  }
}

export function subscribeGlobalShortcuts(onTriggerId: (hotkeyId: string) => void): () => void {
  if (!isTauriRuntime()) return () => {};
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<string>('pulsecast://global-shortcut', (event) => {
    if (event.payload) onTriggerId(event.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}
