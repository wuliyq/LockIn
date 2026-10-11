import { useState } from 'react'
import { CITY_CITIZENS } from '../lockin/useLockIn'
import { UnlockIcon } from '../icons'
import CityWorld from './CityWorld'
import './SessionLobby.css'

export default function SessionLobby({ li, onStart, onHome, preview }) {
  const [recordAudio, setRecordAudio] = useState(false)
  const [title, setTitle] = useState('')
  const [classCode, setClassCode] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const start = async () => {
    setStarting(true); setError('')
    try { await onStart(recordAudio, { title: title.trim(), classCode: classCode.trim() }) }
    catch (failure) { setError(failure.message) }
    finally { setStarting(false) }
  }
  return (
    <div className="theme-sage session-lobby">
      <header className="session-lobby__header"><span className="app__logo"><UnlockIcon /> LockIN</span><button className="account-back" onClick={onHome}>← My lectures</button></header>
      <main className="session-lobby__main">
        <div className="session-lobby__intro">
          <p className="session-lobby__eyebrow">{li.lastSession ? 'AFTER CLASS' : 'BEFORE CLASS'}</p>
          <h1>{li.lastSession ? 'A little more learned.' : li.profileName.trim() ? `Welcome back, ${li.profileName.trim()}.` : 'Settle in. Make it yours.'}</h1>
          <p>{li.lastSession ? 'Your notes are saved. Take a breath, visit your city, or get ready for the next lecture.' : 'Choose a companion and your way to study. When class begins, we’ll clear the space for your lecture.'}</p>
        </div>
        {li.lastSession && <section className="session-lobby__recap" aria-label="Lecture recap">
          <div><strong>{Math.floor(li.lastSession.seconds / 60)} min</strong><span>Session duration</span></div>
          <div><strong>{li.lastSession.notePages}</strong><span>Pages with saved notes in this deck</span></div>
          <div><strong>{li.lastSession.flags}</strong><span>Questions flagged this session</span></div>
          {li.gameEnabled && <div><strong>+{li.lastSession.earned}</strong><span>City coins earned</span></div>}
        </section>}
        <div className="session-lobby__setup">
          <section className="session-lobby__profile" aria-label="Your profile">
            <h2>Your study companion</h2>
            <label className="session-lobby__name">What should we call you? <span>Optional</span><input maxLength={32} value={li.profileName} onChange={(event) => li.setProfileName(event.target.value)} placeholder="Your first name" autoComplete="given-name" /></label>
            <div className="session-lobby__avatars" role="group" aria-label="Choose your avatar">
              {CITY_CITIZENS.map((citizen) => <button key={citizen.id} type="button" aria-pressed={li.citizen.id === citizen.id} onClick={() => li.setCitizenId(citizen.id)}><span aria-hidden="true">{citizen.emoji}</span><strong>{citizen.name.split(' the ')[0]}</strong></button>)}
            </div>
            <p className="session-lobby__local">Your name, companion, and city are saved in this browser.</p>
          </section>
          <section className="session-lobby__launch" aria-label="Lecture preferences">
            <h2>A little focus. Your way.</h2>
            <div className="session-lobby__lecture-fields"><label>Lecture title<input maxLength={120} placeholder="e.g. COMP 664 · Gradient descent" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Class code <small>Optional</small><input maxLength={32} placeholder="From your lecturer" value={classCode} onChange={(event) => setClassCode(event.target.value)} /></label></div>
            <label className="session-lobby__mode"><input type="checkbox" checked={li.gameEnabled} onChange={(event) => li.setGameEnabled(event.target.checked)} /><span><strong>City game mode <small>OPTIONAL</small></strong><p>Earn coins as you study and build a little neighbourhood before or after class.</p></span></label>
            <div className="session-lobby__focus-note"><span aria-hidden="true">◌</span><p>{li.gameEnabled ? 'Your city stays hidden throughout the lecture. Progress is collected quietly and waiting when you finish.' : 'Just your slides, notes, and study helper. No quests, coins, or game animations.'}</p></div>
            <label className="session-lobby__record"><input type="checkbox" checked={recordAudio} disabled={preview} onChange={(event) => setRecordAudio(event.target.checked)} />{preview ? 'Live recording is unavailable in UI preview' : 'Start microphone recording with the lecture'}</label>
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="session-lobby__start" type="button" disabled={starting} onClick={start}>{starting ? 'Preparing your lecture…' : 'Start lecture'} <span aria-hidden="true">→</span></button>
            <p className="session-lobby__hint">Upload your slides in the lecture workspace.</p>
          </section>
        </div>
        {li.gameEnabled && <section className="session-lobby__playground" aria-label="Optional city playground"><div className="session-lobby__playground-title"><h2>A moment in your city</h2><span>Before & after class only</span></div><CityWorld li={li} /></section>}
      </main>
    </div>
  )
}
