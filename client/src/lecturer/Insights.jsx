import { SparklesIcon } from '../icons'

/** Loading / error / empty states around an AI insights result. */
export function AiStatus({ state, empty, children }) {
  if (state.status === 'empty') return <p className="muted">{empty}</p>
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="lect-ai-loading" role="status">
        <SparklesIcon /> Summarising…
        <span className="lect-skeleton" />
        <span className="lect-skeleton lect-skeleton--short" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <p className="lect-ai-error" role="alert">
        {state.error}{' '}
        <button type="button" className="link-btn" onClick={state.retry}>
          Try again
        </button>
      </p>
    )
  }
  return children
}

/** Says where the summary came from and that it's anonymous. */
export function AiNote({ basedOn }) {
  return (
    <p className="lect-ai-note">
      <SparklesIcon /> AI summary{basedOn ? ` of ${basedOn} ${basedOn === 1 ? 'flag' : 'flags'}` : ''}. Paraphrased: no names
      and no exact student wording.
    </p>
  )
}
