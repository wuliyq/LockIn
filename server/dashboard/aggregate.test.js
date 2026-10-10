import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSeed } from "../seed/loadSeed.js";
import { aggregate, bin, MAX_HOTSPOTS } from "./aggregate.js";

const MIN = 60_000;
let nextId = 0;
const flag = (type, student, coversFrom, coversTo) => ({
    id: `f${nextId++}`,
    type,
    studentKey: student,
    clickedAt: coversTo,
    coversFrom,
    coversTo,
    slideIndex: 0,
});

test("a flag spreads a weight of 1 across the buckets its span touches", () => {
    const buckets = bin(
        [flag("confusing", "a", 60_000, 150_000), flag("catch_up", "b", 0, 5 * MIN)],
        10 * MIN,
    );
    // 90s span: 1/3 in each of three buckets, ending exactly on a boundary.
    assert.deepEqual(
        buckets.slice(0, 6).map((b) => b.byType.confusing),
        [0, 0, 1 / 3, 1 / 3, 1 / 3, 0],
    );
    // 5-minute span: 1/10 in each of ten buckets.
    assert.equal(buckets.filter((b) => b.byType.catch_up > 0).length, 10);
    assert.equal(buckets[0].byType.catch_up, 0.1);
});

test("fewer than 3 students surfaces nothing anywhere", () => {
    const result = aggregate({
        durationMs: 10 * MIN,
        flags: [flag("confusing", "a", 0, 90_000), flag("confusing", "b", 0, 90_000)],
    });
    assert.equal(result.hotspots.length, 0);
    assert.equal(result.byType.confusing, 0);
    assert.ok(result.timeline.every((b) => b.total === 0));
});

test("one student flagging three times is still one student", () => {
    const result = aggregate({
        durationMs: 10 * MIN,
        flags: [0, 10_000, 20_000].map((t) => flag("confusing", "a", t, t + 90_000)),
    });
    assert.equal(result.hotspots.length, 0);
    assert.equal(result.byType.confusing, 0);
});

test("three students make a hotspot with range, type, counts and slide", () => {
    const result = aggregate({
        durationMs: 10 * MIN,
        slideTimeline: [
            { index: 0, startMs: 0, endMs: 2 * MIN },
            { index: 1, startMs: 2 * MIN, endMs: 10 * MIN },
        ],
        flags: [
            flag("confusing", "a", 3 * MIN, 4.5 * MIN),
            flag("confusing", "b", 3 * MIN, 4.5 * MIN),
            flag("confusing", "c", 3.5 * MIN, 5 * MIN),
        ],
    });
    // Only the overlap of all three spans clears the threshold.
    assert.deepEqual(result.hotspots, [
        {
            startMs: 3.5 * MIN,
            endMs: 4.5 * MIN,
            dominantType: "confusing",
            total: 3,
            students: 3,
            byType: { catch_up: 0, confusing: 3, real_world: 0, worked_example: 0 },
            slideIndex: 1,
        },
    ]);
    assert.equal(result.byType.confusing, 3);
});

test("keeps only the biggest hotspots, in lecture order", () => {
    const flags = [];
    for (let h = 0; h < MAX_HOTSPOTS + 2; h++) {
        // Hotspot h has 3 + h students, so the first two are the smallest.
        for (let s = 0; s < 3 + h; s++) flags.push(flag("confusing", `h${h}s${s}`, h * 5 * MIN, h * 5 * MIN + MIN));
    }
    const { hotspots } = aggregate({ durationMs: 40 * MIN, flags });
    assert.equal(hotspots.length, MAX_HOTSPOTS);
    assert.deepEqual(
        hotspots.map((h) => h.total),
        [5, 6, 7, 8, 9],
    );
});

test("a session with no flags is an empty dashboard, not an error", () => {
    const withLength = aggregate({ durationMs: 10 * MIN, flags: [] });
    assert.equal(withLength.timeline.length, 20);
    assert.deepEqual(withLength.hotspots, []);

    const noLength = aggregate({ flags: [] });
    assert.deepEqual(noLength.timeline, []);
    assert.deepEqual(noLength.hotspots, []);
});

test("the seeded lecture tells its intended story", () => {
    const seed = loadSeed()[0];
    const result = aggregate(seed);
    const at = (ms) => `${Math.floor(ms / MIN)}:${String((ms / 1000) % 60).padStart(2, "0")}`;

    assert.deepEqual(
        result.hotspots.map((h) => [h.dominantType, h.slideIndex, at(h.startMs), at(h.endMs)]),
        [
            ["catch_up", 3, "11:30", "19:00"], // Krebs cycle: dense, and no motivation
            ["confusing", 4, "21:00", "22:30"], // proton gradient explanation
            ["worked_example", 5, "25:30", "30:00"], // ATP yield never worked through
        ],
    );

    // Below threshold: the lone worked example on Krebs, the two pyruvate real-world
    // requests, and the one student who clicked "confusing" three times.
    assert.equal(result.hotspots[0].byType.worked_example, 0);
    assert.ok(result.timeline.filter((b) => b.endMs <= 11.5 * MIN).every((b) => b.total === 0));

    // Nothing that identifies a student leaves aggregate().
    const json = JSON.stringify(result);
    for (const f of seed.flags) {
        assert.ok(!json.includes(`"${f.studentKey}"`));
        if (f.studentText) assert.ok(!json.includes(f.studentText));
    }
});
