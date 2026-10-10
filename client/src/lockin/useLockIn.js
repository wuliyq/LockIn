import { useEffect, useRef, useState } from 'react'

/**
 * Workspace state for the lecture view: the uploaded deck (a DeckContext from
 * SlidePanel), the current slide, per-slide notes, confusion flags, the live
 * transcript and the helper's answers.
 *
 * The app owns the slide index and passes it to <SlidePanel index={current}>
 * (controlled mode), so the panel and the notes editor can never disagree.
 *
 * Notes and flags persist in localStorage, keyed by the deck's filename, so
 * re-uploading the same PDF brings them back.
 */

export const AI_LABELS = {
  catchup: 'Catch me up',
  example: 'Give an example',
  check: 'Quick check',
  why: 'Why it matters',
}

export function useLockIn() {
  const [deck, setDeck] = useState(null) // DeckContext | null (null while a new PDF is read)
  const [reading, setReading] = useState(false) // a new PDF is open but its text isn't ready yet
  const [current, setCurrent] = useState(0) // 0-based; SlidePanel shows this page
  const [notesByDeck, setNotesByDeck] = useStored('lockin.notes', {}) // { [filename]: { [index]: text } }
  const [confusions, setConfusions] = useStored('lockin.confusions', []) // [{ id, filename, slide, text }]
  const [savedAt, setSavedAt] = useState('')
  const [ai, setAi] = useState(null) // { kind, text, slide } | null
  const [aiLoading, setAiLoading] = useState(false)
  const transcript = useTranscript()

  const deckKey = deck?.filename ?? ''
  const slideText = deck?.slides[current]?.text ?? ''
  const title = slideText.split('\n', 1)[0].trim()
  const note = notesByDeck[deckKey]?.[current] ?? ''

  // SlidePanel callbacks. A new upload calls onDeckReady(null) and onSlideChange(0)
  // as soon as it opens, then onDeckReady(deck) once its text has been read.
  const onDeckReady = (nextDeck) => {
    setDeck(nextDeck)
    setReading(nextDeck === null)
    setAi(null)
  }
  const onSlideChange = (index) => setCurrent(index)

  const setNote = (text) => {
    setNotesByDeck((all) => ({ ...all, [deckKey]: { ...all[deckKey], [current]: text } }))
    setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }

  const insertLine = (line) => setNote((note ? note + '\n' : '') + line)

  const markConfusing = (text) => {
    const selected = window.getSelection()?.toString().trim() ?? ''
    setConfusions((list) => [
      ...list,
      {
        id: crypto.randomUUID(),
        filename: deckKey,
        slide: current,
        text: text.trim() || selected || title || `Slide ${current + 1}`,
      },
    ])
  }

  // Placeholder answers until the helper is wired to the server's Gemini API.
  const askTimer = useRef(null)
  useEffect(() => () => clearTimeout(askTimer.current), [])
  const ask = (kind) => {
    if (!deck) return
    const slide = current
    setAiLoading(true)
    clearTimeout(askTimer.current)
    askTimer.current = setTimeout(() => {
      setAi({ kind, slide, text: placeholderAnswer(kind, slideText, slide, note) })
      setAiLoading(false)
    }, 600)
  }

  return {
    deck,
    reading,
    current,
    title,
    slideText,
    onDeckReady,
    onSlideChange,
    note,
    setNote,
    insertLine,
    savedAt,
    confusions: confusions.filter((c) => c.filename === deckKey),
    markConfusing,
    ai,
    aiLoading,
    ask,
    ...transcript,
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

function placeholderAnswer(kind, slideText, index, note) {
  const lines = slideText
    .split('\n')
    .map((line) => line.replace(/^[•●▪◦\-–*]\s*/, '').trim())
    .filter(Boolean)
  const [title = `Slide ${index + 1}`, ...rest] = lines
  const points = rest.slice(0, 2).join('; ') || 'the main idea on this slide'
  const hint = note.trim()
    ? ` Your notes mention “${note.trim().split(/\s+/).slice(0, 6).join(' ')}…”.`
    : ''
  switch (kind) {
    case 'catchup':
      return `${title}: the key points are ${points}.${hint}`
    case 'example':
      return `Example for ${title}: think of a concrete case where ${points} would change the outcome.`
    case 'check':
      return `Quick check: in one sentence, how does “${rest[0] ?? title}” connect to ${title}?`
    case 'why':
      return `Why it matters: ${title} comes up again later; understanding ${points} makes the next slides easier to follow.`
    default:
      return ''
  }
}
