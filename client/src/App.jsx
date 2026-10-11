import { useEffect, useRef, useState } from 'react'
import {
  ChatIcon,
  ChevronDownIcon,
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
import { NUDGE_MINUTES } from './lockin/useFocusNudge'
import { SlidePanel } from './slides'
import './App.css'

const AI_ICONS = { catchup: ZapIcon, example: LightbulbIcon, check: HelpIcon, why: TargetIcon }

/**
 * Student workspace. Opened from the lecture home page it gets a per-lecture
 * `storageScope` and an `onFinish(snapshot)` that saves the lecture and goes home;
 * opened on its own it behaves as before, with no Finish button.
 */
export default function App({ storageScope = null, onFinish = null }) {
  const li = useLockIn({ storageScope })
  const [pendingSelection, setPendingSelection] = useState(null)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState('')
  const { bodyRef, slideWidth, resizing, beginResize } = usePanelResize()

  const startFocusSession = async () => {
    li.startSession()
    if (!li.listening && li.transcriptStatus !== 'connecting') await li.toggleListen()
  }

  // Stop recording (keeping its last words), save notes, flags and catch-ups, go home.
  // If saving fails the lecture stays open with the error, so nothing is lost.
  const finishLecture = async () => {
    setFinishing(true)
    setFinishError('')
    try {
      await li.stopListening()
      await onFinish(li.lectureSnapshot())
    } catch (error) {
      setFinishError(error?.message || 'This lecture could not be saved. Try again.')
      setFinishing(false)
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
          {onFinish && (
            <button
              type="button"
              className="app__finish"
              onClick={finishLecture}
              disabled={finishing || li.transcriptStatus === 'connecting'}
              title="Save this lecture's notes and flags, then go back to your lectures"
            >
              {finishing ? 'Saving…' : 'Finish lecture'}
            </button>
          )}
        </div>
        {finishError && (
          <p className="app__finish-error" role="alert">
            {finishError}
          </p>
        )}
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
  const [flagType, setFlagType] = useState('question')
  const [showFlags, setShowFlags] = useState(true)
  const [quickSent, setQuickSent] = useState(false)
  const quickTimer = useRef(null)
  const slideLabel = li.deck
    ? `Slide ${li.current + 1}${li.title ? ` · ${li.title}` : ''}`
    : 'No slides yet'

  useEffect(() => () => window.clearTimeout(quickTimer.current), [])

  const captureNoteSelection = (event) => {
    const { selectionStart, selectionEnd, value } = event.currentTarget
    const selectedText = value.slice(selectionStart, selectionEnd).trim()
    if (selectedText) onSelection({ source: 'notes', selectedText })
  }

  // One tap: flag this moment as confusing for the lecturer, no question needed.
  const sendQuickFlag = (selection) => {
    li.quickFlag(selection ?? {})
    clearSelection()
    setQuickSent(true)
    window.clearTimeout(quickTimer.current)
    quickTimer.current = window.setTimeout(() => setQuickSent(false), 2500)
  }

  return (
    <>
      <p className="notes__meta">
        <span>{li.savedAt ? `Saved ${li.savedAt}` : 'Notes autosave'}</span>
        <span aria-hidden="true">·</span>
        <span className="notes__slide">{slideLabel}</span>
      </p>

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
          if (FLAG_TYPES[nextFlagType]?.quick) {
            sendQuickFlag(selection)
            return
          }
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
        <button
          type="button"
          className={`btn-quick-flag ${quickSent ? 'is-sent' : ''}`}
          onClick={() => sendQuickFlag(pendingSelection)}
          disabled={!li.deck}
          title="Confusing: flag this moment for the lecturer in one tap"
          aria-label="Flag this moment as confusing"
        >
          {quickSent ? '✓' : '?'}
        </button>
        <select
          value={flagType}
          onChange={(event) => setFlagType(event.target.value)}
          aria-label="Type of help needed"
        >
          {Object.entries(FLAG_TYPES).filter(([, type]) => !type.quick).map(([value, type]) => (
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
      <p className="notes__quick-status" aria-live="polite">
        {quickSent ? 'Marked as confusing for your lecturer.' : ''}
      </p>

      <section className="notes__flags" aria-label="My flags">
        <button
          type="button"
          className="notes__flags-toggle"
          onClick={() => setShowFlags((shown) => !shown)}
          aria-expanded={showFlags}
        >
          <FlagIcon /> My flags <span>{li.confusions.length}</span>
          <ChevronDownIcon className={`notes__flags-chevron ${showFlags ? 'is-open' : ''}`} />
        </button>
        {showFlags && <FlagHistory flags={li.confusions} onGoToSlide={li.onSlideChange} />}
      </section>
    </>
  )
}

function FlagHistory({ flags, onGoToSlide }) {
  const [filter, setFilter] = useState('all')
  if (flags.length === 0) return <p className="notes__flags-empty">No flags yet. Tap ? when something is confusing, or select a note to ask about it.</p>

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
  const { nudge } = li

  // Answering a nudge means writing a line: put the cursor at the end of the notes.
  const answerNudge = () => {
    nudge.dismiss()
    const editor = document.querySelector('.notes__editor')
    if (!editor) return
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }

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
          <div className="helper__settings">
            <label className="helper__switch">
              <input
                type="checkbox"
                checked={nudge.enabled}
                onChange={(event) => nudge.setSettings({ enabled: event.target.checked })}
              />
              Focus nudges
            </label>
            <label className="helper__nudge-wait">
              after
              <select
                value={nudge.minutes}
                disabled={!nudge.enabled}
                onChange={(event) => nudge.setSettings({ minutes: Number(event.target.value) })}
                aria-label="Nudge after this many quiet minutes"
              >
                {NUDGE_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} min</option>
                ))}
              </select>
              quiet
            </label>
          </div>
        </div>
      )}
      <div className="helper__dock">
        <button
          type="button"
          className={`helper__fab ${li.listening ? 'is-listening' : ''} ${nudge.message ? 'has-nudge' : ''}`}
          onClick={handleOrb}
          aria-label={li.sessionActive ? (open ? 'Close focus buddy' : 'Open focus buddy') : 'Start a new focus session'}
          aria-expanded={open}
        >
          {open ? <XIcon /> : <ChatIcon />}
          {!li.sessionActive && <span className="helper__fab-label">Start</span>}
        </button>
        {nudge.message && (
          <div className="helper__nudge" role="status">
            <button type="button" className="helper__nudge-text" onClick={answerNudge}>
              {nudge.message}
            </button>
            <button type="button" className="helper__nudge-close" onClick={nudge.dismiss} aria-label="Dismiss nudge">
              <XIcon />
            </button>
          </div>
        )}
      </div>
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
