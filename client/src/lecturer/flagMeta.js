import { FLAG_TYPES } from '../lockin/useLockIn'

/**
 * Flag types as the lecturer dashboard shows them. Ids match the student app's
 * FLAG_TYPES (that's what's stored as `flagType`); labels come from there too,
 * so renaming a type in one place renames it everywhere.
 *
 * Order matters: it fixes each type's color slot (see --lect-type-* in
 * Lecturer.css) so a type keeps its color whichever types are on screen.
 */
const ORDER = ['confusing', 'example', 'worked_example', 'check_thinking']

const ADVICE = {
  confusing: 'Re-explain it more simply, with a diagram or a step-by-step walkthrough.',
  example: 'Add a concrete real-world application of the idea.',
  worked_example: 'Work through one problem step by step in front of the class.',
  check_thinking: 'Pause for a quick check-in question so students can test their reasoning.',
  other: 'Slow down here and recap before moving on.',
}

// Older or alternative ids that mean the same thing.
const ALIASES = { real_world: 'example' }

export const TYPE_IDS = [...ORDER, 'other']

export const TYPE_META = Object.fromEntries(
  TYPE_IDS.map((id, slot) => [
    id,
    {
      id,
      label: FLAG_TYPES[id]?.label ?? 'Other',
      color: `var(--lect-type-${slot + 1})`,
      advice: ADVICE[id],
    },
  ]),
)

/** Map any stored flagType to one of TYPE_IDS; unknown kinds fold into "Other". */
export function normalizeType(flagType) {
  const id = ALIASES[flagType] ?? flagType
  return ORDER.includes(id) ? id : 'other'
}
