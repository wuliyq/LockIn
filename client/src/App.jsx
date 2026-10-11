import { useEffect, useRef, useState } from 'react'
import {
  ChatIcon,
  FlagIcon,
  HelpIcon,
  LightbulbIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  TargetIcon,
  UnlockIcon,
  XIcon,
  ZapIcon,
} from './icons'
import { AI_LABELS, FLAG_TYPES, useLockIn } from './lockin/useLockIn'
import SelectionFlagger from './lockin/SelectionFlagger'
import { SlidePanel } from './slides'
import './App.css'

const AI_ICONS = { catchup: ZapIcon, example: LightbulbIcon, check: HelpIcon, why: TargetIcon }

export default function App() {
  const li = useLockIn()
  const [pendingSelection, setPendingSelection] = useState(null)
  const { bodyRef, slideWidth, resizing, beginResize } = usePanelResize()

  const startFocusSession = async () => {
    li.startSession()
    if (!li.listening && li.transcriptStatus !== 'connecting') await li.toggleListen()
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

  return (
    <div className={`theme-sage app ${li.sessionActive ? 'is-focusing' : ''}`}>
      <header className="app__header">
        <span className="app__logo">
          {li.sessionActive ? <LockIcon /> : <UnlockIcon />} LockIN
        </span>
        <span className="app__deck">
          {li.reading ? 'Reading slides…' : (li.deck?.filename ?? 'No slides loaded')}
        </span>
        <div className="app__session">
          <span className="app__focus-state">
            {li.sessionActive ? `Focus mode · ${formatDuration(li.sessionSeconds)}` : 'Ready to focus'}
          </span>
          {!li.sessionActive && (
            <button type="button" className="app__start" onClick={startFocusSession}>
              Start session
            </button>
          )}
        </div>
      </header>

      <div
        className={`app__body ${resizing ? 'is-resizing' : ''}`}
        ref={bodyRef}
        style={{ '--slides-width': `${slideWidth}%` }}
      >
        <section className="app__slides" aria-label="Lecture slides">
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
            />
          </div>
        </section>

        <div
          className="app__resize-handle"
          role="separator"
          aria-label="Resize slides and notes panels"
          aria-orientation="vertical"
          onPointerDown={beginResize}
        />

        <section className="app__notes" aria-label="Notes and flags">
          <Notes
            li={li}
            pendingSelection={pendingSelection}
            onSelection={setPendingSelection}
            clearSelection={() => setPendingSelection(null)}
          />
        </section>
      </div>

      <Helper li={li} onStartSession={startFocusSession} />
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
          <span>{li.savedAt ? `Saved ${li.savedAt}` : 'Notes autosave'}</span>
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
            ? 'Write freely. Select text to turn it into a flag.'
            : 'Upload your slides to keep notes linked to each slide, or just start writing.'
        }
      />

      {pendingSelection && (
        <div className="notes__selection">
          <span>{pendingSelection.source === 'notes' ? '📝 Note selected' : '🖍 Slide area selected'}</span>
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
          placeholder="Add a question, then flag it"
          aria-label="Question or note about selected content"
        />
        <button type="submit" className="btn-flag" disabled={li.aiLoading}>
          <FlagIcon /> Flag
        </button>
      </form>
    </>
  )
}

function FlagHistory({ flags, onGoToSlide }) {
  const [filter, setFilter] = useState('all')
  if (flags.length === 0) return <p className="notes__flags-empty">No flags yet — select a note or drag across a slide.</p>

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
          <span className="flag-card__type">{FLAG_TYPES[flag.flagType]?.label ?? 'Flag'}</span>
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

function Helper({ li, onStartSession }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (li.ai || li.aiError) setOpen(true)
  }, [li.ai, li.aiError])

  const handleOrb = async () => {
    if (!li.sessionActive) {
      setOpen(true)
      await onStartSession()
      return
    }
    setOpen((shown) => !shown)
  }

  return (
    <div className="helper">
      {open && (
        <div className="helper__panel" role="dialog" aria-label="LockIN focus buddy">
          <div className="helper__head">
            <span><ChatIcon /> Focus buddy <em>✦</em></span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close helper"><XIcon /></button>
          </div>
          <div className="helper__body" aria-live="polite">
            <p className="helper__status">
              {li.listening ? '● Recording quietly in the background' : li.sessionActive ? 'Ready when you need a nudge' : 'Tap the orb to begin your focus session'}
            </p>
            {li.transcriptError && <p className="helper__error">{li.transcriptError}</p>}
            {li.aiLoading && <p className="muted">Thinking…</p>}
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
                {li.listening ? <MicOffIcon /> : <MicIcon />} {li.listening ? 'Stop recording' : 'Start recording'}
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
      <button
        type="button"
        className={`helper__fab ${li.listening ? 'is-listening' : ''}`}
        onClick={handleOrb}
        aria-label={li.sessionActive ? (open ? 'Close focus buddy' : 'Open focus buddy') : 'Start a new focus session'}
        aria-expanded={open}
      >
        {open ? <XIcon /> : <ChatIcon />}
        {!li.sessionActive && <span className="helper__fab-label">Start</span>}
      </button>
    </div>
  )
}

function usePanelResize() {
  const bodyRef = useRef(null)
  const [slideWidth, setSlideWidth] = useState(52)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return undefined
    const update = (event) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = ((event.clientX - rect.left) / rect.width) * 100
      setSlideWidth(Math.min(70, Math.max(32, next)))
    }
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
    }
  }, [resizing])

  return {
    bodyRef,
    slideWidth,
    resizing,
    beginResize: (event) => {
      event.preventDefault()
      setResizing(true)
    },
  }
}

const formatDuration = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
const formatTime = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const truncate = (value, limit) => (value.length > limit ? `${value.slice(0, limit)}…` : value)
