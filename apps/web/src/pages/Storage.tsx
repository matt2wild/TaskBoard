import { useState } from 'react';
import { api } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast } from '../components/ui';

type Tab = 'items' | 'places' | 'loans' | 'review' | 'value';

export function Storage() {
  const [tab, setTab] = useState<Tab>('items');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Storage</h1>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'items', label: 'Items' },
        { id: 'places', label: 'Places' },
        { id: 'loans', label: 'Lent out' },
        { id: 'review', label: 'Declutter' },
        { id: 'value', label: 'Value' },
      ]} />
      {tab === 'items' && <Items />}
      {tab === 'places' && <Places />}
      {tab === 'loans' && <Loans />}
      {tab === 'review' && <Review />}
      {tab === 'value' && <Valuation />}
    </div>
  );
}

function Items() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [adding, setAdding] = useState(false);
  const { data, loading, reload } = useQuery<any>(
    `/storage-items?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}`, [search],
  );
  const unsorted = useQuery<any>('/storage-items/unsorted');

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input" placeholder="What are you looking for?" value={term}
               onChange={(e) => setTerm(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={13} /></button>
      </div>

      {unsorted.data?.items.length > 0 && (
        <Panel title={`Unsorted (${unsorted.data.items.length})`} dense>
          <ul>
            {unsorted.data.items.slice(0, 5).map((i: any) => (
              <li key={i.id} className="px-4 py-2 border-b last:border-0 text-sm">{i.name}</li>
            ))}
          </ul>
          <p className="text-xs dim px-4 py-2">Give these a home when you get a minute.</p>
        </Panel>
      )}

      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="box" title="Nothing stored yet"
                    hint="Capture a box of things now, find them in three years."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add an item</button>} />
      )}

      {data?.items.length > 0 && (
        <Panel dense>
          <ul>
            {data.items.map((i: any) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <Icon name="box" size={15} className="dim shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{i.name}{i.quantity > 1 && <span className="dim"> ×{i.quantity}</span>}</p>
                  <p className="text-xs dim truncate">{i.locationPath ?? 'Not put away'}</p>
                </div>
                {i.loan && <span className="chip shrink-0">with {i.loan.contactName}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <AddItem open={adding} onClose={() => setAdding(false)} onDone={() => { reload(); unsorted.reload(); }} />
    </div>
  );
}

function AddItem({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const locations = useQuery<any>(open ? '/locations?limit=300' : null);
  const categories = useQuery<any>(open ? '/storage-categories?limit=100' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await api.post('/storage-items', {
        name: form.name,
        locationId: form.locationId || undefined,
        categoryId: form.categoryId || undefined,
        quantity: form.quantity ? Number(form.quantity) : 1,
        estValue: form.estValue ? Math.round(Number(form.estValue) * 100) : undefined,
        description: form.description || undefined,
      });
      toast.push({ message: `Stored ${form.name}` });
      setForm({}); onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Store something"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Save</button>
           </>}>
      <Field label="What is it?">
        <input className="input" autoFocus value={form.name ?? ''} placeholder="Christmas lights"
               onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="Where does it go?">
        <select className="select" value={form.locationId ?? ''} onChange={(e) => set('locationId', e.target.value)}>
          <option value="">Decide later</option>
          {locations.data?.items.map((l: any) => <option key={l.id} value={l.id}>{l.path ?? l.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Category">
          <select className="select" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {categories.data?.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Quantity">
          <input className="input" inputMode="numeric" value={form.quantity ?? '1'} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <Field label="Worth" hint="For insurance">
          <input className="input" inputMode="decimal" value={form.estValue ?? ''} onChange={(e) => set('estValue', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="textarea" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </Field>
    </Modal>
  );
}

function Places() {
  const { data, loading, reload } = useQuery<any>('/locations/tree');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const contents = useQuery<any>(selected ? `/locations/${selected}/contents` : null, [selected]);

  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="box" title="No places yet"
                       hint="Add rooms and containers under Settings, then put things in them." />;
  }

  const Node = ({ node, depth }: { node: any; depth: number }) => {
    const isOpen = open.has(node.id);
    const hasKids = node.children.length > 0;
    return (
      <>
        <li>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[var(--panel-alt)]"
               style={{ paddingLeft: `${depth * 1.1 + 0.5}rem` }}>
            <button className="w-4 h-4 grid place-items-center shrink-0" aria-label={isOpen ? 'Collapse' : 'Expand'}
                    onClick={() => setOpen((cur) => {
                      const next = new Set(cur);
                      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                      return next;
                    })}>
              {hasKids && <Icon name={isOpen ? 'chevronDown' : 'chevron'} size={12} className="dim" />}
            </button>
            <button className="flex-1 text-left text-sm truncate" onClick={() => setSelected(node.id)}>
              {node.name}
            </button>
            {node.shortCode && <span className="chip">{node.shortCode}</span>}
            {node.assetCount > 0 && <span className="text-xs dim tabular-nums">{node.assetCount}</span>}
          </div>
        </li>
        {isOpen && node.children.map((child: any) => <Node key={child.id} node={child} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Panel title="Where things live" dense>
        <ul className="p-2">
          {data.items.map((n: any) => <Node key={n.id} node={n} depth={0} />)}
        </ul>
      </Panel>
      {contents.data && (
        <Panel title={contents.data.path ?? 'Contents'} dense>
          {['children', 'assets', 'tools', 'storageItems', 'stock'].every((k) => !contents.data[k]?.length) ? (
            <EmptyState icon="box" title="Empty" />
          ) : (
            <div className="p-2 space-y-3">
              {(['children', 'assets', 'tools', 'storageItems', 'stock'] as const).map((key) => (
                contents.data[key]?.length > 0 && (
                  <div key={key}>
                    <h3 className="label px-2">{titleCase(key === 'storageItems' ? 'stored items' : key)}</h3>
                    <ul>
                      {contents.data[key].map((i: any) => (
                        <li key={i.id} className="px-2 py-1 text-sm truncate">
                          {i.name ?? i.product}
                          {i.quantity != null && i.quantity !== 1 && <span className="dim"> ×{i.quantity}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Loans() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/loans?open=true');
  const toast = useToast();
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="handshake" title="Nothing is out"
                       hint="Lend a tool from its page and it gets a return date and a task." />;
  }
  return (
    <Panel dense>
      <ul>
        {data.items.map((l: any) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
            <Icon name="handshake" size={15} className="dim shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{l.item}</p>
              <p className="text-xs dim">
                {l.direction === 'out' ? 'With' : 'Borrowed from'} {l.contactName} · {l.daysOut} days
              </p>
            </div>
            {l.dueBack && (
              <span className={`chip shrink-0 ${l.overdue ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : ''}`}>
                {dateLabel(l.dueBack, app.today)}
              </span>
            )}
            <button className="btn btn-sm" onClick={async () => {
              await api.post(`/loans/${l.id}/return`, {});
              toast.push({ message: `${l.item} is back` });
              reload();
            }}>Back</button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Review() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/storage/review-queue?staleMonths=24');
  const toast = useToast();
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="check" title="Nothing to review"
                       hint="Items you have not touched in two years, or that you flagged for review, appear here." />;
  }
  const dispose = async (id: string, name: string, method: string) => {
    await api.post(`/storage-items/${id}/dispose`, { method });
    toast.push({ message: `${name}: ${method}` });
    reload();
  };
  return (
    <Panel dense>
      <ul>
        {data.items.map((i: any) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3 border-b last:border-0">
            <div className="flex-1 min-w-40">
              <p className="text-sm">{i.name}</p>
              <p className="text-xs dim">
                {i.locationPath ?? 'unsorted'} · {i.reason === 'review_due' ? 'review due' : 'untouched for years'}
              </p>
            </div>
            <div className="flex gap-1">
              <button className="btn btn-sm" onClick={async () => {
                await api.patch(`/storage-items/${i.id}`, { reviewBy: null });
                toast.push({ message: 'Keeping it' });
                reload();
              }}>Keep</button>
              <button className="btn btn-sm btn-ghost" onClick={() => dispose(i.id, i.name, 'donated')}>Donate</button>
              <button className="btn btn-sm btn-ghost" onClick={() => dispose(i.id, i.name, 'trashed')}>Bin</button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Valuation() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/storage/valuation');
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      <StatTile label="Estimated contents value" value={money(data?.total ?? 0, app.currency)}
                sub="For an insurance schedule" icon="bank" />
      <div className="flex justify-end no-print">
        <button className="btn btn-sm" onClick={() => window.print()}><Icon name="print" size={13} /> Print</button>
      </div>
      <Panel title="By place" dense>
        <table className="table">
          <tbody>
            {data?.byLocation.map((l: any) => (
              <tr key={l.location}>
                <td>{l.location}</td>
                <td className="text-right tabular-nums">{money(l.total, app.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Items" dense>
        <table className="table">
          <thead><tr><th>Item</th><th>Where</th><th>Serial</th><th className="text-right">Value</th></tr></thead>
          <tbody>
            {data?.items.slice(0, 200).map((i: any) => (
              <tr key={`${i.kind}:${i.id}`}>
                <td>{i.name}<span className="chip ml-1.5">{i.kind.replace('_', ' ')}</span></td>
                <td className="dim text-xs">{i.locationPath ?? '—'}</td>
                <td className="dim text-xs">{i.serial ?? '—'}</td>
                <td className="text-right tabular-nums">{money(i.value * i.quantity, app.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
