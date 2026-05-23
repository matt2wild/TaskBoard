const Database = require('better-sqlite3')
const path = require('path')
const { randomUUID } = require('crypto')
const log = require('./logger')

const DB_PATH = path.join(__dirname, '..', 'taskboard.db')
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Schema ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    parent_task_id  TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS columns (
    id              TEXT PRIMARY KEY,
    board_id        TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    subtitle        TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    color_key       TEXT,
    is_automation   INTEGER NOT NULL DEFAULT 0,
    allow_new_tasks INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    board_id        TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id       TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    due_date        TEXT,
    repeat_pattern  TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    sub_board_id    TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS automations (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('http_check','process_check','cron','webhook')),
    config      TEXT NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','running','success','failure','error')),
    last_run    TEXT,
    last_result TEXT,
    schedule    TEXT NOT NULL DEFAULT '*/5 * * * *',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS automation_logs (
    id             TEXT PRIMARY KEY,
    automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    status         TEXT NOT NULL CHECK(status IN ('success','failure','timeout','error')),
    result         TEXT,
    error          TEXT,
    duration_ms    INTEGER,
    run_at         TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_board     ON tasks(board_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_column    ON tasks(column_id);
  CREATE INDEX IF NOT EXISTS idx_columns_board   ON columns(board_id);
  CREATE INDEX IF NOT EXISTS idx_logs_automation ON automation_logs(automation_id);
`)

// ── Seed ───────────────────────────────────────────────────────────────────

function seed() {
  if (db.prepare('SELECT 1 FROM boards WHERE id = ?').get('root')) return

  log.info('Seeding initial data')

  const insertBoard = db.prepare('INSERT INTO boards (id, title, parent_task_id) VALUES (?, ?, ?)')
  const insertCol   = db.prepare(`
    INSERT INTO columns (id, board_id, title, subtitle, position, color_key, is_automation, allow_new_tasks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTask  = db.prepare(`
    INSERT INTO tasks (id, board_id, column_id, title, description, due_date, repeat_pattern, position, sub_board_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAuto  = db.prepare(`
    INSERT INTO automations (id, task_id, name, type, config, enabled, status, schedule)
    VALUES (?, ?, ?, ?, ?, 1, 'pending', ?)
  `)

  db.transaction(() => {
    // ── Root board & columns ──────────────────────────────────────────────
    insertBoard.run('root', 'Root Board', null)

    insertCol.run('col_automations', 'root', 'Automations', null,            0, 'automations', 1, 0)
    insertCol.run('col_todo',        'root', 'To Do',       null,            1, null,           0, 1)
    insertCol.run('col_late',        'root', 'Late',        null,            2, 'late',         0, 0)
    insertCol.run('col_onHold',      'root', 'Not My Problem', '(right now)',3, 'onHold',       0, 0)
    insertCol.run('col_inProgress',  'root', 'In Progress', null,            4, 'inProgress',   0, 0)
    insertCol.run('col_completed',   'root', 'Completed',   null,            5, 'completed',    0, 0)

    // ── Root tasks (sub_board_id null for now — set after boards exist) ───
    insertTask.run('task_1', 'root', 'col_automations', 'Trash',                   null,                                               '22:00',      'Tuesday',  0, null)
    insertTask.run('task_7', 'root', 'col_automations', 'Laundry',                 null,                                               '12:00',      'Saturday', 1, null)
    insertTask.run('task_2', 'root', 'col_todo',        'Design portfolio website', 'Overall layout and structure',                     '2022-02-01', null,       0, null)
    insertTask.run('task_8', 'root', 'col_todo',        'Make this persistent',    null,                                                '2022-02-10', null,       1, null)
    insertTask.run('task_9', 'root', 'col_todo',        'Add sub-boards to tasks', null,                                                '2022-02-10', null,       2, null)
    insertTask.run('task_3', 'root', 'col_late',        'Finish Bookshelf',        null,                                                '2022-02-14', null,       0, null)
    insertTask.run('task_6', 'root', 'col_onHold',      'Figure out Wipro W2',     'Low confidence they will send one. Escalate on due date.', '2022-03-01', null, 0, null)
    insertTask.run('task_4', 'root', 'col_completed',   'Buy Stain',               'Dark coffee color',                                 '2022-02-02', null,       0, null)

    // ── Sub-board for "Finish Bookshelf" ─────────────────────────────────
    insertBoard.run('board_task_3', 'Finish Bookshelf', 'task_3')

    insertCol.run('board_task_3_todo',       'board_task_3', 'To Do',       null, 0, null,        0, 1)
    insertCol.run('board_task_3_inProgress', 'board_task_3', 'In Progress', null, 1, 'inProgress', 0, 0)
    insertCol.run('board_task_3_done',       'board_task_3', 'Done',        null, 2, 'completed',  0, 0)

    insertTask.run('task_5', 'board_task_3', 'board_task_3_todo',
      'Apply Stain', "Assemble first — check for cold-warped boards", '2022-02-02', null, 0, null)

    // Now link task_3 → its sub-board
    db.prepare("UPDATE tasks SET sub_board_id = 'board_task_3' WHERE id = 'task_3'").run()

    // ── Sample automations ────────────────────────────────────────────────
    insertAuto.run(
      randomUUID(), 'task_1', 'Health endpoint check',
      'http_check',
      JSON.stringify({ url: 'http://localhost:3001/api/health', expectedStatus: 200, timeout: 4000 }),
      '*/2 * * * *'
    )
    insertAuto.run(
      randomUUID(), 'task_7', 'Local port monitor',
      'process_check',
      JSON.stringify({ checkType: 'port', host: 'localhost', port: 3001 }),
      '*/1 * * * *'
    )
  })()

  log.info('Seed complete')
}

seed()

module.exports = db
