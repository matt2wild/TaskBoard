import { useState } from 'react';
import { formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { LineChart } from '../components/Chart';
import {
  EmptyState, ErrorNote, Field, Modal, Panel, Progress, Spinner, StatTile, useToast,
} from '../components/ui';

const HEALTH_TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = {
  cooking: 'good', cooling: 'warn', stalled: 'warn', cold: 'default', unknown: 'default',
};
/** Progress takes no neutral tone, so an unknown balance simply gets none. */
const BALANCE_TONE: Record<string, 'good' | 'warn' | undefined> = {
  good: 'good', too_wet: 'warn', too_dry: 'warn',
};

export function Compost() {
  const app = useApp();
  const { data, error, loading, reload } = useQuery<any>('/compost/overview');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Compost</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> System
        </button>
      </header>

      {!data?.systems.length ? (
        <EmptyState icon="box" title="No compost system yet"
                    hint="A pile, a tumbler, a worm bin or the council collection. Whichever it is, it is the household's largest per-kilogram greenhouse gas decision."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add one</button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Diverted this year"
                      value={`${Math.round(data.year.divertedKg)} kg`} icon="repeat"
                      sub="kept out of the bin" />
            <StatTile label="Compost made" value={`${Math.round(data.year.outputs)} cu ft`} icon="box"
                      sub={`${money(data.year.displacedCost, app.currency)} not spent`} />
            <StatTile label="Turns due" value={data.turnsDue.length} icon="clock"
                      tone={data.turnsDue.length ? 'warn' : 'default'}
                      sub={data.turnsDue.length ? data.turnsDue.map((t: any) => t.system.name).join(', ') : 'all turned'} />
            <StatTile label="Landfill avoided" value={formatCo2e(data.avoided.gCo2e100)} icon="leaf"
                      tone="good" sub={`${formatCo2e(data.avoided.gCo2e20)} over 20 years`} />
          </div>

          {/* The whole argument for the heap, stated once and honestly. */}
          <Panel title="What the pile is actually worth">
            <p className="text-sm">
              Food in a landfill decomposes without oxygen and produces methane. The same food
              in a working pile produces mostly carbon dioxide and a fraction of the methane.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mt-3">
              <div>
                <div className="dim text-xs">Avoided, over a hundred years</div>
                <div className="text-2xl font-semibold tabular-nums">{formatCo2e(data.avoided.gCo2e100)}</div>
              </div>
              <div>
                <div className="dim text-xs">Avoided, over twenty years</div>
                <div className="text-2xl font-semibold tabular-nums text-brand-600 dark:text-brand-500">
                  {formatCo2e(data.avoided.gCo2e20)}
                </div>
              </div>
            </div>
            <p className="dim text-sm mt-3">{data.avoided.note}</p>
          </Panel>

          <div className="grid sm:grid-cols-2 gap-3">
            {data.systems.map((s: any) => (
              <button key={s.system.id} className="panel p-4 text-left card-hover"
                      onClick={() => setOpen(s.system.id)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{s.system.name}</span>
                  <span className="dim text-xs">{titleCase(s.system.method)}</span>
                </div>
                <p className={`text-sm mt-1 ${
                  HEALTH_TONE[s.status.health] === 'good' ? 'text-brand-600 dark:text-brand-500'
                    : HEALTH_TONE[s.status.health] === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'dim'}`}>
                  {s.status.note}
                </p>
                {s.balance.ratio != null && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="dim">Carbon to nitrogen</span>
                      <span className="tabular-nums font-medium">{s.balance.ratio.toFixed(0)}:1</span>
                    </div>
                    <div className="mt-1">
                      <Progress value={Math.min(s.balance.ratio, 60)} max={60}
                                tone={BALANCE_TONE[s.balance.status]} />
                    </div>
                    <p className="dim text-xs mt-1">{s.balance.advice}</p>
                  </div>
                )}
                {s.readyOn && (
                  <p className="dim text-xs mt-2">Likely ready {dateLabel(s.readyOn)}</p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <NewSystem open={adding} onClose={() => setAdding(false)} onSaved={reload} />
      <SystemDetail systemId={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

function NewSystem({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', method: 'hot_pile', capacity: '' });
  const toast = useToast();
  const save = async () => {
    await api.post('/compost/systems', {
      name: form.name, method: form.method,
      capacity: form.capacity ? Number(form.capacity) : null,
    });
    toast.push({ message: `${form.name} added` });
    onSaved(); onClose(); setForm({ name: '', method: 'hot_pile', capacity: '' });
  };
  return (
    <Modal open={open} onClose={onClose} title="New compost system"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>Add</button>
           </>}>
      <Field label="Name"><input className="input" value={form.name} placeholder="The heap"
             onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Method"
             hint="A hot pile is turned every few days and gets genuinely hot. A cold pile is left alone, and makes more methane for it.">
        <select className="input" value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}>
          {['hot_pile', 'cold_pile', 'tumbler', 'worm', 'bokashi', 'trench', 'municipal'].map((m) =>
            <option key={m} value={m}>{titleCase(m)}</option>)}
        </select>
      </Field>
      <Field label="Capacity (cu ft)"><input className="input" type="number" value={form.capacity}
             onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
    </Modal>
  );
}

function SystemDetail({ systemId, onClose, onChanged }: {
  systemId: string | null; onClose: () => void; onChanged: () => void;
}) {
  const { data, loading, reload } = useQuery<any>(
    systemId ? `/compost/systems/${systemId}/detail` : null, [systemId]);
  const [feeding, setFeeding] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const toast = useToast();

  const event = async (kind: string, temperatureF?: number) => {
    await api.post(`/compost/systems/${systemId}/events`, { kind, temperatureF: temperatureF ?? null });
    toast.push({ message: kind === 'turned' ? 'Turned' : 'Recorded' });
    reload(); onChanged();
  };

  return (
    <Modal open={!!systemId} onClose={onClose} wide title={data?.system.name ?? ''}
           footer={<>
             <button className="btn" onClick={() => event('turned')}>
               <Icon name="repeat" size={13} /> Turned it
             </button>
             <button className="btn" onClick={() => setEmptying(true)}>Take compost out</button>
             <button className="btn btn-primary" onClick={() => setFeeding(true)}>Add material</button>
           </>}>
      {loading && <Spinner />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="In the pile" value={`${Math.round(data.totals.inputKg)} kg`} />
            <StatTile label="Turns" value={data.totals.turns} />
            <StatTile label="C:N" value={data.balance.ratio ? `${data.balance.ratio.toFixed(0)}:1` : '—'}
                      tone={BALANCE_TONE[data.balance.status]} />
          </div>

          <div className="panel p-3">
            <p className="text-sm">{data.status.note}</p>
            <p className="dim text-sm mt-1">{data.balance.advice}</p>
            {data.advice.suggestion && (
              <p className="text-sm mt-2">
                <Icon name="alert" size={13} className="inline mr-1 text-amber-600" />
                About {data.advice.suggestion.kg} kg of {data.advice.suggestion.name.toLowerCase()} would fix it.
              </p>
            )}
          </div>

          {data.temperatureSeries.length > 1 && (
            <Panel title="Temperature">
              <LineChart series={data.temperatureSeries} unit="°F" refLow={130} refHigh={160} />
              <p className="dim text-xs mt-1">
                The band is the thermophilic range — hot enough to kill weed seed and pathogens.
              </p>
            </Panel>
          )}

          <Panel title="What went in" dense>
            {!data.inputs.length ? <EmptyState icon="box" title="Nothing yet" /> : (
              <table className="table">
                <thead><tr><th>Date</th><th>Material</th><th className="text-right">Amount</th><th className="text-right">C:N</th></tr></thead>
                <tbody>
                  {data.inputs.slice(0, 20).map((i: any) => (
                    <tr key={i.id}>
                      <td className="dim whitespace-nowrap">{dateLabel(i.occurredOn)}</td>
                      <td>
                        {i.material?.name ?? i.materialKey}
                        {i.sourceType === 'waste_log' && <span className="chip ml-2">from the pantry</span>}
                      </td>
                      <td className="text-right tabular-nums">{i.quantity} {i.unit}</td>
                      <td className="text-right tabular-nums dim">{i.cnRatio}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {!!data.outputs.length && (
            <Panel title="What came out" dense>
              <table className="table">
                <tbody>
                  {data.outputs.map((o: any) => (
                    <tr key={o.id}>
                      <td className="dim">{dateLabel(o.occurredOn)}</td>
                      <td className="tabular-nums">{o.quantity} {o.unit}</td>
                      <td className="text-right dim">{o.bedId ? 'to a bed' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}

      <FeedModal open={feeding} onClose={() => setFeeding(false)} systemId={systemId}
                 onSaved={() => { reload(); onChanged(); }} />
      <EmptyModal open={emptying} onClose={() => setEmptying(false)} systemId={systemId}
                  onSaved={() => { reload(); onChanged(); }} />
    </Modal>
  );
}

function FeedModal({ open, onClose, systemId, onSaved }: {
  open: boolean; onClose: () => void; systemId: string | null; onSaved: () => void;
}) {
  const materials = useQuery<any>(open ? '/compost/materials' : null);
  const [form, setForm] = useState({ materialKey: 'kitchen_scraps', quantity: '', unit: 'kg' });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>();
  const toast = useToast();

  const usable = (materials.data?.items ?? []).filter((m: any) => m.acceptable);
  const refused = (materials.data?.items ?? []).filter((m: any) => !m.acceptable);
  const chosen = (materials.data?.items ?? []).find((m: any) => m.key === form.materialKey);

  const save = async () => {
    setError(undefined);
    try {
      const res = await api.post(`/compost/systems/${systemId}/inputs`, {
        materialKey: form.materialKey, quantity: Number(form.quantity), unit: form.unit,
      });
      setResult(res);
      toast.push({ message: 'In the pile' });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const close = () => { setResult(null); setError(undefined); setForm({ ...form, quantity: '' }); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Add material"
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.quantity}>Add</button>
           </>}>
      <Field label="What" error={error}>
        <select className="input" value={form.materialKey}
                onChange={(e) => { setForm({ ...form, materialKey: e.target.value }); setError(undefined); }}>
          <optgroup label="Greens (nitrogen)">
            {usable.filter((m: any) => m.kind === 'green').map((m: any) =>
              <option key={m.key} value={m.key}>{m.name} — {m.cnRatio}:1</option>)}
          </optgroup>
          <optgroup label="Browns (carbon)">
            {usable.filter((m: any) => m.kind === 'brown').map((m: any) =>
              <option key={m.key} value={m.key}>{m.name} — {m.cnRatio}:1</option>)}
          </optgroup>
          <optgroup label="Not for a domestic pile">
            {refused.map((m: any) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </optgroup>
        </select>
      </Field>
      {chosen && !chosen.acceptable && (
        <p className="text-sm text-amber-600 dark:text-amber-400 -mt-1 mb-3">{chosen.caution}</p>
      )}
      {chosen?.acceptable && chosen.caution && (
        <p className="dim text-sm -mt-1 mb-3">{chosen.caution}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much"><input className="input" type="number" step="any" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Unit">
          <select className="input" value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['kg', 'lb'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      {result && (
        <div className="panel p-3 space-y-1">
          <p className="text-sm">{result.balance.advice}</p>
          {result.avoided && (
            <p className="dim text-xs">
              Avoided {formatCo2e(result.avoided.gCo2e100)} over a hundred years,{' '}
              {formatCo2e(result.avoided.gCo2e20)} over twenty — against {result.avoided.counterfactual}.
            </p>
          )}
          <p className="dim text-xs">
            The pile itself emitted {formatCo2e(result.gCo2e)}. Small, and not zero.
          </p>
        </div>
      )}
    </Modal>
  );
}

function EmptyModal({ open, onClose, systemId, onSaved }: {
  open: boolean; onClose: () => void; systemId: string | null; onSaved: () => void;
}) {
  const beds = useQuery<any>(open ? '/garden/beds?limit=100' : null);
  const [form, setForm] = useState({ quantity: '', unit: 'cuft', bedId: '' });
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const save = async () => {
    const res = await api.post(`/compost/systems/${systemId}/outputs`, {
      quantity: Number(form.quantity), unit: form.unit, bedId: form.bedId || null,
    });
    setResult(res);
    toast.push({ message: 'Compost out' });
    onSaved();
  };
  const close = () => { setResult(null); setForm({ ...form, quantity: '' }); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Take compost out"
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.quantity}>Record</button>
           </>}>
      <p className="dim text-sm mb-3">
        Compost going to a bed is one record: an output of the pile and an input to the
        garden, with its displaced cost computed from it.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much"><input className="input" type="number" step="any" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Unit">
          <select className="input" value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['cuft', 'l', 'kg'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Where it went">
        <select className="input" value={form.bedId}
                onChange={(e) => setForm({ ...form, bedId: e.target.value })}>
          <option value="">Nowhere in particular</option>
          {(beds.data?.items ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      {result && (
        <p className="text-sm">
          {result.bed ? `Onto ${result.bed.name}. ` : ''}
          Worth about {money(result.displaced, 'USD')} of bought compost.
        </p>
      )}
    </Modal>
  );
}
