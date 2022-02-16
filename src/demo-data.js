const initialData = {
    tasks:{
        '1':{
            id:'task_1',
            title:'Trash',
            due:'22:00',
            repeat:'|Tuesday|',
            persistant:false
        },
        '2':{
            id:'task_2',
            title:'Design overall view of portfolio website',
            description:'',
            due:'2/1/2022'
        },
        '3':{
            id:'task_3',
            title:'Finish Bookshelf',
            due:'2/14/2022',
            prereqs:[4],
            children:[5]
        },
        '4':{
            id:'task_4',
            projectid:1,
            title:'Buy Stain',
            description:'Dark coffee color',
            due:'2/2/2022'
        },
        '5':{
            id:'task_5',
            title:'Apply Stain',
            description:'Assemble first to make sure cold hasn`t reshaped any boards',
            due:'2/2/2022'
        },
        '6':{
            id:'task_6',
            title:'Figure out Wipro W2',
            description:'Low confidence Wipro will actually send a W2... On due date upgrade priority',
            due:'3/1/2022'
        },
        '7':{
            id:'task_7',
            title:'Laundry',
            due:'12:00',
            repeat:'Saturday'
        },
        '8':{
            id:'task_8',
            title:'Make this persistent',
            due:'2/10/2022'
        },
        '9':{
            id:'task_9',
            title:'Add projects to this',
            due:'2/10/2022'
        }
    },
    columns:{
        'automations':{
            id:'col_automations',
            title:'Automations',
            visible:false,
            tasks:[1,7]
        },
        'todo':{
            id:'col_todo',
            title:'To Do',
            tasks:[2,8,9]
        },
        'late':{
            id:'col_late',
            title:'Late',
            tasks:[3]
        },
        'onHold':{
            id:'col_onHold',
            title:'Not My Problem',
            subtitle:'(right now)',
            tasks:[6]
        },
        'inProgress':{
            id:'col_inProgress',
            title:'In Progress',
        },
        'completed':{
            id:'col_completed',
            title:'Completed',
            tasks:[4]
        }
    },
    columnOrder:['automations','todo','late','onHold','inProgress','completed'],
    newTaskStart:['automations','todo']
}
export default initialData;