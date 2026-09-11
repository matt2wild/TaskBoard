import { useState } from 'react';
import { api } from '../lib/api';
import { useDebounced, useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, Panel, Spinner, useToast } from '../components/ui';

export function Contacts() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, reload } = useQuery<any>(
    `/contacts?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}${type ? `&type=${type}` : ''}`,
    [search, type],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Contact
        </button>
      </header>

      <div className="flex gap-2">
        <input className="input" placeholder="Search" value={term} onChange={(e) => setTerm(e.target.value)} />
        <select className="select w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All kinds</option>
          {['contractor', 'vendor', 'vet', 'service_provider', 'person', 'insurer', 'utility', 'authority']
            .map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </div>

      {loading && !data && <Spinner />}
      {data && !data.items.length && (
        <EmptyState icon="user" title="No contacts"
                    hint="Contractors, vets, suppliers. Their whole history with you lives on their page." />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.items.map((c: any) => (
          <button key={c.id} className="panel card-hover p-3.5 text-left" onClick={() => setSelected(c.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{c.name}</p>
                <p className="text-xs dim">{titleCase(c.type)}</p>
              </div>
              {c.rating && <span className="chip shrink-0">{'★'.repeat(c.rating)}</span>}
            </div>
            {(c.phones ?? []).slice(0, 1).map((p: any) => (
              <p key={p.number} className="text-xs dim mt-1.5">{p.number}</p>
            ))}
            {(c.specialties ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {c.specialties.slice(0, 3).map((s: string) => <span key={s} className="chip">{s}</span>)}
              </div>
            )}
          </button>
        ))}
      </div>

      <ContactHistory id={selected} onClose={() => setSelected(null)} />
      <AddContact open={adding} onClose={() => setAdding(false)} onDone={reload} />
    </div>
  );
}

function ContactHistory({ id, onClose }: { id: string | null; onClose: () => void }) {
  const app = useApp();
  const { data } = useQuery<any>(id ? `/contacts/${id}/history` : null);
  return (
    <Modal open={!!id} onClose={onClose} title={data?.contact.name ?? ''} wide>
      {!data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip">{titleCase(data.contact.type)}</span>
            {data.contact.rating && <span className="chip">{'★'.repeat(data.contact.rating)}</span>}
            {data.spend.total > 0 && (
              <span className="chip">{money(data.spend.total, app.currency)} across {data.spend.count} payments</span>
            )}
          </div>

          {(data.contact.phones ?? []).length > 0 && (
            <dl className="text-sm space-y-1">
              {data.contact.phones.map((p: any) => (
                <div key={p.number} className="flex gap-2">
                  <dt className="dim w-16">{p.label}</dt><dd>{p.number}</dd>
                </div>
              ))}
              {data.contact.email && <div className="flex gap-2"><dt className="dim w-16">email</dt><dd>{data.contact.email}</dd></div>}
            </dl>
          )}

          {data.contact.notesMd && <p className="text-sm whitespace-pre-line dim">{data.contact.notesMd}</p>}

          {data.jobs.length > 0 && (
            <div>
              <h3 className="label">Work done</h3>
              <ul className="text-sm space-y-1">
                {data.jobs.map((j: any) => (
                  <li key={j.id} className="flex justify-between gap-2">
                    <span>{j.title}</span>
                    <span className="dim shrink-0">{dateLabel(j.performedAt, app.today)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.quotes.length > 0 && (
            <div>
              <h3 className="label">Quotes</h3>
              <ul className="text-sm space-y-1">
                {data.quotes.map((q: any) => (
                  <li key={q.id} className="flex justify-between gap-2">
                    <span>{q.scope}</span>
                    <span className="shrink-0">{money(q.amount, app.currency)} <span className="chip ml-1">{q.status}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.visits.length > 0 && (
            <div>
              <h3 className="label">Vet visits</h3>
              <ul className="text-sm space-y-1">
                {data.visits.map((v: any) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span>{v.reason}</span>
                    <span className="dim shrink-0">{dateLabel(v.visitedAt, app.today)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.openLoans > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {data.openLoans} of your things are with them right now.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddContact({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      await api.post('/contacts', {
        name: form.name,
        type: form.type || 'vendor',
        email: form.email || undefined,
        website: form.website || undefined,
        phones: form.phone ? [{ label: 'main', number: form.phone }] : undefined,
        specialties: form.specialties ? form.specialties.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        notesMd: form.notes || undefined,
      });
      toast.push({ message: `Added ${form.name}` });
      setForm({}); onDone(); onClose();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a contact"
           footer={<>
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Add</button>
           </>}>
      <Field label="Name"><input className="input" autoFocus value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Kind">
          <select className="select" value={form.type ?? 'vendor'} onChange={(e) => set('type', e.target.value)}>
            {['contractor', 'vendor', 'vet', 'service_provider', 'person', 'insurer', 'utility', 'authority']
              .map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </Field>
        <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Website"><input className="input" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} /></Field>
      </div>
      <Field label="Specialties" hint="Comma separated: plumbing, hvac">
        <input className="input" value={form.specialties ?? ''} onChange={(e) => set('specialties', e.target.value)} />
      </Field>
      <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  );
}
