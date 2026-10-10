/**
 * The kinds of flag a student can raise. `id` is what's stored and sent to the
 * server as `flagType`; the lecturer dashboard groups by it, so don't rename ids.
 *
 * `quick` types save in one tap (no question box); the rest open the composer,
 * where `prompt` is the placeholder for the student's question.
 * Colors are the --flag-type-* tokens in index.css.
 */
export const FLAG_TYPES = [
  {
    id: 'lost',
    label: '?',
    name: 'Lost here',
    description: 'Mark this moment, no comment needed',
    quick: true,
  },
  {
    id: 'confusing',
    label: 'Confusing',
    name: 'Confusing',
    description: 'I find this part confusing',
    prompt: "What's confusing about it?",
  },
  {
    id: 'real_world',
    label: 'Real-world example',
    name: 'Real-world example',
    description: 'I want a real-world application or example',
    prompt: 'What would you like a real-world example of?',
  },
  {
    id: 'worked_example',
    label: 'Worked example',
    name: 'Worked example',
    description: 'Give me a worked example',
    prompt: 'Which step or kind of problem?',
  },
]

export const FLAG_TYPE_BY_ID = Object.fromEntries(FLAG_TYPES.map((type) => [type.id, type]))

/** Where the highlighted text came from. */
export const SOURCE_LABELS = {
  notes: 'your notes',
  slide: 'the slide',
  transcript: 'the transcript',
}

/** Longest highlight we keep; enough context for the AI without storing whole notes. */
export const MAX_QUOTE_LENGTH = 500

/**
 * Build a flag record. Field names match the server's POST /api/flags body
 * (slideNumber, flagType, selectedText, studentComment, aiAnswer).
 *
 * @param {Object} draft
 * @param {string} draft.deck          DeckContext filename the flag belongs to
 * @param {number} draft.slideNumber   1-based, as shown to students and lecturers
 * @param {string} draft.flagType      one of FLAG_TYPES ids
 * @param {string} draft.timestamp     ISO time of the moment flagged (when the button was pressed)
 * @param {'notes'|'slide'|'transcript'|null} [draft.source]
 * @param {string} [draft.selectedText]
 * @param {string} [draft.studentComment]
 */
export function createFlag({ deck, slideNumber, flagType, timestamp, source = null, selectedText = '', studentComment = '' }) {
  return {
    id: crypto.randomUUID(),
    deck,
    slideNumber,
    flagType,
    timestamp,
    source,
    selectedText: selectedText.trim().slice(0, MAX_QUOTE_LENGTH),
    studentComment: studentComment.trim(),
    aiAnswer: null, // filled in once AI answers are wired up
  }
}

/** "10:34 AM" (or "10:34:12 AM" with seconds) in the student's local time. */
export function formatFlagTime(iso, { seconds = false } = {}) {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds && { second: '2-digit' }),
  })
}
