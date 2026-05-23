import React, { useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import './style.css'
import initialData from './data'
import Board from './Board'

const STORAGE_KEY = 'taskboard_v2'

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : initialData
  } catch {
    return initialData
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage unavailable — continue in-memory
  }
}

function makeEmptyBoard(id) {
  return {
    id,
    columns: {
      col_todo: { id: 'col_todo', title: 'To Do', tasks: [] },
      col_inProgress: { id: 'col_inProgress', title: 'In Progress', tasks: [] },
      col_completed: { id: 'col_completed', title: 'Done', tasks: [] },
    },
    columnOrder: ['col_todo', 'col_inProgress', 'col_completed'],
    newTaskColumns: ['col_todo'],
  }
}

function App() {
  const [state, setState] = useState(loadState)

  const update = useCallback((updater) => {
    setState((prev) => {
      const next = updater(prev)
      saveState(next)
      return next
    })
  }, [])

  const moveTask = useCallback(
    (boardId, source, destination) => {
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) return

      update((prev) => {
        const board = prev.boards[boardId]
        const srcId = source.droppableId
        const dstId = destination.droppableId
        const srcTasks = [...board.columns[srcId].tasks]
        const dstTasks = srcId === dstId ? srcTasks : [...(board.columns[dstId].tasks || [])]

        const [moved] = srcTasks.splice(source.index, 1)
        dstTasks.splice(destination.index, 0, moved)

        return {
          ...prev,
          boards: {
            ...prev.boards,
            [boardId]: {
              ...board,
              columns: {
                ...board.columns,
                [srcId]: { ...board.columns[srcId], tasks: srcTasks },
                [dstId]: { ...board.columns[dstId], tasks: dstTasks },
              },
            },
          },
        }
      })
    },
    [update]
  )

  const addTask = useCallback(
    (boardId, columnId, taskData) => {
      update((prev) => {
        const taskId = `task_${prev.nextId}`
        return {
          ...prev,
          nextId: prev.nextId + 1,
          tasks: {
            ...prev.tasks,
            [taskId]: { id: taskId, ...taskData },
          },
          boards: {
            ...prev.boards,
            [boardId]: {
              ...prev.boards[boardId],
              columns: {
                ...prev.boards[boardId].columns,
                [columnId]: {
                  ...prev.boards[boardId].columns[columnId],
                  tasks: [
                    ...(prev.boards[boardId].columns[columnId].tasks || []),
                    taskId,
                  ],
                },
              },
            },
          },
        }
      })
    },
    [update]
  )

  const deleteTask = useCallback(
    (boardId, columnId, taskId) => {
      update((prev) => ({
        ...prev,
        boards: {
          ...prev.boards,
          [boardId]: {
            ...prev.boards[boardId],
            columns: {
              ...prev.boards[boardId].columns,
              [columnId]: {
                ...prev.boards[boardId].columns[columnId],
                tasks: prev.boards[boardId].columns[columnId].tasks.filter(
                  (t) => t !== taskId
                ),
              },
            },
          },
        },
      }))
    },
    [update]
  )

  const drillIn = useCallback(
    (taskId) => {
      update((prev) => {
        const boardExists = !!prev.boards[taskId]
        return {
          ...prev,
          tasks: boardExists
            ? prev.tasks
            : {
                ...prev.tasks,
                [taskId]: { ...prev.tasks[taskId], boardId: taskId },
              },
          boards: boardExists
            ? prev.boards
            : { ...prev.boards, [taskId]: makeEmptyBoard(taskId) },
          boardPath: [...prev.boardPath, taskId],
        }
      })
    },
    [update]
  )

  const navigateTo = useCallback(
    (index) => {
      update((prev) => ({
        ...prev,
        boardPath: prev.boardPath.slice(0, index + 1),
      }))
    },
    [update]
  )

  const currentBoardId = state.boardPath[state.boardPath.length - 1]
  const currentBoard = state.boards[currentBoardId]

  const breadcrumb = state.boardPath.map((boardId, i) => ({
    boardId,
    title: boardId === 'root' ? 'Home' : state.tasks[boardId]?.title || boardId,
    index: i,
    isCurrent: i === state.boardPath.length - 1,
  }))

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">TaskBoard</span>
        {state.boardPath.length > 1 && (
          <nav className="breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.boardId} className="breadcrumb-item">
                {i > 0 && <span className="breadcrumb-sep">›</span>}
                {crumb.isCurrent ? (
                  <span className="breadcrumb-current">{crumb.title}</span>
                ) : (
                  <button
                    className="breadcrumb-link"
                    onClick={() => navigateTo(crumb.index)}
                  >
                    {crumb.title}
                  </button>
                )}
              </span>
            ))}
          </nav>
        )}
      </header>
      <Board
        key={currentBoardId}
        boardId={currentBoardId}
        board={currentBoard}
        tasks={state.tasks}
        onMoveTask={moveTask}
        onAddTask={addTask}
        onDeleteTask={deleteTask}
        onDrillIn={drillIn}
      />
    </div>
  )
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
)
