import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { DueChip, EmptyState, ErrorNote, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast } from '../components/ui';

type Tab = 'upcoming' | 'plans' | 'history' | 'warranties' | 'costs';

export function Maintenance() {
  const [tab, setTab] = useState<Tab>('upcoming');
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Maintenance</h1>
        <Link to="/assets" className="btn btn-sm"><Icon name="cpu" size={13} /> Assets</Link>
      </header>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'upcoming', label: 'Upcoming' },
        { id: 'plans', label: 'Plans' },
        { id: 'history', label: 'History' },
        { id: 'warranties', label: 'Warranties' },
        { id: 'costs', label: 'Costs' },
      ]} />
      {tab === 'upcoming' && <Upcoming />}
      {tab === 'plans' && <Plans />}
      {tab === 'history' && <History />}
      {tab === 'warranties' && <Warranties />}
      {tab === 'costs' && <Costs />}
    </div>
  );
}

function Upcoming() {
  const app = useApp();
  const [groupBy, setGroupBy] = useState<'date' | 'season' | 'asset'>('date');
  const [days, setDays] = useState(60);
  const { data, error, loading, reload } = useQuery<any>(
    `/maintenance/upcoming?days=${days}&groupBy=${groupBy}`, [groupBy, days],
  );
  const [logging, setLogging] = useState<any | null>(null);

  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;

  const items: any[] = data?.items ?? data?.groups?.flatMap((g: any) => g.items) ?? [];
  const overdue = items.filter((i) => i.daysLeft < 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-1">
          {(['date', 'season', 'asset'] as const).map((g) => (
            <button key={g} className={`btn btn-sm ${groupBy === g ? 'btn-primary' : ''}`}
                    onClick={() => setGroupBy(g)}>{titleCase(g)}</button>
          ))}
        </div>
        <select className="select w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
          <option value={180}>Next 6 months</option>
          <option value={365}>Next year</option>
        </select>
      </div>

      {overdue.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="Overdue" value={overdue.length} tone="bad" icon="alert" />
          <StatTile label="Due within 60 days" value={items.length - overdue.length} icon="wrench" />
          <StatTile label="Estimated cost" icon="coin"
                    value={money(items.reduce((a, b) => a + (b.estimateCost ?? 0), 0), app.currency)} />
        </div>
      )}

      {!items.length && <EmptyState icon="wrench" title="Nothing due"
                                    hint="Add a plan to an asset and it will show up here when it comes round." />}

      {(data?.groups ?? (items.length ? [{ name: null, items }] : [])).map((group: any) => (
        <Panel key={group.name ?? 'all'} title={group.name ? titleCase(group.name) : undefined} dense>
          <ul>
            {group.items.map((m: any) => (
              <li key={m.planId} className="flex items-start gap-3 px-4 py-3 border-b last:border-0">
                <Icon name="wrench" size={15} className="dim mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{m.title}</p>
                  <p className="text-xs dim">
                    {m.targetName ?? 'Property'} · {m.description}
                    {m.estimateMin ? ` · about ${m.estimateMin} min` : ''}
                    {!m.diy ? ' · vendor' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DueChip date={m.dueDate} status={m.status} today={app.today} />
                  <button className="btn btn-sm" onClick={() => setLogging(m)}>Log</button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <LogWork plan={logging} onClose={() => setLogging(null)} onDone={reload} />
    </div>
  );
}

/** The completion sheet: cost, parts, notes, all optional (MAINT-003). */
function LogWork({ plan, onClose, onDone }: { plan: any | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const readiness = useQuery<any>(plan ? `/maintenance/plans/${plan.planId}/readiness` : null, [plan?.planId]);

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const tasks = await api.get(`/tasks?originType=maintenance&originId=${plan.planId}&status=open`);
      const cents = cost ? Math.round(Number(cost.replace(/[^0-9.]/g, '')) * 100) : 0;
      const extra = {
        notesMd: notes || undefined,
        cost: cents > 0 ? { amount: cents } : undefined,
      };
      if (tasks.items[0]) {
        await api.post(`/tasks/${tasks.items[0].id}/complete`, { extra });
      } else {
        await api.post('/maintenance/log', {
          planId: plan.planId, targetType: plan.targetType, targetId: plan.targetId,
          title: plan.title, ...extra,
        });
      }
      toast.push({ message: `Logged: ${plan.title}` });
      setCost(''); setNotes('');
      onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={!!plan} onClose={onClose} title={plan ? `Log: ${plan.title}` : ''}
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy}>Record it</button>
           </>}>
      {readiness.data?.consumables.length > 0 && (
        <div className="panel p-3 mb-4">
          <h3 className="label mb-2">Parts this uses</h3>
          <ul className="space-y-1 text-sm">
            {readiness.data.consumables.map((c: any) => (
              <li key={c.productId} className="flex justify-between">
                <span>{c.name} × {c.needed}</span>
                <span className={c.enough ? 'dim' : 'text-amber-600 dark:text-amber-400'}>
                  {c.onHand} on hand
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs dim mt-2">These come off the shelf when you record the work.</p>
        </div>
      )}
      <Field label={`Cost (${app.currency})`} hint="Optional. Creates a transaction attributed to this asset.">
        <input className="input" inputMode="decimal" value={cost} placeholder="0.00"
               onChange={(e) => setCost(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you will want to know next time" />
      </Field>
    </Modal>
  );
}

function Plans() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/maintenance/plans?limit=200');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="wrench" title="No plans yet"
                       hint="Open an asset and apply the shipped template library, or write your own plan." />;
  }
  return (
    <Panel dense>
      <ul>
        {data.items.map((p: any) => (
          <li key={p.id} className="px-4 py-3 border-b last:border-0 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{p.title}</p>
              <p className="text-xs dim">
                {p.targetName ?? titleCase(p.targetType)}
                {p.schedule ? ` · ${p.schedule.description}` : ' · no schedule'}
                {p.lastCompletedAt ? ` · last done ${dateLabel(p.lastCompletedAt, app.today)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.nextDue && <DueChip date={p.nextDue} status={p.dueStatus} today={app.today} />}
              <button className="btn btn-sm btn-ghost" title="Skip this round"
                      onClick={async () => { await api.post(`/maintenance/plans/${p.id}/skip`); reload(); }}>
                Skip
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function History() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/maintenance/records?limit=100&sort=performedAt&dir=desc');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) return <EmptyState icon="clock" title="No history yet" />;
  return (
    <Panel dense>
      <table className="table">
        <thead><tr><th>Date</th><th>Work</th><th>Kind</th></tr></thead>
        <tbody>
          {data.items.map((r: any) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap dim">{dateLabel(r.performedAt, app.today)}</td>
              <td>
                {r.title}
                {r.notesMd && <div className="text-xs dim mt-0.5">{r.notesMd}</div>}
              </td>
              <td><span className="chip">{r.kind}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Warranties() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/maintenance/warranties/expiring?days=365');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) return <EmptyState icon="file" title="No warranties ending within a year" />;
  return (
    <Panel dense>
      <ul>
        {data.items.map((w: any) => (
          <li key={w.warrantyId} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
            <Icon name="file" size={15} className="dim shrink-0" />
            <Link to={`/assets/${w.assetId}`} className="flex-1 min-w-0 text-sm truncate hover:underline">
              {w.assetName}
            </Link>
            <span className="text-xs dim">{w.type}</span>
            <span className={`chip ${w.expired ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : w.daysLeft < 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : ''}`}>
              {w.expired ? 'expired' : `${w.daysLeft}d`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Costs() {
  const app = useApp();
  const year = app.today.slice(0, 4);
  const { data, loading } = useQuery<any>(`/maintenance/costs?from=${year}-01-01&to=${year}-12-31`);
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      <StatTile label={`Maintenance spend in ${year}`} value={money(data?.total ?? 0, app.currency)} icon="coin" />
      {data?.byTarget.length > 0 && (
        <Panel title="By asset" dense>
          <table className="table">
            <thead><tr><th>Asset</th><th className="text-right">Jobs</th><th className="text-right">Spend</th></tr></thead>
            <tbody>
              {data.byTarget.map((t: any) => (
                <tr key={`${t.targetType}:${t.targetId}`}>
                  <td>{t.name}</td>
                  <td className="text-right tabular-nums">{t.count}</td>
                  <td className="text-right tabular-nums">{money(t.total, app.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
