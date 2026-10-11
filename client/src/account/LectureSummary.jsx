import { buildLectureSummary } from './lectureSummary.js'

const time = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * One page of summary notes: the student's notes slide by slide, with their
 * flags, questions, AI answers and catch-ups added in green under the notes
 * they relate to.
 */
export default function LectureSummary({ title, snapshot, flags, catchUps }) {
  const sections = buildLectureSummary({ notes: snapshot.notes || {}, slides: snapshot.slides || [], flags, catchUps })

  if (sections.length === 0) {
    return <p className="account-empty">No notes or flags saved for this lecture yet.</p>
  }

  return (
    <div className="lecture-summary">
      <div className="lecture-summary__toolbar">
        <p>
          Your notes, with your flags, questions and LockIN’s answers added
          {' '}<span className="lecture-summary__key">in green</span> under the notes they belong to.
        </p>
        <button type="button" className="account-secondary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      <article className="lecture-summary__page" aria-label="Summary notes">
        <h2 className="lecture-summary__title">{title}</h2>
        {sections.map((section) => (
          <section className="lecture-summary__slide" key={section.slide} aria-labelledby={`summary-slide-${section.slide}`}>
            <h3 id={`summary-slide-${section.slide}`}>
              <span>Slide {section.slide + 1}</span>
              {section.title && <> · {section.title}</>}
            </h3>
            {section.blocks.map((block, index) => (
              <div className="lecture-summary__block" key={index}>
                {block.text
                  ? <p className="lecture-summary__note">{block.text}</p>
                  : index === 0 && <p className="lecture-summary__no-note">No notes on this slide.</p>}
                {block.additions.map((addition) => <Addition key={addition.id} addition={addition} />)}
              </div>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}

function Addition({ addition }) {
  const when = addition.time && <small>{time(addition.time)}</small>

  if (addition.kind === 'catch-up') {
    return (
      <div className="lecture-summary__addition">
        <p className="lecture-summary__label"><b>Catch-up</b>{when}</p>
        <ul>{addition.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
      </div>
    )
  }

  return (
    <div className="lecture-summary__addition">
      <p className="lecture-summary__label">
        <b>{addition.label}</b>
        {addition.comment && <span>: {addition.comment}</span>}
        {when}
      </p>
      {addition.quote && <blockquote>{addition.quote}</blockquote>}
      {addition.answer && <p className="lecture-summary__answer"><b>LockIN:</b> {addition.answer}</p>}
    </div>
  )
}
