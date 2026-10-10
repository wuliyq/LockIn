/**
 * Default spans for flags. Students click after realising they're lost, so a click
 * time always sits downstream of the cause; each flag covers a span before it.
 *
 * Used by the seed loader now, and by /api/flags as a fallback when a client sends
 * only clickedAt. All times are ms since session start.
 */

export const FLAG_TYPES = ["catch_up", "confusing", "real_world", "worked_example"];

// How far back a click reaches. Real-world and worked-example requests attach to a
// concept, so they cover the whole slide instead.
const LOOKBACK_MS = {
    catch_up: 5 * 60_000, // the Catch Me Up summary window: broad, low confidence
    confusing: 90_000, // sharp, the most precise signal
};

/**
 * The slide on screen at a moment, from a session's slide timeline.
 *
 * @param {Array<{ index: number, startMs: number, endMs: number }>} slideTimeline
 *   sorted by startMs; a slide revisited later appears twice
 * @returns {{ index: number, startMs: number, endMs: number } | null}
 */
export function slideAt(slideTimeline, ms) {
    return slideTimeline.findLast((s) => s.startMs <= ms) ?? null;
}

/**
 * @param {{ type: string, clickedAt: number }} flag
 * @param {{ slideTimeline?: Array }} session
 * @returns {{ coversFrom: number, coversTo: number }}
 */
export function defaultSpan({ type, clickedAt }, { slideTimeline = [] } = {}) {
    if (type in LOOKBACK_MS) {
        return { coversFrom: Math.max(clickedAt - LOOKBACK_MS[type], 0), coversTo: clickedAt };
    }

    // A live slide has no end yet, so it covers up to the click.
    const slide = slideAt(slideTimeline, clickedAt);
    if (slide) {
        return { coversFrom: slide.startMs, coversTo: Math.max(slide.endMs ?? clickedAt, clickedAt) };
    }

    // No deck: fall back to the broad catch-up window.
    return { coversFrom: Math.max(clickedAt - LOOKBACK_MS.catch_up, 0), coversTo: clickedAt };
}
