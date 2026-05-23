// Automation CRUD, SSE stream, webhook receiver, and manual trigger

const { Router } = require('express')
const { randomUUID } = require('crypto')
const db  = require('../db')
const sse = require('../sse')
const log = require('../logger')

const router = Router()

// ── SSE stream ────────────────────────────────────────────────────────────────

// GET /api/automations/stream — clients connect here for live status pushes
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send current snapshot on connect
  const automations = db.prepare('SELECT id, status, last_run, last_result FROM automations').all()
  res.write(`event: snapshot\ndata: ${JSON.stringify(automations)}\n\n`)

  sse.addClient(res)
  log.debug('SSE client connected')

  req.on('close', () => {
    sse.removeClient(res)
    log.debug('SSE client disconnected')
  })
})

// ── Automation CRUD ───────────────────────────────────────────────────────────

// GET /api/automations — list all with task title
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, t.title AS task_title
    FROM automations a
    JOIN tasks t ON t.id = a.task_id
    ORDER BY a.created_at DESC
  `).all()
  res.json(rows)
})

// GET /api/automations/:id — detail + last 20 logs
router.get('/:id', (req, res) => {
  const auto = db.prepare(`
    SELECT a.*, t.title AS task_title
    FROM automations a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.id = ?
  `).get(req.params.id)
  if (!auto) return res.status(404).json({ error: 'Not found' })

  const logs = db.prepare(
    'SELECT * FROM automation_logs WHERE automation_id = ? ORDER BY run_at DESC LIMIT 20'
  ).all(req.params.id)

  res.json({ ...auto, logs })
})

// POST /api/automations — create
router.post('/', (req, res) => {
  const { taskId, name, type, config, schedule, enabled = true } = req.body
  if (!taskId || !name || !type || !config)
    return res.status(400).json({ error: 'taskId, name, type, config required' })

  const validTypes = ['http_check', 'process_check', 'cron', 'webhook']
  if (!validTypes.includes(type))
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })

  const id = randomUUID()
  db.prepare(`
    INSERT INTO automations (id, task_id, name, type, config, enabled, schedule)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, taskId, name, type, JSON.stringify(config), enabled ? 1 : 0, schedule || '*/5 * * * *')

  // Dynamically schedule if enabled (runner is already started)
  if (enabled) {
    const { scheduleAutomation } = require('../automation/runner')
    scheduleAutomation(db.prepare('SELECT * FROM automations WHERE id = ?').get(id))
  }

  log.info(`Created automation ${id} (${type}) for task ${taskId}`)
  res.status(201).json(db.prepare('SELECT * FROM automations WHERE id = ?').get(id))
})

// PATCH /api/automations/:id — update
router.patch('/:id', (req, res) => {
  const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)
  if (!auto) return res.status(404).json({ error: 'Not found' })

  const { name, type, config, schedule, enabled } = req.body

  db.prepare(`
    UPDATE automations SET
      name     = COALESCE(?, name),
      type     = COALESCE(?, type),
      config   = COALESCE(?, config),
      schedule = COALESCE(?, schedule),
      enabled  = COALESCE(?, enabled),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    type || null,
    config ? JSON.stringify(config) : null,
    schedule || null,
    enabled !== undefined ? (enabled ? 1 : 0) : null,
    req.params.id
  )

  const updated = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)
  const { scheduleAutomation, unscheduleAutomation } = require('../automation/runner')
  updated.enabled ? scheduleAutomation(updated) : unscheduleAutomation(req.params.id)

  log.info(`Updated automation ${req.params.id}`)
  res.json(updated)
})

// DELETE /api/automations/:id
router.delete('/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM automations WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Not found' })

  const { unscheduleAutomation } = require('../automation/runner')
  unscheduleAutomation(req.params.id)
  db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id)
  log.info(`Deleted automation ${req.params.id}`)
  res.status(204).end()
})

// POST /api/automations/:id/trigger — manual run
router.post('/:id/trigger', async (req, res) => {
  if (!db.prepare('SELECT 1 FROM automations WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Not found' })

  log.info(`Manual trigger: ${req.params.id}`)
  const { triggerNow } = require('../automation/runner')
  await triggerNow(req.params.id)
  const updated = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)
  res.json(updated)
})

// GET /api/automations/:id/logs
router.get('/:id/logs', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200)
  const offset = parseInt(req.query.offset) || 0
  const logs = db.prepare(
    'SELECT * FROM automation_logs WHERE automation_id = ? ORDER BY run_at DESC LIMIT ? OFFSET ?'
  ).all(req.params.id, limit, offset)
  res.json(logs)
})

// ── Webhook receiver ──────────────────────────────────────────────────────────

// POST /webhooks/:id — external systems push events here
router.post('/webhooks/:id', (req, res) => {
  const auto = db.prepare('SELECT * FROM automations WHERE id = ? AND type = ?')
    .get(req.params.id, 'webhook')
  if (!auto) return res.status(404).json({ error: 'Webhook automation not found' })

  const now  = new Date().toISOString()
  const payload = { receivedAt: now, body: req.body, headers: req.headers }
  const resultJson = JSON.stringify(payload)

  db.prepare(`
    UPDATE automations SET status = 'success', last_run = ?, last_result = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(now, resultJson, auto.id)

  db.prepare(`
    INSERT INTO automation_logs (id, automation_id, status, result)
    VALUES (?, ?, 'success', ?)
  `).run(randomUUID(), auto.id, resultJson)

  sse.broadcast('automation-update', { automationId: auto.id, status: 'success', result: payload, lastRun: now })
  log.info(`Webhook received for automation ${auto.id}`)
  res.json({ ok: true })
})

module.exports = router
