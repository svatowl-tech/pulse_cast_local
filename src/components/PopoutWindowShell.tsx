import React, { useEffect } from 'react';
import { notifyBrowserPopoutLifecycle, type PopoutModuleId } from '../utils/runtime.ts';

interface PopoutWindowShellProps {
  moduleId: PopoutModuleId;
  title: string;
  subtitle?: string;
  onDock: () => void;
  children: React.ReactNode;
}

export const PopoutWindowShell: React.FC<PopoutWindowShellProps> = ({
  moduleId,
  title,
  subtitle,
  onDock,
  children,
}) => {
  useEffect(() => {
    notifyBrowserPopoutLifecycle(moduleId, true);
    const onUnload = () => notifyBrowserPopoutLifecycle(moduleId, false);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      notifyBrowserPopoutLifecycle(moduleId, false);
    };
  }, [moduleId]);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <header className="h-11 shrink-0 px-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-display text-xs font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {title}
          </span>
          {subtitle && (
            <span className="hidden sm:inline text-[11px] text-slate-400 truncate">
              · {subtitle}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDock}
          className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors"
        >
          Вернуть в студию
        </button>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden p-3">
        {children}
      </main>
    </div>
  );
};
