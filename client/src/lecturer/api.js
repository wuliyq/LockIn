/** Same server as the student app: VITE_API_URL when deployed, else the local Express server. */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(`Can't reach the LockIN server at ${API_BASE_URL}. Is it running?`)
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`)
  return payload
}
