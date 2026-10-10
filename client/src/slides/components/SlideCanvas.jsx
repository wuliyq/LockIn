import { useEffect, useRef, useState } from 'react'
import { pdfjsLib } from '../pdf/pdfSetup'
import './SlideCanvas.css'

/**
 * Draws one PDF page, scaled to fit its container in both directions (landscape
 * slides and portrait handouts alike), sharp on high-DPI screens, and redrawn when
 * the container resizes.
 *
 * @param {Object} props
 * @param {import('pdfjs-dist').PDFDocumentProxy} props.doc
 * @param {number} props.index  0-based page index
 */
export default function SlideCanvas({ doc, index }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  // The render currently drawing into the canvas, if any. pdf.js can't draw two
  // renders into one canvas at once, so each new render waits for this to stop.
  const taskRef = useRef(null)
  const [size, setSize] = useState(null) // { width, height } of the container in CSS px
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)

  // Moving the window to a screen with a different pixel density doesn't resize the
  // box, so watch the density itself and redraw at the new sharpness.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const update = () => setDpr(window.devicePixelRatio || 1)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [dpr])

  useEffect(() => {
    const box = boxRef.current
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      const height = Math.floor(entry.contentRect.height)
      setSize((prev) => (prev?.width === width && prev?.height === height ? prev : { width, height }))
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !size || size.width === 0 || size.height === 0) return
    let cancelled = false
    let task = null

    async function draw() {
      // Stop whatever is drawing (fast page flips, resizes, StrictMode's double run)
      // and wait for it to let go of the canvas.
      const previous = taskRef.current
      if (previous) {
        previous.cancel()
        await previous.promise.catch(() => {})
      }
      if (cancelled) return

      const page = await doc.getPage(index + 1)
      if (cancelled) return

      const natural = page.getViewport({ scale: 1 })
      const fit = Math.min(size.width / natural.width, size.height / natural.height)
      // Draw at device pixels, display at CSS pixels: sharp instead of a blurry stretch.
      const viewport = page.getViewport({ scale: fit * dpr })
      const canvas = canvasRef.current
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

      task = page.render({ canvas, viewport })
      taskRef.current = task
      try {
        await task.promise
      } catch (err) {
        // Cancelled on purpose, or the doc was closed because a new PDF replaced it.
        const expected = err instanceof pdfjsLib.RenderingCancelledException || doc.loadingTask.destroyed
        if (!expected) console.error('[slides] failed to render page', index, err)
      } finally {
        if (taskRef.current === task) taskRef.current = null
      }
    }

    draw().catch((err) => {
      if (!cancelled && !doc.loadingTask.destroyed) console.error('[slides] failed to load page', index, err)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, index, size, dpr])

  return (
    <div className="slide-canvas" ref={boxRef}>
      <canvas className="slide-canvas__page" ref={canvasRef} role="img" aria-label={`Page ${index + 1}`} />
    </div>
  )
}
