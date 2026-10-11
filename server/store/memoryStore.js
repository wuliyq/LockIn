import {
    BUCKET_MINUTES,
    MESSAGES,
    MIN_STUDENTS,
    StoreError,
    asJson,
    dateOf,
    lectureDateOf,
    normalizeCode,
    optionalText,
    requireFlagType,
    requireId,
    requireLectureDate,
    requireText,
    slideIndexOf,
    sourceOf,
} from "./shared.js";

/**
 * In-memory store: the fallback when Postgres misbehaves (USE_MEMORY=1). Same
 * functions, return shapes and errors as pgStore.js; store.test.js runs one suite
 * against both. Everything is lost on restart.
 *
 * `startedAt` (startLecture) and `receivedAt` (addFlag) exist for the seed and tests
 * only. Routes must never pass client times: the server clock is the only clock.
 */

const users = new Set();
const classes = new Map(); // id -> class
const lectures = new Map(); // id -> lecture (snapshot stored as JSON, like JSONB)
const flags = []; // ids are strings, like Postgres BIGSERIAL through pg
const segments = [];
let nextFlagId = 1;
let nextSegmentId = 1;

const now = () => new Date().toISOString();
// Copies out, so callers can't mutate stored rows (Postgres hands back fresh rows too).
const copy = (lecture) => ({ ...lecture, snapshot: asJson(lecture.snapshot) });
const byStartDesc = (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);
const byStartAsc = (a, b) => a.startedAt.localeCompare(b.startedAt) || a.order - b.order;

export async function ensureUser(userId) {
    const id = requireId(userId, "userId");
    users.add(id);
    return { id };
}

export async function createClass({ lecturerId, title, code } = {}) {
    const lecturer = requireId(lecturerId, "lecturerId");
    const classTitle = requireText(title, "title");
    const classCode = normalizeCode(code);
    if (!classCode) throw new StoreError("invalid", "code is required.");
    if ([...classes.values()].some((c) => c.code === classCode)) {
        throw new StoreError("conflict", MESSAGES.classCodeTaken);
    }

    await ensureUser(lecturer);
    const created = { id: crypto.randomUUID(), lecturerId: lecturer, title: classTitle, code: classCode, createdAt: now() };
    classes.set(created.id, created);
    return { ...created };
}

export async function findClassByCode(code) {
    const classCode = normalizeCode(code);
    if (!classCode) return null;
    const found = [...classes.values()].find((c) => c.code === classCode);
    return found ? { ...found } : null;
}

export async function startLecture({ studentId, classCode, title, filename, deckHash, startedAt: at } = {}) {
    const student = requireId(studentId, "studentId");
    let classId = null;
    if (normalizeCode(classCode)) {
        const found = await findClassByCode(classCode);
        if (!found) throw new StoreError("not_found", `No class with code ${normalizeCode(classCode)}.`);
        classId = found.id;
    }

    const startedAt = dateOf(at, "startedAt");
    await ensureUser(student);
    const lecture = {
        id: crypto.randomUUID(),
        studentId: student,
        classId,
        title: optionalText(title),
        filename: optionalText(filename),
        deckHash: optionalText(deckHash),
        startedAt: startedAt.toISOString(),
        endedAt: null,
        lectureDate: lectureDateOf(startedAt),
        snapshot: null,
        updatedAt: startedAt.toISOString(),
    };
    lectures.set(lecture.id, lecture);
    return copy(lecture);
}

export async function getLecture(lectureId) {
    const id = requireId(lectureId, "lectureId");
    const lecture = lectures.get(id);
    return lecture ? copy(lecture) : null;
}

export async function updateLecture(lectureId, changes = {}) {
    const id = requireId(lectureId, "lectureId");
    const lecture = lectures.get(id);
    // Validate everything before touching the row, as one UPDATE statement would.
    const next = { ...lecture };
    if (changes.title !== undefined) next.title = optionalText(changes.title);
    if (changes.endedAt !== undefined) {
        next.endedAt = changes.endedAt === null ? null : dateOf(changes.endedAt, "endedAt").toISOString();
    }
    if (changes.snapshot !== undefined) next.snapshot = asJson(changes.snapshot);
    if (!lecture) throw new StoreError("not_found", MESSAGES.lectureNotFound);

    next.updatedAt = now();
    lectures.set(id, next);
    return copy(next);
}

