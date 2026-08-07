/** Self-check for the household maths. Run: `bun convex/households.check.ts` */
import assert from "node:assert/strict";
import type { Id } from "./_generated/dataModel";
import {
  applyDuelResolution,
  chifoumiResult,
  dueledMealFor,
  type PlannedMeal,
  sharedPortion,
} from "./households";
import { mergeDueledSlot } from "./nutrition";

const u1 = "user-1" as Id<"users">;
const u2 = "user-2" as Id<"users">;
const u3 = "user-3" as Id<"users">;

const macros = (calories: number) => ({ calories, protein: 30, carbs: 50, fat: 20 });

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

/** Une recette à mettre dans `duel.vs` ou dans un repas entier. */
const recipe = (name: string, calories: number) => ({
  name,
  ingredients: [],
  steps: [],
  prepMinutes: 30,
  macros: macros(calories),
});

/** Un créneau en duel : plat du foyer (a) contre challenger (b), voté ou non. */
const dueled = (
  incumbentName: string,
  challengerName: string,
  votes: { userId: Id<"users">; choice: "a" | "b" }[] = [],
): PlannedMeal => ({
  ...meal(macros(500), 2),
  name: incumbentName,
  proposedBy: u1,
  duel: { vs: recipe(challengerName, 400), proposedBy: u2 },
  ...(votes.length > 0 && { duelVotes: votes }),
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

// ---------------------------------------------------------------------------
// mergeDueledSlot — la décision par (date, créneau) quand un Chef écrit une
// semaine sur la semaine foyer.
// ---------------------------------------------------------------------------

// Pas d'incumbent : le plat entrant arrive avec son auteur.
const fresh = mergeDueledSlot(null, meal(macros(500)), u1);
assert.equal(fresh.proposedBy, u1);
assert.equal(fresh.duel, undefined);

// Un créneau en duel est GELÉ : quoi que propose la régénération (même plat,
// même challenger, ou un troisième), le duel attend la décision du couple.
const duelPending = dueled("Poulet rôti", "Saumon grillé");
assert.deepEqual(
  mergeDueledSlot(duelPending, { ...meal(macros(500), 2), name: "poulet roti" }, u2),
  duelPending,
);
assert.deepEqual(
  mergeDueledSlot(duelPending, meal(macros(600), 2), u2),
  duelPending,
);
assert.deepEqual(
  mergeDueledSlot(duelPending, { ...meal(macros(700), 2), name: "Curry de pois chiches" }, u2),
  duelPending,
);

// Un incumbent verrouillé garde la place : la proposition tombe.
const locked = { ...meal(macros(500), 2), locked: true };
assert.equal(mergeDueledSlot(locked, meal(macros(600), 2), u2), locked);

// Le MÊME Chef re-propose son propre plat (ou un plat sans auteur connu) :
// remplacement simple, pas de duel entre deux plats du même auteur.
const own = { ...meal(macros(500), 2), name: "Poulet rôti", proposedBy: u1 };
const replaced = mergeDueledSlot(own, { ...meal(macros(600), 2), name: "Saumon grillé" }, u1);
assert.equal(replaced.name, "Saumon grillé");
assert.equal(replaced.proposedBy, u1);
assert.equal(replaced.duel, undefined);

// Même plat (nom normalisé), proposé par l'AUTRE Chef : les Chefs s'accordent,
// l'incumbent reste — jamais de duel entre deux assiettes identiques.
const agreed = mergeDueledSlot(
  { ...meal(macros(500), 2), name: "Poulet rôti", proposedBy: u1 },
  { ...meal(macros(600), 2), name: "poulet roti" },
  u2,
);
assert.equal(agreed.name, "Poulet rôti");
assert.equal(agreed.proposedBy, u1);
assert.equal(agreed.duel, undefined);

const old = mergeDueledSlot(meal(macros(500), 2), { ...meal(macros(600), 2), name: "Saumon grillé" }, u2);
assert.equal(old.name, "Saumon grillé");
assert.equal(old.proposedBy, u2);
assert.equal(old.duel, undefined);

// Un plat différent, proposé par l'AUTRE Chef : le duel s'ouvre — l'incumbent
// reste le plat "a", l'incoming devient le challenger "b" avec son auteur.
const incumbent = { ...meal(macros(500), 2), name: "Poulet rôti", proposedBy: u1 };
const created = mergeDueledSlot(incumbent, { ...meal(macros(600), 2), name: "Saumon grillé" }, u2);
assert.equal(created.name, "Poulet rôti");
assert.deepEqual(created.duel?.vs, recipe("Saumon grillé", 600));
assert.equal(created.duel?.proposedBy, u2);
assert.equal(created.proposedBy, u1);

// ---------------------------------------------------------------------------
// applyDuelResolution — le duel tranché, "a" ou "b".
// ---------------------------------------------------------------------------

const voted = dueled("Poulet rôti", "Saumon grillé", [
  { userId: u1, choice: "a" },
  { userId: u2, choice: "a" },
]);

// "a" gagne : l'incumbent reste, les champs de duel disparaissent.
const aWins = applyDuelResolution(voted, "a");
assert.equal(aWins.name, "Poulet rôti");
assert.equal(aWins.duel, undefined);
assert.equal(aWins.duelVotes, undefined);
assert.equal(aWins.portions, 2); // le créneau reste un repas partagé

// "b" gagne : le challenger devient le repas (recette + auteur), champs levés.
const bWins = applyDuelResolution(voted, "b");
assert.equal(bWins.name, "Saumon grillé");
assert.deepEqual(bWins.macros, macros(400));
assert.equal(bWins.proposedBy, u2);
assert.equal(bWins.duel, undefined);
assert.equal(bWins.duelVotes, undefined);

// ---------------------------------------------------------------------------
// dueledMealFor — le plat que chaque membre récupère quand le duel se dissout.
// ---------------------------------------------------------------------------

const split = dueled("Poulet rôti", "Saumon grillé", [
  { userId: u1, choice: "b" },
  { userId: u2, choice: "a" },
]);

// Celui qui a voté "b" repart avec le challenger ; portions et duel retirés,
// macros gardées telles quelles (à portion seule).
const forB = dueledMealFor(split, u1);
assert.equal(forB.name, "Saumon grillé");
assert.deepEqual(forB.macros, macros(400));
assert.equal(forB.portions, undefined);
assert.equal(forB.duel, undefined);
assert.equal(forB.duelVotes, undefined);
assert.equal(forB.proposedBy, u2);

// Celui qui a voté "a" garde l'incumbent, même traitement.
const forA = dueledMealFor(split, u2);
assert.equal(forA.name, "Poulet rôti");
assert.equal(forA.portions, undefined);
assert.equal(forA.duel, undefined);
assert.equal(forA.duelVotes, undefined);

// Sans vote (par sécurité) : l'incumbent.
const forNobody = dueledMealFor(split, u3);
assert.equal(forNobody.name, "Poulet rôti");
assert.equal(forNobody.duel, undefined);

// ---------------------------------------------------------------------------
// chifoumiResult — les règles classiques : pierre > ciseaux > papier > pierre.
// ---------------------------------------------------------------------------

assert.equal(chifoumiResult("pierre", "ciseaux"), "a");
assert.equal(chifoumiResult("ciseaux", "papier"), "a");
assert.equal(chifoumiResult("papier", "pierre"), "a");
assert.equal(chifoumiResult("ciseaux", "pierre"), "b");
assert.equal(chifoumiResult("papier", "ciseaux"), "b");
assert.equal(chifoumiResult("pierre", "papier"), "b");
assert.equal(chifoumiResult("pierre", "pierre"), "draw");
assert.equal(chifoumiResult("papier", "papier"), "draw");
assert.equal(chifoumiResult("ciseaux", "ciseaux"), "draw");

console.log("households shared portion + duels ok");
