import { useEffect, useRef, useState } from 'react'
import {
  ChatIcon,
  ChevronDownIcon,
  FlagIcon,
  HelpIcon,
  LightbulbIcon,
  LockIcon,
  MessageCheckIcon,
  MicIcon,
  MicOffIcon,
  TargetIcon,
  UnlockIcon,
  XIcon,
  ZapIcon,
} from './icons'
import { FLAG_TYPES, flagColor, flagTypeId, useLockIn } from './lockin/useLockIn'
import SelectionFlagger from './lockin/SelectionFlagger'
import { NUDGE_MINUTES } from './lockin/useFocusNudge'
import { SlidePanel } from './slides'
import './App.css'

const FLAG_ICONS = {
  catch_up: ZapIcon,
  example: LightbulbIcon,
  why_it_matters: TargetIcon,
  confusing: HelpIcon,
  check_thinking: MessageCheckIcon,
}

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

  // Change what's highlighted. A dragged slide area that was never flagged is
  // dropped when the student clears it, picks something else or changes slide.
  const changeSelection = (next) => {
    const previous = pendingSelection?.highlightId
    if (previous && previous !== next?.highlightId) li.removeSlideHighlight(previous)
    setPendingSelection(next)
  }
  const discardSelection = () => changeSelection(null)
  // After flagging: forget the selection but keep the (now flagged) slide area.
  const clearSelection = () => setPendingSelection(null)

  const addSlideHighlight = (rect) => {
    const highlight = li.createSlideHighlight(rect)
    if (!highlight) return
    changeSelection({
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
                discardSelection()
              }}
              highlights={li.slideHighlights
                // Flagged areas, plus the one being chosen right now.
                .filter((highlight) => highlight.flagType || highlight.id === pendingSelection?.highlightId)
                .map((highlight) => (highlight.flagType
                ? { ...highlight, color: flagColor(highlight.flagType), label: FLAG_TYPES[flagTypeId(highlight.flagType)]?.label }
                : highlight))}
              onHighlight={addSlideHighlight}
            />
          </div>
          <RecordingLine li={li} />
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
            onSelection={changeSelection}
            clearSelection={clearSelection}
            discardSelection={discardSelection}
          />
        </section>
      </div>

      <Helper
        li={li}
        onStartSession={startFocusSession}
        pendingSelection={pendingSelection}
        clearSelection={clearSelection}
        discardSelection={discardSelection}
      />
    </div>
  )
}

function Notes({ li, pendingSelection, onSelection, clearSelection, discardSelection }) {
  const [showFlags, setShowFlags] = useState(true)
  const split = useFlagsResize()
  const slideLabel = li.deck
    ? `Slide ${li.current + 1}${li.title ? ` · ${li.title}` : ''}`
    : 'No slides yet'

  const captureNoteSelection = (event) => {
    const { selectionStart, selectionEnd, value } = event.currentTarget
    const selectedText = value.slice(selectionStart, selectionEnd).trim()
    if (selectedText) onSelection({ source: 'notes', selectedText })
  }

  return (
    <div
      className={`notes ${split.resizing ? 'is-resizing' : ''}`}
      ref={split.containerRef}
      style={{ '--flags-height': `${split.height}px` }}
    >
      <div className="notes__write">
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
              ? 'Write freely. Highlight any line to flag it.'
              : 'Upload your slides to keep notes linked to each slide, or just start writing.'
          }
        />

        <SelectionFlagger
          enabled={Boolean(li.deck) && !li.aiLoading}
          onPick={(flagType, selection) => {
            li.submitFlag(flagType, selection).then((sent) => { if (sent) setShowFlags(true) })
            clearSelection()
          }}
        />

        {pendingSelection ? (
          <div className="notes__selection">
            <div className="notes__selection-head">
              <span>{pendingSelection.source === 'notes' ? '📝 Highlighted note' : '🖍 Highlighted slide area'}</span>
              <b>{truncate(pendingSelection.selectedText, 60)}</b>
              <button type="button" onClick={discardSelection} aria-label="Clear highlight">×</button>
            </div>
            <FlagButtons
              li={li}
              className="notes__selection-actions"
              onPick={(flagType) => {
                li.submitFlag(flagType, pendingSelection).then((sent) => { if (sent) setShowFlags(true) })
                // Catch me up is about the recording, so a dragged area isn't kept for it.
                if (flagType === 'catch_up') discardSelection()
                else clearSelection()
              }}
            />
          </div>
        ) : (
          <p className="notes__hint">
            <FlagIcon /> Highlight your notes or drag across the slide to flag it. What you highlight is what LockIN answers.
          </p>
        )}
      </div>

      {showFlags && (
        <div
          className="notes__resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize notes and flags"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(split.height)}
          aria-valuemin={split.min}
          onPointerDown={split.beginResize}
          onKeyDown={split.onKeyDown}
        />
      )}

      <section className={`notes__flags ${showFlags ? 'is-open' : ''}`} aria-label="My flags">
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
    </div>
  )
}

