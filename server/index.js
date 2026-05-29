const express = require('express')
const cors    = require('cors')
const path    = require('path')
const log     = require('./logger')

const boardRoutes      = require('./routes/boards')
const automationRoutes = require('./routes/automations')
const vdiagramRoutes   = require('./routes/vdiagram')
const { startAll }     = require('./automation/runner')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: 'http://localhost:3000' }))
app.use(express.json())

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/boards',      boardRoutes)
app.use('/api/automations', automationRoutes)
app.use('/api',             vdiagramRoutes)

// Webhook receiver hangs off the automations router but needs its own path
// (already registered inside automations.js as /webhooks/:id on the router,
//  but we expose it at /webhooks/:id at the root level for external access)
app.post('/webhooks/:id', (req, res, next) => {
  req.url = `/webhooks/${req.params.id}`
  automationRoutes(req, res, next)
})

// ── Serve production build ─────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '..', 'build')
app.use(express.static(buildDir))
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')))

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log.info(`Server listening on http://localhost:${PORT}`)
  startAll()
})

module.exports = app
