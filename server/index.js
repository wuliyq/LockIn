import "dotenv/config";
import cors from "cors";
import express from "express";
import { answerConfusion, generateInsights, summarizeRecentTranscript } from "./gemini.js";
import { buildDemoFlags } from "./demoData.js";
import { buildInsightsPrompt, collectQuestions, parseInsights, removeQuotes } from "./insights.js";
import * as store from "./store/index.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
        const lecture = await lectureFor(req.body);
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
            (sessionId && await store.getRecentTranscript((await lectureFor(req.body)).id, slideIndexOf(slideNumber)));

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
        const lecture = await lectureFor(req.body);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// The client calls real-world requests "example"; the database calls them "real_world".
const toStoredType = (flagType) => (flagType === "example" ? "real_world" : flagType);
const toClientType = (type) => (type === "real_world" ? "example" : type);

/** Client slide numbers are 1-based; the store's indices are 0-based (-1 = unknown). */
function slideIndexOf(slideNumber) {
    const number = Number(slideNumber);
    return Number.isInteger(number) && number >= 1 ? number - 1 : -1;
}

// Flags from clients that don't send a student id all count as this one student, so
// they can only hide signal behind the 3-student gate, never inflate it.
const UNKNOWN_STUDENT = "00000000-0000-0000-0000-000000000000";

/**
 * The lecture a student request belongs to. `sessionId` is the lecture code from the
 * ?lecture= link, or the browser's own id when there's no code; `studentId` is the
 * browser's anonymous id.
 */
function lectureFor({ sessionId, studentId }) {
    const hasCode = !store.isId(sessionId);
    return store.ensureLecture({
        studentId: store.isId(studentId) ? studentId : hasCode ? UNKNOWN_STUDENT : sessionId,
        classCode: hasCode ? sessionId : "",
    });
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
            source: flag.source === "transcript" ? null : flag.source,
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
