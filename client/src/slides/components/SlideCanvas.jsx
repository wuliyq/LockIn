import { useEffect, useRef, useState } from 'react'
import { pdfjsLib } from '../pdf/pdfSetup'
import './SlideCanvas.css'

/**
 * Draws one PDF page sharply inside its container. The transparent layer above it
 * lets students drag across an area they want to revisit, without modifying the PDF.
 *
 * Highlights may not overlap: a drag that runs into a flagged highlight shows as
 * blocked and is dropped on release. (Unflagged highlights are the one being
 * chosen right now, which a new drag replaces, so they don't block.)
 */
export default function SlideCanvas({ doc, index, highlights = [], onHighlight }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  const taskRef = useRef(null)
  const dragRef = useRef(null)
  const [size, setSize] = useState(null)
  const [pageSize, setPageSize] = useState(null)
  const [draft, setDraft] = useState(null)
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef(null)
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)

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
      setSize((previous) => (previous?.width === width && previous?.height === height ? previous : { width, height }))
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !size || size.width === 0 || size.height === 0) return undefined
    let cancelled = false
    let task = null

    async function draw() {
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
      const viewport = page.getViewport({ scale: fit * dpr })
      const canvas = canvasRef.current
      const cssWidth = Math.floor(viewport.width / dpr)
      const cssHeight = Math.floor(viewport.height / dpr)
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      setPageSize({ width: cssWidth, height: cssHeight })

      task = page.render({ canvas, viewport })
      taskRef.current = task
      try {
        await task.promise
      } catch (error) {
        const expected = error instanceof pdfjsLib.RenderingCancelledException || doc.loadingTask.destroyed
        if (!expected) console.error('[slides] failed to render page', index, error)
      } finally {
        if (taskRef.current === task) taskRef.current = null
      }
    }

    draw().catch((error) => {
      if (!cancelled && !doc.loadingTask.destroyed) console.error('[slides] failed to load page', index, error)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, index, size, dpr])

  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  const blocking = highlights.filter((highlight) => highlight.flagType)
  const overlapsExisting = (rect) => blocking.some((highlight) => overlaps(rect, highlight.rect))

  const showNotice = (text) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500)
  }

  const normalisePoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  const rectangleFrom = (start, end) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  })

  const startHighlight = (event) => {
    if (event.button !== 0) return
    const point = normalisePoint(event)
    dragRef.current = point
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const moveHighlight = (event) => {
    if (!dragRef.current) return
    setDraft(rectangleFrom(dragRef.current, normalisePoint(event)))
  }

  const finishHighlight = (event) => {
    if (!dragRef.current) return
    const rect = rectangleFrom(dragRef.current, normalisePoint(event))
    dragRef.current = null
    setDraft(null)
    if (rect.width <= 0.03 || rect.height <= 0.03) return
    if (overlapsExisting(rect)) {
      showNotice('Highlights can’t overlap. Drag across a part of the slide that isn’t highlighted yet.')
      return
    }
    onHighlight?.(rect)
  }

  return (
    <div className="slide-canvas" ref={boxRef}>
      <div
        className="slide-canvas__page-wrap"
        style={pageSize ?? undefined}
      >
        <canvas className="slide-canvas__page" ref={canvasRef} role="img" aria-label={`Page ${index + 1}`} />
        {pageSize && (
          <div
            className="slide-canvas__overlay"
            onPointerDown={startHighlight}
            onPointerMove={moveHighlight}
            onPointerUp={finishHighlight}
            onPointerCancel={finishHighlight}
            aria-label="Drag across a part of the slide to highlight it"
          >
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className={`slide-canvas__highlight ${highlight.flagType ? 'is-flagged' : ''}`}
                style={{ ...toStyle(highlight.rect), ...(highlight.color && { '--type-color': highlight.color }) }}
                title={highlight.flagType ? `Flagged: ${highlight.label ?? highlight.flagType}` : 'Slide highlight'}
              />
            ))}
            {draft && (
              <div
                className={`slide-canvas__highlight is-draft ${overlapsExisting(draft) ? 'is-blocked' : ''}`}
                style={toStyle(draft)}
              />
            )}
          </div>
        )}
        {notice && <p className="slide-canvas__notice" role="status">{notice}</p>}
      </div>
    </div>
  )
}

/** Do two highlight rectangles share any area? Touching edges is fine. */
const overlaps = (a, b) => (
  a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height
)

const toStyle = (rect) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
})
