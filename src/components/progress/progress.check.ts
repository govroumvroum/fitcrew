/** Self-check for convex/progress.ts. Run: `bun src/components/progress/progress.check.ts` */
import assert from "node:assert/strict";
import {
  bestPrs,
  currentStreak,
  epley1rm,
  lastInLineage,
  nextDayIndex,
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
  bodyweightReps: 0, // every Squat set carried load
});
assert.deepEqual(stats.get("Tractions"), {
  maxWeight: 0,
  maxReps: 12,
  volume: 0,
  est1rm: 0,
  bodyweightReps: 12,
});
assert.equal(statsByExercise([]).size, 0);
// An exercise with nothing completed doesn't appear at all.
assert.equal(statsByExercise([set("Squat", 100, 5, false)].concat()).size, 0);

// --- PR candidates -----------------------------------------------------------
const candidates = prCandidates(session);
const valueOf = (name: string, type: PrType) =>
  candidates.find((c) => c.exerciseName === name && c.type === type)?.value;
assert.equal(valueOf("Squat", "max_weight"), 110);
assert.equal(valueOf("Squat", "max_volume"), 830);
assert.equal(valueOf("Squat", "est_1rm"), epley1rm(110, 3));
// A LOADED exercise never claims a reps record: 5 reps at 110 kg is not "5 reps".
assert.equal(valueOf("Squat", "max_reps"), undefined);
// Bodyweight: reps only — no 0 kg record, no 0 volume record, no 1RM.
assert.equal(valueOf("Tractions", "max_reps"), 12);
assert.equal(valueOf("Tractions", "max_weight"), undefined);
assert.equal(valueOf("Tractions", "max_volume"), undefined);
assert.equal(valueOf("Tractions", "est_1rm"), undefined);

// THE POINT OF ALL THIS: junk-volume reps must not outrank real strength.
// 50 reps at 1 kg beats nothing that 8 reps at 80 kg set.
const silly = prCandidates([set("Curl", 1, 50)]);
const real = prCandidates([set("Curl", 80, 8)]);
const pick = (rows: typeof silly, type: PrType) => rows.find((c) => c.type === type)?.value ?? 0;
assert.equal(pick(silly, "max_reps"), 0); // loaded, so no reps record at all
assert.ok(pick(silly, "est_1rm") < pick(real, "est_1rm"));
assert.ok(pick(silly, "max_weight") < pick(real, "max_weight"));

// Epley is nonsense past 15 reps, so a conditioning set claims no strength record.
assert.equal(pick(prCandidates([set("Curl", 20, 40)]), "est_1rm"), 0);

// First-ever loaded set: weight, 1RM and volume — but not reps.
assert.deepEqual(
  prCandidates([set("Curl", 20, 10)])
    .map((c) => c.type)
    .sort(),
  ["est_1rm", "max_volume", "max_weight"],
);
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
// bestPrs must keep baseline rows — `recordPrs` compares against them, or a
// baselined exercise looks like it has no history and gets re-baselined. The
// `overview` query is what splits them, and only the winning row's flag decides:
// a baseline that has since been beaten is no longer in the list at all.
const withBaselines = bestPrs([
  { ...pr("Squat", "max_weight", 100, "2026-01-01"), baseline: true },
  { ...pr("Squat", "max_weight", 110, "2026-02-01"), baseline: false },
  { ...pr("Tractions", "max_reps", 8, "2026-01-01"), baseline: true },
]);
assert.deepEqual(
  withBaselines.filter((p) => !p.baseline).map((p) => p.exerciseName),
  ["Squat"],
);
assert.deepEqual(
  withBaselines.filter((p) => p.baseline).map((p) => p.exerciseName),
  ["Tractions"],
);

// --- program day rotation ----------------------------------------------------
// One program, "muscu", made of two versions: v1 was swapped into v2.
const muscu = new Set(["muscu1", "muscu2"]);
const boxe = new Set(["boxe1"]);
const on = (programId: string, date: string, dayIndex?: number) => ({
  programId,
  date,
  ...(dayIndex === undefined ? {} : { dayIndex }),
});

// No history: the very first séance starts at the top of the program.
assert.equal(nextDayIndex(3, [], muscu, "2026-07-28"), 0);
// An imported séance carries no dayIndex, so it hands over nothing.
assert.equal(nextDayIndex(3, [on("muscu2", "2026-07-27")], muscu, "2026-07-28"), 0);
assert.equal(nextDayIndex(3, [on("muscu2", "2026-07-27", 0)], muscu, "2026-07-28"), 1);
// THE POINT: the last day wraps back to the first instead of falling off the end.
assert.equal(nextDayIndex(3, [on("muscu2", "2026-07-27", 2)], muscu, "2026-07-28"), 0);
assert.equal(nextDayIndex(1, [on("muscu2", "2026-07-27", 0)], muscu, "2026-07-28"), 0);
// Today's séance already picked its day — no rotation while it's in progress.
assert.equal(nextDayIndex(3, [on("muscu2", "2026-07-28", 2)], muscu, "2026-07-28"), 2);
// No program days to rotate through.
assert.equal(nextDayIndex(0, [on("muscu2", "2026-07-27", 2)], muscu, "2026-07-28"), 0);

// THE OTHER POINT: two programs run in parallel and never nudge each other.
// `recent` is newest-first, all programs mixed, exactly as the query returns it.
const mixed = [
  on("boxe1", "2026-07-28", 1), // boxing today
  on("muscu2", "2026-07-27", 0), // muscu yesterday, day 0
];
assert.equal(nextDayIndex(3, mixed, muscu, "2026-07-29"), 1, "muscu avance sur SON historique");
assert.equal(nextDayIndex(2, mixed, boxe, "2026-07-29"), 0, "la boxe avance sur le sien");
// A séance of an older VERSION of the program still counts as that program's.
assert.equal(nextDayIndex(3, [on("muscu1", "2026-07-27", 1)], muscu, "2026-07-28"), 2);
// A séance attached to no program (a retroactive log) moves nothing.
assert.equal(nextDayIndex(3, [{ date: "2026-07-27", dayIndex: 2 }], muscu, "2026-07-28"), 0);

// --- trainedToday ------------------------------------------------------------
// `programs.list` computes it as `lastInLineage(recent, lineage)?.date === date`.
// It's what lets the séance screen offer boxe once muscu is finished, instead of
// sitting on the récap: "already trained" is PER PROGRAM, not per day.
const trainedToday = (recent: Parameters<typeof nextDayIndex>[1], l: Set<string>, d: string) =>
  lastInLineage(recent, l)?.date === d;

assert.equal(trainedToday(mixed, boxe, "2026-07-28"), true, "la boxe a été faite aujourd'hui");
assert.equal(trainedToday(mixed, muscu, "2026-07-28"), false, "la muscu, non — c'était hier");
assert.equal(trainedToday([], muscu, "2026-07-28"), false);
// An older VERSION of the program still counts as that program trained today.
assert.equal(trainedToday([on("muscu1", "2026-07-28", 0)], muscu, "2026-07-28"), true);
// A séance attached to no program never marks any program as trained.
assert.equal(trainedToday([{ date: "2026-07-28", dayIndex: 0 }], muscu, "2026-07-28"), false);

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
