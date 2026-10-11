/**
 * Validation and normalisation shared by both stores, so the in-memory store accepts
 * and rejects exactly what Postgres's constraints do, with the same errors.
 */

export const FLAG_TYPES = ["catch_up", "confusing", "real_world", "worked_example"];
export const SOURCES = ["slide", "notes"];

// Must match the timezone hardcoded in lectures.lecture_date (server/db/schema.sql).
export const COURSE_TZ = process.env.COURSE_TZ || "America/New_York";

/** kind: "invalid" (bad input), "not_found", or "conflict" (e.g. a class code taken). */
export class StoreError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = "StoreError";
        this.kind = kind;
    }
}

export const MESSAGES = {
    lectureNotFound: "Lecture not found.",
    classCodeTaken: "That class code is already in use.",
};

const invalid = (message) => new StoreError("invalid", message);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres returns UUIDs lower-case, so both stores do. */
export function requireId(id, name) {
    if (typeof id !== "string" || !UUID.test(id)) throw invalid(`${name} must be a UUID.`);
    return id.toLowerCase();
}

/** Class codes are stored upper-case and trimmed; "" means no class. */
export function normalizeCode(code) {
    return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/** Trimmed text, or null when missing or blank. */
export function optionalText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}

export function requireText(value, name) {
    const text = optionalText(value);
    if (!text) throw invalid(`${name} is required.`);
    return text;
}

/** 0-based slide index; missing means unknown (-1). */
export function slideIndexOf(value) {
    if (value === null || value === undefined) return -1;
    if (!Number.isInteger(value) || value < -1) throw invalid("slideIndex must be an integer, -1 or more.");
    return value;
}

export function requireFlagType(type) {
    if (!FLAG_TYPES.includes(type)) throw invalid(`type must be one of ${FLAG_TYPES.join(", ")}.`);
    return type;
}

export function sourceOf(source) {
    if (source === null || source === undefined) return null;
    if (!SOURCES.includes(source)) throw invalid(`source must be one of ${SOURCES.join(", ")}.`);
    return source;
}

/** A Date from a Date, ISO string or ms number; `fallback` when missing. */
export function dateOf(value, name, fallback = new Date()) {
    if (value === null || value === undefined) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw invalid(`${name} is not a valid time.`);
    return date;
}

/** "YYYY-MM-DD" of a moment in the course timezone, as lectures.lecture_date computes it. */
export function lectureDateOf(date) {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: COURSE_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

/** What a JSONB column hands back: a JSON round-trip (drops undefined, Dates become strings). */
export function asJson(value) {
    return value === undefined || value === null ? null : JSON.parse(JSON.stringify(value));
}
