import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useDebounced, useHotkey, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { Icon } from './Icon';
import { Modal, Field, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Today', icon: 'home', end: true },
  { to: '/tasks', label: 'Tasks', icon: 'check' },
  { to: '/maintenance', label: 'Maintenance', icon: 'wrench' },
  { to: '/projects', label: 'Projects', icon: 'hammer' },
  { to: '/budget', label: 'Budget', icon: 'coin' },
  { to: '/food', label: 'Food', icon: 'can' },
  { to: '/storage', label: 'Storage', icon: 'box' },
  { to: '/tools', label: 'Tools', icon: 'toolbox' },
  { to: '/pets', label: 'Pets', icon: 'paw' },
  { to: '/contacts', label: 'Contacts', icon: 'user' },
  { to: '/documents', label: 'Documents', icon: 'file' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/** The five things worth a thumb on a phone. */
const TABS = [
  { to: '/', label: 'Today', icon: 'home', end: true },
  { to: '/tasks', label: 'Tasks', icon: 'check' },
  { to: '/scan', label: 'Scan', icon: 'scan' },
  { to: '/food', label: 'Food', icon: 'can' },
  { to: '/more', label: 'More', icon: 'menu' },
];

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [menu, setMenu] = useState(false);

  useHotkey('/', () => setSearch(true));
  useHotkey('n', () => setQuickAdd(true));
  useEffect(() => { setMenu(false); }, [location.pathname]);

  const notifications = useQuery<{ unread: number }>('/notifications?unread=true&limit=1', [location.pathname]);

  return (
    <div className="h-full flex">
      {/* desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r no-print"
             style={{ background: 'var(--panel)' }}>
        <div className="px-4 py-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-white shrink-0"
                style={{ background: 'var(--accent)' }}>
            <Icon name="home" size={16} />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{app.household?.name ?? 'Homestead'}</div>
            <div className="text-[11px] dim truncate">{app.user?.displayName}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto scroll-thin px-2 pb-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                  isActive ? 'font-semibold' : 'dim hover:text-current'
                }`}
              style={({ isActive }) => (isActive ? { background: 'var(--panel-alt)', color: 'var(--text)' } : undefined)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t flex gap-1">
          <button className="btn btn-sm flex-1" onClick={() => setSearch(true)} title="Search (/)">
            <Icon name="search" size={13} /> Search
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* top bar */}
        <header className="lg:hidden flex items-center gap-2 px-3 h-14 border-b shrink-0 no-print"
                style={{ background: 'var(--panel)' }}>
          <span className="w-7 h-7 rounded-lg grid place-items-center text-white shrink-0"
                style={{ background: 'var(--accent)' }}>
            <Icon name="home" size={15} />
          </span>
          <span className="font-semibold text-sm truncate flex-1">{app.household?.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSearch(true)} aria-label="Search">
            <Icon name="search" />
          </button>
          <NotificationBell count={notifications.data?.unread ?? 0} />
        </header>

        <header className="hidden lg:flex items-center gap-2 px-6 h-14 border-b shrink-0 no-print"
                style={{ background: 'var(--panel)' }}>
          <div className="flex-1" />
          <button className="btn btn-sm" onClick={() => setQuickAdd(true)}>
            <Icon name="plus" size={13} /> Quick add
            <kbd className="ml-1 text-[10px] dim border rounded px-1">n</kbd>
          </button>
          <NotificationBell count={notifications.data?.unread ?? 0} />
        </header>

        <main className="flex-1 overflow-y-auto scroll-thin pb-20 lg:pb-0">
          <div className="max-w-6xl mx-auto p-4 lg:p-6">{children}</div>
        </main>

        {/* mobile tab bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 border-t flex no-print z-40"
             style={{ background: 'var(--panel)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {TABS.map((tab) => tab.to === '/more' ? (
            <button key="more" onClick={() => setMenu(true)}
                    className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] dim">
              <Icon name={tab.icon} size={19} />
              {tab.label}
            </button>
          ) : (
            <NavLink key={tab.to} to={tab.to} end={tab.end}
                     className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px]"
                     style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text-dim)' })}>
              <Icon name={tab.icon} size={19} />
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => setQuickAdd(true)}
          className="lg:hidden fixed right-4 bottom-20 w-12 h-12 rounded-full text-white grid place-items-center shadow-lg z-40 no-print"
          style={{ background: 'var(--accent)' }}
          aria-label="Quick add"
        >
          <Icon name="plus" size={22} />
        </button>
      </div>

      <MoreMenu open={menu} onClose={() => setMenu(false)} onNavigate={(to) => navigate(to)} />
      <SearchModal open={search} onClose={() => setSearch(false)} />
      <QuickAddModal open={quickAdd} onClose={() => setQuickAdd(false)} />
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const icon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'circle';
  return (
    <button className="btn btn-sm" onClick={() => setTheme(next)} title={`Theme: ${theme}`} aria-label="Change theme">
      <Icon name={icon} size={14} />
    </button>
  );
}

function NotificationBell({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const notes = useQuery<{ items: any[]; unread: number }>(open ? '/notifications?limit=30' : null);
  return (
    <>
      <button className="btn btn-ghost btn-sm relative" onClick={() => setOpen(true)} aria-label="Notifications">
        <Icon name="bell" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold
                           text-white grid place-items-center tabular-nums"
                style={{ background: '#dc2626' }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notifications"
             footer={
               <button className="btn" onClick={async () => { await api.post('/notifications/read'); notes.reload(); }}>
                 Mark all read
               </button>
             }>
        {!notes.data?.items.length ? (
          <p className="dim text-sm py-6 text-center">Nothing needs you right now.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {notes.data.items.map((n) => (
              <li key={n.id} className="py-2.5 flex gap-3">
                {!n.readAt && <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: 'var(--accent)' }} />}
                <div className={`min-w-0 flex-1 ${n.readAt ? 'dim' : ''}`}>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-xs dim mt-0.5 whitespace-pre-line">{n.body}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

function MoreMenu({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; onNavigate: (to: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="All sections">
      <div className="grid grid-cols-3 gap-2">
        {NAV.map((item) => (
          <button key={item.to}
                  onClick={() => { onNavigate(item.to); onClose(); }}
                  className="panel card-hover p-3 flex flex-col items-center gap-1.5 text-xs">
            <Icon name={item.icon} size={19} className="dim" />
            {item.label}
          </button>
        ))}
        <button onClick={() => { onNavigate('/review'); onClose(); }}
                className="panel card-hover p-3 flex flex-col items-center gap-1.5 text-xs">
          <Icon name="chart" size={19} className="dim" /> Weekly review
        </button>
      </div>
      <div className="mt-4 flex justify-between items-center">
        <ThemeToggle />
        <button className="btn" onClick={async () => { await api.post('/auth/logout'); location.reload(); }}>
          Sign out
        </button>
      </div>
    </Modal>
  );
}

function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 200);
  const navigate = useNavigate();
  const results = useQuery<{ items: any[] }>(
    open && debounced.trim().length >= 2 ? `/search?q=${encodeURIComponent(debounced.trim())}&limit=25` : null,
  );
  useEffect(() => { if (!open) setTerm(''); }, [open]);

  const go = useCallback((route: string | null) => {
    if (!route) return;
    navigate(route);
    onClose();
  }, [navigate, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Search everything">
      <input
        className="input" placeholder="A tool, a bin, a cat, a receipt…" autoFocus
        value={term} onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(results.data?.items[0]?.route ?? null); }}
      />
      <div className="mt-3 max-h-80 overflow-y-auto scroll-thin">
        {debounced.trim().length < 2 && <p className="dim text-sm py-4 text-center">Type at least two letters.</p>}
        {debounced.trim().length >= 2 && !results.loading && !results.data?.items.length && (
          <p className="dim text-sm py-4 text-center">Nothing matches “{debounced}”.</p>
        )}
        {results.data?.items.map((r) => (
          <button key={`${r.type}:${r.id}`} onClick={() => go(r.route)}
                  className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 hover:bg-[var(--panel-alt)]">
            <Icon name={r.icon} size={15} className="dim shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="text-sm block truncate">{r.label}</span>
              {r.sub && <span className="text-xs dim block truncate">{r.sub}</span>}
            </span>
            <span className="chip">{r.type.replace(/_/g, ' ')}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function QuickAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const task = await api.post('/tasks/quick', { text, assignToMe: true });
      toast.push({
        message: `Added “${task.title}”${task.dueDate ? ` for ${task.dueDate}` : ''}`,
        undo: () => void api.del(`/tasks/${task.id}`),
      });
      setText('');
      onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (!open) setText(''); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Quick add"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>Add task</button>
           </>}>
      <Field label="What needs doing?"
             hint="Dates are read from the text: “tomorrow”, “next tue”, “in 3 weeks”, “5pm”. Add !high to raise the priority.">
        <input className="input" autoFocus value={text} placeholder="Call the chimney sweep next tuesday"
               onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </Field>
    </Modal>
  );
}
