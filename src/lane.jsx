
import Card from './card'
import { Droppable } from 'react-beautiful-dnd'
import {dropfromArray} from './helper'
export default function Lane(props) {
    let column = props.column
    let tasks = props.tasks
    let newTaskStart = props.newTaskStart
    let idx = 0
    let NewTask
    function hover(e) {
        e.target.style.background = 'greenyellow'
        }
    function exitHover(e) {
        e.target.style.background = ''
    }
    if (newTaskStart){
        NewTask = <Card id={column.id+"_NewTask"} index={idx+1}/>
    }
    const header =  <div className='lane_title'>
                        <h2>{column.title}</h2><span>{column.subtitle}</span>
                    </div>
    const lane_tasks = <div className="lane_tasks">
                    <Droppable droppableId={column.id} index={props.index}>    
                        {provided => (
                            <div
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                            >
                                {tasks.map((task,index)=>{
                                    let card = {
                                        id:task.id,
                                        task:{task},
                                        index:index
                                    }
                                    idx=index
                                    return(<Card key={task.id} {...card}/>)
                                })}
                                
                                <div className='dropZone'
                                onMouseOver={hover}
                                onMouseOut={exitHover}>
                                {provided.placeholder}
                                </div>
                                {NewTask}
                            </div>
                        )}
                    </Droppable>
                </div>
    return (
        <div id={column.id} className="lane">
            {header}
            {lane_tasks}
            
        </div>
    )
}
export let changeLanes=(result,state,updateState)=>{
    let lane_end = result.destination.droppableId.substring(4)  //col_# -> #
    let lane_start = result.source.droppableId.substring(4)     //col_# -> #
    let task_i = result.draggableId.substring(5) //task_# -> #
    let data_columns = state.columns
    let tasks = data_columns[lane_start].tasks
    let newColumnData = {...data_columns}
    if(!task_i.includes('NewTask')){
        newColumnData[lane_start].tasks = dropfromArray(tasks, task_i)
        newColumnData[lane_end].tasks.push(parseInt(task_i))
        state.columns = {...newColumnData}
    }else{
        state.newTaskStart = dropfromArray(state.newTaskStart,lane_start)
        state.newTaskStart.push(lane_end)
    }
    
    updateState({...state})    
  }