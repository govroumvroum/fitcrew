/**
 * Self-check for the program shape helpers in convex/coach.ts.
 * Run: `bun src/components/chat/program.check.ts`
 */
import assert from "node:assert/strict";
import { swapInDays, toDays } from "../../../convex/coach";

const squat = { name: "Squat", sets: 4, reps: "8", restSeconds: 120, notes: null };
const presse = { name: "Presse à cuisses", sets: 4, reps: "10", restSeconds: 90 };

// A null note must disappear, not land in the document as null.
const days = toDays([
  { name: "Jour 1 — Legs", exercises: [squat, { ...squat, name: "Fentes", notes: "tempo 3-1-1" }] },
]);
assert.deepEqual(days[0].exercises[0], { name: "Squat", sets: 4, reps: "8", restSeconds: 120 });
assert.equal(days[0].exercises[1].notes, "tempo 3-1-1");

// Swap replaces in place, leaves everything else identical.
const swapped = swapInDays(days, 0, "squat", presse);
assert.deepEqual(swapped[0].exercises[0], presse);
assert.deepEqual(swapped[0].exercises[1], days[0].exercises[1]);
assert.notEqual(swapped, days);
assert.equal(days[0].exercises[0].name, "Squat", "l'original ne doit pas être muté");

// Unknown exercise or day is the model hallucinating — must throw, not no-op.
assert.throws(() => swapInDays(days, 0, "Développé couché", presse), /introuvable/);
assert.throws(() => swapInDays(days, 3, "Squat", presse), /Jour 3/);

console.log("coach program helpers ok");
