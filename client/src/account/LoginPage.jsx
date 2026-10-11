import { useState } from 'react'
import { accountApi } from './api'
import { previewUser } from './previewApi'
import { LockIcon } from '../icons'

export default function LoginPage({ onLogin, connectionError }) {
  const [register, setRegister] = useState(false)
  const [role, setRole] = useState('student')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { user } = await accountApi[register ? 'register' : 'login']({ email, password, ...(register ? { name, role } : {}) })
      if (!user?.id || !['student', 'lecturer'].includes(user.role)) throw new Error('The server did not return a valid account.')
      setPassword(''); onLogin(user)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <main className="theme-sage account-login">
    <section className="account-login__story"><span className="app__logo"><LockIcon /> LockIN</span><div><span className="account-eyebrow">A LITTLE MORE PRESENT</span><h1>Find your focus.<br />Keep your discoveries.</h1><p>A shared home for students and lecturers.<br />Your notes, questions, and little breakthroughs—all in one place.</p><div className="account-login__companions" aria-hidden="true">🦦 <span>🌱</span> 🦊</div></div><small>Learn at your pace. Come back to what matters.</small></section>
    <section className="account-login__form-area"><form onSubmit={submit} className="account-login__form">
      <span className="account-eyebrow">STUDENTS & LECTURERS</span><h2>{register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>{register ? 'Create your LockIN account to get started.' : 'Sign in to pick up where you left off.'}</p>
      {register && <><div className="account-role" role="group" aria-label="Account role">{['student','lecturer'].map((value) => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value === 'student' ? 'I’m a student' : 'I’m a lecturer'}</button>)}</div><label>Your name<input required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label></>}
      <label>Email<input type="email" required autoComplete="username" maxLength={254} placeholder="you@university.edu" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required minLength={register ? 10 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />{register && <small>Use at least 10 characters.</small>}</label>
      {(error || connectionError) && <p className="account-error" role="alert">{error || connectionError}</p>}
      <button className="account-primary" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}<span aria-hidden="true">→</span></button>
      <p className="account-login__switch">{register ? 'Already have an account?' : 'New to LockIN?'} <button type="button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setPassword('') }}>{register ? 'Sign in' : 'Create an account'}</button></p>
      <details className="account-preview"><summary>Preview the interface without an account</summary><p>Sample data only. This does not create an account or sign you in.</p><div><button type="button" onClick={() => onLogin(previewUser('student'))}>Student preview</button><button type="button" onClick={() => onLogin(previewUser('lecturer'))}>Lecturer preview</button></div></details>
    </form></section>
  </main>
}
