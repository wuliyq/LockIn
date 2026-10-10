import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FLAG_TYPES } from './flagTypes'
import { FlagTypeIcon } from './Flags'

/**
 * A small toolbar that pops up over highlighted text so the student can flag it in
 * one move. Works on any element marked with data-flag-source="notes|slide|transcript":
 * a <textarea> (selection read from selectionStart/End) or ordinary text (DOM selection).
 */
export default function SelectionFlagger({ li }) {
  const [pick, setPick] = useState(null) // { text, source, x, y } or null
  const popupRef = useRef(null)
  const lastPointer = useRef(null) // where the mouse was released, for textarea selections
  const enabled = li.canFlag

  useEffect(() => {
    if (!enabled) return

    const insidePopup = (target) => popupRef.current?.contains(target)

    function evaluate() {
      const found = readSelection(lastPointer.current)
      setPick(found)
    }

    function onMouseUp(e) {
      if (insidePopup(e.target)) return
      lastPointer.current = { x: e.clientX, y: e.clientY }
      // Let the browser finish updating the selection first.
      setTimeout(evaluate, 0)
    }

    function onKeyUp(e) {
      if (insidePopup(e.target)) return
      // Selections made with Shift + arrows (or select-all) show the popup too.
      if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key === 'a')) {
        lastPointer.current = null
        evaluate()
      } else {
        setPick(null)
      }
    }

    function onMouseDown(e) {
      if (!insidePopup(e.target)) setPick(null)
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') setPick(null)
    }

    const hide = () => setPick(null)

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [enabled])

  // Keep the whole toolbar on screen: measure it once rendered and nudge it sideways.
  useLayoutEffect(() => {
    const el = popupRef.current
    if (!el) return
    el.style.marginLeft = '0px'
    const rect = el.getBoundingClientRect()
    const margin = 8
    if (rect.left < margin) el.style.marginLeft = `${margin - rect.left}px`
    else if (rect.right > window.innerWidth - margin) el.style.marginLeft = `${window.innerWidth - margin - rect.right}px`
  }, [pick])

  if (!enabled || !pick) return null

  // Show it below the selection if there's no room above.
  const below = pick.y < 64

  function choose(flagType) {
    li.startFlag(flagType, { source: pick.source, selectedText: pick.text })
    setPick(null)
    // Clear the highlight so the toolbar doesn't come straight back.
    if (pick.source !== 'notes') window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      ref={popupRef}
      className={`selection-flagger ${below ? 'is-below' : ''}`}
      style={{ left: pick.x, top: below ? pick.bottom + 8 : pick.y - 8 }}
      role="toolbar"
      aria-label="Flag the highlighted text"
      // Don't let clicks here clear the student's highlight.
      onMouseDown={(e) => e.preventDefault()}
    >
      {FLAG_TYPES.map((type) => (
        <button
          key={type.id}
          type="button"
          className={`selection-flagger__btn flag-type--${type.id}`}
          title={type.description}
          aria-label={type.quick ? `${type.name}: ${type.description}` : type.name}
          onClick={() => choose(type.id)}
        >
          {type.quick ? (
            <span className="flag-btn__q" aria-hidden="true">
              ?
            </span>
          ) : (
            <>
              <FlagTypeIcon type={type.id} /> <span>{type.label}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * What's highlighted inside a flaggable area, and where to put the toolbar.
 * @returns {{ text: string, source: string, x: number, y: number, bottom: number } | null}
 */
function readSelection(pointer) {
  const active = document.activeElement

  // Textareas keep their own selection, separate from the page's.
  if (active?.matches?.('textarea[data-flag-source]')) {
    const text = active.value.slice(active.selectionStart, active.selectionEnd).trim()
    if (!text) return null
    const box = active.getBoundingClientRect()
    const x = pointer?.x ?? box.left + box.width / 2
    const y = pointer?.y ?? box.top + 24
    return { text, source: active.dataset.flagSource, x, y, bottom: y + 16 }
  }

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const area = flagArea(selection.anchorNode)
  if (!area || area !== flagArea(selection.focusNode)) return null
  const text = selection.toString().trim()
  if (!text) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return { text, source: area.dataset.flagSource, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom }
}

function flagArea(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return el?.closest('[data-flag-source]') ?? null
}
