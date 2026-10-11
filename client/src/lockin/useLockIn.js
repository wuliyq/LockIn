import { useEffect, useRef, useState } from 'react'
import { ElevenLabsSTT } from './stt'
import { useCity } from '../city/useCity'

export const AI_LABELS = {
  catchup: 'Catch me up',
  example: 'Give an example',
  check: 'Quick check',
  why: 'Why it matters',
}

export const FLAG_TYPES = {
  confusing: {
    label: 'Confusing',
    prompt: 'Explain this in simpler language so I can keep following the lecture.',
  },
  example: {
    label: 'Real-world example',
    prompt: 'Give one short, concrete real-world example of this idea.',
  },
  worked_example: {
    label: 'Worked example',
    prompt: 'Show one short worked example, step by step.',
  },
  check_thinking: {
    label: 'Check my thinking',
    prompt: 'Check whether my thinking is on the right track and correct it briefly if needed.',
  },
}

export const CITY_CITIZENS = [
  { id: 'otter', emoji: '🦦', name: 'Ollie the Otter', district: 'Riverside' },
  { id: 'capybara', emoji: '🦫', name: 'Cappy the Capybara', district: 'Garden Quarter' },
  { id: 'fox', emoji: '🦊', name: 'Fenn the Fox', district: 'Library Lane' },
  { id: 'penguin', emoji: '🐧', name: 'Pip the Penguin', district: 'Harbour Walk' },
  { id: 'cat', emoji: '🐱', name: 'Miso the Cat', district: 'Sunset Square' },
]

const HELPER_PROMPTS = {
  example: 'Give one short, concrete example of this idea.',
  check: 'Give me one quick understanding check about this slide, with the answer hidden in your explanation.',
  why: 'Explain briefly why this idea matters or where I might use it.',
}

/**
 * Workspace state for the lecture view. Notes and local flag history persist
 * per PDF, while transcript segments and dashboard flags are sent to Express.
 */
