import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { DueChip, EmptyState, ErrorNote, Field, Modal, Panel, Spinner, StatTile, useToast } from '../components/ui';

export function Assets() {
  const app = useApp();
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useQuery<any>(
    `/assets?limit=200&count=true${search ? `&q=${encodeURIComponent(search)}` : ''}`, [search],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Assets</h1>
        <div className="flex gap-2">
          <Link to="/maintenance" className="btn btn-sm"><Icon name="wrench" size={13} /> Maintenance</Link>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Asset
          </button>
        </div>
      </header>

      <input className="input" placeholder="Search by name, make, model or serial"
             value={term} onChange={(e) => setTerm(e.target.value)} />

      {error && <ErrorNote error={error} retry={reload} />}
      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="cpu" title="No assets yet"
                    hint="Add the furnace, the water heater, the roof. Anything with a lifespan worth tracking."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add the first one</button>} />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.items.map((a: any) => (
          <Link key={a.id} to={`/assets/${a.id}`} className="panel card-hover p-3.5 block">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{a.name}</p>
                <p className="text-xs dim truncate">
                  {[a.make, a.model].filter(Boolean).join(' ') || a.locationPath || '—'}
                </p>
              </div>
              {a.status !== 'active' && <span className="chip shrink-0">{a.status}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
              {a.ageYears != null && (
                <><dt className="dim">Age</dt><dd className="text-right tabular-nums">{a.ageYears}y</dd></>
              )}
              {a.totalCost > 0 && (
                <><dt className="dim">Cost so far</dt><dd className="text-right tabular-nums">{money(a.totalCost, app.currency)}</dd></>
              )}
              {a.warrantyDaysLeft != null && (
                <><dt className="dim">Warranty</dt>
                  <dd className={`text-right tabular-nums ${a.warrantyDaysLeft < 60 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {a.warrantyDaysLeft < 0 ? 'ended' : `${a.warrantyDaysLeft}d`}
                  </dd></>
              )}
              {a.replacementYear && (
                <><dt className="dim">Replace by</dt><dd className="text-right tabular-nums">{a.replacementYear}</dd></>
              )}
            </dl>
            {a.nextMaintenanceDue && (
              <div className="mt-2.5 pt-2.5 border-t flex items-center gap-1.5">
                <Icon name="wrench" size={12} className="dim" />
                <DueChip date={a.nextMaintenanceDue} today={app.today} />
              </div>
            )}
          </Link>
        ))}
      </div>

      <AddAsset open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function AddAsset({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const properties = useQuery<any>(open ? '/properties' : null);
  const locations = useQuery<any>(open ? '/locations?limit=300' : null);
  const categories = useQuery<any>(open ? '/asset-categories?limit=300' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const propertyId = form.propertyId ?? properties.data?.items[0]?.id;
      if (!propertyId) throw new Error('Create a property first, under Settings.');
      const asset = await api.post('/assets', {
        propertyId, name: form.name,
        locationId: form.locationId || undefined,
        categoryId: form.categoryId || undefined,
        make: form.make || undefined, model: form.model || undefined, serial: form.serial || undefined,
        installedDate: form.installedDate || undefined,
        purchasePrice: form.purchasePrice ? Math.round(Number(form.purchasePrice) * 100) : undefined,
        expectedLifespanYears: form.expectedLifespanYears ? Number(form.expectedLifespanYears) : undefined,
      });
      toast.push({ message: `Added ${asset.name}` });
      setForm({});
      onDone(); onClose();
      navigate(`/assets/${asset.id}`);
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add an asset" wide
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy || !form.name}>Add</button>
           </>}>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Name">
          <input className="input" autoFocus value={form.name ?? ''} placeholder="Furnace"
                 onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Category" hint="Picking one offers the matching maintenance templates.">
          <select className="select" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {categories.data?.items.filter((c: any) => c.parentId).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <select className="select" value={form.locationId ?? ''} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">Unassigned</option>
            {locations.data?.items.map((l: any) => <option key={l.id} value={l.id}>{l.path ?? l.name}</option>)}
          </select>
        </Field>
        <Field label="Make"><input className="input" value={form.make ?? ''} onChange={(e) => set('make', e.target.value)} /></Field>
        <Field label="Model"><input className="input" value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Serial"><input className="input" value={form.serial ?? ''} onChange={(e) => set('serial', e.target.value)} /></Field>
        <Field label="Installed"><input className="input" type="date" value={form.installedDate ?? ''} onChange={(e) => set('installedDate', e.target.value)} /></Field>
        <Field label="Purchase price"><input className="input" inputMode="decimal" value={form.purchasePrice ?? ''} onChange={(e) => set('purchasePrice', e.target.value)} /></Field>
        <Field label="Expected life (years)"><input className="input" inputMode="numeric" value={form.expectedLifespanYears ?? ''} onChange={(e) => set('expectedLifespanYears', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** What repairing this thing has bought, and not had manufactured (CIRC-002). */
function Repairs({ assetId, currency }: { assetId: string; currency: string }) {
  const { data, loading } = useQuery<any>(`/assets/${assetId}/circularity`);
  if (loading || !data?.repairs.length) return null;
  return (
    <Panel title="Repairs" dense
           action={<span className="dim text-xs">
             {formatCo2e(data.avoidedGCo2e)} and {money(data.avoidedCost, currency)} not spent
           </span>}>
      <table className="table">
        <tbody>
          {data.repairs.map((r: any) => (
            <tr key={r.id}>
              <td className="dim whitespace-nowrap">{r.occurredOn}</td>
              <td>
                {r.symptom}
                {r.workDone && <span className="dim block text-xs">{r.workDone}</span>}
              </td>
              <td className="text-right">
                <span className={`chip ${r.outcome === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : ''}`}>
                  {r.outcome}
                </span>
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {money(r.partsCost, currency)}
                {r.extendedLifeYears && (
                  <span className="dim block text-xs">+{r.extendedLifeYears}y</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim text-xs px-4 py-2">
        Against {formatCo2e(data.embodied.grams)} embodied in {data.embodied.basis}. The
        avoided figure is a counterfactual and is not subtracted from the footprint.
      </p>
    </Panel>
  );
}

export function AssetDetail() {
  const { id } = useParams();
  const app = useApp();
  const timeline = useQuery<any>(id ? `/assets/${id}/timeline` : null);
  const asset = useQuery<any>(id ? `/assets/${id}` : null);
  const suggestions = useQuery<any>(id ? `/assets/${id}/template-suggestions` : null);
  const plans = useQuery<any>(id ? `/maintenance/plans?targetType=asset&targetId=${id}` : null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toast = useToast();

  if (!timeline.data || !asset.data) return <Spinner />;
  const a = asset.data;

  const applyTemplates = async () => {
    await api.post(`/assets/${id}/apply-templates`, { templateIds: [...chosen] });
    toast.push({ message: `Added ${chosen.size} maintenance plan${chosen.size === 1 ? '' : 's'}` });
    setChosen(new Set()); setPicking(false);
    plans.reload(); suggestions.reload(); asset.reload();
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/assets" className="text-xs dim hover:underline">← Assets</Link>
          <h1 className="text-xl font-semibold mt-0.5">{a.name}</h1>
          <p className="dim text-sm">
            {[a.make, a.model].filter(Boolean).join(' ')}
            {a.serial ? ` · ${a.serial}` : ''}
            {a.locationPath ? ` · ${a.locationPath}` : ''}
          </p>
        </div>
        {suggestions.data?.items.some((t: any) => !t.alreadyApplied) && (
          <button className="btn btn-primary btn-sm" onClick={() => setPicking(true)}>
            <Icon name="wrench" size={13} /> Add maintenance
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label="Age" value={a.ageYears != null ? `${a.ageYears}y` : '—'}
                  sub={a.installedDate ? `since ${a.installedDate}` : undefined} icon="clock" />
        <StatTile label="Cost of ownership" value={money(a.totalCost, app.currency)}
                  sub={`${money(a.maintenanceSpend, app.currency)} in upkeep`} icon="coin" />
        <StatTile label="Warranty"
                  value={a.warrantyDaysLeft == null ? '—' : a.warrantyDaysLeft < 0 ? 'Ended' : `${a.warrantyDaysLeft}d`}
                  sub={a.warrantyExpiry ?? undefined} icon="file"
                  tone={a.warrantyDaysLeft != null && a.warrantyDaysLeft < 60 && a.warrantyDaysLeft >= 0 ? 'warn' : 'default'} />
        <StatTile label="Replace by" value={a.replacementYear ?? '—'}
                  sub={a.lifeExtendedYears
                    ? `${a.lifeExtendedYears}y bought by repairs`
                    : a.replacementCostEstimate ? money(a.replacementCostEstimate, app.currency) : 'no estimate'}
                  tone={a.lifeExtendedYears ? 'good' : 'default'}
                  icon="repeat" />
        {/* What it has cost and what it has emitted come from the same ledger. */}
        <StatTile label="Emitted" value={formatCo2e(a.gCo2e)} icon="leaf"
                  sub={timeline.data.carbon.count
                    ? `${timeline.data.carbon.count} activities`
                    : 'nothing attributed yet'} />
      </div>

      <Repairs assetId={id!} currency={app.currency} />

      {a.notesMd && <Panel title="Notes"><p className="text-sm whitespace-pre-line">{a.notesMd}</p></Panel>}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Panel title="Maintenance plans" dense>
          {!plans.data?.items.length ? (
            <EmptyState icon="wrench" title="No plans"
                        hint={suggestions.data?.categorySlug
                          ? 'The template library has suggestions for this category.'
                          : 'Give the asset a category to get template suggestions.'} />
          ) : (
            <ul>
              {plans.data.items.map((p: any) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{p.title}</p>
                    <p className="text-xs dim">{p.schedule?.description ?? 'no schedule'}</p>
                  </div>
                  {p.nextDue && <DueChip date={p.nextDue} status={p.dueStatus} today={app.today} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="History" dense>
          {!timeline.data.events.length ? (
            <EmptyState icon="clock" title="Nothing recorded yet" />
          ) : (
            <ul>
              {timeline.data.events.map((e: any, i: number) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0">
                  <Icon name={e.kind === 'repair' ? 'alert' : e.kind === 'purchased' ? 'coin' : 'wrench'}
                        size={14} className="dim mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{e.label}</p>
                    <p className="text-xs dim">{dateLabel(e.at, app.today)} · {titleCase(e.kind)}</p>
                  </div>
                  {e.amount != null && <span className="text-xs tabular-nums dim">{money(e.amount, app.currency)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {timeline.data.readings.length > 0 && (
        <Panel title="Readings" dense>
          <table className="table">
            <thead><tr><th>Metric</th><th>Value</th><th>Taken</th></tr></thead>
            <tbody>
              {timeline.data.readings.slice(0, 20).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.metric}</td>
                  <td className="tabular-nums">{r.value} {r.unit ?? ''}</td>
                  <td className="dim">{dateLabel(r.takenAt.slice(0, 10), app.today)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} title="Maintenance templates" wide
             footer={<>
               <button className="btn" onClick={() => setPicking(false)}>Cancel</button>
               <button className="btn btn-primary" onClick={applyTemplates} disabled={!chosen.size}>
                 Add {chosen.size || ''} plan{chosen.size === 1 ? '' : 's'}
               </button>
             </>}>
        <p className="text-sm dim mb-3">
          Ready-made schedules for a {suggestions.data?.categorySlug?.replace(/-/g, ' ')}. Tick the ones that apply.
        </p>
        <ul className="space-y-1">
          {suggestions.data?.items.map((t: any) => (
            <li key={t.id}>
              <label className={`flex items-start gap-2.5 p-2.5 rounded-lg ${t.alreadyApplied ? 'opacity-50' : 'hover:bg-[var(--panel-alt)]'}`}>
                <input type="checkbox" className="mt-0.5" disabled={t.alreadyApplied}
                       checked={chosen.has(t.id)}
                       onChange={(e) => setChosen((cur) => {
                         const next = new Set(cur);
                         if (e.target.checked) next.add(t.id); else next.delete(t.id);
                         return next;
                       })} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm block">{t.title}</span>
                  <span className="text-xs dim block">
                    {t.description}{t.estimateMin ? ` · about ${t.estimateMin} min` : ''}
                    {t.alreadyApplied ? ' · already added' : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
