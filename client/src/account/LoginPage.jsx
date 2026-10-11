import { useState } from 'react'
import { previewUser } from './previewApi'
import { LockIcon } from '../icons'

export default function LoginPage({ onEnter }) {
  const [role, setRole] = useState('student')
  const [name, setName] = useState('')
  const submit = (event) => { event.preventDefault(); onEnter(previewUser(role, name)) }
  return <main className="theme-sage account-login">
    <section className="account-login__story"><span className="app__logo"><LockIcon /> LockIN</span><div><span className="account-eyebrow">A LITTLE MORE PRESENT</span><h1>Find your focus.<br />Keep your discoveries.</h1><p>A shared home for students and lecturers.<br />Your notes, questions, and little breakthroughs—all in one place.</p><div className="account-login__companions" aria-hidden="true">🦦 <span>🌱</span> 🦊</div></div><small>Learn at your pace. Come back to what matters.</small></section>
    <section className="account-login__form-area"><form onSubmit={submit} className="account-login__form">
      <span className="account-eyebrow">STUDENTS & LECTURERS</span><h2>Welcome to LockIN.</h2><p>Choose a view to explore the demo. No account or sign-in is required.</p>
      <div className="account-role" role="group" aria-label="Choose a view">{['student', 'lecturer'].map((value) => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value === 'student' ? 'I’m a student' : 'I’m a lecturer'}</button>)}</div>
      <label>Your name <small>(optional)</small><input maxLength={80} autoComplete="name" placeholder={role === 'student' ? 'Demo student' : 'Demo lecturer'} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button className="account-primary">Open {role === 'student' ? 'student workspace' : 'lecturer dashboard'}<span aria-hidden="true">→</span></button>
      <p className="account-login__switch">This is a demo entry screen. Your browser keeps the sample lecture data for this session.</p>
    </form></section>
  </main>
}
