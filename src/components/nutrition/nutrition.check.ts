/** Self-check for the pure helpers in macros.tsx.
 *  Run: `bun src/components/nutrition/nutrition.check.ts` */
import assert from "node:assert/strict";
import type { MealSlot } from "../../../convex/nutrition";
import { groupBySlot, macroLine, parseNum, pct, remaining, macrosOnly } from "./macros";

// --- bar percentage ----------------------------------------------------------
assert.equal(pct(0, 2000), 0);
assert.equal(pct(1000, 2000), 50);
assert.equal(pct(2000, 2000), 100);
// THE POINT: 150 % of a target is a full bar, not a 1.5× wide one overflowing
// its track.
assert.equal(pct(3000, 2000), 100);
// No target to divide by — a brand-new user with no profile has all four at 0.
assert.equal(pct(500, 0), 0);
assert.equal(pct(500, -10), 0);
assert.equal(pct(0, 0), 0);
// A negative consumed can't happen through the mutations, but a clamped floor
// costs one Math.max and a bar can't render backwards.
assert.equal(pct(-100, 2000), 0);

// --- remaining ---------------------------------------------------------------
assert.equal(remaining(1200, 2000), 800);
assert.equal(remaining(2000, 2000), 0);
// Negative means over target. Deliberately signed, not floored: the caller words
// it ("Dépassé de …"), because whether over is bad depends on the goal.
assert.equal(remaining(2400, 2000), -400);
// Rounded, so 1999.6 kcal of logged estimates doesn't print "0,4 kcal restants".
assert.equal(remaining(1999.6, 2000), 0);
// No target at all: nothing to count down from.
assert.equal(remaining(500, 0), null);

// --- one-line macro summary --------------------------------------------------
assert.equal(
  macroLine({ calories: 1520, protein: 32, carbs: 60, fat: 12 }),
  // Thousands grouped the French way by the app's shared formatter — and the
  // separator Intl emits for fr-FR is U+202F, not a space. Spelled explicitly so
  // this reads as deliberate rather than as an invisible character nobody typed.
  "1 520 kcal · P 32 g · G 60 g · L 12 g",
);
assert.equal(
  macroLine({ calories: 0, protein: 0, carbs: 0, fat: 0 }),
  "0 kcal · P 0 g · G 0 g · L 0 g",
);

// --- grouping by slot --------------------------------------------------------
const entry = (slot: MealSlot, name: string) => ({ slot, name });
const grouped = groupBySlot([
  entry("diner", "Saumon"),
  entry("petit_dejeuner", "Flocons"),
  entry("diner", "Salade"),
  entry("collation", "Pomme"),
]);
// Chronological slot order, whatever order the rows arrived in — and the empty
// déjeuner is dropped rather than rendered as a heading with nothing under it.
assert.deepEqual(
  grouped.map((group) => group.slot),
  ["petit_dejeuner", "collation", "diner"],
);
// Entries keep their relative order inside a slot.
assert.deepEqual(
  grouped.find((group) => group.slot === "diner")?.entries.map((e) => e.name),
  ["Saumon", "Salade"],
);
assert.deepEqual(groupBySlot([]), []);

// --- typed figures -----------------------------------------------------------
assert.equal(parseNum("520"), 520);
// A French phone keyboard offers a comma, and a NaN in a macros object is a
// failed mutation.
assert.equal(parseNum("12,5"), 12.5);
assert.equal(parseNum(""), 0);
assert.equal(parseNum("beaucoup"), 0);
assert.equal(parseNum("-3"), 0);

console.log("src/components/nutrition ok");

// `macroLine` composes `macrosOnly`, so a card printing its own kcal headline and
// then `macrosOnly` underneath can't end up showing the energy figure twice.
assert.equal(
  macrosOnly({ calories: 570, protein: 34, carbs: 82, fat: 13 }),
  "P 34 g · G 82 g · L 13 g",
);
assert.equal(
  macroLine({ calories: 570, protein: 34, carbs: 82, fat: 13 }),
  "570 kcal · P 34 g · G 82 g · L 13 g",
);
assert.ok(!macrosOnly({ calories: 570, protein: 34, carbs: 82, fat: 13 }).includes("kcal"));
