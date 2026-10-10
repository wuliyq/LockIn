import { useEffect, useRef, useState } from 'react'
import { extractDeckContext } from './extractDeckContext'
import { closePdf, loadPdf } from './loadPdf'
import SlideCanvas from './SlideCanvas'
import './SlidePanel.css'

/**
 * Top-left panel: PDF upload (slides or prelecture handout), the current page, and
 * text extraction. Navigation comes in the next commit. Fills whatever box the
 * layout gives it.
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
  const [pdf, setPdf] = useState(null) // { doc, filename } currently shown
  const [deck, setDeck] = useState(null) // DeckContext for `pdf`; null while its text is read
  const [opening, setOpening] = useState(null) // filename of an upload still opening
  const [error, setError] = useState(null) // { filename, message } of the last failed upload
  const index = 0 // current page; navigation arrives in the next commit

  const inputRef = useRef(null)
  // Mirrors the shown doc so cleanup can free it and extraction can tell it's been replaced.
  const docRef = useRef(null)
  // Bumped on every upload; a load that finishes after a newer upload started is discarded.
  const loadIdRef = useRef(0)

  useEffect(
    () => () => {
      // Unmounting mid-upload: mark in-flight work stale so it frees its doc and
      // never calls onDeckReady from a panel that's gone.
      loadIdRef.current++
      closePdf(docRef.current)
      docRef.current = null
    },
    [],
  )

  async function handleFile(e) {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return

    const loadId = ++loadIdRef.current
    setOpening(file.name)
    setError(null)

    let doc
    try {
      doc = await loadPdf(file)
    } catch (err) {
      if (loadId !== loadIdRef.current) return
      // The current PDF (and its extraction, if still running) stays as it was.
      console.error('[slides] failed to load PDF', err)
      setOpening(null)
      setError({ filename: file.name, message: err?.message || 'Unknown error' })
      return
    }
    if (loadId !== loadIdRef.current) {
      closePdf(doc)
      return
    }

    // Show the new PDF right away; its text is read in the background.
    closePdf(docRef.current)
    docRef.current = doc
    setPdf({ doc, filename: file.name })
    setDeck(null)
    setOpening(null)

    // Extraction is only stale once this doc is actually replaced (or the panel
    // unmounts), not merely because another upload started and might still fail.
    const isReplaced = () => docRef.current !== doc

    let nextDeck
    try {
      nextDeck = await extractDeckContext(doc, file.name)
    } catch (err) {
      if (isReplaced()) return
      // The PDF opened but its text couldn't be read. Hand over an empty context
      // anyway so the rest of the app isn't left waiting.
      console.error('[slides] failed to extract text', err)
      nextDeck = emptyDeckContext(file.name, doc.numPages)
    }
    if (isReplaced()) return

    setDeck(nextDeck)
    console.log(`[slides] ${file.name}: ${nextDeck.slideCount} pages, ${nextDeck.terms.length} terms`)
    onDeckReady?.(nextDeck)
  }

  const fileInput = (
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={handleFile} hidden />
  )
  const chooseFile = () => inputRef.current.click()
  const errorLine = error && (
    <p className="slide-panel__error" role="alert">
      Couldn't open {error.filename} ({error.message})
    </p>
  )

  if (!pdf) {
    return (
      <div className="slide-panel slide-panel--empty">
        {fileInput}
        <p className="slide-panel__prompt">Upload slides or notes</p>
        <button type="button" className="slide-panel__button" onClick={chooseFile}>
          Choose PDF
        </button>
        <p className="slide-panel__status" role="status">
          {opening ? `Opening ${opening}…` : 'No PDF loaded'}
        </p>
        {errorLine}
      </div>
    )
  }

  let status
  if (opening) status = `Opening ${opening}…`
  else if (!deck) status = 'Reading text…'
  else status = `${deck.filename}: ${plural(deck.slideCount, 'page')}, ${plural(deck.terms.length, 'term')}`

  return (
    <div className="slide-panel">
      {fileInput}
      <div className="slide-panel__bar">
        <p className="slide-panel__status" role="status" title={status}>
          {status}
        </p>
        <button type="button" className="slide-panel__button slide-panel__button--small" onClick={chooseFile}>
          Replace
        </button>
      </div>
      {errorLine}

      <div className="slide-panel__stage">
        <SlideCanvas doc={pdf.doc} index={index} />
      </div>

      {/* Scanned PDFs (or failed extraction) still display; say plainly what that means. */}
      {deck && !deck.hasTextLayer && (
        <p
          className="slide-panel__notice"
          title="Your notes and the recording still work normally."
        >
          <strong>No readable text</strong> (likely scanned), so AI help can't see these pages yet.
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
