import { FLAG_TYPES, flagTypeId } from '../lockin/useLockIn'

/**
 * Flag types as the lecturer dashboard shows them. Ids match the student app's
 * FLAG_TYPES (that's what's stored as `flagType`); labels come from there too,
 * so renaming a type in one place renames it everywhere.
 *
 * ORDER is how types are listed. Each type also has a fixed color slot (see
 * --lect-type-* in Lecturer.css) so it keeps its color whichever types are on screen.
 */
const ORDER = ['question', 'example', 'worked_example', 'check_thinking']
const COLOR_SLOT = { question: 1, example: 2, worked_example: 3, check_thinking: 4, other: 5 }

const ADVICE = {
  question: 'Re-explain it more simply, with a diagram or a step-by-step walkthrough, and answer the common questions at the start of next lecture.',
  example: 'Add a concrete real-world application of the idea.',
  worked_example: 'Work through one problem step by step in front of the class.',
  check_thinking: 'Pause for a quick check-in question so students can test their reasoning.',
  other: 'Slow down here and recap before moving on.',
}

// Older or alternative ids that mean the same thing.
const ALIASES = { real_world: 'example' }

export const TYPE_IDS = [...ORDER, 'other']

export const TYPE_META = Object.fromEntries(
  TYPE_IDS.map((id) => [
    id,
    {
      id,
      label: FLAG_TYPES[id]?.label ?? 'Other',
      color: `var(--lect-type-${COLOR_SLOT[id]})`,
      advice: ADVICE[id],
    },
  ]),
)

/** Map any stored flagType to one of TYPE_IDS; unknown kinds fold into "Other". */
export function normalizeType(flagType) {
  const id = ALIASES[flagType] ?? flagTypeId(flagType)
  return ORDER.includes(id) ? id : 'other'
}
