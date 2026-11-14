/**
 * The week view's pure logic (#121): which library recipes « Changer » offers,
 * and how the shopping list's ticks survive a plan that changes. No Convex
 * server import, no clock — see weekPlanLogic.check.ts.
 */
import { type RecipeCategory, categoryForSlot } from "./recipeLogic";

type Slot = "petit_dejeuner" | "dejeuner" | "diner" | "collation";

/** How many recipes the « Changer » sheet shows. */
export const CANDIDATES = 3;

/**
 * The kcal windows tried in turn, as a fraction of the current meal: ±15 %
 * first, wider only while fewer than `CANDIDATES` recipes fit. The last one
 * takes the whole shelf — a far recipe beats an empty sheet.
 */
const WINDOWS = [0.15, 0.25, 0.4, Number.POSITIVE_INFINITY];

type Candidate = {
  nameKey: string;
  category: RecipeCategory;
  tags: string[];
  name: string;
  macros: { calories: number };
};

/**
 * Up to three recipes to swap a planned meal for: same shelf as the slot, never
 * the meal itself, closest kcal first, and on a weight-loss goal the « sèche »
 * catalogue before everything else in the window.
 *
 * `library` must already be cleared against the user's allergies and
 * exclusions (`visibleTo`) — this only ranks.
 */
export function pickCandidates<T extends Candidate>(
  library: readonly T[],
  current: { slot: Slot; nameKey: string; calories: number },
  options: { secheFirst: boolean },
): T[] {
  const shelf = library.filter(
    (r) => r.category === categoryForSlot(current.slot) && r.nameKey !== current.nameKey,
  );
  const gap = (r: T) => Math.abs(r.macros.calories - current.calories);
  // A 0-kcal meal (a model's blank) still has a window: 15 % of 1 kcal is none,
  // so it falls through to the closest ones, which is the honest answer.
  const base = Math.max(current.calories, 1);
  const rank = (a: T, b: T) =>
    (options.secheFirst ? Number(isSeche(b)) - Number(isSeche(a)) : 0) ||
    gap(a) - gap(b) ||
    a.name.localeCompare(b.name, "fr");

  for (const window of WINDOWS) {
    const fit = shelf.filter((r) => gap(r) <= window * base);
    if (fit.length >= CANDIDATES || window === Number.POSITIVE_INFINITY) {
      return [...fit].sort(rank).slice(0, CANDIDATES);
    }
  }
  return [];
}

const isSeche = (r: { tags: string[] }) => r.tags.includes("seche");

/**
 * The stored ticks that still name a line of the list. A tick whose ingredient
 * left the plan (the Chef rewrote the week) is an orphan: ignored, never shown,
 * and dropped at the next write.
 */
export function liveChecks(stored: readonly string[], listKeys: readonly string[]): string[] {
  const live = new Set(listKeys);
  return [...new Set(stored)].filter((key) => live.has(key));
}

/**
 * The ticks after one tap. Starts from the live ones, so orphans are pruned on
 * every write and the stored array never outgrows the list it ticks. A key the
 * list doesn't have is never added.
 */
export function nextChecks(
  stored: readonly string[],
  listKeys: readonly string[],
  key: string,
  checked: boolean,
): string[] {
  const live = liveChecks(stored, listKeys);
  if (!checked) return live.filter((k) => k !== key);
  if (!listKeys.includes(key) || live.includes(key)) return live;
  return [...live, key];
}
