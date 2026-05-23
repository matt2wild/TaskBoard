// Board, column, and task CRUD routes

const { Router } = require('express')
const { randomUUID } = require('crypto')
const db  = require('../db')
const log = require('../logger')

const router = Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFullBoard(boardId) {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return null

  const columns = db.prepare(
    'SELECT * FROM columns WHERE board_id = ? ORDER BY position'
  ).all(boardId)

  const tasksRaw = db.prepare(
    'SELECT * FROM tasks WHERE board_id = ? ORDER BY position'
  ).all(boardId)

  // Attach automation status to each task (if any)
  const autoByTask = {}
  const autos = db.prepare(
    `SELECT a.id, a.task_id, a.name, a.type, a.status, a.last_run, a.last_result, a.schedule, a.enabled
     FROM automations a
     WHERE a.task_id IN (SELECT id FROM tasks WHERE board_id = ?)`
  ).all(boardId)
  for (const a of autos) {
    if (!autoByTask[a.task_id]) autoByTask[a.task_id] = []
    autoByTask[a.task_id].push(a)
  }

  const tasksByCol = {}
  for (const t of tasksRaw) {
    if (!tasksByCol[t.column_id]) tasksByCol[t.column_id] = []
    tasksByCol[t.column_id].push({ ...t, automations: autoByTask[t.id] || [] })
  }

  return {
    id: board.id,
    title: board.title,
    parentTaskId: board.parent_task_id || null,
    columns: columns.map(c => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle || null,
      position: c.position,
      colorKey: c.color_key,
      isAutomation: !!c.is_automation,
      allowNewTasks: !!c.allow_new_tasks,
      tasks: tasksByCol[c.id] || [],
    })),
  }
}

// ── Board routes ─────────────────────────────────────────────────────────────

// GET /api/boards/:id
router.get('/:id', (req, res) => {
  const board = getFullBoard(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found' })
  log.debug(`GET board ${req.params.id} (${board.columns.length} cols)`)
  res.json(board)
})

// POST /api/boards — create a standalone board
router.post('/', (req, res) => {
  const { title } = req.body
  if (!title) return res.status(400).json({ error: 'title required' })
  const id = randomUUID()
  db.prepare('INSERT INTO boards (id, title) VALUES (?, ?)').run(id, title)
  log.info(`Created board ${id}: ${title}`)
  res.status(201).json({ id, title })
})

// ── Task routes ───────────────────────────────────────────────────────────────

// POST /api/tasks — create a task
router.post('/tasks', (req, res) => {
  const { boardId, columnId, title, description, dueDate, repeatPattern } = req.body
  if (!boardId || !columnId || !title)
    return res.status(400).json({ error: 'boardId, columnId, title required' })

  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as m FROM tasks WHERE column_id = ?'
  ).get(columnId).m

  const id = randomUUID()
  db.prepare(`
    INSERT INTO tasks (id, board_id, column_id, title, description, due_date, repeat_pattern, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, boardId, columnId, title, description || null, dueDate || null, repeatPattern || null, maxPos + 1)

  log.info(`Created task ${id}: "${title}" in ${columnId}`)
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
})

// PATCH /api/tasks/:id — update task fields
router.patch('/tasks/:id', (req, res) => {
  const { title, description, dueDate, repeatPattern } = req.body
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  db.prepare(`
    UPDATE tasks SET
      title          = COALESCE(?, title),
      description    = ?,
      due_date       = ?,
      repeat_pattern = ?,
      updated_at     = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    description !== undefined ? description : task.description,
    dueDate !== undefined ? dueDate : task.due_date,
    repeatPattern !== undefined ? repeatPattern : task.repeat_pattern,
    req.params.id
  )
  log.info(`Updated task ${req.params.id}`)
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id))
})

// DELETE /api/tasks/:id
router.delete('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  log.info(`Deleted task ${req.params.id}`)
  res.status(204).end()
})

// POST /api/tasks/:id/move — drag-and-drop reorder
router.post('/tasks/:id/move', (req, res) => {
  const { targetColumnId, targetPosition } = req.body
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const srcColId = task.column_id
  const dstColId = targetColumnId

  db.transaction(() => {
    if (srcColId === dstColId) {
      // Reorder within same column
      const tasks = db.prepare(
        'SELECT id FROM tasks WHERE column_id = ? ORDER BY position'
      ).all(srcColId).map(t => t.id)
      tasks.splice(tasks.indexOf(req.params.id), 1)
      tasks.splice(targetPosition, 0, req.params.id)
      const upd = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
      tasks.forEach((id, i) => upd.run(i, id))
    } else {
      // Move to different column: remove from source, insert at dest
      const srcTasks = db.prepare(
        'SELECT id FROM tasks WHERE column_id = ? ORDER BY position'
      ).all(srcColId).map(t => t.id).filter(id => id !== req.params.id)
      const dstTasks = db.prepare(
        'SELECT id FROM tasks WHERE column_id = ? ORDER BY position'
      ).all(dstColId).map(t => t.id)

      dstTasks.splice(targetPosition, 0, req.params.id)

      db.prepare('UPDATE tasks SET column_id = ?, board_id = (SELECT board_id FROM columns WHERE id = ?) WHERE id = ?')
        .run(dstColId, dstColId, req.params.id)

      const upd = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
      srcTasks.forEach((id, i) => upd.run(i, id))
      dstTasks.forEach((id, i) => upd.run(i, id))
    }
  })()

  log.info(`Moved task ${req.params.id} → col=${dstColId} pos=${targetPosition}`)
  res.json({ ok: true })
})

// POST /api/tasks/:id/sub-board — create a new sub-board for this task
router.post('/tasks/:id/sub-board', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  if (task.sub_board_id) {
    return res.json({ boardId: task.sub_board_id, existing: true })
  }

  const boardId = `board_${req.params.id}`

  db.transaction(() => {
    db.prepare('INSERT INTO boards (id, title, parent_task_id) VALUES (?, ?, ?)')
      .run(boardId, task.title, task.id)

    const insertCol = db.prepare(
      'INSERT INTO columns (id, board_id, title, position, allow_new_tasks) VALUES (?, ?, ?, ?, ?)'
    )
    insertCol.run(`${boardId}_todo`,        boardId, 'To Do',       0, 1)
    insertCol.run(`${boardId}_inProgress`,  boardId, 'In Progress', 1, 0)
    insertCol.run(`${boardId}_done`,        boardId, 'Done',        2, 0)

    db.prepare('UPDATE tasks SET sub_board_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(boardId, task.id)
  })()

  log.info(`Created sub-board ${boardId} for task ${req.params.id}`)
  res.status(201).json({ boardId, existing: false })
})

module.exports = router
