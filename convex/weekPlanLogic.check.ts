/** Self-check for the week view's pure logic. Run: `bun convex/weekPlanLogic.check.ts` */
import assert from "node:assert/strict";
import type { RecipeCategory } from "./recipeLogic";
import { liveChecks, nextChecks, pickCandidates } from "./weekPlanLogic";

const recipe = (name: string, category: RecipeCategory, calories: number, seche = false) => ({
  name,
  nameKey: name.toLowerCase(),
  category,
  tags: seche ? ["seche"] : [],
  macros: { calories },
});

const library = [
  recipe("a", "repas", 500),
  recipe("b", "repas", 560), // +12 %
  recipe("c", "repas", 440, true), // −12 %, sèche
  recipe("d", "repas", 700), // +40 %
  recipe("e", "repas", 1500),
  recipe("pdj", "petit_dej", 500),
  recipe("snack", "collation", 500),
  recipe("current", "repas", 500),
];
const names = (list: { name: string }[]) => list.map((r) => r.name);

// --- shelf, self-exclusion, closest kcal -----------------------------------
const dinner = { slot: "diner" as const, nameKey: "current", calories: 500 };
assert.deepEqual(
  names(pickCandidates(library, dinner, { secheFirst: false })),
  ["a", "b", "c"],
  "dîner → repas only, never the meal itself, closest first (ties by name)",
);
assert.deepEqual(
  names(pickCandidates(library, { ...dinner, slot: "dejeuner" }, { secheFirst: false })),
  ["a", "b", "c"],
  "déjeuner and dîner share the repas shelf",
);
assert.deepEqual(
  names(pickCandidates(library, { ...dinner, slot: "petit_dejeuner" }, { secheFirst: false })),
  ["pdj"],
  "petit-déjeuner → petit_dej only",
);
assert.deepEqual(
  names(pickCandidates(library, { ...dinner, slot: "collation" }, { secheFirst: false })),
  ["snack"],
);

// --- sèche first on a weight-loss goal --------------------------------------
assert.deepEqual(
  names(pickCandidates(library, dinner, { secheFirst: true })),
  ["c", "a", "b"],
  "perte → the sèche recipe leads the window",
);
// …but only inside the window: a sèche recipe 3× the kcal doesn't jump in.
const farSeche = [...library, recipe("z", "repas", 1500, true)];
assert.ok(
  !names(pickCandidates(farSeche, dinner, { secheFirst: true })).includes("z"),
  "a far sèche recipe stays out while the window has 3",
);

// --- widening ----------------------------------------------------------------
const sparse = [
  recipe("near", "repas", 520),
  recipe("mid", "repas", 650),
  recipe("far", "repas", 1500),
];
assert.deepEqual(
  names(pickCandidates(sparse, dinner, { secheFirst: false })),
  ["near", "mid", "far"],
  "fewer than 3 in ±15 % → widen until 3, the whole shelf last",
);
assert.deepEqual(
  pickCandidates([], dinner, { secheFirst: true }),
  [],
  "empty library → none, no throw",
);
assert.deepEqual(
  names(pickCandidates(sparse, { ...dinner, calories: 0 }, { secheFirst: false })),
  ["near", "mid", "far"],
  "a 0-kcal meal still gets the closest ones",
);

// --- check-state merge -------------------------------------------------------
const list = ["tomate", "riz", "poulet"];
assert.deepEqual(
  liveChecks(["riz", "oignon", "riz"], list),
  ["riz"],
  "orphans ignored, dupes once",
);
assert.deepEqual(nextChecks([], list, "riz", true), ["riz"]);
assert.deepEqual(nextChecks(["riz"], list, "riz", true), ["riz"], "ticking twice is idempotent");
assert.deepEqual(nextChecks(["riz", "tomate"], list, "riz", false), ["tomate"]);
assert.deepEqual(
  nextChecks(["oignon", "riz"], list, "tomate", true),
  ["riz", "tomate"],
  "a write prunes the orphan and keeps the live tick",
);
assert.deepEqual(nextChecks([], list, "caviar", true), [], "a key not on the list is never stored");

console.log("weekPlanLogic.check.ts: ok");
