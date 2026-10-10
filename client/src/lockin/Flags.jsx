import { useEffect, useRef, useState } from 'react'
import { FlagIcon, GlobeIcon, HelpIcon, ListOrderedIcon, PencilIcon, TrashIcon, XIcon } from '../icons'
import { FLAG_TYPES, FLAG_TYPE_BY_ID, SOURCE_LABELS, formatFlagTime } from './flagTypes'
import './Flags.css'

const TYPE_ICONS = {
  lost: HelpIcon,
  confusing: FlagIcon,
  real_world: GlobeIcon,
  worked_example: ListOrderedIcon,
}

export function FlagTypeIcon({ type, className }) {
  const Icon = TYPE_ICONS[type] ?? FlagIcon
  return <Icon className={className} />
}

/** One-tap flag buttons under the notes. Always visible, so flagging is keyboard-reachable. */
export function FlagBar({ li }) {
  return (
    <div className="flag-bar" role="group" aria-label="Flag this moment">
      <span className="flag-bar__label">{li.canFlag ? 'Flag this moment' : 'Upload slides to start flagging'}</span>
      <div className="flag-bar__buttons">
        {FLAG_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className={`flag-btn flag-type--${type.id} ${type.quick ? 'flag-btn--quick' : ''} ${
              li.draft?.flagType === type.id ? 'is-active' : ''
            }`}
            disabled={!li.canFlag}
            title={type.description}
            aria-label={type.quick ? `${type.name}: ${type.description}` : undefined}
            // Keep the cursor where it was (e.g. in the notes) when quick-flagging.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => li.startFlag(type.id)}
          >
            {type.quick ? (
              <span className="flag-btn__q" aria-hidden="true">
                ?
              </span>
            ) : (
              <>
                <FlagTypeIcon type={type.id} /> {type.label}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Small form for the student's question. The flag's slide and time are already fixed. */
export function FlagComposer({ li }) {
  if (!li.draft) return null
  return <ComposerForm li={li} draft={li.draft} />
}

function ComposerForm({ li, draft }) {
  const inputRef = useRef(null)
  const type = FLAG_TYPE_BY_ID[draft.flagType]

  // Focus the question box whenever a new flag starts (not on every keystroke).
  useEffect(() => {
    inputRef.current?.focus()
  }, [draft.timestamp])

  return (
    <form
      className={`flag-composer flag-type--${draft.flagType}`}
      aria-label="New flag"
      onSubmit={(e) => {
        e.preventDefault()
        li.saveDraft()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          li.cancelDraft()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          li.saveDraft()
        }
      }}
    >
      <div className="flag-composer__head">
        <div className="flag-composer__types" role="radiogroup" aria-label="Flag type">
          {FLAG_TYPES.filter((t) => !t.quick).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === draft.flagType}
              className={`flag-chip flag-type--${t.id} ${t.id === draft.flagType ? 'is-active' : ''}`}
              onClick={() => li.updateDraft({ flagType: t.id })}
            >
              <FlagTypeIcon type={t.id} /> {t.name}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={li.cancelDraft} aria-label="Cancel flag">
          <XIcon />
        </button>
      </div>

      <p className="flag-composer__when">
        Slide {draft.slideNumber} · {formatFlagTime(draft.timestamp, { seconds: true })}
      </p>

      {draft.selectedText && (
        <Quote text={draft.selectedText} source={draft.source}>
          <button
            type="button"
            className="link-btn"
            onClick={() => li.updateDraft({ selectedText: '', source: null })}
          >
            Remove
          </button>
        </Quote>
      )}

      <textarea
        ref={inputRef}
        className="flag-composer__input"
        rows={2}
        value={draft.studentComment}
        onChange={(e) => li.updateDraft({ studentComment: e.target.value })}
        placeholder={`${type.prompt} (optional)`}
        aria-label="Your question (optional)"
      />

      <div className="flag-composer__actions">
        <span className="flag-composer__hint">Ctrl/⌘ + Enter to save · Esc to cancel</span>
        <button type="button" className="btn-quiet" onClick={li.cancelDraft}>
          Cancel
        </button>
        <button type="submit" className="btn-primary">
          Save flag
        </button>
      </div>
    </form>
  )
}

function Quote({ text, source, children }) {
  return (
    <figure className="flag-quote">
      <blockquote>{text}</blockquote>
      <figcaption>
        {source ? `From ${SOURCE_LABELS[source]}` : 'Highlighted text'}
        {children}
      </figcaption>
    </figure>
  )
}

/** Every flag on this deck, newest first, filterable by type. */
export function FlagList({ li }) {
  const [filter, setFilter] = useState('all')

  if (li.flags.length === 0) {
    return (
      <div className="flag-list flag-list--empty">
        <p>No flags yet.</p>
        <p className="muted">
          Highlight text in your notes, the slide text or the transcript, or use the buttons below, to flag a
          moment. Each flag records the slide and the time.
        </p>
      </div>
    )
  }

  const counts = Object.fromEntries(FLAG_TYPES.map((t) => [t.id, 0]))
  for (const f of li.flags) counts[f.flagType] = (counts[f.flagType] ?? 0) + 1
  const shown = filter === 'all' ? li.flags : li.flags.filter((f) => f.flagType === filter)

  return (
    <div className="flag-list">
      <div className="flag-list__filters" role="group" aria-label="Show flags of type">
        <button
          type="button"
          className={`filter-chip ${filter === 'all' ? 'is-active' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All <span className="filter-chip__count">{li.flags.length}</span>
        </button>
        {FLAG_TYPES.filter((t) => counts[t.id] > 0).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`filter-chip flag-type--${t.id} ${filter === t.id ? 'is-active' : ''}`}
            aria-pressed={filter === t.id}
            onClick={() => setFilter(t.id)}
          >
            <span className="type-dot" aria-hidden="true" /> {t.name}{' '}
            <span className="filter-chip__count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <ol className="flag-list__items">
        {shown.map((flag) => (
          <FlagItem key={flag.id} flag={flag} li={li} />
        ))}
        {shown.length === 0 && <li className="muted flag-list__none">No flags of this type left.</li>}
      </ol>
    </div>
  )
}

function FlagItem({ flag, li }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(flag.studentComment)
  const type = FLAG_TYPE_BY_ID[flag.flagType]

  const startEdit = () => {
    setText(flag.studentComment)
    setEditing(true)
  }
  const saveEdit = () => {
    li.updateFlag(flag.id, { studentComment: text.trim() })
    setEditing(false)
  }

  return (
    <li className={`flag-item flag-type--${flag.flagType}`}>
      <div className="flag-item__head">
        <span className="flag-chip is-static">
          <FlagTypeIcon type={flag.flagType} /> {type?.name ?? flag.flagType}
        </span>
        <button
          type="button"
          className="flag-item__when"
          onClick={() => li.goToSlide(flag.slideNumber - 1)}
          title="Show this slide"
        >
          Slide {flag.slideNumber} · {formatFlagTime(flag.timestamp)}
        </button>
        <span className="flag-item__actions">
          {!editing && (
            <button
              type="button"
              className="icon-btn"
              onClick={startEdit}
              aria-label={flag.studentComment ? 'Edit question' : 'Add a question'}
            >
              <PencilIcon />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => li.deleteFlag(flag.id)} aria-label="Delete flag">
            <TrashIcon />
          </button>
        </span>
      </div>

      {flag.selectedText && <Quote text={flag.selectedText} source={flag.source} />}

      {editing ? (
        <form
          className="flag-item__edit"
          onSubmit={(e) => {
            e.preventDefault()
            saveEdit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              saveEdit()
            }
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={type?.prompt ?? 'Your question'}
            aria-label="Your question"
          />
          <div className="flag-item__edit-actions">
            <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save
            </button>
          </div>
        </form>
      ) : flag.studentComment ? (
        <p className="flag-item__question">{flag.studentComment}</p>
      ) : (
        <button type="button" className="link-btn flag-item__add" onClick={startEdit}>
          + Add a question
        </button>
      )}

      {flag.aiAnswer && <p className="flag-item__answer">{flag.aiAnswer}</p>}
    </li>
  )
}

/** Confirmation after saving or deleting a flag, with Undo. Disappears after a few seconds. */
export function FlagToast({ li }) {
  const { toast, dismissToast } = li

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismissToast, 6000)
    return () => clearTimeout(timer)
  }, [toast, dismissToast])

  return (
    <div className="flag-toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="flag-toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                toast.undo()
                dismissToast()
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="icon-btn" onClick={dismissToast} aria-label="Dismiss">
            <XIcon />
          </button>
        </div>
      )}
    </div>
  )
}
