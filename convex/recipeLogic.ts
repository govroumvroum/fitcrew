/**
 * The recipe library's pure logic: no Convex runtime, no import that would drag
 * one in, so the Recettes screen can import it as well as the server. See
 * recipes.check.ts.
 *
 * The parts that need `normalizeName` / `forbiddenHits` (dedup and the allergy
 * filter) live in recipes.ts, because those come from nutrition.ts, which
 * imports the Convex server.
 */

export type RecipeCategory = "petit_dej" | "repas" | "collation";
export type RecipeFilter = "all" | RecipeCategory | "cheat";
export type RecipeSort = "recent" | "density" | "kcal" | "time";
type Slot = "petit_dejeuner" | "dejeuner" | "diner" | "collation";

/** The plan's four slots onto the library's three shelves. */
export function categoryForSlot(slot: Slot): RecipeCategory {
  if (slot === "petit_dejeuner") return "petit_dej";
  if (slot === "collation") return "collation";
  return "repas";
}

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  petit_dej: "Petit-déj",
  repas: "Repas",
  collation: "Collation",
};

export const FILTERS: { value: RecipeFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "petit_dej", label: "Petit-déj" },
  { value: "repas", label: "Repas" },
  { value: "collation", label: "Collation" },
  { value: "cheat", label: "Cheat" },
];

export const SORTS: { value: RecipeSort; label: string }[] = [
  { value: "recent", label: "Les miennes d'abord" },
  { value: "density", label: "Protéines par kcal" },
  { value: "kcal", label: "Kcal croissantes" },
  { value: "time", label: "Les plus rapides" },
];

type Filterable = { category: RecipeCategory; cheat?: boolean };

export function matchesFilter(recipe: Filterable, filter: RecipeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "cheat") return recipe.cheat === true;
  return recipe.category === filter;
}

/** Grams of protein per 100 kcal — diet's bar. 0 for a 0-kcal recipe, never NaN. */
export function proteinDensity(macros: { calories: number; protein: number }): number {
  if (macros.calories <= 0) return 0;
  return (macros.protein / macros.calories) * 100;
}

type Sortable = {
  macros: { calories: number; protein: number };
  prepMinutes: number;
  name: string;
};

/**
 * A new array, never the input sorted in place: the input is a Convex query
 * result, which React treats as immutable.
 *
 * Ties break on the name, so two recipes at 420 kcal don't swap places between
 * renders. `recent` keeps the server's order (own recipes newest first, then the
 * catalogue), which is why it doesn't sort at all.
 */
export function sortRecipes<T extends Sortable>(list: readonly T[], sort: RecipeSort): T[] {
  const out = [...list];
  if (sort === "recent") return out;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "fr");
  const compare: Record<Exclude<RecipeSort, "recent">, (a: T, b: T) => number> = {
    density: (a, b) => proteinDensity(b.macros) - proteinDensity(a.macros) || byName(a, b),
    kcal: (a, b) => a.macros.calories - b.macros.calories || byName(a, b),
    time: (a, b) => a.prepMinutes - b.prepMinutes || byName(a, b),
  };
  return out.sort(compare[sort]);
}

/** "12 min", or "Prêt" for the zero-minute snacks — diet's wording. */
export const prepLabel = (minutes: number) => (minutes > 0 ? `${minutes} min` : "Prêt");
