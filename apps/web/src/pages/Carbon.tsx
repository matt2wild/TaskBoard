import { useMemo, useState } from 'react';
import { ACTIVITY_TYPES, formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp, useGo } from '../App';
import { dateLabel, money, moneyExact, parseMoneyInput, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  EmptyState, ErrorNote, Field, Modal, Panel, Progress, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

type Tab = 'footprint' | 'energy' | 'interventions' | 'factors';

/** Carbon is the household's second unit of account, so it gets a screen of
 *  its own as well as a line on every other one. */
export function Carbon() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('footprint');
  const [year, setYear] = useState(app.today.slice(0, 4));
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Footprint</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Activity
        </button>
      </header>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'footprint', label: 'Footprint' },
        { id: 'energy', label: 'Energy' },
        { id: 'interventions', label: 'What to do' },
        { id: 'factors', label: 'Factors' },
      ]} />
      {tab === 'footprint' && <FootprintView year={year} setYear={setYear} />}
      {tab === 'energy' && <EnergyView />}
      {tab === 'interventions' && <Interventions />}
      {tab === 'factors' && <Factors />}
      <AddActivity open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/* ──────────────────────────── the footprint ─────────────────────────────── */

const SCOPE_TONE = ['', 'bad', 'warn', 'default'] as const;

