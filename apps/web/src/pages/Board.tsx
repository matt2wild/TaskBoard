import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import { DueChip, EmptyState, Modal, Field, Spinner, useToast } from '../components/ui';

/** The kanban view. Drag on desktop, a move menu on touch. */
export function Board() {
  const app = useApp();
  const boards = useQuery<{ items: any[] }>('/boards');
  const [boardId, setBoardId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (!boardId && boards.data?.items.length) setBoardId(boards.data.items[0].id);
  }, [boards.data, boardId]);

  const view = useQuery<any>(boardId ? `/boards/${boardId}/view` : null, [boardId]);
  const [dragging, setDragging] = useState<string | null>(null);

  const place = useCallback(async (taskId: string, laneId: string) => {
    if (!boardId) return;
    try {
      await api.put(`/boards/${boardId}/placements`, { taskId, laneId });
      view.reload();
    } catch (err) {
      toast.push({ message: (err as Error).message, tone: 'error' });
    }
  }, [boardId, view, toast]);

  const createBoard = async () => {
    const board = await api.post('/boards', { name });
    setName(''); setCreating(false);
    boards.reload();
    setBoardId(board.id);
  };

  if (boards.loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Board</h1>
          {boards.data && boards.data.items.length > 0 && (
            <select className="select w-auto" value={boardId ?? ''} onChange={(e) => setBoardId(e.target.value)}>
              {boards.data.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <Link to="/tasks" className="btn btn-sm">List</Link>
          <button className="btn btn-sm" onClick={() => setCreating(true)}><Icon name="plus" size={13} /> Board</button>
        </div>
      </header>

      {!boards.data?.items.length && (
        <EmptyState icon="box" title="No boards yet"
                    hint="A board is a view over your tasks. Make one for the house, or one per project."
                    action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Create a board</button>} />
      )}

      {view.data && (
        <div className="flex gap-3 overflow-x-auto scroll-thin pb-2 -mx-4 px-4 lg:mx-0 lg:px-0">
          {view.data.lanes.map((lane: any) => (
            <div
              key={lane.id}
              className="w-72 shrink-0 panel flex flex-col max-h-[70vh]"
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragging) place(dragging, lane.id); setDragging(null); }}
            >
              <header className="px-3 py-2.5 border-b flex items-center justify-between gap-2">
                <span className="text-sm font-semibold truncate">{lane.name}</span>
                <span className="chip tabular-nums">
                  {lane.tasks.length}{lane.wipLimit ? ` / ${lane.wipLimit}` : ''}
                </span>
              </header>
              <ul className="p-2 space-y-2 overflow-y-auto scroll-thin flex-1">
                {lane.tasks.map((t: any) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={() => setDragging(t.id)}
                    onDragEnd={() => setDragging(null)}
                    className="panel p-2.5 cursor-grab active:cursor-grabbing card-hover"
                    style={{ background: 'var(--panel-alt)' }}
                  >
                    <p className={`text-sm leading-snug ${t.status === 'done' ? 'line-through dim' : ''}`}>{t.title}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <DueChip date={t.dueDate} status={t.dueStatus} today={app.today} done={t.status === 'done'} />
                      {t.priority !== 'normal' && <span className="chip">{t.priority}</span>}
                    </div>
                    <div className="flex gap-1 mt-2 lg:hidden">
                      {view.data.lanes.filter((l: any) => l.id !== lane.id).map((l: any) => (
                        <button key={l.id} className="btn btn-sm btn-ghost text-[11px]"
                                onClick={() => place(t.id, l.id)}>
                          → {l.name}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
                {!lane.tasks.length && <li className="text-xs dim text-center py-6">Drop tasks here</li>}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New board"
             footer={<button className="btn btn-primary" onClick={createBoard} disabled={!name.trim()}>Create</button>}>
        <Field label="Name" hint="Three lanes are created for you: To do, Doing, Done.">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="House" />
        </Field>
      </Modal>
    </div>
  );
}
