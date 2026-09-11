import { useState } from 'react';
import { CIRCULATION_KINDS, formatCo2e, REPAIR_OUTCOMES } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  EmptyState, ErrorNote, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

type Tab = 'summary' | 'repairs' | 'circulation' | 'avoided';

export function Circular() {
  const [tab, setTab] = useState<Tab>('summary');
  const [repairing, setRepairing] = useState(false);
  const [logging, setLogging] = useState(false);
  const { data, error, loading, reload } = useQuery<any>('/circularity');

  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Repair and reuse</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setLogging(true)}>
            <Icon name="repeat" size={13} /> Circulation
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setRepairing(true)}>
            <Icon name="wrench" size={13} /> Repair
          </button>
        </div>
      </header>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'summary', label: 'Summary' },
        { id: 'repairs', label: 'Repairs', count: data?.repairs.count },
        { id: 'circulation', label: 'Circulation', count: data?.circulation.count },
        { id: 'avoided', label: 'Avoided' },
      ]} />

      {tab === 'summary' && <Summary data={data} />}
      {tab === 'repairs' && <Repairs data={data} onChanged={reload} onAdd={() => setRepairing(true)} />}
      {tab === 'circulation' && <Circulation data={data} onAdd={() => setLogging(true)} />}
      {tab === 'avoided' && <Avoided data={data} />}

      <RepairModal open={repairing} onClose={() => setRepairing(false)} onSaved={reload} />
      <CirculationModal open={logging} onClose={() => setLogging(false)} onSaved={reload} />
    </div>
  );
}

