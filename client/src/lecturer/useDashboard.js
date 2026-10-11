import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from './api'
import { anonymise, buildStats } from './stats'

const POLL_MS = 5000
const CODE_KEY = 'lockin.lecturer.code'
export const SAMPLE_CODE = 'SAMPLE-LECTURE'

/**
 * The lecture code students join with. Read from the link (?lecture=…), else the
 * last one used here, else a new one. Kept in the URL so the page can be bookmarked.
 */
export function useLectureCode() {
  const [code, setCodeState] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('lecture')?.trim()
    if (fromUrl) return fromUrl.toUpperCase()
    try {
      const saved = localStorage.getItem(CODE_KEY)
      if (saved) return saved
    } catch {
      // storage unavailable: fall through to a fresh code
    }
    return `LEC-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  })

  useEffect(() => {
    try {
      localStorage.setItem(CODE_KEY, code)
    } catch {
      // keep working without storage
    }
    const url = new URL(window.location.href)
    url.searchParams.set('lecture', code)
    window.history.replaceState(null, '', url)
  }, [code])

  const setCode = (next) => {
    const clean = next.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (clean) setCodeState(clean)
  }
  return [code, setCode]
}

/** Live flags for a lecture, anonymised, plus derived stats. Polls while the tab is visible. */
export function useDashboard(code, { slideCount = 0 } = {}) {
  // Results are tagged with the code they belong to, so switching lectures shows
  // "loading" instead of the previous lecture's numbers.
  const [result, setResult] = useState({ code: null, flags: [], status: 'loading', error: '', updatedAt: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let timer = null
    let stopped = false
    let controller = null

    async function load() {
      controller?.abort()
      controller = new AbortController()
      try {
        const data = await apiRequest(`/api/dashboard/${encodeURIComponent(code)}`, { signal: controller.signal })
        if (!stopped) setResult({ code, flags: anonymise(data.flags), status: 'live', error: '', updatedAt: Date.now() })
      } catch (err) {
        if (stopped || err.name === 'AbortError') return
        setResult((prev) => ({ ...(prev.code === code ? prev : { flags: [], updatedAt: null }), code, status: 'error', error: err.message }))
      }
    }

    function schedule() {
      clearTimeout(timer)
      if (stopped || document.hidden) return
      timer = setTimeout(() => load().then(schedule), POLL_MS)
    }
    function onVisibility() {
      if (!document.hidden) load().then(schedule)
    }

    load().then(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [code, reloadKey])

  const current = result.code === code ? result : { flags: [], status: 'loading', error: '', updatedAt: null }
  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])
  const stats = useMemo(() => buildStats(current.flags, { slideCount }), [current.flags, slideCount])

  return { stats, status: current.status, error: current.error, updatedAt: current.updatedAt, refresh }
}

/** Replace a lecture's flags with the sample "Gradient Descent" lecture. */
export function seedSampleLecture(code) {
  return apiRequest('/api/demo/seed', { method: 'POST', body: { sessionId: code } })
}

/**
 * AI themes or suggestions for a lecture, fetched on demand and cached per lecture,
 * type and flag count, so revisiting a page doesn't call the AI again.
 */
const insightsCache = new Map()

export function useInsights({ code, mode, flagType = null, typeLabel = '', slides = [], flagCount }) {
  const key = `${code}|${mode}|${flagType ?? ''}|${flagCount}`
  const [results, setResults] = useState({}) // key -> { status, data?, error? }
  const [attempt, setAttempt] = useState(0)
  const slidesRef = useRef(slides)
  useEffect(() => {
    slidesRef.current = slides
  })

  useEffect(() => {
    if (!flagCount || insightsCache.has(key)) return undefined
    const controller = new AbortController()
    apiRequest('/api/insights', {
      method: 'POST',
      signal: controller.signal,
      body: { sessionId: code, mode, flagType, typeLabel, slides: slidesRef.current },
    })
      .then((data) => {
        const next = { status: 'ready', data }
        insightsCache.set(key, next)
        setResults((all) => ({ ...all, [key]: next }))
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setResults((all) => ({ ...all, [key]: { status: 'error', error: err.message } }))
      })
    return () => controller.abort()
  }, [key, code, mode, flagType, typeLabel, flagCount, attempt])

  const state = !flagCount ? { status: 'empty' } : (insightsCache.get(key) ?? results[key] ?? { status: 'loading' })
  const retry = () => {
    insightsCache.delete(key)
    setResults((all) => ({ ...all, [key]: { status: 'loading' } }))
    setAttempt((n) => n + 1)
  }
  return { ...state, retry }
}
