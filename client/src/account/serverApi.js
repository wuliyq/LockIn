import { request } from './api.js'

/**
 * The real account adapter: the same methods as previewApi, backed by the server's
 * /api/lectures and /api/classes routes (docs/account-api-contract.md). Who the user
 * is comes from the server's cookie, so nothing here sends a user id.
 */
const lecturePath = (id) => `/api/lectures/${encodeURIComponent(id)}`

export const serverApi = {
  listLectures: () => request('/api/lectures'),
  getLecture: (id) => request(lecturePath(id)),
  createLecture: ({ title, classCode, studentName } = {}) =>
    request('/api/lectures', { method: 'POST', body: { title, classCode, studentName } }),
  saveLecture: (id, snapshot) => request(lecturePath(id), { method: 'PATCH', body: { snapshot } }),
  finishLecture: (id, snapshot) => request(`${lecturePath(id)}/finish`, { method: 'POST', body: { snapshot } }),
  listClasses: () => request('/api/classes'),
  createClass: (title) => request('/api/classes', { method: 'POST', body: { title } }),
  // There's no sign-in yet, so no server session to end.
  logout: async () => ({ ok: true }),
  request,
}

/** Lecturers see their classes' student lectures: flags and catch-up times, never notes. */
export const serverLecturerApi = {
  ...serverApi,
  listLectures: () => request('/api/teaching/lectures'),
  getLecture: (id) => request(`/api/teaching/lectures/${encodeURIComponent(id)}`),
}
