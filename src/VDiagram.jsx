import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  getVDiagram,
  addRequirement, updateRequirement, deleteRequirement,
  addVerification, updateVerification, deleteVerification,
  linkReqVer, unlinkReqVer,
} from './api'
import { log, warn } from './logger'

// ── Status helpers ─────────────────────────────────────────────────────────

const VER_STATUS = {
  pending:     { icon: '○', label: 'Pending',     cls: 'vs-pending'     },
  in_progress: { icon: '◑', label: 'In progress', cls: 'vs-in-progress' },
  passed:      { icon: '●', label: 'Passed',       cls: 'vs-passed'      },
  failed:      { icon: '●', label: 'Failed',        cls: 'vs-failed'      },
}

const PRI_CLS = { high: 'pri-high', medium: 'pri-medium', low: 'pri-low' }

const VER_TYPES = ['manual', 'automated', 'inspection', 'demonstration']

// Status cycle: pending → in_progress → passed → failed → pending
const NEXT_STATUS = {
  pending: 'in_progress', in_progress: 'passed', passed: 'failed', failed: 'pending',
}

// ── Line renderer ──────────────────────────────────────────────────────────

function Lines({ links, reqRefs, verRefs, containerRef, selectedReqId }) {
  const [paths, setPaths] = useState([])

  const compute = useCallback(() => {
    if (!containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    const next = []
    for (const lk of links) {
      const rEl = reqRefs.current[lk.requirement_id]
      const vEl = verRefs.current[lk.verification_id]
      if (!rEl || !vEl) continue
      const r = rEl.getBoundingClientRect()
      const v = vEl.getBoundingClientRect()
      const x1 = r.right  - box.left
      const y1 = r.top    + r.height / 2 - box.top
      const x2 = v.left   - box.left
      const y2 = v.top    + v.height / 2 - box.top
      // Cubic bezier — control points curve toward the center
      const cx = (x1 + x2) / 2
      next.push({
        d: `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`,
        highlighted: lk.requirement_id === selectedReqId,
        key: `${lk.requirement_id}-${lk.verification_id}`,
      })
    }
    setPaths(next)
  }, [links, reqRefs, verRefs, containerRef, selectedReqId])

  useEffect(() => {
    // Delay slightly so DOM has settled after render
    const id = setTimeout(compute, 60)
    return () => clearTimeout(id)
  }, [compute])

  // Also recompute on window resize
  useEffect(() => {
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [compute])

  return (
    <svg className="vd-svg" aria-hidden="true">
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--link-color)" />
        </marker>
      </defs>
      {paths.map(p => (
        <path
          key={p.key}
          d={p.d}
          className={`vd-link${p.highlighted ? ' vd-link-hi' : ''}`}
          markerEnd="url(#arrow)"
        />
      ))}
    </svg>
  )
}

// ── Inline edit row ────────────────────────────────────────────────────────

function InlineAdd({ placeholder, onAdd, onCancel, extraFields }) {
  const [text, setText] = useState('')
  const [extra, setExtra] = useState(extraFields ? Object.fromEntries(extraFields.map(f => [f.key, f.default])) : {})

  const submit = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    onAdd({ text: text.trim(), ...extra })
    setText('')
  }

  return (
    <form className="vd-inline-add" onSubmit={submit}>
      <input autoFocus className="vd-text-input" placeholder={placeholder}
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && onCancel()} />
      {extraFields && extraFields.map(f => (
        <select key={f.key} className="vd-select" value={extra[f.key]}
          onChange={e => setExtra(prev => ({ ...prev, [f.key]: e.target.value }))}>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      <button type="submit" className="vd-btn-add">Add</button>
      <button type="button" className="vd-btn-cancel" onClick={onCancel}>×</button>
    </form>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function VDiagram({ taskId, taskTitle, onClose }) {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [selectedReq, setSelectedReq] = useState(null)  // id of req in "link mode"
  const [addingReq,  setAddingReq]  = useState(false)
  const [addingVer,  setAddingVer]  = useState(false)

  const containerRef = useRef(null)
  const reqRefs      = useRef({})
  const verRefs      = useRef({})

  // ── Load ──────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await getVDiagram(taskId)
      setData(d)
      log('VDiagram loaded', taskId, d.summary)
    } catch (e) {
      warn('VDiagram load failed', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { reload() }, [reload])

  // ── Close on Escape ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (selectedReq) { setSelectedReq(null); return }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, selectedReq])

  // ── Mutations ─────────────────────────────────────────────────────────
  const doAddReq = async ({ text, priority }) => {
    await addRequirement(taskId, { text, priority })
    setAddingReq(false)
    reload()
  }

  const doAddVer = async ({ text, type }) => {
    await addVerification(taskId, { text, type })
    setAddingVer(false)
    reload()
  }

  const doDeleteReq = async (id) => {
    await deleteRequirement(id)
    if (selectedReq === id) setSelectedReq(null)
    reload()
  }

  const doDeleteVer = async (id) => {
    await deleteVerification(id)
    reload()
  }

  const doCycleStatus = async (ver) => {
    await updateVerification(ver.id, { status: NEXT_STATUS[ver.status] })
    reload()
  }

  const doToggleLink = async (reqId, verId) => {
    const linked = data.links.some(
      l => l.requirement_id === reqId && l.verification_id === verId
    )
    if (linked) {
      await unlinkReqVer(reqId, verId)
    } else {
      await linkReqVer(reqId, verId)
    }
    reload()
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="vd-backdrop" onClick={onClose}>
      <div className="vd-modal" onClick={e => e.stopPropagation()}>
        <div className="vd-loading">Loading V-diagram…</div>
      </div>
    </div>
  )

  if (error) return (
    <div className="vd-backdrop" onClick={onClose}>
      <div className="vd-modal" onClick={e => e.stopPropagation()}>
        <div className="vd-error">Error: {error}</div>
        <button className="vd-close" onClick={onClose}>×</button>
      </div>
    </div>
  )

  const { requirements, verifications, links, summary } = data
  const linkedVerIds = selectedReq
    ? new Set(links.filter(l => l.requirement_id === selectedReq).map(l => l.verification_id))
    : null

  // Requirements coverage: which reqs have at least one linked ver
  const coveredReqIds = new Set(links.map(l => l.requirement_id))

  return (
    <div className="vd-backdrop" onClick={onClose}>
      <div className="vd-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="vd-header">
          <div className="vd-header-left">
            <span className="vd-title-label">V-Diagram</span>
            <span className="vd-task-name">{taskTitle}</span>
          </div>
          <div className="vd-summary">
            <span className="vd-stat">{summary.requirementCount} req</span>
            <span className="vd-stat">{summary.verificationCount} ver</span>
            <span className={`vd-stat ${summary.passed === summary.verificationCount && summary.verificationCount > 0 ? 'stat-all-pass' : ''}`}>
              {summary.passed}/{summary.verificationCount} passed
            </span>
            {summary.failed > 0 && <span className="vd-stat stat-fail">{summary.failed} failed</span>}
          </div>
          <button className="vd-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        {/* ── Link-mode banner ── */}
        {selectedReq && (
          <div className="vd-link-banner">
            <span>Link mode — click verifications to toggle links for the selected requirement</span>
            <button onClick={() => setSelectedReq(null)}>Done</button>
          </div>
        )}

        {/* ── Column headers ── */}
        <div className="vd-col-headers">
          <div className="vd-col-head">Requirements</div>
          <div className="vd-col-head-center">
            <span className="vd-v-label">V</span>
          </div>
          <div className="vd-col-head">Verifications</div>
        </div>

        {/* ── Diagram body ── */}
        <div className="vd-body" ref={containerRef}>

          {/* Left: Requirements */}
          <div className="vd-col vd-col-req">
            {requirements.length === 0 && (
              <div className="vd-empty">No requirements yet</div>
            )}
            {requirements.map(r => (
              <div
                key={r.id}
                ref={el => { reqRefs.current[r.id] = el }}
                className={`vd-item vd-req${selectedReq === r.id ? ' vd-item-selected' : ''}${!coveredReqIds.has(r.id) ? ' vd-req-uncovered' : ''}`}
                onClick={() => setSelectedReq(prev => prev === r.id ? null : r.id)}
                title={selectedReq === r.id ? 'Click to deselect' : 'Click to enter link mode'}
              >
                <div className="vd-item-top">
                  <span className={`vd-priority-dot ${PRI_CLS[r.priority]}`} title={r.priority} />
                  <span className="vd-item-text">{r.text}</span>
                </div>
                {r.source && <div className="vd-item-meta">Source: {r.source}</div>}
                <button className="vd-item-delete" onClick={e => { e.stopPropagation(); doDeleteReq(r.id) }}>×</button>
              </div>
            ))}

            {addingReq
              ? <InlineAdd
                  placeholder="Requirement text…"
                  onAdd={doAddReq}
                  onCancel={() => setAddingReq(false)}
                  extraFields={[{ key: 'priority', default: 'medium', options: ['high', 'medium', 'low'] }]}
                />
              : <button className="vd-add-btn" onClick={() => setAddingReq(true)}>+ Add requirement</button>
            }
          </div>

          {/* Center: SVG lines overlay */}
          <div className="vd-center-col">
            <Lines
              links={links}
              reqRefs={reqRefs}
              verRefs={verRefs}
              containerRef={containerRef}
              selectedReqId={selectedReq}
            />
          </div>

          {/* Right: Verifications */}
          <div className="vd-col vd-col-ver">
            {verifications.length === 0 && (
              <div className="vd-empty">No verifications yet</div>
            )}
            {verifications.map(v => {
              const si = VER_STATUS[v.status] || VER_STATUS.pending
              const isLinked = linkedVerIds ? linkedVerIds.has(v.id) : false
              return (
                <div
                  key={v.id}
                  ref={el => { verRefs.current[v.id] = el }}
                  className={`vd-item vd-ver vd-ver-${v.status}${isLinked ? ' vd-ver-linked' : ''}${selectedReq ? ' vd-ver-linkable' : ''}`}
                  onClick={() => selectedReq && doToggleLink(selectedReq, v.id)}
                >
                  <div className="vd-item-top">
                    <button
                      className={`vd-status-btn ${si.cls}`}
                      onClick={e => { e.stopPropagation(); doCycleStatus(v) }}
                      title={`Status: ${si.label} — click to advance`}
                    >
                      {si.icon}
                    </button>
                    <span className="vd-item-text">{v.text}</span>
                  </div>
                  <div className="vd-item-meta">
                    <span className="vd-ver-type">{v.type}</span>
                    {v.verified_at && (
                      <span className="vd-verified-at">{new Date(v.verified_at).toLocaleDateString()}</span>
                    )}
                  </div>
                  {v.result_notes && <div className="vd-result-notes">{v.result_notes}</div>}
                  <button className="vd-item-delete" onClick={e => { e.stopPropagation(); doDeleteVer(v.id) }}>×</button>
                  {selectedReq && (
                    <span className="vd-link-toggle" title={isLinked ? 'Unlink' : 'Link'}>
                      {isLinked ? '⊟' : '⊕'}
                    </span>
                  )}
                </div>
              )
            })}

            {addingVer
              ? <InlineAdd
                  placeholder="Verification step…"
                  onAdd={doAddVer}
                  onCancel={() => setAddingVer(false)}
                  extraFields={[{ key: 'type', default: 'manual', options: VER_TYPES }]}
                />
              : <button className="vd-add-btn" onClick={() => setAddingVer(true)}>+ Add verification</button>
            }
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="vd-legend">
          <span className="vd-leg-item"><span className="vd-priority-dot pri-high" /> High priority</span>
          <span className="vd-leg-item"><span className="vd-priority-dot pri-medium" /> Medium</span>
          <span className="vd-leg-item"><span className="vd-priority-dot pri-low" /> Low</span>
          <span className="vd-leg-sep" />
          {Object.entries(VER_STATUS).map(([k, v]) => (
            <span key={k} className="vd-leg-item">
              <span className={`vd-status-icon ${v.cls}`}>{v.icon}</span> {v.label}
            </span>
          ))}
          <span className="vd-leg-sep" />
          <span className="vd-leg-item vd-leg-hint">Click a requirement to enter link mode</span>
        </div>
      </div>
    </div>
  )
}
