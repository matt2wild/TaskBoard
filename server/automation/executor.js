// Type-specific automation execution logic

const http  = require('http')
const https = require('https')
const net   = require('net')
const { exec } = require('child_process')
const log = require('../logger')

// ── HTTP Check ──────────────────────────────────────────────────────────────

function httpCheck(config) {
  const { url, method = 'GET', expectedStatus = 200, timeout = 5000, expectedContent } = config
  const start = Date.now()

  return new Promise((resolve) => {
    let urlObj
    try { urlObj = new URL(url) } catch {
      return resolve({ success: false, error: `Invalid URL: ${url}`, duration: 0 })
    }

    const client = urlObj.protocol === 'https:' ? https : http
    const req = client.request(
      { hostname: urlObj.hostname, port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search, method },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          const duration = Date.now() - start
          const statusOk = res.statusCode === expectedStatus
          const contentOk = expectedContent ? body.includes(expectedContent) : true
          resolve({
            success: statusOk && contentOk,
            statusCode: res.statusCode,
            expectedStatus,
            contentMatch: contentOk,
            duration,
          })
        })
      }
    )

    req.setTimeout(timeout, () => {
      req.destroy()
      resolve({ success: false, error: 'timeout', duration: timeout })
    })
    req.on('error', (e) => {
      resolve({ success: false, error: e.message, duration: Date.now() - start })
    })
    req.end()
  })
}

// ── Process / Port Check ────────────────────────────────────────────────────

function portCheck(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ open: false, error: 'timeout' })
    }, timeout)

    sock.connect(port, host, () => {
      clearTimeout(timer)
      sock.destroy()
      resolve({ open: true })
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      resolve({ open: false, error: e.message })
    })
  })
}

function processNameCheck(name) {
  return new Promise((resolve) => {
    exec(`pgrep -f "${name}"`, { timeout: 3000 }, (err, stdout) => {
      const pids = stdout ? stdout.trim().split('\n').filter(Boolean) : []
      resolve({ running: pids.length > 0, pids })
    })
  })
}

async function processCheck(config) {
  const start = Date.now()
  if (config.checkType === 'port') {
    const result = await portCheck(config.host || 'localhost', config.port)
    return { success: result.open, ...result, duration: Date.now() - start }
  }
  if (config.checkType === 'process') {
    const result = await processNameCheck(config.processName)
    return { success: result.running, ...result, duration: Date.now() - start }
  }
  return { success: false, error: 'Unknown checkType', duration: 0 }
}

// ── Cron Command ────────────────────────────────────────────────────────────

function cronExec(config) {
  const { command, timeout = 30000 } = config
  const start = Date.now()

  return new Promise((resolve) => {
    exec(command, { timeout }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        exitCode: error ? (error.code || 1) : 0,
        stdout: (stdout || '').trim().slice(0, 2000),
        stderr: (stderr || '').trim().slice(0, 500),
        duration: Date.now() - start,
        error: error ? error.message : null,
      })
    })
  })
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

async function execute(automation) {
  const config = typeof automation.config === 'string'
    ? JSON.parse(automation.config)
    : automation.config

  log.debug(`Executing automation [${automation.id}] type=${automation.type}`)

  switch (automation.type) {
    case 'http_check':    return httpCheck(config)
    case 'process_check': return processCheck(config)
    case 'cron':          return cronExec(config)
    case 'webhook':
      // Webhooks are event-driven; "execute" is a no-op poll
      return { success: true, note: 'webhook — waiting for incoming push' }
    default:
      return { success: false, error: `Unknown type: ${automation.type}` }
  }
}

module.exports = { execute }
