import "dotenv/config";

/**
 * The server's data store, chosen once at startup. Postgres by default; USE_MEMORY=1
 * switches to the in-memory fallback (no Postgres needed, nothing survives a restart).
 * Both export the same async functions with the same shapes and errors, checked by
 * store.test.js, so routes never need to know which is running.
 */

export const storeKind = process.env.USE_MEMORY === "1" ? "memory" : "postgres";

const impl = storeKind === "memory" ? await import("./memoryStore.js") : await import("./pgStore.js");

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
} = impl;

export { FLAG_TYPES, SOURCES, StoreError } from "./shared.js";
