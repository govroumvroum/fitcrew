/** Self-check for the recipe library's pure logic. Run: `bun convex/recipes.check.ts` */
import assert from "node:assert/strict";
import type { PlannedMeal } from "./nutrition";
import { SECHE_CATALOGUE, SECHE_TAG } from "./recipeCatalogue";
import { categoryForSlot, matchesFilter, proteinDensity, sortRecipes } from "./recipeLogic";
import {
  canonical,
  catalogueRow,
  mergeLibrary,
  recipeKey,
  recipesFromMeals,
  secheCatalogueLines,
  visibleTo,
} from "./recipes";

// --- slot <-> category ------------------------------------------------------
assert.equal(categoryForSlot("petit_dejeuner"), "petit_dej");
assert.equal(categoryForSlot("dejeuner"), "repas");
assert.equal(categoryForSlot("diner"), "repas");
assert.equal(categoryForSlot("collation"), "collation");

// --- dedup by normalised name -----------------------------------------------
const meal = (name: string, slot: PlannedMeal["slot"], calories = 500): PlannedMeal => ({
  slot,
  name,
  ingredients: [{ name: "riz", quantity: "60 g" }],
  steps: ["Cuire."],
  prepMinutes: 10,
  macros: { calories, protein: 40, carbs: 50, fat: 10 },
});

// The same dish on Monday and Thursday, spelled two ways, is ONE recipe — and
// the last one written wins.
const week = recipesFromMeals([
  meal("Bœuf teriyaki", "dejeuner", 500),
  meal("Pancakes protéinés", "petit_dejeuner"),
  meal("boeuf  Teriyaki", "diner", 540),
  meal("   ", "collation"),
]);
assert.equal(week.length, 2, "un plat qui revient deux fois = une recette, un nom vide = rien");
const teriyaki = week.find((r) => r.nameKey === recipeKey("Bœuf teriyaki"));
assert.ok(teriyaki);
assert.equal(teriyaki.macros.calories, 540, "la dernière occurrence gagne");
assert.equal(week.find((r) => r.name === "Pancakes protéinés")?.category, "petit_dej");
assert.equal(recipeKey("Bœuf teriyaki"), recipeKey("BOEUF-TERIYAKI"));

// --- allergy filter on the catalogue ----------------------------------------
const byName = (name: string) => {
  const entry = SECHE_CATALOGUE.find((r) => r.name === name);
  assert.ok(entry, name);
  return entry;
};
const skyr = byName("Skyr cacahuète-cacao");

// The issue's acceptance criterion, spelled several ways a user would.
for (const allergy of ["cacahuète", "Cacahuètes", "arachide", "beurre de cacahuète"]) {
  assert.equal(visibleTo(skyr, [allergy]), false, `${allergy} doit cacher le skyr`);
}
// Hidden allergens the ingredient names don't spell: skyr is lactose, chorizo is porc.
assert.equal(visibleTo(skyr, ["lactose"]), false);
assert.equal(visibleTo(byName("Œufs brouillés chorizo"), ["porc"]), false);
assert.equal(visibleTo(byName("Pizza tortilla"), ["gluten"]), false);
// …and nothing is hidden for no reason.
assert.equal(visibleTo(skyr, []), true);
assert.equal(visibleTo(byName("Popcorn paprika fumé"), ["lactose", "gluten", "cacahuète"]), true);
assert.equal(visibleTo(byName("Butter chicken light"), ["poisson"]), true);
// The dish name counts even when no ingredient says it.
assert.equal(
  visibleTo({ name: "Tarte aux noix", ingredients: [{ name: "pâte" }] }, ["noix"]),
  false,
);

// The prompt list goes through the same guard.
const peanutFree = secheCatalogueLines(["cacahuète"]).join("\n");
assert.ok(!peanutFree.includes("Skyr cacahuète-cacao"));
assert.ok(!peanutFree.includes("Bowl skyr granola"), "granola au beurre de cacahuète");
assert.equal(secheCatalogueLines([]).length, 31);

