/** Self-check for portions (#138). Run: `bun convex/portionLogic.check.ts` */
import assert from "node:assert/strict";
import {
  portionRefusal,
  shoppingListFrom,
  type MealBatch,
  type PlanDay,
  type PlannedMeal,
} from "./nutrition";
import {
  type FoodValues,
  type Ingredient,
  applyBatches,
  batchLeftover,
  logFactor,
  macrosFromIngredients,
  foodKey,
  mealPieces,
  normalizeName,
  quantityText,
  rewriteSteps,
  sizeIngredients,
  valuePerUnit,
} from "./portionLogic";

const m = (calories: number, protein = 0, carbs = 0, fat = 0) => ({ calories, protein, carbs, fat });

// A tiny reference: per 100 g, per piece, and a piece known only by weight.
const REF: Record<string, FoodValues> = {
  "pain burger": { perPiece: m(150, 5, 27, 2) },
  "steak hache 5 %": { per100: m(130, 21, 0, 5) },
  tortilla: { per100: m(300, 8, 50, 7), pieceGrams: 40 },
  "poulet effiloche": { per100: m(120, 24, 0, 2) },
  pates: { per100: m(360, 13, 72, 2) },
  "boeuf hache 5 %": { per100: m(130, 21, 0, 5) },
  "sauce tomate": { per100: m(40, 1, 7, 1) },
};
const BY_KEY = new Map(Object.entries(REF).map(([name, values]) => [foodKey(name), values]));
const lookup = (name: string) => BY_KEY.get(foodKey(name));

const g = (name: string, amount: number, scalable = false): Ingredient => ({
  name,
  quantity: quantityText(amount, "g"),
  amount,
  unit: "g",
  scalable,
});
const piece = (name: string, amount: number): Ingredient => ({
  name,
  quantity: quantityText(amount, "piece"),
  amount,
  unit: "piece",
});

// --- values ----------------------------------------------------------------

// A piece known per 100 g converts through its weight, and back.
assert.deepEqual(valuePerUnit(REF.tortilla, "piece"), m(120, 3.2, 20, 2.8));
assert.equal(valuePerUnit({ perPiece: m(150) }, "g"), null, "no piece weight, no per-gram value");
assert.equal(valuePerUnit(undefined, "g"), null);

const burger = [piece("Pain burger", 1), g("Steak haché 5 %", 150, true), { name: "Sel", quantity: "" }];
assert.equal(macrosFromIngredients(burger, lookup)!.calories, 150 + 195);
// An ingredient that weighs but has no structure, or no known value → null.
assert.equal(macrosFromIngredients([...burger, { name: "Cheddar", quantity: "20 g" }], lookup), null);
assert.equal(macrosFromIngredients([g("Inconnu", 100)], lookup), null);

// --- sizing ----------------------------------------------------------------

// Within tolerance: nothing moves.
const same = sizeIngredients(burger, lookup, 350)!;
assert.deepEqual(same.resized, []);
assert.equal(same.macros.calories, 345);

// +100 kcal on a burger: a heavier steak, never a fraction of a bun.
const bigger = sizeIngredients(burger, lookup, 450)!;
assert.equal(bigger.ingredients[0].amount, 1, "the bun stays one bun");
assert.equal(bigger.ingredients[1].amount! % 5, 0, "grams round to 5");
assert.ok(bigger.ingredients[1].amount! > 150);
assert.ok(Math.abs(bigger.macros.calories - 450) < 20, `≈450, got ${bigger.macros.calories}`);
assert.equal(bigger.ingredients[1].quantity, `${bigger.ingredients[1].amount} g`);
assert.deepEqual(bigger.resized, [
  { name: "Steak haché 5 %", from: "150 g", to: `${bigger.ingredients[1].amount} g` },
]);

