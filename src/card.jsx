import React from 'react'
import { Draggable } from 'react-beautiful-dnd'

import {Task, NewTask} from './task'


export default function Card(props){
    let cardObject = null
    if(props.task){
        cardObject = <Task {...props.task}></Task>
    }else{
        console.log("New Task")
        cardObject = <NewTask/>
    }
    return(
    <Draggable key={props.id} draggableId={props.id} index={props.index}>
        {(provided,snapshot)=>(
        <div className='Card'
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        >
        {cardObject}
        </div>
        )}
    </Draggable>
    )
    
}
