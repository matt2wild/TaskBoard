// V-diagram: requirements, verifications, and their links

const { Router } = require('express')
const { randomUUID } = require('crypto')
const db  = require('../db')
const log = require('../logger')

const router = Router()

// ── GET full V-diagram for a task ─────────────────────────────────────────

router.get('/tasks/:id/vdiagram', (req, res) => {
  const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const requirements = db.prepare(
    'SELECT * FROM requirements WHERE task_id = ? ORDER BY position'
  ).all(req.params.id)

  const verifications = db.prepare(
    'SELECT * FROM verifications WHERE task_id = ? ORDER BY position'
  ).all(req.params.id)

  const links = db.prepare(`
    SELECT rl.requirement_id, rl.verification_id
    FROM req_ver_links rl
    JOIN requirements r ON r.id = rl.requirement_id
    WHERE r.task_id = ?
  `).all(req.params.id)

  // Summary: how many verifications are passing
  const passed  = verifications.filter(v => v.status === 'passed').length
  const failed  = verifications.filter(v => v.status === 'failed').length
  const covered = new Set(links.map(l => l.requirement_id)).size

  res.json({
    task,
    requirements,
    verifications,
    links,
    summary: {
      requirementCount: requirements.length,
      verificationCount: verifications.length,
      covered,
      passed,
      failed,
    },
  })
})

// ── Requirements CRUD ────────────────────────────────────────────────────

router.post('/tasks/:id/requirements', (req, res) => {
  const { text, priority = 'medium', source } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })

  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM requirements WHERE task_id = ?'
  ).get(req.params.id).m

  const id = randomUUID()
  db.prepare(
    'INSERT INTO requirements (id, task_id, text, priority, source, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, text, priority, source || null, maxPos + 1)

  log.info(`Created requirement ${id} on task ${req.params.id}`)
  res.status(201).json(db.prepare('SELECT * FROM requirements WHERE id = ?').get(id))
})

router.patch('/requirements/:id', (req, res) => {
  const req_ = db.prepare('SELECT * FROM requirements WHERE id = ?').get(req.params.id)
  if (!req_) return res.status(404).json({ error: 'Not found' })

  const { text, priority, source } = req.body
  db.prepare(`
    UPDATE requirements SET
      text     = COALESCE(?, text),
      priority = COALESCE(?, priority),
      source   = COALESCE(?, source)
    WHERE id = ?
  `).run(text || null, priority || null, source || null, req.params.id)

  res.json(db.prepare('SELECT * FROM requirements WHERE id = ?').get(req.params.id))
})

router.delete('/requirements/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM requirements WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM requirements WHERE id = ?').run(req.params.id)
  log.info(`Deleted requirement ${req.params.id}`)
  res.status(204).end()
})

// ── Verifications CRUD ──────────────────────────────────────────────────

router.post('/tasks/:id/verifications', (req, res) => {
  const { text, type = 'manual' } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })

  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM verifications WHERE task_id = ?'
  ).get(req.params.id).m

  const id = randomUUID()
  db.prepare(
    'INSERT INTO verifications (id, task_id, text, type, status, position) VALUES (?, ?, ?, ?, \'pending\', ?)'
  ).run(id, req.params.id, text, type, maxPos + 1)

  log.info(`Created verification ${id} on task ${req.params.id}`)
  res.status(201).json(db.prepare('SELECT * FROM verifications WHERE id = ?').get(id))
})

router.patch('/verifications/:id', (req, res) => {
  const ver = db.prepare('SELECT * FROM verifications WHERE id = ?').get(req.params.id)
  if (!ver) return res.status(404).json({ error: 'Not found' })

  const { text, type, status, result_notes } = req.body
  const verifiedAt = status === 'passed' || status === 'failed'
    ? new Date().toISOString()
    : ver.verified_at

  db.prepare(`
    UPDATE verifications SET
      text         = COALESCE(?, text),
      type         = COALESCE(?, type),
      status       = COALESCE(?, status),
      result_notes = COALESCE(?, result_notes),
      verified_at  = ?
    WHERE id = ?
  `).run(text || null, type || null, status || null, result_notes || null, verifiedAt, req.params.id)

  log.info(`Updated verification ${req.params.id} → ${status || ver.status}`)
  res.json(db.prepare('SELECT * FROM verifications WHERE id = ?').get(req.params.id))
})

router.delete('/verifications/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM verifications WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM verifications WHERE id = ?').run(req.params.id)
  log.info(`Deleted verification ${req.params.id}`)
  res.status(204).end()
})

// ── Link / unlink ─────────────────────────────────────────────────────────

// POST /api/requirements/:reqId/link/:verId
router.post('/requirements/:reqId/link/:verId', (req, res) => {
  const { reqId, verId } = req.params
  if (!db.prepare('SELECT 1 FROM requirements WHERE id = ?').get(reqId))
    return res.status(404).json({ error: 'Requirement not found' })
  if (!db.prepare('SELECT 1 FROM verifications WHERE id = ?').get(verId))
    return res.status(404).json({ error: 'Verification not found' })

  db.prepare(
    'INSERT OR IGNORE INTO req_ver_links (requirement_id, verification_id) VALUES (?, ?)'
  ).run(reqId, verId)

  log.info(`Linked req ${reqId} → ver ${verId}`)
  res.status(201).json({ requirement_id: reqId, verification_id: verId })
})

// DELETE /api/requirements/:reqId/link/:verId
router.delete('/requirements/:reqId/link/:verId', (req, res) => {
  db.prepare(
    'DELETE FROM req_ver_links WHERE requirement_id = ? AND verification_id = ?'
  ).run(req.params.reqId, req.params.verId)
  res.status(204).end()
})

module.exports = router
