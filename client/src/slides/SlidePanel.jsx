import { useEffect, useRef, useState } from 'react'
import { closePdf, loadPdf } from './loadPdf'
import './SlidePanel.css'

/**
 * Top-left panel: PDF upload (slides or prelecture handout) and, in later PRs,
 * slide rendering + navigation. Fills whatever box the layout gives it.
 *
 * The pdf.js document stays inside this component. Callers only ever get plain data.
 *
 * @param {Object} props
 * @param {(deck: import('./stubDeckContext').DeckContext) => void} [props.onDeckReady]
 *   Called once per upload with the extracted DeckContext. (Wired in PR 2.)
 * @param {(index: number, timestampMs: number) => void} [props.onSlideChange]
 *   Called on navigation; index is 0-based, timestamp is Date.now(). (Wired in PR 5.)
 */
// Props are declared now so the interface is stable; remove once both are wired.
// eslint-disable-next-line no-unused-vars
export default function SlidePanel({ onDeckReady, onSlideChange }) {
  const [status, setStatus] = useState('empty') // 'empty' | 'loading' | 'loaded' | 'error'
  const [pdf, setPdf] = useState(null) // { doc, filename }
  const [error, setError] = useState('')

  // Mirrors the current doc so unmount cleanup and stale loads can free it.
  const docRef = useRef(null)
  // Bumped on every upload; a load that finishes after a newer one started is discarded.
  const loadIdRef = useRef(0)

  useEffect(() => () => closePdf(docRef.current), [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return

    const loadId = ++loadIdRef.current
    setStatus('loading')
    setError('')

    try {
      const doc = await loadPdf(file)
      if (loadId !== loadIdRef.current) {
        closePdf(doc)
        return
      }
      closePdf(docRef.current)
      docRef.current = doc
      setPdf({ doc, filename: file.name })
      setStatus('loaded')
      console.log(`[slides] ${file.name}: ${doc.numPages} pages`)
    } catch (err) {
      if (loadId !== loadIdRef.current) return
      console.error('[slides] failed to load PDF', err)
      setError(err?.message || 'Unknown error')
      setStatus('error')
    }
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
        {status === 'loaded' && `${pdf.filename}: ${pdf.doc.numPages} pages`}
        {status === 'error' && `Couldn't open this PDF (${error})`}
      </p>
    </div>
  )
}
