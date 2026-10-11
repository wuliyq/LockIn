import { useEffect, useRef, useState } from 'react'
import {
  FlagIcon,
  ChatIcon,
  HelpIcon,
  LightbulbIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  TargetIcon,
  XIcon,
  ZapIcon,
} from './icons'
import { AI_LABELS, FLAG_TYPES, useLockIn } from './lockin/useLockIn'
import SelectionFlagger from './lockin/SelectionFlagger'
import { SlidePanel } from './slides'
import './App.css'

const AI_ICONS = { catchup: ZapIcon, example: LightbulbIcon, check: HelpIcon, why: TargetIcon }

export default function App({ user, lectureApi, onHome }) {
  const li = useLockIn({ user, lectureApi })
  const { sessionActive, startSession } = li
  const [pendingSelection, setPendingSelection] = useState(null)
  const [ending, setEnding] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const startRequested = useRef(false)
  const { bodyRef, slideWidth, resizing, beginResize, resizeByKey } = usePanelResize()

  useEffect(() => {
    if (sessionActive || startRequested.current) return
    startRequested.current = true
    setPendingSelection(null)
    setSessionError('')
    startSession().catch((error) => setSessionError(`Could not start a new lecture: ${error.message}`))
  }, [sessionActive, startSession])

  const finishLecture = async () => {
    setEnding(true)
    setSessionError('')
    try {
      await li.endSession()
      onHome()
    } catch (error) {
      setSessionError(`Could not finish the session: ${error.message}`)
    } finally {
      setEnding(false)
    }
  }

  const addSlideHighlight = (rect) => {
    const highlight = li.createSlideHighlight(rect)
    if (!highlight) return
    setPendingSelection({
      source: 'slide',
      selectedText: `Highlighted area on slide ${li.current + 1}`,
      highlightId: highlight.id,
    })
  }

  if (!sessionActive) return (
    <main className="theme-sage session-launch" aria-live="polite">
      <LockIcon />
      <h1>Starting a new lecture…</h1>
      <p>{sessionError || 'Preparing your notes, slides, and study tools.'}</p>
      {sessionError && <><button type="button" onClick={() => { startRequested.current = true; setSessionError(''); startSession().catch((error) => setSessionError(`Could not start a new lecture: ${error.message}`)) }}>Try again</button><button type="button" onClick={onHome}>Back to my lectures</button></>}
    </main>
  )

  return (
    <div className="theme-sage app app--lecture is-focusing is-quiet">
      <header className="app__header">
        <span className="app__logo">
          <LockIcon /> LockIN
        </span>
        <span className="app__deck">
          {li.reading ? 'Reading slides…' : (li.deck?.filename ?? 'Lecture workspace')}
        </span>
        <div className="app__session">
          <span className="app__focus-state">
            {formatDuration(li.sessionSeconds)}
          </span>
          <button type="button" className="app__end" disabled={ending || li.aiLoading || li.transcriptStatus === 'connecting'} onClick={finishLecture}>{ending ? 'Finishing…' : 'Finish lecture'}</button>
        </div>
      </header>

      {sessionError && <p className="app__session-error" role="alert">{sessionError}</p>}
      {li.syncError && <p className="app__session-error" role="alert">Your notes are kept on this device but have not synced: {li.syncError}</p>}

      <div
        className={`app__body ${resizing ? 'is-resizing' : ''}`}
        ref={bodyRef}
        style={{ '--slides-track': `${slideWidth}fr`, '--notes-track': `${100 - slideWidth}fr` }}
      >
        <section className="app__slides" aria-label="Lecture slides">
          <div className="workspace-sign"><strong>Slides</strong></div>
          <div className="app__slide-box">
            <SlidePanel
              index={li.current}
              onDeckReady={li.onDeckReady}
              onSlideChange={(index) => {
                li.onSlideChange(index)
                setPendingSelection(null)
              }}
              highlights={li.slideHighlights}
              onHighlight={addSlideHighlight}
              onRemoveHighlight={li.removeSlideHighlight}
            />
          </div>
        </section>

        <div
          className="app__resize-handle"
          role="separator"
          aria-label="Resize slides and notes panels"
          aria-orientation="vertical"
          tabIndex={0}
          aria-valuenow={Math.round(slideWidth)}
          aria-valuemin={35}
          aria-valuemax={65}
          onKeyDown={resizeByKey}
          onPointerDown={(event) => beginResize(event, 'slides')}
        />

        <section className="app__notes" aria-label="Notes and flags">
          <div className="workspace-sign"><strong>My notes</strong></div>
          <Notes
            li={li}
            pendingSelection={pendingSelection}
            onSelection={setPendingSelection}
            clearSelection={() => setPendingSelection(null)}
          />
        </section>

      </div>
      <Helper li={li} />
    </div>
  )
}

