import { useMemo, useState } from 'react';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { addDays } from '../lib/format';
import { Icon } from '../components/Icon';
import { Panel, Spinner } from '../components/ui';
import { originIcon } from './Today';

const MODULE_COLOUR: Record<string, string> = {
  manual: '#78716c', maintenance: '#0891b2', project: '#7c3aed', pet_medication: '#db2777',
  pet_appointment: '#db2777', bill: '#16a34a', shopping: '#ca8a04', loan_return: '#dc2626',
};

/** Month grid across every dated thing in the house (TASK-010). */
export function CalendarPage() {
  const app = useApp();
  const [anchor, setAnchor] = useState(() => app.today.slice(0, 7));
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const { start, end, weeks } = useMemo(() => {
    const first = new Date(`${anchor}-01T00:00:00`);
    const gridStart = new Date(first);
    gridStart.setDate(1 - ((first.getDay() + 6) % 7));
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    const rows: Date[][] = [];
    for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, i * 7 + 7));
    return {
      start: cells[0]!.toISOString().slice(0, 10),
      end: cells[41]!.toISOString().slice(0, 10),
      weeks: rows,
    };
  }, [anchor]);

  const { data, loading } = useQuery<{ items: any[] }>(`/calendar?from=${start}&to=${end}`, [start, end]);

  const byDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of data?.items ?? []) {
      if (hidden.has(item.module)) continue;
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [data, hidden]);

  const modules = useMemo(
    () => [...new Set((data?.items ?? []).map((i) => i.module))].sort(),
    [data],
  );

  const shiftMonth = (n: number) => {
    const d = new Date(`${anchor}-01T00:00:00`);
    d.setMonth(d.getMonth() + n);
    setAnchor(d.toISOString().slice(0, 7));
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {new Date(`${anchor}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h1>
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <Icon name="chevron" size={13} className="rotate-180" />
          </button>
          <button className="btn btn-sm" onClick={() => setAnchor(app.today.slice(0, 7))}>Today</button>
          <button className="btn btn-sm" onClick={() => shiftMonth(1)} aria-label="Next month">
            <Icon name="chevron" size={13} />
          </button>
        </div>
      </header>

      {modules.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {modules.map((m) => (
            <button key={m} onClick={() => setHidden((cur) => {
              const next = new Set(cur);
              if (next.has(m)) next.delete(m); else next.add(m);
              return next;
            })}
                    className={`chip ${hidden.has(m) ? 'opacity-40 line-through' : ''}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: MODULE_COLOUR[m] ?? '#78716c' }} />
              {m.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {loading && !data && <Spinner />}

      <Panel dense>
        <div className="grid grid-cols-7 border-b">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="text-[11px] font-semibold uppercase tracking-wide dim px-2 py-1.5 text-center">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b last:border-0">
            {week.map((day) => {
              const iso = day.toISOString().slice(0, 10);
              const items = byDate.get(iso) ?? [];
              const inMonth = iso.slice(0, 7) === anchor;
              const isToday = iso === app.today;
              return (
                <div key={iso}
                     className={`min-h-20 p-1.5 border-r last:border-r-0 ${inMonth ? '' : 'opacity-40'}`}
                     style={isToday ? { background: 'var(--panel-alt)' } : undefined}>
                  <div className={`text-xs mb-1 tabular-nums ${isToday ? 'font-bold' : 'dim'}`}>
                    {day.getDate()}
                  </div>
                  <ul className="space-y-0.5">
                    {items.slice(0, 3).map((i) => (
                      <li key={i.id} className="flex items-center gap-1 text-[11px] leading-tight">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: MODULE_COLOUR[i.module] ?? '#78716c' }} />
                        <span className={`truncate ${i.status === 'done' ? 'line-through dim' : ''}`}>{i.title}</span>
                      </li>
                    ))}
                    {items.length > 3 && <li className="text-[11px] dim">+{items.length - 3} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </Panel>

      <div className="lg:hidden space-y-2">
        <h2 className="text-sm font-semibold">Next fortnight</h2>
        {Array.from({ length: 14 }, (_, i) => addDays(app.today, i)).map((iso) => {
          const items = byDate.get(iso) ?? [];
          if (!items.length) return null;
          return (
            <Panel key={iso} dense title={new Date(iso + 'T00:00:00').toLocaleDateString(undefined,
              { weekday: 'short', month: 'short', day: 'numeric' })}>
              <ul>
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-4 py-2 border-b last:border-0 text-sm">
                    <Icon name={originIcon(i.module)} size={13} className="dim shrink-0" />
                    <span className="truncate flex-1">{i.title}</span>
                    {i.time && <span className="chip">{i.time}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
