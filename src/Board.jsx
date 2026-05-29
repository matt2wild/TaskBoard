import React from 'react'
import { DragDropContext } from 'react-beautiful-dnd'
import Lane from './lane'
import { log, warn } from './logger'

export default function Board({ board, liveStatuses, onMoveTask, onAddTask, onDeleteTask, onDrillIn }) {
  const onDragEnd = (result) => {
    if (!result.destination) {
      warn('onDragEnd: drag cancelled, no destination', result.draggableId)
      return
    }
    log('onDragEnd', {
      task: result.draggableId,
      from: `${result.source.droppableId}[${result.source.index}]`,
      to:   `${result.destination.droppableId}[${result.destination.index}]`,
    })
    onMoveTask(result.draggableId, result.destination.droppableId, result.destination.index)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="laneGroup">
        {board.columns.map(column => (
          <Lane
            key={column.id}
            column={column}
            tasks={column.tasks}
            liveStatuses={liveStatuses}
            onAddTask={(data) => onAddTask(board.id, column.id, data)}
            onDeleteTask={onDeleteTask}
            onDrillIn={onDrillIn}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
