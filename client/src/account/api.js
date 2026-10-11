const BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')

let session = null

/**
 * One request that gives this browser its anonymous id cookie, made before any other
 * API call. Without it, the page's first requests go out together, each without a
 * cookie, and each gets a different id: a lecture started then would belong to an id
 * the browser no longer has. Retried on the next call if the server was unreachable.
 */
export function ensureSession() {
  session ??= fetch(`${BASE}/api/session`, { method: 'POST', credentials: 'include' })
    .then((response) => { if (!response.ok) session = null })
    .catch(() => { session = null })
  return session
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  await ensureSession()
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
