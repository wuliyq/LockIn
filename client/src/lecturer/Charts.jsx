import { useEffect, useRef, useState } from 'react'
import { SlideStrip } from '../slides'
import { TYPE_META } from './flagMeta'
import { pct } from './stats'

/* Plain-SVG charts for the lecturer dashboard. Colors come from --lect-type-* (Lecturer.css);
   text always uses ink colors, never the series color. */

function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function Tooltip({ x, y, children, align = 'center' }) {
  return (
    <div className={`lect-tooltip lect-tooltip--${align}`} style={{ left: x, top: y }} role="presentation">
      {children}
    </div>
  )
}

/* --- Donut ---------------------------------------------------------------------- */

const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]

function arcPath(cx, cy, R, r, a0, a1) {
  // A full ring can't be one arc; draw it as two halves.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI
    return arcPath(cx, cy, R, r, a0, mid) + arcPath(cx, cy, R, r, mid, a0 + Math.PI * 2)
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, R, a0)
  const [x1, y1] = polar(cx, cy, R, a1)
  const [x2, y2] = polar(cx, cy, r, a1)
  const [x3, y3] = polar(cx, cy, r, a0)
  return `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`
}

/**
 * Share of flags by type. Each slice opens that type's detail page (click or Enter).
 */
export function DonutChart({ stats, onSelect }) {
  const [hover, setHover] = useState(null) // { id, x, y }
  const W = 360
  const H = 300
  const cx = W / 2
  const cy = H / 2
  const R = 112
  const r = 70

  let angle = -Math.PI / 2
  const slices = stats.presentTypes.map((id) => {
    const count = stats.byType[id]
    const share = count / stats.total
    const a0 = angle
    angle += share * Math.PI * 2
    return { id, count, share, a0, a1: angle, mid: (a0 + angle) / 2 }
  })

  return (
    <div className="lect-donut" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Flags by type, ${stats.total} in total`}>
        {slices.map((s) => {
          const lift = hover?.id === s.id ? 6 : 0
          const [dx, dy] = polar(0, 0, lift, s.mid)
          return (
            <path
              key={s.id}
              d={arcPath(cx, cy, R, r, s.a0, s.a1)}
              transform={`translate(${dx} ${dy})`}
              className="lect-donut__slice"
              style={{ fill: TYPE_META[s.id].color }}
              role="button"
              tabIndex={0}
              aria-label={`${TYPE_META[s.id].label}: ${s.count} flags, ${pct(s.share)}. Open details.`}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(s.id)
                }
              }}
              onMouseMove={(e) => {
                const box = e.currentTarget.ownerSVGElement.getBoundingClientRect()
                setHover({ id: s.id, x: e.clientX - box.left, y: e.clientY - box.top })
              }}
              onFocus={() => {
                const [x, y] = polar(cx, cy, R, s.mid)
                setHover({ id: s.id, x: (x / W) * 100 + '%', y: (y / H) * 100 + '%' })
              }}
              onBlur={() => setHover(null)}
            />
          )
        })}
        {slices.map((s) => {
          if (s.share < 0.04) return null
          const [x, y] = polar(cx, cy, R + 20, s.mid)
          const anchor = Math.abs(Math.cos(s.mid)) < 0.2 ? 'middle' : Math.cos(s.mid) > 0 ? 'start' : 'end'
          return (
            <text key={s.id} x={x} y={y} dy="0.35em" textAnchor={anchor} className="lect-donut__pct">
              {pct(s.share)}
            </text>
          )
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" className="lect-donut__total">
          {stats.total}
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" className="lect-donut__total-label">
          {stats.total === 1 ? 'flag' : 'flags'}
        </text>
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <span className="lect-swatch" style={{ background: TYPE_META[hover.id].color }} />
          <b>{TYPE_META[hover.id].label}</b> · {stats.byType[hover.id]} ({pct(stats.byType[hover.id] / stats.total)})
          <span className="lect-tooltip__hint">Click for details</span>
        </Tooltip>
      )}
    </div>
  )
}

/* --- Flags across the lecture (line chart over slide thumbnails) -------------------- */

/** Smooth line through points without overshooting (monotone cubic). */
function monotonePath(points) {
  const n = points.length
  if (n < 2) return ''
  const dx = []
  const slope = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0]
    slope[i] = (points[i + 1][1] - points[i][1]) / dx[i]
  }
  const t = [slope[0]]
  for (let i = 1; i < n - 1; i++) t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  t[n - 1] = slope[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / slope[i]
    const b = t[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) {
      const k = 3 / Math.sqrt(h)
      t[i] = k * a * slope[i]
      t[i + 1] = k * b * slope[i]
    }
  }
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const h = dx[i] / 3
    d += `C${x0 + h} ${y0 + t[i] * h} ${x1 - h} ${y1 - t[i + 1] * h} ${x1} ${y1}`
  }
  return d
}

const niceMax = (v) => {
  if (v <= 4) return Math.max(2, v)
  const step = v <= 10 ? 2 : v <= 25 ? 5 : 10
  return Math.ceil(v / step) * step
}

/**
 * "Most flagged" chart, like YouTube's most-replayed graph: flags per slide for each
 * selected type, drawn directly above the slide thumbnails so peaks sit over their slide.
 */
export function FlagTimeline({ stats, types, slideName, slideTitle, file, onDeckReady, onFileError }) {
  const [wrapRef, width] = useWidth()
  const [hover, setHover] = useState(null) // slide index
  const n = stats.slideCount

  if (n === 0) {
    return (
      <div ref={wrapRef} className="lect-timeline lect-timeline--empty">
        <p>No flags yet. Peaks will appear here, above the slides they happened on.</p>
      </div>
    )
  }

  const cell = Math.max(72, Math.floor((width || 600) / n))
  const W = cell * n
  const H = 160
  const top = 26
  const bottom = 6
  const max = niceMax(Math.max(1, ...types.flatMap((t) => stats.perSlide[t])))
  const x = (i) => i * cell + cell / 2
  const y = (v) => top + (H - top - bottom) * (1 - v / max)

  const series = types.map((t) => {
    const values = stats.perSlide[t]
    const pts = values.map((v, i) => [x(i), y(v)])
    const line = monotonePath([[0, pts[0][1]], ...pts, [W, pts[pts.length - 1][1]]])
    const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
    return { t, values, line, peak }
  })

  // Peak labels: one per series, nudged up if two series peak on the same slide.
  const usedPeaks = {}
  const peakLabels = series
    .filter((s) => s.values[s.peak] > 0)
    .map((s) => {
      const stack = (usedPeaks[s.peak] = (usedPeaks[s.peak] ?? -1) + 1)
      return { ...s, ly: y(s.values[s.peak]) - 10 - stack * 13 }
    })

  return (
    <div ref={wrapRef} className="lect-timeline">
      <div className="lect-timeline__scroll" onMouseLeave={() => setHover(null)}>
        <div className="lect-timeline__inner" style={{ width: W }}>
          <svg width={W} height={H} className="lect-timeline__svg" aria-hidden="true">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className={f === 0 ? 'lect-axis' : 'lect-grid'} />
                {f > 0 && (
                  <text x={4} y={y(max * f) - 4} className="lect-tick">
                    {Math.round(max * f)}
                  </text>
                )}
              </g>
            ))}
            {hover != null && <rect x={hover * cell} y={0} width={cell} height={H} className="lect-timeline__hover-col" />}
            {series.length === 1 && (
              <path
                d={`${series[0].line}L${W} ${y(0)}L0 ${y(0)}Z`}
                style={{ fill: TYPE_META[series[0].t].color }}
                className="lect-timeline__area"
              />
            )}
            {series.map((s) => (
              <path key={s.t} d={s.line} style={{ stroke: TYPE_META[s.t].color }} className="lect-timeline__line" />
            ))}
            {peakLabels.map((s) => (
              <g key={s.t}>
                <circle cx={x(s.peak)} cy={y(s.values[s.peak])} r={4} style={{ fill: TYPE_META[s.t].color }} className="lect-marker" />
                <text x={x(s.peak)} y={s.ly} textAnchor="middle" className="lect-peak-label">
                  {s.values[s.peak]}
                </text>
              </g>
            ))}
            {hover != null &&
              series.map((s) => (
                <circle key={s.t} cx={x(hover)} cy={y(s.values[hover])} r={5} style={{ fill: TYPE_META[s.t].color }} className="lect-marker" />
              ))}
            {Array.from({ length: n }, (_, i) => (
              <rect
                key={i}
                x={i * cell}
                y={0}
                width={cell}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
          </svg>

          {file ? (
            <SlideStrip file={file} cellWidth={cell} onDeckReady={onDeckReady} onError={onFileError} />
          ) : (
            <div className="lect-placeholder-strip" style={{ gridTemplateColumns: `repeat(${n}, ${cell}px)` }}>
              {Array.from({ length: n }, (_, i) => (
                <div key={i} className="lect-placeholder-slide" style={{ height: cell * 0.5625 }}>
                  <span>{slideTitle(i + 1) || `Slide ${i + 1}`}</span>
                </div>
              ))}
            </div>
          )}
          <div className="lect-slide-numbers" style={{ gridTemplateColumns: `repeat(${n}, ${cell}px)` }}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={hover === i ? 'is-hover' : ''} onMouseEnter={() => setHover(i)}>
                {i + 1}
              </span>
            ))}
          </div>

          {hover != null && (
            <Tooltip x={Math.min(Math.max(x(hover), 110), W - 110)} y={8}>
              <b>{slideName(hover + 1)}</b>
              {types.map((t) => (
                <span key={t} className="lect-tooltip__row">
                  <span className="lect-swatch" style={{ background: TYPE_META[t].color }} />
                  {TYPE_META[t].label}
                  <b>{stats.perSlide[t][hover]}</b>
                </span>
              ))}
              {types.length > 1 && (
                <span className="lect-tooltip__row lect-tooltip__total">
                  Shown types <b>{types.reduce((sum, t) => sum + stats.perSlide[t][hover], 0)}</b>
                </span>
              )}
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

/** Same numbers as the timeline, as a table (for screen readers and exact values). */
export function FlagTable({ stats, types, slideName }) {
  return (
    <div className="lect-table-wrap">
      <table className="lect-table">
        <thead>
          <tr>
            <th scope="col">Slide</th>
            {types.map((t) => (
              <th key={t} scope="col">
                {TYPE_META[t].label}
              </th>
            ))}
            <th scope="col">All flags</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: stats.slideCount }, (_, i) => (
            <tr key={i}>
              <th scope="row">{slideName(i + 1)}</th>
              {types.map((t) => (
                <td key={t}>{stats.perSlide[t][i]}</td>
              ))}
              <td>{stats.totalPerSlide[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --- Detail-page charts ------------------------------------------------------------------ */

/** Horizontal bars, longest first: e.g. the slides with the most flags of one type. */
export function BarList({ items, color, label, onPick }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <ol className="lect-bars">
      {items.map((item) => (
        <li key={item.slide}>
          <button type="button" className="lect-bars__row" onClick={() => onPick?.(item.slide)} disabled={!onPick}>
            <span className="lect-bars__label">{label(item.slide)}</span>
            <span className="lect-bars__track">
              <span className="lect-bars__bar" style={{ width: `${(item.count / max) * 100}%`, background: color }} />
            </span>
            <span className="lect-bars__value">
              {item.count} <small>({pct(item.share)})</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** Flags per time bucket through the lecture. */
export function TimeBars({ series, color, slideName, clock }) {
  const [wrapRef, width] = useWidth()
  const [hover, setHover] = useState(null)
  const { buckets, bucketMinutes } = series
  if (!buckets.length) return <div ref={wrapRef} className="lect-timebars lect-timebars--empty" />

  const W = Math.max(width, 200)
  const H = 150
  const top = 20
  const bottom = 22
  const gap = 2
  const max = niceMax(Math.max(1, ...buckets.map((b) => b.count)))
  const bw = W / buckets.length
  const y = (v) => top + (H - top - bottom) * (1 - v / max)
  const tickEvery = Math.ceil(buckets.length / 8)

  return (
    <div ref={wrapRef} className="lect-timebars" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} aria-hidden="true">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className="lect-grid" />
            <text x={2} y={y(max * f) - 4} className="lect-tick">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const h = y(0) - y(b.count)
          const bx = i * bw + gap / 2
          const w = Math.max(1, bw - gap)
          const rad = Math.min(4, w / 2, h)
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {b.count > 0 && (
                <path
                  d={`M${bx} ${y(0)}V${y(b.count) + rad}Q${bx} ${y(b.count)} ${bx + rad} ${y(b.count)}H${bx + w - rad}Q${bx + w} ${y(b.count)} ${bx + w} ${y(b.count) + rad}V${y(0)}Z`}
                  style={{ fill: color, opacity: hover == null || hover === i ? 1 : 0.55 }}
                />
              )}
            </g>
          )
        })}
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="lect-axis" />
        {buckets.map((b, i) =>
          i % tickEvery === 0 ? (
            <text key={i} x={i * bw + bw / 2} y={H - 6} textAnchor="middle" className="lect-tick">
              {clock(b.startTime)}
            </text>
          ) : null,
        )}
      </svg>
      {hover != null && (
        <Tooltip x={Math.min(Math.max(hover * bw + bw / 2, 90), W - 90)} y={0}>
          <b>
            {clock(buckets[hover].startTime)}
            {bucketMinutes > 1 ? `–${clock(buckets[hover].startTime + bucketMinutes * 60000)}` : ''}
          </b>
          <span className="lect-tooltip__row">
            {buckets[hover].count} {buckets[hover].count === 1 ? 'flag' : 'flags'}
          </span>
          {buckets[hover].mainSlide && <span className="lect-tooltip__hint">Mostly {slideName(buckets[hover].mainSlide)}</span>}
        </Tooltip>
      )}
    </div>
  )
}
