import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Quiet focus nudges: after a stretch with no interaction (switching slides,
 * typing a note, flagging), the focus buddy shows one short prompt. It stays until
 * the student does something, then the clock starts over, so it never repeats on
 * a loop. Pure frontend logic: no AI calls.
 *
 * Students can turn nudges off or change the wait; the choice is kept in
 * localStorage for every lecture.
 */
export const NUDGE_MESSAGES = [
  'Still with us? Write one thing you just heard.',
  'Quick one: jot down a keyword from the last few minutes.',
  'Lost the thread? Tap ? to flag it, or ask me to catch you up.',
  "What's the main idea on this slide? One line is enough.",
]

export const NUDGE_MINUTES = [2, 5, 10, 15]

const SETTINGS_KEY = 'lockin.nudges'
const DEFAULT_SETTINGS = { enabled: true, minutes: 5 }
const CHECK_EVERY_MS = 10_000

export function useFocusNudge({ active }) {
  const [settings, setSettingsState] = useState(readSettings)
  const [message, setMessage] = useState(null)
  const lastActive = useRef(0)
  const nextMessage = useRef(0)
  const showing = useRef(false)

  const running = active && settings.enabled

  useEffect(() => {
    if (!running) return undefined
    // Start counting from when the deck opened (or nudges were switched on).
    lastActive.current = Date.now()
    showing.current = false
    const waitMs = settings.minutes * 60_000
    const timer = window.setInterval(() => {
      if (showing.current || Date.now() - lastActive.current < waitMs) return
      showing.current = true
      setMessage(NUDGE_MESSAGES[nextMessage.current % NUDGE_MESSAGES.length])
      nextMessage.current += 1
    }, CHECK_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [running, settings.minutes])

  /** Any real interaction: restart the quiet period and clear a showing nudge. */
  const markActive = useCallback(() => {
    lastActive.current = Date.now()
    showing.current = false
    setMessage(null)
  }, [])

  const setSettings = (patch) => {
    setSettingsState((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: keep the choice for this visit only
      }
      return next
    })
    showing.current = false
    setMessage(null)
  }

  return {
    message: running ? message : null,
    enabled: settings.enabled,
    minutes: settings.minutes,
    setSettings,
    markActive,
    dismiss: markActive,
  }
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
    if (!saved) return DEFAULT_SETTINGS
    return {
      enabled: saved.enabled !== false,
      minutes: NUDGE_MINUTES.includes(saved.minutes) ? saved.minutes : DEFAULT_SETTINGS.minutes,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}
