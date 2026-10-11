import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { lectureDateOf } from "./shared.js";

/**
 * One contract, run against both stores: the in-memory fallback is only a fallback
 * if it behaves exactly like Postgres. The Postgres run uses a separate test
 * database (created by `npm test`) and wipes it first, never the dev database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/lockin_test";

const id = () => crypto.randomUUID();
const keysOf = (object) => Object.keys(object).sort();

const LECTURE_KEYS = [
    "classId", "deckHash", "endedAt", "filename", "id", "lectureDate",
    "snapshot", "startedAt", "studentId", "title", "updatedAt",
];
const FLAG_KEYS = [
    "aiAnswer", "id", "receivedAt", "selectedText", "sessionId",
    "slideIndex", "source", "studentText", "type",
];

/** Rejects with a StoreError of this kind. */
const rejectsWith = (promise, kind) => assert.rejects(promise, (error) => {
    assert.equal(error.name, "StoreError", `expected StoreError, got ${error.name}: ${error.message}`);
    assert.equal(error.kind, kind);
    return true;
});

function contract(name, load) {
    describe(name, () => {
        let store;
        before(async () => {
            store = await load();
        });

        test("anonymous users are created once, by the client's id", async (t) => {
            if (!store) return t.skip("store unavailable");
            const userId = id();
            assert.deepEqual(await store.ensureUser(userId), { id: userId });
            assert.deepEqual(await store.ensureUser(userId.toUpperCase()), { id: userId });
            await rejectsWith(store.ensureUser("not-a-uuid"), "invalid");
        });

        test("class codes are upper-cased, unique and found case-insensitively", async (t) => {
            if (!store) return t.skip("store unavailable");
            const code = `bio${Math.floor(Math.random() * 1e9)}`;
            const created = await store.createClass({ lecturerId: id(), title: " BIOL 101 ", code: ` ${code} ` });
            assert.deepEqual(keysOf(created), ["code", "createdAt", "id", "lecturerId", "title"]);
            assert.equal(created.code, code.toUpperCase());
            assert.equal(created.title, "BIOL 101");
            assert.deepEqual(await store.findClassByCode(code), created);
            assert.equal(await store.findClassByCode("NOPE-NOT-A-CLASS"), null);
            assert.equal(await store.findClassByCode(""), null);
            await rejectsWith(store.createClass({ lecturerId: id(), title: "Other", code }), "conflict");
            await rejectsWith(store.createClass({ lecturerId: id(), title: "Other", code: "  " }), "invalid");
            await rejectsWith(store.createClass({ lecturerId: id(), title: " ", code: `${code}x` }), "invalid");
        });

        test("starting a lecture joins a class by code, or none when blank", async (t) => {
            if (!store) return t.skip("store unavailable");
            const code = `chem${Math.floor(Math.random() * 1e9)}`;
            const cls = await store.createClass({ lecturerId: id(), title: "CHEM 101", code });
            const studentId = id();

            const inClass = await store.startLecture({
                studentId, classCode: code.toLowerCase(), title: "Lecture 3", filename: "ch3.pdf", deckHash: "abc",
            });
            assert.deepEqual(keysOf(inClass), LECTURE_KEYS);
            assert.equal(inClass.classId, cls.id);
            assert.equal(inClass.studentId, studentId);
            assert.equal(inClass.deckHash, "abc");
            assert.equal(inClass.lectureDate, lectureDateOf(new Date(inClass.startedAt)));
            assert.equal(inClass.endedAt, null);
            assert.equal(inClass.snapshot, null);

            const solo = await store.startLecture({ studentId, classCode: "  " });
            assert.equal(solo.classId, null);
            assert.equal(solo.title, null);

            await rejectsWith(store.startLecture({ studentId, classCode: "NO-SUCH-CLASS" }), "not_found");
            await rejectsWith(store.startLecture({ studentId: "bad" }), "invalid");
            assert.deepEqual(await store.getLecture(inClass.id), inClass);
            assert.equal(await store.getLecture(id()), null);
        });

        test("updating a lecture changes only what's passed and stamps updatedAt", async (t) => {
            if (!store) return t.skip("store unavailable");
            const lecture = await store.startLecture({ studentId: id(), title: "Keep me" });
            await sleep(5);
            const snapshot = { notes: { 0: "first" }, highlights: [{ text: "ATP", rects: [1, 2] }], skip: undefined };
            const endedAt = new Date().toISOString();
            const updated = await store.updateLecture(lecture.id, { endedAt, snapshot });

            assert.equal(updated.title, "Keep me");
            assert.equal(updated.endedAt, endedAt);
            assert.deepEqual(updated.snapshot, { notes: { 0: "first" }, highlights: [{ text: "ATP", rects: [1, 2] }] });
            assert.ok(updated.updatedAt > lecture.updatedAt);
            assert.deepEqual(await store.getLecture(lecture.id), updated);

            // Top-level arrays are stored as JSON, not turned into Postgres arrays.
            assert.deepEqual((await store.updateLecture(lecture.id, { snapshot: [1, "two"] })).snapshot, [1, "two"]);
            assert.equal((await store.updateLecture(lecture.id, { endedAt: null })).endedAt, null);

            await rejectsWith(store.updateLecture(id(), { title: "x" }), "not_found");
            await rejectsWith(store.updateLecture(lecture.id, { endedAt: "not a time" }), "invalid");
        });

        test("lecture history is newest first, with class title and flag count", async (t) => {
            if (!store) return t.skip("store unavailable");
            const studentId = id();
            const code = `hist${Math.floor(Math.random() * 1e9)}`;
            await store.createClass({ lecturerId: id(), title: "History Class", code });
            const older = await store.startLecture({ studentId, classCode: code, title: "older" });
            await sleep(5);
            const newer = await store.startLecture({ studentId, title: "newer" });
            await store.addFlag(older.id, { type: "confusing" });
            await store.addFlag(older.id, { type: "catch_up" });
            await store.startLecture({ studentId: id(), title: "someone else's" });

            const history = await store.listLectures(studentId);
            assert.deepEqual(history.map((l) => l.title), ["newer", "older"]);
            assert.deepEqual(keysOf(history[0]), [
                "classTitle", "endedAt", "filename", "flagCount", "id", "lectureDate", "startedAt", "title",
            ]);
            assert.deepEqual(history.map((l) => [l.classTitle, l.flagCount]), [[null, 0], ["History Class", 2]]);
            assert.equal(history[0].id, newer.id);
            assert.deepEqual(await store.listLectures(id()), []);
        });

        test("flags validate like the database constraints", async (t) => {
            if (!store) return t.skip("store unavailable");
            const lecture = await store.startLecture({ studentId: id() });

            const minimal = await store.addFlag(lecture.id, { type: "catch_up" });
            assert.deepEqual(keysOf(minimal), FLAG_KEYS);
            assert.equal(typeof minimal.id, "string");
            assert.deepEqual(
                [minimal.slideIndex, minimal.source, minimal.selectedText, minimal.studentText, minimal.aiAnswer],
                [-1, null, null, null, null],
            );

            const full = await store.addFlag(lecture.id, {
                type: "confusing", slideIndex: 4, source: "slide",
                selectedText: " Proton gradient drives ATP synthase ", studentText: "why?", aiAnswer: "Because…",
            });
            assert.deepEqual(
                [full.type, full.slideIndex, full.source, full.selectedText, full.studentText, full.aiAnswer],
                ["confusing", 4, "slide", "Proton gradient drives ATP synthase", "why?", "Because…"],
            );
            assert.ok(Date.parse(full.receivedAt) > 0);

            await rejectsWith(store.addFlag(lecture.id, { type: "example" }), "invalid");
            await rejectsWith(store.addFlag(lecture.id, { type: "confusing", slideIndex: -2 }), "invalid");
            await rejectsWith(store.addFlag(lecture.id, { type: "confusing", slideIndex: 1.5 }), "invalid");
            await rejectsWith(store.addFlag(lecture.id, { type: "confusing", source: "email" }), "invalid");
            await rejectsWith(store.addFlag(id(), { type: "confusing" }), "not_found");
            await rejectsWith(store.addFlag("nope", { type: "confusing" }), "invalid");
        });

        test("recent transcript is the last few segments on that slide, oldest first", async (t) => {
            if (!store) return t.skip("store unavailable");
            const lecture = await store.startLecture({ studentId: id() });
            const base = Date.parse("2026-10-10T18:00:00Z");
            for (let i = 1; i <= 6; i++) {
                await store.addTranscriptSegment(lecture.id, {
                    slideIndex: 2, text: ` part ${i} `,
                    startedAt: base + i * 10_000, endedAt: base + i * 10_000 + 9_000,
                });
            }
            await store.addTranscriptSegment(lecture.id, { slideIndex: 3, text: "other slide" });

            assert.equal(await store.getRecentTranscript(lecture.id, 2), "part 3 part 4 part 5 part 6");
            assert.equal(await store.getRecentTranscript(lecture.id, 2, 2), "part 5 part 6");
            assert.equal(await store.getRecentTranscript(lecture.id, 9), "");
            assert.equal(await store.getRecentTranscript(id(), 2), "");

            const segment = await store.addTranscriptSegment(lecture.id, { text: "no times given" });
            assert.deepEqual(keysOf(segment), ["endedAt", "id", "sessionId", "slideIndex", "startedAt", "text"]);
            assert.equal(segment.slideIndex, -1);
            assert.equal(segment.startedAt, segment.endedAt);

            await rejectsWith(store.addTranscriptSegment(lecture.id, { text: "   " }), "invalid");
            await rejectsWith(store.addTranscriptSegment(lecture.id, { text: "x", startedAt: base + 1, endedAt: base }), "invalid");
            await rejectsWith(store.addTranscriptSegment(id(), { text: "x" }), "not_found");
        });
    });
}

contract("memory store", () => import("./memoryStore.js"));

let pool;
contract("postgres store", async () => {
    // Never wipe anything but a database named *_test.
    if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
        throw new Error(`Refusing to reset ${TEST_DATABASE_URL}: the test database name must end in _test.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const db = await import("../db.js");
    pool = db.pool;
    try {
        await db.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    } catch (error) {
        console.warn(`Skipping Postgres tests (${error.message}). Run: createdb lockin_test`);
        return null;
    }
    return import("./pgStore.js");
});

after(() => pool?.end());
