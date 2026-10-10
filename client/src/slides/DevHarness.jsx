// Dev-only page content for slides-dev.html. Never imported by the real app.
//
// Mirrors how the real layout should use SlidePanel: the app owns the current slide
// index (controlled mode), notes are one page per slide keyed by deck + slide, and the
// readouts show exactly what other roles would receive.
import { useState } from 'react'
import SlidePanel from './SlidePanel'

// Roughly the size of the top-left panel in the three-panel layout.
const boxStyle = {
  width: 420,
  height: 320,
  border: '1px dashed #888',
  flexShrink: 0,
}

const termStyle = {
  display: 'inline-block',
  margin: '0 6px 6px 0',
  padding: '2px 8px',
  borderRadius: 12,
  background: '#eef',
  fontSize: 13,
}

const preStyle = { whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 12, fontSize: 13, margin: 0 }

export default function DevHarness() {
  const [deck, setDeck] = useState(null)
  const [slideIndex, setSlideIndex] = useState(0)
  // One notes page per slide. Keyed by deck + slide so replacing the PDF can't
  // put old notes on the new deck's slides.
  const [notes, setNotes] = useState({})
  const [events, setEvents] = useState([])

  // While the new deck is read (deck === null) notes fall back to a shared key;
  // in the real app, key by something known at open time if that window matters.
  const notesKey = `${deck?.filename ?? 'no-pdf'}#${slideIndex}`

  function handleDeckReady(nextDeck) {
    // null = a new PDF just opened and its text is still being read.
    console.log('[dev] onDeckReady', nextDeck ? nextDeck.filename : 'null (reading new PDF)', nextDeck)
    setDeck(nextDeck)
  }

  function handleSlideChange(index, timestampMs) {
    console.log('[dev] onSlideChange', index, timestampMs)
    setSlideIndex(index)
    setEvents((prev) => [{ index, timestampMs }, ...prev].slice(0, 8))
  }

  return (
    <div style={{ margin: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        <div style={boxStyle}>
          <SlidePanel index={slideIndex} onDeckReady={handleDeckReady} onSlideChange={handleSlideChange} />
        </div>

        {/* Stand-in for Role 1's notes editor: arrows here must never change the slide,
            and clicking ‹/› in the panel must leave the cursor here. */}
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span>
            Notes for slide {slideIndex + 1} <span style={{ opacity: 0.6 }}>(fake editor, one page per slide)</span>
          </span>
          <textarea
            value={notes[notesKey] ?? ''}
            onChange={(e) => setNotes((prev) => ({ ...prev, [notesKey]: e.target.value }))}
            placeholder="Type here, then click › in the panel: the cursor stays and a fresh page appears."
            style={{ flex: 1, fontFamily: 'inherit', fontSize: 14, padding: 8 }}
          />
        </label>
      </div>

      <section style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h4 style={{ margin: '0 0 6px' }}>
            Current slide: index {slideIndex} <span style={{ opacity: 0.6 }}>(0-based)</span>
          </h4>
          <p style={{ margin: '0 0 6px', fontSize: 13, opacity: 0.7 }}>
            What Role 3's <code>slideText</code> would be:
          </p>
          <pre style={preStyle}>{deck ? deck.slides[slideIndex]?.text || '(empty string)' : '(no DeckContext yet)'}</pre>
        </div>

        <div>
          <h4 style={{ margin: '0 0 6px' }}>onSlideChange log</h4>
          {events.length === 0 && <i style={{ fontSize: 13 }}>none yet</i>}
          <ol reversed style={{ margin: 0, paddingLeft: 20, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            {events.map((e, i) => (
              <li key={`${e.timestampMs}-${e.index}-${i}`}>
                index {e.index} at {new Date(e.timestampMs).toLocaleTimeString()}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {deck && (
        <section style={{ marginTop: 24 }}>
          <h4 style={{ margin: '0 0 4px' }}>DeckContext (what onDeckReady sends)</h4>
          <p style={{ marginTop: 0, fontSize: 14 }}>
            <b>{deck.filename}</b>: {deck.slideCount} pages, hasTextLayer: <b>{String(deck.hasTextLayer)}</b>
          </p>
          <h4 style={{ margin: '0 0 6px' }}>Terms ({deck.terms.length})</h4>
          <div>
            {deck.terms.length === 0 && <i>none</i>}
            {deck.terms.map((term, i) => (
              <span key={i} style={termStyle}>
                {term}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
