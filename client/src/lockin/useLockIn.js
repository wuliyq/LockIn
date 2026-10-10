import { useCallback, useEffect, useRef, useState } from 'react'
import { FLAG_TYPE_BY_ID, createFlag, formatFlagTime } from './flagTypes'

/**
 * Workspace state for the lecture view: the uploaded deck (a DeckContext from
 * SlidePanel), the current slide, per-slide notes, flags and the live transcript.
 *
 * The app owns the slide index and passes it to <SlidePanel index={current}>
 * (controlled mode), so the panel and the notes editor can never disagree.
 *
 * Notes and flags persist in localStorage, keyed by the deck's filename, so
 * re-uploading the same PDF brings them back. Sending flags to the server (for
 * the lecturer dashboard) comes next; records already use the server's field names.
 */
export function useLockIn() {
  const [deck, setDeck] = useState(null) // DeckContext | null (null while a new PDF is read)
  const [reading, setReading] = useState(false) // a new PDF is open but its text isn't ready yet
  const [current, setCurrent] = useState(0) // 0-based; SlidePanel shows this page
  const [notesByDeck, setNotesByDeck] = useStored('lockin.notes', {}) // { [filename]: { [index]: text } }
  const [savedAt, setSavedAt] = useState('')
  const transcript = useTranscript()

  const deckKey = deck?.filename ?? ''
  const slideText = deck?.slides[current]?.text ?? ''
  const title = slideText.split('\n', 1)[0].trim()
  const note = notesByDeck[deckKey]?.[current] ?? ''

  const flags = useFlags({ deckKey, current, enabled: Boolean(deck) })

  // SlidePanel callbacks. A new upload calls onDeckReady(null) and onSlideChange(0)
  // as soon as it opens, then onDeckReady(deck) once its text has been read.
  const onDeckReady = (nextDeck) => {
    setDeck(nextDeck)
    setReading(nextDeck === null)
    flags.cancelDraft() // a half-written flag belongs to the old deck
  }
  const onSlideChange = (index) => setCurrent(index)

  const setNote = (text) => {
    setNotesByDeck((all) => ({ ...all, [deckKey]: { ...all[deckKey], [current]: text } }))
    setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }

  const insertLine = (line) => setNote((note ? note + '\n' : '') + line)

  return {
    deck,
    reading,
    current,
    title,
    slideText,
    onDeckReady,
    onSlideChange,
    goToSlide: setCurrent, // SlidePanel clamps out-of-range indexes
    note,
    setNote,
    insertLine,
    savedAt,
    ...flags,
    ...transcript,
  }
}

/**
 * Flags for the current deck, the composer's draft, and the undo toast.
 *
 * A flag's timestamp and slide are captured the moment a flag button is pressed,
 * not when the student finishes typing their question, so the lecturer sees when
 * the confusion actually happened.
 */
function useFlags({ deckKey, current, enabled }) {
  const [allFlags, setAllFlags] = useStored('lockin.flags', []) // every deck's flags, oldest first
  const [draft, setDraft] = useState(null) // composer contents, or null when closed
  const [toast, setToast] = useState(null) // { id, message, undo? }

  const flags = allFlags.filter((f) => f.deck === deckKey).reverse() // newest first

  const showToast = (message, undo) => setToast({ id: crypto.randomUUID(), message, undo })
  const dismissToast = useCallback(() => setToast(null), []) // stable, so the toast timer isn't reset by re-renders

  const save = (flag) => {
    setAllFlags((list) => [...list, flag])
    const type = FLAG_TYPE_BY_ID[flag.flagType]
    showToast(`${type.quick ? 'Marked' : `${type.name} flag saved on`} slide ${flag.slideNumber} at ${formatFlagTime(flag.timestamp)}`, () =>
      setAllFlags((list) => list.filter((f) => f.id !== flag.id)),
    )
  }

  /**
   * Start a flag of `flagType` for the current slide, optionally about some
   * highlighted text. Quick flags save at once; others open the composer.
   */
  const startFlag = (flagType, { source = null, selectedText = '' } = {}) => {
    if (!enabled) return
    const moment = { deck: deckKey, slideNumber: current + 1, timestamp: new Date().toISOString() }
    if (FLAG_TYPE_BY_ID[flagType].quick) {
      save(createFlag({ ...moment, flagType, source, selectedText }))
      return
    }
    setDraft((open) =>
      // Already composing with no new highlight: just switch the type, keep the rest.
      open && !selectedText
        ? { ...open, flagType }
        : { ...moment, flagType, source, selectedText, studentComment: open?.studentComment ?? '' },
    )
  }

  const updateDraft = (patch) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const cancelDraft = () => setDraft(null)
  const saveDraft = () => {
    if (!draft) return
    save(createFlag(draft))
    setDraft(null)
  }

  const updateFlag = (id, patch) =>
    setAllFlags((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const deleteFlag = (id) => {
    const index = allFlags.findIndex((f) => f.id === id)
    if (index === -1) return
    const removed = allFlags[index]
    setAllFlags((list) => list.filter((f) => f.id !== id))
    showToast(`Flag on slide ${removed.slideNumber} deleted`, () =>
      setAllFlags((list) => {
        const next = [...list]
        next.splice(Math.min(index, next.length), 0, removed)
        return next
      }),
    )
  }

  return {
    flags,
    canFlag: enabled,
    startFlag,
    draft,
    updateDraft,
    cancelDraft,
    saveDraft,
    updateFlag,
    deleteFlag,
    toast,
    dismissToast,
  }
}

/** Live lecture transcript via the browser's Web Speech API (Chrome, Edge, Safari). */
function useTranscript() {
  const [listening, setListening] = useState(false)
  const [lines, setLines] = useState([])
  const recRef = useRef(null)

  useEffect(() => () => recRef.current?.stop(), [])

  const toggleListen = () => {
    if (listening) {
      recRef.current?.stop()
      setListening(false)
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setLines((t) => [...t, "(Live transcript isn't supported in this browser. Try Chrome.)"])
      return
    }
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e) => {
      const result = e.results[e.results.length - 1]
      setLines((t) => [...t.slice(-30), result[0].transcript.trim()])
    }
    rec.onend = () => setListening(false)
    rec.start()
    recRef.current = rec
    setListening(true)
  }

  return { listening, toggleListen, transcript: lines }
}

/** useState that survives reloads. Falls back to memory if storage is unavailable. */
function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Private mode or quota exceeded: keep working in memory.
    }
  }, [key, value])
  return [value, setValue]
}
