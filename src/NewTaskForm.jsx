import React, { useState } from 'react'
import { log, warn } from './logger'

export default function NewTaskForm({ onAdd }) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) {
      warn('NewTaskForm: submit blocked — title is empty')
      return
    }
    log('NewTaskForm: submitting', { title: title.trim(), due: due || null })
    onAdd({ title: title.trim(), due: due || null })
    setTitle('')
    setDue('')
    setExpanded(false)
  }

  const handleCancel = () => {
    setTitle('')
    setDue('')
    setExpanded(false)
  }

  if (!expanded) {
    return (
      <button className="add-task-btn" onClick={() => setExpanded(true)}>
        + Add task
      </button>
    )
  }

  return (
    <form className="new-task-form" onSubmit={handleSubmit}>
      <input
        autoFocus
        className="input-title"
        type="text"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && handleCancel()}
      />
      <div className="form-row">
        <input
          className="input-date"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <button type="submit" className="btn-submit">
          Add
        </button>
        <button type="button" className="btn-cancel" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
