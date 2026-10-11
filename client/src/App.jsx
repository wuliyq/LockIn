import { useEffect, useState } from 'react'
import {
  ChatIcon,
  FlagIcon,
  HelpIcon,
  LightbulbIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  TargetIcon,
  XIcon,
  ZapIcon,
} from './icons'
import { AI_LABELS, FLAG_TYPES, useLockIn } from './lockin/useLockIn'
import { SlidePanel } from './slides'
import './App.css'

const AI_ICONS = { catchup: ZapIcon, example: LightbulbIcon, check: HelpIcon, why: TargetIcon }

/** Sage design: slides on the left, notes on the right, chat helper bottom-left. */
export default function App() {
  const li = useLockIn()

  return (
    <div className="theme-sage app">
      <header className="app__header">
        <span className="app__logo">
          <LockIcon /> LockIN
        </span>
        <span className="app__deck">
          {li.reading ? 'Reading slides…' : (li.deck?.filename ?? 'No slides loaded')}
        </span>
        {/* Balances the logo so the deck name stays centered. */}
        <span className="app__header-spacer" aria-hidden="true" />
      </header>

      <div className="app__body">
        <section className="app__slides" aria-label="Lecture">
          <div className="app__slide-box">
            <SlidePanel
              index={li.current}
              onDeckReady={li.onDeckReady}
              onSlideChange={li.onSlideChange}
            />
          </div>
          <Transcript li={li} />
        </section>

        <section className="app__notes" aria-label="Notes">
          <Notes li={li} />
        </section>
      </div>

      <Helper li={li} />
    </div>
  )
}

function Notes({ li }) {
  const [confusion, setConfusion] = useState('')
  const [flagType, setFlagType] = useState('confusing')
  const slideLabel = li.deck
    ? `Slide ${li.current + 1}${li.title ? ` · ${li.title}` : ''}`
    : 'No slides yet'

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
        onChange={(e) => li.setNote(e.target.value)}
        placeholder={
          li.deck
            ? "Write freely. LockIN keeps track of which slide you're on."
            : 'Upload your slides to keep notes linked to each slide, or just start writing.'
        }
      />
      <form
        className="notes__flag-form"
        onSubmit={(e) => {
          e.preventDefault()
          li.submitFlag(confusion, flagType).then((sent) => {
            if (sent) setConfusion('')
          })
        }}
      >
        <select
          value={flagType}
          onChange={(e) => setFlagType(e.target.value)}
          aria-label="Type of help needed"
        >
          {Object.entries(FLAG_TYPES).map(([value, type]) => (
            <option key={value} value={value}>{type.label}</option>
          ))}
        </select>
        <input
          value={confusion}
          onChange={(e) => setConfusion(e.target.value)}
          placeholder="Something unclear? Jot it here or highlight text…"
          aria-label="What's confusing"
        />
        <button type="submit" className="btn-flag" disabled={li.aiLoading}>
          <FlagIcon /> Flag
        </button>
      </form>
      {li.confusions.length > 0 && (
        <p className="notes__flag-count">
          {li.confusions.length} help {li.confusions.length === 1 ? 'flag' : 'flags'} in this deck
        </p>
      )}
    </>
  )
}

function Transcript({ li }) {
  return (
    <div className="card transcript">
      <div className="transcript__head">
        <span className="eyebrow">Live transcript</span>
        <button
          type="button"
          onClick={li.toggleListen}
          className={`transcript__toggle ${li.listening ? 'is-on' : ''}`}
          disabled={li.transcriptStatus === 'connecting'}
        >
          {li.transcriptStatus === 'connecting' ? 'Connecting…' : li.listening ? (
            <>
              <MicOffIcon /> Stop
            </>
          ) : (
            <>
              <MicIcon /> Listen
            </>
          )}
        </button>
      </div>
      <div className="transcript__lines">
        {li.transcript.length === 0 && (
          <p className="transcript__empty">Start listening to see the lecture transcribed here.</p>
        )}
        {li.transcriptError && <p className="transcript__error">{li.transcriptError}</p>}
        {li.transcript.map((line, i) => (
          <div key={i} className="transcript__line">
            <button
              type="button"
              onClick={() => li.insertLine(line)}
              title="Insert into notes"
              aria-label="Insert into notes"
            >
              <PlusIcon />
            </button>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Helper({ li }) {
  const [open, setOpen] = useState(false)

  // A flag can be submitted from the notes panel, so reveal its answer there.
  useEffect(() => {
    if (li.ai || li.aiError) setOpen(true)
  }, [li.ai, li.aiError])

  return (
    <div className="helper">
      {open && (
        <div className="helper__panel" role="dialog" aria-label="LockIN helper">
          <div className="helper__head">
            <span>
              <ChatIcon /> LockIN helper
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close helper">
              <XIcon />
            </button>
          </div>
          <div className="helper__body" aria-live="polite">
            <p className="muted">
              {li.deck
                ? `Hi! I'm looking at slide ${li.current + 1}. What do you need?`
                : "Upload your slides and I'll follow along with the lecture."}
            </p>
            {li.aiLoading && <p className="muted">Thinking…</p>}
            {li.ai && !li.aiLoading && (
              <div className="helper__answer">
                <b>
                  {li.ai.label ?? AI_LABELS[li.ai.kind]} · slide {li.ai.slide + 1}
                </b>
                {li.ai.text}
              </div>
            )}
            {li.aiError && <p className="helper__error">{li.aiError}</p>}
          </div>
          <div className="helper__actions">
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
        className="helper__fab"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close helper' : 'Open helper'}
        aria-expanded={open}
      >
        {open ? <XIcon /> : <ChatIcon />}
      </button>
    </div>
  )
}
