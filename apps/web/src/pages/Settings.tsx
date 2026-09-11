import { useState } from 'react';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { relativeTime, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, Panel, Spinner, StatTile, Tabs, useToast } from '../components/ui';

type Tab = 'household' | 'places' | 'members' | 'notifications' | 'data' | 'about';

export function Settings() {
  const [tab, setTab] = useState<Tab>('household');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { id: 'household', label: 'Household' },
        { id: 'places', label: 'Property' },
        { id: 'members', label: 'Members' },
        { id: 'notifications', label: 'Reminders' },
        { id: 'data', label: 'Data' },
        { id: 'about', label: 'About' },
      ]} />
      {tab === 'household' && <Household />}
      {tab === 'places' && <Places />}
      {tab === 'members' && <Members />}
      {tab === 'notifications' && <Reminders />}
      {tab === 'data' && <Data />}
      {tab === 'about' && <About />}
    </div>
  );
}

function Household() {
  const app = useApp();
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const value = (k: keyof NonNullable<typeof app.household>) =>
    form[k] ?? (app.household?.[k] as string) ?? '';

  const save = async () => {
    await api.patch('/admin/household', {
      name: value('name'), timezone: value('timezone'),
      currency: value('currency').toUpperCase(), unitSystem: value('unitSystem'),
    });
    toast.push({ message: 'Saved' });
    await app.reload();
    setForm({});
  };

  return (
    <Panel title="Household">
      <Field label="Name">
        <input className="input" value={value('name')} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Timezone" hint="Reminders fire on this clock.">
        <input className="input" value={value('timezone')} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Currency">
          <input className="input" maxLength={3} value={value('currency')}
                 onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Units">
          <select className="select" value={value('unitSystem')}
                  onChange={(e) => setForm((f) => ({ ...f, unitSystem: e.target.value }))}>
            <option value="imperial">Imperial</option>
            <option value="metric">Metric</option>
          </select>
        </Field>
      </div>
      <div className="flex justify-between items-center">
        <div className="flex gap-1">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button key={t} className={`btn btn-sm ${app.theme === t ? 'btn-primary' : ''}`}
                    onClick={() => app.setTheme(t)}>{titleCase(t)}</button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>
    </Panel>
  );
}

