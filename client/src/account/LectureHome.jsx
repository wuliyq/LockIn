import { useEffect, useState } from 'react'
import { FileIcon, LockIcon } from '../icons'

const date = (value) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
const time = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const flagLabel = (value) => ({ confusing: 'Confusing', example: 'Real-world example', worked_example: 'Worked example', check_thinking: 'Check my thinking' })[value] || value

export default function LectureHome({ user, api, onStart, onLogout }) {
  const [lectures, setLectures] = useState([])
  const [classes, setClasses] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(null)
  const [revision, setRevision] = useState(0)
  const [classTitle, setClassTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const lecturer = user.role === 'lecturer'

  useEffect(() => {
    let active = true
    Promise.all([api.listLectures(), lecturer ? api.listClasses() : Promise.resolve({ classes: [] })])
      .then(([history, groups]) => { if (active) { setLectures(history.lectures); setClasses(groups.classes); setError('') } })
      .catch((failure) => { if (active) setError(failure.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, lecturer, revision])

  const openLecture = async (id) => {
    setOpening(id); setError('')
    try { const { lecture } = await api.getLecture(id); setSelected(lecture) }
    catch (failure) { setError(failure.message) }
    finally { setOpening(null) }
  }
  const createClass = async (event) => {
    event.preventDefault(); setCreating(true); setError('')
    try { const { classroom } = await api.createClass(classTitle.trim()); setClasses((items) => [classroom, ...items]); setClassTitle('') }
    catch (failure) { setError(failure.message) }
    finally { setCreating(false) }
  }
  const visible = lectures.filter((lecture) => [lecture.title, lecture.filename, lecture.class_title, lecturer ? lecture.student_name : ''].join(' ').toLowerCase().includes(search.toLowerCase()))
  return <div className="theme-sage account-home">
    <header className="account-nav"><span className="app__logo"><LockIcon /> LockIN</span><span className="account-nav__role">{lecturer ? 'Lecturer space' : 'My lectures'}</span><span className="account-nav__user">{user.name}</span><button onClick={() => onLogout().catch((failure) => setError(failure.message))}>Sign out</button></header>
    <main className="account-home__main">
      {error && <div className="account-error" role="alert">{error} <button onClick={() => { setLoading(true); setRevision((value) => value + 1) }}>Retry</button></div>}
      {selected ? <LectureDetail lecture={selected} lecturer={lecturer} onBack={() => setSelected(null)} /> : <>
        <div className="account-home__intro"><div><span className="account-eyebrow">{lecturer ? 'YOUR CLASSES, AT A GLANCE' : 'PICK UP WHERE YOU LEFT OFF'}</span><h1>{lecturer ? 'A clearer view of your classroom.' : `Welcome back, ${user.name.split(' ')[0]}.`}</h1><p>{lecturer ? 'Create a class, share its code, and review the questions students flag.' : 'Your lectures and discoveries, ready when you are.'}</p></div>{!lecturer && <button className="account-primary" onClick={onStart}>＋ New lecture</button>}</div>
        <div className="account-stats"><div><strong>{lectures.length}</strong><span>{lecturer ? 'Student sessions' : 'Saved lectures'}</span></div><div><strong>{lectures.reduce((sum, item) => sum + (item.flagCount || 0), 0)}</strong><span>Questions flagged</span></div><div><strong>{lecturer ? classes.length : lectures.reduce((sum, item) => sum + (item.notePages || 0), 0)}</strong><span>{lecturer ? 'Your classes' : 'Pages of notes'}</span></div></div>
        {lecturer && <section className="account-classes" aria-label="Your classes"><h2>Your classes</h2><form onSubmit={createClass}><input aria-label="New class name" placeholder="e.g. COMP 664 · Machine Learning" required maxLength={120} value={classTitle} onChange={(event) => setClassTitle(event.target.value)} /><button className="account-secondary" disabled={creating}>{creating ? 'Creating…' : 'Create class'}</button></form><div className="account-classes__list">{classes.map((item) => <article key={item.id}><strong>{item.title}</strong><span>Class code <code>{item.code}</code></span></article>)}</div><p>Share a class code with students before they start. Only sessions joined to your classes appear here.</p></section>}
        <section aria-label={lecturer ? 'Student lecture sessions' : 'Previous lectures'}><div className="account-history__title"><h2>{lecturer ? 'Student sessions' : 'Previous lectures'}</h2><input type="search" aria-label="Search lectures" placeholder="Search lectures…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {loading ? <p role="status">Loading your lectures…</p> : visible.length === 0 ? <div className="account-empty"><span aria-hidden="true"><FileIcon /></span><h3>{search ? 'No matching lectures.' : 'Your next discovery starts here.'}</h3><p>{search ? 'Try another title or class name.' : lecturer ? 'Share your class code to start collecting student questions.' : 'Start your first lecture. Your notes and flags will be saved here.'}</p></div> : <div className="account-lecture-grid">{visible.map((lecture) => <article key={lecture.id} className="account-lecture-card"><div className="account-lecture-card__top"><span aria-hidden="true"><FileIcon /></span><span>{lecture.ended_at ? 'Completed' : 'In progress'}</span></div><small>{lecture.class_title || 'Independent lecture'}</small><h3>{lecture.title}</h3><p>{date(lecture.started_at)} · {Math.floor((lecture.seconds || 0) / 60)} min{lecturer && ` · ${lecture.student_name || 'Student'}`}</p><div className="account-lecture-card__bottom"><span>{!lecturer && `${lecture.notePages || 0} note pages · `}{lecture.flagCount || 0} flags</span><button disabled={Boolean(opening)} onClick={() => openLecture(lecture.id)}>{opening === lecture.id ? 'Opening…' : lecturer ? 'View flags →' : 'Review →'}</button></div></article>)}</div>}
        </section>
      </>}
    </main>
  </div>
}

function LectureDetail({ lecture, lecturer, onBack }) {
  const [tab, setTab] = useState(lecturer ? 'flags' : 'notes')
  const snapshot = lecture.snapshot || {}
  const flags = lecture.flags || snapshot.flags || []
  const catchUps = lecture.catchUps || snapshot.catchUps || []
  const tabs = lecturer ? ['flags', 'catch-ups'] : ['notes', 'slides', 'flags', 'catch-ups']
  return <section className="lecture-review" aria-label="Lecture review">
    <button className="account-back" onClick={onBack}>← All lectures</button><span className="account-eyebrow">{date(lecture.started_at)} · {lecture.ended_at ? 'COMPLETED LECTURE' : 'SAVED SESSION'}</span><h1>{lecture.title}</h1>
    <p>{snapshot.filename || 'Lecture notes'}{!lecturer && ' · Saved to your lecture history'}</p>
    <div className="account-tabs" role="tablist" aria-label="Lecture material">{tabs.map((value) => <button key={value} role="tab" id={`review-tab-${value}`} aria-controls="review-panel" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'catch-ups' ? 'Catch-ups' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${tab}`}>
      {tab === 'notes' && <>{Object.entries(snapshot.notes || {}).filter(([,text]) => text.trim()).map(([slide,text]) => <article className="lecture-review__paper" key={slide}><h3>Slide {Number(slide) + 1}</h3><p>{text}</p></article>)}{!Object.values(snapshot.notes || {}).some((text) => text.trim()) && <p className="account-empty">No notes saved for this lecture.</p>}</>}
      {tab === 'slides' && <><p className="account-muted">Saved slide text is shown here. The original PDF file is not stored in this version.</p>{(snapshot.slides || []).map((slide,index) => <article className="lecture-review__paper" key={index}><h3>Slide {index + 1}</h3><p>{slide.text || 'No text was extracted from this slide.'}</p></article>)}{!snapshot.slides?.length && <p className="account-empty">No slide text saved.</p>}</>}
      {tab === 'flags' && <>{flags.length > 0 && <div className="account-flag-counts">{[...new Set(flags.map((flag) => flag.flagType))].map((type) => <span key={type}>{flagLabel(type)} <b>{flags.filter((flag) => flag.flagType === type).length}</b></span>)}</div>}{flags.map((flag) => <article className="lecture-review__paper" key={flag.id}><h3>{flagLabel(flag.flagType)} · Slide {flag.slideNumber ?? (flag.slide ?? 0) + 1}<small>{(flag.timestamp || flag.createdAt) && time(flag.timestamp || flag.createdAt)}</small></h3>{flag.selectedText && <blockquote>{flag.selectedText}</blockquote>}<p>{flag.studentComment || flag.text}</p>{flag.aiAnswer && <div className="lecture-review__answer"><b>AI explanation</b><p>{flag.aiAnswer}</p></div>}</article>)}{flags.length === 0 && <p className="account-empty">No flags for this lecture.</p>}</>}
      {tab === 'catch-ups' && <>{catchUps.map((item,index) => <article className="lecture-review__paper" key={item.id || index}><h3>Catch-up · Slide {item.slideNumber ?? (item.slide ?? 0) + 1}<small>{item.timestamp && time(item.timestamp)}</small></h3>{!lecturer && <p>{Array.isArray(item.summary) ? item.summary.join('\n') : item.summary}</p>}</article>)}{catchUps.length === 0 && <p className="account-empty">No catch-up requests in this lecture.</p>}</>}
    </div>
  </section>
}
