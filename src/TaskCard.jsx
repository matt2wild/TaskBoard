import React from 'react'
import { Draggable } from 'react-beautiful-dnd'

export default function TaskCard({ task, index, onDelete, onDrillIn }) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          className={`card${snapshot.isDragging ? ' dragging' : ''}${task.boardId ? ' has-subboard' : ''}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
        >
          <div className="card-header">
            <div className="card-meta">
              {task.repeat && <span className="tag repeat-tag">{task.repeat}</span>}
              {task.due && <span className="tag due-tag">{task.due}</span>}
            </div>
            <div className="card-actions">
              <button
                className={`btn-drill${task.boardId ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onDrillIn() }}
                title={task.boardId ? 'Open sub-board' : 'Create sub-board'}
              >
                {task.boardId ? '⊞' : '⊟'}
              </button>
              <button
                className="btn-delete"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                title="Delete task"
              >
                ×
              </button>
            </div>
          </div>
          <div className="card-title">{task.title}</div>
          {task.description && (
            <div className="card-description">{task.description}</div>
          )}
          {task.boardId && (
            <div className="subboard-indicator" onClick={(e) => { e.stopPropagation(); onDrillIn() }}>
              View board →
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}
