const initialData = {
  boards: {
    root: {
      id: 'root',
      columns: {
        col_automations: {
          id: 'col_automations',
          title: 'Automations',
          tasks: ['task_1', 'task_7'],
        },
        col_todo: {
          id: 'col_todo',
          title: 'To Do',
          tasks: ['task_2', 'task_8', 'task_9'],
        },
        col_late: {
          id: 'col_late',
          title: 'Late',
          tasks: ['task_3'],
        },
        col_onHold: {
          id: 'col_onHold',
          title: 'Not My Problem',
          subtitle: '(right now)',
          tasks: ['task_6'],
        },
        col_inProgress: {
          id: 'col_inProgress',
          title: 'In Progress',
          tasks: [],
        },
        col_completed: {
          id: 'col_completed',
          title: 'Completed',
          tasks: ['task_4'],
        },
      },
      columnOrder: [
        'col_automations',
        'col_todo',
        'col_late',
        'col_onHold',
        'col_inProgress',
        'col_completed',
      ],
      newTaskColumns: ['col_todo'],
    },
  },
  tasks: {
    task_1: { id: 'task_1', title: 'Trash', due: '22:00', repeat: 'Tuesday' },
    task_2: {
      id: 'task_2',
      title: 'Design portfolio website',
      description: 'Overall layout and structure',
      due: '2022-02-01',
    },
    task_3: {
      id: 'task_3',
      title: 'Finish Bookshelf',
      due: '2022-02-14',
      boardId: 'task_3',
    },
    task_4: {
      id: 'task_4',
      title: 'Buy Stain',
      description: 'Dark coffee color',
      due: '2022-02-02',
    },
    task_5: {
      id: 'task_5',
      title: 'Apply Stain',
      description: 'Assemble first — check for cold-warped boards',
      due: '2022-02-02',
    },
    task_6: {
      id: 'task_6',
      title: 'Figure out Wipro W2',
      description: 'Low confidence they will send one. Escalate on due date.',
      due: '2022-03-01',
    },
    task_7: { id: 'task_7', title: 'Laundry', due: '12:00', repeat: 'Saturday' },
    task_8: { id: 'task_8', title: 'Make this persistent', due: '2022-02-10' },
    task_9: { id: 'task_9', title: 'Add sub-boards to tasks', due: '2022-02-10' },
  },
  // Pre-built sub-board for task_3 to demo the recursive feature
  // (task_3 already has boardId: 'task_3' set above)
  boardPath: ['root'],
  nextId: 10,
}

// Lazily add the demo sub-board for task_3
initialData.boards['task_3'] = {
  id: 'task_3',
  columns: {
    col_todo: { id: 'col_todo', title: 'To Do', tasks: ['task_4', 'task_5'] },
    col_inProgress: { id: 'col_inProgress', title: 'In Progress', tasks: [] },
    col_completed: { id: 'col_completed', title: 'Done', tasks: [] },
  },
  columnOrder: ['col_todo', 'col_inProgress', 'col_completed'],
  newTaskColumns: ['col_todo'],
}

export default initialData