function Summary({ data }: { data: any }) {
  const app = useApp();
  if (!data) return null;
  return (
    <div className="space-y-4">
      <p className="dim text-sm">
        Every other part of this app records what was spent. This records what was not:
        the things that did not have to be bought because something already owned was fixed,
        adapted, passed on, or grown.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Repairs" value={data.repairs.count} icon="wrench"
                  sub={data.repairs.successRate != null
                    ? `${Math.round(data.repairs.successRate * 100)}% held`
                    : 'none yet'} />
        <StatTile label="Spent on parts" value={money(data.repairs.partsCost, app.currency)} icon="coin" />
        <StatTile label="Not spent" value={money(data.avoided.cost, app.currency)} icon="bank"
                  tone="good" sub="on replacements" />
        <StatTile label="Carbon avoided" value={formatCo2e(data.avoided.total100)} icon="leaf"
                  tone="good" sub={`${formatCo2e(data.avoided.total20)} over 20 years`} />
      </div>

      <Panel title="Where the avoidance came from" dense>
        {!data.avoided.byCategory.length ? (
          <EmptyState icon="leaf" title="Nothing avoided yet"
                      hint="Repair something, compost something, or harvest something, and it will show here." />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Route</th><th className="text-right">100 years</th>
                <th className="text-right">20 years</th><th className="text-right">Money</th></tr>
            </thead>
            <tbody>
              {data.avoided.byCategory.map((c: any) => (
                <tr key={c.category}>
                  <td>{titleCase(c.category)}</td>
                  <td className="text-right tabular-nums">{formatCo2e(c.total100)}</td>
                  <td className="text-right tabular-nums">{formatCo2e(c.total20)}</td>
                  <td className="text-right tabular-nums">{money(c.cost, app.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Seed self-sufficiency">
        {data.seeds.total === 0 ? (
          <p className="dim text-sm">Nothing sown from a recorded seed lot yet.</p>
        ) : (
          <>
            <div className="text-2xl font-semibold tabular-nums">
              {data.seeds.pct}%
              <span className="text-sm dim font-normal ml-2">
                of {data.seeds.total} sowing{data.seeds.total === 1 ? '' : 's'} from saved, swapped or gifted seed
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {data.seeds.byOrigin.map((o: any) => (
                <span key={o.origin} className="chip">{titleCase(o.origin)} {o.count}</span>
              ))}
            </div>
          </>
        )}
      </Panel>

      <p className="dim text-xs">{data.avoided.note}</p>
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  fixed: 'text-brand-600 dark:text-brand-500',
  partial: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
  replaced: 'dim',
};

function Repairs({ data, onChanged, onAdd }: { data: any; onChanged: () => void; onAdd: () => void }) {
  const app = useApp();
  const toast = useToast();
  const list = useQuery<any>('/repairs?limit=200');

  const drop = async (id: string) => {
    await api.del(`/repairs/${id}`);
    toast.push({ message: 'Repair removed' });
    list.reload(); onChanged();
  };

  if (!list.data?.items.length) {
    return <EmptyState icon="wrench" title="Nothing repaired yet"
                       hint="A failed repair is worth recording too — it is why you replaced the thing."
                       action={<button className="btn btn-primary" onClick={onAdd}>Log a repair</button>} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Held" value={data.repairs.fixed} tone="good" />
        <StatTile label="Partly" value={data.repairs.partial} />
        <StatTile label="Did not hold" value={data.repairs.failed}
                  tone={data.repairs.failed ? 'bad' : 'default'} />
      </div>
      <Panel dense>
        <div className="overflow-x-auto scroll-thin">
          <table className="table">
            <thead>
              <tr>
                <th>What</th><th>Symptom</th><th className="text-right">Parts</th>
                <th className="text-right">Life bought</th><th className="text-right">Avoided</th><th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.targetLabel}</div>
                    <div className="dim text-xs">
                      {dateLabel(r.occurredOn)} ·{' '}
                      <span className={OUTCOME_TONE[r.outcome]}>{titleCase(r.outcome)}</span>
                    </div>
                  </td>
                  <td>
                    {r.symptom}
                    {r.workDone && <span className="dim block text-xs">{r.workDone}</span>}
                  </td>
                  <td className="text-right tabular-nums">{money(r.partsCost, app.currency)}</td>
                  <td className="text-right tabular-nums">
                    {r.extendedLifeYears ? `${r.extendedLifeYears} yr` : <span className="dim">—</span>}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.avoidedGCo2e ? (
                      <>
                        {formatCo2e(r.avoidedGCo2e)}
                        <span className="dim block text-xs">{money(r.avoidedCost, app.currency)}</span>
                      </>
                    ) : <span className="dim">—</span>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => drop(r.id)} aria-label="Remove">
                      <Icon name="trash" size={13} />
                    </button>
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

function Circulation({ data, onAdd }: { data: any; onAdd: () => void }) {
  const app = useApp();
  const list = useQuery<any>('/circulation?limit=200');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Logged this year" value={data.circulation.count} icon="repeat" />
        <StatTile label="Out on loan" value={data.circulation.loansOut} icon="handshake"
                  sub="counted from the loans themselves" />
      </div>
      <p className="dim text-sm">
        Loans, declutter disposals and compost inputs are circulation by virtue of what they
        are, and are counted from their own records rather than entered here twice.
      </p>
      {!list.data?.items.length ? (
        <EmptyState icon="repeat" title="Nothing logged"
                    hint="Something repurposed, given away, swapped or salvaged."
                    action={<button className="btn btn-primary" onClick={onAdd}>Log one</button>} />
      ) : (
        <Panel dense>
          <table className="table">
            <thead><tr><th>Date</th><th>Route</th><th>What</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {list.data.items.map((e: any) => (
                <tr key={e.id}>
                  <td className="dim whitespace-nowrap">{dateLabel(e.occurredOn)}</td>
                  <td><span className="chip">{titleCase(e.kind)}</span></td>
                  <td>
                    {e.itemText}
                    {e.note && <span className="dim block text-xs">{e.note}</span>}
                  </td>
                  <td className="text-right tabular-nums">
                    {e.value != null ? money(e.value, app.currency) : <span className="dim">—</span>}
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

function Avoided({ data }: { data: any }) {
  const app = useApp();
  return (
    <div className="space-y-4">
      <Panel title="Every avoided figure, with what it is counterfactual to">
        <p className="dim text-sm">
          An avoided tonne is a statement about a world that did not happen. These are
          reported beside the household footprint and never subtracted from it — conflating
          the two is the most common dishonesty in carbon accounting, which is why each one
          below states its counterfactual in words.
        </p>
      </Panel>
      {!data.avoided.items.length ? (
        <EmptyState icon="leaf" title="Nothing avoided yet" />
      ) : (
        <Panel dense>
          <div className="overflow-x-auto scroll-thin">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Route</th><th>Counterfactual</th>
                  <th className="text-right">100 yr</th><th className="text-right">20 yr</th>
                  <th className="text-right">Money</th></tr>
              </thead>
              <tbody>
                {data.avoided.items.map((a: any) => (
                  <tr key={a.id}>
                    <td className="dim whitespace-nowrap">{dateLabel(a.occurredOn)}</td>
                    <td><span className="chip">{titleCase(a.category)}</span></td>
                    <td className="text-sm">{a.counterfactual}</td>
                    <td className="text-right tabular-nums">{formatCo2e(a.gCo2e100)}</td>
                    <td className="text-right tabular-nums">{formatCo2e(a.gCo2e20)}</td>
                    <td className="text-right tabular-nums">
                      {a.cost ? money(a.cost, app.currency) : <span className="dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function RepairModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const assets = useQuery<any>(open ? '/assets?limit=300' : null);
  const [form, setForm] = useState({
    targetId: '', targetText: '', symptom: '', workDone: '',
    partsCost: '', timeMin: '', outcome: 'fixed', extendedLifeYears: '',
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>();
  const toast = useToast();

  const compare = useQuery<any>(
    open && form.targetId && form.partsCost
      ? `/assets/${form.targetId}/repair-or-replace?repairCost=${
        Math.round(Number(form.partsCost) * 100)}${
        form.extendedLifeYears ? `&extendedLifeYears=${form.extendedLifeYears}` : ''}`
      : null,
    [form.targetId, form.partsCost, form.extendedLifeYears],
  );

  const save = async () => {
    setError(undefined);
    try {
      const res = await api.post('/repairs', {
        targetType: form.targetId ? 'asset' : null,
        targetId: form.targetId || null,
        targetText: form.targetId ? null : (form.targetText || null),
        symptom: form.symptom,
        workDone: form.workDone || null,
        partsCost: Math.round(Number(form.partsCost || 0) * 100),
        timeMin: form.timeMin ? Number(form.timeMin) : null,
        outcome: form.outcome,
        extendedLifeYears: form.extendedLifeYears ? Number(form.extendedLifeYears) : null,
      });
      setResult(res);
      toast.push({ message: 'Repair logged' });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const close = () => {
    setResult(null); setError(undefined);
    setForm({ targetId: '', targetText: '', symptom: '', workDone: '', partsCost: '', timeMin: '', outcome: 'fixed', extendedLifeYears: '' });
    onClose();
  };

  return (
    <Modal open={open} onClose={close} wide title="Log a repair"
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save}
                     disabled={!form.symptom.trim() || (!form.targetId && !form.targetText.trim())}>
               Log it
             </button>
           </>}>
      <Field label="What was repaired">
        <select className="input" value={form.targetId}
                onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
          <option value="">Something not in the registry…</option>
          {(assets.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {!form.targetId && (
        <Field label="What was it"><input className="input" value={form.targetText}
               onChange={(e) => setForm({ ...form, targetText: e.target.value })}
               placeholder="Kitchen chair" /></Field>
      )}
      <Field label="What went wrong" error={error}>
        <input className="input" value={form.symptom}
               onChange={(e) => setForm({ ...form, symptom: e.target.value })}
               placeholder="Not draining" />
      </Field>
      <Field label="What you did"><input className="input" value={form.workDone}
             onChange={(e) => setForm({ ...form, workDone: e.target.value })}
             placeholder="Replaced the drain pump" /></Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Parts"><input className="input" inputMode="decimal" value={form.partsCost}
               onChange={(e) => setForm({ ...form, partsCost: e.target.value })} placeholder="54.00" /></Field>
        <Field label="Minutes"><input className="input" type="number" value={form.timeMin}
               onChange={(e) => setForm({ ...form, timeMin: e.target.value })} /></Field>
        <Field label="Outcome">
          <select className="input" value={form.outcome}
                  onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
            {REPAIR_OUTCOMES.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
          </select>
        </Field>
      </div>
      {(form.outcome === 'fixed' || form.outcome === 'partial') && (
        <Field label="Years of life it bought"
               hint="Left blank, a conservative two years is assumed. This is what moves the replacement forecast.">
          <input className="input" type="number" step="any" value={form.extendedLifeYears}
                 onChange={(e) => setForm({ ...form, extendedLifeYears: e.target.value })} placeholder="4" />
        </Field>
      )}

      {compare.data && !result && (
        <div className="panel p-3 space-y-2">
          <div className="text-sm font-medium">Repair or replace, per year of service</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="dim text-xs">Repairing</div>
              <div className="tabular-nums">{money(compare.data.verdict.repairCostPerYear, 'USD')}/yr</div>
              <div className="dim tabular-nums text-xs">{formatCo2e(compare.data.verdict.repairGCo2ePerYear)}/yr</div>
            </div>
            <div>
              <div className="dim text-xs">Replacing</div>
              <div className="tabular-nums">{money(compare.data.verdict.replaceCostPerYear, 'USD')}/yr</div>
              <div className="dim tabular-nums text-xs">{formatCo2e(compare.data.verdict.replaceGCo2ePerYear)}/yr</div>
            </div>
          </div>
          <p className="text-sm">{compare.data.verdict.note}</p>
          <p className="dim text-xs">Assuming {compare.data.assumptions.join('; ')}.</p>
        </div>
      )}

      {result && (
        <div className="panel p-3">
          {result.avoided ? (
            <>
              <div className="text-sm font-medium">
                Avoided {formatCo2e(result.avoided.gCo2e)} and {money(result.avoided.cost, 'USD')}
              </div>
              <p className="dim text-xs mt-1">{result.avoided.counterfactual}</p>
              <p className="dim text-xs mt-1">
                Reported beside the footprint, never subtracted from it.
              </p>
            </>
          ) : (
            <p className="text-sm dim">
              Recorded. A repair that did not hold is credited with nothing, which is the point
              of recording it.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function CirculationModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ kind: 'given', itemText: '', value: '', note: '' });
  const toast = useToast();
  const save = async () => {
    await api.post('/circulation', {
      kind: form.kind,
      itemText: form.itemText || null,
      value: form.value ? Math.round(Number(form.value) * 100) : null,
      note: form.note || null,
    });
    toast.push({ message: 'Logged' });
    onSaved(); onClose(); setForm({ kind: 'given', itemText: '', value: '', note: '' });
  };
  return (
    <Modal open={open} onClose={onClose} title="Kept in circulation"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.itemText.trim()}>Log it</button>
           </>}>
      <Field label="What happened to it">
        <select className="input" value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {CIRCULATION_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
        </select>
      </Field>
      <Field label="What"><input className="input" value={form.itemText}
             onChange={(e) => setForm({ ...form, itemText: e.target.value })}
             placeholder="Two boxes of tile offcuts" /></Field>
      <Field label="Worth roughly"><input className="input" inputMode="decimal" value={form.value}
             onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="40.00" /></Field>
      <Field label="Note"><input className="input" value={form.note}
             onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </Modal>
  );
}