export async function listLectures(studentId) {
    const student = requireId(studentId, "studentId");
    return [...lectures.values()]
        .filter((l) => l.studentId === student)
        .sort(byStartDesc)
        .map((l) => ({
            id: l.id,
            title: l.title,
            filename: l.filename,
            startedAt: l.startedAt,
            endedAt: l.endedAt,
            lectureDate: l.lectureDate,
            classTitle: classes.get(l.classId)?.title ?? null,
            flagCount: flags.filter((f) => f.sessionId === l.id).length,
        }));
}

export async function addFlag(sessionId, flag = {}) {
    const id = requireId(sessionId, "sessionId");
    const saved = {
        id: String(nextFlagId),
        sessionId: id,
        type: requireFlagType(flag.type),
        slideIndex: slideIndexOf(flag.slideIndex),
        source: sourceOf(flag.source),
        selectedText: optionalText(flag.selectedText),
        studentText: optionalText(flag.studentText),
        aiAnswer: optionalText(flag.aiAnswer),
        receivedAt: dateOf(flag.receivedAt, "receivedAt").toISOString(),
    };
    if (!lectures.has(id)) throw new StoreError("not_found", MESSAGES.lectureNotFound);

    nextFlagId++;
    flags.push(saved);
    return { ...saved };
}

export async function addTranscriptSegment(sessionId, segment = {}) {
    const id = requireId(sessionId, "sessionId");
    const text = requireText(segment.text, "text");
    const endedAt = dateOf(segment.endedAt, "endedAt");
    const startedAt = dateOf(segment.startedAt, "startedAt", endedAt);
    if (startedAt > endedAt) throw new StoreError("invalid", "startedAt must not be after endedAt.");
    const slideIndex = slideIndexOf(segment.slideIndex);
    if (!lectures.has(id)) throw new StoreError("not_found", MESSAGES.lectureNotFound);

    const saved = {
        id: String(nextSegmentId++),
        sessionId: id,
        slideIndex,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        text,
    };
    segments.push({ ...saved, order: segments.length });
    return saved;
}

export async function getRecentTranscript(sessionId, slideIndex, maxSegments = 4) {
    const id = requireId(sessionId, "sessionId");
    const slide = slideIndexOf(slideIndex);
    return segments
        .filter((s) => s.sessionId === id && s.slideIndex === slide)
        .sort(byStartAsc)
        .slice(-maxSegments)
        .map((s) => s.text)
        .join(" ");
}

// ── Lecturer views ───────────────────────────────────────────────────────────
// Mirrors the SQL in pgStore.js step for step: same room, same deck choice, same gate
// at MIN_STUDENTS distinct students, same order and tie-breaks.

// Postgres orders these columns with COLLATE "C" (plain code-unit order), not locale order.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byFlagId = (a, b) => Number(a.id) - Number(b.id);

/** Every lecture in a class on one date. */
function roomOf(classId, lectureDate) {
    const id = requireId(classId, "classId");
    const date = requireLectureDate(lectureDate);
    return [...lectures.values()].filter((l) => l.classId === id && l.lectureDate === date);
}

/** The room's lectures on its most common deck (all of them if no deck hashes). */
function onDeck(room) {
    const studentsByDeck = new Map();
    for (const l of room) {
        if (l.deckHash === null) continue;
        if (!studentsByDeck.has(l.deckHash)) studentsByDeck.set(l.deckHash, new Set());
        studentsByDeck.get(l.deckHash).add(l.studentId);
    }
    if (studentsByDeck.size === 0) return room;
    const [deck] = [...studentsByDeck].sort(([a, sa], [b, sb]) => sb.size - sa.size || byCode(a, b))[0];
    return room.filter((l) => l.deckHash === deck);
}

