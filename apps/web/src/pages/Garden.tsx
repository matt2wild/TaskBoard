import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCo2e, SEED_ORIGINS, SOW_METHODS } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp, useGo } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  EmptyState, ErrorNote, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

type Tab = 'growing' | 'beds' | 'seeds' | 'harvest';

export function Garden() {
  const [tab, setTab] = useState<Tab>('growing');
  const [sowing, setSowing] = useState(false);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Garden</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setSowing(true)}>
          <Icon name="plus" size={13} /> Sow something
        </button>
      </header>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'growing', label: 'Growing' },
        { id: 'beds', label: 'Beds' },
        { id: 'seeds', label: 'Seed drawer' },
        { id: 'harvest', label: 'Harvest' },
      ]} />
      {tab === 'growing' && <Growing onSow={() => setSowing(true)} />}
      {tab === 'beds' && <Beds />}
      {tab === 'seeds' && <SeedDrawer />}
      {tab === 'harvest' && <HarvestLog />}
      <SowModal open={sowing} onClose={() => setSowing(false)} />
    </div>
  );
}

/* ─────────────────────────────── growing ────────────────────────────────── */

const STATUS_TONE: Record<string, string> = {
  planned: '', growing: '', harvesting: 'text-brand-600 dark:text-brand-500',
  finished: 'dim', failed: 'text-red-600 dark:text-red-400',
};

