import { useEffect, useRef, useState } from 'react'
import { extractDeckContext } from '../extraction/extractDeckContext'
import { checkPdfFile, closePdf, describeLoadError, loadPdf } from '../pdf/loadPdf'
import SlideCanvas from './SlideCanvas'
import './SlideStrip.css'

/**
 * A row of slide thumbnails for a PDF the caller already has as a File (the lecturer
 * dashboard uses it under its flags-per-slide chart). Every thumbnail is exactly
 * `cellWidth` px wide, so a chart drawn with the same width per slide lines up with it.
 *
 * Like SlidePanel, the pdf.js document stays inside: callers get a DeckContext via
 * onDeckReady, never the document.
 *
 * @param {Object} props
 * @param {File} props.file
 * @param {number} props.cellWidth  px per slide
 * @param {(deck: import('../contract/stubDeckContext').DeckContext) => void} [props.onDeckReady]
 * @param {(error: string) => void} [props.onError]
 */
export default function SlideStrip({ file, cellWidth, onDeckReady, onError }) {
  const [doc, setDoc] = useState(null)
  const callbacks = useRef({ onDeckReady, onError })
  useEffect(() => {
    callbacks.current = { onDeckReady, onError }
  })

  useEffect(() => {
    if (!file) return undefined
    let cancelled = false
    let loaded = null

    ;(async () => {
      const problem = checkPdfFile(file)
      if (problem) {
        callbacks.current.onError?.(problem)
        return
      }
      try {
        loaded = await loadPdf(file)
        if (cancelled) return
        setDoc(loaded)
        const deck = await extractDeckContext(loaded, file.name)
        if (!cancelled) callbacks.current.onDeckReady?.(deck)
      } catch (err) {
        if (!cancelled) callbacks.current.onError?.(describeLoadError(err))
      }
    })()

    return () => {
      cancelled = true
      closePdf(loaded)
    }
  }, [file])

  if (!doc) return <div className="slide-strip slide-strip--loading" style={{ height: cellWidth * 0.5625 + 8 }} />

  return (
    <div className="slide-strip" style={{ gridTemplateColumns: `repeat(${doc.numPages}, ${cellWidth}px)` }}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <div key={i} className="slide-strip__cell" style={{ height: cellWidth * 0.5625 }}>
          <SlideCanvas doc={doc} index={i} />
        </div>
      ))}
    </div>
  )
}