function Notes({ li, pendingSelection, onSelection, clearSelection }) {
  const [confusion, setConfusion] = useState('')
  const [flagType, setFlagType] = useState('confusing')
  const [showFlags, setShowFlags] = useState(false)
  const slideLabel = li.deck
    ? `Slide ${li.current + 1}${li.title ? ` · ${li.title}` : ''}`
    : 'No slides yet'

  const captureNoteSelection = (event) => {
    const { selectionStart, selectionEnd, value } = event.currentTarget
    const selectedText = value.slice(selectionStart, selectionEnd).trim()
    if (selectedText) onSelection({ source: 'notes', selectedText })
  }

  return (
    <>
      <div className="notes__topline">
        <p className="notes__meta">
          <span>{li.syncStatus || (li.savedAt ? `Saved on device ${li.savedAt}` : 'Notes autosave')}</span>
          <span aria-hidden="true">·</span>
          <span className="notes__slide">{slideLabel}</span>
        </p>
        <button
          type="button"
          className="notes__flags-toggle"
          onClick={() => setShowFlags((shown) => !shown)}
          aria-expanded={showFlags}
        >
          <FlagIcon /> My flags <span>{li.confusions.length}</span>
        </button>
      </div>

      {showFlags && <FlagHistory flags={li.confusions} onGoToSlide={li.onSlideChange} />}

      <textarea
        className="notes__editor"
        aria-label={`Notes for ${slideLabel}`}
        value={li.note}
        data-flag-source="notes"
        onChange={(event) => li.setNote(event.target.value)}
        onSelect={captureNoteSelection}
        placeholder={
          li.deck
            ? 'Write your notes here. Select a passage to ask a question.'
            : 'Upload lecture slides to start taking notes alongside them.'
        }
      />

      {pendingSelection && (
        <div className="notes__selection">
          <span>{pendingSelection.source === 'notes' ? 'Note selected' : 'Slide area selected'}</span>
          <b>{truncate(pendingSelection.selectedText, 54)}</b>
          <button type="button" onClick={clearSelection} aria-label="Clear selected text">×</button>
        </div>
      )}

      <SelectionFlagger
        enabled={Boolean(li.deck)}
        onPick={(nextFlagType, selection) => {
          setFlagType(nextFlagType)
          onSelection(selection)
        }}
      />

      <form
        className="notes__flag-form"
        onSubmit={(event) => {
          event.preventDefault()
          li.submitFlag(confusion, flagType, pendingSelection ?? {}).then((sent) => {
            if (sent) {
              setConfusion('')
              clearSelection()
              setShowFlags(true)
            }
          })
        }}
      >
        <select
          value={flagType}
          onChange={(event) => setFlagType(event.target.value)}
          aria-label="Type of help needed"
        >
          {Object.entries(FLAG_TYPES).map(([value, type]) => (
            <option key={value} value={value}>{type.label}</option>
          ))}
        </select>
        <input
          value={confusion}
          onChange={(event) => setConfusion(event.target.value)}
          placeholder="What would you like to understand?"
          aria-label="Question or note about selected content"
        />
        <button type="submit" className="btn-flag" disabled={li.aiLoading}>
          <FlagIcon /> Pin it
        </button>
      </form>
    </>
  )
}

