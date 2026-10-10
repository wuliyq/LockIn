import { useState } from 'react'
import { LockIcon, MicIcon, MicOffIcon, PlusIcon } from './icons'
import { FlagBar, FlagComposer, FlagList, FlagToast } from './lockin/Flags'
import SelectionFlagger from './lockin/SelectionFlagger'
import { useLockIn } from './lockin/useLockIn'
import { SlidePanel } from './slides'
import './App.css'

/** Sage design: slides on the left, notes and flags on the right. */
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
          <SlideText li={li} />
          <Transcript li={li} />
        </section>

        <section className="app__notes" aria-label="Notes and flags">
          <NotesAndFlags li={li} />
        </section>
      </div>

      <SelectionFlagger li={li} />
      <FlagToast li={li} />
    </div>
  )
}

function NotesAndFlags({ li }) {
  const [tab, setTab] = useState('notes')
  const slideLabel = li.deck
    ? `Slide ${li.current + 1}${li.title ? ` · ${li.title}` : ''}`
    : 'No slides yet'

  return (
    <>
      <div className="notes__top">
        <div className="tabs" role="tablist" aria-label="Notes or flags">
          <button
            type="button"
            role="tab"
            id="tab-notes"
            aria-controls="panel-notes"
            aria-selected={tab === 'notes'}
            className={`tabs__tab ${tab === 'notes' ? 'is-active' : ''}`}
            onClick={() => setTab('notes')}
          >
            Notes
          </button>
          <button
            type="button"
            role="tab"
            id="tab-flags"
            aria-controls="panel-flags"
            aria-selected={tab === 'flags'}
            className={`tabs__tab ${tab === 'flags' ? 'is-active' : ''}`}
            onClick={() => setTab('flags')}
          >
            Flags {li.flags.length > 0 && <span className="tabs__count">{li.flags.length}</span>}
          </button>
        </div>
        <p className="notes__meta">
          {tab === 'notes' && (
            <>
              <span>{li.savedAt ? `Saved ${li.savedAt}` : 'Notes autosave'}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="notes__slide">{slideLabel}</span>
        </p>
      </div>

      {tab === 'notes' ? (
        <div className="notes__panel" role="tabpanel" id="panel-notes" aria-labelledby="tab-notes">
          <textarea
            className="notes__editor"
            data-flag-source="notes"
            aria-label={`Notes for ${slideLabel}`}
            value={li.note}
            onChange={(e) => li.setNote(e.target.value)}
            placeholder={
              li.deck
                ? "Write freely. LockIN keeps track of which slide you're on. Highlight anything to flag it."
                : 'Upload your slides to keep notes linked to each slide, or just start writing.'
            }
          />
        </div>
      ) : (
        <div className="notes__panel" role="tabpanel" id="panel-flags" aria-labelledby="tab-flags">
          <FlagList li={li} />
        </div>
      )}

      <FlagComposer li={li} />
      <FlagBar li={li} />
    </>
  )
}

/** The current slide's extracted text, so students can highlight and flag it. */
function SlideText({ li }) {
  if (!li.deck) return null
  const lines = li.slideText.split('\n').filter((line) => line.trim())

  return (
    <div className="card slide-text">
      <div className="slide-text__head">
        <span className="eyebrow">Slide {li.current + 1} text</span>
        {lines.length > 0 && <span className="slide-text__hint">Highlight to flag</span>}
      </div>
      {lines.length > 0 ? (
        <div className="slide-text__body" data-flag-source="slide">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : (
        <p className="slide-text__empty">No readable text on this slide. You can still flag it with the buttons.</p>
      )}
    </div>
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
        >
          {li.listening ? (
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
      <div className="transcript__lines" data-flag-source={li.transcript.length ? 'transcript' : undefined}>
        {li.transcript.length === 0 && (
          <p className="transcript__empty">Start listening to see the lecture transcribed here.</p>
        )}
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
