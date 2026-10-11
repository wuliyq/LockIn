import { lazy, Suspense, useEffect, useState } from 'react'
import App from '../App'
import { clearLectureStorage } from '../lockin/useLockIn'
import { serverApi, serverLecturerApi } from './serverApi'
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
    return { user: saved.user ?? null, lecture: saved.lecture ?? null, dashboard: saved.dashboard ?? null }
  } catch {
    return { user: null, lecture: null, dashboard: null }
  }
}

/**
 * Login → lecture home → student workspace, or for lecturers: their classes → a
 * class's live dashboard (`dashboard` is its code).
 * `lecture` is the lecture in progress: { draftId, lectureId, startedAt }. It's
 * created on the server when it starts, so the student's flags and transcript belong
 * to it (and to the lecturer's class, if they joined one). Notes stay in local storage
 * under draftId until Finish saves them to the lecture history.
 */
export default function AccountApp() {
  const [{ user, lecture, dashboard }, setSession] = useState(loadSession)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, lecture, dashboard }))
    } catch {
      // Private mode: everything still works, it just won't survive a refresh.
    }
  }, [user, lecture, dashboard])

  if (!user) return <LoginPage onEnter={(account) => setSession({ user: account, lecture: null, dashboard: null })} />

  // Students' lecture history lives on the server. Lecturers go straight to the
  // live dashboard, which already talks to the server itself.
  const api = user.role === 'lecturer' ? serverLecturerApi : serverApi
  const logout = async () => setSession({ user: null, lecture: null, dashboard: null })

  // Throws (e.g. an unknown class code) so the home page can show why.
  const startLecture = async (classCode = '') => {
    const { lecture: created } = await api.createLecture({
      title: 'Untitled lecture',
      classCode: classCode.trim(),
      studentName: user.name,
    })
    setSession((s) => ({ ...s, lecture: { draftId: created.id, lectureId: created.id, startedAt: Date.now() } }))
  }

  // Called by the workspace's Finish button. Throws on failure so the workspace
  // stays open and shows the error; nothing is cleared until the save succeeds.
  const finishLecture = async (snapshot) => {
    const seconds = snapshot.seconds || Math.floor((Date.now() - lecture.startedAt) / 1000)
    // A lecture opened before lectures were created at start has no server id yet.
    const id = lecture.lectureId ?? (await api.createLecture({ title: snapshot.title })).lecture.id
    await api.finishLecture(id, { ...snapshot, seconds })
    clearLectureStorage(lecture.draftId)
    setSession((s) => ({ ...s, lecture: null }))
  }

  let content
  if (user.role === 'lecturer' && dashboard) {
    content = (
      <Suspense fallback={<div className="theme-sage account-loading" role="status">Opening lecturer dashboard…</div>}>
        <LecturerApp
          key={dashboard}
          user={user}
          onLogout={logout}
          code={dashboard}
          onBack={() => setSession((s) => ({ ...s, dashboard: null }))}
        />
      </Suspense>
    )
  } else if (user.role === 'lecturer') {
    content = (
      <LectureHome
        user={user}
        api={api}
        onOpenClass={(code) => setSession((s) => ({ ...s, dashboard: code }))}
        onLogout={logout}
      />
    )
  } else if (lecture) {
    content = (
      <App key={lecture.draftId} storageScope={lecture.draftId} lectureId={lecture.lectureId} onFinish={finishLecture} />
    )
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
