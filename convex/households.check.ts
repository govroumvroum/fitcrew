/** Self-check for the household maths. Run: `bun convex/households.check.ts` */
import assert from "node:assert/strict";
import { type PlannedMeal, sharedPortion } from "./households";

const meal = (
  macros: { calories: number; protein: number; carbs: number; fat: number },
  portions?: number,
): PlannedMeal => ({
  slot: "diner",
  name: "Plat du foyer",
  ingredients: [],
  steps: [],
  prepMinutes: 30,
  macros,
  ...(portions !== undefined && { portions }),
});

// The recipe's macros are for ONE portion; the dish totals macros x portions.
const base = meal({ calories: 500, protein: 30, carbs: 50, fat: 20 }, 2);

// Equal targets -> each gets half of the whole dish, integer.
assert.deepEqual(sharedPortion(base, 2000, 2000), {
  calories: 500,
  protein: 30,
  carbs: 50,
  fat: 20,
});

// Ratio split: 2000 vs 1500 -> 4/7 vs 3/7 of the dish. Rounded, and the two
// halves add back up to the whole.
const mine = sharedPortion(base, 2000, 1500);
assert.deepEqual(mine, {
  calories: Math.round((1000 * 4) / 7),
  protein: Math.round((60 * 4) / 7),
  carbs: Math.round((100 * 4) / 7),
  fat: Math.round((40 * 4) / 7),
});
const partner = sharedPortion(base, 1500, 2000);
assert.deepEqual(partner, {
  calories: Math.round((1000 * 3) / 7),
  protein: Math.round((60 * 3) / 7),
  carbs: Math.round((100 * 3) / 7),
  fat: Math.round((40 * 3) / 7),
});

// No `portions` field -> default 2, like every reader's `?? 2`.
const noPortions = meal({ calories: 300, protein: 20, carbs: 30, fat: 10 });
assert.deepEqual(sharedPortion(noPortions, 2000, 2000), {
  calories: 300,
  protein: 20,
  carbs: 30,
  fat: 10,
});

// Every result is whole numbers only.
for (const [a, b] of [
  [2000, 2000],
  [2000, 1500],
  [1500, 2000],
  [1800, 2200],
]) {
  for (const value of Object.values(sharedPortion(base, a, b))) {
    assert.ok(Number.isInteger(value), `${value} pas entier`);
  }
}

// A missing or zero target falls back to an equal split — never a throw, never
// a ratio from one side alone.
const half = { calories: 500, protein: 30, carbs: 50, fat: 20 };
assert.deepEqual(sharedPortion(base, 0, 2000), half);
assert.deepEqual(sharedPortion(base, 2000, 0), half);
assert.deepEqual(sharedPortion(base, 0, 0), half);

console.log("households shared portion ok");
