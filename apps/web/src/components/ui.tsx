import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { dateLabel } from '../lib/format';

export function Panel({ title, action, children, className = '', dense = false }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; dense?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={dense ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, tone = 'default', icon, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: 'default' | 'warn' | 'bad' | 'good'; icon?: string; onClick?: () => void;
}) {
  const toneClass = {
    default: '', warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400', good: 'text-brand-600 dark:text-brand-500',
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`panel p-3 text-left w-full ${onClick ? 'card-hover cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-1.5 dim text-xs font-medium">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs dim mt-0.5">{sub}</div>}
    </Tag>
  );
}

export function EmptyState({ icon = 'circle', title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4">
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-3"
           style={{ background: 'var(--panel-alt)' }}>
        <Icon name={icon} size={20} className="dim" />
      </div>
      <p className="font-medium text-sm">{title}</p>
      {hint && <p className="dim text-sm mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 dim text-sm">
      <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      {label ?? 'Loading'}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: Error | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="panel p-4 flex items-start gap-3" style={{ borderColor: 'var(--color-ink-400)' }}>
      <Icon name="alert" className="text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="dim text-sm mt-0.5 break-words">{error.message}</p>
      </div>
      {retry && <button className="btn btn-sm" onClick={retry}>Retry</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: ReactNode;
  children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button');
    first?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
      style={{ background: 'rgba(0,0,0,.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true"
    >
      <div
        ref={ref}
        className={`panel w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col
                    rounded-b-none sm:rounded-xl`}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="p-4 overflow-y-auto scroll-thin flex-1">{children}</div>
        {footer && <footer className="px-4 py-3 border-t flex justify-end gap-2 shrink-0">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="text-xs dim mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export function DueChip({ date, status, today, done }: {
  date?: string | null; status?: string; today?: string; done?: boolean;
}) {
  if (!date) return <span className="chip">No date</span>;
  const t = today ?? new Date().toISOString().slice(0, 10);
  // A finished task is never late, whatever its due date said at the time.
  const state = done ? 'none' : status ?? (date < t ? 'overdue' : date === t ? 'due' : 'upcoming');
  const styles: Record<string, string> = {
    overdue: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    grace: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    due: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    due_soon: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
    upcoming: '', none: '',
  };
  return <span className={`chip ${styles[state] ?? ''}`}>{dateLabel(date, t)}</span>;
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const auto = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
  const colour = { good: 'var(--accent)', warn: '#d97706', bad: '#dc2626' }[tone ?? auto];
  return (
    <div className="h-1.5 rounded-full overflow-hidden w-full" style={{ background: 'var(--panel-alt)' }}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto scroll-thin border-b -mb-px" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            active === t.id ? 'border-current' : 'border-transparent dim hover:text-current'
          }`}
          style={active === t.id ? { color: 'var(--accent)' } : undefined}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-xs opacity-70 tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── toasts, with undo (GEN-019) ── */

interface Toast { id: number; message: string; undo?: () => void; tone?: 'error' | 'info' }
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t.undo ? 10000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,26rem)] no-print">
        {toasts.map((t) => (
          <div key={t.id}
               className="panel px-3 py-2.5 flex items-center gap-3 shadow-lg text-sm"
               style={t.tone === 'error' ? { borderColor: '#dc2626' } : undefined}>
            <span className="flex-1 min-w-0">{t.message}</span>
            {t.undo && (
              <button className="btn btn-sm" onClick={() => {
                t.undo?.();
                setToasts((cur) => cur.filter((x) => x.id !== t.id));
              }}>
                <Icon name="undo" size={13} /> Undo
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}
                    aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
