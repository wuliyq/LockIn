import { useEffect, useRef, useState } from 'react'
import { ElevenLabsSTT } from './stt'
import { useFocusNudge } from './useFocusNudge'

/**
 * The Vite app and Express server run on different ports in development.
 * Set VITE_API_URL when deploying; otherwise use the local Express server.
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')

/**
 * The ways to flag something, in the order the focus buddy and the highlight
 * pop-up show them. Each one is sent to the lecturer (anonymously) and gets a short
 * AI answer. The highlighted text is what the flag is about; with nothing
 * highlighted, the flag is about the current slide. "Catch me up" instead
 * summarises the last stretch of the recorded lecture.
 */
export const FLAG_TYPES = {
  catch_up: {
    label: 'Catch me up',
  },
  example: {
    label: 'Give an example',
    prompt: 'Give one short, concrete example of this idea.',
  },
  why_it_matters: {
    label: 'Why it matters',
    prompt: 'Explain briefly why this idea matters or where I might use it.',
  },
  confusing: {
    label: 'Confusing',
    prompt: 'Explain this in simpler language so I can keep following the lecture.',
  },
  check_thinking: {
    label: 'Check my thinking',
    prompt: 'The highlighted text is my own understanding. Check whether it is on the right track and correct it briefly if needed.',
    slidePrompt: 'Check whether my notes on this slide are on the right track and correct them briefly if needed.',
  },
}

// Older flag ids, so flags saved before these types changed still read sensibly.
const LEGACY_FLAG_TYPES = { question: 'confusing', worked_example: 'example', real_world: 'example' }

/** The current id for any stored flagType (old ids map to their new name). */
export const flagTypeId = (flagType) => LEGACY_FLAG_TYPES[flagType] ?? flagType

/** A flag type's color (the --flag-type-* tokens in index.css, shared with the lecturer view). */
export const flagColor = (flagType) => {
  const id = flagTypeId(flagType)
  return `var(--flag-type-${FLAG_TYPES[id] ? id : 'other'})`
}

/**
 * Workspace state for the lecture view. Notes and local flag history persist
 * per PDF, while transcript segments and dashboard flags are sent to Express.
 *
 * `storageScope` keeps one lecture's notes, flags and catch-ups apart from every
 * other lecture's (the lecture home page starts each lecture with its own scope).
 * Without it, the workspace keeps the shared per-PDF storage it always had.
 */
