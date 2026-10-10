import { GoogleGenAI } from "@google/genai";
import { buildConfusionPrompt, buildCatchUpPrompt, } from "./prompts.js";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    throw new Error("Api key is missing from .env file.");
}

const ai = new GoogleGenAI({ apiKey });

export async function answerConfusion({
    selectedText,
    question,
    slideText,
    notesExcerpt = "",
    transcriptExcerpt = "",
}) {
    const prompt = buildConfusionPrompt({
        selectedText,
        question,
        slideText,
        notesExcerpt,
        transcriptExcerpt,
    });

    const result = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents: prompt,
    });

    const answer = result.text?.trim();

    if (!answer) {
        throw new Error("An empty answer is returned.");
    }

    return answer;
}

export async function summarizeRecentTranscript({
    recentTranscript,
    slideText = "",
}) {
    const prompt = buildCatchUpPrompt({
        recentTranscript,
        slideText,
    });

    const result = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
        contents: prompt,
    });

    const summary = result.text
        ?.trim()
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 3);

    if (!summary || summary.length === 0) {
        throw new Error("Gemini returned an empty catch-up summary.");
    }

    return summary;
}