import { query } from "../db.js";
import {
    MESSAGES,
    StoreError,
    asJson,
    dateOf,
    normalizeCode,
    optionalText,
    requireFlagType,
    requireId,
    requireText,
    slideIndexOf,
    sourceOf,
} from "./shared.js";

/**
 * Postgres store. Same functions, return shapes and errors as memoryStore.js;
 * store.test.js runs one suite against both.
 */

// Constraint violations that can still reach Postgres after validation.
const CONSTRAINT_ERRORS = {
    flags_session_id_fkey: ["not_found", MESSAGES.lectureNotFound],
    transcript_segments_session_id_fkey: ["not_found", MESSAGES.lectureNotFound],
    classes_code_key: ["conflict", MESSAGES.classCodeTaken],
};

async function run(text, params) {
    try {
        return await query(text, params);
    } catch (error) {
        const known = CONSTRAINT_ERRORS[error.constraint];
        if (known) throw new StoreError(...known);
        throw error;
    }
}

const iso = (date) => (date ? date.toISOString() : null);

const toClass = (row) => ({
    id: row.id,
    lecturerId: row.lecturer_id,
    title: row.title,
    code: row.code,
    createdAt: iso(row.created_at),
});

const toLecture = (row) => ({
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    title: row.title,
    filename: row.filename,
    deckHash: row.deck_hash,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    lectureDate: row.lecture_date,
    snapshot: row.snapshot,
    updatedAt: iso(row.updated_at),
});

const toFlag = (row) => ({
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    slideIndex: row.slide_index,
    source: row.source,
    selectedText: row.selected_text,
    studentText: row.student_text,
    aiAnswer: row.ai_answer,
    receivedAt: iso(row.received_at),
});

const toSegment = (row) => ({
    id: row.id,
    sessionId: row.session_id,
    slideIndex: row.slide_index,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    text: row.text,
});

/** Anonymous users: the client makes the id and keeps it in localStorage. */
export async function ensureUser(userId) {
    const id = requireId(userId, "userId");
    await run("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
    return { id };
}

export async function createClass({ lecturerId, title, code } = {}) {
    const lecturer = requireId(lecturerId, "lecturerId");
    const classTitle = requireText(title, "title");
    const classCode = normalizeCode(code);
    if (!classCode) throw new StoreError("invalid", "code is required.");

    await ensureUser(lecturer);
    const { rows } = await run(
        "INSERT INTO classes (lecturer_id, title, code) VALUES ($1, $2, $3) RETURNING *",
        [lecturer, classTitle, classCode],
    );
    return toClass(rows[0]);
}

export async function findClassByCode(code) {
    const classCode = normalizeCode(code);
    if (!classCode) return null;
    const { rows } = await run("SELECT * FROM classes WHERE code = $1", [classCode]);
    return rows[0] ? toClass(rows[0]) : null;
}

/** A blank class code means independent study; an unknown one is an error. */
export async function startLecture({ studentId, classCode, title, filename, deckHash } = {}) {
    const student = requireId(studentId, "studentId");
    let classId = null;
    if (normalizeCode(classCode)) {
        const found = await findClassByCode(classCode);
        if (!found) throw new StoreError("not_found", `No class with code ${normalizeCode(classCode)}.`);
        classId = found.id;
    }

    await ensureUser(student);
    const { rows } = await run(
        `INSERT INTO lectures (student_id, class_id, title, filename, deck_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [student, classId, optionalText(title), optionalText(filename), optionalText(deckHash)],
    );
    return toLecture(rows[0]);
}

export async function getLecture(lectureId) {
    const id = requireId(lectureId, "lectureId");
    const { rows } = await run("SELECT * FROM lectures WHERE id = $1", [id]);
    return rows[0] ? toLecture(rows[0]) : null;
}

/** Only the fields passed are changed; updated_at is always set. */
export async function updateLecture(lectureId, changes = {}) {
    const id = requireId(lectureId, "lectureId");
    const sets = ["updated_at = NOW()"];
    const params = [id];
    const set = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
    };
    if (changes.title !== undefined) set("title", optionalText(changes.title));
    if (changes.endedAt !== undefined) {
        set("ended_at", changes.endedAt === null ? null : dateOf(changes.endedAt, "endedAt"));
    }
    // Stringify ourselves: pg would turn a top-level array into a Postgres array.
    if (changes.snapshot !== undefined) set("snapshot", JSON.stringify(asJson(changes.snapshot)));

    const { rows } = await run(`UPDATE lectures SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    if (!rows[0]) throw new StoreError("not_found", MESSAGES.lectureNotFound);
    return toLecture(rows[0]);
}

/** The student's lecture history, newest first. */
export async function listLectures(studentId) {
    const student = requireId(studentId, "studentId");
    const { rows } = await run(
        `SELECT l.id, l.title, l.filename, l.started_at, l.ended_at, l.lecture_date,
                c.title AS class_title,
                (SELECT count(*) FROM flags f WHERE f.session_id = l.id)::int AS flag_count
         FROM lectures l
         LEFT JOIN classes c ON c.id = l.class_id
         WHERE l.student_id = $1
         ORDER BY l.started_at DESC, l.id DESC`,
        [student],
    );
    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        filename: row.filename,
        startedAt: iso(row.started_at),
        endedAt: iso(row.ended_at),
        lectureDate: row.lecture_date,
        classTitle: row.class_title,
        flagCount: row.flag_count,
    }));
}

export async function addFlag(sessionId, flag = {}) {
    const id = requireId(sessionId, "sessionId");
    const { rows } = await run(
        `INSERT INTO flags (session_id, type, slide_index, source, selected_text, student_text, ai_answer)
         VALUES ($1, $2, COALESCE($3, -1), $4, $5, $6, $7) RETURNING *`,
        [
            id,
            requireFlagType(flag.type),
            slideIndexOf(flag.slideIndex),
            sourceOf(flag.source),
            optionalText(flag.selectedText),
            optionalText(flag.studentText),
            optionalText(flag.aiAnswer),
        ],
    );
    return toFlag(rows[0]);
}

export async function addTranscriptSegment(sessionId, segment = {}) {
    const id = requireId(sessionId, "sessionId");
    const text = requireText(segment.text, "text");
    const endedAt = dateOf(segment.endedAt, "endedAt");
    const startedAt = dateOf(segment.startedAt, "startedAt", endedAt);
    if (startedAt > endedAt) throw new StoreError("invalid", "startedAt must not be after endedAt.");

    const { rows } = await run(
        `INSERT INTO transcript_segments (session_id, slide_index, started_at, ended_at, text)
         VALUES ($1, COALESCE($2, -1), $3, $4, $5) RETURNING *`,
        [id, slideIndexOf(segment.slideIndex), startedAt, endedAt, text],
    );
    return toSegment(rows[0]);
}

/** The last few segments recorded on a slide, oldest first, joined into one string. */
export async function getRecentTranscript(sessionId, slideIndex, maxSegments = 4) {
    const id = requireId(sessionId, "sessionId");
    const { rows } = await run(
        `SELECT text FROM (
           SELECT text, started_at, id FROM transcript_segments
           WHERE session_id = $1 AND slide_index = $2
           ORDER BY started_at DESC, id DESC
           LIMIT $3
         ) recent
         ORDER BY started_at, id`,
        [id, slideIndexOf(slideIndex), maxSegments],
    );
    return rows.map((row) => row.text).join(" ");
}
