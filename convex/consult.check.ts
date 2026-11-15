/** Self-check for the consult boundary. Run: `bun convex/consult.check.ts` */
import assert from "node:assert/strict";
import { flattenExercises, normalizeConsult, truncateContext } from "./consult";

// The caller's context is written by a model, so it is bounded, not trusted.
assert.equal(truncateContext("  autour de sa séance de jambes  "), "autour de sa séance de jambes");
assert.equal(truncateContext("abcdef", 3), "abc…");
// The cut is visible AND doesn't leave a dangling space before the ellipsis.
assert.equal(truncateContext("ab cdef", 3), "ab…");
// Exactly at the limit is not truncated — no gratuitous "…".
assert.equal(truncateContext("abc", 3), "abc");
assert.equal(truncateContext(""), "");

// Nulls come back because strict structured output can't express "optional".
// They must be ABSENT afterwards, not null: a consumer writes `answer.meals?.length`.
const bare = normalizeConsult({
  recommendation: "  Rien de spécial à changer.  ",
  meals: null,
  constraints: null,
});
assert.deepEqual(bare, { recommendation: "Rien de spécial à changer.", confidence: "estimated" });
assert.ok(!("meals" in bare), "meals doit être absent, pas null");
assert.ok(!("constraints" in bare), "constraints doit être absent, pas null");

// An empty array is the same answer as "none" and must not survive as a key —
// otherwise the UI renders an empty section.
const empty = normalizeConsult({ recommendation: "ok", meals: [], constraints: [] });
assert.deepEqual(empty, { recommendation: "ok", confidence: "estimated" });

// A full answer keeps everything, and `confidence` is always "estimated": a
// consult is one agent's opinion about the other's field, never a measurement.
assert.deepEqual(
  normalizeConsult({
    recommendation: "Charge en glucides la veille.",
    meals: [{ name: "Riz + poulet", timing: "2 h avant", calories: 650 }],
    constraints: ["sans lactose"],
  }),
  {
    recommendation: "Charge en glucides la veille.",
    meals: [{ name: "Riz + poulet", timing: "2 h avant", calories: 650 }],
    constraints: ["sans lactose"],
    confidence: "estimated",
  },
);

// --- flattenExercises --------------------------------------------------------

const classic = [
  { name: "Squat", sets: 4, reps: "10", restSeconds: 90 },
  { name: "Rowing", sets: 3, reps: "8-12", restSeconds: 60 },
];
// A day without circuits is byte-identical to what the Chef read before.
assert.deepEqual(flattenExercises(classic), ["Squat 4×10", "Rowing 3×8-12"]);

const circuit = [
  ...classic,
  {
    name: "Pompes",
    sets: 4,
    reps: "15",
    restSeconds: 30,
    circuit: "A",
    slot: "A1",
  },
  {
    name: "Abdos",
    sets: 4,
    reps: "20",
    restSeconds: 30,
    circuit: "A",
    slot: "A2",
  },
];
const flat = flattenExercises(circuit);
assert.deepEqual(flat, [
  "Squat 4×10",
  "Rowing 3×8-12",
  "circuit A (4 tours : Pompes 15, Abdos 20)",
]);
// The regression guard: `sets` is the round count, so an exercise of a circuit
// rendered as "Pompes 4×15" tells the other agent "4 séries puis on passe à
// l'exercice suivant" — the exact confusion issue #93 exists to remove.
for (const entry of flat.filter((e) => /Pompes|Abdos/.test(e))) {
  assert.match(entry, /4 tours/);
  assert.doesNotMatch(
    entry,
    /(Pompes|Abdos) \d+×/,
    `exercice de circuit rendu en séries×reps : ${entry}`,
  );
}

console.log("consult boundary ok");
