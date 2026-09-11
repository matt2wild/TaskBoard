import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { DueChip, EmptyState, ErrorNote, Modal, Field, Panel, Spinner, Tabs, useToast } from '../components/ui';
import { originIcon } from './Today';

type View = 'today' | 'upcoming' | 'overdue' | 'unscheduled' | 'all';

export function Tasks() {
  const app = useApp();
  const [view, setView] = useState<View>('today');
  const [mine, setMine] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const toast = useToast();

  const path = `/tasks/views/${view}${qs({ assignee: mine ? app.user?.id : undefined, days: 21 })}`;
  const { data, error, loading, reload } = useQuery<any>(path, [mine]);

  const complete = useCallback(async (id: string, title: string) => {
    await api.post(`/tasks/${id}/complete`);
    toast.push({ message: `Done: ${title}`, undo: async () => { await api.post(`/tasks/${id}/reopen`); reload(); } });
    reload();
  }, [reload, toast]);

  const bulk = useCallback(async (action: string, ids: string[], extra: Record<string, unknown> = {}) => {
    const res = await api.post('/tasks/bulk', { ids, action, ...extra });
    toast.push({ message: `${res.affected} updated` });
    reload();
  }, [reload, toast]);

  const grouped = useMemo(() => {
    const items: any[] = data?.items ?? [];
    if (view !== 'upcoming') return [{ label: null as string | null, items }];
    const byDate = new Map<string, any[]>();
    for (const t of items) {
      const key = t.dueDate ?? 'Someday';
      const list = byDate.get(key) ?? [];
      list.push(t);
      byDate.set(key, list);
    }
    return [...byDate].map(([label, list]) => ({ label, items: list }));
  }, [data, view]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <div className="flex gap-2">
          <Link to="/tasks/board" className="btn btn-sm"><Icon name="box" size={13} /> Board</Link>
          <Link to="/tasks/calendar" className="btn btn-sm"><Icon name="calendar" size={13} /> Calendar</Link>
        </div>
      </header>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs<View>
          active={view} onChange={setView}
          tabs={[
            { id: 'today', label: 'Today' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'unscheduled', label: 'Someday' },
            { id: 'all', label: 'All' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm dim">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Only mine
        </label>
      </div>

      {view === 'overdue' && (data?.items.length ?? 0) > 0 && (
        <div className="panel px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
          <span className="dim">{data.items.length} overdue. Pull them all to today?</span>
          <button className="btn btn-sm"
                  onClick={() => bulk('reschedule', data.items.map((t: any) => t.id), { dueDate: app.today })}>
            Move to today
          </button>
        </div>
      )}

      {error && <ErrorNote error={error} retry={reload} />}
      {loading && !data && <Spinner />}

      {data && !data.items.length && (
        <EmptyState icon="check" title="Nothing here"
                    hint={view === 'today' ? 'Nothing is due today.' : 'This list is empty.'} />
      )}

      {grouped.map((group) => group.items.length > 0 && (
        <div key={group.label ?? 'all'}>
          {group.label && (
            <h2 className="text-xs font-semibold uppercase tracking-wide dim mb-1.5 mt-4">
              {dateLabel(group.label, app.today)}
            </h2>
          )}
          <Panel dense>
            <ul>
              {group.items.map((t: any) => (
                <li key={t.id} className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0">
                  <button
                    className="mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 hover:border-[var(--accent)] disabled:opacity-40"
                    style={{ borderColor: 'var(--border)' }}
                    disabled={t.isBlocked}
                    onClick={() => complete(t.id, t.title)}
                    aria-label={`Complete ${t.title}`}
                  />
                  <button className="flex-1 min-w-0 text-left" onClick={() => setDetailId(t.id)}>
                    <p className="text-sm leading-snug">{t.title}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {view !== 'upcoming' && <DueChip date={t.dueDate} status={t.dueStatus} today={app.today} />}
                      {t.dueTime && <span className="chip">{t.dueTime}</span>}
                      {t.priority !== 'normal' && <span className="chip">{t.priority}</span>}
                      {t.originType !== 'manual' && (
                        <span className="chip"><Icon name={originIcon(t.originType)} size={11} />
                          {titleCase(t.originType)}</span>
                      )}
                      {t.isBlocked && <span className="chip">blocked by {t.blockedBy}</span>}
                      {t.checklistTotal > 0 && <span className="chip tabular-nums">{t.checklistDone}/{t.checklistTotal}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ))}

      <TaskDetail id={detailId} onClose={() => setDetailId(null)} onChange={reload} />
    </div>
  );
}

export function TaskDetail({ id, onClose, onChange }: {
  id: string | null; onClose: () => void; onChange: () => void;
}) {
  const app = useApp();
  const { data, reload } = useQuery<any>(id ? `/tasks/${id}/detail` : null);
  const [note, setNote] = useState('');
  const toast = useToast();

  const complete = async () => {
    if (!id) return;
    await api.post(`/tasks/${id}/complete`, { note: note || undefined });
    toast.push({ message: 'Marked done' });
    onChange(); onClose();
  };

  const toggleItem = async (itemId: string, done: boolean) => {
    await api.patch(`/checklist-items/${itemId}`, { done });
    reload();
  };

  return (
    <Modal open={!!id} onClose={onClose} title={data?.title ?? 'Task'}
           footer={data && data.status !== 'done' ? (
             <>
               <button className="btn" onClick={() => { void api.post(`/tasks/${id}/snooze`, { days: 1 }); onChange(); onClose(); }}>
                 Snooze a day
               </button>
               <button className="btn btn-primary" onClick={complete} disabled={data.isBlocked}>Mark done</button>
             </>
           ) : undefined}>
      {!data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <DueChip date={data.dueDate} status={data.dueStatus} today={app.today} />
            <span className="chip">{data.status.replace('_', ' ')}</span>
            <span className="chip">{data.priority}</span>
            {data.originType !== 'manual' && <span className="chip">{titleCase(data.originType)}</span>}
          </div>

          {data.descriptionMd && <p className="text-sm whitespace-pre-line dim">{data.descriptionMd}</p>}

          {data.schedule && (
            <div className="panel p-3 text-sm flex items-start gap-2">
              <Icon name="repeat" size={15} className="dim mt-0.5 shrink-0" />
              <div>
                <p>{data.schedule.description}</p>
                {data.schedule.lastCompletedAt && (
                  <p className="dim text-xs mt-0.5">Last done {dateLabel(data.schedule.lastCompletedAt, app.today)}</p>
                )}
              </div>
            </div>
          )}

          {data.checklist.length > 0 && (
            <div>
              <h3 className="label">Checklist</h3>
              <ul className="space-y-1">
                {data.checklist.map((c: any) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-0.5" checked={c.done}
                             onChange={(e) => toggleItem(c.id, e.target.checked)} />
                      <span className={c.done ? 'line-through dim' : ''}>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.blockedBy.length > 0 && (
            <div>
              <h3 className="label">Waiting on</h3>
              <ul className="text-sm space-y-1">
                {data.blockedBy.map((b: any) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <Icon name={b.status === 'done' ? 'check' : 'clock'} size={13} className="dim" />
                    <span className={b.status === 'done' ? 'dim line-through' : ''}>{b.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.status !== 'done' && (
            <Field label="Completion note (optional)">
              <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="Anything worth remembering next time" />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
