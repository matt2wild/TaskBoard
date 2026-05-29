import React from 'react'
import { Droppable } from 'react-beautiful-dnd'
import TaskCard from './TaskCard'
import AutomationCard from './AutomationCard'
import NewTaskForm from './NewTaskForm'

export default function Lane({
  column, tasks, liveStatuses,
  onAddTask, onDeleteTask, onDrillIn,
}) {
  return (
    <div id={column.id} className="lane">
      <div className="lane_title">
        <h2>{column.title}</h2>
        {column.subtitle && <span className="lane_subtitle">{column.subtitle}</span>}
        <span className="task-count">{tasks.length}</span>
      </div>
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            className={`lane_tasks${snapshot.isDraggingOver ? ' dragging-over' : ''}`}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {tasks.map((task, index) =>
              column.isAutomation
                ? <AutomationCard
                    key={task.id}
                    task={task}
                    index={index}
                    liveStatuses={liveStatuses}
                    onDelete={() => onDeleteTask(task.id)}
                  />
                : <TaskCard
                    key={task.id}
                    task={task}
                    index={index}
                    onDelete={() => onDeleteTask(task.id)}
                    onDrillIn={() => onDrillIn(task.id)}
                  />
            )}
            {provided.placeholder}
            {column.allowNewTasks && <NewTaskForm onAdd={onAddTask} />}
          </div>
        )}
      </Droppable>
    </div>
  )
}