/** Flags in these lectures, each with its lecture's student. */
function flagsOf(roomLectures) {
    const studentOf = new Map(roomLectures.map((l) => [l.id, l.studentId]));
    return flags
        .filter((f) => studentOf.has(f.sessionId))
        .map((f) => ({ ...f, studentId: studentOf.get(f.sessionId) }));
}

/** GROUP BY keyOf, HAVING count(DISTINCT student) >= MIN_STUDENTS. */
function gatedGroups(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify(keyOf(row));
        if (!groups.has(key)) groups.set(key, { first: row, flags: 0, students: new Set() });
        const group = groups.get(key);
        group.flags++;
        group.students.add(row.studentId);
    }
    return [...groups.values()]
        .filter((g) => g.students.size >= MIN_STUDENTS)
        .map((g) => ({ row: g.first, flags: g.flags, students: g.students.size }));
}

export async function listLectureDates(classId) {
    const id = requireId(classId, "classId");
    const byDate = new Map();
    for (const l of lectures.values()) {
        if (l.classId !== id) continue;
        if (!byDate.has(l.lectureDate)) byDate.set(l.lectureDate, { students: new Set(), flags: 0 });
        const day = byDate.get(l.lectureDate);
        day.students.add(l.studentId);
        day.flags += flags.filter((f) => f.sessionId === l.id).length;
    }
    return [...byDate]
        .sort(([a], [b]) => byCode(b, a))
        .map(([lectureDate, day]) => ({ lectureDate, students: day.students.size, flags: day.flags }));
}

export async function slideHeat(classId, lectureDate) {
    const rows = flagsOf(onDeck(roomOf(classId, lectureDate))).filter((f) => f.slideIndex >= 0);
    return gatedGroups(rows, (f) => [f.slideIndex, f.type])
        .sort((a, b) => a.row.slideIndex - b.row.slideIndex || byCode(a.row.type, b.row.type))
        .map(({ row, flags: count, students }) => ({ slideIndex: row.slideIndex, type: row.type, flags: count, students }));
}

export async function highlightedLines(classId, lectureDate) {
    const rows = flagsOf(onDeck(roomOf(classId, lectureDate)))
        .filter((f) => f.source === "slide" && f.selectedText !== null && f.slideIndex >= 0);
    return gatedGroups(rows, (f) => [f.slideIndex, f.selectedText, f.type])
        .sort((a, b) =>
            a.row.slideIndex - b.row.slideIndex ||
            byCode(a.row.type, b.row.type) ||
            byCode(a.row.selectedText, b.row.selectedText))
        .map(({ row, flags: count, students }) => ({
            slideIndex: row.slideIndex,
            selectedText: row.selectedText,
            type: row.type,
            flags: count,
            students,
        }));
}

export async function timeline(classId, lectureDate) {
    const rows = flagsOf(roomOf(classId, lectureDate));
    if (rows.length === 0) return [];
    const width = BUCKET_MINUTES * 60_000;
    const origin = Math.min(...rows.map((f) => Date.parse(f.receivedAt)));
    const bucketOf = (f) => origin + Math.floor((Date.parse(f.receivedAt) - origin) / width) * width;

    return gatedGroups(rows, (f) => [bucketOf(f), f.type])
        .map((g) => ({ ...g, bucket: bucketOf(g.row) }))
        .sort((a, b) => a.bucket - b.bucket || byCode(a.row.type, b.row.type))
        .map(({ row, bucket, flags: count, students }) => ({
            bucketStart: new Date(bucket).toISOString(),
            bucketEnd: new Date(bucket + width).toISOString(),
            type: row.type,
            flags: count,
            students,
        }));
}

export async function transcriptWindow(classId, lectureDate, from, to) {
    const room = new Set(roomOf(classId, lectureDate).map((l) => l.id));
    const start = dateOf(from, "from").toISOString();
    const end = dateOf(to, "to").toISOString();

    const coverage = new Map();
    for (const s of segments) {
        if (!room.has(s.sessionId)) continue;
        const c = coverage.get(s.sessionId) ?? { ms: 0, count: 0 };
        c.ms += Date.parse(s.endedAt) - Date.parse(s.startedAt);
        c.count++;
        coverage.set(s.sessionId, c);
    }
    if (coverage.size === 0) return [];
    const [best] = [...coverage].sort(([a, ca], [b, cb]) => cb.ms - ca.ms || cb.count - ca.count || byCode(a, b))[0];

    return segments
        .filter((s) => s.sessionId === best && s.endedAt >= start && s.startedAt <= end)
        .sort(byStartAsc)
        .map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt, text: s.text }));
}

