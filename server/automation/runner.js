// Automation scheduler — loads automations from DB, schedules via node-cron,
// persists results, and broadcasts SSE updates.

const cron = require('node-cron')
const { randomUUID } = require('crypto')
const db = require('../db')
const { execute } = require('./executor')
const { broadcast } = require('../sse')
const log = require('../logger')

const jobs = new Map()   // automationId → cron.Task

// ── Run one automation ───────────────────────────────────────────────────────

async function runAutomation(automationId) {
  const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(automationId)
  if (!auto || !auto.enabled) return

  log.debug(`Running automation ${automationId} (${auto.name})`)

  db.prepare(`UPDATE automations SET status = 'running', updated_at = datetime('now') WHERE id = ?`)
    .run(automationId)
  broadcast('automation-update', { automationId, status: 'running' })

  let result, status
  try {
    result = await execute(auto)
    status = result.success ? 'success' : 'failure'
  } catch (err) {
    result = { error: err.message }
    status = 'error'
    log.error(`Automation ${automationId} threw:`, err.message)
  }

  const now = new Date().toISOString()
  const resultJson = JSON.stringify(result)

  db.prepare(`
    UPDATE automations
    SET status = ?, last_run = ?, last_result = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, now, resultJson, automationId)

  db.prepare(`
    INSERT INTO automation_logs (id, automation_id, status, result, error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    automationId,
    status,
    resultJson,
    result.error || null,
    result.duration || null
  )

  log.info(`Automation [${auto.name}] → ${status}`)
  broadcast('automation-update', { automationId, status, result, lastRun: now })
}

// ── Schedule management ──────────────────────────────────────────────────────

function scheduleAutomation(auto) {
  if (jobs.has(auto.id)) {
    jobs.get(auto.id).stop()
    jobs.delete(auto.id)
  }

  if (!auto.enabled) return

  if (!cron.validate(auto.schedule)) {
    log.warn(`Invalid cron expression for automation ${auto.id}: "${auto.schedule}"`)
    return
  }

  const task = cron.schedule(auto.schedule, () => runAutomation(auto.id), { scheduled: true })
  jobs.set(auto.id, task)
  log.info(`Scheduled automation [${auto.name}] on "${auto.schedule}"`)
}

function unscheduleAutomation(automationId) {
  if (jobs.has(automationId)) {
    jobs.get(automationId).stop()
    jobs.delete(automationId)
    log.info(`Unscheduled automation ${automationId}`)
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

function startAll() {
  const automations = db.prepare('SELECT * FROM automations WHERE enabled = 1').all()
  log.info(`Starting ${automations.length} automation(s)`)
  automations.forEach(scheduleAutomation)
}

// ── Manual trigger ────────────────────────────────────────────────────────────

async function triggerNow(automationId) {
  return runAutomation(automationId)
}

module.exports = { startAll, scheduleAutomation, unscheduleAutomation, triggerNow }
