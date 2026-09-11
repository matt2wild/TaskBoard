import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCo2e } from '@homestead/shared';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, quantity, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { LineChart } from '../components/Chart';
import {
  EmptyState, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast,
} from '../components/ui';

export function Pets() {
  const app = useApp();
  const { data, loading, reload } = useQuery<any>('/pets?limit=50');
  const doses = useQuery<any>('/pet-doses/today');
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Pets</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Pet
        </button>
      </header>

      {doses.data?.items.length > 0 && (
        <Panel title="Doses due" dense>
          <ul>
            {doses.data.items.map((d: any) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <Icon name="pill" size={15} className="dim shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm"><span className="font-medium">{d.petName}</span> — {d.medication}</p>
                  <p className="text-xs dim">
                    {d.dueTime}{d.status === 'missed' && <span className="text-red-600 dark:text-red-400"> · missed</span>}
                  </p>
                </div>
                <button className="btn btn-sm" onClick={async () => {
                  await api.post(`/pet-doses/${d.id}/give`);
                  toast.push({ message: 'Recorded' });
                  doses.reload();
                }}>Given</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="paw" title="No pets yet"
                    hint="Add a cat to track weight, medication, vet visits and what they cost."
                    action={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add a pet</button>} />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.items.map((p: any) => (
          <Link key={p.id} to={`/pets/${p.id}`} className="panel card-hover p-4 block">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs dim">
                  {[p.breed, p.ageYears != null ? `${p.ageYears}y` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {p.status !== 'active' && <span className="chip shrink-0">{p.status}</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
              {p.latestWeight != null && (
                <><dt className="dim">Weight</dt>
                  <dd className="text-right tabular-nums">{p.latestWeight} {p.weightUnit}</dd></>
              )}
              <dt className="dim">Medications</dt>
              <dd className="text-right tabular-nums">{p.activeMedications}</dd>
            </dl>
          </Link>
        ))}
      </div>

      <AddPet open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function AddPet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const species = useQuery<any>(open ? '/species' : null);
  const contacts = useQuery<any>(open ? '/contacts?type=vet' : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await api.post('/pets', {
        name: form.name,
        speciesCode: form.speciesCode || 'cat',
        breed: form.breed || undefined,
        sex: form.sex || undefined,
        dob: form.dob || undefined,
        microchip: form.microchip || undefined,
        primaryVetContactId: form.vetId || undefined,
        weightUnit: form.weightUnit || 'lb',
      });
      toast.push({ message: `Welcome, ${form.name}` });
      setForm({}); onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a pet"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Add</button>
           </>}>
      <Field label="Name"><input className="input" autoFocus value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Species">
          <select className="select" value={form.speciesCode ?? 'cat'} onChange={(e) => set('speciesCode', e.target.value)}>
            {species.data?.items.map((s: any) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Breed"><input className="input" value={form.breed ?? ''} onChange={(e) => set('breed', e.target.value)} /></Field>
        <Field label="Sex">
          <select className="select" value={form.sex ?? ''} onChange={(e) => set('sex', e.target.value)}>
            <option value="">Unknown</option><option value="female">Female</option><option value="male">Male</option>
          </select>
        </Field>
        <Field label="Born"><input className="input" type="date" value={form.dob ?? ''} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label="Microchip"><input className="input" value={form.microchip ?? ''} onChange={(e) => set('microchip', e.target.value)} /></Field>
        <Field label="Vet">
          <select className="select" value={form.vetId ?? ''} onChange={(e) => set('vetId', e.target.value)}>
            <option value="">None yet</option>
            {contacts.data?.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

type Tab = 'health' | 'medications' | 'journal' | 'labs' | 'costs';

export function PetDetail() {
  const { id } = useParams();
  const app = useApp();
  const [tab, setTab] = useState<Tab>('health');
  const { data, loading, reload } = useQuery<any>(id ? `/pets/${id}/overview` : null);
  const [logging, setLogging] = useState(false);
  const [weighing, setWeighing] = useState(false);

  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const pet = data.pet;

  return (
    <div className="space-y-5">
      <header>
        <Link to="/pets" className="text-xs dim hover:underline">← Pets</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-0.5">
          <div>
            <h1 className="text-xl font-semibold">{pet.name}</h1>
            <p className="dim text-sm">
              {[pet.breed, pet.sex, pet.dob ? `born ${pet.dob}` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to={`/pets/${id}/care-sheet`} className="btn btn-sm">
              <Icon name="file" size={13} /> Care sheet
            </Link>
            <button className="btn btn-sm" onClick={() => setWeighing(true)}>Weigh in</button>
            <button className="btn btn-sm btn-primary" onClick={() => setLogging(true)}>
              <Icon name="edit" size={13} /> Note
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label="Weight" value={data.weight.latest != null ? `${data.weight.latest} ${data.weight.unit}` : '—'}
                  sub={data.weight.changePct != null ? `${data.weight.changePct > 0 ? '+' : ''}${data.weight.changePct}% in a month` : undefined}
                  tone={data.weight.warn ? 'bad' : 'default'} icon="chart" />
        <StatTile label="Doses given" value={`${data.adherence.given}/${data.adherence.window}`}
                  sub={data.adherence.missed ? `${data.adherence.missed} missed` : 'on schedule'}
                  tone={data.adherence.missed ? 'warn'
                    : data.adherence.given > 0 && data.adherence.given === data.adherence.window ? 'good'
                      : 'default'} icon="pill" />
        <StatTile label="Conditions" value={data.conditions.filter((c: any) => c.status === 'active').length}
                  sub={data.conditions[0]?.name} icon="heart" />
        <StatTile label="Lifetime cost" value={money(data.spend.total, app.currency)}
                  sub={`${data.spend.count} transactions`} icon="coin" />
        <StatTile label="Footprint" value={formatCo2e(data.carbon.total)} icon="leaf"
                  sub="mostly what is in the bowl" />
      </div>

      {data.weight.warn && (
        <div className="panel p-3 flex items-start gap-2.5" style={{ borderColor: '#dc2626' }}>
          <Icon name="alert" className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm">
            {pet.name}'s weight has moved {Math.abs(data.weight.changePct)}% in about a month.
            In cats that is worth a call to the vet.
          </p>
        </div>
      )}

      {data.runOut.some((r: any) => r.daysLeft != null && r.daysLeft <= 14) && (
        <Panel title="Running out" dense>
          <ul>
            {data.runOut.filter((r: any) => r.daysLeft != null && r.daysLeft <= 14).map((r: any) => (
              <li key={`${r.kind}:${r.productId}`} className="flex items-center gap-3 px-4 py-2 border-b last:border-0 text-sm">
                <Icon name={r.kind === 'medication' ? 'pill' : 'can'} size={14} className="dim shrink-0" />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-xs dim">{quantity(r.onHand, r.unit)} left</span>
                <span className="chip">{r.daysLeft}d</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'health', label: 'Health' },
        { id: 'medications', label: 'Doses', count: data.doses.length },
        { id: 'journal', label: 'Journal', count: data.journal.length },
        { id: 'labs', label: 'Labs', count: data.labs.length },
        { id: 'costs', label: 'Costs' },
      ]} />

      {tab === 'health' && (
        <div className="space-y-4">
          <Panel title="Weight">
            <LineChart
              series={data.weight.series.map((w: any) => ({ x: w.takenAt.slice(0, 10), y: w.weight }))}
              unit={data.weight.unit}
              refLow={pet.targetWeightMin} refHigh={pet.targetWeightMax}
            />
            {pet.targetWeightMin != null && (
              <p className="text-xs dim text-center">
                Shaded band is the target range, {pet.targetWeightMin}–{pet.targetWeightMax} {pet.weightUnit}.
              </p>
            )}
          </Panel>

          {data.conditions.length > 0 && (
            <Panel title="Conditions" dense>
              <ul>
                {data.conditions.map((c: any) => (
                  <li key={c.id} className="px-4 py-2.5 border-b last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="chip">{c.status}</span>
                    </div>
                    {c.onsetDate && <p className="text-xs dim">Since {dateLabel(c.onsetDate, app.today)}</p>}
                    {c.notesMd && <p className="text-sm dim mt-1">{c.notesMd}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Vet visits" dense>
            {!data.visits.length ? <EmptyState icon="stethoscope" title="No visits recorded" /> : (
              <ul>
                {data.visits.map((v: any) => (
                  <li key={v.id} className="px-4 py-3 border-b last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium">{v.reason}</span>
                      <span className="text-xs dim shrink-0">{dateLabel(v.visitedAt, app.today)}</span>
                    </div>
                    {v.diagnosis && <p className="text-sm mt-0.5">{v.diagnosis}</p>}
                    {v.notesMd && <p className="text-xs dim mt-1">{v.notesMd}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'medications' && (
        <Panel dense>
          {!data.doses.length ? <EmptyState icon="pill" title="No doses scheduled" /> : (
            <table className="table">
              <thead><tr><th>When</th><th>Status</th><th>Given by</th></tr></thead>
              <tbody>
                {data.doses.slice().reverse().map((d: any) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{dateLabel(d.dueDate, app.today)} {d.dueTime}</td>
                    <td>
                      <span className={`chip ${d.status === 'missed' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : ''}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="dim text-xs">{d.givenAt ? new Date(d.givenAt).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === 'journal' && (
        <Panel dense>
          {!data.journal.length ? (
            <EmptyState icon="book" title="Nothing logged"
                        hint="Note what you notice. Two weeks of small observations is what a vet actually wants." />
          ) : (
            <ul>
              {data.journal.map((j: any) => (
                <li key={j.id} className="px-4 py-3 border-b last:border-0">
                  <div className="flex justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      {(j.tags ?? []).map((t: string) => <span key={t} className="chip">{t}</span>)}
                      {j.severity !== 'info' && <span className="chip">{j.severity}</span>}
                    </div>
                    <span className="text-xs dim shrink-0">{dateLabel(j.ts.slice(0, 10), app.today)}</span>
                  </div>
                  <p className="text-sm mt-1.5">{j.bodyMd}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'labs' && (
        <div className="space-y-4">
          {!data.labs.length ? <EmptyState icon="chart" title="No lab results yet" /> : data.labs.map((l: any) => (
            <Panel key={l.test} title={l.test}>
              <LineChart series={l.series.map((s: any) => ({ x: s.takenAt.slice(0, 10), y: s.value }))}
                         unit={l.series[0]?.unit} refLow={l.series[0]?.refLow} refHigh={l.series[0]?.refHigh} />
              <p className="text-xs dim text-center">
                Latest {l.series.at(-1)?.value} {l.series[0]?.unit}
                {l.series[0]?.refLow != null && ` · reference ${l.series[0].refLow}–${l.series[0].refHigh}`}
              </p>
            </Panel>
          ))}
        </div>
      )}

      {tab === 'costs' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <StatTile label={`What ${pet.name} has cost`} value={money(data.spend.total, app.currency)}
                      sub={`across ${data.spend.count} transactions`} icon="coin" />
            <StatTile label={`What ${pet.name} has emitted`} value={formatCo2e(data.carbon.total)}
                      sub={`across ${data.carbon.count} activities`} icon="leaf" />
          </div>
          <p className="text-sm dim">
            Every vet visit, medication, food purchase and supply attributed to {pet.name} rolls up here,
            in money and in carbon. Both come from the same ledger, so neither can drift from the other.
          </p>
        </div>
      )}

      <JournalModal petId={id!} open={logging} onClose={() => setLogging(false)} onDone={reload} />
      <WeighModal petId={id!} unit={pet.weightUnit} open={weighing} onClose={() => setWeighing(false)} onDone={reload} />
    </div>
  );
}

function JournalModal({ petId, open, onClose, onDone }: {
  petId: string; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const species = useQuery<any>(open ? '/species' : null);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [severity, setSeverity] = useState('info');
  const toast = useToast();
  const available: string[] = species.data?.items[0]?.journalTags ?? [];

  const submit = async () => {
    await api.post('/pet-journal', { petId, bodyMd: body, tags: [...tags], severity });
    toast.push({ message: 'Logged' });
    setBody(''); setTags(new Set()); setSeverity('info');
    onDone(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Log an observation"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!body.trim()}>Save</button>
           </>}>
      <Field label="What did you notice?">
        <textarea className="textarea" rows={3} autoFocus value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder="Threw up twice overnight in the hallway" />
      </Field>
      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => (
            <button key={t} type="button"
                    className={`chip ${tags.has(t) ? 'ring-2' : ''}`}
                    style={tags.has(t) ? { background: 'var(--accent)', color: '#fff' } : undefined}
                    onClick={() => setTags((cur) => {
                      const next = new Set(cur);
                      if (next.has(t)) next.delete(t); else next.add(t);
                      return next;
                    })}>
              {t}
            </button>
          ))}
        </div>
      </Field>
      <Field label="How concerning?">
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {['info', 'mild', 'moderate', 'severe', 'emergency'].map((s) => (
            <option key={s} value={s}>{titleCase(s)}</option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

function WeighModal({ petId, unit, open, onClose, onDone }: {
  petId: string; unit: string; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [weight, setWeight] = useState('');
  const toast = useToast();
  const submit = async () => {
    const res = await api.post(`/pets/${petId}/weights`, { weight: Number(weight) });
    toast.push({
      message: res.trend.warn
        ? `Recorded. That is a ${res.trend.changePct}% change — worth mentioning to the vet.`
        : 'Weight recorded',
    });
    setWeight(''); onDone(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Weigh in"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!Number(weight)}>Record</button>
           </>}>
      <Field label={`Weight (${unit})`}>
        <input className="input" autoFocus inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** The page you hand a sitter, or take to the vet (CAT-010). */
export function CareSheet() {
  const { id } = useParams();
  const { data, loading } = useQuery<any>(id ? `/pets/${id}/care-sheet` : null);
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const pet = data.pet;

  return (
    <div className="space-y-5 max-w-2xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link to={`/pets/${id}`} className="text-xs dim hover:underline no-print">← {pet.name}</Link>
          <h1 className="text-2xl font-semibold mt-0.5">{pet.name}</h1>
          <p className="dim text-sm">
            {[pet.breed, pet.sex, pet.ageYears != null ? `${pet.ageYears} years old` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <button className="btn btn-sm no-print" onClick={() => window.print()}>
          <Icon name="print" size={13} /> Print
        </button>
      </header>

      <Panel title="Feeding">
        {!data.feeding.length ? <p className="dim text-sm">No feeding schedule set.</p> : (
          <ul className="space-y-1.5">
            {data.feeding.map((f: any, i: number) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="tabular-nums font-medium w-14 shrink-0">{f.timeOfDay}</span>
                <span>{quantity(f.amount, f.unit)} of {f.what}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Medication">
        {!data.medications.length ? <p className="dim text-sm">No medication.</p> : (
          <ul className="space-y-3">
            {data.medications.map((m: any, i: number) => (
              <li key={i} className="text-sm">
                <p className="font-medium">
                  {m.name} {m.dose && `— ${m.dose}`} {m.route && <span className="dim">({m.route})</span>}
                </p>
                <p className="dim">
                  {m.timesOfDay.length ? m.timesOfDay.join(' and ') : 'as needed'}
                  {m.everyDays > 1 && `, every ${m.everyDays} days`}
                </p>
                {m.instructions && <p className="mt-0.5">{m.instructions}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {data.conditions.length > 0 && (
        <Panel title="Health conditions">
          <ul className="space-y-2 text-sm">
            {data.conditions.map((c: any, i: number) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span>
                {c.notes && <p className="dim">{c.notes}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {pet.careNotesMd && (
        <Panel title="Things to know">
          <p className="text-sm whitespace-pre-line">{pet.careNotesMd}</p>
        </Panel>
      )}

      <Panel title="In an emergency">
        <dl className="text-sm space-y-2">
          {data.vet && (
            <div>
              <dt className="dim text-xs">Regular vet</dt>
              <dd>{data.vet.name}
                {(data.vet.phones ?? []).map((p: any) => <span key={p.number} className="ml-2">{p.number}</span>)}
              </dd>
            </div>
          )}
          {data.emergencyVet && (
            <div>
              <dt className="dim text-xs">Emergency vet</dt>
              <dd className="font-medium">{data.emergencyVet.name}
                {(data.emergencyVet.phones ?? []).map((p: any) => <span key={p.number} className="ml-2">{p.number}</span>)}
              </dd>
            </div>
          )}
          {pet.microchip && (
            <div><dt className="dim text-xs">Microchip</dt><dd className="tabular-nums">{pet.microchip}</dd></div>
          )}
          {data.insurance && (
            <div>
              <dt className="dim text-xs">Insurance</dt>
              <dd>Policy {data.insurance.policyNumber}</dd>
            </div>
          )}
        </dl>
      </Panel>

      {data.vaccinations.length > 0 && (
        <Panel title="Vaccinations" dense>
          <table className="table">
            <tbody>
              {data.vaccinations.map((v: any, i: number) => (
                <tr key={i}>
                  <td>{v.vaccine}</td>
                  <td className="dim">given {v.givenAt}</td>
                  <td className="text-right dim">{v.nextDue ? `next ${v.nextDue}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p className="text-xs dim">Generated {new Date(data.generatedAt).toLocaleString()}</p>
    </div>
  );
}
