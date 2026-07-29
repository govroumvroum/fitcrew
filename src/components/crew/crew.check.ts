/** Self-check for convex/crew.ts. Run: `bun src/components/crew/crew.check.ts` */
import assert from "node:assert/strict";
import { scoreChallenge } from "../../../convex/crew";
import { epley1rm, weekStart, type SetLite } from "../../../convex/progress";
import { monday } from "../../lib/dates";

const set = (exerciseName: string, weight: number, reps: number, completed = true): SetLite => ({
  exerciseName,
  weight,
  reps,
  completed,
});

const week = [
  set("Squat", 100, 5),
  set("Squat", 110, 3),
  set("Squat", 120, 1, false), // failed set: must not count anywhere
  set("Développé couché", 80, 8),
  set("Tractions", 0, 12),
  set("Tractions", 0, 10),
];

// --- sessions: the only metric that ignores sets entirely --------------------
assert.equal(scoreChallenge("sessions", undefined, week, 4), 4);
assert.equal(scoreChallenge("sessions", undefined, [], 0), 0);

// --- per-exercise metrics ----------------------------------------------------
assert.equal(scoreChallenge("volume", "Squat", week, 3), 100 * 5 + 110 * 3);
assert.equal(scoreChallenge("max_weight", "Squat", week, 3), 110); // not the failed 120
assert.equal(scoreChallenge("est_1rm", "Squat", week, 3), epley1rm(110, 3));
// Same week, other exercise: the score is scoped, never global.
assert.equal(scoreChallenge("volume", "Développé couché", week, 3), 640);

// THE POINT: "most pull-ups this week" scores unloaded reps only, so a loaded
// exercise can't win a reps challenge with junk volume.
assert.equal(scoreChallenge("max_reps", "Tractions", week, 3), 12);
assert.equal(scoreChallenge("max_reps", "Squat", week, 3), 0);

// --- nothing to score --------------------------------------------------------
assert.equal(scoreChallenge("volume", "Squat", [], 0), 0);
assert.equal(scoreChallenge("max_weight", "Squat", [set("Squat", 100, 5, false)], 1), 0);
// Never logged that exercise, and a per-exercise metric with no exercise named.
assert.equal(scoreChallenge("est_1rm", "Soulevé de terre", week, 3), 0);
assert.equal(scoreChallenge("volume", undefined, week, 3), 0);

// --- the client's monday() must not drift from the server's weekStart() -------
// `crew.create` throws unless weekStart is a Monday, and the UI computes it with
// its own copy — src/lib/dates.ts can't import convex/progress.ts without
// dragging the Convex server runtime into the browser bundle. So the two are
// pinned here instead: a year of dates, every one agreeing.
for (let i = 0; i < 400; i++) {
  const date = new Date(Date.parse("2026-01-01T00:00:00Z") + i * 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.equal(monday(date), weekStart(date), `monday/weekStart disagree on ${date}`);
}

console.log("convex/crew.ts ok");
