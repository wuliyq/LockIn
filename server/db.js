import "dotenv/config";
import pg from "pg";

/**
 * One shared Postgres pool for the whole server. Only imported when the server
 * runs on Postgres; USE_MEMORY=1 keeps the in-memory store and never loads this.
 *
 * Local Postgres, so no SSL. Set up with:
 *   createdb lockin && psql lockin -f server/db/schema.sql
 */

const connectionString = process.env.DATABASE_URL;

// pg would silently fall back to localhost defaults; fail loudly instead.
if (!connectionString) {
    throw new Error(
        "DATABASE_URL is missing from .env. Set it (e.g. postgres://localhost:5432/lockin), " +
        "or run with USE_MEMORY=1 to use the in-memory store.",
    );
}

export const pool = new pg.Pool({ connectionString, max: 10 });

// An idle client losing its connection (Postgres restarted, laptop slept) emits
// here; without a listener Node treats it as unhandled and the server crashes.
pool.on("error", (error) => {
    console.error("Postgres pool error:", error.message);
});

export const query = (text, params) => pool.query(text, params);