export function useLockIn({ user, lectureApi }) {
  const storageKey = (name) => `lockin.user.${user.id}.${name}`
  const city = useCity(storageKey('city.v1'))
  const apiRequest = lectureApi.request
  const [deck, setDeck] = useState(null)
  const [reading, setReading] = useState(false)
  const [current, setCurrent] = useState(0)
  const [notesByDeck, setNotesByDeck] = useStored(storageKey('notes'), {})
  const [confusions, setConfusions] = useStored(storageKey('confusions'), [])
  const [highlightsByDeck, setHighlightsByDeck] = useStored(storageKey('slideHighlights'), {})
  const [savedAt, setSavedAt] = useState('')
  const [ai, setAi] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const sessionIdRef = useRef(null)
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStartedAt, setSessionStartedAt] = useState(null)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [citizenId, setCitizenId] = useStored(storageKey('cityCitizen'), CITY_CITIZENS[0].id)
  const [gameEnabled, setGameEnabled] = useStored(storageKey('gameEnabled'), false)
  const [profileName, setProfileName] = useStored(storageKey('profileName'), user.name)
  const [sessionStartXp, setSessionStartXp] = useState(city.xp)
  const [lastSession, setLastSession] = useState(null)
  const [catchUps, setCatchUps] = useState([])
  const [syncStatus, setSyncStatus] = useState('')
  const [syncError, setSyncError] = useState('')
  const saveQueue = useRef(Promise.resolve())
  const saveTimer = useRef(null)
  const endingRef = useRef(false)

  const transcriptState = useTranscript({ sessionIdRef, slideNumber: current + 1, apiRequest })
  const deckKey = deck?.filename ?? ''
  const notesKey = `${sessionId || 'draft'}:${deckKey}`
  const slideText = deck?.slides[current]?.text ?? ''
  const title = slideText.split('\n', 1)[0].trim()
  const note = notesByDeck[notesKey]?.[current] ?? ''
  const citizen = CITY_CITIZENS.find((entry) => entry.id === citizenId) ?? CITY_CITIZENS[0]

  // Serialize writes so a slow autosave cannot overwrite the finished lecture.
  const snapshot = () => ({ filename: deckKey, slides: deck?.slides || [], notes: notesByDeck[notesKey] || {},
    flags: confusions.filter((flag) => flag.sessionId === sessionId), catchUps,
    seconds: sessionStartedAt ? Math.floor((Date.now() - sessionStartedAt) / 1000) : 0 })
  const persist = (id, data, finish = false) => {
    setSyncStatus('Saving…')
    const work = saveQueue.current.catch(() => {}).then(() => lectureApi[finish ? 'finishLecture' : 'saveLecture'](id, data))
      .then(() => { setSyncStatus(user.preview ? 'Saved in preview' : 'Saved to your account'); setSyncError('') })
      .catch((error) => { setSyncError(error.message); setSyncStatus('Not synced'); throw error })
    saveQueue.current = work
    return work
  }

  useEffect(() => {
    if (!sessionActive || !sessionId || endingRef.current) return undefined
    const data = { filename: deck?.filename || '', slides: deck?.slides || [], notes: notesByDeck[`${sessionId}:${deck?.filename || ''}`] || {},
      flags: confusions.filter((flag) => flag.sessionId === sessionId), catchUps,
      seconds: Math.floor((Date.now() - sessionStartedAt) / 1000) }
    saveTimer.current = setTimeout(() => {
      setSyncStatus('Saving…')
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => lectureApi.saveLecture(sessionId, data))
        .then(() => { setSyncStatus(user.preview ? 'Saved in preview' : 'Saved to your account'); setSyncError('') })
        .catch((error) => { setSyncError(error.message); setSyncStatus('Not synced') })
    }, 700)
    return () => clearTimeout(saveTimer.current)
  }, [sessionActive, sessionId, sessionStartedAt, deck, notesByDeck, confusions, catchUps, lectureApi, user.preview])

  useEffect(() => {
    if (!sessionActive || !sessionStartedAt) return undefined
    const update = () => setSessionSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [sessionActive, sessionStartedAt])

  const onDeckReady = (nextDeck) => {
    setDeck(nextDeck)
    setReading(nextDeck === null)
    setAi(null)
    setAiError('')
    if (nextDeck && gameEnabled) city.reward('deck', nextDeck.filename, 0)
  }
  const onSlideChange = (index) => setCurrent(index)

  const setNote = (text) => {
    setNotesByDeck((all) => ({ ...all, [notesKey]: { ...all[notesKey], [current]: text } }))
    setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    if (gameEnabled && text.trim().split(/\s+/).filter(Boolean).length >= 20) city.reward('note', deckKey, current)
  }

  const insertLine = (line) => setNote((note ? `${note}\n` : '') + line)

  const startSession = async (options) => {
    if (sessionActive) return
    const { lecture } = await lectureApi.createLecture(options || {})
    sessionIdRef.current = lecture.id
    setSessionId(lecture.id)
    endingRef.current = false
    setCatchUps([])
    setSyncError('')
    setDeck(null)
    setCurrent(0)
    setAi(null)
    setAiError('')
    setSessionSeconds(0)
    setLastSession(null)
    setSessionStartXp(city.xp)
    transcriptState.clearTranscript()
    setSessionActive(true)
    setSessionStartedAt(Date.now())
  }

  const endSession = async () => {
    if (transcriptState.transcriptStatus === 'connecting') return
    endingRef.current = true
    clearTimeout(saveTimer.current)
    try {
      await transcriptState.stopListen()
      await persist(sessionId, snapshot(), true)
    } catch (error) { endingRef.current = false; throw error }
    setLastSession({
      seconds: sessionSeconds,
      notePages: Object.values(notesByDeck[notesKey] ?? {}).filter((text) => text.trim()).length,
      flags: confusions.filter((flag) => flag.filename === deckKey && new Date(flag.createdAt).getTime() >= sessionStartedAt).length,
      earned: gameEnabled ? Math.max(0, city.xp - sessionStartXp) : 0,
    })
    setSessionActive(false)
    setSessionStartedAt(null)
  }

  const createSlideHighlight = (rect) => {
    if (!deck) return null
    const highlight = {
      id: crypto.randomUUID(),
      sessionId,
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

  const getLectureContext = () => ({
    slideText: slideText || title || 'No extracted slide text is available.',
    notesExcerpt: note.slice(-2000),
    transcriptExcerpt: transcriptState.transcript.slice(-4).join(' ').slice(-4000),
  })

  const ask = async (kind) => {
    if (!deck || aiLoading) return

    setAiLoading(true)
    setAiError('')
    const slide = current

    try {
      if (kind === 'catchup') {
        const recentTranscript = transcriptState.transcript.slice(-4).join(' ').trim()
        if (!recentTranscript) {
          throw new Error('Start the live transcript first, then LockIN can catch you up.')
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
        setAi({ kind, slide, text: data.summary.join('\n') })
        setCatchUps((items) => [...items, { id: crypto.randomUUID(), timestamp: new Date().toISOString(), slide, summary: data.summary }])
        if (gameEnabled) city.reward('catchup', deckKey, slide)
      } else {
        const data = await apiRequest('/api/confusion', {
          method: 'POST',
          body: {
            selectedText: title || slideText.slice(0, 500) || `Slide ${current + 1}`,
            question: HELPER_PROMPTS[kind],
            ...getLectureContext(),
          },
        })
        setAi({ kind, slide, text: data.answer })
      }
    } catch (error) {
      setAiError(error.message)
    } finally {
      setAiLoading(false)
    }
  }

  /** Save a student flag for the lecturer, then show the student a concise answer. */
  const submitFlag = async (studentComment, flagType, selection = {}) => {
    if (!deck || aiLoading) {
      if (!deck) setAiError('Upload slides before asking LockIN about the lecture.')
      return false
    }

    const type = FLAG_TYPES[flagType] ?? FLAG_TYPES.confusing
    const selectedText = selection.selectedText?.trim()
      || window.getSelection()?.toString().trim()
      || title
      || slideText.slice(0, 500)
      || `Slide ${current + 1}`
    const question = studentComment.trim()
      ? `${type.prompt}\nStudent's note: ${studentComment.trim()}`
      : type.prompt
    const localFlag = {
      id: crypto.randomUUID(),
      sessionId,
      filename: deckKey,
      slide: current,
      flagType,
      text: studentComment.trim() || selectedText,
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
        body: { selectedText, question, ...getLectureContext() },
      })
      answer = data.answer
      setAi({ kind: flagType, label: type.label, slide: current, text: answer })
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
          flagType,
          selectedText,
          studentComment: studentComment.trim(),
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
    if (gameEnabled) city.reward('flag', deckKey, current)
    if (selection.highlightId) {
      setHighlightsByDeck((all) => ({
        ...all,
        [deckKey]: (all[deckKey] ?? []).map((highlight) => (
          highlight.id === selection.highlightId ? { ...highlight, flagType } : highlight
        )),
      }))
    }
    if (answerError) setAiError(`Your flag was sent to the lecturer. LockIN could not answer right now: ${answerError}`)
    return true
  }

  return {
    syncStatus,
    syncError,
    city,
    gameEnabled,
    setGameEnabled,
    profileName,
    setProfileName,
    lastSession,
    endSession,
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
    confusions: confusions.filter((flag) => flag.sessionId === sessionId && flag.filename === deckKey),
    slideHighlights: (highlightsByDeck[deckKey] ?? []).filter((highlight) => highlight.sessionId === sessionId && highlight.slide === current),
    createSlideHighlight,
    submitFlag,
    ai,
    aiLoading,
    aiError,
    ask,
    sessionId,
    sessionActive,
    startSession,
    sessionSeconds,
    citizen,
    setCitizenId,
    ...transcriptState,
  }
}

/** Real-time ElevenLabs Scribe transcript, grouped into slide-linked segments. */
function useTranscript({ sessionIdRef, slideNumber, apiRequest }) {
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
        body: { sessionId: sessionIdRef.current, ...segment },
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

  const stopListen = async () => {
    sttRef.current?.flush()
    await sttRef.current?.stop()
  }

  return {
    listening: status === 'recording',
    transcriptStatus: status,
    transcriptError,
    toggleListen,
    stopListen,
    clearTranscript: () => { setSavedSegments([]); setLiveText('') },
    transcript,
  }
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
