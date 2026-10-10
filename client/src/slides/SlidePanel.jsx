import { useEffect, useRef, useState } from 'react'
import { extractDeckContext } from './extractDeckContext'
import { closePdf, loadPdf } from './loadPdf'
import SlideCanvas from './SlideCanvas'
import './SlidePanel.css'

// Upload progress logs are for development; production builds stay quiet.
const debugLog = (...args) => import.meta.env.DEV && console.log(...args)

/**
 * Top-left panel: PDF upload (slides or prelecture handout), the current page with
 * prev/next navigation, and text extraction. Fills whatever box the layout gives it.
 *
 * Notes are per slide, so the current index must never disagree between this panel
 * and the notes editor. Pass `index` to own it in app state (recommended): the panel
 * then shows that page and only *requests* changes through onSlideChange. Without
 * `index`, the panel tracks the page itself.
 *
 * The pdf.js document stays inside this component. Callers only ever get plain data.
 *
 * @param {Object} props
 * @param {number} [props.index]  0-based page to show (controlled mode)
 * @param {(deck: import('./stubDeckContext').DeckContext | null) => void} [props.onDeckReady]
 *   Called with null the moment a new PDF opens (its text is still being read, so
 *   the previous deck no longer matches what's on screen), then once more with the
 *   extracted DeckContext. A failed upload calls neither; the current deck stays.
 * @param {(index: number, timestampMs: number) => void} [props.onSlideChange]
 *   Called on every navigation and with 0 when a new PDF opens; index is 0-based,
 *   timestamp is Date.now().
 */
export default function SlidePanel({ index: controlledIndex, onDeckReady, onSlideChange }) {
  const [pdf, setPdf] = useState(null) // { doc, filename } currently shown
  const [deck, setDeck] = useState(null) // DeckContext for `pdf`; null while its text is read
  const [opening, setOpening] = useState(null) // filename of an upload still opening
  const [error, setError] = useState(null) // { filename, message } of the last failed upload
  const [ownIndex, setOwnIndex] = useState(0) // used only when `index` isn't passed

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

    const isStale = () => loadId !== loadIdRef.current

    let doc
    try {
      doc = await loadPdf(file)
    } catch (err) {
      if (isStale()) return
      // The current PDF (and its extraction, if still running) stays as it was.
      console.error('[slides] failed to load PDF', err)
      setOpening(null)
      setError({ filename: file.name, message: err?.message || 'Unknown error' })
      return
    }
    if (isStale()) {
      closePdf(doc)
      return
    }

    // Show the new PDF right away; its text is read in the background.
    closePdf(docRef.current)
    docRef.current = doc
    setPdf({ doc, filename: file.name })
    setDeck(null)
    setOpening(null)
    // The old deck no longer matches the slide on screen; don't let it be used
    // (e.g. as slideText) while the new one is read.
    onDeckReady?.(null)
    // New PDF starts on page 1, and so do its notes.
    setOwnIndex(0)
    onSlideChange?.(0, Date.now())

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
    debugLog(`[slides] ${file.name}: ${nextDeck.slideCount} pages, ${nextDeck.terms.length} terms`)
    onDeckReady?.(nextDeck)
  }

  const pageCount = pdf?.doc.numPages ?? 0
  const requested = typeof controlledIndex === 'number' ? controlledIndex : ownIndex
  // Clamp in case the app's index is out of range for this PDF.
  const index = Math.min(Math.max(requested, 0), Math.max(pageCount - 1, 0))

  function goTo(next) {
    const target = Math.min(Math.max(next, 0), pageCount - 1)
    if (!pdf || target === index) return
    if (typeof controlledIndex !== 'number') setOwnIndex(target)
    onSlideChange?.(target, Date.now())
  }

  // Arrow keys only while the panel itself has focus (e.g. after clicking the slide),
  // so arrows in the notes editor never change the slide.
  function handleKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const step = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1 }[e.key]
    if (step) goTo(index + step)
    else if (e.key === 'Home') goTo(0)
    else if (e.key === 'End') goTo(pageCount - 1)
    else return
    e.preventDefault()
  }

  // Clicking prev/next must not pull focus out of the notes editor.
  const keepFocus = (e) => e.preventDefault()

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
    <div className="slide-panel" role="region" aria-label="Slides" tabIndex={0} onKeyDown={handleKeyDown}>
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

      <div className="slide-panel__nav">
        <button
          type="button"
          className="slide-panel__button slide-panel__button--nav"
          onMouseDown={keepFocus}
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous slide"
        >
          ‹
        </button>
        {/* Shown 1-based; index stays 0-based everywhere else. */}
        <span className="slide-panel__counter" aria-live="polite">
          {index + 1} / {pageCount}
        </span>
        <button
          type="button"
          className="slide-panel__button slide-panel__button--nav"
          onMouseDown={keepFocus}
          onClick={() => goTo(index + 1)}
          disabled={index >= pageCount - 1}
          aria-label="Next slide"
        >
          ›
        </button>
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
