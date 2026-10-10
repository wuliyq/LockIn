import "dotenv/config";
import cors from "cors";
import express from "express";
import { answerConfusion, summarizeRecentTranscript } from "./gemini.js";
import { addFlag, getDashboardData } from "./sessionStore.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (reg, res) => {
    res.json({
        status: "LockIn backend is running",
    });
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

app.post("/api/catch-up", async (req, res) => {
    const {
        sessionId,
        slideNumber,
        recentTranscript,
        slideText,
    } = req.body;

    if (!recentTranscript) {
        return res.status(400).json({
            error: "recentTranscript is required.",
        });
    }

    try {
        const summary = await summarizeRecentTranscript({
            recentTranscript,
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
  });

  res.status(201).json({ flag: savedFlag });
});

app.get("/api/dashboard/:sessionId", (req, res) => {
  const dashboardData = getDashboardData(req.params.sessionId);

  res.json(dashboardData);
});

app.listen(port, () => {
    console.log(`LockIn backend is running at http://localhost:${port}`);
});
