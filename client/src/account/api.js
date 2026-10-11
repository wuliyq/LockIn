const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export async function request(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method, signal, credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Cannot reach the server. Check that the backend is running.', { cause: error })
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    const error = new Error(payload?.error || (response.status === 404 || !payload
      ? 'This account service is not connected yet. Your team needs to connect the login and lecture APIs.'
      : 'Something went wrong. Please try again.'))
    error.status = response.status
    throw error
  }
  return payload
}

export const accountApi = {
  me: () => request('/api/auth/me'),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  register: (body) => request('/api/auth/register', { method: 'POST', body }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  listLectures: () => request('/api/lectures'),
  getLecture: (id) => request(`/api/lectures/${encodeURIComponent(id)}`),
  createLecture: (body) => request('/api/lectures', { method: 'POST', body }),
  saveLecture: (id, snapshot) => request(`/api/lectures/${encodeURIComponent(id)}`, { method: 'PATCH', body: { snapshot } }),
  finishLecture: (id, snapshot) => request(`/api/lectures/${encodeURIComponent(id)}/finish`, { method: 'POST', body: { snapshot } }),
  listClasses: () => request('/api/classes'),
  createClass: (title) => request('/api/classes', { method: 'POST', body: { title } }),
  request,
}
