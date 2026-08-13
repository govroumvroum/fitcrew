/** Self-check for the nutrition maths. Run: `bun convex/nutrition.check.ts` */
import assert from "node:assert/strict";
import {
  type PlanDay,
  estimateTargets,
  forbiddenHits,
  shoppingListFrom,
  sumMacros,
} from "./nutrition";

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

// --- Allergy / exclusion guard ---------------------------------------------
// The health-safety path: the prompt says allergies are hard constraints, this
// is what makes it true. Under-matching hurts the user, over-matching makes the
// guard useless — both directions are checked.

const dish = (name: string, ingredients: string[]) =>
  meal(
    name,
    ingredients.map((i) => ({ name: i, quantity: "1" })),
  );

const hitNames = (meals: ReturnType<typeof dish>[], forbidden: string[]) =>
  forbiddenHits(meals, forbidden).map((h) => `${h.ingredient}/${h.forbidden}`);

// A real hit, and the meal name travels with it so the model knows what to redo.
assert.deepEqual(
  forbiddenHits([dish("Poulet cajou", ["blanc de poulet", "noix de cajou"])], ["noix"]),
  [{ meal: "Poulet cajou", ingredient: "noix de cajou", forbidden: "noix" }],
);

// Word boundaries, both ways round. These are the false positives a naive
// `includes` produces, and the false negative a naive `===` produces.
assert.deepEqual(hitNames([dish("Mousse", ["chocolat noir", "sucre"])], ["lait"]), []);
assert.deepEqual(hitNames([dish("Bizarre", ["travail", "ailes de poulet"])], ["ail"]), []);
assert.deepEqual(hitNames([dish("Aïoli", ["ail", "huile"])], ["ail"]), ["ail/ail"]);
// Multi-word exclusions match as a run of whole words, not as loose keywords.
assert.deepEqual(hitNames([dish("Paella", ["fruits de mer surgelés"])], ["fruits de mer"]), [
  "fruits de mer surgelés/fruits de mer",
]);
assert.deepEqual(hitNames([dish("Sorbet", ["citron amer"])], ["mer"]), []);

// Accents, case and the "œ" ligature: the user typed one spelling, the model
// wrote another.
assert.deepEqual(hitNames([dish("Omelette", ["Œufs frais"])], ["oeuf"]), ["Œufs frais/oeuf"]);
assert.deepEqual(hitNames([dish("Omelette", ["oeuf"])], ["ŒUFS"]), ["oeuf/ŒUFS"]);
assert.deepEqual(hitNames([dish("Gratin", ["crème fraîche"])], ["creme"]), ["crème fraîche/creme"]);
// Plural on either side, and a short word that must NOT be singularised away.
assert.deepEqual(hitNames([dish("Salade", ["tomates cerises"])], ["tomate"]), [
  "tomates cerises/tomate",
]);
assert.deepEqual(hitNames([dish("Riz", ["riz basmati"])], ["riz"]), ["riz basmati/riz"]);

// Empty or blank lists change nothing — a profile with no restrictions must
// behave exactly as it did before this guard existed.
assert.deepEqual(forbiddenHits([dish("Omelette", ["oeuf"])], []), []);
assert.deepEqual(forbiddenHits([dish("Omelette", ["oeuf"])], ["", "   "]), []);
// A clean meal against a real list.
assert.deepEqual(
  hitNames([dish("Poulet riz", ["poulet", "riz", "courgette"])], ["oeuf", "lait"]),
  [],
);

// Every hit is reported, so the model can fix a whole plan in one turn.
assert.equal(
  forbiddenHits(
    [dish("Omelette", ["oeufs", "lait entier"]), dish("Salade", ["tomate"])],
    ["oeuf", "lait"],
  ).length,
  2,
);

// The bounds fail CLOSED. A guard that quietly stops scanning at its cap would
// report "clear" on exactly the payload big enough to hide an allergen, and
// nothing upstream caps ingredient count — `clampMeal` only clamps macros.
const manyIngredients = dish("Buffet", [
  ...Array.from({ length: 80 }, (_, i) => `ingredient ${i}`),
  "oeuf", // past the cap: would be unscanned if the guard sliced instead of refusing
]);
assert.equal(
  forbiddenHits([manyIngredients], ["oeuf"]).length,
  1,
  "une recette plus longue que la limite doit être refusée, pas scannée à moitié",
);
// And the refusal names the reason rather than pretending to have found the egg.
assert.match(forbiddenHits([manyIngredients], ["oeuf"])[0].forbidden, /trop longue/);

// Same for a forbidden list longer than we can check: no meal can be called safe.
const tooManyForbidden = Array.from({ length: 41 }, (_, i) => `interdit${i}`);
assert.equal(
  forbiddenHits([dish("Poulet riz", ["poulet", "riz"])], tooManyForbidden).length,
  1,
  "plus d'interdits que vérifiables doit refuser, pas ignorer les derniers",
);

// Fouine on #76: the count check used to run AFTER the needles were built, so a
// list of 41 where the first 40 are blank tokenised to nothing, hit the
// empty-needle exit, and reported "clear" — the exact case the bound exists for.
const blankThenReal = [...Array.from({ length: 40 }, () => "  "), "oeuf"];
assert.equal(
  forbiddenHits([dish("Omelette", ["oeufs"])], blankThenReal).length,
  1,
  "40 entrées vides puis un vrai interdit doit refuser, pas passer par la sortie 'aucun interdit'",
);

// Same fail-open one level down: `foodTokens` used to slice long names, so an
// allergen past the cap was reported clear. Now an unverifiable name refuses.
const buried = `${"x ".repeat(70)}oeuf`; // > 120 chars, allergen at the end
assert.equal(
  forbiddenHits([dish("Mystère", [buried])], ["oeuf"]).length,
  1,
  "un nom trop long doit refuser plutôt que d'être scanné en partie",
);
assert.match(forbiddenHits([dish("Mystère", [buried])], ["oeuf"])[0].forbidden, /trop long/);
// An unverifiable FORBIDDEN entry refuses too — same reasoning, other side.
assert.equal(forbiddenHits([dish("Poulet riz", ["poulet"])], [buried]).length, 1);

// A normal long-ish name is still scanned, not refused: the cap is for absurd
// input, not for "filet de poulet fermier élevé en plein air label rouge".
assert.deepEqual(
  hitNames([dish("Plat", ["filet de poulet fermier élevé en plein air label rouge des Landes"])], [
    "oeuf",
  ]),
  [],
);

console.log("nutrition targets + shopping list + allergy guard ok");
