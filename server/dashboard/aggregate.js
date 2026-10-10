import { FLAG_TYPES, slideAt } from "./spans.js";

/**
 * Turns a session's flags into what the instructor dashboard shows. Pure functions:
 * no Express, no store, so it can be tested with a hand-written array.
 *
 * Anonymity is enforced here, not in the UI: a flag type only shows in a stretch of
 * the lecture once MIN_STUDENTS different students flagged it there. One student
 * clicking three times is still one student.
 */

export const BUCKET_MS = 30_000;
export const MIN_STUDENTS = 3;
export const MAX_HOTSPOTS = 5;

/**
 * @param {{ flags: Array, durationMs?: number, slideTimeline?: Array }} session
 * @returns {{ durationMs: number, byType: Object, timeline: Array, hotspots: Array }}
 */
export function aggregate(session, { bucketMs = BUCKET_MS } = {}) {
    const { flags = [], slideTimeline = [] } = session;
    // Live sessions may not know their length yet; the latest flag is the best guess.
    const durationMs = session.durationMs ?? Math.max(0, ...flags.map((f) => f.coversTo));

    const buckets = bin(flags, durationMs, bucketMs);
    gate(buckets);

    return {
        durationMs,
        byType: countByType(flags),
        timeline: buckets.map(({ startMs, endMs, byType, total }) => ({ startMs, endMs, byType, total })),
        hotspots: findHotspots(buckets, flags, slideTimeline),
    };
}

/**
 * Splits the lecture into fixed buckets. Each flag spreads a weight of 1 evenly across
 * the buckets its span touches, so a 90s "confusing" flag adds 1/3 to three buckets
 * while a 5-minute catch-up adds 1/10 to ten: sharp signals stay sharp, vague ones
 * stay vague.
 */
export function bin(flags, durationMs, bucketMs = BUCKET_MS) {
    const n = Math.ceil(durationMs / bucketMs);
    const buckets = Array.from({ length: n }, (_, i) => ({
        startMs: i * bucketMs,
        endMs: Math.min((i + 1) * bucketMs, durationMs),
        byType: zeroes(),
        total: 0,
        // Per type: who and which flags landed here. Used for gating; never serialised.
        students: Object.fromEntries(FLAG_TYPES.map((t) => [t, new Set()])),
        flagIds: Object.fromEntries(FLAG_TYPES.map((t) => [t, new Set()])),
    }));
    if (n === 0) return buckets;

    for (const flag of flags) {
        const first = clampIndex(Math.floor(flag.coversFrom / bucketMs), n);
        // A span ending exactly on a boundary doesn't touch the next bucket.
        const last = Math.max(first, clampIndex(Math.ceil(flag.coversTo / bucketMs) - 1, n));
        const weight = 1 / (last - first + 1);

        for (let i = first; i <= last; i++) {
            const b = buckets[i];
            b.byType[flag.type] += weight;
            b.total += weight;
            b.students[flag.type].add(studentOf(flag));
            b.flagIds[flag.type].add(flag.id);
        }
    }
    return buckets;
}

/** Zeroes every (bucket, type) pair that fewer than MIN_STUDENTS students contributed to. */
export function gate(buckets) {
    for (const b of buckets) {
        for (const type of FLAG_TYPES) {
            if (b.students[type].size < MIN_STUDENTS) {
                b.byType[type] = 0;
                b.students[type].clear();
                b.flagIds[type].clear();
            }
        }
        b.total = round(FLAG_TYPES.reduce((sum, t) => sum + b.byType[t], 0));
        for (const type of FLAG_TYPES) b.byType[type] = round(b.byType[type]);
    }
    return buckets;
}

/**
 * Flag counts per type over the whole lecture, for the pie. A type only counts once
 * MIN_STUDENTS different students used it, so "1 worked example" can't single anyone out.
 */
export function countByType(flags) {
    const counts = zeroes();
    for (const type of FLAG_TYPES) {
        const ofType = flags.filter((f) => f.type === type);
        if (new Set(ofType.map(studentOf)).size >= MIN_STUDENTS) counts[type] = ofType.length;
    }
    return counts;
}

/**
 * Contiguous runs of buckets that survived gating. These are the findings, so keep
 * the biggest few and return them in lecture order.
 */
export function findHotspots(gatedBuckets, flags, slideTimeline = []) {
    const runs = [];
    let run = null;
    for (const b of gatedBuckets) {
        if (b.total > 0) {
            run ??= { buckets: [] };
            run.buckets.push(b);
        } else if (run) {
            runs.push(run);
            run = null;
        }
    }
    if (run) runs.push(run);

    const byId = new Map(flags.map((f) => [f.id, f]));
    return runs
        .map(({ buckets }) => {
            const ids = new Set(buckets.flatMap((b) => FLAG_TYPES.flatMap((t) => [...b.flagIds[t]])));
            const inRun = [...ids].map((id) => byId.get(id));
            const byType = zeroes();
            for (const f of inRun) byType[f.type]++;
            const peak = buckets.reduce((best, b) => (b.total > best.total ? b : best));

            return {
                startMs: buckets[0].startMs,
                endMs: buckets[buckets.length - 1].endMs,
                // Ties go to the earlier type in FLAG_TYPES.
                dominantType: FLAG_TYPES.reduce((best, t) => (byType[t] > byType[best] ? t : best)),
                total: inRun.length,
                students: new Set(inRun.map(studentOf)).size,
                byType,
                slideIndex: slideAt(slideTimeline, peak.startMs)?.index ?? -1,
            };
        })
        .sort((a, b) => b.total - a.total || a.startMs - b.startMs)
        .slice(0, MAX_HOTSPOTS)
        .sort((a, b) => a.startMs - b.startMs);
}

// Flags without a studentKey each count as a separate student.
const studentOf = (flag) => flag.studentKey ?? flag.id;
const zeroes = () => Object.fromEntries(FLAG_TYPES.map((t) => [t, 0]));
const clampIndex = (i, n) => Math.min(Math.max(i, 0), n - 1);
const round = (x) => Math.round(x * 1000) / 1000;
