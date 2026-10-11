import "dotenv/config";
import cors from "cors";
import express from "express";
import { answerConfusion, generateInsights, summarizeRecentTranscript } from "./gemini.js";
import { buildDemoFlags } from "./demoData.js";
import { buildInsightsPrompt, collectQuestions, parseInsights, removeQuotes } from "./insights.js";
import * as store from "./store/index.js";

const app = express();
const port = process.env.PORT || 3001;

// The account pages send cookies, so CORS must name the origin rather than "*".
// CLIENT_ORIGIN (comma-separated) for deployments; any localhost port in development.
const allowedOrigins = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
    credentials: true,
    origin: (origin, done) => done(null, !origin || (allowedOrigins
        ? allowedOrigins.includes(origin)
        : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))),
}));
// Finished lectures carry the deck's text, notes and flags, so allow larger bodies.
app.use(express.json({ limit: "5mb" }));

// Who's asking: an anonymous id in an HttpOnly cookie (see accountIdFor). The account
// pages and the lecture workspace both send it, which ties a student's flags and
// transcript to the lecture they started.
app.use(
    ["/api/lectures", "/api/classes", "/api/teaching", "/api/flags", "/api/transcript", "/api/catch-up"],
    (req, res, next) => {
        req.accountId = accountIdFor(req, res);
        next();
    },
);

app.get("/api/health", (reg, res) => {
    res.json({
        status: "LockIn backend is running",
    });
});

app.post("/api/stt-token", async (req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "ElevenLabs transcription is not configured on this server.",
        });
    }

    try {
        const tokenResponse = await fetch(
            "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
            {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                },
                body: "{}",
            },
        );
        const payload = await tokenResponse.json();

        if (!tokenResponse.ok || !payload.token) {
            return res.status(502).json({
                error: "LockIn could not get a temporary transcription token.",
            });
        }

        return res.json({ token: payload.token });
    } catch (error) {
        console.error("STT token error:", error);
        return res.status(502).json({
            error: "LockIn could not reach the transcription service.",
        });
    }
});

app.post("/api/confusion", async (req, res) => {
    const {
        selectedText,
        question,
        slideText,
        notesExcerpt,
        transcriptExcerpt,
    } = req.body;

    if (!selectedText || !question || !slideText) {
        return res.status(400).json({
            error: "selectedText, question, and slideText are required.",
        });
    }

    try {
        const answer = await answerConfusion({
            selectedText,
            question,
            slideText,
            notesExcerpt,
            transcriptExcerpt,
        });

        return res.json({ answer });
    } catch (error) {
        console.error("Gemini error:", error);

        return res.status(500).json({
            error: "LockIn could not generate an explanation right now.",
        });
    }
});

app.post("/api/transcript", async (req, res) => {
    const { slideNumber, text, startedAt, endedAt } = req.body;

    if (!req.body.sessionId || slideNumber === undefined || !text) {
        return res.status(400).json({
            error: "sessionId, slideNumber, and text are required.",
        });
    }

    try {
        const lecture = await lectureFor(req);
        // Server clock only: keep the segment's length, but end it now.
        const durationMs = Math.min(Math.max(Date.parse(endedAt) - Date.parse(startedAt) || 0, 0), 30 * 60_000);
        const end = new Date();
        const segment = await store.addTranscriptSegment(lecture.id, {
            slideIndex: slideIndexOf(slideNumber),
            text,
            startedAt: new Date(end.getTime() - durationMs),
            endedAt: end,
        });

        return res.status(201).json({ segment: { ...segment, slideNumber } });
    } catch (error) {
        return sendError(res, error, "LockIn could not save this transcript segment.");
    }
});

app.post("/api/catch-up", async (req, res) => {
    const {
        sessionId,
        slideNumber,
        recentTranscript,
        slideText,
    } = req.body;

    try {
        const transcriptToSummarize = recentTranscript ||
            (sessionId && await store.getRecentTranscript((await lectureFor(req)).id, slideIndexOf(slideNumber)));

        if (!transcriptToSummarize) {
            return res.status(400).json({
                error: "recentTranscript is required, or send transcript segments first.",
            });
        }

        const summary = await summarizeRecentTranscript({
            recentTranscript: transcriptToSummarize,
            slideText,
        });

        return res.json({
            sessionId,
            slideNumber,
            summary,
        });
    } catch (error) {
        console.error("Catch-up error:", error);
        return sendError(res, error, "LockIn could not create a catch-up summary right now.");
    }
});

