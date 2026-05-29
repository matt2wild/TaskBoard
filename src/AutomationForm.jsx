import React, { useState } from 'react'
import { createAutomation } from './api'
import { log, warn } from './logger'

const TYPES = [
  { value: 'http_check',    label: 'HTTP Check',    desc: 'Poll a URL and verify the response' },
  { value: 'process_check', label: 'Process/Port',  desc: 'Check if a local port or process is running' },
  { value: 'cron',          label: 'Cron Command',  desc: 'Run a shell command on a schedule' },
  { value: 'webhook',       label: 'Webhook',       desc: 'Receive HTTP events from external systems' },
]

function HttpConfig({ config, onChange }) {
  return (
    <div className="auto-config-fields">
      <label>URL
        <input type="url" value={config.url || ''} placeholder="https://example.com/health"
          onChange={e => onChange({ ...config, url: e.target.value })} />
      </label>
      <label>Expected status
        <input type="number" value={config.expectedStatus || 200} min="100" max="599"
          onChange={e => onChange({ ...config, expectedStatus: parseInt(e.target.value) })} />
      </label>
      <label>Timeout (ms)
        <input type="number" value={config.timeout || 5000} min="500" max="30000" step="500"
          onChange={e => onChange({ ...config, timeout: parseInt(e.target.value) })} />
      </label>
    </div>
  )
}

function ProcessConfig({ config, onChange }) {
  return (
    <div className="auto-config-fields">
      <label>Check type
        <select value={config.checkType || 'port'} onChange={e => onChange({ ...config, checkType: e.target.value })}>
          <option value="port">Port</option>
          <option value="process">Process name</option>
        </select>
      </label>
      {(config.checkType || 'port') === 'port' ? (
        <>
          <label>Host
            <input type="text" value={config.host || 'localhost'}
              onChange={e => onChange({ ...config, host: e.target.value })} />
          </label>
          <label>Port
            <input type="number" value={config.port || ''} placeholder="8080" min="1" max="65535"
              onChange={e => onChange({ ...config, port: parseInt(e.target.value) })} />
          </label>
        </>
      ) : (
        <label>Process name
          <input type="text" value={config.processName || ''} placeholder="nginx"
            onChange={e => onChange({ ...config, processName: e.target.value })} />
        </label>
      )}
    </div>
  )
}

function CronConfig({ config, onChange }) {
  return (
    <div className="auto-config-fields">
      <label>Shell command
        <input type="text" value={config.command || ''} placeholder="echo hello"
          onChange={e => onChange({ ...config, command: e.target.value })} />
      </label>
      <label>Timeout (ms)
        <input type="number" value={config.timeout || 30000} min="1000" max="300000" step="1000"
          onChange={e => onChange({ ...config, timeout: parseInt(e.target.value) })} />
      </label>
    </div>
  )
}

function WebhookConfig({ taskId }) {
  const url = `${window.location.origin}/webhooks/${taskId}`
  return (
    <div className="auto-config-fields">
      <label>Webhook URL (send POST requests here)
        <div className="webhook-url-row">
          <code className="webhook-url">{url}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(url)}>Copy</button>
        </div>
      </label>
      <p className="auto-hint">External systems POST JSON to this URL to update the task status.</p>
    </div>
  )
}

export default function AutomationForm({ task, onCreated, onCancel }) {
  const [name,     setName]     = useState(task.title + ' monitor')
  const [type,     setType]     = useState('http_check')
  const [config,   setConfig]   = useState({ url: '', expectedStatus: 200, timeout: 5000 })
  const [schedule, setSchedule] = useState('*/5 * * * *')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  const handleTypeChange = (t) => {
    setType(t)
    const defaults = {
      http_check:    { url: '', expectedStatus: 200, timeout: 5000 },
      process_check: { checkType: 'port', host: 'localhost', port: '' },
      cron:          { command: '', timeout: 30000 },
      webhook:       {},
    }
    setConfig(defaults[t] || {})
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { warn('AutomationForm: name required'); return }
    setSaving(true)
    setError(null)
    try {
      const auto = await createAutomation({ taskId: task.id, name, type, config, schedule })
      log('Created automation', auto.id)
      onCreated(auto)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="automation-form" onSubmit={handleSubmit}>
      <div className="auto-form-header">
        <span>Add automation</span>
        <button type="button" className="btn-cancel-icon" onClick={onCancel}>×</button>
      </div>

      <label>Name
        <input type="text" value={name} onChange={e => setName(e.target.value)} required />
      </label>

      <label>Type
        <select value={type} onChange={e => handleTypeChange(e.target.value)}>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>

      {type === 'http_check'    && <HttpConfig    config={config} onChange={setConfig} />}
      {type === 'process_check' && <ProcessConfig config={config} onChange={setConfig} />}
      {type === 'cron'          && <CronConfig    config={config} onChange={setConfig} />}
      {type === 'webhook'       && <WebhookConfig taskId={task.id} />}

      {type !== 'webhook' && (
        <label>Schedule (cron)
          <input type="text" value={schedule} placeholder="*/5 * * * *"
            onChange={e => setSchedule(e.target.value)} />
          <span className="auto-hint">e.g. */5 * * * * = every 5 min, 0 9 * * 1 = Mon 9am</span>
        </label>
      )}

      {error && <div className="auto-form-error">{error}</div>}

      <div className="auto-form-btns">
        <button type="submit" className="btn-submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save automation'}
        </button>
        <button type="button" className="btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
