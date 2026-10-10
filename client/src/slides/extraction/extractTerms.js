import { WORD_RANK } from './commonWords'

const MAX_TERMS = 40

// A word is jargon if it's outside the top 5,000 English words. Repeated lowercase
// phrases need one such word ("binary search tree"); Capitalized phrases are already
// a strong signal, so one word outside the top 2,000 is enough ("Supreme Court").
const RARE_WORD_RANK = 5000
const RARE_CAP_PHRASE_RANK = 2000

// Function words: a phrase can't start or end with one ("of the", "the cell").
const STOPWORDS = new Set(
  ('a an the and or but nor so of to in on at by for with from into onto over under ' +
    'about as than then that this these those there here it its is are was were be been ' +
    'being am do does did has have had can could will would shall should may might must ' +
    'not no yes if when while where which who whom whose what why how all any each every ' +
    'some such both either neither more most less least very also just only own same ' +
    'other another we you they he she i me my our your their his her them us via per vs etc ' +
    'through across within between during without after before upon among toward towards ' +
    'against along around beyond using like out up down off').split(' '),
)

// Classroom and academic-register words. The word list comes from spoken dialogue,
// where these are rare, but they're never lecture-specific content.
const LECTURE_FILLER = new Set(
  ('overview summary introduction intro agenda outline recap review lecture lectures slide ' +
    'slides chapter section notes reading readings example examples question questions ' +
    'objective objectives goal goals topic topics today part figure fig table homework hw ' +
    'exam exams quiz midterm final assignment due week prof professor course syllabus ' +
    'conclusion conclusions references appendix definition definitions key terms concepts ' +
    'learning page pages cont continued component components respectively typically ' +
    'approximately furthermore whereas thus hence overall additionally consequently ' +
    'consist consists define defined defines convert converted converts yield yields ' +
    'handout handouts ' +
    // Written-register verbs/adjectives: rare in dialogue, generic in any subject.
    'occur occurs occurred occurring usable discard discards exceed exceeds disrupt disrupts ' +
    'collapse collapses collapsing indicate indicates involve involves obtain obtains utilize ' +
    'utilizes facilitate facilitates demonstrate demonstrates illustrate illustrates comprise ' +
    'comprises denote denotes whereby payoff').split(' '),
)

// Short all-caps tokens that aren't domain acronyms.
const NOT_ACRONYMS = new Set(['OK', 'AM', 'PM', 'US', 'USA', 'TV', 'PDF', 'FAQ', 'ID', 'TBD', 'TA', 'VS'])

// Plain lowercase words seen in the current document ("app", "browser"), so diagram
// labels like APP or BROWSER aren't mistaken for acronyms. Set per extractTerms call.
let lowercaseWords = new Set()

// Source weights: how strongly each signal suggests a real term.
const WEIGHT = { title: 6, definition: 5, acronym: 4, capPhrase: 4, phrase: 4, rareWord: 2 }

// Rank of a word or its base form, so "processes", "produced" and "typically" count
// as common like "process", "produce" and "typical".
const rank = (word) => {
  const w = word.toLowerCase()
  const forms = [w]
  if (w.endsWith('ies')) forms.push(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) forms.push(w.slice(0, -2))
  if (w.endsWith('s')) forms.push(w.slice(0, -1))
  if (w.endsWith('ed')) forms.push(w.slice(0, -2), w.slice(0, -1))
  if (w.endsWith('ing')) forms.push(w.slice(0, -3), w.slice(0, -3) + 'e')
  if (w.endsWith('ly')) forms.push(w.slice(0, -2))
  return Math.min(...forms.map((f) => WORD_RANK.get(f) ?? Infinity))
}
const isFiller = (word) => LECTURE_FILLER.has(word.toLowerCase())
const isStop = (word) => STOPWORDS.has(word.toLowerCase())
const isRareWord = (word) => word.length >= 4 && rank(word) > RARE_WORD_RANK && !isFiller(word)
const hasRareWord = (words, threshold) => words.some((w) => rank(w) > threshold && !isFiller(w))

/**
 * Pull domain vocabulary from extracted page lines, for Gemini prompts (Role 3)
 * and transcription priming (Role 4). Pure function: no pdf.js, no DOM.
 *
 * @param {Array<Array<{ text: string, size: number, y: number }>>} pages  lines per page;
 *   y is height on the page from 0 (bottom) to 1 (top)
 * @returns {string[]} up to MAX_TERMS terms, strongest first
 */