app.post("/api/flags", async (req, res) => {
    const {
        sessionId,
        slideNumber,
        flagType,
        selectedText,
        studentComment,
        aiAnswer,
        source,
    } = req.body;

    if (!sessionId || !slideNumber || !flagType) {
        return res.status(400).json({
            error: "sessionId, slideNumber, and flagType are required.",
        });
    }

    try {
        const lecture = await lectureFor(req);
        // The client's timestamp is ignored: the server clock is the only clock.
        const saved = await store.addFlag(lecture.id, {
            type: toStoredType(flagType),
            slideIndex: slideIndexOf(slideNumber),
            source,
            selectedText,
            studentText: studentComment,
            aiAnswer,
        });

        return res.status(201).json({
            flag: { id: saved.id, flagType, slideNumber, timestamp: saved.receivedAt },
        });
    } catch (error) {
        return sendError(res, error, "LockIn could not save this flag.");
    }
});

/**
 * The lecturer dashboard's flags for a lecture code: type, slide and time only, with
 * slide/type groups of fewer than 3 students already removed by the store. No
 * question text, answers or notes leave the server.
 */
app.get("/api/dashboard/:sessionId", async (req, res) => {
    try {
        const flags = await dashboardFlagsFor(req.params.sessionId);
        const flagsByType = {};
        for (const flag of flags) flagsByType[flag.flagType] = (flagsByType[flag.flagType] ?? 0) + 1;

        return res.json({
            sessionId: req.params.sessionId,
            totalFlags: flags.length,
            flagsByType,
            flags,
        });
    } catch (error) {
        return sendError(res, error, "LockIn could not load this lecture's flags.");
    }
});

/**
 * Anonymous AI insights for the lecturer: themes in one flag type's questions
 * (mode "type") or suggestions for the next lecture (mode "suggestions").
 * Student text is read here on the server and never returned; replies are
 * paraphrased and filtered so they can't quote a student.
 */
app.post("/api/insights", async (req, res) => {
    const { sessionId, mode, flagType, typeLabel, slides } = req.body;

    if (!sessionId || !["type", "suggestions"].includes(mode) || (mode === "type" && !flagType)) {
        return res.status(400).json({
            error: "sessionId and mode (\"type\" with flagType, or \"suggestions\") are required.",
        });
    }

    try {
        const flags = await dashboardFlagsFor(sessionId);
        const asked = (await store.dashboardQuestions(sessionId)).map((q) => ({
            flagType: toClientType(q.type),
            slideNumber: q.slideIndex + 1,
            studentComment: q.text,
        }));
        const questions = collectQuestions(asked, mode === "type" ? flagType : null);
        const slideCounts = countBySlide(flags);

        if (mode === "type" && questions.length === 0) {
            return res.json({ summary: "", themes: [], basedOn: 0 });
        }
        if (mode === "suggestions" && flags.length === 0) {
            return res.json({ overview: "", suggestions: [], basedOn: 0 });
        }

        const prompt = buildInsightsPrompt({
            mode,
            typeLabel: typeLabel || flagType,
            questions,
            slides: Array.isArray(slides) ? slides.slice(0, 200) : [],
            slideCounts,
        });
        const parsed = parseInsights(await generateInsights(prompt), mode);
        const safe = removeQuotes(parsed, questions.map((q) => q.text));

        return res.json({ ...safe, basedOn: mode === "type" ? questions.length : flags.length });
    } catch (error) {
        console.error("Insights error:", error);
        return sendError(res, error, "LockIn could not summarise the flags right now.");
    }
});

/**
 * Load the sample "Gradient Descent" lecture under a code, replacing what's there.
 * Goes through the store, so it works on Postgres and with USE_MEMORY=1.
 */
app.post("/api/demo/seed", async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required." });
    }

    try {
        const totalFlags = await seedDemoLecture(sessionId);
        return res.status(201).json({ sessionId, totalFlags });
    } catch (error) {
        return sendError(res, error, "LockIn could not load the sample lecture.");
    }
});