export function useLockIn({ storageScope = null } = {}) {
  const stored = (name) => lectureStorageKey(storageScope, name)
  const [deck, setDeck] = useState(null)
  const [reading, setReading] = useState(false)
  const [current, setCurrent] = useState(0)
  const [notesByDeck, setNotesByDeck] = useStored(stored('notes'), {})
  const [confusions, setConfusions] = useStored(stored('confusions'), [])
  const [highlightsByDeck, setHighlightsByDeck] = useStored(stored('slideHighlights'), {})
  const [savedAt, setSavedAt] = useState('')
  const [ai, setAi] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const sessionId = useSessionId()
  const [sessionActive, setSessionActive] = useStored(stored('sessionActive'), false)
  const [sessionStartedAt, setSessionStartedAt] = useStored(stored('sessionStartedAt'), null)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [catchUps, setCatchUps] = useStored(stored('catchUps'), [])

  const transcriptState = useTranscript({ sessionId, slideNumber: current + 1 })
  const nudge = useFocusNudge({ active: Boolean(deck) })
  const { markActive } = nudge
  const deckKey = deck?.filename ?? ''
  const slideText = deck?.slides[current]?.text ?? ''
  const title = slideText.split('\n', 1)[0].trim()
  const note = notesByDeck[deckKey]?.[current] ?? ''

  useEffect(() => {
    if (!sessionActive || !sessionStartedAt) return undefined
    const update = () => setSessionSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [sessionActive, sessionStartedAt])

  const onDeckReady = (nextDeck) => {
    markActive()
    setDeck(nextDeck)
    setReading(nextDeck === null)
    setAi(null)
    setAiError('')
  }
  const onSlideChange = (index) => {
    markActive()
    setCurrent(index)
  }

  const setNote = (text) => {
    markActive()
    setNotesByDeck((all) => ({ ...all, [deckKey]: { ...all[deckKey], [current]: text } }))
    setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }

  const insertLine = (line) => setNote((note ? `${note}\n` : '') + line)

  const startSession = () => {
    setSessionActive(true)
    setSessionStartedAt(Date.now())
  }

  const createSlideHighlight = (rect) => {
    if (!deck) return null
    const highlight = {
      id: crypto.randomUUID(),
      filename: deckKey,
      slide: current,
      rect,
      createdAt: new Date().toISOString(),
      flagType: null,
    }
    setHighlightsByDeck((all) => ({
      ...all,
      [deckKey]: [...(all[deckKey] ?? []), highlight],
    }))
    return highlight
  }

  /** Drop a slide highlight that was never flagged (the student cleared it or moved on). */
  const removeSlideHighlight = (id) => {
    setHighlightsByDeck((all) => ({
      ...all,
      [deckKey]: (all[deckKey] ?? []).filter((highlight) => highlight.id !== id || highlight.flagType),
    }))
  }

  const getLectureContext = () => ({
    slideText: slideText || title || 'No extracted slide text is available.',
    notesExcerpt: note.slice(-2000),
    transcriptExcerpt: transcriptState.transcript.slice(-4).join(' ').slice(-4000),
  })

  /**
   * "Catch me up": a short summary of the most recently recorded part of the lecture.
   * It is always based on the recording, never on highlighted text. It is kept with
   * the lecture's catch-ups and also sent to the lecturer as a flag, since it marks
   * a moment the student lost the thread.
   */
  const catchUp = async () => {
    setAiLoading(true)
    setAiError('')
    const slide = current

    try {
      const recentTranscript = transcriptState.transcript.slice(-4).join(' ').trim()
      if (!recentTranscript) {
        throw new Error('Start recording below the slides first, then LockIN can catch you up.')
      }

      const data = await apiRequest('/api/catch-up', {
        method: 'POST',
        body: {
          sessionId,
          slideNumber: current + 1,
          recentTranscript,
          slideText,
        },
      })
      const text = data.summary.join('\n')
      const createdAt = new Date().toISOString()
      setAi({ kind: 'catch_up', label: FLAG_TYPES.catch_up.label, slide, text })
      setCatchUps((items) => [...items, { id: crypto.randomUUID(), timestamp: createdAt, slide, summary: data.summary }])
      setConfusions((list) => [...list, {
        id: crypto.randomUUID(),
        filename: deckKey,
        slide,
        flagType: 'catch_up',
        text: `Caught up on slide ${slide + 1}`,
        selectedText: '',
        studentComment: '',
        aiAnswer: text,
        source: 'transcript',
        highlightId: null,
        createdAt,
      }])

      try {
        await apiRequest('/api/flags', {
          method: 'POST',
          body: {
            sessionId,
            slideNumber: slide + 1,
            flagType: 'catch_up',
            selectedText: '',
            studentComment: '',
            aiAnswer: text,
            source: 'transcript',
          },
        })
      } catch (error) {
        setAiError(`Your catch-up was kept in this browser, but was not sent to the lecturer: ${error.message}`)
      }
      return true
    } catch (error) {
      setAiError(error.message)
      return false
    } finally {
      setAiLoading(false)
    }
  }

  /** Save a student flag for the lecturer, then show the student a concise answer. */
  const submitFlag = async (flagType, selection = {}) => {
    if (!deck || aiLoading) {
      if (!deck) setAiError('Upload slides before asking LockIN about the lecture.')
      return false
    }

    markActive()
    if (flagType === 'catch_up') return catchUp()
    const id = FLAG_TYPES[flagType] ? flagType : flagTypeId(flagType)
    const type = FLAG_TYPES[id] ?? FLAG_TYPES.confusing
    // The highlighted text is the query. A dragged slide area has no text of its own,
    // so the slide's text stands in for it.
    const highlighted = selection.selectedText?.trim() ?? ''
    const isSlideArea = Boolean(selection.highlightId)
    const queryText = (!isSlideArea && highlighted)
      || title
      || slideText.slice(0, 500)
      || `Slide ${current + 1}`
    const question = !highlighted || isSlideArea ? (type.slidePrompt ?? type.prompt) : type.prompt
    const localFlag = {
      id: crypto.randomUUID(),
      filename: deckKey,
      slide: current,
      flagType: id,
      text: (!isSlideArea && highlighted) || (isSlideArea ? highlighted : `About slide ${current + 1}`),
      selectedText: highlighted,
      studentComment: '',
      source: selection.source ?? 'slide',
      highlightId: selection.highlightId ?? null,
      createdAt: new Date().toISOString(),
    }

    setConfusions((list) => [...list, localFlag])
    setAiLoading(true)
    setAiError('')

    let answer = ''
    let answerError = ''
    try {
      const data = await apiRequest('/api/confusion', {
        method: 'POST',
        body: { selectedText: queryText, question, ...getLectureContext() },
      })
      answer = data.answer
      setAi({ kind: id, label: type.label, slide: current, text: answer })
      setConfusions((list) => list.map((flag) => (
        flag.id === localFlag.id ? { ...flag, aiAnswer: answer } : flag
      )))
    } catch (error) {
      answerError = error.message
    }

    try {
      await apiRequest('/api/flags', {
        method: 'POST',
        body: {
          sessionId,
          slideNumber: current + 1,
          flagType: id,
          selectedText: highlighted,
          studentComment: '',
          aiAnswer: answer,
          source: selection.source ?? 'slide',
        },
      })
    } catch (error) {
      setAiError(`Your flag was kept in this browser, but was not sent to the lecturer: ${error.message}`)
      setAiLoading(false)
      return false
    }

    setAiLoading(false)
    if (selection.highlightId) {
      setHighlightsByDeck((all) => ({
        ...all,
        [deckKey]: (all[deckKey] ?? []).map((highlight) => (
          highlight.id === selection.highlightId ? { ...highlight, flagType: id } : highlight
        )),
      }))
    }
    if (answerError) setAiError(`Your flag was sent to the lecturer. LockIN could not answer right now: ${answerError}`)
    return true
  }

  /**
   * Everything worth keeping from this lecture, in the account API's LectureSnapshot
   * shape (see docs/account-api-contract.md): zero-based slides and note keys.
   */
  const lectureSnapshot = () => {
    const deckFlags = confusions.filter((flag) => flag.filename === deckKey)
    return {
      title: lectureTitle(deck),
      filename: deckKey,
      seconds: sessionStartedAt ? Math.floor((Date.now() - sessionStartedAt) / 1000) : 0,
      slides: deck?.slides ?? [],
      notes: Object.fromEntries(Object.entries(notesByDeck[deckKey] ?? {}).filter(([, text]) => text?.trim())),
      flags: deckFlags.map((flag) => ({ ...flag, sessionId })),
      catchUps,
    }
  }

  return {
    lectureSnapshot,
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
    confusions: confusions.filter((flag) => flag.filename === deckKey),
    slideHighlights: (highlightsByDeck[deckKey] ?? []).filter((highlight) => highlight.slide === current),
    createSlideHighlight,
    removeSlideHighlight,
    submitFlag,
    nudge,
    ai,
    aiLoading,
    aiError,
    sessionId,
    sessionActive,
    startSession,
    sessionSeconds,
    ...transcriptState,
  }
}

/** Real-time ElevenLabs Scribe transcript, grouped into slide-linked segments. */
function useTranscript({ sessionId, slideNumber }) {
  const [status, setStatus] = useState('idle')
  const [savedSegments, setSavedSegments] = useState([])
  const [liveText, setLiveText] = useState('')
  const [transcriptError, setTranscriptError] = useState('')
  const sttRef = useRef(null)
  const segmentSlideRef = useRef(slideNumber)
  const segmentStartedAtRef = useRef(null)

  const saveSegment = async (text, timestamp = Date.now()) => {
    const cleaned = text?.trim()
    if (!cleaned) return

    const segment = {
      slideNumber: segmentSlideRef.current,
      text: cleaned,
      startedAt: segmentStartedAtRef.current ?? new Date(timestamp).toISOString(),
      endedAt: new Date(timestamp).toISOString(),
    }
    setSavedSegments((items) => [...items.slice(-29), segment])
    setLiveText('')
    segmentStartedAtRef.current = new Date(timestamp).toISOString()

    try {
      await apiRequest('/api/transcript', {
        method: 'POST',
        body: { sessionId, ...segment },
      })
    } catch (error) {
      setTranscriptError(`Recording is running, but this transcript segment was not saved for catch-up: ${error.message}`)
    }
  }

  // When the student moves to a new slide, close the old slide's transcript window.
  useEffect(() => {
    if (status === 'recording' && segmentSlideRef.current !== slideNumber) {
      sttRef.current?.flush()
      segmentSlideRef.current = slideNumber
      segmentStartedAtRef.current = new Date().toISOString()
    }
  }, [slideNumber, status])

  useEffect(() => () => {
    sttRef.current?.stop()
  }, [])

  const toggleListen = async () => {
    const recorder = sttRef.current
    if (status === 'recording') {
      recorder?.flush()
      await recorder?.stop()
      return
    }
    if (status === 'connecting') return

    setTranscriptError('')
    segmentSlideRef.current = slideNumber
    segmentStartedAtRef.current = new Date().toISOString()

    const nextRecorder = new ElevenLabsSTT({
      autoFlushMs: 30_000,
      getToken: async () => {
        const data = await apiRequest('/api/stt-token', { method: 'POST' })
        return data.token
      },
      onTranscript: ({ fullText }) => setLiveText(fullText),
      onFlush: ({ flushedText, timestamp }) => saveSegment(flushedText, timestamp),
      onStatusChange: (nextStatus) => setStatus(nextStatus),
      onError: (error) => setTranscriptError(error.message),
    })
    sttRef.current = nextRecorder

    try {
      await nextRecorder.start()
    } catch (error) {
      setTranscriptError(error.message)
    }
  }

  const transcript = [
    ...savedSegments.map((segment) => segment.text),
    ...(liveText ? [liveText] : []),
  ]

  /** Stop recording if it's on, saving the last stretch of transcript first. */
  const stopListening = async () => {
    if (status !== 'recording') return
    sttRef.current?.flush()
    await sttRef.current?.stop()
  }

  return {
    stopListening,
    listening: status === 'recording',
    transcriptStatus: status,
    transcriptError,
    toggleListen,
    transcript,
  }
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`)
  }
  return payload
}

/**
 * Which lecture this student's flags and transcript belong to. A lecture code in
 * the link (?lecture=CSC422-L7, shared by the lecturer) puts the whole class in one
 * session so the lecturer dashboard can see everyone; without one, the browser
 * keeps its own private session.
 */
function useSessionId() {
  const [sessionId] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('lecture')?.trim()
    if (code) return code.toUpperCase()
    const key = 'lockin.sessionId'
    try {
      const existing = localStorage.getItem(key)
      if (existing) return existing
      const created = crypto.randomUUID()
      localStorage.setItem(key, created)
      return created
    } catch {
      return crypto.randomUUID()
    }
  })
  return sessionId
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

function lectureStorageKey(scope, name) {
  return scope ? `lockin.lecture.${scope}.${name}` : `lockin.${name}`
}

/** Forget a finished lecture's local copy once it's safely saved to the lecture history. */
export function clearLectureStorage(scope) {
  if (!scope) return
  for (const name of ['notes', 'confusions', 'slideHighlights', 'sessionActive', 'sessionStartedAt', 'catchUps']) {
    try {
      localStorage.removeItem(lectureStorageKey(scope, name))
    } catch {
      // storage unavailable: nothing was kept there anyway
    }
  }
}

/** A readable lecture title: the deck's first line of text, else its filename, else a fallback. */
function lectureTitle(deck) {
  const firstLine = deck?.slides.find((slide) => slide.text?.trim())?.text.split('\n', 1)[0].trim()
  const fromFile = deck?.filename?.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim()
  return (firstLine || fromFile || 'Untitled lecture').slice(0, 120)
}