// Tacos: the filling can't double forever — past ×2 a whole tortilla is added.
const tacos = [piece("Tortilla", 2), g("Poulet effiloché", 120, true)];
const hungry = sizeIngredients(tacos, lookup, 900)!;
assert.ok(Number.isInteger(hungry.ingredients[0].amount!), "whole tortillas only");
assert.equal(hungry.ingredients[0].amount, 3, "one more tortilla");
// …and never below one piece, whatever the target.
const tiny = sizeIngredients([piece("Tortilla", 1), g("Poulet effiloché", 50, true)], lookup, 50)!;
assert.equal(tiny.ingredients[0].amount, 1);
for (const target of [100, 333, 517, 777, 1234, 2000]) {
  for (const i of sizeIngredients(tacos, lookup, target)!.ingredients) {
    if (i.unit === "piece") assert.ok(Number.isInteger(i.amount!) && i.amount! >= 1, `${target}`);
  }
}
// Nothing computable → null, the caller keeps the model's total.
assert.equal(sizeIngredients([{ name: "Riz", quantity: "80 g" }], lookup, 500), null);

// Steps follow the new amounts — only an amount owned by one ingredient.
const steps = ["Saisir les 150 g de steak 3 min.", "Toaster le pain 1 min."];
assert.deepEqual(rewriteSteps(steps, burger, bigger.ingredients), [
  `Saisir les ${bigger.ingredients[1].amount} g de steak 3 min.`,
  "Toaster le pain 1 min.",
]);
const twins = [g("A", 100, true), g("B", 100)];
assert.deepEqual(
  rewriteSteps(["100 g de A, 100 g de B"], twins, [g("A", 150, true), g("B", 100)]),
  ["100 g de A, 100 g de B"],
  "ambiguous amount left alone",
);
// "1150 g" must not be touched when "150 g" changes.
assert.deepEqual(rewriteSteps(["1150 g d'eau"], burger, bigger.ingredients), ["1150 g d'eau"]);

// --- batches ---------------------------------------------------------------

const bolo: MealBatch = {
  id: "bolo",
  name: "Bolognaise",
  cookDate: "2026-11-16",
  ingredients: [g("Pâtes", 300), g("Bœuf haché 5 %", 600), g("Sauce tomate", 500)],
  steps: ["Cuire la marmite."],
  macros: m(9999), // ignored: the reference covers every ingredient
  cookedGrams: 1800,
};
const potKcal = 3 * 360 + 6 * 130 + 5 * 40; // 2060
const eat = (calories: number): PlannedMeal => ({
  slot: "diner",
  name: "Bolognaise",
  ingredients: [],
  steps: ["Réchauffer."],
  prepMinutes: 5,
  macros: m(calories),
  batch: { id: "bolo", share: 0.3 },
});
const week: PlanDay[] = [
  { date: "2026-11-16", meals: [eat(700)] },
  { date: "2026-11-18", meals: [eat(500)] },
];
const out = applyBatches(week, [bolo], lookup);
const [hard, off] = [week[0].meals[0], week[1].meals[0]];
assert.ok(hard.batch!.share > off.batch!.share, "a hard day gets a bigger share");
assert.equal(hard.batch!.share, Math.round((700 / potKcal) * 100) / 100);
assert.equal(hard.macros.calories, Math.round(potKcal * hard.batch!.share));
assert.equal(hard.batch!.cookedGrams, Math.round((1800 * hard.batch!.share) / 10) * 10);
assert.equal(hard.ingredients.length, 3, "what to take out of the pot");
assert.deepEqual(out.batches, [bolo]);
assert.ok(batchLeftover("bolo", week) > 0.3);

// Idempotent: rerunning over its own output moves nothing.
const snapshot = JSON.stringify(week);
applyBatches(week, [bolo], lookup);
assert.equal(JSON.stringify(week), snapshot);

// Shares never exceed the pot.
const greedy: PlanDay[] = [1, 2, 3].map((d) => ({ date: `2026-11-1${d}`, meals: [eat(1000)] }));
const squeezed = applyBatches(greedy, [bolo], lookup);
const total = greedy.reduce((s, d) => s + d.meals[0].batch!.share, 0);
assert.ok(total <= 1.01, `Σ shares ${total}`);
assert.equal(squeezed.notes.length, 1);
assert.equal(batchLeftover("bolo", greedy) <= 0.01, true);

// A pot nobody eats from is dropped; a link to a missing pot is dropped.
const lonely: PlanDay[] = [{ date: "2026-11-16", meals: [{ ...eat(600), batch: { id: "ghost", share: 0.5 } }] }];
const pruned = applyBatches(lonely, [bolo], lookup);
assert.deepEqual(pruned.batches, []);
assert.equal(lonely[0].meals[0].batch, undefined);

