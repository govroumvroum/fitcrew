/**
 * Portions (#138): what a meal is made of, what each part is worth, and how big
 * the part on the plate is. Pure — no Convex server import, no clock — so the
 * self-check and the screens can import it. See portionLogic.check.ts.
 *
 * Two families of dishes, one model:
 * - an ingredient by WEIGHT (`unit` "g" | "ml") is worth its grams × the
 *   reference's value per 100 g, and can be resized when it is `scalable`;
 * - an ingredient by the PIECE (`unit` "piece") is worth a whole number of
 *   pieces × the value of one. A bun is never cut: the only lever is ±1 piece.
 *
 * A batch is a pot cooked once and eaten over several days: each meal that eats
 * from it carries a `share` of the pot, and its macros are the pot's × share.
 *
 * Everything is for ONE person (decision D on #138): nothing here reads the
 * profile's `people`.
 */

/**
 * Merge key for a food name: lowercased, unaccented, punctuation and spaces
 * stripped, trailing plural dropped — so "Tomate", "tomates" and "TOMATE"
 * collide.
 *
 * ponytail: one plural rule ("s"), same as `candidateSlugs` in exerciseDemos.ts.
 * That one isn't reused here because it can't singularise and importing it would
 * drag the AI SDK into a module that is otherwise pure arithmetic.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

/**
 * The food reference's key (#138): `normalizeName` with « œ » and « æ » spelled
 * out first — NFD leaves them whole, so « Bœuf », « Boeuf » and « boeuf » would
 * otherwise be three ingredients. Same rule as the recipe library's
 * `recipeKey`, which is this function.
 *
 * Not used for the shopping list on purpose: its ticks are stored under
 * `normalizeName`, and changing that key would drop the ticks of every « œ » line.
 */
export function foodKey(name: string): string {
  return normalizeName(
    name.replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").replace(/Æ/g, "AE"),
  );
}

export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export type Unit = "g" | "ml" | "piece";

export type Ingredient = {
  name: string;
  quantity: string;
  amount?: number;
  unit?: Unit;
  scalable?: boolean;
};

/** What the reference knows about one food. Either basis, or both. */
export type FoodValues = {
  per100?: Macros;
  perPiece?: Macros;
  pieceGrams?: number;
};

export type Lookup = (name: string) => FoodValues | undefined;

export type BatchLink = { id: string; share: number; cookedGrams?: number };

export type Batch = {
  id: string;
  name: string;
  cookDate: string;
  ingredients: Ingredient[];
  steps: string[];
  macros: Macros;
  cookedGrams?: number;
};

type Meal = {
  name: string;
  ingredients: Ingredient[];
  steps: string[];
  macros: Macros;
  batch?: BatchLink;
};

export const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** How far the model's announced kcal may sit from the ingredients' before we resize. */
export const RESIZE_TOLERANCE = 0.08;
/** A scalable ingredient moves by at most this factor either way. */
const SCALE_BOUNDS = [0.5, 2] as const;
/** The log-time adjustment (decision B): ×0.25 to ×3 is already a different meal. */
const LOG_FACTOR_BOUNDS = [0.25, 3] as const;

export function scaleMacros(m: Macros, factor: number): Macros {
  return {
    calories: Math.round(m.calories * factor),
    protein: Math.round(m.protein * factor),
    carbs: Math.round(m.carbs * factor),
    fat: Math.round(m.fat * factor),
  };
}