export function extractTerms(pages) {
  const contentPages = removeBoilerplate(pages)
  lowercaseWords = collectLowercaseWords(contentPages)
  const candidates = new Map() // dedupe key → { term, weight, pages: Set, count, order, alwaysCapitalized }

  const add = (term, source, pageIndex) => {
    term = term.trim()
    if (term.length < 2) return
    const key = dedupeKey(term)
    let c = candidates.get(key)
    if (!c) {
      c = { term, weight: 0, pages: new Set(), count: 0, order: candidates.size, alwaysCapitalized: true }
      candidates.set(key, c)
    }
    if (source === 'rareWord') c.alwaysCapitalized &&= /^\p{Lu}/u.test(term)
    // Keep the spelling from the strongest source (e.g. "Krebs Cycle" over "krebs cycle").
    if (WEIGHT[source] > c.weight) {
      c.weight = WEIGHT[source]
      c.term = term
    }
    c.pages.add(pageIndex)
    c.count++
  }

  const phraseCounts = new Map() // dedupe key → { display, count, pages: Set }
  // Acronyms written in normal-case text, used to fix ALL-CAPS titles ("WHAT IS JSX").
  const acronymsSeen = new Set()

  contentPages.forEach((lines, pageIndex) => {
    const title = findTitle(lines)
    if (title) add(title, 'title', pageIndex)

    for (const line of lines) {
      if (looksLikeCode(line.text)) continue
      const text = stripNoise(line.text)

      const defined = matchDefinition(text)
      if (defined) add(defined, 'definition', pageIndex)

      const shouting = isAllCapsLine(text)
      for (const chunk of splitChunks(text)) {
        const words = tokenize(chunk)

        for (const word of words) {
          if (!shouting && isAcronym(word)) {
            add(word, 'acronym', pageIndex)
            acronymsSeen.add(word)
          }
          else if (isRareWord(word)) add(shouting ? word.toLowerCase() : word, 'rareWord', pageIndex)
        }

        if (!shouting) {
          for (const phrase of capitalizedPhrases(words)) add(phrase, 'capPhrase', pageIndex)
        }

        countPhrases(words, phraseCounts, pageIndex)
      }
    }
  })

  for (const { display: phrase, count, pages: phrasePages } of keepRepeatedPhrases(phraseCounts)) {
    for (const pageIndex of phrasePages) add(phrase, 'phrase', pageIndex)
    // add() counted once per page; top up to the true occurrence count.
    candidates.get(dedupeKey(phrase)).count += count - phrasePages.size
  }

  // A lone rare word adds nothing when a multi-word term already contains it
  // ("proton" next to "proton gradient"), so don't spend a slot on it.
  const wordsInPhrases = new Set(
    [...candidates.values()]
      .filter((c) => c.weight > WEIGHT.rareWord && c.term.includes(' '))
      .flatMap((c) => dedupeKey(c.term).split(' ')),
  )

  return [...candidates.entries()]
    .filter(([key, c]) => !(c.weight === WEIGHT.rareWord && key.split(' ').every((w) => wordsInPhrases.has(w))))
    .map(([, c]) => ({ ...c, score: c.weight + 1.5 * (c.pages.size - 1) + 0.2 * Math.min(c.count, 10) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_TERMS)
    // Single words: "Heisenberg" (always capitalized) vs "glucose" (capitalized only at line start).
    .map((c) => (c.weight === WEIGHT.rareWord && !c.alwaysCapitalized ? c.term.toLowerCase() : c.term))
    .map((term) => (isAllCapsLine(term) && term.includes(' ') ? titleCase(term, acronymsSeen) : term))
}

/**
 * Drop running headers/footers: short lines in the top or bottom margin that repeat
 * on more than half the pages, ignoring digits so "Page 3 of 10" matches "Page 4 of 10".
 * Body text is never touched, even if a sentence repeats.
 */
function removeBoilerplate(pages) {
  // Spaces are ignored too: PowerPoint sometimes splits a footer word ("Slid" + "e").
  const norm = (text) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, '')
  const inMargin = (l) => l.y < 0.12 || l.y > 0.9
  const isFurniture = (l) => l.text.split(' ').length <= 10 && inMargin(l)

  const pagesWithLine = new Map()
  for (const lines of pages) {
    for (const key of new Set(lines.filter(isFurniture).map((l) => norm(l.text)))) {
      pagesWithLine.set(key, (pagesWithLine.get(key) ?? 0) + 1)
    }
  }

  const boilerplate = new Set(
    [...pagesWithLine].filter(([, n]) => n >= 2 && n > pages.length / 2).map(([key]) => key),
  )
  // A narrow footer box can wrap "Slide 3" into scraps ("Slid", "e 3") that differ
  // page to page; tiny bottom-margin fragments are never vocabulary.
  const isFooterScrap = (l) => l.y < 0.12 && (l.text.match(/\p{L}/gu) ?? []).length <= 5
  return pages.map((lines) =>
    lines.filter((l) => !(isFurniture(l) && boilerplate.has(norm(l.text))) && !isFooterScrap(l)),
  )
}

/** Largest-font line on the page, if it clearly stands out and isn't generic. */
function findTitle(lines) {
  if (lines.length < 2) return null
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)]
  const top = lines.reduce((best, l) => (l.size > best.size ? l : best))
  if (top.size < median * 1.2) return null

  let title = stripNoise(top.text)
    .trim()
    .replace(/^(\d+[.)]|[IVX]+\.)\s*/, '') // "3. " / "IV. "
    .replace(/\s*\((cont\.?|continued|part\s*\d+)\)\s*$/i, '')
  // "Glycolysis: glucose to pyruvate" → "Glycolysis"
  const beforeColon = title.split(':')[0]
  if (beforeColon !== title && tokenize(beforeColon).length <= 4) title = beforeColon
  // "The Krebs Cycle" → "Krebs Cycle", so it matches the same phrase in body text.
  title = title.trim().replace(/^(the|a|an)\s+/i, '')

  const words = tokenize(title)
  if (words.length === 0 || words.length > 6 || title.length > 60) return null
  // All-everyday titles ("Any Questions?", "Overview") aren't terms.
  if (!words.some((w) => isRareWord(w) || isAcronym(w))) return null
  return title
}

