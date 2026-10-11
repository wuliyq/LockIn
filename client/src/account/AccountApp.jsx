import { lazy, Suspense, useEffect, useState } from 'react'
import App from '../App'
import { clearLectureStorage } from '../lockin/useLockIn'
import { previewLecturerApi } from './previewApi'
import { serverApi } from './serverApi'
import LoginPage from './LoginPage'
import LectureHome from './LectureHome'
import './account.css'

const LecturerApp = lazy(() => import('../lecturer/LecturerApp.jsx'))

// Who's signed in and which lecture is open, kept for this browser tab so a
// refresh mid-lecture comes back to the same lecture instead of the login page.
const SESSION_KEY = 'lockin.account.v1'

function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? {}
    return { user: saved.user ?? null, lecture: saved.lecture ?? null }
  } catch {
    return { user: null, lecture: null }
  }
}

/**
 * Login → lecture home → student workspace (or the lecturer dashboard).
 * `lecture` is the lecture in progress: { draftId, startedAt }. Its notes and
 * flags live in local storage under draftId until Finish saves them to the
 * lecture history.
 */
export default function AccountApp() {
  const [{ user, lecture }, setSession] = useState(loadSession)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, lecture }))
    } catch {
      // Private mode: everything still works, it just won't survive a refresh.
    }
  }, [user, lecture])

  if (!user) return <LoginPage onEnter={(account) => setSession({ user: account, lecture: null })} />

  // Students' lecture history lives on the server. Lecturers go straight to the
  // live dashboard, which already talks to the server itself.
  const api = user.role === 'lecturer' ? previewLecturerApi : serverApi
  const logout = async () => setSession({ user: null, lecture: null })

  const startLecture = () =>
    setSession((s) => ({ ...s, lecture: { draftId: crypto.randomUUID(), startedAt: Date.now() } }))

  // Called by the workspace's Finish button. Throws on failure so the workspace
  // stays open and shows the error; nothing is cleared until the save succeeds.
  const finishLecture = async (snapshot) => {
    const { title, ...rest } = snapshot
    const seconds = rest.seconds || Math.floor((Date.now() - lecture.startedAt) / 1000)
    const { lecture: saved } = await api.createLecture({ title })
    await api.finishLecture(saved.id, { ...rest, seconds })
    clearLectureStorage(lecture.draftId)
    setSession((s) => ({ ...s, lecture: null }))
  }

  let content
  if (user.role === 'lecturer') {
    content = (
      <Suspense fallback={<div className="theme-sage account-loading" role="status">Opening lecturer dashboard…</div>}>
        <LecturerApp user={user} onLogout={logout} />
      </Suspense>
    )
  } else if (lecture) {
    content = <App key={lecture.draftId} storageScope={lecture.draftId} onFinish={finishLecture} />
  } else {
    content = <LectureHome user={user} api={api} onStart={startLecture} onLogout={logout} />
  }

  return (
    <div className="account-shell">
      <div className="account-preview-banner">
        Demo mode · no sign-in required
        <button type="button" onClick={logout}>
          Change view
        </button>
      </div>
      <div className="account-shell__content">{content}</div>
    </div>
  )
}
