// Dev-only page content for slides-dev.html: SlidePanel in a panel-sized box, plus a
// readout of the DeckContext it produces. Never imported by the real app.
import { useState } from 'react'
import SlidePanel from './SlidePanel'

// Roughly the size of the top-left panel in the three-panel layout.
const boxStyle = {
  width: 420,
  height: 320,
  border: '1px dashed #888',
}

const termStyle = {
  display: 'inline-block',
  margin: '0 6px 6px 0',
  padding: '2px 8px',
  borderRadius: 12,
  background: '#eef',
  fontSize: 13,
}

export default function DevHarness() {
  const [deck, setDeck] = useState(null)
  const [page, setPage] = useState(0)

  function handleDeckReady(nextDeck) {
    console.log('[dev] onDeckReady', nextDeck)
    setDeck(nextDeck)
    setPage(0)
  }

  return (
    <div style={{ margin: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>
      <div style={boxStyle}>
        <SlidePanel
          onDeckReady={handleDeckReady}
          onSlideChange={(index, ts) => console.log('[dev] onSlideChange', index, ts)}
        />
      </div>

      {deck && (
        <section style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 4 }}>DeckContext (what onDeckReady sends)</h3>
          <p style={{ marginTop: 0 }}>
            <b>{deck.filename}</b>: {deck.slideCount} pages, hasTextLayer:{' '}
            <b>{String(deck.hasTextLayer)}</b>
          </p>

          <h4 style={{ marginBottom: 6 }}>Terms ({deck.terms.length})</h4>
          <div>
            {deck.terms.length === 0 && <i>none</i>}
            {deck.terms.map((term, i) => (
              <span key={i} style={termStyle}>
                {term}
              </span>
            ))}
          </div>

          <h4 style={{ marginBottom: 6 }}>
            Page text{' '}
            <select value={page} onChange={(e) => setPage(Number(e.target.value))}>
              {deck.slides.map((slide) => (
                // Display 1-based; slide.index stays 0-based.
                <option key={slide.index} value={slide.index}>
                  Page {slide.index + 1}
                </option>
              ))}
            </select>
          </h4>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 12, fontSize: 13 }}>
            {deck.slides[page]?.text || '(empty)'}
          </pre>
        </section>
      )}
    </div>
  )
}
