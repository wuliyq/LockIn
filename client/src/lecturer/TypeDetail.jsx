import { ArrowLeftIcon } from '../icons'
import { BarList, TimeBars } from './Charts'
import { TYPE_META } from './flagMeta'
import { AiNote, AiStatus } from './Insights'
import { clock, overTime, peakBucket, pct, topSlides } from './stats'
import { useInsights } from './useDashboard'

/** Everything about one flag type: how many, where, when, and what students asked (paraphrased). */
export default function TypeDetail({ type, stats, code, navigate, slideName, slidesForAI }) {
  const meta = TYPE_META[type]
  const count = stats.byType[type]
  const slides = topSlides(stats, type, 8)
  const time = overTime(stats, type)
  const peak = peakBucket(time)
  const withQuestion = stats.flags.filter((f) => f.type === type && f.hasQuestion).length
  const insights = useInsights({ code, mode: 'type', flagType: type, typeLabel: meta.label, slides: slidesForAI, flagCount: withQuestion })

  return (
    <div className="lect-page" style={{ '--type': meta.color }}>
      <nav className="lect-page__nav">
        <button type="button" className="lect-back" onClick={() => navigate('/')}>
          <ArrowLeftIcon /> Overview
        </button>
        <div className="lect-type-tabs" role="group" aria-label="Flag type">
          {stats.presentTypes.map((id) => (
            <button key={id} type="button" aria-pressed={id === type} onClick={() => navigate(`/type/${id}`)}>
              <span className="lect-swatch" style={{ background: TYPE_META[id].color }} /> {TYPE_META[id].label}
            </button>
          ))}
        </div>
      </nav>

      <header className="lect-hero">
        <span className="lect-hero__chip">
          <span className="lect-swatch" style={{ background: meta.color }} /> {meta.label}
        </span>
        <h1>
          {count} {count === 1 ? 'flag' : 'flags'}
        </h1>
        <p className="lect-hero__facts">
          {stats.total > 0 && <span>{pct(count / Math.max(1, stats.total))} of all flags</span>}
          {slides[0] && <span>Most on slide {slides[0].slide}</span>}
          {peak && <span>Busiest around {clock(peak.startTime)}</span>}
          <span>{withQuestion} with highlighted text</span>
        </p>
      </header>

      {count === 0 ? (
        <section className="lect-card">
          <p className="muted">No “{meta.label}” flags in this lecture yet.</p>
        </section>
      ) : (
        <div className="lect-detail-grid">
          <section className="lect-card" aria-labelledby="top-slides">
            <h2 id="top-slides" className="lect-card__title">
              Slides with the most “{meta.label}” flags
            </h2>
            <BarList items={slides} color={meta.color} label={slideName} />
          </section>

          <section className="lect-card lect-questions" aria-labelledby="key-questions">
            <h2 id="key-questions" className="lect-card__title">
              What students asked about
            </h2>
            <AiStatus state={insights} empty="No highlighted text with this flag yet. Students flagged the slide without highlighting anything.">
              {insights.data?.summary && <p className="lect-questions__summary">{insights.data.summary}</p>}
              {insights.data?.themes?.length > 0 ? (
                <ol className="lect-themes">
                  {insights.data.themes.map((t, i) => (
                    <li key={i}>
                      <span className="lect-themes__text">{t.theme}</span>
                      <span className="lect-themes__meta">
                        {t.slides.length > 0 && <span>{t.slides.length === 1 ? 'Slide' : 'Slides'} {t.slides.join(', ')}</span>}
                        {t.count > 0 && <span>~{t.count} {t.count === 1 ? 'flag' : 'flags'}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                insights.status === 'ready' && <p className="muted">No clear themes yet.</p>
              )}
            </AiStatus>
            <AiNote basedOn={insights.data?.basedOn} />
          </section>

          <section className="lect-card lect-detail-grid__wide" aria-labelledby="when">
            <h2 id="when" className="lect-card__title">
              When it happened
            </h2>
            <p className="lect-card__sub">“{meta.label}” flags through the lecture. Hover a bar to see which slide was on screen.</p>
            <TimeBars series={time} color={meta.color} slideName={slideName} clock={clock} />
          </section>
        </div>
      )}
    </div>
  )
}