export async function studentQuestions(classId, lectureDate, slideIndex) {
    const slide = slideIndexOf(slideIndex);
    const asked = flagsOf(onDeck(roomOf(classId, lectureDate)))
        .filter((f) => f.slideIndex === slide && f.studentText !== null);
    if (new Set(asked.map((f) => f.studentId)).size < MIN_STUDENTS) return [];
    return asked
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || byFlagId(a, b))
        .map((f) => f.studentText);
}

// ── Lecture-code flow (the ?lecture=CODE dashboard) ──────────────────────────
// Mirrors pgStore.js: the first flag or transcript line from a student under a
// code creates their lecture for the day, and the code's class if needed.

function ensureClass(code) {
    const found = [...classes.values()].find((c) => c.code === code);
    if (found) return found;
    const created = { id: crypto.randomUUID(), lecturerId: null, title: code, code, createdAt: now() };
    classes.set(created.id, created);
    return created;
}

export async function ensureLecture({ studentId, classCode, startedAt } = {}) {
    const student = requireId(studentId, "studentId");
    const at = dateOf(startedAt, "startedAt");
    const code = normalizeCode(classCode);
    const classId = code ? ensureClass(code).id : null;

    await ensureUser(student);
    const date = lectureDateOf(at);
    const [existing] = [...lectures.values()]
        .filter((l) => l.studentId === student && l.classId === classId && l.lectureDate === date)
        .sort(byStartDesc);
    if (existing) return copy(existing);

    const lecture = {
        id: crypto.randomUUID(),
        studentId: student,
        classId,
        title: null,
        filename: null,
        deckHash: null,
        startedAt: at.toISOString(),
        endedAt: null,
        lectureDate: date,
        snapshot: null,
        updatedAt: at.toISOString(),
    };
    lectures.set(lecture.id, lecture);
    return copy(lecture);
}

/** A code's flags, keeping only slide/type groups that MIN_STUDENTS different students flagged. */
function gatedCodeFlags(classCode) {
    const code = normalizeCode(classCode);
    const cls = [...classes.values()].find((c) => c.code === code);
    if (!cls) return [];
    const coded = flagsOf([...lectures.values()].filter((l) => l.classId === cls.id))
        .filter((f) => f.slideIndex >= 0);
    const shown = new Set(
        gatedGroups(coded, (f) => [f.slideIndex, f.type]).map(({ row }) => JSON.stringify([row.slideIndex, row.type])),
    );
    return coded
        .filter((f) => shown.has(JSON.stringify([f.slideIndex, f.type])))
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || byFlagId(a, b));
}

export async function dashboardFlags(classCode) {
    return gatedCodeFlags(classCode).map((f) => ({
        type: f.type,
        slideIndex: f.slideIndex,
        receivedAt: f.receivedAt,
        hasQuestion: f.studentText !== null,
    }));
}

export async function dashboardQuestions(classCode) {
    return gatedCodeFlags(classCode)
        .filter((f) => f.studentText !== null)
        .map((f) => ({ type: f.type, slideIndex: f.slideIndex, text: f.studentText }));
}

export async function resetClass(classCode) {
    const code = normalizeCode(classCode);
    const cls = [...classes.values()].find((c) => c.code === code);
    if (!cls) return;
    const doomed = new Set([...lectures.values()].filter((l) => l.classId === cls.id).map((l) => l.id));
    for (const lectureId of doomed) lectures.delete(lectureId);
    // ON DELETE CASCADE
    for (const list of [flags, segments]) {
        for (let i = list.length - 1; i >= 0; i--) if (doomed.has(list[i].sessionId)) list.splice(i, 1);
    }
}

/** Always ready; nothing to connect to. */
export async function ready() {}