function Growing({ onSow }: { onSow: () => void }) {
  const app = useApp();
  const { data, error, loading, reload } = useQuery<any>('/garden/overview');
  const [frost, setFrost] = useState(false);

  if (error) return <ErrorNote error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  if (!data.beds.length) {
    return (
      <EmptyState icon="leaf" title="No beds yet"
                  hint="A bed is a place with a history, not a drawing: what grew there is what makes rotation checkable."
                  action={<NewBed onDone={reload} />} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Growing now" value={data.plantings.length} icon="leaf"
                  sub={`across ${data.beds.length} bed${data.beds.length === 1 ? '' : 's'}`} />
        <StatTile label="Harvested this year" value={data.year.harvests} icon="can"
                  sub={money(data.year.value, app.currency)} />
        <StatTile label="Ready to sow" value={data.sowNow.length} icon="calendar"
                  sub={data.frost.lastSpring ? `last frost ${data.frost.lastSpring}` : 'no frost dates set'}
                  onClick={() => setFrost(true)} />
        <StatTile label="Seed past viability" value={data.pastViability} icon="alert"
                  tone={data.pastViability ? 'warn' : 'default'}
                  sub={data.pastViability ? 'test before sowing' : 'drawer is current'} />
      </div>

      {!!data.sowNow.length && (
        <Panel title="In the window this week"
               action={<span className="dim text-xs">from your own frost dates</span>}>
          <div className="flex flex-wrap gap-2">
            {data.sowNow.map((s: any) => (
              <span key={s.id} className="chip">
                {s.variety.name}{s.variety.cultivar ? ` '${s.variety.cultivar}'` : ''}
                <span className="dim ml-1">{s.sow.daysLeft}d left</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="What is in the ground" dense>
        {!data.plantings.length ? (
          <EmptyState icon="leaf" title="Nothing growing"
                      action={<button className="btn btn-primary" onClick={onSow}>Sow something</button>} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Variety</th><th>Bed</th><th>Sown</th>
                <th>First harvest</th><th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.plantings.map((p: any) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/garden/plantings/${p.id}`} className="hover:underline font-medium">
                      {p.variety.name}{p.variety.cultivar ? ` '${p.variety.cultivar}'` : ''}
                    </Link>
                    <span className="dim block text-xs">{p.variety.family}</span>
                  </td>
                  <td className="dim">{p.bed?.name ?? '—'}</td>
                  <td className="dim whitespace-nowrap">{dateLabel(p.sownOn)}</td>
                  <td className="dim whitespace-nowrap">
                    {p.expectedHarvestOn ? dateLabel(p.expectedHarvestOn) : '—'}
                  </td>
                  <td className={`text-right ${STATUS_TONE[p.status] ?? ''}`}>{titleCase(p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="The garden's net position">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <div className="dim text-xs">Produce displaced</div>
            <div className="text-xl font-semibold tabular-nums">{formatCo2e(data.year.avoidedGCo2e)}</div>
          </div>
          <div>
            <div className="dim text-xs">Inputs emitted</div>
            <div className="text-xl font-semibold tabular-nums">{formatCo2e(data.year.inputGCo2e)}</div>
          </div>
          <div>
            <div className="dim text-xs">Value harvested</div>
            <div className="text-xl font-semibold tabular-nums">{money(data.year.value, app.currency)}</div>
          </div>
        </div>
        <p className="dim text-sm mt-2">{data.year.note}</p>
        <p className="dim text-xs mt-1">
          Displaced produce is a counterfactual — what the shop would have emitted — and is
          reported beside the household footprint, never subtracted from it.
        </p>
      </Panel>

      <FrostModal open={frost} onClose={() => setFrost(false)} current={data.frost} onSaved={reload} />
    </div>
  );
}

function FrostModal({ open, onClose, current, onSaved }: {
  open: boolean; onClose: () => void; current: any; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    lastSpring: current?.lastSpring ?? '', firstAutumn: current?.firstAutumn ?? '',
  });
  const toast = useToast();
  const save = async () => {
    await api.put('/garden/frost-dates', {
      lastSpring: form.lastSpring || null, firstAutumn: form.firstAutumn || null,
    });
    toast.push({ message: 'Frost dates saved' });
    onSaved(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Frost dates"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save}>Save</button>
           </>}>
      <p className="dim text-sm mb-3">
        Almost every sowing decision is expressed relative to one of these. Set them and
        every variety can say whether today is too early, in the window, or too late.
      </p>
      <Field label="Last spring frost" hint="MM-DD, e.g. 05-12">
        <input className="input" value={form.lastSpring} placeholder="05-12"
               onChange={(e) => setForm({ ...form, lastSpring: e.target.value })} />
      </Field>
      <Field label="First autumn frost" hint="MM-DD, e.g. 10-08">
        <input className="input" value={form.firstAutumn} placeholder="10-08"
               onChange={(e) => setForm({ ...form, firstAutumn: e.target.value })} />
      </Field>
    </Modal>
  );
}

/* ──────────────────────────────── beds ──────────────────────────────────── */

function NewBed({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', method: 'raised', areaSqft: '', sun: 'full' });
  const toast = useToast();
  const save = async () => {
    await api.post('/garden/beds', {
      name: form.name, method: form.method,
      areaSqft: form.areaSqft ? Number(form.areaSqft) : null,
      sun: form.sun,
    });
    toast.push({ message: `${form.name} added` });
    setOpen(false); setForm({ name: '', method: 'raised', areaSqft: '', sun: 'full' });
    onDone();
  };
  return (
    <>
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} /> Bed
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New bed"
             footer={<>
               <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
               <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>Add</button>
             </>}>
        <Field label="Name"><input className="input" value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bed 4" /></Field>
        <Field label="How it is grown">
          <select className="input" value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {['raised', 'in_ground', 'container', 'greenhouse', 'polytunnel', 'hydroponic'].map((m) =>
              <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Area (sq ft)"><input className="input" type="number" value={form.areaSqft}
                 onChange={(e) => setForm({ ...form, areaSqft: e.target.value })} /></Field>
          <Field label="Sun">
            <select className="input" value={form.sun}
                    onChange={(e) => setForm({ ...form, sun: e.target.value })}>
              {['full', 'partial', 'shade'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </>
  );
}

function Beds() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/garden/beds?limit=100');
  const [openBed, setOpenBed] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><NewBed onDone={reload} /></div>
      {!data?.items.length ? (
        <EmptyState icon="leaf" title="No beds yet" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.items.map((b: any) => (
            <button key={b.id} className="panel p-4 text-left card-hover"
                    onClick={() => setOpenBed(b.id)}>
              <div className="font-medium">{b.name}</div>
              <div className="dim text-xs mt-0.5">
                {titleCase(b.method)}{b.areaSqft ? ` · ${b.areaSqft} sq ft` : ''}{b.sun ? ` · ${b.sun} sun` : ''}
              </div>
              <div className="mt-2 text-sm">
                {b.activePlantings
                  ? `${b.activePlantings} growing`
                  : <span className="dim">empty</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      <BedDetail bedId={openBed} onClose={() => setOpenBed(null)} currency={app.currency} />
    </div>
  );
}

function BedDetail({ bedId, onClose, currency }: {
  bedId: string | null; onClose: () => void; currency: string;
}) {
  const { data, loading } = useQuery<any>(bedId ? `/garden/beds/${bedId}/detail` : null, [bedId]);
  return (
    <Modal open={!!bedId} onClose={onClose} wide title={data?.bed.name ?? ''}>
      {loading && <Spinner />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Harvests" value={data.totals.harvests} />
            <StatTile label="Value" value={money(data.totals.value, currency)} />
            <StatTile label="Per sq ft" value={data.totals.perSqft != null
              ? money(data.totals.perSqft, currency) : '—'} />
          </div>
          <Panel title="What has grown here" dense>
            {!data.plantings.length ? <EmptyState icon="leaf" title="Nothing yet" /> : (
              <table className="table">
                <thead><tr><th>Variety</th><th>Family</th><th>Sown</th><th className="text-right">Harvested</th></tr></thead>
                <tbody>
                  {data.plantings.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.variety.name}{p.variety.cultivar ? ` '${p.variety.cultivar}'` : ''}</td>
                      <td className="dim">{p.variety.family}</td>
                      <td className="dim">{dateLabel(p.sownOn)}</td>
                      <td className="text-right tabular-nums">
                        {p.harvested || <span className="dim">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <p className="dim text-xs">
            This history is what makes rotation checkable: sowing the same botanical family
            back into this bed raises a warning rather than relying on anyone remembering.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────── seed drawer ──────────────────────────────── */

const VIABILITY_TONE: Record<string, string> = {
  good: '', ageing: 'text-amber-600 dark:text-amber-400',
  past: 'text-red-600 dark:text-red-400', unknown: 'dim',
};

function SeedDrawer() {
  const { data, loading, reload } = useQuery<any>('/garden/seeds');
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<any>(null);

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="dim text-sm">
          Seed is stock. Age is counted in seasons, and a germination test beats the calendar.
        </p>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Seed
        </button>
      </div>

      {!data?.items.length ? (
        <EmptyState icon="box" title="The drawer is empty"
                    hint="Add what you have. Origin matters: seed you saved or swapped is the loop closing." />
      ) : (
        <Panel dense>
          <div className="overflow-x-auto scroll-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Variety</th><th>Origin</th><th className="text-right">Left</th>
                  <th>Age</th><th>Sowing window</th><th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((l: any) => (
                  <tr key={l.id}>
                    <td>
                      <div className="font-medium">
                        {l.variety.name}{l.variety.cultivar ? ` '${l.variety.cultivar}'` : ''}
                      </div>
                      <div className="dim text-xs">
                        {l.variety.family}
                        {!l.variety.openPollinated && <span className="chip ml-1">F1</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`chip ${l.origin === 'bought' ? 'opacity-70' : ''}`}>{l.origin}</span>
                    </td>
                    <td className="text-right tabular-nums">{l.quantity} {l.unit}</td>
                    <td className={VIABILITY_TONE[l.viability.status]}>
                      <div className="text-sm">{titleCase(l.viability.status)}</div>
                      <div className="dim text-xs">{l.viability.note}</div>
                    </td>
                    <td className="text-xs dim">{l.sow.note}</td>
                    <td className="text-right">
                      <button className="btn btn-sm" onClick={() => setTesting(l)}>Test</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <AddSeed open={adding} onClose={() => setAdding(false)} onSaved={reload} />
      <GerminationTest lot={testing} onClose={() => setTesting(null)} onSaved={reload} />
    </div>
  );
}

function AddSeed({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const varieties = useQuery<any>(open ? '/garden/varieties?limit=300' : null);
  const [form, setForm] = useState({ varietyId: '', origin: 'bought', quantity: '', yearPacked: '' });
  const [warning, setWarning] = useState<string | null>(null);
  const toast = useToast();

  const save = async () => {
    const res = await api.post('/garden/seeds', {
      varietyId: form.varietyId,
      origin: form.origin,
      quantity: Number(form.quantity) || 0,
      yearPacked: form.yearPacked ? Number(form.yearPacked) : undefined,
    });
    if (res.warning) { setWarning(res.warning); return; }
    toast.push({ message: 'Added to the drawer' });
    onSaved(); onClose(); setForm({ varietyId: '', origin: 'bought', quantity: '', yearPacked: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add seed"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.varietyId}>
               {warning ? 'Add anyway' : 'Add'}
             </button>
           </>}>
      <Field label="Variety">
        <select className="input" value={form.varietyId}
                onChange={(e) => { setForm({ ...form, varietyId: e.target.value }); setWarning(null); }}>
          <option value="">Pick a variety…</option>
          {(varieties.data?.items ?? []).map((v: any) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.cultivar ? ` '${v.cultivar}'` : ''}{v.openPollinated ? '' : ' (F1)'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Where it came from">
        <select className="input" value={form.origin}
                onChange={(e) => { setForm({ ...form, origin: e.target.value }); setWarning(null); }}>
          {SEED_ORIGINS.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity"><input className="input" type="number" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Year packed"><input className="input" type="number" value={form.yearPacked}
               onChange={(e) => setForm({ ...form, yearPacked: e.target.value })} placeholder="this year" /></Field>
      </div>
      {warning && (
        <div className="panel p-3 mt-1" style={{ borderColor: '#d97706' }}>
          <p className="text-sm">{warning}</p>
        </div>
      )}
    </Modal>
  );
}

function GerminationTest({ lot, onClose, onSaved }: {
  lot: any; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ tested: '20', germinated: '' });
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const save = async () => {
    const res = await api.post(`/garden/seeds/${lot.id}/germination-test`, {
      tested: Number(form.tested), germinated: Number(form.germinated),
    });
    setResult(res);
    toast.push({ message: `${Math.round(res.germinationRate * 100)}% germination` });
    onSaved();
  };
  const close = () => { setResult(null); setForm({ tested: '20', germinated: '' }); onClose(); };

  return (
    <Modal open={!!lot} onClose={close} title={lot ? `Test ${lot.variety.name}` : ''}
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.germinated}>Record</button>
           </>}>
      <p className="dim text-sm mb-3">
        Damp kitchen paper, a sealed bag, somewhere warm, a week. A tested old lot is worth
        more than an untested new one, which is why this overrides the age.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Seeds tested"><input className="input" type="number" value={form.tested}
               onChange={(e) => setForm({ ...form, tested: e.target.value })} /></Field>
        <Field label="Seeds germinated"><input className="input" type="number" value={form.germinated}
               onChange={(e) => setForm({ ...form, germinated: e.target.value })} /></Field>
      </div>
      {result && (
        <div className="panel p-3">
          <div className="text-sm font-medium">{Math.round(result.germinationRate * 100)}% germination</div>
          <p className="dim text-sm mt-1">{result.viability.note}</p>
        </div>
      )}
    </Modal>
  );
}

/* ──────────────────────────────── sowing ────────────────────────────────── */

function SowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const varieties = useQuery<any>(open ? '/garden/varieties?limit=300' : null);
  const beds = useQuery<any>(open ? '/garden/beds?limit=100' : null);
  const seeds = useQuery<any>(open ? '/garden/seeds' : null);
  const [form, setForm] = useState({
    varietyId: '', bedId: '', seedLotId: '', method: 'direct', quantity: '',
    succession: false, everyDays: '14', count: '4',
  });
  const [error, setError] = useState<string>();
  const toast = useToast();
  const go = useGo();

  const rotation = useQuery<any>(
    open && form.bedId && form.varietyId
      ? `/garden/rotation-check?bedId=${form.bedId}&varietyId=${form.varietyId}`
      : null,
    [form.bedId, form.varietyId],
  );

  const variety = useMemo(
    () => (varieties.data?.items ?? []).find((v: any) => v.id === form.varietyId),
    [varieties.data, form.varietyId]);

  const lotsForVariety = (seeds.data?.items ?? []).filter((l: any) => l.varietyId === form.varietyId);

  const save = async () => {
    setError(undefined);
    try {
      const res = await api.post('/garden/plantings', {
        varietyId: form.varietyId,
        bedId: form.bedId || null,
        seedLotId: form.seedLotId || null,
        method: form.method,
        quantity: form.quantity ? Number(form.quantity) : null,
        succession: form.succession
          ? { everyDays: Number(form.everyDays), count: Number(form.count) }
          : null,
      });
      toast.push({
        message: res.items.length > 1
          ? `${res.items.length} sowings planned`
          : 'Sown, and its tasks are on the list',
      });
      onClose();
      if (res.items.length === 1) go(`/garden/plantings/${res.items[0].id}`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Sow something"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.varietyId}>
               {rotation.data?.conflict ? 'Sow anyway' : 'Sow'}
             </button>
           </>}>
      <Field label="Variety" error={error}>
        <select className="input" value={form.varietyId}
                onChange={(e) => setForm({ ...form, varietyId: e.target.value, seedLotId: '' })}>
          <option value="">Pick a variety…</option>
          {(varieties.data?.items ?? []).map((v: any) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.cultivar ? ` '${v.cultivar}'` : ''} — {v.family}
            </option>
          ))}
        </select>
      </Field>

      {variety?.sow && variety.sow.verdict !== 'unknown' && (
        <p className={`text-sm -mt-1 mb-3 ${
          variety.sow.verdict === 'open' ? 'text-brand-600 dark:text-brand-500'
            : variety.sow.verdict === 'closing' ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400'}`}>
          {variety.sow.note}
        </p>
      )}

      <Field label="Bed">
        <select className="input" value={form.bedId}
                onChange={(e) => setForm({ ...form, bedId: e.target.value })}>
          <option value="">No bed</option>
          {(beds.data?.items ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>

      {rotation.data?.conflict && (
        <div className="panel p-3 mb-3 flex items-start gap-2.5" style={{ borderColor: '#d97706' }}>
          <Icon name="alert" className="text-amber-600 shrink-0 mt-0.5" size={15} />
          <div>
            <p className="text-sm font-medium">Rotation warning</p>
            <p className="dim text-sm mt-0.5">
              {rotation.data.conflict.variety} ({rotation.data.conflict.family}) grew here{' '}
              {rotation.data.conflict.seasonsAgo === 0 ? 'this season'
                : `${rotation.data.conflict.seasonsAgo} season${rotation.data.conflict.seasonsAgo === 1 ? '' : 's'} ago`}.
              Same family, same ground concentrates whatever eats it.
            </p>
          </div>
        </div>
      )}

      {!!lotsForVariety.length && (
        <Field label="From which seed lot" hint="Sowing from a lot decrements it.">
          <select className="input" value={form.seedLotId}
                  onChange={(e) => setForm({ ...form, seedLotId: e.target.value })}>
            <option value="">Not from the drawer</option>
            {lotsForVariety.map((l: any) => (
              <option key={l.id} value={l.id}>
                {l.origin}, {l.quantity} {l.unit} — {l.viability.status}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="How">
          <select className="input" value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {SOW_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
        </Field>
        <Field label="How many"><input className="input" type="number" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
      </div>

      <label className="flex items-center gap-2 text-sm mb-2">
        <input type="checkbox" checked={form.succession}
               onChange={(e) => setForm({ ...form, succession: e.target.checked })} />
        Sow in succession
      </label>
      {form.succession && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every (days)"><input className="input" type="number" value={form.everyDays}
                 onChange={(e) => setForm({ ...form, everyDays: e.target.value })} /></Field>
          <Field label="How many times"><input className="input" type="number" value={form.count}
                 onChange={(e) => setForm({ ...form, count: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}

/* ─────────────────────────────── harvest ────────────────────────────────── */

function HarvestLog() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/garden/harvests');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="can" title="Nothing harvested yet"
                       hint="A harvest enters the pantry as ordinary stock, so home-grown and bought food are tracked identically." />;
  }
  return (
    <div className="space-y-4">
      <StatTile label="Harvested this year" value={money(data.totalValue, app.currency)}
                sub={`${data.items.length} pickings`} icon="can" />
      <Panel dense>
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Variety</th><th className="text-right">Quantity</th>
              <th className="text-right">Value</th><th>Basis</th></tr>
          </thead>
          <tbody>
            {data.items.map((hv: any) => (
              <tr key={hv.id}>
                <td className="dim whitespace-nowrap">{dateLabel(hv.harvestedOn)}</td>
                <td>{hv.variety.name}{hv.variety.cultivar ? ` '${hv.variety.cultivar}'` : ''}</td>
                <td className="text-right tabular-nums">{hv.quantity} {hv.unit}</td>
                <td className="text-right tabular-nums">{money(hv.estValue, app.currency)}</td>
                <td className="dim text-xs">{hv.valueBasis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* ───────────────────────── planting detail page ─────────────────────────── */

export function PlantingDetail() {
  const { id } = useParams();
  const app = useApp();
  const { data, loading, reload } = useQuery<any>(id ? `/garden/plantings/${id}` : null);
  const [harvesting, setHarvesting] = useState(false);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const label = `${data.variety.name}${data.variety.cultivar ? ` '${data.variety.cultivar}'` : ''}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/garden" className="text-xs dim hover:underline">← Garden</Link>
          <h1 className="text-xl font-semibold mt-0.5">{label}</h1>
          <p className="dim text-sm mt-0.5">
            {data.variety.family} · sown {dateLabel(data.sownOn)}
            {data.bed ? ` · ${data.bed.name}` : ''} · {titleCase(data.status)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setSaving(true)}>
            <Icon name="repeat" size={13} /> Save seed
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setHarvesting(true)}>
            <Icon name="plus" size={13} /> Harvest
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Harvested" value={data.totals.harvested || '—'}
                  sub={data.totals.unit ?? undefined} icon="can" />
        <StatTile label="Worth" value={money(data.totals.value, app.currency)} icon="coin" />
        <StatTile label="First harvest" value={data.expectedHarvestOn
          ? dateLabel(data.expectedHarvestOn) : '—'} icon="calendar" sub="expected" />
        <StatTile label="Days to maturity" value={data.variety.daysToMaturity ?? '—'} icon="clock" />
      </div>

      {data.failureReason && (
        <div className="panel p-3 flex items-start gap-2.5" style={{ borderColor: '#dc2626' }}>
          <Icon name="alert" className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">This planting failed</p>
            <p className="dim text-sm mt-0.5">{data.failureReason}</p>
          </div>
        </div>
      )}

      {/* The seed cycle, traversable in both directions (INT-015). */}
      <Panel title="Where this came from, and what it left behind">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="dim text-xs mb-1">Sown from</div>
            {data.sownFrom ? (
              <>
                <div className="font-medium">{titleCase(data.sownFrom.origin)} seed, packed {data.sownFrom.yearPacked}</div>
                {data.sownFrom.savedFromPlantingId && (
                  <Link to={`/garden/plantings/${data.sownFrom.savedFromPlantingId}`}
                        className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                    ← saved from an earlier planting
                  </Link>
                )}
              </>
            ) : <span className="dim">Not recorded against a seed lot.</span>}
          </div>
          <div>
            <div className="dim text-xs mb-1">Seed saved from it</div>
            {data.savedSeed.length ? data.savedSeed.map((s: any) => (
              <div key={s.id} className="font-medium">
                {s.quantity} {s.unit}, {s.yearPacked}
              </div>
            )) : <span className="dim">None yet.</span>}
          </div>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Panel title="Harvests" dense>
          {!data.harvests.length ? <EmptyState icon="can" title="Nothing picked yet" /> : (
            <table className="table">
              <tbody>
                {data.harvests.map((hv: any) => (
                  <tr key={hv.id}>
                    <td className="dim">{dateLabel(hv.harvestedOn)}</td>
                    <td className="tabular-nums">{hv.quantity} {hv.unit}</td>
                    <td className="text-right tabular-nums">{money(hv.estValue, app.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Observations" dense>
          {!data.observations.length ? (
            <EmptyState icon="edit" title="Nothing noted"
                        hint="Pests, disease, weather. Next year you will want to know." />
          ) : (
            <table className="table">
              <tbody>
                {data.observations.map((o: any) => (
                  <tr key={o.id}>
                    <td className="dim whitespace-nowrap">{dateLabel(o.observedOn)}</td>
                    <td><span className="chip mr-2">{o.kind}</span>{o.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <HarvestModal open={harvesting} onClose={() => setHarvesting(false)}
                    plantingId={id!} onSaved={reload} />
      <SaveSeedModal open={saving} onClose={() => setSaving(false)}
                     plantingId={id!} label={label} onSaved={reload} />
    </div>
  );
}

function HarvestModal({ open, onClose, plantingId, onSaved }: {
  open: boolean; onClose: () => void; plantingId: string; onSaved: () => void;
}) {
  const locations = useQuery<any>(open ? '/locations?holdsFood=true&limit=100' : null);
  const [form, setForm] = useState({ quantity: '', unit: 'lb', locationId: '', toPantry: true });
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const save = async () => {
    const res = await api.post(`/garden/plantings/${plantingId}/harvest`, {
      quantity: Number(form.quantity), unit: form.unit,
      toPantry: form.toPantry ? { locationId: form.locationId || null } : null,
    });
    setResult(res);
    toast.push({ message: `${form.quantity} ${form.unit} in` });
    onSaved();
  };
  const close = () => { setResult(null); setForm({ ...form, quantity: '' }); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Record a harvest"
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save} disabled={!form.quantity}>Record</button>
           </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much"><input className="input" type="number" step="any" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Unit">
          <select className="input" value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['lb', 'kg', 'ea', 'bunch'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={form.toPantry}
               onChange={(e) => setForm({ ...form, toPantry: e.target.checked })} />
        Put it in the pantry as stock
      </label>
      {form.toPantry && (
        <Field label="Where">
          <select className="input" value={form.locationId}
                  onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            <option value="">Default food area</option>
            {(locations.data?.items ?? []).map((l: any) =>
              <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      )}
      {result && (
        <div className="panel p-3 space-y-1">
          <div className="text-sm font-medium">
            Worth {money(result.harvest.estValue, 'USD')}
          </div>
          <p className="dim text-xs">{result.harvest.valueBasis}</p>
          {result.avoided && (
            <p className="dim text-xs">
              Displaced {formatCo2e(result.avoided.gCo2e)} — {result.avoided.counterfactual}.
              Reported beside the footprint, not subtracted from it.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function SaveSeedModal({ open, onClose, plantingId, label, onSaved }: {
  open: boolean; onClose: () => void; plantingId: string; label: string; onSaved: () => void;
}) {
  const [form, setForm] = useState({ quantity: '', unit: 'seed', notes: '' });
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const save = async () => {
    const res = await api.post(`/garden/plantings/${plantingId}/save-seed`, {
      quantity: Number(form.quantity) || 0, unit: form.unit, notes: form.notes || null,
    });
    setResult(res);
    toast.push({ message: `Seed saved from ${label}` });
    onSaved();
  };
  const close = () => { setResult(null); setForm({ quantity: '', unit: 'seed', notes: '' }); onClose(); };

  return (
    <Modal open={open} onClose={close} title={`Save seed from ${label}`}
           footer={<>
             <button className="btn" onClick={close}>Done</button>
             <button className="btn btn-primary" onClick={save}>Save seed</button>
           </>}>
      <p className="dim text-sm mb-3">
        The new lot points back at this planting, and a planting sown from it will point
        forward again — so the line from a plant to next year's sowing is a link, not a memory.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much"><input className="input" type="number" value={form.quantity}
               onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <Field label="Unit">
          <select className="input" value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['seed', 'g', 'packet'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Note"><input className="input" value={form.notes}
             onChange={(e) => setForm({ ...form, notes: e.target.value })}
             placeholder="Best plant in the row" /></Field>
      {result?.warning && (
        <div className="panel p-3" style={{ borderColor: '#d97706' }}>
          <p className="text-sm">{result.warning}</p>
        </div>
      )}
      {result && !result.warning && (
        <p className="text-sm">Saved. It will come true — this variety is open-pollinated.</p>
      )}
    </Modal>
  );
}
