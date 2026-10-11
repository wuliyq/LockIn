import { ArrowLeftIcon, SparklesIcon } from '../icons'
import { TYPE_META } from './flagMeta'
import { AiNote, AiStatus } from './Insights'
import { ruleSuggestions } from './stats'
import { useInsights } from './useDashboard'

/** Ways to improve the next lecture: an AI summary, plus suggestions computed straight from the counts. */
export default function Suggestions({ stats, code, navigate, slideName, slidesForAI }) {
  const insights = useInsights({ code, mode: 'suggestions', slides: slidesForAI, flagCount: stats.total })
  const fromNumbers = ruleSuggestions(stats, slideName)

  return (
    <div className="lect-page">
      <nav className="lect-page__nav">
        <button type="button" className="lect-back" onClick={() => navigate('/')}>
          <ArrowLeftIcon /> Overview
        </button>
      </nav>

      <header className="lect-hero">
        <h1>Suggestions for next lecture</h1>
        <p className="lect-hero__facts">
          <span>Lecture {code}</span>
          <span>
            Based on {stats.total} {stats.total === 1 ? 'flag' : 'flags'}
          </span>
        </p>
      </header>

      {stats.total === 0 ? (
        <section className="lect-card">
          <p className="muted">No flags yet, so there's nothing to suggest. Suggestions appear once students start flagging.</p>
        </section>
      ) : (
        <div className="lect-suggestions">
          <section className="lect-card" aria-labelledby="ai-suggestions">
            <h2 id="ai-suggestions" className="lect-card__title">
              <SparklesIcon /> Summary and recommendations
            </h2>
            <AiStatus state={insights} empty="">
              {insights.data?.overview && <p className="lect-questions__summary">{insights.data.overview}</p>}
              <ol className="lect-suggestion-list">
                {(insights.data?.suggestions ?? []).map((s, i) => (
                  <li key={i}>
                    <b>{s.title}</b>
                    {s.detail && <p>{s.detail}</p>}
                    {s.slides.length > 0 && (
                      <span className="lect-suggestion-list__slides">
                        {s.slides.map((n) => (
                          <span key={n} className="lect-slide-chip">
                            Slide {n}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </AiStatus>
            <AiNote basedOn={insights.data?.basedOn} />
          </section>

          <section className="lect-card" aria-labelledby="from-numbers">
            <h2 id="from-numbers" className="lect-card__title">
              From the numbers
            </h2>
            <p className="lect-card__sub">Calculated directly from where and when students flagged.</p>
            {fromNumbers.length === 0 ? (
              <p className="muted">Not enough flags yet for clear patterns.</p>
            ) : (
              <ol className="lect-suggestion-list">
                {fromNumbers.map((s) => (
                  <li key={s.id} style={s.type ? { '--type': TYPE_META[s.type].color } : undefined} className={s.type ? 'has-type' : ''}>
                    <b>{s.title}</b>
                    <p>{s.evidence}</p>
                    {s.type && (
                      <button type="button" className="link-btn" onClick={() => navigate(`/type/${s.type}`)}>
                        See “{TYPE_META[s.type].label}” details
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
