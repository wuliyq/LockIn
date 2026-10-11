import { lazy, Suspense, useEffect, useState } from 'react'
import App from '../App'
import { accountApi } from './api'
import { previewApi, previewLecturerApi } from './previewApi'
import LoginPage from './LoginPage'
import LectureHome from './LectureHome'
import './account.css'

const LecturerApp = lazy(() => import('../lecturer/LecturerApp.jsx'))

export default function AccountApp() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const [workspace, setWorkspace] = useState(false)
  useEffect(() => {
    let active = true
    accountApi.me().then(({ user: account }) => {
      if (active && account?.id && ['student', 'lecturer'].includes(account.role)) setUser(account)
    }).catch((error) => { if (active && error.status !== 401) setConnectionError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  if (loading) return <div className="theme-sage account-loading" role="status">Opening LockIN…</div>
  if (!user) return <LoginPage connectionError={connectionError} onLogin={(account) => { setUser(account); setWorkspace(false); setConnectionError('') }} />
  const api = user.preview ? (user.role === 'lecturer' ? previewLecturerApi : previewApi) : accountApi
  const logout = async () => { await api.logout(); setUser(null); setWorkspace(false) }
  const lecturerDashboard = user.role === 'lecturer'
  return <div className="account-shell">
    {user.preview && <div className="account-preview-banner">UI preview · sample data · not signed in<button onClick={logout}>Exit preview</button></div>}
    <div className="account-shell__content">{lecturerDashboard
      ? <Suspense fallback={<div className="theme-sage account-loading" role="status">Opening lecturer dashboard…</div>}><LecturerApp user={user} onLogout={logout} /></Suspense>
      : workspace && user.role === 'student'
      ? <App key={user.id} user={user} lectureApi={api} onHome={() => setWorkspace(false)} />
      : <LectureHome user={user} api={api} onStart={() => setWorkspace(true)} onLogout={logout} />}</div>
  </div>
}
