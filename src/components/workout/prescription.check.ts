/** Self-check for prescription.ts. Run: `bun src/components/workout/prescription.check.ts` */
import assert from "node:assert/strict";
import { defaultReps, rowsOf, seedSets, sessionSteps, workingValues, type SetRow } from "./prescription";

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

// One row per prescribed set, numbered from 0, prefill applied by name.
assert.deepEqual(
  seedSets(
    [
      { name: "Squat", sets: 2, reps: "5" },
      { name: "Tractions", sets: 1, reps: "AMRAP" },
    ],
    [{ name: "Squat", weight: 80, reps: 6 }],
  ),
  [
    { exerciseName: "Squat", index: 0, weight: 80, reps: 6 },
    { exerciseName: "Squat", index: 1, weight: 80, reps: 6 },
    // Never trained → 0 kg and the prescription's reps, not another exercise's.
    { exerciseName: "Tractions", index: 0, weight: 0, reps: 10 },
  ],
);

// A prefill entry for an exercise that isn't in the day is ignored, not appended.
assert.deepEqual(seedSets([], [{ name: "Squat", weight: 80, reps: 6 }]), []);

// ── Circuits ────────────────────────────────────────────────────────────────

// "4 tours : 10 pompes, 15 abdos, 5 tractions" — the day this whole thing exists
// for. One row per tour per exercise, stamped with its provenance; `sets` IS the
// round count, so the row cardinality is the classic one.
const circuitDay = [
  { name: "Pompes", sets: 4, reps: "10", circuit: "A", slot: "a1" },
  { name: "Abdos", sets: 4, reps: "15", circuit: "A", slot: "a2" },
  { name: "Tractions", sets: 4, reps: "5", circuit: "A", slot: "a3" },
];
const seeded = seedSets(circuitDay, [{ name: "Pompes", weight: 0, reps: 12 }]);
assert.equal(seeded.length, 12);
assert.deepEqual(seeded[0], {
  exerciseName: "Pompes",
  index: 0,
  weight: 0,
  reps: 12,
  circuit: "A",
  slot: "a1",
  round: 1,
});
assert.deepEqual(
  seeded.filter((set) => set.slot === "a3").map((set) => set.round),
  [1, 2, 3, 4],
);
// A classic exercise in the same call keeps the shape it has always had: no
// circuit, no slot, no round — that's what an old client sends too.
assert.deepEqual(seedSets([{ name: "Squat", sets: 1, reps: "5" }], []), [
  { exerciseName: "Squat", index: 0, weight: 0, reps: 5 },
]);

/** The rows as they exist in `sets`, `done` of them checked off in walk order. */
const rowsAfter = (day: typeof circuitDay, done: number) => {
  const walked = sessionSteps(
    day,
    seedSets(day, []).map((set) => ({ ...set, completed: false })),
  );
  for (const [i, step] of walked.entries()) if (i < done) step.row.completed = true;
  return walked.map((step) => step.row);
};

const label = (day: typeof circuitDay, done: number) =>
  sessionSteps(day, rowsAfter(day, done)).map(
    (step) => `${step.row.exerciseName}#${step.row.round}${step.row.completed ? "✓" : ""}`,
  );

// The walk: exercise 1 → 2 → 3 → next tour, not exercise 1 to completion.
assert.deepEqual(label(circuitDay, 0).slice(0, 5), [
  "Pompes#1",
  "Abdos#1",
  "Tractions#1",
  "Pompes#2",
  "Abdos#2",
]);
assert.equal(label(circuitDay, 0).length, 12);

// Resume mid-circuit: the first incomplete step, ordered by (tour, position in
// the circuit) — not the first incomplete exercise, which would be Pompes#2.
const midway = sessionSteps(circuitDay, rowsAfter(circuitDay, 4));
const resume = midway.find((step) => !step.row.completed);
assert.equal(resume?.row.exerciseName, "Abdos");
assert.equal(resume?.row.round, 2);
// …and the occurrence it pages to is Abdos' index in the day, whatever the
// exercise the previous set belonged to.
assert.equal(resume?.at, 1);