/** "Kinase: an enzyme…", "Allele – a variant…", "Entropy is a measure…" → the defined term. */
function matchDefinition(text) {
  const m = text.match(/^(\p{L}[\p{L}\p{N}'-]*(?:\s+\p{L}[\p{L}\p{N}'-]*){0,3})\s*(?::|\s[-–—]\s|\s(?:is|are|refers to|means)\s)/u)
  if (!m) return null
  const words = tokenize(m[1])
  while (words.length && isStop(words[0])) words.shift()
  while (words.length && isStop(words[words.length - 1])) words.pop()
  if (words.length === 0 || !words.some((w) => isRareWord(w) || isAcronym(w))) return null
  return words.join(' ')
}

/** ATP, NADH, FADH2, CO2, mRNA, acetyl-CoA. Skips roman numerals and common all-caps words. */
function isAcronym(word) {
  if (word.length < 2 || word.length > 10 || NOT_ACRONYMS.has(word)) return false
  if (/^[IVXLC]+$/.test(word)) return false
  if (/^\p{Lu}\p{Ll}+(-\p{Lu}\p{Ll}+)+$/u.test(word)) return false // "Red-Black"
  const uppers = (word.match(/\p{Lu}/gu) ?? []).length
  const hasDigit = /\d/.test(word)
  if (uppers < 2 && !(uppers >= 1 && hasDigit)) return false
  if (hasDigit && (word.match(/\p{L}/gu) ?? []).length < 2) return false
  // Written in lowercase elsewhere in the document: it's a word in capitals (a label).
  if (word.length >= 3 && lowercaseWords.has(word.toLowerCase())) return false
  // "ENERGY" in a shouted sentence is just a word; short ones (DNA) stay acronyms.
  if (word.length >= 4 && word === word.toUpperCase() && rank(word) <= RARE_WORD_RANK) return false
  return true
}

/** Lines written in all caps ("CELLULAR RESPIRATION") would make every word look like an acronym. */
function isAllCapsLine(text) {
  const letters = text.replace(/[^\p{L}]/gu, '')
  return letters.length >= 8 && letters === letters.toUpperCase()
}

/** Runs of 2–4 Capitalized words ("Krebs Cycle", "Law of Mass Action"). */
function capitalizedPhrases(words) {
  const phrases = []
  const isCap = (w) => /^\p{Lu}\p{Ll}/u.test(w) || /^\p{Lu}[\p{Lu}\p{N}]+$/u.test(w)
  const isTitleWord = (w) => /^\p{Lu}\p{Ll}/u.test(w)
  const connectors = new Set(['of', 'and', 'de', 'von', 'van'])

  let run = []
  const flush = () => {
    while (run.length && !isTitleWord(run[run.length - 1])) run.pop()
    while (run.length && STOPWORDS.has(run[0].toLowerCase())) run.shift()
    const titled = run.some(isTitleWord) // "VS Code" yes, "HTML CSS" no
    if (run.length >= 2 && run.length <= 4 && titled && hasRareWord(run, RARE_CAP_PHRASE_RANK)) {
      phrases.push(run.join(' '))
    }
    run = []
  }
  for (const w of words) {
    if (isCap(w) || (run.length && connectors.has(w))) run.push(w)
    else flush()
  }
  flush()
  return phrases
}

