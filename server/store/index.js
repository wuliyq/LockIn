import "dotenv/config";

/**
 * The server's data store, chosen once at startup. Postgres by default; USE_MEMORY=1
 * switches to the in-memory fallback (no Postgres needed, nothing survives a restart).
 * SHARED_DATA_DIR opts into the shared JSON file store (takes precedence).
 * All export the same async functions with the same shapes and errors, checked by
 * store.test.js, so routes never need to know which is running.
 */

export const storeKind = process.env.SHARED_DATA_DIR?.trim() ? "file" : process.env.USE_MEMORY === "1" ? "memory" : "postgres";

const impl = storeKind === "file"
    ? (await import('./fileStore.js')).createFileStore(process.env.SHARED_DATA_DIR)
    : storeKind === "memory" ? await import("./memoryStore.js") : await import("./pgStore.js");

export const {
    ensureUser,
    createClass,
    findClassByCode,
    startLecture,
    getLecture,
    updateLecture,
    listLectures,
    addFlag,
    addTranscriptSegment,
    getRecentTranscript,
    listLectureDates,
    slideHeat,
    highlightedLines,
    timeline,
    transcriptWindow,
    studentQuestions,
    ensureLecture,
    dashboardFlags,
    dashboardQuestions,
    resetClass,
    listClasses,
    listClassLectures,
    lectureFlags,
    ready,
} = impl;

export { BUCKET_MINUTES, FLAG_TYPES, MIN_STUDENTS, SOURCES, StoreError, isId } from "./shared.js";