function FootprintView({ year, setYear }: { year: string; setYear: (y: string) => void }) {
  const app = useApp();
  const { data, error, loading, reload } = useQuery<any>(`/carbon/footprint?year=${year}`, [year]);
  const [drill, setDrill] = useState<{ category?: string; scope?: number; label: string } | null>(null);
  const [editTarget, setEditTarget] = useState(false);
  const thisYear = Number(app.today.slice(0, 4));

  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const total: number = data.total ?? 0;
  const target = data.target;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setYear(String(Number(year) - 1))} aria-label="Previous year">
            <Icon name="chevron" size={13} className="rotate-180" />
          </button>
          <span className="btn btn-sm pointer-events-none tabular-nums">{year}</span>
          <button className="btn btn-sm" disabled={Number(year) >= thisYear}
                  onClick={() => setYear(String(Number(year) + 1))} aria-label="Next year">
            <Icon name="chevron" size={13} />
          </button>
        </div>
        <button className="btn btn-sm" onClick={() => setEditTarget(true)}>
          <Icon name="target" size={13} /> {target ? 'Change target' : 'Set a target'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={`Emitted in ${year}`} value={formatCo2e(total)} icon="chart"
                  sub={`${data.activityCount} activities`} />
        <StatTile
          label={`Against ${data.priorYear.year}`}
          value={data.changePct == null ? '—' : `${data.changePct > 0 ? '+' : ''}${data.changePct}%`}
          tone={data.changePct == null ? 'default' : data.changePct > 0 ? 'bad' : 'good'}
          icon="repeat"
          sub={data.priorYear.total ? formatCo2e(data.priorYear.total) : 'no prior year'}
        />
        <StatTile label="Per person" value={formatCo2e(data.intensity.perPerson)} icon="user"
                  sub={`across ${data.intensity.people}`} />
        {target ? (
          <StatTile label="Of target" value={target.pct == null ? '—' : `${target.pct}%`}
                    tone={(target.pct ?? 0) > 100 ? 'bad' : (target.pct ?? 0) > 80 ? 'warn' : 'good'}
                    icon="target" sub={formatCo2e(target.gCo2e)} onClick={() => setEditTarget(true)} />
        ) : (
          <StatTile label="Credits" value={formatCo2e(data.credits)} icon="sun"
                    tone={data.credits < 0 ? 'good' : 'default'} sub="generated on site" />
        )}
      </div>

      {target && <Panel title={`Target for ${target.period}`}>
        <Progress value={total} max={target.gCo2e} />
        <p className="dim text-sm mt-2">
          {formatCo2e(total, { long: true })} of {formatCo2e(target.gCo2e, { long: true })}
          {total <= target.gCo2e
            ? ` — ${formatCo2e(target.gCo2e - total)} left.`
            : ` — ${formatCo2e(total - target.gCo2e)} over.`}
        </p>
      </Panel>}

      <Panel title="Where it comes from" action={<span className="dim text-xs">{data.region ?? 'no region set'}</span>}>
        <div className="space-y-3">
          {data.scopes.map((s: any) => (
            <button key={s.scope} className="w-full text-left card-hover rounded-lg -mx-1 px-1 py-1"
                    onClick={() => setDrill({ scope: s.scope, label: `Scope ${s.scope}: ${s.label}` })}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  <span className="dim tabular-nums mr-1.5">{s.scope}</span>{s.label}
                </span>
                <span className={`tabular-nums text-sm font-semibold ${
                  SCOPE_TONE[s.scope] === 'bad' ? 'text-red-600 dark:text-red-400'
                    : SCOPE_TONE[s.scope] === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {formatCo2e(s.total)}
                </span>
              </div>
              <div className="mt-1"><Progress value={Math.abs(s.total)} max={Math.abs(total) || 1} tone="good" /></div>
              <p className="dim text-xs mt-1">{s.note}</p>
            </button>
          ))}
          {!data.scopes.length && <p className="dim text-sm">Nothing recorded for {year} yet.</p>}
        </div>
      </Panel>

      {data.byMonth.length > 1 && (
        <Panel title="Month by month">
          <MonthBars months={data.byMonth} />
        </Panel>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="By category" dense>
          {!data.byCategory.length ? <EmptyState icon="chart" title="Nothing to break down" /> : (
            <table className="table">
              <tbody>
                {data.byCategory.map((c: any) => (
                  <tr key={c.category} className="cursor-pointer"
                      onClick={() => setDrill({ category: c.category, label: titleCase(c.category) })}>
                    <td>{titleCase(c.category)}</td>
                    <td className="text-right tabular-nums">{formatCo2e(c.total)}</td>
                    <td className="text-right dim tabular-nums w-14">
                      {total > 0 ? `${Math.round((c.total / total) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Attributed to" dense
               action={<span className="dim text-xs">one ledger, both measures</span>}>
          {!data.byEntity.length ? (
            <EmptyState icon="link" title="Nothing attributed yet"
                        hint="Emissions attach to the asset, project, pet or product that caused them." />
          ) : (
            <table className="table">
              <tbody>
                {data.byEntity.map((e: any) => (
                  <tr key={`${e.entityType}:${e.entityId}`}>
                    <td>
                      <span className="chip mr-2">{titleCase(e.entityType)}</span>
                      {e.label}
                    </td>
                    <td className="text-right tabular-nums">{formatCo2e(e.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Explain open={!!drill} onClose={() => setDrill(null)} year={year} drill={drill} />
      <TargetModal open={editTarget} onClose={() => setEditTarget(false)} year={year}
                   current={target?.gCo2e ?? null} onSaved={reload} />
    </div>
  );
}

function MonthBars({ months }: { months: Array<{ month: string; total: number }> }) {
  const max = Math.max(...months.map((m) => Math.abs(m.total)), 1);
  return (
    <div className="flex items-end gap-1.5">
      {months.map((m) => (
        <div key={m.month} className="flex-1 min-w-0 flex flex-col items-center gap-1">
          {/* The well needs a real height, or a percentage bar inside it has
              nothing to be a percentage of. */}
          <div className="w-full flex items-end" style={{ height: 120 }}>
            <div className="w-full rounded-t transition-[height]"
                 style={{
                   height: `${Math.max((Math.abs(m.total) / max) * 100, 2)}%`,
                   background: m.total < 0 ? 'var(--color-ink-400)' : 'var(--accent)',
                 }}
                 title={`${m.month}: ${formatCo2e(m.total)}`} />
          </div>
          <span className="text-[10px] dim tabular-nums">{m.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** GHG-028: no number on this screen is allowed to be unexplainable. */
function Explain({ open, onClose, year, drill }: {
  open: boolean; onClose: () => void; year: string;
  drill: { category?: string; scope?: number; label: string } | null;
}) {
  const query = drill
    ? `/carbon/explain?from=${year}-01-01&to=${year}-12-31${
      drill.category ? `&category=${encodeURIComponent(drill.category)}` : ''}${
      drill.scope ? `&scope=${drill.scope}` : ''}`
    : null;
  const { data, loading } = useQuery<any>(open ? query : null, [query]);

  return (
    <Modal open={open} onClose={onClose} wide title={drill ? `${drill.label} — every number behind it` : ''}>
      {loading && <Spinner />}
      {data && !data.items.length && <EmptyState icon="chart" title="Nothing here for this period" />}
      {data && !!data.items.length && (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>What</th><th className="text-right">Amount</th>
              <th>Factor</th><th className="text-right">CO₂e</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r: any, i: number) => (
              <tr key={`${r.activityId}-${i}`}>
                <td className="dim whitespace-nowrap">{dateLabel(r.occurredOn)}</td>
                <td>
                  {titleCase(r.type)}
                  {r.note && <span className="dim block text-xs">{r.note}</span>}
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">{r.amount} {r.unit}</td>
                <td className="text-xs">
                  <code>{r.factorKey}</code>
                  <span className="dim block">
                    {r.factorKgPerUnit} kg/{r.factorUnit}{r.source ? ` · ${r.source}` : ''}
                  </span>
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatCo2e(r.gCo2e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function TargetModal({ open, onClose, year, current, onSaved }: {
  open: boolean; onClose: () => void; year: string; current: number | null; onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const toast = useToast();

  const save = async () => {
    try {
      await api.put(`/carbon/target/${year}`, { gCo2e: value.trim() });
      toast.push({ message: `Target set for ${year}` });
      onSaved(); onClose(); setValue(''); setError(undefined);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Carbon target for ${year}`}
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!value.trim()}>Save</button>
           </>}>
      <Field label="Target for the year" error={error}
             hint={`Write it how you think of it: "8 t", "8000 kg". ${
               current ? `Currently ${formatCo2e(current, { long: true })}.` : ''}`}>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)}
               placeholder={current ? formatCo2e(current) : '8 t'} />
      </Field>
      <p className="dim text-sm">
        The year is paced across the months by heating season, not split in twelve,
        so a cold January is not read as failure.
      </p>
    </Modal>
  );
}

/* ──────────────────────────────── energy ────────────────────────────────── */

function EnergyView() {
  const app = useApp();
  const { data, error, loading, reload } = useQuery<any>('/carbon/energy?months=12');
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const byMonth = new Map<string, Record<string, number>>();
  for (const row of data.monthly as Array<{ month: string; type: string; total: number }>) {
    const bucket = byMonth.get(row.month) ?? {};
    bucket[row.type] = (bucket[row.type] ?? 0) + row.total;
    byMonth.set(row.month, bucket);
  }
  const months = [...byMonth.keys()].sort();
  const types = [...new Set(data.monthly.map((m: any) => m.type))] as string[];

  return (
    <div className="space-y-4">
      {!data.profiles.length ? (
        <EmptyState icon="battery" title="No energy measured yet"
                    hint="Enter a utility bill with its quantity, or put a meter on an asset and take readings. Either one is enough." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.profiles.map((p: any) => (
            <Panel key={p.type} title={titleCase(p.type)}>
              <div className="text-2xl font-semibold tabular-nums">
                {Math.round(p.units * 10) / 10} <span className="text-sm dim font-normal">{p.unit}</span>
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="dim">Emitted</dt>
                  <dd className="tabular-nums">{formatCo2e(p.grams)}</dd></div>
                <div className="flex justify-between"><dt className="dim">Cost</dt>
                  <dd className="tabular-nums">{money(p.cost, app.currency)}</dd></div>
                <div className="flex justify-between"><dt className="dim">Window</dt>
                  <dd className="tabular-nums">{p.months} months</dd></div>
              </dl>
            </Panel>
          ))}
        </div>
      )}

      {data.pricePerKwh != null && (
        <Panel title="What you actually pay for electricity">
          <p className="text-2xl font-semibold tabular-nums">
            {(data.pricePerKwh / 100).toFixed(2)}
            <span className="text-sm dim font-normal"> {data.currency} per kWh</span>
          </p>
          <p className="dim text-sm mt-1">
            Derived from this household's own bills, not a national average. Every payback
            figure on the next tab is costed with it.
          </p>
        </Panel>
      )}

      {months.length > 0 && (
        <Panel title="Emissions by fuel" dense>
          <div className="overflow-x-auto scroll-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  {types.map((t) => <th key={t} className="text-right">{titleCase(t)}</th>)}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m}>
                    <td className="tabular-nums">{m}</td>
                    {types.map((t) => (
                      <td key={t} className="text-right tabular-nums">
                        {byMonth.get(m)?.[t] ? formatCo2e(byMonth.get(m)![t]!) : <span className="dim">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Meters />
    </div>
  );
}

function Meters() {
  const { data, reload } = useQuery<any>('/carbon/meters');
  const assets = useQuery<any>('/assets?limit=300');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ assetId: '', kind: 'electricity', unit: 'kwh', emissionFactorKey: 'electricity.grid' });
  const toast = useToast();

  const save = async () => {
    await api.put(`/carbon/meters/${form.assetId}`, {
      kind: form.kind, unit: form.unit, emissionFactorKey: form.emissionFactorKey || null, multiplier: 1,
    });
    toast.push({ message: 'Meter configured. New readings will difference into consumption.' });
    setOpen(false); reload();
  };

  return (
    <Panel title="Meters" dense action={
      <button className="btn btn-sm" onClick={() => setOpen(true)}><Icon name="plus" size={13} /> Meter</button>
    }>
      {!data?.items.length ? (
        <EmptyState icon="cpu" title="No meters yet"
                    hint="A meter turns an asset's readings into consumption on its own: you record the dial, not the difference." />
      ) : (
        <table className="table">
          <thead><tr><th>Asset</th><th>Kind</th><th>Unit</th><th>Factor</th></tr></thead>
          <tbody>
            {data.items.map((m: any) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{titleCase(m.kind)}</td>
                <td className="tabular-nums">{m.unit}</td>
                <td><code className="text-xs">{m.emissionFactorKey ?? '—'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Configure a meter"
             footer={<>
               <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
               <button className="btn btn-primary" onClick={save} disabled={!form.assetId}>Save</button>
             </>}>
        <Field label="Asset">
          <select className="input" value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
            <option value="">Pick an asset…</option>
            {(assets.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="What it measures">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {['electricity', 'natural_gas', 'water', 'generation', 'propane'].map((k) =>
              <option key={k} value={k}>{titleCase(k)}</option>)}
          </select>
        </Field>
        <Field label="Unit on the dial" hint="kwh, ccf, therm, gal, m3">
          <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field label="Emission factor key" hint="Leave blank to use the default for that fuel.">
          <input className="input" value={form.emissionFactorKey}
                 onChange={(e) => setForm({ ...form, emissionFactorKey: e.target.value })} />
        </Field>
      </Modal>
    </Panel>
  );
}

/* ───────────────────────────── interventions ────────────────────────────── */

function Interventions() {
  const app = useApp();
  const candidates = useQuery<any>('/carbon/interventions/candidates');
  const mine = useQuery<any>('/carbon/interventions');
  const toast = useToast();
  const go = useGo();

  const add = async (key: string, name: string) => {
    await api.post('/carbon/interventions', { templateKey: key });
    toast.push({ message: `${name} added to the shortlist` });
    mine.reload();
  };
  const accept = async (id: string, name: string) => {
    const res = await api.post(`/carbon/interventions/${id}/accept`);
    toast.push({ message: `${name} is now a project`, undo: undefined });
    mine.reload();
    go(`/projects/${res.projectId}`);
  };
  const drop = async (id: string) => {
    await api.del(`/carbon/interventions/${id}`);
    mine.reload();
  };

  if (candidates.error) return <ErrorNote error={candidates.error} retry={candidates.reload} />;
  if (candidates.loading && !candidates.data) return <Spinner />;

  return (
    <div className="space-y-4">
      {candidates.data?.electricityPricePerKwh != null && (
        <p className="dim text-sm">
          Costed against what this house actually burns, at{' '}
          <strong>{(candidates.data.electricityPricePerKwh / 100).toFixed(2)} {app.currency}/kWh</strong>{' '}
          from your own bills. Anything marked <em>estimated</em> had nothing measured to work from.
        </p>
      )}

      {!!mine.data?.items.length && (
        <Panel title="Shortlist" dense>
          <table className="table">
            <thead>
              <tr>
                <th>Measure</th><th className="text-right">Cost</th>
                <th className="text-right">Saves a year</th><th className="text-right">Payback</th><th />
              </tr>
            </thead>
            <tbody>
              {mine.data.items.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <span className={`chip ml-2 ${i.basis === 'measured' ? '' : 'opacity-70'}`}>{i.basis}</span>
                    {i.status && i.status !== 'candidate' && <span className="chip ml-1">{i.status}</span>}
                  </td>
                  <td className="text-right tabular-nums">{money(i.capitalCost, app.currency)}</td>
                  <td className="text-right tabular-nums">
                    {money(i.annualSavingCost, app.currency)}
                    <span className="dim block text-xs">{formatCo2e(i.annualSavingGCo2e)}</span>
                  </td>
                  <td className="text-right tabular-nums">
                    {i.annualSavingCost > 0
                      ? `${Math.round((i.capitalCost / i.annualSavingCost) * 100) / 100} yr`
                      : <span className="dim">never</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-sm btn-primary" onClick={() => accept(i.id, i.name)}>
                      Make it a project
                    </button>
                    <button className="btn btn-ghost btn-sm ml-1" onClick={() => drop(i.id)} aria-label="Remove">
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Ranked by what a tonne costs you" dense
             action={<span className="dim text-xs">cheapest abatement first</span>}>
        <p className="dim text-xs px-4 pt-3">
          Net per tonne is what a tonne of avoided CO₂e costs you over the measure's life,
          after the money it saves. Below zero means it pays for itself and then some.
        </p>
        <div className="overflow-x-auto scroll-thin">
          <table className="table">
            <thead>
              <tr>
                <th>Measure</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Saves a year</th>
                <th className="text-right">Pays back</th>
                <th className="text-right">Net per tonne</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(candidates.data?.items ?? []).map((c: any) => (
                <tr key={c.key}>
                  <td>
                    <div className="font-medium">{c.name}</div>
                    <div className="dim text-xs">
                      <span className={`chip mr-1 ${c.estimate.basis === 'measured' ? '' : 'opacity-70'}`}>
                        {c.estimate.basis}
                      </span>
                      {c.estimate.basisNote}
                    </div>
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">{money(c.capitalCost, app.currency)}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {c.estimate.annualSavingGCo2e > 0 ? formatCo2e(c.estimate.annualSavingGCo2e) : <span className="dim">nothing</span>}
                    <span className="dim block text-xs">{money(c.estimate.annualSavingCost, app.currency)}</span>
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {c.payback.financialYears != null
                      ? `${c.payback.financialYears} yr`
                      : <span className="dim">never</span>}
                    {c.payback.carbonYears != null && (
                      <span className="dim block text-xs">{c.payback.carbonYears} yr carbon</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {c.payback.costPerTonne == null ? <span className="dim">—</span>
                      : c.payback.costPerTonne <= 0 ? (
                        <span className="text-brand-600 dark:text-brand-500">
                          {moneyExact(-c.payback.costPerTonne, app.currency)}
                          <span className="dim block text-xs">in your pocket</span>
                        </span>
                      ) : moneyExact(c.payback.costPerTonne, app.currency)}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => add(c.key, c.name)}>Shortlist</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ───────────────────────────────  factors  ──────────────────────────────── */

function Factors() {
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useQuery<any>(
    `/carbon/factors?limit=300${search ? `&q=${encodeURIComponent(search)}` : ''}`, [search]);
  const [editing, setEditing] = useState<any>(null);
  const [recalc, setRecalc] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const f of data?.items ?? []) {
      const list = m.get(f.category) ?? [];
      list.push(f);
      m.set(f.category, list);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  if (error) return <ErrorNote error={error} retry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input className="input max-w-xs" placeholder="Search factors…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-sm" onClick={() => setRecalc(true)}>
          <Icon name="repeat" size={13} /> Recalculate
        </button>
      </div>
      <p className="dim text-sm">
        Every emission stores the factor value it was computed with, so correcting a factor
        here never silently rewrites what you already recorded. Recalculation is a separate,
        deliberate act, and it shows you the diff first.
      </p>

      {loading && !data && <Spinner />}
      {grouped.map(([category, items]) => (
        <Panel key={category} title={titleCase(category)} dense>
          <table className="table">
            <thead>
              <tr>
                <th>Factor</th><th className="text-right">kg CO₂e</th><th>Per</th>
                <th className="text-center">Scope</th><th>Source</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((f: any) => (
                <tr key={f.id}>
                  <td>
                    {f.name}
                    <code className="dim block text-xs">{f.key}{f.region ? ` · ${f.region}` : ''}</code>
                  </td>
                  <td className="text-right tabular-nums">{f.kgPerUnit}</td>
                  <td className="dim">{f.activityUnit}</td>
                  <td className="text-center tabular-nums">{f.scope}</td>
                  <td className="text-xs dim">
                    {f.source ?? '—'}
                    <span className={`chip ml-1 ${f.confidence === 'low' ? 'opacity-60' : ''}`}>{f.confidence}</span>
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)} aria-label="Edit">
                      <Icon name="edit" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}

      <EditFactor factor={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <Recalculate open={recalc} onClose={() => setRecalc(false)} />
    </div>
  );
}

function EditFactor({ factor, onClose, onSaved }: { factor: any; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const toast = useToast();
  const open = !!factor;

  const save = async () => {
    await api.patch(`/carbon/factors/${factor.id}`, {
      kgPerUnit: Number(value),
      notes: note || factor.notes,
      source: note ? 'Household override' : factor.source,
      updatedAt: factor.updatedAt,
    });
    toast.push({ message: `${factor.name} updated. Existing records keep their old value until you recalculate.` });
    onSaved(); onClose(); setValue(''); setNote('');
  };

  return (
    <Modal open={open} onClose={onClose} title={factor ? `Correct "${factor.name}"` : ''}
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!Number.isFinite(Number(value)) || !value}>
               Save
             </button>
           </>}>
      {factor && (
        <>
          <Field label={`kg CO₂e per ${factor.activityUnit}`}
                 hint={`Shipped value ${factor.kgPerUnit}, from ${factor.source ?? 'an unnamed source'}.`}>
            <input className="input" type="number" step="any" value={value}
                   onChange={(e) => setValue(e.target.value)} placeholder={String(factor.kgPerUnit)} />
          </Field>
          <Field label="Why" hint="Your own utility's disclosure beats a national average. Say where it came from.">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="From the 2026 supplier disclosure" />
          </Field>
        </>
      )}
    </Modal>
  );
}

function Recalculate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const year = app.today.slice(0, 4);
  const [range, setRange] = useState({ from: `${year}-01-01`, to: app.today });
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const run = async (apply: boolean) => {
    setBusy(true);
    try {
      const res = await api.post('/carbon/recalculate', { ...range, apply });
      setPreview(res);
      if (apply) { toast.push({ message: 'Recalculated and recorded in the audit log' }); onClose(); }
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Recalculate emissions" wide
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn" onClick={() => run(false)} disabled={busy}>Preview</button>
             <button className="btn btn-primary" onClick={() => run(true)} disabled={busy || !preview}>
               Apply
             </button>
           </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input className="input" type="date" value={range.from}
                 onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={range.to}
                 onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
      </div>
      {!preview && <p className="dim text-sm">Preview first. Nothing is written until you apply.</p>}
      {preview && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Before" value={formatCo2e(preview.before)} />
            <StatTile label="After" value={formatCo2e(preview.after)} />
            <StatTile label="Change" value={formatCo2e(preview.after - preview.before)}
                      tone={preview.after > preview.before ? 'bad' : preview.after < preview.before ? 'good' : 'default'} />
          </div>
          <p className="dim text-sm">
            {preview.changed} of {preview.considered} emissions would change.
            {preview.applied ? ' Applied.' : ' Nothing has been written yet.'}
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── recording something by hand ──────────────────── */

function AddActivity({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const [form, setForm] = useState({ type: 'electricity', amount: '', unit: 'kwh', occurredOn: app.today, note: '' });
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const save = async () => {
    setError(undefined);
    try {
      const res = await api.post('/carbon/activities', {
        type: form.type,
        amount: Number(form.amount),
        unit: form.unit.trim(),
        occurredOn: form.occurredOn,
        note: form.note || null,
      });
      setResult(res);
      toast.push({ message: `Recorded ${formatCo2e(res.gCo2e)}` });
      setForm({ ...form, amount: '', note: '' });
    } catch (e) { setError((e as Error).message); }
  };

  const close = () => { setResult(null); setError(undefined); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Record an activity"
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.amount}>Record</button>
           </>}>
      <p className="dim text-sm mb-3">
        Most emissions arrive on their own, from a bill, a meter reading, a shop or a project.
        This is for the ones that do not: a flight, a tank of propane, a skip.
      </p>
      <Field label="What">
        <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" error={error}>
          <input className="input" type="number" step="any" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Unit" hint="kwh, therm, gal, kg, mi">
          <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
      </div>
      <Field label="When">
        <input className="input" type="date" value={form.occurredOn}
               onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} />
      </Field>
      <Field label="Note">
        <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
               placeholder="Optional" />
      </Field>
      {result && (
        <div className="panel p-3 mt-2">
          <div className="text-sm font-medium">{formatCo2e(result.gCo2e, { long: true })}</div>
          <ul className="dim text-xs mt-1 space-y-0.5">
            {result.emissions.map((e: any) => (
              <li key={e.id}>
                <code>{e.factorKey}</code> — {e.factorKgPerUnit} kg/{e.factorUnit}, scope {e.scope}
              </li>
            ))}
          </ul>
          {result.unresolved && <p className="text-xs text-amber-600 mt-1">{result.unresolved}</p>}
        </div>
      )}
    </Modal>
  );
}

/** The Today tile. Carbon sits beside money, not in a report nobody opens. */
export function CarbonTile({ carbon }: { carbon: any }) {
  const go = useGo();
  if (!carbon) return null;
  const change = carbon.changePct;
  return (
    <StatTile
      label="Carbon this month" value={formatCo2e(carbon.gCo2e)} icon="leaf"
      onClick={() => go('/carbon')}
      tone={change == null ? 'default' : change > 0 ? 'bad' : 'good'}
      sub={change == null
        ? (carbon.target?.pct != null ? `${carbon.target.pct}% of the year's target` : 'no comparison yet')
        : `${change > 0 ? '+' : ''}${change}% on the same month last year`}
    />
  );
}
