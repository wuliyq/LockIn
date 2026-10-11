import { useEffect, useState } from 'react'
import { LinkIcon, LockIcon } from '../icons'
import { TYPE_IDS, TYPE_META } from './flagMeta'
import Overview from './Overview'
import Suggestions from './Suggestions'
import TypeDetail from './TypeDetail'
import { SAMPLE_CODE, seedSampleLecture, useDashboard, useLectureCode } from './useDashboard'
import './Lecturer.css'

/**
 * Lecturer dashboard: open the app with ?view=lecturer. Pages are hash routes:
 * #/ overview, #/type/<flagType> detail, #/suggestions.
 *
 * Only anonymised counts reach this view; student questions are summarised on the
 * server (paraphrased, never quoted).
 */
export default function LecturerApp() {
  const [code, setCode] = useLectureCode()
  const route = useHashRoute()
  const [file, setFile] = useState(null) // the lecture PDF, for thumbnails and slide titles
  const [deck, setDeck] = useState(null)
  const [fileError, setFileError] = useState('')
  const [shown, setShown] = useState(() => TYPE_IDS.filter((id) => id !== 'other'))
  const dash = useDashboard(code, { slideCount: deck?.slideCount ?? 0 })

  const slideTitle = (n) => deck?.slides[n - 1]?.text.split('\n', 1)[0].trim() ?? ''
  const slideName = (n) => `Slide ${n}${slideTitle(n) ? ` · ${slideTitle(n)}` : ''}`
  const slidesForAI = deck ? deck.slides.map((s) => ({ slideNumber: s.index + 1, title: slideTitle(s.index + 1) })) : []

  const chooseFile = (next) => {
    setFile(next)
    setDeck(null)
    setFileError('')
  }

  const loadSample = async () => {
    setCode(SAMPLE_CODE)
    try {
      await seedSampleLecture(SAMPLE_CODE)
    } catch {
      // The status line already says the server can't be reached.
    }
    dash.refresh()
  }

  const ctx = { code, stats: dash.stats, slideName, slideTitle, slidesForAI, navigate, shown, setShown, file, chooseFile, setDeck, fileError, setFileError, deck, loadSample, status: dash.status }

  return (
    <div className="theme-sage lecturer">
      <Header code={code} setCode={setCode} dash={dash} onLoadSample={loadSample} />
      <main className="lecturer__main">
        {route.page === 'type' && TYPE_META[route.type] ? (
          <TypeDetail {...ctx} type={route.type} />
        ) : route.page === 'suggestions' ? (
          <Suggestions {...ctx} />
        ) : (
          <Overview {...ctx} />
        )}
      </main>
    </div>
  )
}

function Header({ code, setCode, dash, onLoadSample }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const [copied, setCopied] = useState(false)
  const now = useNow(1000)

  const studentLink = `${window.location.origin}${window.location.pathname}?lecture=${encodeURIComponent(code)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(studentLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link for your students:', studentLink)
    }
  }

  const ago = dash.updatedAt ? Math.max(0, Math.round((now - dash.updatedAt) / 1000)) : null

  return (
    <header className="lect-header">
      <span className="lect-logo">
        <LockIcon /> LockIN <span className="lect-header__role">Lecturer</span>
      </span>

      <div className="lect-header__lecture">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setCode(draft)
              setEditing(false)
            }}
          >
            <label className="sr-only" htmlFor="lecture-code">
              Lecture code
            </label>
            <input id="lecture-code" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={40} />
            <button type="submit" className="lect-btn lect-btn--small">
              Open
            </button>
            <button type="button" className="lect-btn lect-btn--small lect-btn--quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="lect-header__label">Lecture</span>
            <button
              type="button"
              className="lect-code"
              onClick={() => {
                setDraft(code)
                setEditing(true)
              }}
              title="Switch to another lecture code"
            >
              {code}
            </button>
            <button type="button" className="lect-btn lect-btn--small" onClick={copy} title={studentLink}>
              <LinkIcon /> {copied ? 'Link copied' : 'Copy student link'}
            </button>
          </>
        )}
      </div>

      <div className="lect-header__right">
        <span className={`lect-status lect-status--${dash.status}`} role="status">
          {dash.status === 'live' && `Live · updated ${ago === 0 ? 'just now' : `${ago}s ago`}`}
          {dash.status === 'loading' && 'Connecting…'}
          {dash.status === 'error' && (
            <>
              {dash.error}{' '}
              <button type="button" className="link-btn" onClick={dash.refresh}>
                Retry
              </button>
            </>
          )}
        </span>
        <button type="button" className="lect-btn lect-btn--small lect-btn--quiet" onClick={onLoadSample} title="Load an example lecture with sample flags">
          Load sample lecture
        </button>
        <a className="lect-btn lect-btn--small lect-btn--quiet" href={studentLink}>
          Student view
        </a>
      </div>
    </header>
  )
}

function navigate(path) {
  window.location.hash = path
}

function parseHash() {
  const [, page, arg] = window.location.hash.replace(/^#\/?/, '#/').split('/')
  if (page === 'type' && arg) return { page: 'type', type: decodeURIComponent(arg) }
  if (page === 'suggestions') return { page: 'suggestions' }
  return { page: 'overview' }
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
