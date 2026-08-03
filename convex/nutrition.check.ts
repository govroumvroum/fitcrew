/** Self-check for the nutrition maths. Run: `bun convex/nutrition.check.ts` */
import assert from "node:assert/strict";
import { type PlanDay, estimateTargets, shoppingListFrom, sumMacros } from "./nutrition";

const base = { age: 30, sex: "h", heightCm: 180, weightKg: 80, activityLevel: "modere" } as const;

const maintien = estimateTargets({ ...base, goal: "maintien" });
const perte = estimateTargets({ ...base, goal: "perte" });
const prise = estimateTargets({ ...base, goal: "prise" });

// The goal is the whole point: a deficit is under maintenance, a surplus over it.
assert.ok(perte.calories < maintien.calories, "perte doit être en déficit");
assert.ok(prise.calories > maintien.calories, "prise doit être en surplus");
assert.equal(perte.calories, Math.round(maintien.calories * 0.8));

// Protein is what you protect in a deficit — 2.0 g/kg vs 1.6.
assert.ok(perte.protein > maintien.protein, "plus de protéines en déficit");
assert.equal(perte.protein, 160);
assert.equal(maintien.protein, 128);

// Whole numbers only: a target of 2143.7 kcal is false precision.
for (const t of [maintien, perte, prise]) {
  for (const value of Object.values(t)) assert.ok(Number.isInteger(value), `${value} pas entier`);
}

// The macros must add back up to the calories — carbs are the remainder, so the
// only gap allowed is the rounding of the three numbers.
for (const t of [maintien, perte, prise]) {
  const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  assert.ok(Math.abs(fromMacros - t.calories) <= 2, `${fromMacros} vs ${t.calories}`);
}

// An absurd input (tiny person, big deficit) floors carbs at 0 instead of going
// negative.
assert.ok(
  estimateTargets({
    goal: "perte",
    age: 100,
    sex: "f",
    heightCm: 100,
    weightKg: 300,
    activityLevel: "sedentaire",
  }).carbs >= 0,
);

// A day with nothing logged is zeros, not a crash.
assert.deepEqual(sumMacros([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
assert.deepEqual(
  sumMacros([
    { macros: { calories: 500, protein: 30, carbs: 50, fat: 20 } },
    { macros: { calories: 250, protein: 12, carbs: 25, fat: 8 } },
  ]),
  { calories: 750, protein: 42, carbs: 75, fat: 28 },
);

const meal = (name: string, ingredients: { name: string; quantity: string }[]) => ({
  slot: "dejeuner" as const,
  name,
  ingredients,
  steps: [],
  prepMinutes: 10,
  macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
});

const days: PlanDay[] = [
  {
    date: "2026-08-03",
    meals: [
      meal("Salade", [
        { name: "Tomate", quantity: "200 g" },
        { name: "Huile d'olive", quantity: "1 cuillère" },
      ]),
    ],
  },
  {
    date: "2026-08-04",
    meals: [meal("Sauce", [{ name: "tomates", quantity: "3" }])],
  },
];

// One shopping line per ingredient, whatever the spelling and the plural: the
// first spelling seen is the display name and every raw quantity is kept as
// written — "200 g" + "3" has no sum.
assert.deepEqual(shoppingListFrom(days), [
  { name: "Tomate", quantities: ["200 g", "3"] },
  { name: "Huile d'olive", quantities: ["1 cuillère"] },
]);

// An empty week is an empty list.
assert.deepEqual(shoppingListFrom([]), []);

console.log("nutrition targets + shopping list ok");
