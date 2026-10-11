const BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')

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
      ? 'The LockIN backend is not connected yet. Start it to use live recording.'
      : 'Something went wrong. Please try again.'))
    error.status = response.status
    throw error
  }
  return payload
}
