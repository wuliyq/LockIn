import { TYPE_IDS, TYPE_META, normalizeType } from './flagMeta'

/**
 * Lecturer-side statistics. Everything here works on anonymised flags: only the
 * type, slide, time and source survive (see anonymise), so no student wording can
 * reach the dashboard UI.
 */

/** Keep only what the dashboard may show. Student text never leaves this function. */
export function anonymise(rawFlags) {
  return (rawFlags ?? [])
    .map((f) => ({
      type: normalizeType(f.flagType),
      slide: Math.round(Number(f.slideNumber)),
      time: Date.parse(f.timestamp),
      // Did the student highlight text or type a question? The server says so in
      // hasQuestion; older data may still carry the text itself.
      hasQuestion: f.hasQuestion === true ||
        Boolean(f.studentComment?.trim() || (f.selectedText?.trim() && !/^Highlighted area on slide \d+$/.test(f.selectedText.trim()))),
    }))
    .filter((f) => Number.isFinite(f.slide) && f.slide >= 1)
}

/**
 * @param {ReturnType<typeof anonymise>} flags
 * @param {{ slideCount?: number }} [options]  slideCount from the lecturer's deck, if loaded
 */
export function buildStats(flags, { slideCount: deckSlides = 0 } = {}) {
  const total = flags.length
  const byType = Object.fromEntries(TYPE_IDS.map((id) => [id, 0]))
  for (const f of flags) byType[f.type] += 1
  const presentTypes = TYPE_IDS.filter((id) => byType[id] > 0)

  const slideCount = Math.max(deckSlides, ...flags.map((f) => f.slide), 0)
  const perSlide = Object.fromEntries(TYPE_IDS.map((id) => [id, new Array(slideCount).fill(0)]))
  const totalPerSlide = new Array(slideCount).fill(0)
  for (const f of flags) {
    perSlide[f.type][f.slide - 1] += 1
    totalPerSlide[f.slide - 1] += 1
  }

  const times = flags.map((f) => f.time).filter(Number.isFinite)
  const start = times.length ? Math.min(...times) : null
  const end = times.length ? Math.max(...times) : null

  return {
    total,
    byType,
    presentTypes,
    slideCount,
    perSlide,
    totalPerSlide,
    start,
    end,
    flags,
    questions: flags.filter((f) => f.hasQuestion).length,
  }
}

/** Slides ranked by flags of `type` (or all types), most first, ties by slide order. */
export function topSlides(stats, type = null, limit = 5) {
  const counts = type ? stats.perSlide[type] : stats.totalPerSlide
  const total = counts.reduce((a, b) => a + b, 0)
  return counts
    .map((count, i) => ({ slide: i + 1, count, share: total ? count / total : 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.slide - b.slide)
    .slice(0, limit)
}

/** The type with the most flags on a slide (1-based), or null. */
export function dominantType(stats, slide) {
  let best = null
  for (const id of TYPE_IDS) {
    const n = stats.perSlide[id][slide - 1] ?? 0
    if (n > 0 && (!best || n > best.count)) best = { id, count: n }
  }
  return best
}

/**
 * Flags over lecture time, in buckets sized to the lecture's length.
 * Each bucket also records which slide most of its flags were on.
 */
export function overTime(stats, type = null) {
  const flags = stats.flags.filter((f) => Number.isFinite(f.time) && (!type || f.type === type))
  if (!flags.length || stats.start == null) return { bucketMinutes: 1, buckets: [] }

  const durationMin = Math.max(1, (stats.end - stats.start) / 60000)
  const bucketMinutes = durationMin <= 20 ? 1 : durationMin <= 60 ? 2 : durationMin <= 120 ? 5 : 10
  const count = Math.floor(durationMin / bucketMinutes) + 1
  const buckets = Array.from({ length: count }, (_, i) => ({
    index: i,
    startMin: i * bucketMinutes,
    startTime: stats.start + i * bucketMinutes * 60000,
    count: 0,
    slides: {},
  }))
  for (const f of flags) {
    const b = buckets[Math.floor((f.time - stats.start) / 60000 / bucketMinutes)]
    b.count += 1
    b.slides[f.slide] = (b.slides[f.slide] ?? 0) + 1
  }
  for (const b of buckets) {
    const [slide] = Object.entries(b.slides).sort((x, y) => y[1] - x[1])[0] ?? []
    b.mainSlide = slide ? Number(slide) : null
  }
  return { bucketMinutes, buckets }
}

export function peakBucket(series) {
  return series.buckets.reduce((best, b) => (b.count > (best?.count ?? 0) ? b : best), null)
}

/**
 * Evidence-based suggestions for the next lecture, computed from the counts alone
 * (no AI needed). Each one names the slide and the numbers behind it.
 *
 * @param {ReturnType<typeof buildStats>} stats
 * @param {(slide: number) => string} slideName  e.g. "Slide 5 · The Update Rule"
 */
export function ruleSuggestions(stats, slideName) {
  if (stats.total < 3) return []
  const out = []

  for (const { slide, count, share } of topSlides(stats, null, 3)) {
    if (count < 2) continue
    const dom = dominantType(stats, slide)
    const domShare = dom.count / count
    out.push({
      id: `slide-${slide}`,
      slide,
      type: dom.id,
      title: `${slideName(slide)}: ${TYPE_META[dom.id].advice}`,
      evidence: `${count} flags (${pct(share)} of the lecture's flags), ${
        domShare >= 0.5 ? `mostly "${TYPE_META[dom.id].label}" (${dom.count})` : 'a mix of types'
      }.`,
    })
  }

  const time = overTime(stats)
  const peak = peakBucket(time)
  const avg = stats.total / Math.max(1, time.buckets.length)
  if (peak && time.buckets.length >= 4 && peak.count >= Math.max(3, avg * 2)) {
    out.push({
      id: 'peak',
      slide: peak.mainSlide,
      type: null,
      title: `Pause for a recap around ${minuteLabel(peak.startMin, time.bucketMinutes)}${
        peak.mainSlide ? ` (${slideName(peak.mainSlide)})` : ''
      }.`,
      evidence: `${peak.count} flags in ${time.bucketMinutes === 1 ? 'one minute' : `${time.bucketMinutes} minutes`}, about ${Math.round(
        peak.count / avg,
      )}× the lecture's average. This is where students were most likely to lose the thread.`,
    })
  }

  const [leadType] = [...stats.presentTypes].sort((a, b) => stats.byType[b] - stats.byType[a])
  if (leadType && stats.byType[leadType] / stats.total >= 0.4) {
    out.push({
      id: `type-${leadType}`,
      slide: null,
      type: leadType,
      title: `Across the lecture, "${TYPE_META[leadType].label}" was the most common flag. ${TYPE_META[leadType].advice}`,
      evidence: `${stats.byType[leadType]} of ${stats.total} flags (${pct(stats.byType[leadType] / stats.total)}).`,
    })
  }
  return out
}

export const pct = (x) => `${Math.round(x * 100)}%`

export function minuteLabel(startMin, size = 1) {
  return size === 1 ? `minute ${startMin + 1}` : `minutes ${startMin + 1}–${startMin + size}`
}

/** "10:34 AM" in the viewer's local time. */
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
