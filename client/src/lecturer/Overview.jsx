import { useState } from 'react'
import { ChartIcon, ChevronRightIcon, LightbulbIcon, TableIcon, UploadIcon } from '../icons'
import { DonutChart, FlagTable, FlagTimeline } from './Charts'
import { TYPE_IDS, TYPE_META } from './flagMeta'
import { clock, overTime, peakBucket, pct, topSlides } from './stats'

/** Main dashboard: type toggles and suggestions (left), donut (center), timeline over slides (bottom). */
export default function Overview(props) {
  const { stats, navigate, shown, setShown, slideName, loadSample, status, code } = props
  const [view, setView] = useState('chart')

  const toggleable = TYPE_IDS.filter((id) => id !== 'other' || stats.byType.other > 0)
  const visible = shown.filter((id) => toggleable.includes(id))
  const toggle = (id) => setShown(shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id])

  const [busiestSlide] = topSlides(stats, null, 1)
  const peak = peakBucket(overTime(stats))

  return (
    <div className="lect-overview">
      <aside className="lect-overview__side">
        <section className="lect-card lect-toggles" aria-labelledby="toggles-title">
          <h2 id="toggles-title" className="lect-card__title">
            Show on timeline
          </h2>
          <ul>
            {toggleable.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shown.includes(id)}
                  className={`lect-toggle ${shown.includes(id) ? 'is-on' : ''}`}
                  onClick={() => toggle(id)}
                >
                  <span className="lect-swatch" style={{ background: TYPE_META[id].color }} />
                  <span className="lect-toggle__label">{TYPE_META[id].label}</span>
                  <span className="lect-toggle__count">{stats.byType[id]}</span>
                  <span className="lect-switch" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <button type="button" className="lect-suggest-btn" onClick={() => navigate('/suggestions')}>
          <LightbulbIcon />
          <span>
            <b>Suggestions for next lecture</b>
            <small>What to change, based on today's flags</small>
          </span>
          <ChevronRightIcon />
        </button>

        <dl className="lect-kpis">
          <div>
            <dt>Total flags</dt>
            <dd>{stats.total}</dd>
          </div>
          <div>
            <dt>With a written question</dt>
            <dd>{stats.questions}</dd>
          </div>
          <div>
            <dt>Most flagged slide</dt>
            <dd>{busiestSlide ? `Slide ${busiestSlide.slide}` : '–'}</dd>
            {busiestSlide && <dd className="lect-kpis__sub">{busiestSlide.count} flags</dd>}
          </div>
          <div>
            <dt>Busiest moment</dt>
            <dd>{peak ? clock(peak.startTime) : '–'}</dd>
            {peak?.mainSlide && <dd className="lect-kpis__sub">Slide {peak.mainSlide}</dd>}
          </div>
        </dl>
      </aside>

      <section className="lect-card lect-overview__pie" aria-labelledby="pie-title">
        <h2 id="pie-title" className="lect-card__title">
          What students flagged
        </h2>
        {stats.total === 0 ? (
          <EmptyState status={status} code={code} onLoadSample={loadSample} />
        ) : (
          <div className="lect-pie-layout">
            <DonutChart stats={stats} onSelect={(id) => navigate(`/type/${id}`)} />
            <ul className="lect-legend">
              {stats.presentTypes.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => navigate(`/type/${id}`)}>
                    <span className="lect-swatch" style={{ background: TYPE_META[id].color }} />
                    <span className="lect-legend__label">{TYPE_META[id].label}</span>
                    <span className="lect-legend__value">
                      {stats.byType[id]} <small>{pct(stats.byType[id] / stats.total)}</small>
                    </span>
                    <ChevronRightIcon />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="lect-card lect-overview__timeline" aria-labelledby="timeline-title">
        <div className="lect-card__head">
          <div>
            <h2 id="timeline-title" className="lect-card__title">
              Flags across the lecture
            </h2>
            <p className="lect-card__sub">
              {visible.length
                ? 'Peaks show the slides where students flagged the most. Hover a slide for exact counts.'
                : 'Turn on a flag type on the left to draw its line.'}
            </p>
          </div>
          <div className="lect-card__actions">
            <SlidesPicker {...props} />
            <div className="lect-segmented" role="group" aria-label="Show as">
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                <ChartIcon /> Chart
              </button>
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                <TableIcon /> Table
              </button>
            </div>
          </div>
        </div>
        {view === 'chart' ? (
          <FlagTimeline
            stats={stats}
            types={visible}
            slideName={slideName}
            slideTitle={props.slideTitle}
            file={props.file}
            onDeckReady={props.setDeck}
            onFileError={props.setFileError}
          />
        ) : (
          <FlagTable stats={stats} types={visible} slideName={slideName} />
        )}
      </section>
    </div>
  )
}

function SlidesPicker({ file, chooseFile, fileError, deck }) {
  return (
    <div className="lect-slides-picker">
      <label className="lect-btn lect-btn--small lect-btn--quiet" title="Show your slides under the chart (stays on this computer)">
        <UploadIcon /> {file ? 'Change slides' : 'Add slide thumbnails'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0]
            e.target.value = ''
            if (next) chooseFile(next)
          }}
        />
      </label>
      {file && !fileError && <span className="lect-slides-picker__name">{deck ? deck.filename : 'Reading…'}</span>}
      {fileError && (
        <span className="lect-slides-picker__error" role="alert">
          {fileError}
        </span>
      )}
    </div>
  )
}

function EmptyState({ status, code, onLoadSample }) {
  return (
    <div className="lect-empty">
      <p>
        <b>No flags yet for lecture {code}.</b>
      </p>
      <p className="muted">
        {status === 'error'
          ? "The dashboard can't reach the LockIN server, so it can't show flags yet."
          : 'Share the student link (top of the page). Flags appear here live as students raise them.'}
      </p>
      <button type="button" className="lect-btn" onClick={onLoadSample}>
        Load a sample lecture to explore
      </button>
    </div>
  )
}
