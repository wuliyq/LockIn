/**
 * Builds one page of summary notes for a finished lecture: the student's own
 * notes, slide by slide, with their flags, questions, AI answers and catch-ups
 * placed under the part of the notes they relate to.
 *
 * Placement: a flag made by selecting note text goes right after the note line
 * where that text ends. Everything else on a slide (slide-area flags, "?" flags,
 * catch-ups) goes after that slide's notes. Additions keep the order they were made.
 *
 * Pure data in, data out (no AI call), so it works for any saved lecture.
 */
export function buildLectureSummary({ notes = {}, slides = [], flags = [], catchUps = [] }) {
  const additionsBySlide = new Map()
  const add = (slide, addition) => {
    if (!Number.isInteger(slide) || slide < 0) return
    if (!additionsBySlide.has(slide)) additionsBySlide.set(slide, [])
    additionsBySlide.get(slide).push(addition)
  }

  for (const flag of flags) add(slideIndex(flag), flagAddition(flag))
  for (const [index, item] of catchUps.entries()) add(slideIndex(item), catchUpAddition(item, index))

  const slideNumbers = new Set([
    ...Object.entries(notes).filter(([, text]) => text?.trim()).map(([slide]) => Number(slide)),
    ...additionsBySlide.keys(),
  ])

  return [...slideNumbers]
    .filter((slide) => Number.isInteger(slide) && slide >= 0)
    .sort((a, b) => a - b)
    .map((slide) => {
      const title = slideTitle(slides[slide])
      const additions = (additionsBySlide.get(slide) ?? [])
        .sort((a, b) => a.order - b.order)
        // A flag with no selection is saved with the slide title; the heading already says it.
        .map((addition) => (addition.quote && addition.quote === title ? { ...addition, quote: '' } : addition))
      return {
        slide,
        title,
        blocks: placeAdditions(notes[slide] ?? '', additions),
      }
    })
}

/**
 * Split a slide's note into blocks of lines, closing a block after each line that
 * has additions. The last block holds any remaining lines plus the additions that
 * didn't match a specific line.
 */
function placeAdditions(note, additions) {
  const lines = note.replace(/\s+$/, '').split('\n')
  const afterLine = new Map()
  const atEnd = []

  for (const addition of additions) {
    const line = addition.source === 'notes' ? lineContaining(note, addition.selectedText) : -1
    if (line < 0) atEnd.push(addition)
    else afterLine.set(line, [...(afterLine.get(line) ?? []), addition])
  }

  const blocks = []
  let current = []
  lines.forEach((line, index) => {
    current.push(line)
    if (afterLine.has(index)) {
      blocks.push({ text: current.join('\n').trim(), additions: afterLine.get(index) })
      current = []
    }
  })
  const rest = current.join('\n').trim()
  if (rest || atEnd.length) blocks.push({ text: rest, additions: atEnd })
  return blocks
}

/** Index of the note line where `selected` ends, or -1 if it isn't in the note. */
function lineContaining(note, selected) {
  const needle = selected?.trim()
  if (!needle || !note) return -1
  let at = note.indexOf(needle)
  let length = needle.length
  if (at < 0) {
    // Students sometimes edit a line after flagging it: fall back to the opening words.
    const start = needle.slice(0, 40).toLowerCase()
    at = note.toLowerCase().indexOf(start)
    length = start.length
  }
  if (at < 0) return -1
  return note.slice(0, at + length).split('\n').length - 1
}

const FLAG_LABELS = {
  confusing: 'Confusing',
  question: 'Confusing', // saved while the type was briefly called "question"
  example: 'Give an example',
  real_world: 'Give an example',
  worked_example: 'Give an example',
  quick_check: 'Quick check',
  why_it_matters: 'Why it matters',
  check_thinking: 'Check my thinking',
}

function flagAddition(flag) {
  const selectedText = flag.selectedText?.trim() ?? ''
  // Older saves only have `text`, which is the comment or (with no comment) the selection.
  const comment = (flag.studentComment ?? (flag.text !== selectedText ? flag.text : ''))?.trim() ?? ''
  const isSlideArea = /^Highlighted area on slide \d+$/.test(selectedText)
  return {
    id: flag.id ?? `flag-${flag.createdAt ?? flag.timestamp}`,
    kind: 'flag',
    flagType: flag.flagType,
    label: FLAG_LABELS[flag.flagType] ?? 'Flag',
    source: flag.source ?? 'slide',
    selectedText,
    // Quote the selection only when it isn't already right above in the notes.
    quote: flag.source === 'notes' || isSlideArea ? '' : selectedText,
    comment,
    answer: flag.aiAnswer?.trim() ?? '',
    time: flag.createdAt ?? flag.timestamp ?? null,
    order: timeValue(flag.createdAt ?? flag.timestamp),
  }
}

function catchUpAddition(item, index) {
  const points = Array.isArray(item.summary) ? item.summary : [item.summary].filter(Boolean)
  return {
    id: item.id ?? `catch-up-${index}`,
    kind: 'catch-up',
    label: 'Catch-up',
    source: 'transcript',
    points: points.map((point) => String(point).replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
    time: item.timestamp ?? null,
    order: timeValue(item.timestamp),
  }
}

const slideIndex = (item) => (Number.isInteger(item.slide) ? item.slide : Number(item.slideNumber) - 1)
const slideTitle = (slide) => slide?.text?.split('\n', 1)[0].trim() || ''
const timeValue = (value) => (value ? new Date(value).getTime() || 0 : 0)
