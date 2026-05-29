import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import './style.css'
import Board from './Board'
import { log, warn, error as logError } from './logger'
import * as api from './api'

// BoardPath persists navigation across refreshes but NOT board data
const PATH_KEY = 'taskboard_boardpath'

function loadPath() {
  try { return JSON.parse(localStorage.getItem(PATH_KEY)) || ['root'] } catch { return ['root'] }
}
function savePath(p) {
  try { localStorage.setItem(PATH_KEY, JSON.stringify(p)) } catch {}
}

function App() {
  const [boardPath,    setBoardPath]    = useState(loadPath)
  const [board,        setBoard]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState(null)
  const [liveStatuses, setLiveStatuses] = useState({})  // automationId → { status, result, lastRun }
  const esRef = useRef(null)

  // ── Load current board ────────────────────────────────────────────────────
  const currentBoardId = boardPath[boardPath.length - 1]

  const fetchBoard = useCallback(async (boardId) => {
    setLoading(true)
    setFetchError(null)
    try {
      const data = await api.getBoard(boardId)
      log('Loaded board', boardId, `(${data.columns.length} columns)`)
      setBoard(data)
    } catch (e) {
      logError('Failed to load board', boardId, e.message)
      setFetchError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBoard(currentBoardId)
  }, [currentBoardId, fetchBoard])

  // ── SSE — live automation status ──────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/automations/stream')
    esRef.current = es

    es.addEventListener('snapshot', (e) => {
      const autos = JSON.parse(e.data)
      const map = {}
      autos.forEach(a => { map[a.id] = a })
      setLiveStatuses(map)
      log('SSE snapshot received', Object.keys(map).length, 'automations')
    })

    es.addEventListener('automation-update', (e) => {
      const update = JSON.parse(e.data)
      log('SSE automation-update', update.automationId, update.status)
      setLiveStatuses(prev => ({
        ...prev,
        [update.automationId]: { ...(prev[update.automationId] || {}), ...update },
      }))
    })

    es.onerror = () => warn('SSE connection lost — will retry automatically')

    return () => { es.close(); esRef.current = null }
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleMoveTask = useCallback(async (taskId, targetColumnId, targetPosition) => {
    log('moveTask', { taskId, targetColumnId, targetPosition })
    // Optimistic update: refresh board after move
    await api.moveTask(taskId, targetColumnId, targetPosition)
    fetchBoard(currentBoardId)
  }, [currentBoardId, fetchBoard])

  const handleAddTask = useCallback(async (boardId, columnId, taskData) => {
    log('addTask', { boardId, columnId, title: taskData.title })
    await api.createTask(boardId, columnId, {
      title: taskData.title,
      dueDate: taskData.due || null,
    })
    fetchBoard(boardId)
  }, [fetchBoard])

  const handleDeleteTask = useCallback(async (taskId) => {
    log('deleteTask', taskId)
    await api.deleteTask(taskId)
    fetchBoard(currentBoardId)
  }, [currentBoardId, fetchBoard])

  const handleDrillIn = useCallback(async (taskId) => {
    log('drillIn', taskId)
    const { boardId } = await api.createSubBoard(taskId)
    const newPath = [...boardPath, boardId]
    setBoardPath(newPath)
    savePath(newPath)
    // Refresh parent so sub-board indicator updates
    fetchBoard(boardId)
  }, [boardPath, fetchBoard])

  const navigateTo = useCallback((index) => {
    const newPath = boardPath.slice(0, index + 1)
    log('navigateTo', { index, newPath })
    setBoardPath(newPath)
    savePath(newPath)
  }, [boardPath])

  // ── Breadcrumb labels ─────────────────────────────────────────────────────
  // When on a sub-board, the board.title is the task's title (set at creation time)
  const breadcrumb = boardPath.map((bId, i) => ({
    boardId: bId,
    title:   bId === 'root' ? 'Home' : (i === boardPath.length - 1 && board ? board.title : bId),
    index:   i,
    isCurrent: i === boardPath.length - 1,
  }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">TaskBoard</span>
        {boardPath.length > 1 && (
          <nav className="breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.boardId} className="breadcrumb-item">
                {i > 0 && <span className="breadcrumb-sep">›</span>}
                {crumb.isCurrent
                  ? <span className="breadcrumb-current">{crumb.title}</span>
                  : <button className="breadcrumb-link" onClick={() => navigateTo(crumb.index)}>
                      {crumb.title}
                    </button>
                }
              </span>
            ))}
          </nav>
        )}
      </header>

      <main className="app-main">
        {loading && <div className="loading-overlay">Loading…</div>}
        {fetchError && (
          <div className="error-banner">
            Failed to load board: {fetchError}
            <button onClick={() => fetchBoard(currentBoardId)}>Retry</button>
          </div>
        )}
        {!loading && !fetchError && board && (
          <Board
            key={currentBoardId}
            board={board}
            liveStatuses={liveStatuses}
            onMoveTask={handleMoveTask}
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            onDrillIn={handleDrillIn}
          />
        )}
      </main>
    </div>
  )
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
)