function add(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

const roundMacros = (m: Macros) => scaleMacros(m, 1);

const isStructured = (i: Ingredient): i is Ingredient & { amount: number; unit: Unit } =>
  typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount >= 0 && i.unit !== undefined;

/**
 * The macros of ONE unit of `unit` — one gram / millilitre, or one piece — or
 * null when the reference can't say. A per-100 g value converts to a piece only
 * with the piece's weight, and back.
 */
export function valuePerUnit(values: FoodValues | undefined, unit: Unit): Macros | null {
  if (!values) return null;
  if (unit === "piece") {
    if (values.perPiece) return values.perPiece;
    if (values.per100 && values.pieceGrams) return scaleMacros100(values.per100, values.pieceGrams);
    return null;
  }
  if (values.per100) return scaleMacros100(values.per100, 1);
  if (values.perPiece && values.pieceGrams) {
    const f = 1 / values.pieceGrams;
    return mapMacros(values.perPiece, (n) => n * f);
  }
  return null;
}

const mapMacros = (m: Macros, fn: (n: number) => number): Macros => ({
  calories: fn(m.calories),
  protein: fn(m.protein),
  carbs: fn(m.carbs),
  fat: fn(m.fat),
});

/** Unrounded: `amount` grams of a per-100 g value. */
const scaleMacros100 = (per100: Macros, grams: number) => mapMacros(per100, (n) => (n * grams) / 100);

/** An ingredient that weighs in the meal: anything with a quantity written. */
const weighs = (i: Ingredient) => i.quantity.trim() !== "" || (i.amount ?? 0) > 0;

/**
 * The meal's macros from its ingredients and the reference, or null when one
 * ingredient that weighs isn't structured or has no known value — then the
 * model's announced total stays, as before #138. Unrounded on purpose: rounding
 * happens once, at the end.
 */
export function macrosFromIngredients(ingredients: Ingredient[], lookup: Lookup): Macros | null {
  let total = ZERO;
  for (const ingredient of ingredients) {
    if (!isStructured(ingredient)) {
      if (weighs(ingredient)) return null;
      continue;
    }
    const per = valuePerUnit(lookup(ingredient.name), ingredient.unit);
    if (!per) return null;
    total = add(
      total,
      mapMacros(per, (n) => n * ingredient.amount),
    );
  }
  return total;
}

/** "180 g", "250 ml", "2". A piece count is bare, so `sumQuantities` adds it to other bare counts. */
export function quantityText(amount: number, unit: Unit): string {
  const n = String(Math.round(amount * 10) / 10).replace(".", ",");
  return unit === "piece" ? n : `${n} ${unit}`;
}

/** Grams move by 5 (a scale's useful precision), never below 5. */
const roundGrams = (n: number) => Math.max(5, Math.round(n / 5) * 5);

export type Resize = { name: string; from: string; to: string };

/**
 * Brings a meal's ingredients to `targetKcal` (the kcal the Chef aimed the meal
 * at). Only `scalable` weight ingredients move, by a common factor bounded to
 * ×0.5–×2 and rounded to 5 g. Pieces stay WHOLE: when the weights alone can't
 * reach the target, the meal's first piece ingredient goes ±1 (never below 1)
 * and the weights fill the rest. Within `RESIZE_TOLERANCE`, nothing moves.
 *
 * Returns null when the meal can't be computed (see `macrosFromIngredients`).
 */
export function sizeIngredients(
  ingredients: Ingredient[],
  lookup: Lookup,
  targetKcal: number,
): { ingredients: Ingredient[]; macros: Macros; resized: Resize[] } | null {
  const current = macrosFromIngredients(ingredients, lookup);
  if (!current) return null;
  const done = (list: Ingredient[], macros: Macros) => ({
    ingredients: list,
    macros: roundMacros(macros),
    resized: diff(ingredients, list),
  });
  if (targetKcal <= 0 || Math.abs(current.calories - targetKcal) <= RESIZE_TOLERANCE * targetKcal) {
    return done(ingredients, current);
  }

  const pieceIndex = ingredients.findIndex((i) => isStructured(i) && i.unit === "piece");
  const counts = pieceIndex < 0 ? [0] : [0, 1, -1];
  let best: { list: Ingredient[]; macros: Macros; gap: number } | null = null;
  for (const delta of counts) {
    const withPieces = ingredients.map((i, index) =>
      index === pieceIndex && delta !== 0 ? withAmount(i, Math.max(1, Math.round(i.amount! + delta))) : i,
    );
    if (delta !== 0 && withPieces[pieceIndex].amount === ingredients[pieceIndex].amount) continue;
    const list = scaleWeights(withPieces, lookup, targetKcal);
    const macros = macrosFromIngredients(list, lookup)!;
    const gap = Math.abs(macros.calories - targetKcal);
    // A piece change has to earn its place: it wins only if it's clearly closer.
    if (!best || gap < best.gap - RESIZE_TOLERANCE * targetKcal * 0.5) best = { list, macros, gap };
  }
  return done(best!.list, best!.macros);
}

function scaleWeights(ingredients: Ingredient[], lookup: Lookup, targetKcal: number): Ingredient[] {
  let fixed = 0;
  let scalable = 0;
  for (const i of ingredients) {
    if (!isStructured(i)) continue;
    const kcal = (valuePerUnit(lookup(i.name), i.unit)?.calories ?? 0) * i.amount;
    if (i.scalable === true && i.unit !== "piece") scalable += kcal;
    else fixed += kcal;
  }
  if (scalable <= 0) return ingredients;
  const factor = clamp((targetKcal - fixed) / scalable, SCALE_BOUNDS[0], SCALE_BOUNDS[1]);
  return ingredients.map((i) =>
    isStructured(i) && i.scalable === true && i.unit !== "piece"
      ? withAmount(i, roundGrams(i.amount * factor))
      : i,
  );
}

function withAmount(i: Ingredient, amount: number): Ingredient {
  if (amount === i.amount) return i;
  return { ...i, amount, quantity: quantityText(amount, i.unit!) };
}

function diff(before: Ingredient[], after: Ingredient[]): Resize[] {
  return after.flatMap((i, index) =>
    i.amount !== before[index].amount
      ? [{ name: i.name, from: before[index].quantity, to: i.quantity }]
      : [],
  );
}

/**
 * The steps name the amounts (« les 180 g de bœuf »): after a resize they must
 * say the new ones. Only an amount written as "<n> g"/"<n> ml" that belongs to
 * exactly ONE ingredient is rewritten — two ingredients at 100 g would make the
 * replacement a guess.
 */
export function rewriteSteps(steps: string[], before: Ingredient[], after: Ingredient[]): string[] {
  const changes: { from: string; to: string }[] = [];
  after.forEach((i, index) => {
    const old = before[index];
    if (!isStructured(i) || !isStructured(old) || i.unit === "piece" || i.amount === old.amount) return;
    const shared = before.filter(
      (b) => isStructured(b) && b.unit === old.unit && b.amount === old.amount,
    ).length;
    if (shared === 1) changes.push({ from: quantityText(old.amount, old.unit), to: quantityText(i.amount, i.unit) });
  });
  if (changes.length === 0) return steps;
  return steps.map((step) =>
    changes.reduce(
      (text, c) => text.replace(new RegExp(`(^|[^\\d,])${escape(c.from)}(?![\\d])`, "g"), `$1${c.to}`),
      step,
    ),
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/**
 * A batch's macros: from its ingredients when the reference covers them all,
 * else the total the model announced for the whole pot.
 */
export function batchMacros(batch: Batch, lookup: Lookup): Macros {
  const computed = macrosFromIngredients(batch.ingredients, lookup);
  return roundMacros(computed ?? batch.macros);
}

const roundShare = (n: number) => Math.round(n * 100) / 100;

/**
 * Every meal eating from a batch, made consistent with it:
 * - its share comes from the kcal the Chef aimed the meal at (its macros) over
 *   the pot's — so a hard day gets a bigger plate — or the model's share when
 *   either is unknown;
 * - a pot's shares never add up past 1: over it, all are scaled down together;
 * - its ingredients are the pot's × share (what to take out of it), its macros
 *   the pot's × share, its cooked grams the pot's estimate × share.
 *
 * A link to a batch that doesn't exist is dropped (the meal keeps what it has),
 * and a batch nobody eats from is dropped — otherwise the shopping list would
 * buy a pot for nobody.
 *
 * Idempotent: run again on its own output, nothing moves. That's what lets every
 * write rerun it over the whole week.
 */
export function applyBatches<D extends { meals: M[] }, M extends Meal>(
  days: D[],
  batches: Batch[],
  lookup: Lookup,
): { days: D[]; batches: Batch[]; notes: string[] } {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const potKcal = new Map(batches.map((b) => [b.id, batchMacros(b, lookup)]));
  const notes: string[] = [];

  // First pass: the wanted share of every linked meal.
  const wanted = new Map<string, number>();
  const linked: { meal: M; share: number }[] = [];
  for (const day of days) {
    for (const meal of day.meals) {
      if (!meal.batch) continue;
      const pot = potKcal.get(meal.batch.id);
      if (!pot) {
        delete meal.batch;
        continue;
      }
      const fromTarget =
        pot.calories > 0 && meal.macros.calories > 0 ? meal.macros.calories / pot.calories : null;
      const share = clamp(fromTarget ?? meal.batch.share, 0.05, 1);
      linked.push({ meal, share });
      wanted.set(meal.batch.id, (wanted.get(meal.batch.id) ?? 0) + share);
    }
  }

  for (const { meal, share: raw } of linked) {
    const id = meal.batch!.id;
    const batch = byId.get(id)!;
    const total = wanted.get(id)!;
    const share = roundShare(total > 1 ? raw / total : raw);
    const pot = potKcal.get(id)!;
    meal.batch = {
      id,
      share,
      ...(batch.cookedGrams ? { cookedGrams: Math.round((batch.cookedGrams * share) / 10) * 10 } : {}),
    };
    meal.macros = scaleMacros(pot, share);
    // What to take out of the pot. A piece in a pot (4 eggs in a shakshuka) is
    // a fraction here on purpose: it's a share of the pot, not something to buy.
    meal.ingredients = batch.ingredients.map((i) => {
      if (!isStructured(i)) return i;
      const amount =
        i.unit === "piece" ? Math.round(i.amount * share * 10) / 10 : roundGrams(i.amount * share);
      return { ...i, amount, quantity: quantityText(amount, i.unit) };
    });
  }
  for (const [id, total] of wanted) {
    if (total > 1.001) {
      notes.push(
        `Le batch « ${byId.get(id)!.name} » ne suffisait pas pour toutes les parts demandées : elles ont été réduites pour tenir dans une marmite.`,
      );
    }
  }

  const eaten = new Set(linked.map((l) => l.meal.batch!.id));
  return { days, batches: batches.filter((b) => eaten.has(b.id)), notes };
}

/** What's left in a pot after the planned shares — « reste ≈ 1 part ». */
export function batchLeftover(batchId: string, days: { meals: { batch?: BatchLink }[] }[]): number {
  const used = days
    .flatMap((d) => d.meals)
    .filter((m) => m.batch?.id === batchId)
    .reduce((sum, m) => sum + m.batch!.share, 0);
  return roundShare(Math.max(0, 1 - used));
}

// ---------------------------------------------------------------------------
// The log (decision B)
// ---------------------------------------------------------------------------

/** A log-time portion factor, bounded. Not finite or ≤ 0 → 1 (no adjustment). */
export function logFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor) || factor <= 0) return 1;
  return clamp(factor, LOG_FACTOR_BOUNDS[0], LOG_FACTOR_BOUNDS[1]);
}

/**
 * The piece count a unit-based meal is built on — the first piece ingredient
 * (the tortillas, the buns) — or null. ±1 piece at log time is the factor
 * (n ± 1) / n of the whole meal: a third taco comes with its filling.
 */
export function mealPieces(ingredients: Ingredient[]): number | null {
  const piece = ingredients.find((i) => isStructured(i) && i.unit === "piece" && i.amount! >= 1);
  return piece ? Math.round(piece.amount!) : null;
}
