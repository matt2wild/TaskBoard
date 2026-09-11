import { useState } from 'react';
import { api } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { money, quantity, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast } from '../components/ui';

type Tab = 'tools' | 'batteries' | 'kits' | 'wishlist';

export function Tools() {
  const [tab, setTab] = useState<Tab>('tools');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tools</h1>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'tools', label: 'Tools' },
        { id: 'batteries', label: 'Batteries' },
        { id: 'kits', label: 'Kits' },
        { id: 'wishlist', label: 'Wishlist' },
      ]} />
      {tab === 'tools' && <ToolList />}
      {tab === 'batteries' && <Batteries />}
      {tab === 'kits' && <Kits />}
      {tab === 'wishlist' && <Wishlist />}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  loaned_out: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  needs_repair: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  in_use: '', available: '', retired: '',
};

function ToolList() {
  const app = useApp();
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const { data, loading, reload } = useQuery<any>(
    `/tools?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}`, [search],
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input" placeholder="Search tools" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={13} /></button>
      </div>
      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="toolbox" title="No tools yet"
                    hint="Add what you own so a project can tell you what is missing."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add a tool</button>} />
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.items.map((t: any) => (
          <button key={t.id} className="panel card-hover p-3.5 text-left" onClick={() => setSelected(t)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{t.name}</p>
                <p className="text-xs dim truncate">{[t.make, t.model].filter(Boolean).join(' ') || t.locationPath || '—'}</p>
              </div>
              <span className={`chip shrink-0 ${STATUS_TONE[t.toolStatus] ?? ''}`}>
                {t.toolStatus.replace('_', ' ')}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2.5 text-xs dim">
              <Icon name="toolbox" size={12} />
              {titleCase(t.toolType)}
              {t.totalCost > 0 && <span className="ml-auto tabular-nums">{money(t.totalCost, app.currency)}</span>}
            </div>
            {t.loan && <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">With {t.loan.contactName}</p>}
          </button>
        ))}
      </div>
      <ToolSheet tool={selected} onClose={() => setSelected(null)} onChange={reload} />
      <AddTool open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function ToolSheet({ tool, onClose, onChange }: { tool: any | null; onClose: () => void; onChange: () => void }) {
  const consumables = useQuery<any>(tool ? `/tools/${tool.id}/consumables` : null, [tool?.id]);
  const contacts = useQuery<any>(tool ? '/contacts?limit=100' : null);
  const [lending, setLending] = useState(false);
  const [contactId, setContactId] = useState('');
  const [dueBack, setDueBack] = useState('');
  const toast = useToast();

  const lend = async () => {
    await api.post('/loans', {
      itemType: 'asset', itemId: tool.id,
      contactId: contactId || undefined,
      contactName: contactId ? undefined : 'Someone',
      dueBack: dueBack || undefined,
    });
    toast.push({ message: `${tool.name} lent out` });
    setLending(false); onChange(); onClose();
  };

  return (
    <Modal open={!!tool} onClose={onClose} title={tool?.name ?? ''}
           footer={tool?.toolStatus === 'loaned_out' ? undefined : (
             <button className="btn" onClick={() => setLending((v) => !v)}>
               <Icon name="handshake" size={13} /> Lend it out
             </button>
           )}>
      {tool && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="dim">Status</dt><dd>{tool.toolStatus.replace('_', ' ')}</dd>
            <dt className="dim">Where</dt><dd>{tool.locationPath ?? 'unassigned'}</dd>
            {tool.serial && <><dt className="dim">Serial</dt><dd>{tool.serial}</dd></>}
            {tool.hoursUsed > 0 && <><dt className="dim">Hours</dt><dd className="tabular-nums">{tool.hoursUsed}</dd></>}
          </dl>

          {lending && (
            <div className="panel p-3 space-y-2">
              <Field label="Who is taking it?">
                <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">Pick a contact</option>
                  {contacts.data?.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Back by" hint="A date makes a task so it actually comes home.">
                <input className="input" type="date" value={dueBack} onChange={(e) => setDueBack(e.target.value)} />
              </Field>
              <button className="btn btn-primary w-full" onClick={lend}>Lend it</button>
            </div>
          )}

          {consumables.data?.items.length > 0 && (
            <div>
              <h3 className="label">What it eats</h3>
              <ul className="space-y-1.5">
                {consumables.data.items.map((s: any) => (
                  <li key={s.id} className="text-sm">
                    <p>{s.description}</p>
                    {s.products.map((p: any) => (
                      <p key={p.id} className={`text-xs ${p.isLow ? 'text-amber-600 dark:text-amber-400' : 'dim'}`}>
                        {p.name} · {quantity(p.onHand, p.unit)} on hand
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddTool({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const properties = useQuery<any>(open ? '/properties' : null);
  const locations = useQuery<any>(open ? '/locations?limit=300' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      const propertyId = properties.data?.items[0]?.id;
      if (!propertyId) throw new Error('Create a property first, under Settings.');
      const tool = await api.post('/tools', {
        propertyId, name: form.name,
        locationId: form.locationId || undefined,
        make: form.make || undefined, model: form.model || undefined,
        purchasePrice: form.purchasePrice ? Math.round(Number(form.purchasePrice) * 100) : undefined,
      });
      if (form.toolType) await api.put(`/tools/${tool.id}/profile`, { toolType: form.toolType });
      toast.push({ message: `Added ${tool.name}` });
      setForm({}); onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a tool"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Add</button>
           </>}>
      <Field label="Name"><input className="input" autoFocus value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Make"><input className="input" value={form.make ?? ''} onChange={(e) => set('make', e.target.value)} /></Field>
        <Field label="Model"><input className="input" value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Type">
          <select className="select" value={form.toolType ?? 'hand'} onChange={(e) => set('toolType', e.target.value)}>
            {['hand', 'power_corded', 'power_battery', 'pneumatic', 'garden', 'measuring', 'safety', 'access', 'other']
              .map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </Field>
        <Field label="Where">
          <select className="select" value={form.locationId ?? ''} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">Unassigned</option>
            {locations.data?.items.map((l: any) => <option key={l.id} value={l.id}>{l.path ?? l.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Price paid"><input className="input" inputMode="decimal" value={form.purchasePrice ?? ''} onChange={(e) => set('purchasePrice', e.target.value)} /></Field>
    </Modal>
  );
}

function Batteries() {
  const platforms = useQuery<any>('/battery-platforms');
  const [selected, setSelected] = useState<string | null>(null);
  const overview = useQuery<any>(selected ? `/battery-platforms/${selected}/overview` : null, [selected]);

  if (platforms.loading) return <Spinner />;
  if (!platforms.data?.items.length) {
    return <EmptyState icon="battery" title="No battery platforms"
                       hint="Group tools by their battery system so you know what a new tool will fit." />;
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {platforms.data.items.map((p: any) => (
          <button key={p.id} className={`btn btn-sm ${selected === p.id ? 'btn-primary' : ''}`}
                  onClick={() => setSelected(p.id)}>{p.name}</button>
        ))}
      </div>
      {overview.data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Healthy packs" value={overview.data.health.good} icon="battery" tone="good" />
            <StatTile label="Degraded or dead"
                      value={overview.data.health.degraded + overview.data.health.dead}
                      tone={overview.data.health.dead ? 'bad' : 'default'} icon="alert" />
            <StatTile label="Usable capacity" value={`${overview.data.health.totalAh} Ah`} icon="battery" />
          </div>
          <Panel title="Packs and chargers" dense>
            <ul>
              {[...overview.data.batteries, ...overview.data.chargers].map((b: any) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm">
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.capacityAh && <span className="text-xs dim tabular-nums">{b.capacityAh} Ah</span>}
                  <span className={`chip ${b.health === 'dead' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : b.health === 'degraded' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : ''}`}>
                    {b.health}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={`Tools on this platform (${overview.data.tools.length})`} dense>
            <ul>
              {overview.data.tools.map((t: any) => (
                <li key={t.id} className="px-4 py-2 border-b last:border-0 text-sm flex justify-between">
                  <span>{t.name}</span>
                  <span className="chip">{t.status.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Kits() {
  const kits = useQuery<any>('/tool-kits');
  const [selected, setSelected] = useState<string | null>(null);
  const contents = useQuery<any>(selected ? `/tool-kits/${selected}/contents` : null, [selected]);
  if (kits.loading) return <Spinner />;
  if (!kits.data?.items.length) {
    return <EmptyState icon="toolbox" title="No kits"
                       hint="Group the tools you always grab together, then check the kit is complete before you start." />;
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {kits.data.items.map((k: any) => (
          <button key={k.id} className={`btn btn-sm ${selected === k.id ? 'btn-primary' : ''}`}
                  onClick={() => setSelected(k.id)}>{k.name}</button>
        ))}
      </div>
      {contents.data && (
        <Panel title={contents.data.complete ? 'Complete' : `${contents.data.missing.length} missing`} dense>
          <ul>
            {contents.data.items.map((i: any) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm">
                <Icon name={i.present ? 'check' : 'alert'} size={14}
                      className={i.present ? 'dim' : 'text-amber-600 dark:text-amber-400'} />
                <span className="flex-1 truncate">{i.name}</span>
                <span className="chip">{i.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Wishlist() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/tools/wishlist');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="cart" title="Nothing on the wishlist"
                       hint="When a project needs a tool you do not own, it lands here with a rent-or-buy note." />;
  }
  return (
    <div className="space-y-3">
      <StatTile label="If you bought it all" value={money(data.totalEstimate, app.currency)} icon="coin" />
      <Panel dense>
        <ul>
          {data.items.map((w: any) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm">{w.description}</p>
                <p className="text-xs dim">{w.projectName ?? 'No project'}{w.note ? ` · ${w.note}` : ''}</p>
              </div>
              <span className="chip">{w.rentOrBuy}</span>
              {w.estCost && <span className="text-xs tabular-nums dim">{money(w.estCost, app.currency)}</span>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
