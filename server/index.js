import "dotenv/config";
import cors from "cors";
import express from "express";
import { answerConfusion } from "./gemini.js";

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

app.listen(port, () => {
    console.log(`LockIn backend is running at https://localhost:${port}`);
});
