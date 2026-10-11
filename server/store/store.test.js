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

        describe("lecture-code flow", () => {
            const newCode = () => `lec-${Math.floor(Math.random() * 1e9)}`;

            test("a student's flags under one code today share one lecture", async (t) => {
                if (!store) return t.skip("store unavailable");
                const code = newCode();
                const studentId = id();
                const first = await store.ensureLecture({ studentId, classCode: code });
                const again = await store.ensureLecture({ studentId, classCode: code.toUpperCase() });
                assert.equal(again.id, first.id);
                assert.deepEqual(keysOf(first), LECTURE_KEYS);

                // First use of a code creates its class, with no lecturer.
                const cls = await store.findClassByCode(code);
                assert.equal(first.classId, cls.id);
                assert.deepEqual([cls.title, cls.lecturerId], [code.toUpperCase(), null]);

                const other = await store.ensureLecture({ studentId: id(), classCode: code });
                assert.notEqual(other.id, first.id);
                assert.equal(other.classId, cls.id);

                const nextDay = await store.ensureLecture({
                    studentId, classCode: code, startedAt: new Date(Date.now() + 2 * 86_400_000),
                });
                assert.notEqual(nextDay.id, first.id);

                const solo = await store.ensureLecture({ studentId });
                assert.equal(solo.classId, null);
                assert.equal((await store.ensureLecture({ studentId, classCode: " " })).id, solo.id);
                await rejectsWith(store.ensureLecture({ studentId: "nope", classCode: code }), "invalid");
            });

            test("the dashboard only gets type, slide and time, for groups of 3+ students", async (t) => {
                if (!store) return t.skip("store unavailable");
                const code = newCode();
                const base = Date.parse("2026-10-10T18:00:00Z");
                const lectures = [];
                for (let i = 0; i < 4; i++) lectures.push(await store.ensureLecture({ studentId: id(), classCode: code }));
                const [a, b, c, d] = lectures;
                const flag = (lecture, minute, fields) =>
                    store.addFlag(lecture.id, { receivedAt: new Date(base + minute * 60_000), ...fields });

                await flag(a, 1, { type: "check_thinking", slideIndex: 2, studentText: "is it the slope?", aiAnswer: "SECRET-ANSWER" });
                await flag(b, 2, { type: "check_thinking", slideIndex: 2 });
                await flag(c, 3, { type: "check_thinking", slideIndex: 2, studentText: "bigger step?" });
                for (const m of [4, 5, 6]) await flag(d, m, { type: "confusing", slideIndex: 5, studentText: "only me" });
                for (const [l, m] of [[a, 7], [b, 8], [c, 9]]) await flag(l, m, { type: "catch_up" }); // no slide
                const outsider = await store.ensureLecture({ studentId: id(), classCode: newCode() });
                await flag(outsider, 1, { type: "check_thinking", slideIndex: 2 });

                const at = (minute) => new Date(base + minute * 60_000).toISOString();
                assert.deepEqual(await store.dashboardFlags(code.toLowerCase()), [
                    { type: "check_thinking", slideIndex: 2, receivedAt: at(1), hasQuestion: true },
                    { type: "check_thinking", slideIndex: 2, receivedAt: at(2), hasQuestion: false },
                    { type: "check_thinking", slideIndex: 2, receivedAt: at(3), hasQuestion: true },
                ]);
                assert.deepEqual(await store.dashboardQuestions(code), [
                    { type: "check_thinking", slideIndex: 2, text: "is it the slope?" },
                    { type: "check_thinking", slideIndex: 2, text: "bigger step?" },
                ]);
                assert.deepEqual(await store.dashboardFlags("NO-SUCH-CODE"), []);
                assert.deepEqual(await store.dashboardQuestions(""), []);
            });

            test("resetting a code clears its lectures but keeps the code", async (t) => {
                if (!store) return t.skip("store unavailable");
                const code = newCode();
                const keep = newCode();
                const students = [id(), id(), id()];
                for (const studentId of students) {
                    for (const c of [code, keep]) {
                        const lecture = await store.ensureLecture({ studentId, classCode: c });
                        await store.addFlag(lecture.id, { type: "confusing", slideIndex: 0 });
                        await store.addTranscriptSegment(lecture.id, { slideIndex: 0, text: "hello" });
                    }
                }
                const before = await store.ensureLecture({ studentId: students[0], classCode: code });

                await store.resetClass(code);
                assert.deepEqual(await store.dashboardFlags(code), []);
                assert.equal(await store.getLecture(before.id), null);
                assert.equal(await store.getRecentTranscript(before.id, 0), "");
                assert.ok(await store.findClassByCode(code));
                assert.equal((await store.dashboardFlags(keep)).length, 3);
                await store.resetClass("NO-SUCH-CODE"); // no error
            });
        });

        describe("lecturer views", () => {
            // One class on 2026-10-08, lecture starting 14:50 New York (18:50Z).
            // s0-s3 use deck D1; s4 uploaded a different PDF (D2). Another class
            // meets the same day and must never leak in.
            const START = Date.parse("2026-10-08T18:50:00Z");
            const at = (minutes) => new Date(START + minutes * 60_000).toISOString();
            let room;

            before(async () => {
                if (!store) return;
                const code = `room${Math.floor(Math.random() * 1e9)}`;
                const cls = await store.createClass({ lecturerId: id(), title: "Room", code });
                const students = Array.from({ length: 5 }, () => id());
                const lectures = [];
                for (const [i, studentId] of students.entries()) {
                    lectures.push(await store.startLecture({
                        studentId, classCode: code, deckHash: i < 4 ? "D1" : "D2", startedAt: at(0),
                    }));
                }
                const [l0, l1, l2, l3, l4] = lectures;
                // Same student, an earlier class date with no flags.
                await store.startLecture({ studentId: students[0], classCode: code, deckHash: "D1", startedAt: "2026-10-01T18:50:00Z" });

                const otherCode = `other${Math.floor(Math.random() * 1e9)}`;
                await store.createClass({ lecturerId: id(), title: "Other", code: otherCode });
                const outsider = await store.startLecture({ studentId: id(), classCode: otherCode, deckHash: "D1", startedAt: at(0) });

                const flag = (lecture, minutes, fields) =>
                    store.addFlag(lecture.id, { receivedAt: at(minutes), ...fields });

                // Slide 2 confusing: three D1 students across 14:58-15:01, plus the D2 student.
                await flag(l0, 8, { type: "confusing", slideIndex: 2, studentText: "why do protons move?" });
                await flag(l1, 9, { type: "confusing", slideIndex: 2, studentText: "gradient of what?" });
                await flag(l4, 10, { type: "confusing", slideIndex: 2 });
                await flag(l2, 11, { type: "confusing", slideIndex: 2 });
                // One student clicking four times is one student.
                for (const m of [20, 20.1, 20.2, 20.3]) await flag(l3, m, { type: "confusing", slideIndex: 5 });
                // Slide 4 worked example on one line: three highlighted it on the slide,
                // one in their own notes.
                const line = "Proton gradient drives ATP synthase";
                await flag(l0, 30, { type: "worked_example", slideIndex: 4, source: "slide", selectedText: line, studentText: "a", aiAnswer: "SECRET-ANSWER" });
                await flag(l1, 31, { type: "worked_example", slideIndex: 4, source: "slide", selectedText: line, studentText: "b" });
                await flag(l2, 32, { type: "worked_example", slideIndex: 4, source: "notes", selectedText: line });
                await flag(l3, 33, { type: "worked_example", slideIndex: 4, source: "slide", selectedText: line, studentText: "c" });
                // Catch-ups aren't tied to a slide.
                for (const [l, m] of [[l0, 40], [l1, 41], [l2, 42]]) await flag(l, m, { type: "catch_up" });
                // Three students highlighting the same words in their own notes.
                for (const [l, m] of [[l0, 50], [l1, 50.5], [l2, 51]]) {
                    await flag(l, m, { type: "confusing", slideIndex: 3, source: "notes", selectedText: "my own words" });
                }
                await flag(outsider, 9, { type: "confusing", slideIndex: 2, studentText: "outsider" });

                // l0 recorded the most; l1 recorded an overlapping copy.
                const seg = (lecture, from, to, text) =>
                    store.addTranscriptSegment(lecture.id, { startedAt: at(from), endedAt: at(to), text });
                await seg(l0, 0, 5, "intro");
                await seg(l0, 5, 10, "gradient part");
                await seg(l1, 8, 10, "duplicate copy");

                room = { cls, lectures, students, line };
            });

            test("per-slide heat counts distinct students on the room's deck", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.slideHeat(room.cls.id, "2026-10-08"), [
                    { slideIndex: 2, type: "confusing", flags: 3, students: 3 }, // D2 student excluded
                    { slideIndex: 3, type: "confusing", flags: 3, students: 3 },
                    { slideIndex: 4, type: "worked_example", flags: 4, students: 4 },
                    // slide 5: four flags, one student, hidden
                ]);
            });

            test("highlighted lines only count text selected on the slide", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.highlightedLines(room.cls.id, "2026-10-08"), [
                    { slideIndex: 4, selectedText: room.line, type: "worked_example", flags: 3, students: 3 },
                ]);
            });

            test("timeline buckets start at the first flag, so a burst across :00 stays together", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.timeline(room.cls.id, "2026-10-08"), [
                    // 14:58-15:03: s0, s1, D2 student, s2 (the whole room, not just the deck)
                    { bucketStart: at(8), bucketEnd: at(13), type: "confusing", flags: 4, students: 4 },
                    { bucketStart: at(28), bucketEnd: at(33), type: "worked_example", flags: 3, students: 3 },
                    { bucketStart: at(38), bucketEnd: at(43), type: "catch_up", flags: 3, students: 3 },
                    { bucketStart: at(48), bucketEnd: at(53), type: "confusing", flags: 3, students: 3 },
                ]);
            });

            test("date picker lists every date with ungated totals", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.listLectureDates(room.cls.id), [
                    { lectureDate: "2026-10-08", students: 5, flags: 18 },
                    { lectureDate: "2026-10-01", students: 1, flags: 0 },
                ]);
            });

            test("drill-down reads only the transcript copy with the most coverage", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.transcriptWindow(room.cls.id, "2026-10-08", at(7), at(9)), [
                    { startedAt: at(5), endedAt: at(10), text: "gradient part" },
                ]);
                assert.deepEqual(await store.transcriptWindow(room.cls.id, "2026-10-01", at(0), at(60)), []);
            });

            test("raw questions only come back once three students asked on that slide", async (t) => {
                if (!store) return t.skip("store unavailable");
                assert.deepEqual(await store.studentQuestions(room.cls.id, "2026-10-08", 4), ["a", "b", "c"]);
                assert.deepEqual(await store.studentQuestions(room.cls.id, "2026-10-08", 2), []);
            });

            test("no lecturer view leaks ids, answers or notes text", async (t) => {
                if (!store) return t.skip("store unavailable");
                const date = "2026-10-08";
                const everything = JSON.stringify([
                    await store.slideHeat(room.cls.id, date),
                    await store.highlightedLines(room.cls.id, date),
                    await store.timeline(room.cls.id, date),
                    await store.listLectureDates(room.cls.id),
                    await store.transcriptWindow(room.cls.id, date, at(0), at(60)),
                ]);
                for (const secret of [...room.students, ...room.lectures.map((l) => l.id), "SECRET-ANSWER", "my own words", "outsider"]) {
                    assert.ok(!everything.includes(secret), `leaked ${secret}`);
                }
            });

            test("empty rooms and bad input", async (t) => {
                if (!store) return t.skip("store unavailable");
                const empty = id();
                for (const view of [store.slideHeat, store.highlightedLines, store.timeline]) {
                    assert.deepEqual(await view(empty, "2026-10-08"), []);
                }
                assert.deepEqual(await store.listLectureDates(empty), []);
                assert.deepEqual(await store.studentQuestions(empty, "2026-10-08", 0), []);
                await rejectsWith(store.slideHeat(room.cls.id, "10/08/2026"), "invalid");
                await rejectsWith(store.timeline("nope", "2026-10-08"), "invalid");
            });
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
