import {useForm} from 'react-hook-form'
import { Droppable } from 'react-beautiful-dnd'
import { taskComponents } from './taskComponents'
export function Task(props){
    function hover(e) {
        e.target.style.background = 'greenyellow'
        }
    function exitHover(e) {
        e.target.style.background = ''
    }
    const task = props.task
    const TaskHeader =  <div className='taskCard_title'>
                            <p>{task.repeat} {task.due}</p>
                            <h4>{task.title}</h4>
                        </div>
//This is broken
    function DropZone(props) {
        <Droppable droppableId={props.task_id+"_dropid"} index={props.index}>    
        {provided => (
            <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            >
                <div className='dropZone'>
                {provided.placeholder}
                </div>
            </div>
        )}

        </Droppable>
    }
    return( <div>
                <div className='taskCard_title'>
                    <p>{task.repeat} {task.due}</p>
                    <h4>{task.title}</h4>
                </div>

            </div>)
}
export function NewTask(){
    const {
        register,
        handleSubmit,
        formState: {errors},
    } = useForm()
    const onSubmit = (data) => {
        console.log(data)
        
    }
    const FormInput = (props) => {
        return(
            <li><span>
                    {props.pretxt}
                    <input type={props.type} {...register(props.id,{required:props.required})}/>{props.postxt}
                </span>
                <div className='inputFormError'>
                    {errors[props.id] && <p>{props.id} Required</p>}
                </div>
            </li>
        )
    }
    return(
        <div className='taskCard'>
            <form onSubmit={handleSubmit(onSubmit)}>
                {taskComponents.map(field => {
                    return <FormInput key={field.id} {...field}/>
                })}
                <input type='submit'/>
            </form>
        </div>
    )
}