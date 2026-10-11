import "dotenv/config";
import cors from "cors";
import express from "express";
import { answerConfusion, generateInsights, summarizeRecentTranscript } from "./gemini.js";
import { buildDemoFlags } from "./demoData.js";
import { buildInsightsPrompt, collectQuestions, parseInsights, removeQuotes } from "./insights.js";
import {
    addFlag,
    addTranscriptSegment,
    getDashboardData,
    getFlags,
    getRecentTranscript,
    replaceFlags,
} from "./sessionStore.js";

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

app.post("/api/transcript", (req, res) => {
    const { sessionId, slideNumber, text, startedAt, endedAt } = req.body;

    if (!sessionId || slideNumber === undefined || !text) {
        return res.status(400).json({
            error: "sessionId, slideNumber, and text are required.",
        });
    }

    try {
        const savedSegment = addTranscriptSegment(sessionId, {
            slideNumber,
            text,
            startedAt,
            endedAt,
        });

        return res.status(201).json({ segment: savedSegment });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

app.post("/api/catch-up", async (req, res) => {
    const {
        sessionId,
        slideNumber,
        recentTranscript,
        slideText,
    } = req.body;

    const transcriptToSummarize = recentTranscript ||
        getRecentTranscript(sessionId, slideNumber);

    if (!transcriptToSummarize) {
        return res.status(400).json({
            error: "recentTranscript is required, or send transcript segments first.",
        });
    }

    try {
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

        return res.status(500).json({
            error: "LockIn could not create a catch-up summary right now.",
        });
    }
});

app.post("/api/flags", (req, res) => {
  const {
    sessionId,
    slideNumber,
    flagType,
    selectedText,
    studentComment,
    aiAnswer,
    source,
    timestamp,
  } = req.body;

  if (!sessionId || !slideNumber || !flagType) {
    return res.status(400).json({
      error: "sessionId, slideNumber, and flagType are required.",
    });
  }

  const savedFlag = addFlag(sessionId, {
    slideNumber,
    flagType,
    selectedText,
    studentComment,
    aiAnswer,
    source,
    // When the student pressed the button; the server's arrival time is the fallback.
    ...(isRecentPast(timestamp) && { timestamp }),
  });

  res.status(201).json({ flag: savedFlag });
});

app.get("/api/dashboard/:sessionId", (req, res) => {
  const dashboardData = getDashboardData(req.params.sessionId);

  res.json(dashboardData);
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

    const flags = getFlags(sessionId);
    const questions = collectQuestions(flags, mode === "type" ? flagType : null);
    const slideCounts = countBySlide(flags);

    if (mode === "type" && questions.length === 0) {
        return res.json({ summary: "", themes: [], basedOn: 0 });
    }
    if (mode === "suggestions" && flags.length === 0) {
        return res.json({ overview: "", suggestions: [], basedOn: 0 });
    }

    try {
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
        return res.status(500).json({
            error: "LockIn could not summarise the flags right now.",
        });
    }
});

/** Load the sample "Gradient Descent" lecture into a session, replacing its flags. */
app.post("/api/demo/seed", (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required." });
    }

    const flags = replaceFlags(sessionId, buildDemoFlags());
    return res.status(201).json({ sessionId, totalFlags: flags.length });
});

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

/** An ISO time within the last day and not in the future (allowing for clock drift). */
function isRecentPast(value) {
    const time = Date.parse(value);
    const now = Date.now();
    return typeof value === "string" && Number.isFinite(time) && time <= now + 2 * 60000 && time >= now - 24 * 3600000;
}

app.listen(port, () => {
    console.log(`LockIn backend is running at http://localhost:${port}`);
});
