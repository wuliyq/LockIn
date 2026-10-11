import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FLAG_TYPES, flagColor } from './useLockIn'

/**
 * Shows the flag choices next to highlighted note text. Choosing one sends the flag
 * straight away: the highlighted text is what the student is asking about.
 */
export default function SelectionFlagger({ enabled, onPick }) {
  const [pick, setPick] = useState(null)
  const popupRef = useRef(null)
  const lastPointer = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined

    const evaluate = () => setPick(readSelection(lastPointer.current))
    const onMouseUp = (event) => {
      if (popupRef.current?.contains(event.target)) return
      lastPointer.current = { x: event.clientX, y: event.clientY }
      window.setTimeout(evaluate, 0)
    }
    const onKeyUp = (event) => {
      if (event.shiftKey || event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key === 'a')) {
        lastPointer.current = null
        evaluate()
      }
    }
    const hide = (event) => {
      if (!popupRef.current?.contains(event.target)) setPick(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPick(null)
    }
    const onScroll = () => setPick(null)
    const onResize = () => setPick(null)

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousedown', hide)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousedown', hide)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [enabled])

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    const rect = popup.getBoundingClientRect()
    const margin = 8
    if (rect.left < margin) popup.style.marginLeft = `${margin - rect.left}px`
    if (rect.right > window.innerWidth - margin) popup.style.marginLeft = `${window.innerWidth - margin - rect.right}px`
  }, [pick])

  if (!enabled || !pick) return null

  const entries = Object.entries(FLAG_TYPES)
  return (
    <div
      ref={popupRef}
      className="selection-flagger"
      style={{ left: pick.x, top: pick.y }}
      role="toolbar"
      aria-label="Flag the highlighted note"
      onMouseDown={(event) => event.preventDefault()}
    >
      {entries.map(([flagType, type]) => (
        <button
          key={flagType}
          type="button"
          title={type.label}
          style={{ '--type-color': flagColor(flagType) }}
          onClick={() => {
            onPick(flagType, { source: pick.source, selectedText: pick.text })
            setPick(null)
          }}
        >
          <i className="flag-dot" aria-hidden="true" /> {type.label}
        </button>
      ))}
    </div>
  )
}

function readSelection(pointer) {
  const active = document.activeElement
  if (!active?.matches?.('textarea[data-flag-source]')) return null

  const text = active.value.slice(active.selectionStart, active.selectionEnd).trim()
  if (!text) return null
  const box = active.getBoundingClientRect()
  const x = pointer?.x ?? box.left + box.width / 2
  const y = pointer?.y ?? box.top + 30
  return { text, source: active.dataset.flagSource, x, y }
}
