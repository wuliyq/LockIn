import { lazy, Suspense, useState } from 'react'
import App from '../App'
import { previewApi, previewLecturerApi } from './previewApi'
import LoginPage from './LoginPage'
import LectureHome from './LectureHome'
import './account.css'

const LecturerApp = lazy(() => import('../lecturer/LecturerApp.jsx'))

export default function AccountApp() {
  const [user, setUser] = useState(null)
  const [workspace, setWorkspace] = useState(false)
  if (!user) return <LoginPage onEnter={(account) => { setUser(account); setWorkspace(false) }} />
  const api = user.role === 'lecturer' ? previewLecturerApi : previewApi
  const logout = async () => { setUser(null); setWorkspace(false) }
  const lecturerDashboard = user.role === 'lecturer'
  return <div className="account-shell">
    <div className="account-preview-banner">Demo mode · no sign-in required<button onClick={logout}>Change view</button></div>
    <div className="account-shell__content">{lecturerDashboard
      ? <Suspense fallback={<div className="theme-sage account-loading" role="status">Opening lecturer dashboard…</div>}><LecturerApp user={user} onLogout={logout} /></Suspense>
      : workspace && user.role === 'student'
      ? <App key={user.id} user={user} lectureApi={api} onHome={() => setWorkspace(false)} />
      : <LectureHome user={user} api={api} onStart={() => setWorkspace(true)} onLogout={logout} />}</div>
  </div>
}