function Places() {
  const properties = useQuery<any>('/properties');
  const tree = useQuery<any>('/locations/tree');
  const [addingProperty, setAddingProperty] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const createProperty = async () => {
    await api.post('/properties', { name: form.propertyName, isPrimary: !properties.data?.items.length });
    toast.push({ message: 'Property added' });
    setForm({}); setAddingProperty(false);
    properties.reload();
  };

  const createLocation = async () => {
    const propertyId = form.propertyId || properties.data?.items[0]?.id;
    if (!propertyId) { toast.push({ message: 'Add a property first', tone: 'error' }); return; }
    await api.post('/locations', {
      propertyId, name: form.locationName, type: form.locationType || 'room',
      parentId: form.parentId || undefined,
      holdsFood: form.holdsFood === 'true',
      temperatureClass: form.holdsFood === 'true' ? (form.temperatureClass || 'ambient') : undefined,
      shortCode: form.shortCode || undefined,
    });
    toast.push({ message: 'Place added' });
    setForm({}); setAddingLocation(false);
    tree.reload();
  };

  const flatten = (nodes: any[], depth = 0): any[] =>
    nodes.flatMap((n) => [{ ...n, depth }, ...flatten(n.children, depth + 1)]);
  const flat = flatten(tree.data?.items ?? []);

  return (
    <div className="space-y-4">
      <Panel title="Properties" dense
             action={<button className="btn btn-sm" onClick={() => setAddingProperty(true)}>
               <Icon name="plus" size={13} /> Property</button>}>
        {!properties.data?.items.length ? (
          <EmptyState icon="home" title="No property yet"
                      hint="Add the house before anything else. Assets, rooms and projects hang off it."
                      action={<button className="btn btn-primary" onClick={() => setAddingProperty(true)}>Add the house</button>} />
        ) : (
          <ul>
            {properties.data.items.map((p: any) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm">
                <Icon name="home" size={14} className="dim" />
                <span className="flex-1">{p.name}</span>
                {p.isPrimary && <span className="chip">primary</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Rooms and containers" dense
             action={<button className="btn btn-sm" onClick={() => setAddingLocation(true)}>
               <Icon name="plus" size={13} /> Place</button>}>
        {!flat.length ? (
          <EmptyState icon="box" title="No places yet"
                      hint="Rooms, shelves, bins, the fridge. Everything gets put somewhere." />
        ) : (
          <ul>
            {flat.map((l: any) => (
              <li key={l.id} className="flex items-center gap-2 px-4 py-1.5 border-b last:border-0 text-sm">
                <span style={{ paddingLeft: `${l.depth * 1.1}rem` }} className="flex-1 truncate">{l.name}</span>
                <span className="chip">{l.type}</span>
                {l.holdsFood && <span className="chip">{l.temperatureClass}</span>}
                {l.shortCode && <span className="chip">{l.shortCode}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal open={addingProperty} onClose={() => setAddingProperty(false)} title="Add a property"
             footer={<button className="btn btn-primary" onClick={createProperty} disabled={!form.propertyName}>Add</button>}>
        <Field label="Name"><input className="input" autoFocus value={form.propertyName ?? ''}
                                   onChange={(e) => set('propertyName', e.target.value)} placeholder="Home" /></Field>
      </Modal>

      <Modal open={addingLocation} onClose={() => setAddingLocation(false)} title="Add a place"
             footer={<button className="btn btn-primary" onClick={createLocation} disabled={!form.locationName}>Add</button>}>
        <Field label="Name"><input className="input" autoFocus value={form.locationName ?? ''}
                                   onChange={(e) => set('locationName', e.target.value)} placeholder="Garage" /></Field>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Kind">
            <select className="select" value={form.locationType ?? 'room'} onChange={(e) => set('locationType', e.target.value)}>
              {['building', 'floor', 'room', 'zone', 'container', 'shelf', 'exterior', 'vehicle']
                .map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </Field>
          <Field label="Inside">
            <select className="select" value={form.parentId ?? ''} onChange={(e) => set('parentId', e.target.value)}>
              <option value="">Nothing (top level)</option>
              {flat.map((l: any) => <option key={l.id} value={l.id}>{'— '.repeat(l.depth)}{l.name}</option>)}
            </select>
          </Field>
          <Field label="Holds food?">
            <select className="select" value={form.holdsFood ?? 'false'} onChange={(e) => set('holdsFood', e.target.value)}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </Field>
          {form.holdsFood === 'true' && (
            <Field label="Temperature" hint="Sets default expiry dates.">
              <select className="select" value={form.temperatureClass ?? 'ambient'}
                      onChange={(e) => set('temperatureClass', e.target.value)}>
                <option value="ambient">Ambient</option>
                <option value="refrigerated">Refrigerated</option>
                <option value="frozen">Frozen</option>
              </select>
            </Field>
          )}
        </div>
        <Field label="Label code" hint="Optional short code you can write on a bin.">
          <input className="input" value={form.shortCode ?? ''} onChange={(e) => set('shortCode', e.target.value.toUpperCase())} />
        </Field>
      </Modal>
    </div>
  );
}

function Members() {
  const app = useApp();
  const members = useQuery<any>('/members');
  const invites = useQuery<any>('/members/invites');
  const [role, setRole] = useState('member');
  const [madeLink, setMadeLink] = useState<string | null>(null);
  const toast = useToast();

  const invite = async () => {
    const res = await api.post('/members/invites', { role, days: 7 });
    setMadeLink(`${location.origin}${res.url}`);
    invites.reload();
  };

  return (
    <div className="space-y-4">
      <Panel title="Members" dense>
        {members.loading ? <Spinner /> : (
          <ul>
            {members.data?.items.map((m: any) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0">
                <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-semibold shrink-0"
                      style={{ background: 'var(--panel-alt)' }}>
                  {m.displayName.slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{m.displayName}</p>
                  <p className="text-xs dim">
                    {m.username} · {m.lastLoginAt ? `last in ${relativeTime(m.lastLoginAt)}` : 'never signed in'}
                  </p>
                </div>
                <span className="chip">{m.role}</span>
                {!m.isActive && <span className="chip">inactive</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {app.user?.role === 'admin' && (
        <Panel title="Invite someone">
          <Field label="What should they be able to do?"
                 hint="Limited is right for a house-sitter: they see only what you share with them.">
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member — full access to shared data</option>
              <option value="limited">Limited — only what is shared with them</option>
              <option value="readonly">Read only</option>
              <option value="admin">Admin — can manage members and settings</option>
            </select>
          </Field>
          <button className="btn btn-primary" onClick={invite}>Create an invite link</button>
          {madeLink && (
            <div className="panel p-3 mt-3">
              <p className="text-xs dim mb-1">Single use, expires in a week. Copy it now.</p>
              <code className="text-xs break-all">{madeLink}</code>
              <button className="btn btn-sm mt-2" onClick={() => {
                void navigator.clipboard?.writeText(madeLink);
                toast.push({ message: 'Copied' });
              }}>Copy</button>
            </div>
          )}
          {invites.data?.items.filter((i: any) => !i.usedAt).length > 0 && (
            <p className="text-xs dim mt-3">
              {invites.data.items.filter((i: any) => !i.usedAt).length} invite(s) outstanding.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

function Reminders() {
  const { data, loading, reload } = useQuery<any>('/notifications/preferences');
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, { channels: string[]; timing: string }>>({});

  if (loading && !data) return <Spinner />;

  const current = (eventType: string) =>
    draft[eventType] ?? data.items.find((i: any) => i.eventType === eventType);

  const save = async () => {
    await api.put('/notifications/preferences', {
      items: data.items.map((i: any) => ({
        eventType: i.eventType,
        channels: current(i.eventType).channels,
        timing: current(i.eventType).timing,
      })),
    });
    toast.push({ message: 'Reminder settings saved' });
    setDraft({}); reload();
  };

  return (
    <Panel title="What you get told about" dense
           action={<button className="btn btn-sm btn-primary" onClick={save}>Save</button>}>
      <table className="table">
        <thead><tr><th>Event</th><th>In app</th><th>Email</th><th>When</th></tr></thead>
        <tbody>
          {data.items.map((i: any) => {
            const cur = current(i.eventType);
            const toggle = (channel: string, on: boolean) => setDraft((d) => ({
              ...d,
              [i.eventType]: {
                timing: cur.timing,
                channels: on ? [...new Set([...cur.channels, channel])] : cur.channels.filter((c: string) => c !== channel),
              },
            }));
            return (
              <tr key={i.eventType}>
                <td className="text-sm">{titleCase(i.eventType.replace('.', ' '))}</td>
                <td><input type="checkbox" checked={cur.channels.includes('inapp')}
                           onChange={(e) => toggle('inapp', e.target.checked)} /></td>
                <td><input type="checkbox" checked={cur.channels.includes('email')}
                           onChange={(e) => toggle('email', e.target.checked)} /></td>
                <td>
                  <select className="select w-32" value={cur.timing}
                          onChange={(e) => setDraft((d) => ({ ...d, [i.eventType]: { channels: cur.channels, timing: e.target.value } }))}>
                    <option value="immediate">Immediately</option>
                    <option value="daily_digest">Daily digest</option>
                    <option value="off">Never</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function Data() {
  const { data, loading, reload } = useQuery<any>('/admin/status');
  const backups = useQuery<any>('/admin/backups');
  const toast = useToast();
  if (loading && !data) return <Spinner />;

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Database" value={mb(data.database.bytes)} icon="bank" />
        <StatTile label="Files" value={data.fileStorage.count} sub={mb(data.fileStorage.onDisk)} icon="file" />
        <StatTile label="Scheduler"
                  value={data.scheduler.lastSuccessful === data.today ? 'Ran today' : 'Waiting'}
                  sub={data.scheduler.enabled ? 'enabled' : 'disabled'}
                  tone={data.scheduler.lastSuccessful === data.today ? 'good' : 'warn'} icon="clock" />
        <StatTile label="Failed reminders" value={data.notifications.failedDeliveries}
                  tone={data.notifications.failedDeliveries ? 'bad' : 'default'} icon="bell" />
      </div>

      <Panel title="Your data is yours">
        <p className="text-sm dim mb-3">
          The export is a ZIP with every table as CSV and JSON Lines, plus every file you uploaded.
          Nothing about it needs Homestead to read it.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href="/api/v1/admin/export" download>
            <Icon name="external" size={13} /> Download an export
          </a>
          <button className="btn" onClick={async () => {
            const res = await api.post('/admin/backup');
            toast.push({ message: `Backup written: ${res.file}` });
            backups.reload(); reload();
          }}>
            Take a backup now
          </button>
          <button className="btn" onClick={async () => {
            const res = await api.post('/admin/scheduler/run', { force: true });
            toast.push({ message: res.ran ? 'Reminder pass complete' : 'Already ran today' });
            reload();
          }}>
            Run the reminder pass
          </button>
        </div>
      </Panel>

      {backups.data?.items.length > 0 && (
        <Panel title="Backups on disk" dense>
          <ul>
            {backups.data.items.slice(0, 8).map((b: any) => (
              <li key={b.name} className="flex justify-between items-center px-4 py-2 border-b last:border-0 text-sm">
                <span className="truncate">{b.name}</span>
                <span className="text-xs dim shrink-0 ml-2">{mb(b.bytes)} · {relativeTime(b.takenAt)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs dim px-4 py-2">In {backups.data.dir}</p>
        </Panel>
      )}

      <Panel title="What is in the database" dense>
        <table className="table">
          <tbody>
            {Object.entries(data.rowCounts)
              .filter(([, n]) => (n as number) > 0)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .map(([table, n]) => (
                <tr key={table}>
                  <td className="text-sm">{titleCase(table)}</td>
                  <td className="text-right tabular-nums text-sm">{n as number}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function About() {
  const { data } = useQuery<any>('/admin/status');
  return (
    <Panel title="About Homestead">
      <dl className="text-sm space-y-2">
        <div className="flex gap-3"><dt className="dim w-32">Version</dt><dd>{data?.version ?? '—'}</dd></div>
        <div className="flex gap-3"><dt className="dim w-32">Timezone</dt><dd>{data?.timezone}</dd></div>
        <div className="flex gap-3"><dt className="dim w-32">External lookups</dt>
          <dd>{data?.externalLookups ? 'Enabled' : 'Off — nothing leaves this server'}</dd></div>
        <div className="flex gap-3"><dt className="dim w-32">API</dt>
          <dd><a className="hover:underline" href="/api/v1/docs" target="_blank" rel="noreferrer">
            Documentation <Icon name="external" size={11} className="inline" /></a></dd></div>
      </dl>
      <p className="text-sm dim mt-4">
        Self-hosted home management. No telemetry, no phone-home, no account anywhere else.
      </p>
    </Panel>
  );
}
