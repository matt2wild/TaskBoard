import React, { useState } from 'react'
import { Draggable } from 'react-beautiful-dnd'
import VDiagram from './VDiagram'

export default function TaskCard({ task, index, onDelete, onDrillIn }) {
  const [showVD, setShowVD] = useState(false)

  return (
    <>
      <Draggable draggableId={task.id} index={index}>
        {(provided, snapshot) => (
          <div
            className={`card${snapshot.isDragging ? ' dragging' : ''}${task.sub_board_id ? ' has-subboard' : ''}`}
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
                <button
                  className="btn-vd"
                  onClick={e => { e.stopPropagation(); setShowVD(true) }}
                  title="V-diagram: requirements & verification"
                >
                  V
                </button>
                <button
                  className={`btn-drill${task.sub_board_id ? ' active' : ''}`}
                  onClick={e => { e.stopPropagation(); onDrillIn() }}
                  title={task.sub_board_id ? 'Open sub-board' : 'Create sub-board'}
                >
                  {task.sub_board_id ? '⊞' : '⊟'}
                </button>
                <button
                  className="btn-delete"
                  onClick={e => { e.stopPropagation(); onDelete() }}
                  title="Delete task"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="card-title">{task.title}</div>
            {task.description && <div className="card-description">{task.description}</div>}
            {task.sub_board_id && (
              <div className="subboard-indicator" onClick={e => { e.stopPropagation(); onDrillIn() }}>
                View board →
              </div>
            )}
          </div>
        )}
      </Draggable>

      {showVD && (
        <VDiagram
          taskId={task.id}
          taskTitle={task.title}
          onClose={() => setShowVD(false)}
        />
      )}
    </>
  )
}
