/** Self-check for convex/progress.ts. Run: `bun src/components/progress/progress.check.ts` */
import assert from "node:assert/strict";
import {
  bestPrs,
  currentStreak,
  epley1rm,
  prCandidates,
  statsByExercise,
  weeklyBuckets,
  weekStart,
  type PrType,
  type SetLite,
} from "../../../convex/progress";

const set = (exerciseName: string, weight: number, reps: number, completed = true): SetLite => ({
  exerciseName,
  weight,
  reps,
  completed,
});

// --- estimated 1RM -----------------------------------------------------------
assert.equal(epley1rm(100, 1), 103); // Epley isn't exact at 1 rep; that's Epley.
assert.equal(epley1rm(100, 10), 133);
assert.equal(epley1rm(0, 10), 0); // bodyweight
assert.equal(epley1rm(100, 0), 0); // logged but no reps

// --- per-session aggregation -------------------------------------------------
const session = [
  set("Squat", 100, 5),
  set("Squat", 110, 3),
  set("Squat", 120, 1, false), // failed set: must not count anywhere
  set("Tractions", 0, 12),
];
const stats = statsByExercise(session);
assert.deepEqual(stats.get("Squat"), {
  maxWeight: 110,
  maxReps: 5,
  volume: 100 * 5 + 110 * 3,
  est1rm: epley1rm(110, 3),
});
assert.deepEqual(stats.get("Tractions"), {
  maxWeight: 0,
  maxReps: 12,
  volume: 0,
  est1rm: 0,
});
assert.equal(statsByExercise([]).size, 0);
// An exercise with nothing completed doesn't appear at all.
assert.equal(statsByExercise([set("Squat", 100, 5, false)].concat()).size, 0);

// --- PR candidates -----------------------------------------------------------
const candidates = prCandidates(session);
const valueOf = (name: string, type: PrType) =>
  candidates.find((c) => c.exerciseName === name && c.type === type)?.value;
assert.equal(valueOf("Squat", "max_weight"), 110);
assert.equal(valueOf("Squat", "max_reps"), 5);
assert.equal(valueOf("Squat", "max_volume"), 830);
// Bodyweight: reps only — no 0 kg record, no 0 volume record.
assert.equal(valueOf("Tractions", "max_reps"), 12);
assert.equal(valueOf("Tractions", "max_weight"), undefined);
assert.equal(valueOf("Tractions", "max_volume"), undefined);
// First-ever set is a PR: nothing standing, so every candidate is new.
assert.equal(prCandidates([set("Curl", 20, 10)]).length, 3);
assert.deepEqual(prCandidates([]), []);

// --- standing records (ties are not records) ---------------------------------
const pr = (exerciseName: string, type: PrType, value: number, date: string) => ({
  exerciseName,
  type,
  value,
  date,
});
const standing = bestPrs([
  pr("Squat", "max_weight", 100, "2026-01-01"),
  pr("Squat", "max_weight", 110, "2026-02-01"),
  pr("Squat", "max_reps", 8, "2026-01-01"),
]);
assert.equal(standing.length, 2);
assert.equal(standing.find((p) => p.type === "max_weight")?.value, 110);
// bestPrs keeps the strictly-highest row, so an equal value never replaces it —
// which is what makes `candidate <= previous → skip` in recordPrs a tie.
assert.equal(
  bestPrs([
    pr("Squat", "max_weight", 110, "2026-01-01"),
    pr("Squat", "max_weight", 110, "2026-03-01"),
  ])[0].date,
  "2026-01-01",
);

// --- weeks -------------------------------------------------------------------
assert.equal(weekStart("2026-07-28"), "2026-07-27"); // Tuesday -> Monday
assert.equal(weekStart("2026-07-27"), "2026-07-27"); // Monday -> itself
assert.equal(weekStart("2026-07-26"), "2026-07-20"); // Sunday -> Monday before

const weeks = weeklyBuckets(
  [
    { date: "2026-07-06", volume: 1000 },
    { date: "2026-07-08", volume: 500 },
    // nothing in the week of the 13th
    { date: "2026-07-20", volume: 800 },
  ],
  "2026-07-06",
  "2026-07-26",
);
assert.deepEqual(
  weeks.map((w) => [w.week, w.sessions, w.volume]),
  [
    ["2026-07-06", 2, 1500],
    ["2026-07-13", 0, 0], // the gap is a zero, not a missing bucket
    ["2026-07-20", 1, 800],
  ],
);
assert.deepEqual(weeklyBuckets([], "2026-07-06", "2026-07-06"), [
  { week: "2026-07-06", volume: 0, sessions: 0 },
]);

// --- streak ------------------------------------------------------------------
const s = (...sessions: number[]) => sessions.map((n) => ({ sessions: n }));
assert.equal(currentStreak(s(1, 1, 1)), 3);
assert.equal(currentStreak(s(1, 0, 1, 1)), 2); // gap breaks it
assert.equal(currentStreak(s(1, 1, 0)), 2); // current week not over yet
assert.equal(currentStreak(s(1, 0, 0)), 0); // two empty weeks: dead
assert.equal(currentStreak([]), 0);
assert.equal(currentStreak(s(3, 3, 1), 2), 2); // threshold of 2+/week

console.log("convex/progress.ts ok");
