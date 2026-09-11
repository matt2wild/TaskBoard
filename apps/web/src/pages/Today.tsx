import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, pluralise, quantity } from '../lib/format';
import { Icon } from '../components/Icon';
import { DueChip, EmptyState, ErrorNote, Panel, Progress, Spinner, StatTile, useToast } from '../components/ui';

/** The one screen that answers "what needs me today?" (DASH-001). */
export function Today() {
  const app = useApp();
  const { data, error, loading, reload } = useQuery<any>('/dashboard');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const complete = useCallback(async (id: string, title: string) => {
    setBusy(id);
    try {
      await api.post(`/tasks/${id}/complete`);
      toast.push({ message: `Done: ${title}`, undo: async () => { await api.post(`/tasks/${id}/reopen`); reload(); } });
      reload();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(null); }
  }, [reload, toast]);

  const snooze = useCallback(async (id: string) => {
    await api.post(`/tasks/${id}/snooze`, { days: 1 });
    reload();
  }, [reload]);

  const giveDose = useCallback(async (id: string, label: string) => {
    setBusy(id);
    try {
      await api.post(`/pet-doses/${id}/give`);
      toast.push({ message: `Given: ${label}` });
      reload();
    } finally { setBusy(null); }
  }, [reload, toast]);

  if (loading && !data) return <Spinner label="Gathering the house" />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return null;

  const c = data.counts;
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{greeting}, {app.user?.displayName.split(' ')[0]}</h1>
          <p className="dim text-sm">
            {new Date(data.today + 'T00:00:00').toLocaleDateString(undefined,
              { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/review" className="btn btn-sm"><Icon name="chart" size={13} /> Weekly review</Link>
          <Link to="/tasks/calendar" className="btn btn-sm"><Icon name="calendar" size={13} /> Calendar</Link>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Due today" value={c.tasksDueToday} icon="check"
                  sub={c.tasksOverdue ? `${c.tasksOverdue} overdue` : 'Nothing late'}
                  tone={c.tasksOverdue ? 'bad' : 'default'} />
        <StatTile label="Maintenance" value={c.maintenanceDue} icon="wrench"
                  sub={c.warrantiesExpiring ? `${c.warrantiesExpiring} warranty ending` : 'All current'}
                  tone={c.maintenanceDue ? 'warn' : 'default'} />
        <StatTile label="Expiring food" value={c.expiringSoon} icon="can"
                  sub={`${c.lowStock} below par`} tone={c.expiringSoon ? 'warn' : 'default'} />
        <StatTile label="Pet doses" value={c.dosesDueToday} icon="paw"
                  sub={c.dosesMissed ? `${c.dosesMissed} missed` : 'On schedule'}
                  tone={c.dosesMissed ? 'bad' : 'default'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Panel title="Today and overdue" dense
                 action={<Link to="/tasks" className="btn btn-sm btn-ghost">All tasks <Icon name="chevron" size={12} /></Link>}>
            {!data.tasks.length ? (
              <EmptyState icon="check" title="Nothing is due" hint="The house is caught up. Enjoy it." />
            ) : (
              <ul>
                {data.tasks.slice(0, 12).map((t: any) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0">
                    <button
                      className="mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0
                                 hover:border-[var(--accent)] disabled:opacity-40"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={() => complete(t.id, t.title)}
                      disabled={busy === t.id || t.isBlocked}
                      aria-label={`Complete ${t.title}`}
                      title={t.isBlocked ? 'Blocked by another task' : 'Mark done'}
                    >
                      {busy === t.id && <Icon name="clock" size={11} className="dim" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <DueChip date={t.dueDate} status={t.dueStatus} today={data.today} />
                        {t.originType !== 'manual' && (
                          <span className="chip"><Icon name={originIcon(t.originType)} size={11} />
                            {t.originType.replace(/_/g, ' ')}</span>
                        )}
                        {t.isBlocked && <span className="chip">blocked</span>}
                        {t.checklistTotal > 0 && (
                          <span className="chip tabular-nums">{t.checklistDone}/{t.checklistTotal}</span>
                        )}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm shrink-0" onClick={() => snooze(t.id)} title="Snooze a day">
                      <Icon name="clock" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.doses.length > 0 && (
            <Panel title="Pet doses" dense
                   action={<Link to="/pets" className="btn btn-sm btn-ghost">Pets <Icon name="chevron" size={12} /></Link>}>
              <ul>
                {data.doses.map((d: any) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                    <Icon name="pill" size={15} className="dim shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{d.petName}</span> — {d.medication}
                      </p>
                      <p className="text-xs dim">
                        {d.dueTime}
                        {d.status === 'missed' && <span className="text-red-600 dark:text-red-400"> · missed</span>}
                      </p>
                    </div>
                    <button className="btn btn-sm" disabled={busy === d.id}
                            onClick={() => giveDose(d.id, `${d.petName} ${d.medication}`)}>
                      Given
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.projects.length > 0 && (
            <Panel title="Projects in flight" dense>
              <ul>
                {data.projects.map((p: any) => (
                  <li key={p.id} className="px-4 py-3 border-b last:border-0">
                    <Link to={`/projects/${p.id}`} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      <span className="chip">{p.status.replace('_', ' ')}</span>
                    </Link>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex-1"><Progress value={p.taskDone} max={p.taskTotal || 1} tone="good" /></div>
                      <span className="text-xs dim tabular-nums shrink-0">{p.taskDone}/{p.taskTotal} tasks</span>
                    </div>
                    {p.budget != null && (
                      <div className="flex items-center gap-3 mt-1.5">
                        <div className="flex-1"><Progress value={p.spent} max={p.budget} /></div>
                        <span className="text-xs dim tabular-nums shrink-0">
                          {money(p.spent, app.currency)} of {money(p.budget, app.currency)}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="This month" dense
                 action={<Link to="/budget" className="btn btn-sm btn-ghost">Budget <Icon name="chevron" size={12} /></Link>}>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-lg font-semibold tabular-nums">{money(data.budget.spent, app.currency)}</span>
                <span className="text-xs dim">of {money(data.budget.allocated, app.currency)}</span>
              </div>
              <Progress value={data.budget.spent} max={data.budget.allocated || 1} />
              {data.budget.overCategories.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {data.budget.overCategories.map((cat: any) => (
                    <li key={cat.categoryId} className="flex justify-between text-xs">
                      <span className="truncate">{cat.name}</span>
                      <span className={`tabular-nums shrink-0 ml-2 ${cat.spent > cat.allocated ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {cat.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          {data.bills.length > 0 && (
            <Panel title="Bills due" dense>
              <ul>
                {data.bills.map((b: any) => (
                  <li key={b.id} className="flex justify-between items-center px-4 py-2.5 border-b last:border-0 text-sm">
                    <span className="truncate">{b.payee}</span>
                    <span className="text-right shrink-0 ml-2">
                      <span className="tabular-nums block">{b.amount ? money(b.amount, app.currency) : 'varies'}</span>
                      <span className="text-xs dim">{dateLabel(b.dueDate, data.today)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.expiring.length > 0 && (
            <Panel title="Use this up" dense
                   action={<Link to="/food" className="btn btn-sm btn-ghost">Pantry <Icon name="chevron" size={12} /></Link>}>
              <ul>
                {data.expiring.slice(0, 6).map((e: any) => (
                  <li key={e.id} className="flex justify-between items-center px-4 py-2 border-b last:border-0 text-sm">
                    <span className="truncate">{e.product}</span>
                    <span className={`chip shrink-0 ml-2 ${e.daysLeft <= 0 ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : ''}`}>
                      {e.daysLeft <= 0 ? 'expired' : `${e.daysLeft}d`}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.lowStock.length > 0 && (
            <Panel title="Running low" dense>
              <ul>
                {data.lowStock.slice(0, 6).map((l: any) => (
                  <li key={l.productId} className="flex justify-between items-center px-4 py-2 border-b last:border-0 text-sm">
                    <span className="truncate">{l.name}</span>
                    <span className="text-xs dim tabular-nums shrink-0 ml-2">
                      {quantity(l.onHand, l.unit)} / {quantity(l.minQuantity, l.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {(data.loans.length > 0 || data.warranties.length > 0 || data.maintenance.length > 0) && (
            <Panel title="Keep an eye on" dense>
              <ul className="text-sm">
                {data.maintenance.slice(0, 4).map((m: any) => (
                  <li key={m.planId} className="flex items-center gap-2 px-4 py-2 border-b last:border-0">
                    <Icon name="wrench" size={13} className="dim shrink-0" />
                    <span className="truncate flex-1">{m.title}</span>
                    <span className="chip shrink-0">{m.daysLate > 0 ? `${m.daysLate}d late` : 'due'}</span>
                  </li>
                ))}
                {data.warranties.map((w: any) => (
                  <li key={w.assetId} className="flex items-center gap-2 px-4 py-2 border-b last:border-0">
                    <Icon name="file" size={13} className="dim shrink-0" />
                    <span className="truncate flex-1">{w.assetName} warranty</span>
                    <span className="chip shrink-0">{w.daysLeft}d</span>
                  </li>
                ))}
                {data.loans.map((l: any) => (
                  <li key={l.id} className="flex items-center gap-2 px-4 py-2 border-b last:border-0">
                    <Icon name="handshake" size={13} className="dim shrink-0" />
                    <span className="truncate flex-1">Out with {l.contact}</span>
                    {l.overdue && <span className="chip bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">late</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <p className="text-xs dim text-center pt-2">
        {pluralise(c.activeProjects, 'active project')} · {pluralise(c.loansOut, 'item')} out on loan
      </p>
    </div>
  );
}

export function originIcon(origin: string): string {
  return ({
    maintenance: 'wrench', project: 'hammer', pet_medication: 'pill', pet_appointment: 'stethoscope',
    bill: 'coin', shopping: 'cart', loan_return: 'handshake', automation: 'repeat',
  } as Record<string, string>)[origin] ?? 'check';
}
