import { readFileSync } from "node:fs";
import { defaultSpan, FLAG_TYPES, slideAt } from "../dashboard/spans.js";
import { putSession } from "../sessionStore.js";

/**
 * Loads the hand-written demo lecture into the in-memory session store at boot, so
 * the instructor dashboard has data after every restart. The data is synthetic: say
 * "seeded demo data" when demoing it.
 *
 * The JSON uses "m:ss" times so it stays readable; this turns them into the stored
 * shapes (all times ms since session start, slide indices 0-based):
 *   slides            [{ index, text }]
 *   slideTimeline     [{ index, startMs, endMs }]
 *   transcriptSegments [{ startMs, endMs, text }]
 *   flags             [Flag] with spans filled in by defaultSpan()
 */

const SEED_FILES = ["./demoSession.json"];

export function loadSeed() {
    return SEED_FILES.map((file) => {
        const raw = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
        const session = buildSession(raw);
        putSession(session);
        return session;
    });
}

function buildSession(raw) {
    const { sessionId, title, studentCount } = raw;
    const durationMs = toMs(raw.duration);

    const slides = raw.slides.map((s, index) => ({ index, text: s.text }));
    const slideTimeline = withEnds(
        raw.slides.map((s, index) => ({ index, startMs: toMs(s.start) })),
        durationMs,
    );
    const transcriptSegments = withEnds(
        raw.transcript.map((t) => ({ startMs: toMs(t.start), text: t.text })),
        durationMs,
    );

    const session = { sessionId, title, durationMs, studentCount, slides, slideTimeline, transcriptSegments };

    session.flags = raw.flags.map((f, i) => {
        const clickedAt = toMs(f.at);
        if (!FLAG_TYPES.includes(f.type)) throw new Error(`Seed flag ${i}: unknown type "${f.type}"`);
        if (clickedAt > durationMs) throw new Error(`Seed flag ${i}: ${f.at} is past the end of the lecture`);
        if (!f.student) throw new Error(`Seed flag ${i}: missing student`);

        const flag = {
            id: `${sessionId}-${i}`,
            sessionId,
            type: f.type,
            clickedAt,
            ...defaultSpan({ type: f.type, clickedAt }, session),
            slideIndex: slideAt(slideTimeline, clickedAt)?.index ?? -1,
            studentKey: f.student, // anonymous per-session key, never sent to the client
        };
        if (f.text) flag.studentText = f.text; // never sent to the client unparaphrased
        return flag;
    });

    return session;
}

/** Each item ends where the next starts; the last ends with the lecture. Input must be in time order. */
function withEnds(items, durationMs) {
    return items.map((item, i) => {
        const endMs = items[i + 1]?.startMs ?? durationMs;
        if (endMs < item.startMs) throw new Error(`Seed times out of order at ${formatMs(item.startMs)}`);
        return { ...item, endMs };
    });
}

/** "17:05" → 1_025_000 */
function toMs(time) {
    const m = /^(\d+):([0-5]\d)$/.exec(time ?? "");
    if (!m) throw new Error(`Seed time "${time}" should look like m:ss`);
    return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

function formatMs(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
