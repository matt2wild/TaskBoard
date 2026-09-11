import { useEffect, useState } from 'react';
import { formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, quantity, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast } from '../components/ui';

type Tab = 'pantry' | 'shopping' | 'expiring' | 'products' | 'waste';

export function Food() {
  const [tab, setTab] = useState<Tab>('pantry');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Food and supplies</h1>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'pantry', label: 'Pantry' },
        { id: 'shopping', label: 'Shopping' },
        { id: 'expiring', label: 'Expiring' },
        { id: 'products', label: 'Products' },
        { id: 'waste', label: 'Waste' },
      ]} />
      {tab === 'pantry' && <Pantry />}
      {tab === 'shopping' && <Shopping />}
      {tab === 'expiring' && <Expiring />}
      {tab === 'products' && <Products />}
      {tab === 'waste' && <Waste />}
    </div>
  );
}

function Pantry() {
  const app = useApp();
  const [groupBy, setGroupBy] = useState<'location' | 'product'>('location');
  const [foodOnly, setFoodOnly] = useState<'all' | 'true' | 'false'>('all');
  const path = `/stock?groupBy=${groupBy}${foodOnly === 'all' ? '' : `&isFood=${foodOnly}`}&limit=500`;
  const { data, loading, reload } = useQuery<any>(path, [groupBy, foodOnly]);
  const toast = useToast();

  const [wasting, setWasting] = useState<{ id: string; label: string; quantity: number } | null>(null);

  const adjust = async (id: string, action: string, label: string) => {
    await api.post(`/stock/${id}/adjust`, { action });
    toast.push({ message: `Used ${label}` });
    reload();
  };

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-1">
          <button className={`btn btn-sm ${groupBy === 'location' ? 'btn-primary' : ''}`}
                  onClick={() => setGroupBy('location')}>By place</button>
          <button className={`btn btn-sm ${groupBy === 'product' ? 'btn-primary' : ''}`}
                  onClick={() => setGroupBy('product')}>By item</button>
        </div>
        <select className="select w-auto" value={foodOnly} onChange={(e) => setFoodOnly(e.target.value as any)}>
          <option value="all">Everything</option>
          <option value="true">Food only</option>
          <option value="false">Household only</option>
        </select>
      </div>

      {!data?.groups?.length && <EmptyState icon="can" title="The pantry is empty"
                                            hint="Scan a barcode or add a product, then put some stock away." />}

      {data?.groups?.map((group: any) => (
        <Panel key={group.name} dense title={
          <span className="flex items-center gap-2">{group.name}
            <span className="chip">{group.items.length}</span></span>
        }>
          <ul>
            {group.items.map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {groupBy === 'location' ? s.product.name : (s.locationPath ?? 'Unassigned')}
                  </p>
                  <p className="text-xs dim">
                    {quantity(s.quantity, s.unit)}
                    {s.expiryDate && ` · ${s.expired ? 'expired' : `${s.daysLeft}d left`}`}
                    {s.openedAt && ' · opened'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn btn-sm" title="Use one"
                          onClick={() => adjust(s.id, 'use', s.product.name)}>
                    <Icon name="minus" size={12} />
                  </button>
                  {!s.openedAt && (
                    <button className="btn btn-sm btn-ghost" title="Mark opened"
                            onClick={() => adjust(s.id, 'open', s.product.name)}>Open</button>
                  )}
                  <button className="btn btn-sm btn-ghost" title="Throw away"
                          onClick={() => setWasting({ id: s.id, label: s.product.name, quantity: 1 })}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      <WasteSheet target={wasting} onClose={() => setWasting(null)}
                  onDone={() => { setWasting(null); reload(); }} />
    </div>
  );
}

/**
 * One control, every route the household actually has (INT-010). Choosing the
 * pile rather than the bin writes the stock movement, the compost input, the
 * pile's own emission and the avoided landfill methane in a single action.
 */
function WasteSheet({ target, onClose, onDone }: {
  target: { id: string; label: string; quantity: number } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const systems = useQuery<any>(target ? '/compost/systems?limit=20' : null, [target?.id]);
  const [route, setRoute] = useState<'bin' | 'compost'>('bin');
  const [reason, setReason] = useState('expired');
  const [result, setResult] = useState<any>(null);
  const toast = useToast();

  const piles = systems.data?.items ?? [];

  const save = async () => {
    const res = await api.post(`/stock/${target!.id}/adjust`, {
      action: 'waste', quantity: target!.quantity, wasteReason: reason,
      route: piles.length ? route : 'bin',
    });
    setResult(res);
    toast.push({ message: route === 'compost' ? `${target!.label} on the pile` : `Binned ${target!.label}` });
  };
  const close = () => { setResult(null); setRoute('bin'); onDone(); };

  return (
    <Modal open={!!target} onClose={onClose} title={target ? `Throw out ${target.label}` : ''}
           footer={<>
             <button className="btn" onClick={result ? close : onClose}>
               {result ? 'Done' : 'Cancel'}
             </button>
             {!result && <button className="btn btn-primary" onClick={save}>Record it</button>}
           </>}>
      <Field label="Why">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {['expired', 'spoiled', 'leftover', 'freezer_burn', 'overbought', 'other'].map((r) =>
            <option key={r} value={r}>{titleCase(r)}</option>)}
        </select>
      </Field>
      {piles.length > 0 && (
        <Field label="Where it goes"
               hint="The same food makes methane in a landfill and mostly carbon dioxide on a pile. Over twenty years the difference is not marginal.">
          <select className="input" value={route}
                  onChange={(e) => setRoute(e.target.value as 'bin' | 'compost')}>
            <option value="bin">The bin</option>
            <option value="compost">{piles[0].name}</option>
          </select>
        </Field>
      )}
      {result && (
        <div className="panel p-3 space-y-1">
          <p className="text-sm">
            {formatCo2e(result.wastedGCo2e)} of embodied carbon thrown away — already counted
            when you bought it, shown because it was spent for nothing.
          </p>
          {result.disposalGCo2e != null && (
            <p className="dim text-sm">
              The disposal itself emitted {formatCo2e(result.disposalGCo2e)}.
            </p>
          )}
          {result.avoided && (
            <p className="dim text-sm">
              Composting it avoided {formatCo2e(result.avoided.gCo2e100)} against the bin, or{' '}
              {formatCo2e(result.avoided.gCo2e20)} over twenty years.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Shopping() {
  const lists = useQuery<any>('/shopping-lists');
  const [listId, setListId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [putAway, setPutAway] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!listId && lists.data?.items.length) {
      setListId((lists.data.items.find((l: any) => l.isDefault) ?? lists.data.items[0]).id);
    }
  }, [lists.data, listId]);

  const lines = useQuery<any>(listId ? `/shopping-lists/${listId}/lines` : null, [listId]);

  const check = async (id: string, checked: boolean) => {
    await api.patch(`/shopping-lines/${id}`, { checked });
    lines.reload();
  };

  const add = async () => {
    if (!text.trim() || !listId) return;
    await api.post(`/shopping-lists/${listId}/lines`, { text: text.trim(), quantity: 1 });
    setText('');
    lines.reload();
  };

  if (lists.loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select className="select" value={listId ?? ''} onChange={(e) => setListId(e.target.value)}>
          {lists.data?.items.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button className="btn" disabled={!lines.data?.checked.length} onClick={() => setPutAway(true)}>
          Put away
        </button>
      </div>

      <div className="flex gap-2">
        <input className="input" placeholder="Add something" value={text}
               onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <button className="btn btn-primary" onClick={add} disabled={!text.trim()}>Add</button>
      </div>

      {lines.data && (
        <>
          <Panel dense title={`To get (${lines.data.open.length})`}>
            {!lines.data.open.length ? (
              <p className="dim text-sm p-4 text-center">The list is clear.</p>
            ) : (
              <ul>
                {lines.data.open.map((l: any) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                    <input type="checkbox" onChange={() => check(l.id, true)} aria-label={`Got ${l.text}`} />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm block truncate">{l.text}</span>
                      {(l.quantity !== 1 || l.sourceType !== 'manual') && (
                        <span className="text-xs dim">
                          {l.quantity !== 1 && `${quantity(l.quantity, l.unit)} · `}
                          {l.sourceType !== 'manual' && l.sourceType.replace(/_/g, ' ')}
                          {l.note && ` · ${l.note}`}
                        </span>
                      )}
                    </span>
                    <button className="btn btn-ghost btn-sm" aria-label="Remove"
                            onClick={async () => { await api.del(`/shopping-lines/${l.id}`); lines.reload(); }}>
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {lines.data.checked.length > 0 && (
            <Panel dense title={`In the basket (${lines.data.checked.length})`}>
              <ul>
                {lines.data.checked.map((l: any) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-0">
                    <input type="checkbox" checked readOnly onChange={() => check(l.id, false)} />
                    <span className="flex-1 text-sm line-through dim truncate">{l.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      <PutAway open={putAway} onClose={() => setPutAway(false)} listId={listId}
               lines={lines.data?.checked ?? []} onDone={() => { lines.reload(); toast.push({ message: 'Put away' }); }} />
    </div>
  );
}

/** Turns a finished trip into stock, one receipt and price history (FOOD-010/011). */
function PutAway({ open, onClose, listId, lines, onDone }: {
  open: boolean; onClose: () => void; listId: string | null; lines: any[]; onDone: () => void;
}) {
  const app = useApp();
  const locations = useQuery<any>(open ? '/locations?holdsFood=true&limit=100' : null);
  const [rows, setRows] = useState<Record<string, { quantity: string; locationId: string }>>({});
  const [total, setTotal] = useState('');
  const [payee, setPayee] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setRows(Object.fromEntries(lines.map((l) => [l.id, { quantity: String(l.quantity), locationId: '' }])));
    }
  }, [open, lines]);

  const submit = async () => {
    if (!listId) return;
    setBusy(true);
    try {
      const items = lines
        .filter((l) => l.productId)
        .map((l) => ({
          lineId: l.id,
          quantity: Number(rows[l.id]?.quantity ?? l.quantity) || 1,
          locationId: rows[l.id]?.locationId || null,
        }));
      const cents = total ? Math.round(Number(total.replace(/[^0-9.]/g, '')) * 100) : 0;
      await api.post(`/shopping-lists/${listId}/put-away`, {
        items: items.length ? items : lines.map((l) => ({ lineId: l.id, quantity: l.quantity })),
        transaction: cents > 0 ? { total: cents, payeeName: payee || undefined, memo: 'Shopping trip' } : undefined,
      });
      setTotal(''); setPayee('');
      onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(false); }
  };

  const withProduct = lines.filter((l) => l.productId);

  return (
    <Modal open={open} onClose={onClose} title="Put the shopping away" wide
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy}>Put away</button>
           </>}>
      {!withProduct.length ? (
        <p className="text-sm dim">
          None of these lines are linked to a product, so there is nothing to shelve.
          They will simply be cleared.
        </p>
      ) : (
        <ul className="space-y-2 mb-4">
          {withProduct.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm min-w-0 truncate">{l.text}</span>
              <input className="input w-20 text-right" inputMode="decimal"
                     value={rows[l.id]?.quantity ?? ''} aria-label={`Quantity of ${l.text}`}
                     onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, quantity: e.target.value } }))} />
              <select className="select w-40" value={rows[l.id]?.locationId ?? ''}
                      aria-label={`Where ${l.text} goes`}
                      onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, locationId: e.target.value } }))}>
                <option value="">Default place</option>
                {locations.data?.items.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-x-4">
        <Field label={`Receipt total (${app.currency})`} hint="Optional. Splits across the items for price history.">
          <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Store">
          <input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Expiring() {
  const app = useApp();
  const [days, setDays] = useState(7);
  const { data, loading, reload } = useQuery<any>(`/stock/expiring?days=${days}`, [days]);
  const low = useQuery<any>('/stock/low');
  const toast = useToast();

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Expiring soon" value={data?.items.length ?? 0} icon="clock"
                  tone={(data?.items.length ?? 0) > 0 ? 'warn' : 'default'} />
        <StatTile label="Below par" value={low.data?.items.length ?? 0} icon="cart" />
      </div>

      <div className="flex gap-1">
        {[3, 7, 14, 30].map((d) => (
          <button key={d} className={`btn btn-sm ${days === d ? 'btn-primary' : ''}`} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>

      <Panel title="Use these up" dense>
        {!data?.items.length ? <EmptyState icon="check" title="Nothing going off" /> : (
          <ul>
            {data.items.map((e: any) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{e.product}</p>
                  <p className="text-xs dim">{quantity(e.quantity, e.unit)} · {e.locationPath ?? 'unassigned'}</p>
                </div>
                <span className={`chip shrink-0 ${e.daysLeft <= 0 ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : ''}`}>
                  {e.daysLeft <= 0 ? 'expired' : dateLabel(e.expiryDate, app.today)}
                </span>
                <button className="btn btn-sm btn-ghost" title="Threw it out"
                        onClick={async () => {
                          await api.post(`/stock/${e.id}/adjust`, { action: 'waste', quantity: e.quantity, wasteReason: 'expired' });
                          toast.push({ message: `Binned ${e.product}` });
                          reload();
                        }}>
                  <Icon name="trash" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {low.data?.items.length > 0 && (
        <Panel title="Below par level" dense>
          <ul>
            {low.data.items.map((l: any) => (
              <li key={l.productId} className="flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm">
                <span className="flex-1 truncate">{l.name}</span>
                <span className="text-xs dim tabular-nums">
                  {quantity(l.onHand, l.unit)} of {quantity(l.minQuantity, l.unit)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs dim px-4 py-2">These are added to the shopping list automatically.</p>
        </Panel>
      )}
    </div>
  );
}

function Products() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [adding, setAdding] = useState(false);
  const { data, loading, reload } = useQuery<any>(
    `/products?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}`, [search],
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input" placeholder="Search products" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={13} /></button>
      </div>
      {loading && !data && <Spinner />}
      {data && !data.items.length && <EmptyState icon="can" title="No products" hint="Add the things you buy regularly." />}
      {data?.items.length > 0 && (
        <Panel dense>
          <table className="table">
            <thead><tr><th>Product</th><th className="text-right">On hand</th><th className="text-right">Par</th></tr></thead>
            <tbody>
              {data.items.map((p: any) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.brand && <span className="text-xs dim ml-1.5">{p.brand}</span>}
                    {!p.isFood && <span className="chip ml-1.5">household</span>}
                    {p.isPetSupply && <span className="chip ml-1.5">pet</span>}
                  </td>
                  <td className={`text-right tabular-nums ${p.isLow ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {quantity(p.onHand, p.defaultUnit)}
                  </td>
                  <td className="text-right tabular-nums dim">
                    {p.minQuantity != null ? quantity(p.minQuantity, p.defaultUnit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <AddProduct open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function AddProduct({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const categories = useQuery<any>(open ? '/product-categories?limit=200' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await api.post('/products', {
        name: form.name,
        brand: form.brand || undefined,
        categoryId: form.categoryId || undefined,
        defaultUnit: form.defaultUnit || 'ea',
        isFood: form.isFood !== 'false',
        minQuantity: form.minQuantity ? Number(form.minQuantity) : undefined,
      });
      toast.push({ message: `Added ${form.name}` });
      setForm({}); onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a product"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Add</button>
           </>}>
      <Field label="Name"><input className="input" autoFocus value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Brand"><input className="input" value={form.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Category">
          <select className="select" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {categories.data?.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Unit" hint="ea, can, bag, kg, l…">
          <input className="input" value={form.defaultUnit ?? 'ea'} onChange={(e) => set('defaultUnit', e.target.value)} />
        </Field>
        <Field label="Kind">
          <select className="select" value={form.isFood ?? 'true'} onChange={(e) => set('isFood', e.target.value)}>
            <option value="true">Food</option>
            <option value="false">Household or supply</option>
          </select>
        </Field>
        <Field label="Par level" hint="Below this, it joins the shopping list.">
          <input className="input" inputMode="decimal" value={form.minQuantity ?? ''}
                 onChange={(e) => set('minQuantity', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Waste() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/food/waste?months=6');
  if (loading && !data) return <Spinner />;
  if (!data?.items.length) {
    return <EmptyState icon="trash" title="Nothing thrown out"
                       hint="When you bin something, it is recorded here with what it cost." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatTile label="Wasted in the last 6 months" value={money(data.totalCost, app.currency)}
                  sub={`${data.items.length} items`} icon="trash" tone="warn" />
        {/* Two different numbers, and conflating them would be a lie. */}
        <StatTile label="Carbon thrown out with it" value={formatCo2e(data.embodiedGCo2e)}
                  sub="grown, shipped and chilled for the bin" icon="leaf" tone="warn" />
        <StatTile label="Emitted by the disposal" value={formatCo2e(data.disposalGCo2e)}
                  sub="landfill methane, or a fraction of it on a pile" icon="recycle" />
      </div>
      <p className="dim text-sm">{data.carbonNote}</p>
      <Panel title="Most wasted" dense>
        <table className="table">
          <thead><tr><th>Product</th><th className="text-right">Times</th><th className="text-right">Cost</th></tr></thead>
          <tbody>
            {data.byProduct.map((p: any) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="text-right tabular-nums">{p.count}</td>
                <td className="text-right tabular-nums">{money(p.cost, app.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