function FlagHistory({ flags, onGoToSlide }) {
  const [filter, setFilter] = useState('all')
  if (flags.length === 0) return <p className="notes__flags-empty">No flags yet — select a note or highlight a slide to ask a question.</p>

  const counts = Object.fromEntries(Object.keys(FLAG_TYPES).map((type) => [type, 0]))
  flags.forEach((flag) => { counts[flag.flagType] = (counts[flag.flagType] ?? 0) + 1 })
  const shown = filter === 'all' ? flags : flags.filter((flag) => flag.flagType === filter)

  return (
    <div className="notes__flag-history" aria-label="My flags">
      <div className="flag-filters" role="group" aria-label="Filter flags by type">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
          All <span>{flags.length}</span>
        </button>
        {Object.entries(FLAG_TYPES).filter(([type]) => counts[type]).map(([type, meta]) => (
          <button key={type} type="button" className={filter === type ? 'is-active' : ''} onClick={() => setFilter(type)}>
            {meta.label} <span>{counts[type]}</span>
          </button>
        ))}
      </div>
      {[...shown].reverse().map((flag) => (
        <article className="flag-card" key={flag.id}>
          <span className="flag-card__type">📍 {FLAG_TYPES[flag.flagType]?.label ?? 'Report'}</span>
          <button type="button" className="flag-card__source" onClick={() => onGoToSlide(flag.slide)}>
            {flag.source === 'notes' ? 'Note' : 'Slide'} {flag.slide + 1} · {formatTime(flag.createdAt)}
          </button>
          <p>{flag.text}</p>
          {flag.aiAnswer && <small>{flag.aiAnswer}</small>}
        </article>
      ))}
      {shown.length === 0 && <p className="notes__flags-empty">No flags of this type yet.</p>}
    </div>
  )
}

function Helper({ li }) {
  const [panel, setPanel] = useState({ open: false, seen: null })
  const notification = li.aiError || li.ai
  const open = panel.open || Boolean(notification && notification !== panel.seen)
  const setOpen = (shown) => setPanel({ open: shown, seen: notification })

  return (
    <div className={`helper ${open ? 'is-open' : 'is-closed'}`}>
      {open && (
        <div className="helper__panel" role="region" aria-label="LockIN study helper">
          <div className="helper__head">
            <span><span className="helper__citizen">✦</span> Study helper</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close helper"><XIcon /></button>
          </div>
          <div className="helper__body" aria-live="polite">
            <p className="helper__status">
              {li.listening ? '● Recording lecture audio' : 'Ready when you need a hand.'}
            </p>
            {!li.ai && !li.aiLoading && <div className="helper__welcome"><span aria-hidden="true">✦</span><strong>Here for the tricky parts.</strong><p>Highlight a slide or a passage in your notes to ask a question. Use catch-up when you need to find your place.</p></div>}
            {li.transcriptError && <p className="helper__error">{li.transcriptError}</p>}
            {li.aiLoading && <p className="helper__thinking"><span aria-hidden="true">✦</span> Looking through our notes<span className="helper__dots" aria-hidden="true"><i /><i /><i /></span></p>}
            {li.ai && !li.aiLoading && (
              <div className="helper__answer">
                <b>{li.ai.label ?? AI_LABELS[li.ai.kind]} · slide {li.ai.slide + 1}</b>
                {li.ai.text}
              </div>
            )}
            {li.aiError && <p className="helper__error">{li.aiError}</p>}
          </div>
          <div className="helper__actions">
            {li.sessionActive && (
              <button type="button" onClick={li.toggleListen} className={`chip helper__record ${li.listening ? 'is-active' : ''}`}>
                {li.listening ? <MicOffIcon /> : <MicIcon />} {li.listening ? 'Stop recording' : 'Record lecture'}
              </button>
            )}
            {Object.entries(AI_LABELS).map(([kind, label]) => {
              const Icon = AI_ICONS[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={!li.deck}
                  onClick={() => li.ask(kind)}
                  className={`chip ${li.ai?.kind === kind ? 'is-active' : ''}`}
                >
                  <Icon /> {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {!open && <button
        type="button"
        className={`helper__fab ${li.listening ? 'is-listening' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open study helper"
        aria-expanded={open}
      >
        <ChatIcon />
      </button>}
    </div>
  )
}

function usePanelResize() {
  const bodyRef = useRef(null)
  const [slideWidth, setSlideWidth] = useState(40)
  const [resizing, setResizing] = useState(null)

  useEffect(() => {
    if (!resizing) return undefined
    const update = (event) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = ((event.clientX - rect.left) / rect.width) * 100
      setSlideWidth(Math.min(65, Math.max(35, next)))
    }
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [resizing])

  return {
    bodyRef,
    slideWidth,
    resizing,
    resizeByKey: (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 2 : -2
      setSlideWidth(Math.min(65, Math.max(35, slideWidth + step)))
    },
    beginResize: (event, panel) => {
      event.preventDefault()
      setResizing(panel)
    },
  }
}

const formatDuration = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
const formatTime = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const truncate = (value, limit) => (value.length > limit ? `${value.slice(0, limit)}…` : value)