/** Count 2- and 3-word sequences for lowercase jargon ("oxidative phosphorylation"). */
function countPhrases(words, phraseCounts, pageIndex) {
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n)
      const first = gram[0]
      const last = gram[n - 1]
      if (isStop(first) || isStop(last) || isFiller(first) || isFiller(last)) continue
      // Only "of/and/to" belong inside a term ("conservation of energy"), not "energy through oxidative".
      if (gram.slice(1, -1).some((w) => isStop(w) && !['of', 'and', 'to'].includes(w.toLowerCase()))) continue
      if (gram.some((w) => w.length < 2)) continue // "log n"
      // The rare word must be a real word, not an acronym already captured ("make ATP").
      if (!hasRareWord(gram.filter((w) => !isAcronym(w)), RARE_WORD_RANK)) continue
      const display = gram.map((w) => (isAcronym(w) ? w : w.toLowerCase())).join(' ') // "ATP synthase"
      const key = dedupeKey(display) // "binary search trees" counts toward "binary search tree"
      const entry = phraseCounts.get(key) ?? { display, count: 0, pages: new Set() }
      entry.count++
      entry.pages.add(pageIndex)
      phraseCounts.set(key, entry)
    }
  }
}

/**
 * Keep phrases seen 2+ times. Prefer the longer phrase: drop a 2-word phrase
 * that only ever appears inside a kept 3-word phrase.
 */
function keepRepeatedPhrases(phraseCounts) {
  const repeated = [...phraseCounts].filter(([, e]) => e.count >= 2)
  const trigrams = repeated.filter(([key]) => key.split(' ').length === 3)
  return repeated
    .filter(([key, e]) => {
      if (key.split(' ').length === 3) return true
      return !trigrams.some(([tri, t]) => tri.includes(key) && t.count >= e.count)
    })
    .map(([, e]) => e)
}

// URLs, emails and course codes ("BIOL 101", "COMP 210") aren't vocabulary.
const stripNoise = (text) =>
  text
    .replace(/\S+@\S+|https?:\/\/\S+|www\.\S+|\S+\.(com|org|edu|gov|net|io)\b\S*/gi, ' ')
    .replace(/\b[A-Z]{2,5}\s?\d{3}[A-Z]?\b/g, ' ')

// Phrases never cross punctuation.
const splitChunks = (text) => text.split(/[.,;:!?()[\]{}"“”|•·/\\–—]+|\s-\s/)

// Words (any alphabet, so "Schrödinger" stays whole), keeping internal hyphens,
// apostrophes and digits (FADH2, acetyl-CoA).
const tokenize = (text) =>
  (text.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).map((w) => w.replace(/['’]s$/i, '').replace(/['’-]+$/, ''))

// Case-insensitive, light plural folding: "Kinases" and "kinase" are one term.
const dedupeKey = (term) =>
  term
    .toLowerCase()
    .replace(/[-\s]+/g, ' ')
    .replace(/(?<![su])s\b/g, '')

/** Lines of code on a slide (HTML tags, JS, CSS) aren't vocabulary. Prose like "a < b" is kept. */
function looksLikeCode(text) {
  if (/<[!/]?[a-z][\w-]*[\s>]/i.test(text)) return true // <meta ...>, </h1>, <!DOCTYPE
  if (/=>|\(\)\s*[{;]|^\s*(import|export|const|let|function|return)\b/.test(text)) return true
  return (text.match(/[{};=]/g) ?? []).length >= 2
}

/** "TRADITIONAL WEB APPLICATIONS" → "Traditional Web Applications"; known acronyms stay upper. */
function titleCase(text, acronyms) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs'])
  return text
    .split(' ')
    .map((word, i) => {
      if (acronyms.has(word)) return word
      const lower = word.toLowerCase()
      if (i > 0 && small.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/**
 * Whole lowercase words from prose ("app" in "React app"). File names and code are
 * skipped, so "index.html" doesn't make HTML look like an ordinary word.
 */
function collectLowercaseWords(pages) {
  const words = new Set()
  for (const lines of pages) {
    for (const line of lines) {
      if (looksLikeCode(line.text)) continue
      for (const raw of line.text.split(/\s+/)) {
        const word = raw.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, '')
        if (/^\p{Ll}+$/u.test(word)) words.add(word)
      }
    }
  }
  return words
}
