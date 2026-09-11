import React,{useState} from 'react'
import ReactDOM from 'react-dom'
import { DragDropContext } from 'react-beautiful-dnd'

import './style.css'
import initialData from './demo-data'

import Lane,{changeLanes} from './lane'


let App=()=>{
  

  const [state,updateState] = useState(initialData)
  let onDragEnd=(result)=>{
      changeLanes(result,state,updateState)
  }
  return (
  <div className='laneGroup'>
    <DragDropContext onDragEnd={onDragEnd}>
        {state.columnOrder.map(col_i => {
          const column = state.columns[col_i]
          const tasks  = ((column.tasks)?column.tasks.map(task_i => state.tasks[task_i]):[])
          const newTaskStart = state.newTaskStart.includes(column.id.substring(4))
          return <Lane key={column.id} column={column} tasks={tasks} newTaskStart={newTaskStart}></Lane>
        })}
    </DragDropContext>
  </div>)
}

ReactDOM.render(
  <React.StrictMode>
    <App />
    
  </React.StrictMode>,
  document.getElementById('root')
);
