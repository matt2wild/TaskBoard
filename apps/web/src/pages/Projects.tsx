import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import {
  DueChip, EmptyState, Field, Modal, Panel, Progress, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

export function Projects() {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const { data, loading, reload } = useQuery<any>('/projects?limit=100&sort=status');
  const backlog = useQuery<any>('/projects/backlog');

  const active = data?.items.filter((p: any) => p.isActive) ?? [];
  const done = data?.items.filter((p: any) => p.status === 'complete') ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Projects</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Project
        </button>
      </header>

      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="hammer" title="No projects yet"
                    hint="Start from a template: bathroom remodel, repaint a room, build a deck."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Start one</button>} />
      )}

      {active.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {active.map((p: any) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="panel card-hover p-4 block">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{p.name}</p>
                <span className="chip shrink-0">{titleCase(p.status)}</span>
              </div>
              {p.targetEnd && <p className="text-xs dim mt-0.5">Target {dateLabel(p.targetEnd, app.today)}</p>}
              <div className="mt-3 space-y-2">
                <div>
                  <div className="flex justify-between text-xs dim mb-1">
                    <span>Tasks</span><span className="tabular-nums">{p.taskDone}/{p.taskTotal}</span>
                  </div>
                  <Progress value={p.taskDone} max={p.taskTotal || 1} tone="good" />
                </div>
                {p.budgetAmount != null && (
                  <div>
                    <div className="flex justify-between text-xs dim mb-1">
                      <span>Budget</span>
                      <span className="tabular-nums">
                        {money(p.spent, app.currency)} of {money(p.budgetAmount, app.currency)}
                      </span>
                    </div>
                    <Progress value={p.spent} max={p.budgetAmount} />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {backlog.data?.items.length > 0 && (
        <Panel title="Ideas" dense
               action={<span className="text-xs dim">{money(backlog.data.totalEstimate, app.currency)} if you did them all</span>}>
          <ul>
            {backlog.data.items.map((p: any) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <Link to={`/projects/${p.id}`} className="flex-1 min-w-0 text-sm truncate hover:underline">{p.name}</Link>
                {p.estimateCost != null && (
                  <span className="text-xs dim tabular-nums">{money(p.estimateCost, app.currency)}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {done.length > 0 && (
        <Panel title="Finished" dense>
          <ul>
            {done.map((p: any) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <Icon name="check" size={14} className="dim shrink-0" />
                <Link to={`/projects/${p.id}`} className="flex-1 min-w-0 text-sm truncate hover:underline">{p.name}</Link>
                <span className="text-xs dim">{p.actualEnd ? dateLabel(p.actualEnd, app.today) : ''}</span>
                <span className="text-xs tabular-nums dim">{money(p.spent, app.currency)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <NewProject open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function NewProject({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const templates = useQuery<any>(open ? '/project-templates' : null);
  const properties = useQuery<any>(open ? '/properties' : null);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      const propertyId = properties.data?.items[0]?.id;
      if (!propertyId) throw new Error('Create a property first, under Settings.');
      const budgetAmount = budget ? Math.round(Number(budget.replace(/[^0-9.]/g, '')) * 100) : null;
      const project = templateId
        ? await api.post(`/projects/from-template/${templateId}`, { name, propertyId, budgetAmount })
        : await api.post('/projects', { name, propertyId, status: 'planning', budgetAmount });
      toast.push({ message: `Created ${project.name}` });
      setName(''); setTemplateId(''); setBudget('');
      onDone(); onClose();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New project"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>Create</button>
           </>}>
      <Field label="Name">
        <input className="input" autoFocus value={name} placeholder="Main bathroom remodel"
               onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Start from a template" hint="Brings phases, a task list, typical materials and permits.">
        <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Blank project</option>
          {templates.data?.items.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Budget" hint="Optional. Actuals come from transactions attributed to this project.">
        <input className="input" inputMode="decimal" value={budget} placeholder="12000"
               onChange={(e) => setBudget(e.target.value)} />
      </Field>
    </Modal>
  );
}

type Tab = 'work' | 'materials' | 'money' | 'people' | 'decisions';

export function ProjectDetail() {
  const { id } = useParams();
  const app = useApp();
  const [tab, setTab] = useState<Tab>('work');
  const { data, loading, reload } = useQuery<any>(id ? `/projects/${id}/overview` : null);
  const toast = useToast();

  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const p = data.project;

  const completeTask = async (taskId: string) => {
    await api.post(`/tasks/${taskId}/complete`);
    reload();
  };

  return (
    <div className="space-y-5">
      <header>
        <Link to="/projects" className="text-xs dim hover:underline">← Projects</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-0.5">
          <div>
            <h1 className="text-xl font-semibold">{p.name}</h1>
            <p className="dim text-sm">
              <span className="chip mr-1.5">{titleCase(p.status)}</span>
              {p.targetStart && `${dateLabel(p.targetStart, app.today)} → `}
              {p.targetEnd && dateLabel(p.targetEnd, app.today)}
            </p>
          </div>
          {p.status !== 'complete' && (
            <button className="btn btn-sm" onClick={async () => {
              await api.post(`/projects/${id}/complete`, {});
              toast.push({ message: 'Project marked complete' });
              reload();
            }}>
              <Icon name="check" size={13} /> Finish project
            </button>
          )}
        </div>
        {p.descriptionMd && <p className="text-sm dim mt-2 max-w-2xl">{p.descriptionMd}</p>}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label="Tasks" value={`${data.progress.taskDone}/${data.progress.taskTotal}`}
                  sub={data.progress.blocked ? `${data.progress.blocked} blocked` : 'nothing blocked'} icon="check" />
        <StatTile label="Spent" value={money(data.budget.spent, app.currency)}
                  sub={data.budget.amount != null ? `of ${money(data.budget.amount, app.currency)}` : 'no budget set'}
                  tone={data.budget.pct != null && data.budget.pct >= 100 ? 'bad' : data.budget.pct != null && data.budget.pct >= 80 ? 'warn' : 'default'}
                  icon="coin" />
        <StatTile label="Committed" value={money(data.budget.committed, app.currency)}
                  sub="accepted quotes and orders" icon="handshake" />
        <StatTile label="Materials" value={money(data.budget.materialsEstimate, app.currency)}
                  sub={`${data.materials.filter((m: any) => m.status === 'needed').length} still needed`} icon="box" />
        {/* A renovation costs money and carbon, and both are worth seeing before it starts. */}
        <StatTile label="Embodied carbon" value={formatCo2e(data.carbon.embodiedGCo2e)} icon="leaf"
                  sub={data.carbon.estimatedGCo2e > data.carbon.embodiedGCo2e
                    ? `${formatCo2e(data.carbon.estimatedGCo2e)} for the full list`
                    : `${data.carbon.activities} recorded`} />
      </div>

      {data.budget.amount != null && <Progress value={data.budget.spent} max={data.budget.amount} />}

      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'work', label: 'Work', count: data.tasks.length },
        { id: 'materials', label: 'Materials', count: data.materials.length },
        { id: 'money', label: 'Money' },
        { id: 'people', label: 'Quotes & permits', count: data.quotes.length + data.permits.length },
        { id: 'decisions', label: 'Decisions', count: data.decisions.length },
      ]} />

      {tab === 'work' && (
        <div className="space-y-4">
          {data.phases.map((phase: any) => (
            <Panel key={phase.id} dense
                   title={<span className="flex items-center gap-2">
                     {phase.name}
                     <span className="chip">{phase.taskDone}/{phase.taskTotal}</span>
                   </span>}>
              <ul>
                {data.tasks.filter((t: any) => t.phaseId === phase.id).map((t: any) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-0">
                    <button className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full border-2 shrink-0 disabled:opacity-40"
                            style={{ borderColor: t.status === 'done' ? 'var(--accent)' : 'var(--border)',
                                     background: t.status === 'done' ? 'var(--accent)' : 'transparent' }}
                            disabled={t.status === 'done' || t.isBlocked}
                            onClick={() => completeTask(t.id)} aria-label={`Complete ${t.title}`} />
                    <span className={`flex-1 text-sm min-w-0 truncate ${t.status === 'done' ? 'line-through dim' : ''}`}>
                      {t.title}
                    </span>
                    <DueChip date={t.dueDate} status={t.dueStatus} today={app.today} done={t.status === 'done'} />
                  </li>
                ))}
                {!data.tasks.some((t: any) => t.phaseId === phase.id) && (
                  <li className="px-4 py-3 text-xs dim">No tasks in this phase yet.</li>
                )}
              </ul>
            </Panel>
          ))}
          {data.tasks.some((t: any) => !t.phaseId) && (
            <Panel title="Unphased" dense>
              <ul>
                {data.tasks.filter((t: any) => !t.phaseId).map((t: any) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm">
                    <span className="flex-1 truncate">{t.title}</span>
                    <DueChip date={t.dueDate} today={app.today} done={t.status === 'done'} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {data.tools.length > 0 && (
            <Panel title="Tools needed" dense>
              <ul>
                {data.tools.map((t: any) => (
                  <li key={t.assetId} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm">
                    <Icon name="toolbox" size={14} className="dim shrink-0" />
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className={`chip ${t.available ? '' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
                {data.toolWishes.map((w: any) => (
                  <li key={w.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm">
                    <Icon name="cart" size={14} className="dim shrink-0" />
                    <span className="flex-1 truncate">{w.description}</span>
                    <span className="chip">{w.rentOrBuy}</span>
                    {w.estCost && <span className="text-xs tabular-nums dim">{money(w.estCost, app.currency)}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {tab === 'materials' && (
        <Panel dense action={
          <button className="btn btn-sm" onClick={async () => {
            const res = await api.post(`/projects/${id}/materials/to-shopping-list`);
            toast.push({ message: res.added.length ? `Added ${res.added.length} to the shopping list` : 'Nothing needed' });
          }}>
            <Icon name="cart" size={13} /> Needed → shopping list
          </button>
        }>
          <table className="table">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Estimate</th><th className="text-right">Actual</th><th>Status</th></tr></thead>
            <tbody>
              {data.materials.map((m: any) => (
                <tr key={m.id}>
                  <td>{m.description}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">{m.quantity} {m.unit}</td>
                  <td className="text-right tabular-nums">{money(m.estimatedTotal, app.currency)}</td>
                  <td className="text-right tabular-nums">{m.actualCost != null ? money(m.actualCost, app.currency) : '—'}</td>
                  <td><span className="chip">{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === 'money' && (
        <div className="space-y-4">
          {data.budget.breakdown && (
            <Panel title="Budget breakdown" dense>
              <table className="table">
                <tbody>
                  {Object.entries(data.budget.breakdown).map(([bucket, amount]) => (
                    <tr key={bucket}>
                      <td>{titleCase(bucket)}</td>
                      <td className="text-right tabular-nums">{money(amount as number, app.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
          <Panel title="Where it stands" dense>
            <table className="table">
              <tbody>
                <tr><td>Budget</td><td className="text-right tabular-nums">{money(data.budget.amount, app.currency)}</td></tr>
                <tr><td>Spent</td><td className="text-right tabular-nums">{money(data.budget.spent, app.currency)}</td></tr>
                <tr><td>Committed</td><td className="text-right tabular-nums">{money(data.budget.committed, app.currency)}</td></tr>
                <tr><td className="font-semibold">Remaining</td>
                    <td className={`text-right tabular-nums font-semibold ${(data.budget.remaining ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                      {money(data.budget.remaining, app.currency)}
                    </td></tr>
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      {tab === 'people' && (
        <div className="space-y-4">
          <Panel title="Quotes" dense>
            {!data.quotes.length ? <EmptyState icon="file" title="No quotes yet" /> : (
              <table className="table">
                <thead><tr><th>Scope</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {data.quotes.map((q: any) => (
                    <tr key={q.id}>
                      <td>{q.scope}</td>
                      <td className="text-right tabular-nums">{money(q.amount, app.currency)}</td>
                      <td><span className="chip">{q.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Permits" dense>
            {!data.permits.length ? <EmptyState icon="file" title="No permits" /> : (
              <ul>
                {data.permits.map((p: any) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm">
                    <span className="flex-1">{p.name}{p.permitNumber ? ` · ${p.permitNumber}` : ''}</span>
                    <span className="chip">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'decisions' && (
        <Panel dense>
          {!data.decisions.length ? (
            <EmptyState icon="book" title="No decisions recorded"
                        hint="Renovations are made of choices you will forget. Write them down as you make them." />
          ) : (
            <ul>
              {data.decisions.map((d: any) => (
                <li key={d.id} className="px-4 py-3 border-b last:border-0">
                  <div className="flex justify-between gap-3">
                    <p className="text-sm font-medium">{d.title}</p>
                    <span className="text-xs dim shrink-0">{dateLabel(d.decidedAt, app.today)}</span>
                  </div>
                  {d.rationaleMd && <p className="text-sm dim mt-1">{d.rationaleMd}</p>}
                  {d.alternativesMd && <p className="text-xs dim mt-1">Also considered: {d.alternativesMd}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