// --- the catalogue itself ---------------------------------------------------
assert.equal(SECHE_CATALOGUE.length, 31);
assert.equal(new Set(SECHE_CATALOGUE.map((r) => recipeKey(r.name))).size, 31, "noms uniques");
for (const r of SECHE_CATALOGUE) {
  const { calories, protein, carbs, fat } = r.macros;
  // Estimated carbs and fat must add back up to diet's kcal, give or take.
  const atwater = 4 * protein + 4 * carbs + 9 * fat;
  assert.ok(Math.abs(atwater - calories) <= 12, `${r.name} : ${atwater} vs ${calories} kcal`);
  assert.ok(r.ingredients.length > 0 && r.steps.length > 0, r.name);
  assert.ok(r.photoUrl.startsWith("https://"), r.name);
  for (const i of r.ingredients) assert.ok(i.name.trim(), `${r.name} : ingrédient sans nom`);
}
const row = catalogueRow(SECHE_CATALOGUE[0]);
assert.deepEqual(row.tags, [SECHE_TAG]);
assert.equal(row.userId, undefined, "le catalogue n'appartient à personne");

// Key order doesn't make a row « changed » — the seed would rewrite everything.
assert.equal(
  canonical({ a: 1, b: { d: 2, c: [1, { f: 1, e: 2 }] } }),
  canonical({ b: { c: [1, { e: 2, f: 1 }], d: 2 }, a: 1 }),
);
assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));

// --- merge: own copy wins, no duplicate, inherits curated facts -------------
type Row = { nameKey: string; tags: string[]; photoUrl?: string; allergens?: string[] };
const shared: Row[] = [
  { nameKey: "boeufteriyaki", photoUrl: "https://x/p.jpg", tags: ["seche"], allergens: ["soja"] },
  { nameKey: "popcorn", photoUrl: "https://x/pop.jpg", tags: ["seche"] },
];
const own: Row[] = [{ nameKey: "boeufteriyaki", tags: [] }];
const merged = mergeLibrary(own, shared);
assert.equal(merged.length, 2, "pas de doublon avec le catalogue");
assert.equal(merged[0].photoUrl, "https://x/p.jpg");
assert.deepEqual(merged[0].tags, ["seche"]);
assert.deepEqual(merged[0].allergens, ["soja"]);
assert.equal(merged[1].nameKey, "popcorn");

// --- filters ----------------------------------------------------------------
assert.equal(matchesFilter({ category: "repas", cheat: true }, "cheat"), true);
assert.equal(matchesFilter({ category: "repas" }, "cheat"), false);
assert.equal(matchesFilter({ category: "collation" }, "repas"), false);
assert.equal(matchesFilter({ category: "collation" }, "all"), true);

// --- sorts ------------------------------------------------------------------
assert.equal(proteinDensity({ calories: 0, protein: 10 }), 0, "jamais NaN");
assert.equal(proteinDensity({ calories: 200, protein: 20 }), 10);

const list = [
  { name: "B", macros: { calories: 400, protein: 20 }, prepMinutes: 5 },
  { name: "A", macros: { calories: 100, protein: 20 }, prepMinutes: 15 },
  { name: "C", macros: { calories: 400, protein: 40 }, prepMinutes: 0 },
];
const names = (l: typeof list) => l.map((r) => r.name).join("");
assert.equal(names(sortRecipes(list, "density")), "ACB");
assert.equal(names(sortRecipes(list, "kcal")), "ABC", "égalité départagée par le nom");
assert.equal(names(sortRecipes(list, "time")), "CBA");
assert.equal(names(sortRecipes(list, "recent")), "BAC", "l'ordre du serveur");
assert.equal(names(list), "BAC", "l'entrée n'est jamais triée sur place");

console.log("recipes.check: ok");