// ── Lecture history and classes (the account pages) ─────────────────────────
// The account pages call these through the client's /api proxy with credentials.
// As docs/account-api-contract.md says, who you are comes from a cookie, never from
// an id the client sends. There's no sign-in yet, so each browser gets an anonymous
// id in an HttpOnly cookie the first time it uses these routes.

/**
 * Gives this browser its anonymous id cookie (or keeps the one it has). The client
 * calls this once before anything else: its first requests run in parallel, and each
 * cookie-less one would otherwise get a different id.
 */
app.post("/api/session", (req, res) => {
    accountIdFor(req, res);
    res.json({ ok: true });
});

/** The signed-in browser's lectures, newest first. */
app.get("/api/lectures", async (req, res) => {
    try {
        const history = await store.listLectures(req.accountId);
        const lectures = await Promise.all(
            history.map(async (row) => lectureSummary(row, (await store.getLecture(row.id))?.snapshot)),
        );
        return res.json({ lectures });
    } catch (error) {
        return sendError(res, error, "LockIn could not load your lectures.");
    }
});

/** Start a lecture. A blank class code is independent study; an unknown one is refused. */
app.post("/api/lectures", async (req, res) => {
    const { title, classCode, studentName } = req.body;
    try {
        const lecture = await store.startLecture({
            studentId: req.accountId,
            studentName,
            classCode,
            title: title || "Untitled lecture",
        });
        return res.status(201).json({
            lecture: { id: lecture.id, title: lecture.title, started_at: lecture.startedAt },
        });
    } catch (error) {
        return sendError(res, error, "LockIn could not start this lecture.");
    }
});

/** One lecture for the review page: summary fields plus the saved snapshot. Owner only. */
app.get("/api/lectures/:id", async (req, res) => {
    try {
        const lecture = await ownLecture(req);
        const row = (await store.listLectures(req.accountId)).find((item) => item.id === lecture.id);
        const snapshot = lecture.snapshot ?? {};
        return res.json({
            lecture: {
                ...lectureSummary(row, snapshot),
                snapshot,
                flags: Array.isArray(snapshot.flags) ? snapshot.flags : [],
                catchUps: Array.isArray(snapshot.catchUps) ? snapshot.catchUps : [],
            },
        });
    } catch (error) {
        return sendError(res, error, "LockIn could not open this lecture.");
    }
});

/** Autosave. Owner only. */
app.patch("/api/lectures/:id", async (req, res) => {
    try {
        const lecture = await ownLecture(req);
        const snapshot = snapshotFrom(req.body);
        await store.updateLecture(lecture.id, { snapshot, filename: snapshot.filename });
        return res.json({ saved: true });
    } catch (error) {
        return sendError(res, error, "LockIn could not save this lecture.");
    }
});

/**
 * Finish: save the final snapshot and set ended_at on the server clock. The client
 * creates the lecture when it finishes, so the start is moved back by the lecture's
 * length (snapshot.seconds) to when it really began.
 */
app.post("/api/lectures/:id/finish", async (req, res) => {
    try {
        const lecture = await ownLecture(req);
        const snapshot = snapshotFrom(req.body);
        const endedAt = new Date();
        const seconds = Number(snapshot.seconds);
        const changes = { snapshot, filename: snapshot.filename, endedAt };
        if (snapshot.title) changes.title = snapshot.title;
        if (Number.isFinite(seconds) && seconds > 0) {
            const start = new Date(endedAt.getTime() - seconds * 1000);
            if (start < new Date(lecture.startedAt)) changes.startedAt = start;
        }
        await store.updateLecture(lecture.id, changes);
        return res.json({ saved: true });
    } catch (error) {
        return sendError(res, error, "LockIn could not finish this lecture.");
    }
});

/** A lecturer's classes. */
app.get("/api/classes", async (req, res) => {
    try {
        const classes = await store.listClasses(req.accountId);
        return res.json({ classes: classes.map(({ id, title, code }) => ({ id, title, code })) });
    } catch (error) {
        return sendError(res, error, "LockIn could not load your classes.");
    }
});

