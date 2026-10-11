import { request as backendRequest } from './api.js'

// Explicit UI preview only. Never used as a fallback for a failed real login.
// No passwords or real-account data are stored here.
const KEY = 'lockin.ui-preview.v1'
const sampleFlags = [{ id: 'sample-flag', slide: 0, flagType: 'confusing', selectedText: 'The gradient points uphill.', text: 'Why do we move the opposite way?', aiAnswer: 'The gradient points toward increasing loss. Moving opposite helps reduce it.', createdAt: '2026-10-10T14:12:00Z' }]
function initial() {
  return {
    classes: [{ id: 'sample-class', title: 'Introduction to machine learning', code: 'PREVIEW' }],
    lectures: [
      { id: 'sample-ml', title: 'Gradient descent, one step at a time', class_title: 'Introduction to machine learning', student_name: 'Demo student', started_at: '2026-10-10T14:00:00Z', ended_at: '2026-10-10T14:45:00Z', snapshot: { seconds: 2700, filename: 'gradient-descent.pdf', notes: { 0: 'The gradient tells us which direction increases the loss fastest. We take a small step in the opposite direction to reduce the loss.', 1: 'The learning rate controls the step size. Too large can overshoot; too small takes longer.' }, slides: [{ index: 0, text: 'Gradient descent\nUpdate the parameters by moving in the negative gradient direction.' }, { index: 1, text: 'Choosing a learning rate\nBalance speed with stable progress.' }], flags: sampleFlags, catchUps: [{ timestamp: '2026-10-10T14:20:00Z', slide: 1, summary: ['The learning rate controls how far each update moves.'] }] } },
      { id: 'sample-bio', title: 'Inside a cell', class_title: 'Biology 101', student_name: 'Demo student', started_at: '2026-10-09T10:00:00Z', ended_at: '2026-10-09T10:35:00Z', snapshot: { seconds: 2100, filename: 'cells.pdf', notes: { 0: 'Mitochondria help convert energy from food into ATP that the cell can use.' }, slides: [{ index: 0, text: 'Cell structures and their functions' }], flags: [], catchUps: [] } },
    ],
  }
}
let memory
function read() {
  if (memory) return memory
  try { memory = JSON.parse(sessionStorage.getItem(KEY)) || initial() }
  catch { memory = initial() }
  return memory
}
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(memory)) } catch { /* Preview still works in memory. */ } }
function find(id) {
  const lecture = read().lectures.find((item) => item.id === id)
  if (!lecture) throw new Error('Preview lecture not found.')
  return lecture
}
export function previewUser(role, name = '') {
  const fallback = role === 'student' ? 'Demo student' : 'Demo lecturer'
  return { id: `preview-${role}`, name: name.trim() || fallback, email: '', role, preview: true }
}

export const previewApi = {
  listLectures: async () => ({ lectures: read().lectures.map(({ snapshot, ...lecture }) => ({ ...lecture, filename: snapshot.filename, seconds: snapshot.seconds, notePages: Object.values(snapshot.notes || {}).filter((note) => note.trim()).length, flagCount: snapshot.flags?.length || 0 })) }),
  getLecture: async (id) => { const lecture = find(id); return { lecture: { ...lecture, flags: lecture.snapshot.flags || [], catchUps: lecture.snapshot.catchUps || [], transcript: [] } } },
  createLecture: async ({ title, classCode }) => {
    if (classCode && !read().classes.some((item) => item.code === classCode.toUpperCase())) throw new Error('For this preview, use class code PREVIEW or leave it blank.')
    const classroom = read().classes.find((item) => item.code === classCode?.toUpperCase())
    const lecture = { id: crypto.randomUUID(), title: title || 'Untitled lecture', started_at: new Date().toISOString(), ended_at: null, student_name: 'Demo student', classroom_id: classroom?.id, class_title: classroom?.title, snapshot: {} }
    read().lectures.unshift(lecture); save(); return { lecture }
  },
  saveLecture: async (id, snapshot) => { find(id).snapshot = snapshot; save(); return { saved: true } },
  finishLecture: async (id, snapshot) => { const lecture = find(id); lecture.snapshot = snapshot; lecture.ended_at = new Date().toISOString(); save(); return { saved: true } },
  listClasses: async () => ({ classes: read().classes }),
  createClass: async (title) => { const classroom = { id: crypto.randomUUID(), title, code: `DEMO${read().classes.length + 1}` }; read().classes.push(classroom); save(); return { classroom } },
  logout: async () => ({ ok: true }),
  request: async (path, options) => {
    if (path === '/api/confusion') return { answer: 'Preview answer: this is where a short explanation grounded in your lecture will appear once the AI service is connected.' }
    if (path === '/api/flags') return { flag: { id: crypto.randomUUID() } }
    if (path === '/api/catch-up') return { summary: ['Preview summary: key points from the last two minutes will appear here.'] }
    // Recording does not require an account. These routes only need the running
    // backend so it can issue an ElevenLabs token and save transcript windows.
    if (path === '/api/stt-token' || path === '/api/transcript') return backendRequest(path, options)
    throw new Error('This preview action is not available yet.')
  },
}

const belongsToDemoClass = (lecture) => lecture.id === 'sample-ml' || read().classes.some((item) => item.id === lecture.classroom_id)
export const previewLecturerApi = {
  ...previewApi,
  listLectures: async () => ({ lectures: (await previewApi.listLectures()).lectures.filter(belongsToDemoClass) }),
  getLecture: async (id) => {
    const { lecture } = await previewApi.getLecture(id)
    if (!belongsToDemoClass(lecture)) throw new Error('This session is not part of your preview classes.')
    const shared = { ...lecture }
    delete shared.snapshot
    delete shared.transcript
    return { lecture: shared }
  },
}
