import { query } from "../db.js";
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
 * Postgres store. Same functions, return shapes and errors as memoryStore.js;
 * store.test.js runs one suite against both.
 *
 * `startedAt` (startLecture) and `receivedAt` (addFlag) exist for the seed and tests
 * only. Routes must never pass client times: the server clock is the only clock.
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

/** Anonymous users, by an id the server or client made. A name, when given, is kept. */
export async function ensureUser(userId, { name } = {}) {
    const id = requireId(userId, "userId");
    await run(
        `INSERT INTO users (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)`,
        [id, optionalText(name)],
    );
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
export async function startLecture({ studentId, studentName, classCode, title, filename, deckHash, startedAt } = {}) {
    const student = requireId(studentId, "studentId");
    let classId = null;
    if (normalizeCode(classCode)) {
        const found = await findClassByCode(classCode);
        if (!found) throw new StoreError("not_found", `No class with code ${normalizeCode(classCode)}.`);
        classId = found.id;
    }

    await ensureUser(student, { name: studentName });
    const { rows } = await run(
        `INSERT INTO lectures (student_id, class_id, title, filename, deck_hash, started_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW())) RETURNING *`,
        [
            student, classId, optionalText(title), optionalText(filename), optionalText(deckHash),
            dateOf(startedAt, "startedAt", null),
        ],
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
    if (changes.filename !== undefined) set("filename", optionalText(changes.filename));
    // Server-computed only (e.g. finish time minus the lecture's length); lecture_date follows.
    if (changes.startedAt !== undefined) set("started_at", dateOf(changes.startedAt, "startedAt"));
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
        `INSERT INTO flags
           (session_id, type, slide_index, source, selected_text, student_text, ai_answer, received_at)
         VALUES ($1, $2, COALESCE($3, -1), $4, $5, $6, $7, COALESCE($8::timestamptz, NOW())) RETURNING *`,
        [
            id,
            requireFlagType(flag.type),
            slideIndexOf(flag.slideIndex),
            sourceOf(flag.source),
            optionalText(flag.selectedText),
            optionalText(flag.studentText),
            optionalText(flag.aiAnswer),
            dateOf(flag.receivedAt, "receivedAt", null),
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

// ── Lecturer views ───────────────────────────────────────────────────────────
// Everything below is aggregated across the room and gated at MIN_STUDENTS distinct
// students in SQL. None of it returns a student id, lecture id, note, snapshot or
// AI answer.

/**
 * The room: every lecture in a class on one date. Per-slide views only count lectures
 * on the room's most common deck, so "slide 5" is the same page for everyone. With no
 * deck hashes at all, every lecture counts. Uses $1 = class id, $2 = lecture date.
 */
const ROOM = `
  room AS (
    SELECT id, student_id, deck_hash FROM lectures WHERE class_id = $1 AND lecture_date = $2
  ),
  deck AS (
    SELECT deck_hash FROM room WHERE deck_hash IS NOT NULL
    GROUP BY deck_hash
    ORDER BY count(DISTINCT student_id) DESC, deck_hash COLLATE "C"
    LIMIT 1
  ),
  on_deck AS (
    SELECT * FROM room
    WHERE NOT EXISTS (SELECT 1 FROM deck) OR deck_hash = (SELECT deck_hash FROM deck)
  )`;

/** The lecturer's date picker: which dates have lectures for this class. */
export async function listLectureDates(classId) {
    const id = requireId(classId, "classId");
    const { rows } = await run(
        `SELECT l.lecture_date,
                count(DISTINCT l.student_id)::int AS students,
                count(f.id)::int AS flags
         FROM lectures l
         LEFT JOIN flags f ON f.session_id = l.id
         WHERE l.class_id = $1
         GROUP BY l.lecture_date
         ORDER BY l.lecture_date DESC`,
        [id],
    );
    return rows.map((row) => ({ lectureDate: row.lecture_date, students: row.students, flags: row.flags }));
}

/** Primary view: flags per slide and type. */
export async function slideHeat(classId, lectureDate) {
    const { rows } = await run(
        `WITH ${ROOM}
         SELECT f.slide_index, f.type,
                count(*)::int AS flags,
                count(DISTINCT r.student_id)::int AS students
         FROM flags f
         JOIN on_deck r ON r.id = f.session_id
         WHERE f.slide_index >= 0
         GROUP BY f.slide_index, f.type
         HAVING count(DISTINCT r.student_id) >= $3
         ORDER BY f.slide_index, f.type COLLATE "C"`,
        [requireId(classId, "classId"), requireLectureDate(lectureDate), MIN_STUDENTS],
    );
    return rows.map((row) => ({ slideIndex: row.slide_index, type: row.type, flags: row.flags, students: row.students }));
}

/**
 * Flags per highlighted slide line. Only text selected on the slide: it's the
 * lecturer's own words. Text selected in a student's notes is their writing.
 */
export async function highlightedLines(classId, lectureDate) {
    const { rows } = await run(
        `WITH ${ROOM}
         SELECT f.slide_index, f.selected_text, f.type,
                count(*)::int AS flags,
                count(DISTINCT r.student_id)::int AS students
         FROM flags f
         JOIN on_deck r ON r.id = f.session_id
         WHERE f.source = 'slide' AND f.selected_text IS NOT NULL AND f.slide_index >= 0
         GROUP BY f.slide_index, f.selected_text, f.type
         HAVING count(DISTINCT r.student_id) >= $3
         ORDER BY f.slide_index, f.type COLLATE "C", f.selected_text COLLATE "C"`,
        [requireId(classId, "classId"), requireLectureDate(lectureDate), MIN_STUDENTS],
    );
    return rows.map((row) => ({
        slideIndex: row.slide_index,
        selectedText: row.selected_text,
        type: row.type,
        flags: row.flags,
        students: row.students,
    }));
}

/**
 * Flags over time in BUCKET_MINUTES buckets, aligned to the room's first flag rather
 * than the clock, so a burst across :00 isn't split into two groups that each fail
 * the gate. Shows when students flagged, which is after they got lost.
 */
export async function timeline(classId, lectureDate) {
    const { rows } = await run(
        `WITH ${ROOM},
         origin AS (SELECT min(f.received_at) AS at FROM flags f JOIN room r ON r.id = f.session_id)
         SELECT date_bin(make_interval(mins => $3), f.received_at, (SELECT at FROM origin)) AS bucket,
                f.type,
                count(*)::int AS flags,
                count(DISTINCT r.student_id)::int AS students
         FROM flags f
         JOIN room r ON r.id = f.session_id
         GROUP BY bucket, f.type
         HAVING count(DISTINCT r.student_id) >= $4
         ORDER BY bucket, f.type COLLATE "C"`,
        [requireId(classId, "classId"), requireLectureDate(lectureDate), BUCKET_MINUTES, MIN_STUDENTS],
    );
    return rows.map((row) => ({
        bucketStart: iso(row.bucket),
        bucketEnd: iso(new Date(row.bucket.getTime() + BUCKET_MINUTES * 60_000)),
        type: row.type,
        flags: row.flags,
        students: row.students,
    }));
}

/**
 * Drill-down transcript for a time window. Several students may each have recorded
 * the lecture; read only the copy with the most coverage so text isn't repeated.
 */
export async function transcriptWindow(classId, lectureDate, from, to) {
    const { rows } = await run(
        `WITH ${ROOM},
         best AS (
           SELECT t.session_id FROM transcript_segments t
           JOIN room r ON r.id = t.session_id
           GROUP BY t.session_id
           ORDER BY sum(t.ended_at - t.started_at) DESC, count(*) DESC, t.session_id
           LIMIT 1
         )
         SELECT started_at, ended_at, text FROM transcript_segments
         WHERE session_id = (SELECT session_id FROM best) AND ended_at >= $3 AND started_at <= $4
         ORDER BY started_at, id`,
        [
            requireId(classId, "classId"), requireLectureDate(lectureDate),
            dateOf(from, "from"), dateOf(to, "to"),
        ],
    );
    return rows.map((row) => ({ startedAt: iso(row.started_at), endedAt: iso(row.ended_at), text: row.text }));
}

/**
 * RAW student questions on one slide, oldest first, for the server to paraphrase.
 * Never send these to a lecturer as they are. Empty unless MIN_STUDENTS different
 * students asked on that slide.
 */
export async function studentQuestions(classId, lectureDate, slideIndex) {
    const { rows } = await run(
        `WITH ${ROOM},
         asked AS (
           SELECT f.id, f.student_text, f.received_at, r.student_id
           FROM flags f
           JOIN on_deck r ON r.id = f.session_id
           WHERE f.slide_index = $3 AND f.student_text IS NOT NULL
         )
         SELECT student_text FROM asked
         WHERE (SELECT count(DISTINCT student_id) FROM asked) >= $4
         ORDER BY received_at, id`,
        [requireId(classId, "classId"), requireLectureDate(lectureDate), slideIndexOf(slideIndex), MIN_STUDENTS],
    );
    return rows.map((row) => row.student_text);
}

// ── Lecture-code flow (the ?lecture=CODE dashboard) ──────────────────────────
// The lecturer dashboard makes up a code; students who open its link flag under it.
// There's no explicit "start lecture": the first flag or transcript line from a
// student under a code creates their lecture for the day.

/** The class for a code, created on first use (no lecturer, code as title). */
async function ensureClass(code) {
    await run("INSERT INTO classes (title, code) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING", [code]);
    return findClassByCode(code);
}

/**
 * This student's lecture under this code today (course timezone), created if it
 * doesn't exist yet. A blank code means a private lecture with no class.
 */
export async function ensureLecture({ studentId, classCode, startedAt } = {}) {
    const student = requireId(studentId, "studentId");
    const at = dateOf(startedAt, "startedAt");
    const code = normalizeCode(classCode);
    const classId = code ? (await ensureClass(code)).id : null;

    await ensureUser(student);
    const existing = await run(
        `SELECT * FROM lectures
         WHERE student_id = $1 AND class_id IS NOT DISTINCT FROM $2 AND lecture_date = $3
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
        [student, classId, lectureDateOf(at)],
    );
    if (existing.rows[0]) return toLecture(existing.rows[0]);

    const { rows } = await run(
        "INSERT INTO lectures (student_id, class_id, started_at) VALUES ($1, $2, $3) RETURNING *",
        [student, classId, at],
    );
    return toLecture(rows[0]);
}

// askedText() from shared.js in SQL: the typed question, else highlighted text that
// isn't the "Highlighted area on slide N" placeholder.
const ASKED_TEXT = `COALESCE(
    student_text,
    CASE WHEN selected_text ~ '^Highlighted area on slide [0-9]+$' THEN NULL ELSE selected_text END
)`;

/**
 * A code's flags, keeping only slide/type groups that MIN_STUDENTS different
 * students flagged. Uses $1 = code, $2 = MIN_STUDENTS.
 */
const GATED_CODE_FLAGS = `
  room AS (
    SELECT l.id, l.student_id FROM lectures l
    JOIN classes c ON c.id = l.class_id
    WHERE c.code = $1
  ),
  coded AS (
    SELECT f.*, r.student_id FROM flags f
    JOIN room r ON r.id = f.session_id
    WHERE f.slide_index >= 0
  ),
  shown AS (
    SELECT slide_index, type FROM coded
    GROUP BY slide_index, type
    HAVING count(DISTINCT student_id) >= $2
  ),
  gated AS (
    SELECT coded.* FROM coded JOIN shown USING (slide_index, type)
  )`;

/**
 * What the lecturer dashboard gets for a code: type, slide and time of each flag,
 * and whether it came with a question. No text, ids or answers. Flags in a slide
 * and type that fewer than MIN_STUDENTS students used are left out.
 */
export async function dashboardFlags(classCode) {
    const { rows } = await run(
        `WITH ${GATED_CODE_FLAGS}
         SELECT type, slide_index, received_at, ${ASKED_TEXT} IS NOT NULL AS has_question
         FROM gated
         ORDER BY received_at, id`,
        [normalizeCode(classCode), MIN_STUDENTS],
    );
    return rows.map((row) => ({
        type: row.type,
        slideIndex: row.slide_index,
        receivedAt: iso(row.received_at),
        hasQuestion: row.has_question,
    }));
}

/**
 * RAW questions from the same gated flags, oldest first, for the server to
 * summarise and paraphrase. Never send these to a lecturer as they are.
 */
export async function dashboardQuestions(classCode) {
    const { rows } = await run(
        `WITH ${GATED_CODE_FLAGS}
         SELECT type, slide_index, ${ASKED_TEXT} AS asked FROM gated
         WHERE ${ASKED_TEXT} IS NOT NULL
         ORDER BY received_at, id`,
        [normalizeCode(classCode), MIN_STUDENTS],
    );
    return rows.map((row) => ({ type: row.type, slideIndex: row.slide_index, text: row.asked }));
}

/** Deletes every lecture (and so every flag and transcript) under a code. Keeps the class. */
export async function resetClass(classCode) {
    await run(
        "DELETE FROM lectures WHERE class_id = (SELECT id FROM classes WHERE code = $1)",
        [normalizeCode(classCode)],
    );
}

/** Checks Postgres is reachable and the schema is loaded, with a fix in the message. */
export async function ready() {
    try {
        await query("SELECT 1 FROM flags LIMIT 1");
    } catch (error) {
        const fix = error.code === "42P01"
            ? "The tables are missing: run npm run db:reset."
            : "Is Postgres running? brew services start postgresql@16";
        throw new Error(`Postgres isn't ready (${error.message}). ${fix} Or set USE_MEMORY=1.`);
    }
}

/** Classes a lecturer created, newest first. */
export async function listClasses(lecturerId) {
    const lecturer = requireId(lecturerId, "lecturerId");
    const { rows } = await run(
        "SELECT * FROM classes WHERE lecturer_id = $1 ORDER BY created_at DESC, id DESC",
        [lecturer],
    );
    return rows.map(toClass);
}

/** Student lectures in a lecturer's classes, newest first. For the lecturer's home page. */
export async function listClassLectures(lecturerId) {
    const lecturer = requireId(lecturerId, "lecturerId");
    const { rows } = await run(
        `SELECT l.id, l.title, l.filename, l.started_at, l.ended_at, l.lecture_date,
                c.title AS class_title, u.name AS student_name,
                (SELECT count(*) FROM flags f WHERE f.session_id = l.id)::int AS flag_count
         FROM lectures l
         JOIN classes c ON c.id = l.class_id
         JOIN users u ON u.id = l.student_id
         WHERE c.lecturer_id = $1
         ORDER BY l.started_at DESC, l.id DESC`,
        [lecturer],
    );
    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        filename: row.filename,
        startedAt: iso(row.started_at),
        endedAt: iso(row.ended_at),
        lectureDate: row.lecture_date,
        classTitle: row.class_title,
        studentName: row.student_name,
        flagCount: row.flag_count,
    }));
}

/** One lecture's flags, oldest first. */
export async function lectureFlags(lectureId) {
    const id = requireId(lectureId, "lectureId");
    const { rows } = await run("SELECT * FROM flags WHERE session_id = $1 ORDER BY received_at, id", [id]);
    return rows.map(toFlag);
}
