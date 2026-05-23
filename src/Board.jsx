import React from 'react'
import { DragDropContext } from 'react-beautiful-dnd'
import Lane from './lane'
import { log, warn } from './logger'

export default function Board({ boardId, board, tasks, onMoveTask, onAddTask, onDeleteTask, onDrillIn }) {
  const onDragEnd = (result) => {
    if (!result.destination) {
      warn('onDragEnd: no destination, drag cancelled', { draggableId: result.draggableId })
      return
    }
    log('onDragEnd', { draggableId: result.draggableId, source: result.source, destination: result.destination })
    onMoveTask(boardId, result.source, result.destination)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="laneGroup">
        {board.columnOrder.map((colId) => {
          const column = board.columns[colId]
          const columnTasks = (column.tasks || [])
            .map((taskId) => tasks[taskId])
            .filter(Boolean)
          const hasNewTaskForm = (board.newTaskColumns || []).includes(colId)
          return (
            <Lane
              key={colId}
              column={column}
              tasks={columnTasks}
              hasNewTaskForm={hasNewTaskForm}
              onAddTask={(taskData) => onAddTask(boardId, colId, taskData)}
              onDeleteTask={(taskId) => onDeleteTask(boardId, colId, taskId)}
              onDrillIn={onDrillIn}
            />
          )
        })}
      </div>
    </DragDropContext>
  )
}