// A correction: un-checking tour 1 of Pompes makes it the resume point again,
// because the walk is derived from the rows and nothing else.
const corrected = rowsAfter(circuitDay, 4);
corrected[0].completed = false;
const afterFix = sessionSteps(circuitDay, corrected).find((step) => !step.row.completed);
assert.equal(afterFix?.row.exerciseName, "Pompes");
assert.equal(afterFix?.row.round, 1);

// An incomplete circuit — abandoned after two tours — has open steps left and
// they're the ones the séance stopped on.
const abandoned = sessionSteps(circuitDay, rowsAfter(circuitDay, 6)).filter(
  (step) => !step.row.completed,
);
assert.equal(abandoned.length, 6);
assert.equal(abandoned[0].row.round, 3);

// The same exercise twice in one circuit: two occurrences, two slots, and their
// rows must not merge. Pompes appears at index 0 and index 2.
const twice = [
  { name: "Pompes", sets: 3, reps: "10", circuit: "A", slot: "a1" },
  { name: "Gainage", sets: 3, reps: "30 s", circuit: "A", slot: "a2" },
  { name: "Pompes", sets: 3, reps: "8", circuit: "A", slot: "a3" },
];
const twiceRows = seedSets(twice, []).map((set) => ({ ...set, completed: false }));
assert.equal(rowsOf(twice[0], twiceRows).length, 3);
assert.equal(rowsOf(twice[2], twiceRows).length, 3);
assert.deepEqual(
  rowsOf(twice[2], twiceRows).map((row) => row.slot),
  ["a3", "a3", "a3"],
);
// …and the walk hits both occurrences in each tour, in array order.
assert.deepEqual(
  sessionSteps(twice, twiceRows)
    .slice(0, 4)
    .map((step) => `${step.at}#${step.row.round}`),
  ["0#1", "1#1", "2#1", "0#2"],
);

// A classic day is untouched: one exercise at a time, all its sets, in order.
const classic = [
  { name: "Squat", sets: 3, reps: "5" },
  { name: "Développé", sets: 2, reps: "8" },
];
const classicRows = seedSets(classic, []).map((set) => ({ ...set, completed: false }));
assert.deepEqual(
  sessionSteps(classic, classicRows).map((step) => `${step.at}.${step.row.index}`),
  ["0.0", "0.1", "0.2", "1.0", "1.1"],
);
// Rows with no slot still resolve by name, which is how a séance started before
// provenance existed keeps working after the deploy.
assert.equal(rowsOf({ name: "Squat", slot: "a1" }, classicRows).length, 3);

// A day mixing a classic exercise and a circuit does NOT interleave them: the
// squat runs to completion, then the circuit rotates.
const mixed = [
  { name: "Squat", sets: 2, reps: "5" },
  { name: "Pompes", sets: 2, reps: "10", circuit: "A", slot: "a1" },
  { name: "Abdos", sets: 2, reps: "15", circuit: "A", slot: "a2" },
];
assert.deepEqual(
  sessionSteps(
    mixed,
    seedSets(mixed, []).map((set) => ({ ...set, completed: false })),
  ).map((step) => `${step.at}#${step.row.round ?? step.row.index}`),
  ["0#0", "0#1", "1#1", "2#1", "1#2", "2#2"],
);

// An extra set beyond the prescription stays reachable: rounds never fall below
// the rows on hand.
const extra = seedSets(circuitDay, []).map((set) => ({ ...set, completed: false }));
extra.push({
  exerciseName: "Pompes",
  index: 4,
  weight: 0,
  reps: 10,
  circuit: "A",
  slot: "a1",
  round: 5,
  completed: false,
});
assert.equal(sessionSteps(circuitDay, extra).length, 13);

console.log("prescription.ts ok");
