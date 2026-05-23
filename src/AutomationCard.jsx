import React, { useState } from 'react'
import { Draggable } from 'react-beautiful-dnd'
import { triggerAutomation, getAutomationLogs } from './api'
import { log } from './logger'

const STATUS_ICON = {
  pending:  { icon: '◌', cls: 'status-pending'  },
  running:  { icon: '⟳', cls: 'status-running'  },
  success:  { icon: '●', cls: 'status-success'  },
  failure:  { icon: '●', cls: 'status-failure'  },
  error:    { icon: '●', cls: 'status-error'     },
}

const TYPE_LABEL = {
  http_check:    'HTTP Check',
  process_check: 'Process Check',
  cron:          'Cron Job',
  webhook:       'Webhook',
}

function AutomationDetail({ automation, liveStatus, onClose }) {
  const [logs, setLogs]     = useState(null)
  const [running, setRunning] = useState(false)

  const status = liveStatus?.status || automation.status || 'pending'
  const lastResult = liveStatus?.result
    ? liveStatus.result
    : automation.last_result
      ? (typeof automation.last_result === 'string'
          ? JSON.parse(automation.last_result)
          : automation.last_result)
      : null

  const loadLogs = async () => {
    const data = await getAutomationLogs(automation.id)
    setLogs(data)
  }

  const handleTrigger = async () => {
    setRunning(true)
    try {
      await triggerAutomation(automation.id)
      log('Manual trigger sent', automation.id)
    } catch (e) {
      log('Trigger failed', e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="auto-detail">
      <div className="auto-detail-header">
        <span className="auto-detail-title">{automation.name}</span>
        <button className="auto-detail-close" onClick={onClose}>×</button>
      </div>
      <div className="auto-detail-meta">
        <span className="tag type-tag">{TYPE_LABEL[automation.type] || automation.type}</span>
        <span className={`auto-status-dot ${(STATUS_ICON[status] || STATUS_ICON.pending).cls}`}>
          {(STATUS_ICON[status] || STATUS_ICON.pending).icon}
        </span>
        <span className="auto-status-text">{status}</span>
      </div>
      <div className="auto-detail-schedule">⏱ {automation.schedule}</div>
      {automation.last_run && (
        <div className="auto-detail-lastrun">
          Last run: {new Date(automation.last_run).toLocaleTimeString()}
        </div>
      )}
      {lastResult && (
        <pre className="auto-result">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      )}
      <div className="auto-detail-actions">
        <button className="btn-trigger" onClick={handleTrigger} disabled={running}>
          {running ? 'Running…' : '▶ Run now'}
        </button>
        <button className="btn-view-logs" onClick={loadLogs}>
          View logs
        </button>
      </div>
      {logs && (
        <div className="auto-logs">
          {logs.length === 0 && <div className="auto-log-empty">No runs yet</div>}
          {logs.map(l => (
            <div key={l.id} className={`auto-log-row log-${l.status}`}>
              <span className="log-time">{l.run_at.slice(11, 19)}</span>
              <span className={`log-status ${l.status}`}>{l.status}</span>
              {l.duration_ms && <span className="log-dur">{l.duration_ms}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AutomationCard({ task, index, liveStatuses, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  // A task in the automation column may have multiple automations
  const automations = task.automations || []
  const primaryAuto = automations[0] || null
  const liveStatus  = primaryAuto ? liveStatuses[primaryAuto.id] : null

  const status  = liveStatus?.status || primaryAuto?.status || (automations.length ? 'pending' : null)
  const si      = STATUS_ICON[status] || STATUS_ICON.pending

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          className={`card automation-card${snapshot.isDragging ? ' dragging' : ''}${status ? ` border-${status}` : ''}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
        >
          <div className="card-header">
            <div className="card-meta">
              {task.repeat_pattern && <span className="tag repeat-tag">{task.repeat_pattern}</span>}
              {task.due_date && <span className="tag due-tag">{task.due_date}</span>}
            </div>
            <div className="card-actions">
              {primaryAuto && (
                <button
                  className="btn-auto-expand"
                  onClick={(e) => { e.stopPropagation(); setExpanded(x => !x) }}
                  title="Automation details"
                >
                  ⚙
                </button>
              )}
              <button
                className="btn-delete"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                title="Delete task"
              >
                ×
              </button>
            </div>
          </div>

          <div className="auto-task-row">
            {status && (
              <span className={`auto-status-dot ${si.cls}`} title={status}>{si.icon}</span>
            )}
            <div className="card-title">{task.title}</div>
          </div>

          {automations.length > 0 && (
            <div className="auto-badges">
              {automations.map(a => (
                <span key={a.id} className="tag type-tag">
                  {TYPE_LABEL[a.type] || a.type}
                </span>
              ))}
            </div>
          )}

          {automations.length === 0 && (
            <div className="auto-none-hint">No automation configured</div>
          )}

          {expanded && primaryAuto && (
            <AutomationDetail
              automation={primaryAuto}
              liveStatus={liveStatus}
              onClose={() => setExpanded(false)}
            />
          )}
        </div>
      )}
    </Draggable>
  )
}
