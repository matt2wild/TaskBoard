// Thin fetch wrapper — CRA proxy forwards /api/* to Express on port 3001

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  const res = await fetch(path, opts)
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ── Boards ────────────────────────────────────────────────────────────────────

export const getBoard = (id) => request('GET', `/api/boards/${id}`)

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const createTask = (boardId, columnId, taskData) =>
  request('POST', '/api/boards/tasks', { boardId, columnId, ...taskData })

export const updateTask = (id, data) =>
  request('PATCH', `/api/boards/tasks/${id}`, data)

export const deleteTask = (id) =>
  request('DELETE', `/api/boards/tasks/${id}`)

export const moveTask = (id, targetColumnId, targetPosition) =>
  request('POST', `/api/boards/tasks/${id}/move`, { targetColumnId, targetPosition })

export const createSubBoard = (taskId) =>
  request('POST', `/api/boards/tasks/${taskId}/sub-board`)

// ── Automations ───────────────────────────────────────────────────────────────

export const listAutomations = () => request('GET', '/api/automations')

export const getAutomation = (id) => request('GET', `/api/automations/${id}`)

export const createAutomation = (data) => request('POST', '/api/automations', data)

export const updateAutomation = (id, data) => request('PATCH', `/api/automations/${id}`, data)

export const deleteAutomation = (id) => request('DELETE', `/api/automations/${id}`)

export const triggerAutomation = (id) => request('POST', `/api/automations/${id}/trigger`)

export const getAutomationLogs = (id, limit = 20) =>
  request('GET', `/api/automations/${id}/logs?limit=${limit}`)
