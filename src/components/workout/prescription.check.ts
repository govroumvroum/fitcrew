/** Self-check for prescription.ts. Run: `bun src/components/workout/prescription.check.ts` */
import assert from "node:assert/strict";
import { defaultReps, workingValues, type SetRow } from "./prescription";

assert.equal(defaultReps("8"), 8);
assert.equal(defaultReps("8-12"), 8);
assert.equal(defaultReps("AMRAP"), 10);
assert.equal(defaultReps("12 par jambe"), 12);

const row = (index: number, weight: number, reps: number, completed: boolean): SetRow => ({
  index,
  weight,
  reps,
  completed,
});

// No rows at all → falls back to the prescription.
assert.deepEqual(workingValues([], "8-12"), { weight: 0, reps: 8 });

// Nothing done yet → the seeded (last session) values of the first set.
assert.deepEqual(workingValues([row(0, 60, 10, false), row(1, 60, 10, false)], "8"), {
  weight: 60,
  reps: 10,
});

// Something done → the last completed set wins, even out of array order.
assert.deepEqual(
  workingValues([row(2, 70, 8, false), row(1, 65, 9, true), row(0, 60, 10, true)], "8"),
  { weight: 65, reps: 9 },
);

console.log("prescription.ts ok");
