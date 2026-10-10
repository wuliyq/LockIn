import { useEffect, useRef, useState } from 'react'
import { extractDeckContext } from './extractDeckContext'
import { closePdf, loadPdf } from './loadPdf'
import './SlidePanel.css'

/**
 * Top-left panel: PDF upload (slides or prelecture handout), text extraction, and,
 * in the next PR, slide rendering + navigation. Fills whatever box the layout gives it.
 *
 * The pdf.js document stays inside this component. Callers only ever get plain data.
 *
 * @param {Object} props
 * @param {(deck: import('./stubDeckContext').DeckContext) => void} [props.onDeckReady]
 *   Called once per upload with the extracted DeckContext.
 * @param {(index: number, timestampMs: number) => void} [props.onSlideChange]
 *   Called on navigation; index is 0-based, timestamp is Date.now(). (Wired in the navigation PR.)
 */
// onSlideChange is declared now so the interface is stable; remove once it's wired.
// eslint-disable-next-line no-unused-vars
export default function SlidePanel({ onDeckReady, onSlideChange }) {
  const [status, setStatus] = useState('empty') // 'empty' | 'loading' | 'reading' | 'ready' | 'error'
  const [pdf, setPdf] = useState(null) // { doc, filename }
  const [deck, setDeck] = useState(null) // DeckContext for the current PDF
  const [error, setError] = useState('')

  // Mirrors the current doc so unmount cleanup and stale loads can free it.
  const docRef = useRef(null)
  // Bumped on every upload; work that finishes after a newer upload started is discarded.
  const loadIdRef = useRef(0)

  useEffect(() => () => closePdf(docRef.current), [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return

    const loadId = ++loadIdRef.current
    const isStale = () => loadId !== loadIdRef.current
    setStatus('loading')
    setError('')

    let doc
    try {
      doc = await loadPdf(file)
    } catch (err) {
      if (isStale()) return
      console.error('[slides] failed to load PDF', err)
      setError(err?.message || 'Unknown error')
      setStatus('error')
      return
    }
    if (isStale()) {
      closePdf(doc)
      return
    }
    closePdf(docRef.current)
    docRef.current = doc
    setPdf({ doc, filename: file.name })
    setDeck(null)
    setStatus('reading')

    let nextDeck
    try {
      nextDeck = await extractDeckContext(doc, file.name)
    } catch (err) {
      // A newer upload closes this doc mid-extraction, which lands here; ignore it.
      if (isStale()) return
      // The PDF opened but its text couldn't be read. Hand over an empty context
      // anyway so the rest of the app isn't left waiting.
      console.error('[slides] failed to extract text', err)
      nextDeck = emptyDeckContext(file.name, doc.numPages)
    }
    if (isStale()) return

    setDeck(nextDeck)
    setStatus('ready')
    console.log(`[slides] ${file.name}: ${nextDeck.slideCount} pages, ${nextDeck.terms.length} terms`)
    onDeckReady?.(nextDeck)
  }

  return (
    <div className="slide-panel">
      <label className="slide-panel__upload">
        <span>{pdf ? 'Replace PDF' : 'Upload slides or notes (PDF)'}</span>
        <input type="file" accept="application/pdf,.pdf" onChange={handleFile} />
      </label>

      <p className="slide-panel__status" role="status">
        {status === 'empty' && 'No PDF loaded'}
        {status === 'loading' && 'Loading…'}
        {status === 'reading' && 'Reading text…'}
        {status === 'ready' &&
          `${deck.filename}: ${plural(deck.slideCount, 'page')}, ${plural(deck.terms.length, 'term')}`}
        {status === 'error' && `Couldn't open this PDF (${error})`}
      </p>

      {/* Scanned PDFs (or failed extraction) still load; say plainly what that means. */}
      {status === 'ready' && !deck.hasTextLayer && (
        <p className="slide-panel__notice">
          <strong>This PDF has no readable text</strong> (it may be a scanned copy), so AI help
          can't see what's on these pages yet. Your notes and the recording still work normally.
        </p>
      )}
    </div>
  )
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Fallback when text extraction fails: right shape, no content. */
function emptyDeckContext(filename, slideCount) {
  return {
    filename,
    slideCount,
    slides: Array.from({ length: slideCount }, (_, index) => ({ index, text: '' })),
    terms: [],
    hasTextLayer: false,
  }
}