// --- shopping list -----------------------------------------------------------

// The pot is bought once; the meals eating from it buy nothing more.
const list = shoppingListFrom(week, [bolo]);
assert.deepEqual(
  list.find((l) => l.name === "Pâtes"),
  { name: "Pâtes", quantities: ["300 g"] },
);
// Pieces add up as pieces, whatever text the model wrote.
const tacoDay: PlanDay[] = [
  {
    date: "2026-11-17",
    meals: [
      { ...eat(600), batch: undefined, ingredients: [{ ...piece("Tortillas de blé", 2), quantity: "2 (100 g)" }] },
      { ...eat(600), slot: "dejeuner", batch: undefined, ingredients: [piece("Tortillas de blé", 3)] },
    ],
  },
];
assert.deepEqual(shoppingListFrom(tacoDay), [{ name: "Tortillas de blé", quantities: ["5"] }]);

// --- the log (decision B) ----------------------------------------------------

assert.equal(logFactor(undefined), 1);
assert.equal(logFactor(0), 1);
assert.equal(logFactor(Number.NaN), 1);
assert.equal(logFactor(1.25), 1.25);
assert.equal(logFactor(10), 3);
assert.equal(logFactor(0.1), 0.25);
assert.equal(mealPieces(tacos), 2);
assert.equal(mealPieces([g("Riz", 80)]), null);

// --- keys --------------------------------------------------------------------

// Accents, ligatures, case and spaces don't split an ingredient in the reference.
for (const spelling of ["Bœuf haché 5 %", "Boeuf haché 5 %", "boeuf  hache 5%", "BŒUF HACHÉ 5 %"]) {
  assert.equal(foodKey(spelling), "boeufhache5", spelling);
}
assert.equal(foodKey("Œufs"), foodKey("oeuf"));
assert.notEqual(foodKey("Blanc de poulet"), foodKey("Poulet"), "different cuts stay apart");
// The shopping list's key is untouched: its stored ticks depend on it.
assert.equal(normalizeName("Bœuf"), "buf");

// --- refused writes ------------------------------------------------------------

assert.equal(portionRefusal([eat(600)], [bolo]), null);
const ghost = portionRefusal([{ ...eat(600), batch: { id: "chili", share: 0.3 } }], [bolo]);
assert.equal(ghost?.result, "refused");
assert.match(ghost!.note, /« chili »/);
assert.match(ghost!.note, /« bolo » \(Bolognaise\)/, "names the pots that do exist");
const hollow = portionRefusal([{ ...eat(600), batch: undefined }], []);
assert.equal(hollow?.result, "refused", "no pot, no ingredients: refused");

console.log("portionLogic.check: ok");

// --- words -------------------------------------------------------------------
{
  const { shareLabel, portionLine, logOptions } = await import("./portionLogic");
  assert.equal(shareLabel(0.33), "un tiers");
  assert.equal(shareLabel(0.25), "un quart");
  assert.equal(shareLabel(0.5), "la moitié");
  assert.equal(shareLabel(0.37), "37 %");
  assert.equal(portionLine({ id: "x", share: 0.34, cookedGrams: 420 }), "Un tiers de la marmite, ≈ 420 g cuit");
  assert.equal(portionLine({ id: "x", share: 1 }), "Toute la marmite");

  // Pieces: ±1 whole piece, as a factor of the whole meal.
  const taco = logOptions({ ingredients: tacos });
  assert.deepEqual(
    taco.map((o) => o.factor),
    [0.5, 1, 1.5],
  );
  assert.match(taco[2].label, /^3 × tortilla/);
  // One bun: no « 0 burgers ».
  assert.deepEqual(
    logOptions({ ingredients: burger }).map((o) => o.factor),
    [1, 2],
  );
  // A pot share — even with pieces in the pot — moves by a quarter.
  assert.deepEqual(
    logOptions({ ingredients: tacos, batch: { id: "x", share: 0.3 } }).map((o) => o.factor),
    [0.75, 1, 1.25],
  );
  console.log("portionLogic.check (words): ok");
}