/** Create a class with a server-generated join code. */
app.post("/api/classes", async (req, res) => {
    for (let attempt = 0; ; attempt++) {
        try {
            const created = await store.createClass({ lecturerId: req.accountId, title: req.body.title, code: newClassCode() });
            return res.status(201).json({ classroom: { id: created.id, title: created.title, code: created.code } });
        } catch (error) {
            // A taken code: try another. Anything else (e.g. a missing title) goes back as is.
            if (error.kind === "conflict" && attempt < 5) continue;
            return sendError(res, error, "LockIn could not create this class.");
        }
    }
});

// ── What a lecturer sees of their classes' lectures ─────────────────────────
// As the lecturer pages are designed (previewLecturerApi): every student lecture in
// the lecturer's classes, and for each one its flags (with the student's question and
// the AI answer) and when they asked for catch-ups. Never the student's notes,
// snapshot, catch-up text or transcript.

app.get("/api/teaching/lectures", async (req, res) => {
    try {
        const sessions = await store.listClassLectures(req.accountId);
        const lectures = await Promise.all(
            sessions.map(async (row) => {
                const { notePages, ...summary } = lectureSummary(row, (await store.getLecture(row.id))?.snapshot);
                return { ...summary, flagCount: row.flagCount };
            }),
        );
        return res.json({ lectures });
    } catch (error) {
        return sendError(res, error, "LockIn could not load your classes' lectures.");
    }
});

app.get("/api/teaching/lectures/:id", async (req, res) => {
    try {
        const row = (await store.listClassLectures(req.accountId)).find((item) => item.id === req.params.id);
        if (!row) throw new store.StoreError("not_found", "Lecture not found.");
        const snapshot = (await store.getLecture(row.id))?.snapshot ?? {};
        const { notePages, ...summary } = lectureSummary(row, snapshot);
        const flags = await store.lectureFlags(row.id);
        return res.json({
            lecture: {
                ...summary,
                flagCount: flags.length,
                flags: flags.map((flag) => ({
                    id: flag.id,
                    flagType: toClientType(flag.type),
                    slideNumber: flag.slideIndex >= 0 ? flag.slideIndex + 1 : null,
                    timestamp: flag.receivedAt,
                    source: flag.source,
                    selectedText: flag.selectedText,
                    studentComment: flag.studentText,
                    aiAnswer: flag.aiAnswer,
                })),
                catchUps: (Array.isArray(snapshot.catchUps) ? snapshot.catchUps : []).map((item, index) => ({
                    id: item.id ?? String(index),
                    timestamp: item.timestamp ?? null,
                    slide: Number.isInteger(item.slide) ? item.slide : null,
                })),
            },
        });
    } catch (error) {
        return sendError(res, error, "LockIn could not open this lecture.");
    }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACCOUNT_COOKIE = "lockin_uid";

/** This browser's anonymous account id from its cookie, setting one on first use. */
function accountIdFor(req, res) {
    const existing = readCookie(req, ACCOUNT_COOKIE);
    if (store.isId(existing)) return existing.toLowerCase();
    const id = crypto.randomUUID();
    res.cookie(ACCOUNT_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400_000 });
    return id;
}

function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return decodeURIComponent(value.join("="));
    }
    return null;
}

/** The lecture in the URL, if this browser owns it. Someone else's looks the same as a missing one. */
async function ownLecture(req) {
    const lecture = await store.getLecture(req.params.id);
    if (!lecture || lecture.studentId !== req.accountId) {
        throw new store.StoreError("not_found", "Lecture not found.");
    }
    return lecture;
}

function snapshotFrom(body) {
    const snapshot = body?.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new store.StoreError("invalid", "snapshot is required.");
    }
    return snapshot;
}

