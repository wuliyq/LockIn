import {
    MESSAGES,
    StoreError,
    asJson,
    dateOf,
    lectureDateOf,
    normalizeCode,
    optionalText,
    requireFlagType,
    requireId,
    requireText,
    slideIndexOf,
    sourceOf,
} from "./shared.js";

/**
 * In-memory store: the fallback when Postgres misbehaves (USE_MEMORY=1). Same
 * functions, return shapes and errors as pgStore.js; store.test.js runs one suite
 * against both. Everything is lost on restart.
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

export async function startLecture({ studentId, classCode, title, filename, deckHash } = {}) {
    const student = requireId(studentId, "studentId");
    let classId = null;
    if (normalizeCode(classCode)) {
        const found = await findClassByCode(classCode);
        if (!found) throw new StoreError("not_found", `No class with code ${normalizeCode(classCode)}.`);
        classId = found.id;
    }

    await ensureUser(student);
    const startedAt = new Date();
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
        receivedAt: now(),
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