function FlagHistory({ flags, onGoToSlide }) {
  const [filter, setFilter] = useState('all')
  if (flags.length === 0) return <p className="notes__flags-empty">No flags yet. Select a note or drag across a slide, then ask about it.</p>

  const counts = Object.fromEntries(Object.keys(FLAG_TYPES).map((type) => [type, 0]))
  flags.forEach((flag) => { counts[flagTypeId(flag.flagType)] = (counts[flagTypeId(flag.flagType)] ?? 0) + 1 })
  const shown = filter === 'all' ? flags : flags.filter((flag) => flagTypeId(flag.flagType) === filter)

  return (
    <div className="notes__flag-history" aria-label="My flags">
      <div className="flag-filters" role="group" aria-label="Filter flags by type">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
          All <span>{flags.length}</span>
        </button>
        {Object.entries(FLAG_TYPES).filter(([type]) => counts[type]).map(([type, meta]) => (
          <button key={type} type="button" className={filter === type ? 'is-active' : ''} onClick={() => setFilter(type)}>
            <i className="flag-dot" style={{ '--type-color': flagColor(type) }} aria-hidden="true" />
            {meta.label} <span>{counts[type]}</span>
          </button>
        ))}
      </div>
      {[...shown].reverse().map((flag) => (
        <article className="flag-card" key={flag.id} style={{ '--type-color': flagColor(flag.flagType) }}>
          <span className="flag-card__type">
            <i className="flag-dot" aria-hidden="true" /> {FLAG_TYPES[flagTypeId(flag.flagType)]?.label ?? 'Flag'}
          </span>
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

/** The five flag actions as chips. Each sends a flag to the lecturer and gets an AI answer. */
function FlagButtons({ li, onPick, className = '' }) {
  return (
    <div className={`flag-buttons ${className}`} role="group" aria-label="Flag as">
      {Object.entries(FLAG_TYPES).map(([flagType, type]) => {
        const Icon = FLAG_ICONS[flagType] ?? FlagIcon
        return (
          <button
            key={flagType}
            type="button"
            disabled={!li.deck || li.aiLoading}
            onClick={() => onPick(flagType)}
            className={`chip flag-chip ${li.ai?.kind === flagType ? 'is-active' : ''}`}
            style={{ '--type-color': flagColor(flagType) }}
          >
            <Icon /> {type.label}
          </button>
        )
      })}
    </div>
  )
}

/** A quiet line under the slides: start or stop the lecture recording that powers Catch me up. */
function RecordingLine({ li }) {
  const connecting = li.transcriptStatus === 'connecting'
  return (
    <div className="recording-line" aria-live="polite">
      <button
        type="button"
        className={`recording-line__toggle ${li.listening ? 'is-on' : ''}`}
        onClick={li.toggleListen}
        disabled={connecting}
      >
        {li.listening ? <MicOffIcon /> : <MicIcon />}
        {connecting ? 'Connecting to the microphone…' : li.listening ? 'Recording the lecture · stop' : 'Record the lecture for catch-ups'}
      </button>
      {li.transcriptError && <span className="recording-line__error">{li.transcriptError}</span>}
    </div>
  )
}

function Helper({ li, onStartSession, pendingSelection, clearSelection, discardSelection }) {
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
              {pendingSelection
                ? 'These buttons will use what you highlighted.'
                : li.sessionActive ? 'Ask about this slide, or highlight something first.' : 'Tap the orb to begin your focus session'}
            </p>
            {li.aiLoading && <p className="muted">Thinking…</p>}
            {li.ai && !li.aiLoading && (
              <div className="helper__answer">
                <b>{li.ai.label} · slide {li.ai.slide + 1}</b>
                {li.ai.text}
              </div>
            )}
            {li.aiError && <p className="helper__error">{li.aiError}</p>}
          </div>
          <div className="helper__actions">
            <FlagButtons
              li={li}
              className="helper__flag-buttons"
              onPick={(flagType) => {
                li.submitFlag(flagType, pendingSelection ?? {})
                if (flagType === 'catch_up') discardSelection()
                else clearSelection()
              }}
            />
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

const FLAGS_MIN = 96 // px: room for the My flags header and a card
const NOTES_MIN = 260 // px kept for the notes editor and flag form

/** Drag (or arrow-key) the line between the notes and My flags to share the column. */
function useFlagsResize() {
  const containerRef = useRef(null)
  const [height, setHeight] = useState(240)
  const [resizing, setResizing] = useState(false)

  const clamp = (value) => {
    const total = containerRef.current?.getBoundingClientRect().height ?? 0
    const max = Math.max(FLAGS_MIN, total - NOTES_MIN)
    return Math.min(max, Math.max(FLAGS_MIN, value))
  }

  useEffect(() => {
    if (!resizing) return undefined
    const update = (event) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const total = rect.height
      const max = Math.max(FLAGS_MIN, total - NOTES_MIN)
      setHeight(Math.min(max, Math.max(FLAGS_MIN, rect.bottom - event.clientY)))
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
    containerRef,
    height,
    min: FLAGS_MIN,
    resizing,
    beginResize: (event) => {
      event.preventDefault()
      setResizing(true)
    },
    onKeyDown: (event) => {
      const step = event.shiftKey ? 64 : 16
      if (event.key === 'ArrowUp') setHeight((value) => clamp(value + step))
      else if (event.key === 'ArrowDown') setHeight((value) => clamp(value - step))
      else return
      event.preventDefault()
    },
  }
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