/** The fields the lecture list shows. Counts come from the saved snapshot, as the client computes them. */
function lectureSummary(row, snapshot) {
    const notes = snapshot?.notes && typeof snapshot.notes === "object" ? Object.values(snapshot.notes) : [];
    const seconds = Number(snapshot?.seconds);
    return {
        id: row.id,
        title: row.title,
        class_title: row.classTitle,
        student_name: row.studentName ?? null,
        started_at: row.startedAt,
        ended_at: row.endedAt,
        filename: row.filename ?? snapshot?.filename ?? null,
        seconds: Number.isFinite(seconds) && seconds > 0
            ? Math.floor(seconds)
            : row.endedAt ? Math.floor((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000) : 0,
        notePages: notes.filter((note) => typeof note === "string" && note.trim()).length,
        flagCount: Array.isArray(snapshot?.flags) ? snapshot.flags.length : row.flagCount,
    };
}

// Join codes students can read out loud: no 0/O or 1/I.
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newClassCode() {
    return Array.from({ length: 6 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
}


// The client calls real-world requests "example"; the database calls them "real_world".
const toStoredType = (flagType) => (flagType === "example" ? "real_world" : flagType);
const toClientType = (type) => (type === "real_world" ? "example" : type);

/** Client slide numbers are 1-based; the store's indices are 0-based (-1 = unknown). */
function slideIndexOf(slideNumber) {
    const number = Number(slideNumber);
    return Number.isInteger(number) && number >= 1 ? number - 1 : -1;
}

/**
 * The lecture a workspace request belongs to:
 *  - `sessionId` is a lecture this browser started from its lecture page (the usual
 *    case): that lecture, so flags land in the lecturer's class as part of it;
 *  - `sessionId` is a lecture code (the ?lecture=CODE link): this student's lecture
 *    under that code today, created if needed;
 *  - anything else: this student's private lecture for today.
 * The student is the browser's cookie, or the id an older client sends in the body.
 */
async function lectureFor(req) {
    const { sessionId, studentId } = req.body;
    const student = store.isId(studentId) ? studentId.toLowerCase() : req.accountId;
    if (store.isId(sessionId)) {
        const lecture = await store.getLecture(sessionId);
        if (lecture && (lecture.studentId === req.accountId || lecture.studentId === student)) return lecture;
    }
    const hasCode = typeof sessionId === "string" && sessionId.trim() && !store.isId(sessionId);
    return store.ensureLecture({ studentId: student, classCode: hasCode ? sessionId : "" });
}

async function dashboardFlagsFor(code) {
    return (await store.dashboardFlags(code)).map((flag) => ({
        flagType: toClientType(flag.type),
        slideNumber: flag.slideIndex + 1,
        timestamp: flag.receivedAt,
        hasQuestion: flag.hasQuestion,
    }));
}

// Twelve stand-in students for the sample lecture, so its groups clear the gate.
const DEMO_STUDENTS = Array.from(
    { length: 12 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);

async function seedDemoLecture(code) {
    await store.resetClass(code);
    const demo = buildDemoFlags();
    const lectureStart = new Date(Date.parse(demo[0].timestamp) - 60_000);
    const lectures = new Map();
    const usedInGroup = new Map();

    for (const flag of demo) {
        // Different students within each slide/type group, as in a real class.
        const group = `${flag.slideNumber}:${flag.flagType}`;
        const nth = usedInGroup.get(group) ?? 0;
        usedInGroup.set(group, nth + 1);
        const studentId = DEMO_STUDENTS[(flag.slideNumber * 5 + nth) % DEMO_STUDENTS.length];

        if (!lectures.has(studentId)) {
            lectures.set(studentId, await store.ensureLecture({ studentId, classCode: code, startedAt: lectureStart }));
        }
        await store.addFlag(lectures.get(studentId).id, {
            type: toStoredType(flag.flagType),
            slideIndex: slideIndexOf(flag.slideNumber),
            source: flag.source,
            selectedText: flag.selectedText,
            studentText: flag.studentComment,
            receivedAt: flag.timestamp,
        });
    }
    return demo.length;
}

function countBySlide(flags) {
    const bySlide = new Map();
    for (const flag of flags) {
        const counts = bySlide.get(flag.slideNumber) ?? {};
        counts[flag.flagType] = (counts[flag.flagType] ?? 0) + 1;
        bySlide.set(flag.slideNumber, counts);
    }
    return [...bySlide.entries()]
        .sort(([a], [b]) => a - b)
        .map(([slideNumber, counts]) => ({ slideNumber, counts }));
}

/** Store validation errors become 4xx with their message; anything else is a logged 500. */
function sendError(res, error, fallback) {
    const status = { invalid: 400, not_found: 404, conflict: 409 }[error.kind];
    if (status) return res.status(status).json({ error: error.message });
    console.error(error);
    return res.status(500).json({ error: fallback });
}

try {
    await store.ready();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

app.listen(port, () => {
    console.log(`LockIn backend is running at http://localhost:${port} (${store.storeKind} store)`);
});
