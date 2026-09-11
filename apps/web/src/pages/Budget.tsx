import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, moneyExact, parseMoneyInput, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  EmptyState, Field, Modal, Panel, Progress, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

type Tab = 'month' | 'transactions' | 'bills' | 'reports' | 'plan';

export function Budget() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('month');
  const [period, setPeriod] = useState(app.today.slice(0, 7));
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Budget</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Transaction
        </button>
      </header>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'month', label: 'This month' },
        { id: 'transactions', label: 'Transactions' },
        { id: 'bills', label: 'Bills' },
        { id: 'reports', label: 'Reports' },
        { id: 'plan', label: 'Long range' },
      ]} />
      {tab === 'month' && <MonthView period={period} setPeriod={setPeriod} />}
      {tab === 'transactions' && <TransactionList />}
      {tab === 'bills' && <Bills />}
      {tab === 'reports' && <Reports />}
      {tab === 'plan' && <LongRange />}
      <AddTransaction open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function shiftPeriod(period: string, n: number): string {
  const d = new Date(`${period}-01T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 7);
}

function MonthView({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>(`/budget/${period}`, [period]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const categories = useQuery<any>(editing ? '/categories?limit=300' : null);
  const toast = useToast();

  const save = async () => {
    const allocations = Object.entries(draft)
      .map(([categoryId, raw]) => ({ categoryId, amount: parseMoneyInput(raw) ?? 0 }))
      .filter((a) => a.amount >= 0);
    await api.put(`/budget/${period}/allocations`, { allocations });
    toast.push({ message: 'Budget saved' });
    setEditing(false); setDraft({}); reload();
  };

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month">
            <Icon name="chevron" size={13} className="rotate-180" />
          </button>
          <span className="btn btn-sm pointer-events-none">
            {new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button className="btn btn-sm" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next month">
            <Icon name="chevron" size={13} />
          </button>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={async () => {
            await api.post(`/budget/${period}/copy-from/${shiftPeriod(period, -1)}`, { adjustPct: 0 });
            toast.push({ message: 'Copied last month' });
            reload();
          }}>Copy last month</button>
          <button className="btn btn-sm" onClick={() => {
            setDraft(Object.fromEntries((data?.categories ?? [])
              .filter((c: any) => c.categoryId)
              .map((c: any) => [c.categoryId, (c.allocated / 100).toString()])));
            setEditing(true);
          }}>Edit</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Budgeted" value={money(data?.allocated ?? 0, app.currency)} icon="target" />
        <StatTile label="Spent" value={money(data?.spent ?? 0, app.currency)} icon="coin"
                  tone={(data?.spent ?? 0) > (data?.allocated ?? 0) ? 'bad' : 'default'} />
        <StatTile label="Income" value={money(data?.income ?? 0, app.currency)} icon="bank" tone="good" />
      </div>

      {!data?.categories.length ? (
        <EmptyState icon="coin" title="Nothing budgeted this month"
                    hint="Set an amount per category, or copy last month."
                    action={<button className="btn btn-primary" onClick={() => setEditing(true)}>Set a budget</button>} />
      ) : (
        <Panel dense>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Spent</th>
                <th className="text-right">Left</th>
                <th className="w-24">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((c: any) => (
                <tr key={c.categoryId ?? 'none'}>
                  <td>
                    {c.name}
                    {c.rollover !== 0 && (
                      <span className="chip ml-1.5">{c.rollover > 0 ? '+' : ''}{money(c.rollover, app.currency)} carried</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums dim">{money(c.allocated, app.currency)}</td>
                  <td className="text-right tabular-nums">{money(c.spent, app.currency)}</td>
                  <td className={`text-right tabular-nums ${c.remaining < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {money(c.remaining, app.currency)}
                  </td>
                  <td>{c.allocated > 0 && <Progress value={c.spent} max={c.allocated} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={`Budget for ${period}`} wide
             footer={<>
               <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
               <button className="btn btn-primary" onClick={save}>Save</button>
             </>}>
        <div className="space-y-1 max-h-[60vh] overflow-y-auto scroll-thin">
          {categories.data?.items.filter((c: any) => c.kind === 'expense' && !c.archived).map((c: any) => (
            <label key={c.id} className="flex items-center gap-3 py-1">
              <span className={`flex-1 text-sm ${c.parentId ? 'pl-4' : 'font-medium'}`}>{c.name}</span>
              <input className="input w-28 text-right" inputMode="decimal" placeholder="0"
                     value={draft[c.id] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function TransactionList() {
  const app = useApp();
  const [month, setMonth] = useState(app.today.slice(0, 7));
  const range = useMemo(() => {
    const start = `${month}-01`;
    const d = new Date(`${month}-01T00:00:00`);
    d.setMonth(d.getMonth() + 1); d.setDate(0);
    return { start, end: d.toISOString().slice(0, 10) };
  }, [month]);
  const { data, loading } = useQuery<any>(`/transactions?from=${range.start}&to=${range.end}&limit=300`, [month]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button className="btn btn-sm" onClick={() => setMonth(shiftPeriod(month, -1))}>
          <Icon name="chevron" size={13} className="rotate-180" />
        </button>
        <span className="btn btn-sm pointer-events-none">
          {new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button className="btn btn-sm" onClick={() => setMonth(shiftPeriod(month, 1))}>
          <Icon name="chevron" size={13} />
        </button>
      </div>
      {loading && !data && <Spinner />}
      {data && !data.items.length && <EmptyState icon="coin" title="No transactions this month" />}
      {data?.items.length > 0 && (
        <Panel dense>
          <table className="table">
            <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>For</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {data.items.map((t: any) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap dim">{dateLabel(t.date, app.today)}</td>
                  <td>
                    {t.payeeName ?? '—'}
                    {t.memo && <div className="text-xs dim">{t.memo}</div>}
                  </td>
                  <td className="text-xs dim">{t.splits.map((s: any) => s.categoryName).filter(Boolean).join(', ') || '—'}</td>
                  <td className="text-xs">
                    {t.splits.flatMap((s: any) => s.attributions).map((a: any) => (
                      <span key={a.entityId} className="chip mr-1">{a.label}</span>
                    ))}
                  </td>
                  <td className={`text-right tabular-nums whitespace-nowrap ${t.type === 'income' ? 'text-brand-600 dark:text-brand-500' : ''}`}>
                    {t.type === 'income' ? '+' : ''}{moneyExact(t.amount, app.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function Bills() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/bills?limit=100');
  const upcoming = useQuery<any>('/bills/upcoming?days=45');
  const toast = useToast();

  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      {upcoming.data?.items.length > 0 && (
        <Panel title="Coming up" dense>
          <ul>
            {upcoming.data.items.map((b: any) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm">
                <span className="flex-1 truncate">{b.name}</span>
                <span className="tabular-nums">{b.amount ? money(b.amount, app.currency) : 'varies'}</span>
                <span className="chip">{dateLabel(b.dueDate, app.today)}</span>
                <button className="btn btn-sm" onClick={async () => {
                  await api.post(`/bills/${b.id}/pay`, {});
                  toast.push({ message: `Recorded ${b.name}` });
                  upcoming.reload(); reload();
                }} disabled={!b.amount}>Paid</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="All bills" dense>
        {!data?.items.length ? <EmptyState icon="coin" title="No recurring bills set up" /> : (
          <table className="table">
            <thead><tr><th>Bill</th><th className="text-right">Amount</th><th>Next due</th><th className="text-right">Monthly set-aside</th></tr></thead>
            <tbody>
              {data.items.map((b: any) => (
                <tr key={b.id}>
                  <td>{b.name}{b.variable && <span className="chip ml-1.5">varies</span>}</td>
                  <td className="text-right tabular-nums">{money(b.amount, app.currency)}</td>
                  <td className="dim">{b.nextDue ? dateLabel(b.nextDue, app.today) : 'not scheduled'}</td>
                  <td className="text-right tabular-nums dim">
                    {b.everyMonths > 1 ? money(b.monthlySetAside, app.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Reports() {
  const app = useApp();
  const year = app.today.slice(0, 4);
  const byCategory = useQuery<any>(`/budget/reports/by-category?from=${year}-01-01&to=${year}-12-31`);
  const overTime = useQuery<any>(`/budget/reports/over-time?from=${year}-01-01&to=${year}-12-31`);
  const byAttribution = useQuery<any>(`/budget/reports/by-attribution?from=${year}-01-01&to=${year}-12-31`);

  const maxMonth = Math.max(1, ...(overTime.data?.items ?? []).map((m: any) => Math.max(m.expense, m.income)));

  return (
    <div className="space-y-4">
      <Panel title={`Spending by month, ${year}`}>
        {!overTime.data?.items.length ? <p className="dim text-sm">No data yet.</p> : (
          <div className="flex items-end gap-1.5 h-40">
            {overTime.data.items.map((m: any) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                  <div className="w-1/2 rounded-t" title={`Spent ${money(m.expense, app.currency)}`}
                       style={{ height: `${(m.expense / maxMonth) * 100}%`, background: 'var(--color-ink-400)', minHeight: 2 }} />
                  <div className="w-1/2 rounded-t" title={`Income ${money(m.income, app.currency)}`}
                       style={{ height: `${(m.income / maxMonth) * 100}%`, background: 'var(--accent)', minHeight: 2 }} />
                </div>
                <span className="text-[10px] dim">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Panel title="By category" dense>
          <table className="table">
            <tbody>
              {byCategory.data?.items.slice(0, 15).map((c: any) => (
                <tr key={c.categoryId ?? 'none'}>
                  <td>{c.name}</td>
                  <td className="text-right tabular-nums dim">{c.count}</td>
                  <td className="text-right tabular-nums">{money(c.total, app.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="What the money was for" dense>
          {!byAttribution.data?.items.length ? (
            <p className="dim text-sm p-4">
              Attribute a transaction to an asset, project or pet and it shows up here.
            </p>
          ) : (
            <>
              <ul className="px-4 pt-3 flex flex-wrap gap-1.5">
                {byAttribution.data.byType.map((t: any) => (
                  <li key={t.type} className="chip">{titleCase(t.type)} · {money(t.total, app.currency)}</li>
                ))}
              </ul>
              <table className="table mt-2">
                <tbody>
                  {byAttribution.data.items.slice(0, 15).map((a: any) => (
                    <tr key={`${a.entityType}:${a.entityId}`}>
                      <td>{a.label}<span className="chip ml-1.5">{titleCase(a.entityType)}</span></td>
                      <td className="text-right tabular-nums">{money(a.total, app.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

function LongRange() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/budget/long-range?years=10');
  if (loading && !data) return <Spinner />;
  if (!data?.years.length) {
    return <EmptyState icon="chart" title="Nothing to forecast yet"
                       hint="Give assets an expected lifespan, add project ideas or set a savings goal." />;
  }
  const max = Math.max(...data.years.map((y: any) => y.total), 1);
  return (
    <div className="space-y-4">
      <p className="text-sm dim">
        What the house is likely to ask for, from asset lifespans, project ideas and savings goals.
      </p>
      {data.years.map((y: any) => (
        <Panel key={y.year} dense title={
          <span className="flex items-center justify-between w-full">
            <span>{y.year}</span>
            <span className="tabular-nums">{money(y.total, app.currency)}</span>
          </span>
        }>
          <div className="px-4 pt-3"><Progress value={y.total} max={max} tone="warn" /></div>
          <ul className="px-4 py-3 space-y-1">
            {y.items.map((i: any, idx: number) => (
              <li key={idx} className="flex justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Icon name={i.kind === 'goal' ? 'target' : i.kind === 'project' ? 'hammer' : 'cpu'} size={12} className="dim" />
                  {i.label}
                </span>
                <span className="tabular-nums dim">{money(i.amount, app.currency)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function AddTransaction({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const categories = useQuery<any>(open ? '/categories?limit=300' : null);
  const accounts = useQuery<any>(open ? '/accounts' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const amount = parseMoneyInput(form.amount ?? '');
      if (!amount) throw new Error('Enter an amount');
      await api.post('/transactions', {
        amount, date: form.date || app.today,
        type: form.type || 'expense',
        payeeName: form.payee || undefined,
        categoryId: form.categoryId || undefined,
        accountId: form.accountId || undefined,
        memo: form.memo || undefined,
      });
      toast.push({ message: 'Transaction recorded' });
      setForm({}); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a transaction"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy}>Record</button>
           </>}>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label={`Amount (${app.currency})`}>
          <input className="input" autoFocus inputMode="decimal" placeholder="0.00"
                 value={form.amount ?? ''} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <Field label="Type">
          <select className="select" value={form.type ?? 'expense'} onChange={(e) => set('type', e.target.value)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>
      </div>
      <Field label="Payee">
        <input className="input" value={form.payee ?? ''} onChange={(e) => set('payee', e.target.value)} />
      </Field>
      <Field label="Category">
        <select className="select" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.data?.items.filter((c: any) => c.parentId).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Date">
          <input className="input" type="date" value={form.date ?? app.today} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Account">
          <select className="select" value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">None</option>
            {accounts.data?.items.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Memo">
        <input className="input" value={form.memo ?? ''} onChange={(e) => set('memo', e.target.value)} />
      </Field>
    </Modal>
  );
}
