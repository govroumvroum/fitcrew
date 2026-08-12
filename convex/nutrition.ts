import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { weekStart } from "./progress";
import {
  activityLevel,
  macros,
  mealSlot,
  nutritionGoal,
  nutritionProfile,
  planDay,
  plannedMeal,
} from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";

export type NutritionGoal = Infer<typeof nutritionGoal>;
export type ActivityLevel = Infer<typeof activityLevel>;
export type Macros = Infer<typeof macros>;
export type MealSlot = Infer<typeof mealSlot>;
export type PlannedMeal = Infer<typeof plannedMeal>;
export type PlanDay = Infer<typeof planDay>;

// ---------------------------------------------------------------------------
// Pure logic. No ctx, no clock — see nutrition.check.ts.
// ---------------------------------------------------------------------------

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

const ACTIVITY_FACTOR = {
  sedentaire: 1.2,
  leger: 1.375,
  modere: 1.55,
  actif: 1.725,
  tres_actif: 1.9,
} as const;

/** Perte = 20% under maintenance, prise = 12% over. Deliberately gentle: a bigger
 *  surplus is fat, a bigger deficit is muscle. */
const GOAL_DELTA = { perte: -0.2, maintien: 0, prise: 0.12 } as const;

/** Protein is what you protect in a deficit, hence 2.0 g/kg on perte. */
const PROTEIN_PER_KG = { perte: 2.0, maintien: 1.6, prise: 1.6 } as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Mifflin-St Jeor -> activity factor -> goal delta, then macros by the usual
 * rules of thumb: protein per kilo, fat at a quarter of the calories, carbs take
 * whatever is left.
 *
 * These are ESTIMATES, not a prescription. Every surface showing them says so.
 */
export function estimateTargets(input: {
  goal: NutritionGoal;
  age: number;
  sex: "h" | "f";
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
}): Macros {
  const bmr =
    10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === "h" ? 5 : -161);
  const calories = Math.round(
    bmr * ACTIVITY_FACTOR[input.activityLevel] * (1 + GOAL_DELTA[input.goal]),
  );
  const protein = Math.round(PROTEIN_PER_KG[input.goal] * input.weightKg);
  const fat = Math.round((calories * 0.25) / 9);
  // Carbs are the remainder, so the three macros add back up to the calories.
  // Floored at 0: an absurd input (2.0 g/kg of protein on 900 kcal) must not
  // produce negative carbs.
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

export function sumMacros(entries: { macros: Macros }[]): Macros {
  return entries.reduce<Macros>(
    (total, entry) => ({
      calories: total.calories + entry.macros.calories,
      protein: total.protein + entry.macros.protein,
      carbs: total.carbs + entry.macros.carbs,
      fat: total.fat + entry.macros.fat,
    }),
    ZERO,
  );
}

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

// --- Allergy / exclusion guard --------------------------------------------
//
// The system prompt calls allergies and excluded foods hard constraints, but a
// prompt is not an enforcement mechanism: until this guard, the only thing
// stopping a plan with peanuts in it from reaching the database was the model
// reading its own instructions. This is the one health-safety path in the app,
// so it gets a server-side backstop on the WRITE mutations (see `savePlan`,
// `replaceMeal`, `regenerateDay`).
//
// Deliberately NOT attempted: hidden-ingredient inference (butter → lactose,
// soy sauce → wheat, surimi → egg). The prompt asks the model for that, and a
// server-side food-science table we'd have to keep correct would give false
// confidence in the half of the space it doesn't know. This guard checks what
// the model actually wrote down, nothing more.

/**
 * Ingredient lists and exclusion lists are user/model data — everything is
 * bounded. Every one of these is a SCAN cap, not a truncation: past any of them
 * the guard refuses instead of checking a prefix and calling it clear. A name is
 * usually 2-4 words, so a 24-word one is a model gone strange, not a recipe.
 */
const MAX_NAME_CHARS = 120;
const MAX_TOKENS = 24;
const MAX_INGREDIENTS = 60;
const MAX_FORBIDDEN = 40;

/**
 * A food name as comparable word tokens: accents stripped, "œ"/"æ" spelled out,
 * lowercased, split on anything that isn't a letter or a digit, and a naive
 * singular — a trailing "s" is dropped from words of 4 letters or more, so
 * "Œufs" and "oeuf" meet in the middle while "noix", "riz" and "ail" are left
 * alone.
 *
 * Tokens, not a substring, because substring matching is wrong in both
 * directions here: `"chocolat".includes("lait")` is false but
 * `"travail".includes("ail")` is true, and an allergy guard that fires on
 * "travail" gets muted by its user.
 */
function foodTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length >= 4 && word.endsWith("s") ? word.slice(0, -1) : word));
}

/**
 * A name we cannot honestly claim to have checked. `foodTokens` used to slice
 * here, which meant an allergen past the cap was silently reported clear — the
 * same fail-open the count checks below were written to prevent, one level down.
 * The length test comes first and `||` short-circuits, so tokenising only ever
 * runs on a name already under 120 chars: bounded work, no truncation.
 */
const unscannable = (name: string): boolean =>
  name.length > MAX_NAME_CHARS || foodTokens(name).length > MAX_TOKENS;

/** `needle` as a contiguous run of whole words in `haystack` — so "fruits de mer" matches
 *  "Fruits de mer surgelés" but "mer" alone never matches "amer". */
function containsWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_, i) => needle.every((word, j) => haystack[i + j] === word));
}

export type ForbiddenHit = { meal: string; ingredient: string; forbidden: string };

/**
 * Every (ingredient, forbidden item) pair a set of meals hits. Empty means the
 * meals are clear — which is also what an empty `allergies` + `excluded` gives,
 * so a profile with no restrictions behaves exactly as before.
 *
 * Pure and exported so `nutrition.check.ts` can hammer it without a Convex
 * runtime. Matching is on the ingredient names the model wrote; a forbidden
 * item named inside a recipe STEP but absent from the ingredients is not
 * caught, and neither is a dish name that implies it ("tiramisu" with no egg
 * listed).
 *
 * Known and accepted over-match: an exclusion of "lait" flags "lait de coco",
 * which contains no dairy. Over-refusing a meal costs the model one retry;
 * under-refusing costs the user an allergic reaction.
 *
 * The bounds below fail CLOSED for the same reason. Reads here stay bounded like
 * every read in this codebase, but a guard that silently stops scanning at the
 * cap is worse than no guard: it reports "clear" on the one payload big enough to
 * hide something. Past the cap it refuses instead of shrugging. Nothing clamps
 * ingredient COUNT upstream — `clampMeal` only clamps macros — so this is the
 * only thing standing between a 200-ingredient meal and the database.
 */
export function forbiddenHits(
  meals: { name: string; ingredients: { name: string }[] }[],
  forbidden: string[],
): ForbiddenHit[] {
  // Counted BEFORE the needles are built, and before the empty-needle exit: with
  // the order reversed, 40 blank entries followed by one real allergy tokenised to
  // nothing, returned "clear", and never reached this refusal.
  if (forbidden.length > MAX_FORBIDDEN) {
    return meals.map((meal) => ({
      meal: meal.name,
      ingredient: `${forbidden.length} interdits déclarés`,
      forbidden: `plus de ${MAX_FORBIDDEN} interdits : liste trop longue pour être vérifiée`,
    }));
  }
  const unscannableNeedle = forbidden.find(unscannable);
  if (unscannableNeedle !== undefined) {
    return meals.map((meal) => ({
      meal: meal.name,
      ingredient: `interdit de ${unscannableNeedle.length} caractères`,
      forbidden: "un interdit trop long pour être vérifié",
    }));
  }
  const needles = forbidden
    .map((item) => ({ label: item.trim(), tokens: foodTokens(item) }))
    .filter((needle) => needle.tokens.length > 0);
  if (needles.length === 0) return [];

  const hits: ForbiddenHit[] = [];
  for (const meal of meals) {
    if (meal.ingredients.length > MAX_INGREDIENTS) {
      hits.push({
        meal: meal.name,
        ingredient: `${meal.ingredients.length} ingrédients`,
        forbidden: `plus de ${MAX_INGREDIENTS} ingrédients : recette trop longue pour être vérifiée`,
      });
      continue;
    }
    for (const ingredient of meal.ingredients) {
      if (unscannable(ingredient.name)) {
        hits.push({
          meal: meal.name,
          ingredient: ingredient.name.slice(0, 40).trim(),
          forbidden: "nom d'ingrédient trop long pour être vérifié",
        });
        continue;
      }
      const words = foodTokens(ingredient.name);
      for (const needle of needles) {
        if (containsWords(words, needle.tokens)) {
          hits.push({
            meal: meal.name,
            ingredient: ingredient.name.trim(),
            forbidden: needle.label,
          });
        }
      }
    }
  }
  return hits;
}

/**
 * A week's ingredients as a shopping list, merged by normalised name.
 *
 * ponytail: quantities are collected as the strings the model wrote, never
 * summed — "200 g" + "1 cuillère" has no answer, and unit parsing is a rabbit
 * hole for a list someone reads in a supermarket. Sum them if the day comes
 * when every quantity is machine-written.
 */
export function shoppingListFrom(days: PlanDay[]): { name: string; quantities: string[] }[] {
  const lines = new Map<string, { name: string; quantities: string[] }>();
  for (const day of days) {
    for (const meal of day.meals) {
      for (const ingredient of meal.ingredients) {
        const key = normalizeName(ingredient.name);
        if (!key) continue;
        // First spelling seen wins as the display name — it's the one the user
        // already read in their plan.
        const line = lines.get(key) ?? { name: ingredient.name.trim(), quantities: [] };
        const quantity = ingredient.quantity.trim();
        if (quantity) line.quantities.push(quantity);
        lines.set(key, line);
      }
    }
  }
  return [...lines.values()];
}

const SLOT_ORDER: MealSlot[] = ["petit_dejeuner", "dejeuner", "collation", "diner"];

/** Chronological, so a regenerated day doesn't read out of order. */
const bySlot = (a: PlannedMeal, b: PlannedMeal) =>
  SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);

/**
 * Plausibility clamps. The writer is often a language model, and a clamped
 * number is more useful to it than a failed turn — so clamp, never throw.
 */
export function clampMacros(m: Macros): Macros {
  return {
    calories: clamp(m.calories, 0, 3000),
    protein: clamp(m.protein, 0, 300),
    carbs: clamp(m.carbs, 0, 300),
    fat: clamp(m.fat, 0, 300),
  };
}

const clampMeal = (meal: PlannedMeal): PlannedMeal => ({
  ...meal,
  macros: clampMacros(meal.macros),
});

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

const profileFor = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("nutritionProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

const planFor = (ctx: QueryCtx, userId: Id<"users">, week: string) =>
  ctx.db
    .query("mealPlans")
    .withIndex("by_user_and_week", (q) => q.eq("userId", userId).eq("weekStart", week))
    .unique();

/**
 * The backstop, on every path that persists a meal. Returns the hits; the caller
 * MUST return before writing when the list isn't empty.
 *
 * A refusal is RETURNED, not thrown: these mutations are called from a chef tool
 * mid-conversation, and a thrown error surfaces to the user as a broken turn
 * while telling the model nothing it can act on. A structured refusal (same
 * spirit as the discriminated results in `convex/coach.ts`) lands in the tool
 * result, so the model reads which ingredient it must drop and calls the tool
 * again. Silent persistence is impossible either way: nothing is written on the
 * refusal branch.
 */
async function forbiddenIn(
  ctx: MutationCtx,
  userId: Id<"users">,
  meals: PlannedMeal[],
): Promise<ForbiddenHit[]> {
  const profile = await profileFor(ctx, userId);
  if (!profile) return [];
  return forbiddenHits(meals, [...profile.allergies, ...profile.excluded]);
}

const refused = (violations: ForbiddenHit[]) =>
  ({
    result: "refused" as const,
    violations,
    note: "Rien n'a été enregistré : ces ingrédients sont dans les ALLERGIES ou les ALIMENTS EXCLUS du user. Remplace-les et rappelle l'outil. Dis-lui ce que tu as changé.",
  }) as const;

async function requirePlan(ctx: MutationCtx, week: string) {
  const user = await requireCurrentUser(ctx);
  const plan = await planFor(ctx, user._id, week);
  if (!plan) throw new Error("Aucun plan pour cette semaine");
  return plan;
}

/** The day's meals, mutable in place — the caller patches `plan.days` back. */
function requireDay(plan: Doc<"mealPlans">, date: string) {
  const day = plan.days.find((d) => d.date === date);
  if (!day) throw new Error(`Aucun jour ${date} dans ce plan`);
  return day;
}

export const saveProfile = mutation({
  args: nutritionProfile.omit("userId", "targets").fields,
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const measurements = {
      age: clamp(args.age, 10, 100),
      heightCm: clamp(args.heightCm, 100, 250),
      weightKg: clamp(args.weightKg, 30, 300),
    };
    const targets = estimateTargets({ ...args, ...measurements });

    // Convex `patch` DELETES a key set to `undefined`, so spreading the optional
    // fields blindly would erase the diet the user gave last turn just because
    // this tool call didn't repeat it. Only keys we actually have travel.
    const fields = {
      goal: args.goal,
      sex: args.sex,
      activityLevel: args.activityLevel,
      allergies: args.allergies,
      excluded: args.excluded,
      mealsPerDay: args.mealsPerDay,
      ...measurements,
      ...(args.diet !== undefined && { diet: args.diet }),
      ...(args.budget !== undefined && { budget: args.budget }),
      ...(args.cookMinutes !== undefined && { cookMinutes: args.cookMinutes }),
      ...(args.people !== undefined && { people: args.people }),
      targets,
    };

    const existing = await profileFor(ctx, user._id);
    if (existing) {
      await ctx.db.patch("nutritionProfiles", existing._id, fields);
    } else {
      await ctx.db.insert("nutritionProfiles", { userId: user._id, ...fields });
    }
    return { targets };
  },
});

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await profileFor(ctx, user._id) : null;
  },
});

/**
 * Everything /nutrition draws, in one subscription. `today` is an argument, not
 * `Date.now()` — a query doesn't rerun because the clock moved.
 *
 * Answers for a brand-new user with no profile and no plan: this is the first
 * thing they load, so nulls and zeros, never a throw.
 */
export const dashboard = query({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const week = weekStart(args.today);
    const user = await getCurrentUser(ctx);
    if (!user) {
      return {
        profile: null,
        todayMeals: [] as PlannedMeal[],
        log: [] as Doc<"foodLog">[],
        consumed: ZERO,
        hydrationMl: 0,
        weekStart: week,
        hasPlan: false,
      };
    }

    const plan = await planFor(ctx, user._id, week);
    const log = await ctx.db
      .query("foodLog")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.today))
      .take(100);
    const water = await ctx.db
      .query("hydration")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.today))
      .unique();

    return {
      profile: await profileFor(ctx, user._id),
      todayMeals: plan?.days.find((d) => d.date === args.today)?.meals ?? [],
      log,
      consumed: sumMacros(log),
      hydrationMl: water?.ml ?? 0,
      weekStart: week,
      hasPlan: plan !== null,
    };
  },
});

export const plan = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    return user ? await planFor(ctx, user._id, args.weekStart) : null;
  },
});

export const savePlan = internalMutation({
  args: { weekStart: v.string(), days: v.array(planDay) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // Mirrors crew.generateChallenge: every week key in the app is a Monday, and
    // a plan filed under a Tuesday would be invisible to every reader.
    if (weekStart(args.weekStart) !== args.weekStart) {
      throw new Error("weekStart must be a Monday");
    }

    const days = args.days.map((day) => ({
      date: day.date,
      meals: day.meals.map(clampMeal).sort(bySlot),
    }));

    // Checked across the WHOLE week before anything is written: a half-saved
    // plan is worse than a refused one.
    const violations = await forbiddenIn(
      ctx,
      user._id,
      days.flatMap((day) => day.meals),
    );
    if (violations.length > 0) return refused(violations);

    const existing = await planFor(ctx, user._id, args.weekStart);
    if (existing) {
      await ctx.db.patch("mealPlans", existing._id, { days });
    } else {
      await ctx.db.insert("mealPlans", { userId: user._id, weekStart: args.weekStart, days });
    }
    return { result: "ok" as const, meals: days.reduce((n, day) => n + day.meals.length, 0) };
  },
});

export const replaceMeal = internalMutation({
  args: { weekStart: v.string(), date: v.string(), slot: mealSlot, meal: plannedMeal },
  handler: async (ctx, args) => {
    const plan = await requirePlan(ctx, args.weekStart);
    const day = requireDay(plan, args.date);
    const meal = clampMeal({ ...args.meal, slot: args.slot });

    const violations = await forbiddenIn(ctx, plan.userId, [meal]);
    if (violations.length > 0) return refused(violations);

    const index = day.meals.findIndex((m) => m.slot === args.slot);
    if (index >= 0) day.meals[index] = meal;
    else day.meals.push(meal);
    day.meals.sort(bySlot);

    await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    return { result: "ok" as const, name: meal.name };
  },
});

const slotRef = v.object({ date: v.string(), slot: mealSlot });

export const moveMeal = internalMutation({
  args: { weekStart: v.string(), from: slotRef, to: slotRef },
  handler: async (ctx, args) => {
    const plan = await requirePlan(ctx, args.weekStart);
    const from = requireDay(plan, args.from.date);
    const to = requireDay(plan, args.to.date);

    const index = from.meals.findIndex((m) => m.slot === args.from.slot);
    if (index < 0) throw new Error("Aucun repas à déplacer sur ce créneau");
    const moved = { ...from.meals[index], slot: args.to.slot };

    // An occupied destination swaps instead of overwriting: dropping a planned
    // meal on the floor because its slot was taken loses work silently.
    const occupied = to.meals.findIndex((m) => m.slot === args.to.slot);
    if (occupied >= 0) from.meals[index] = { ...to.meals[occupied], slot: args.from.slot };
    else from.meals.splice(index, 1);
    if (occupied >= 0) to.meals[occupied] = moved;
    else to.meals.push(moved);

    from.meals.sort(bySlot);
    to.meals.sort(bySlot);
    await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    return { name: moved.name };
  },
});

/**
 * Regenerates a day while keeping what the user locked. `meals` is what the model
 * produced for the free slots; an incoming meal aimed at a locked slot is
 * DROPPED, not appended — a locked meal means "leave this one alone", and two
 * dinners on one evening is not what anyone asked for.
 */
export const regenerateDay = internalMutation({
  args: { weekStart: v.string(), date: v.string(), meals: v.array(plannedMeal) },
  handler: async (ctx, args) => {
    const plan = await requirePlan(ctx, args.weekStart);
    const day = requireDay(plan, args.date);

    const kept = day.meals.filter((meal) => meal.locked === true);
    const locked = new Set(kept.map((meal) => meal.slot));
    const added = args.meals.filter((meal) => !locked.has(meal.slot)).map(clampMeal);

    // Only the incoming meals are checked. The kept ones are already in the plan
    // and locked BY THE USER — refusing the whole day over one of those would
    // leave the model unable to regenerate anything, with no way to fix it.
    const violations = await forbiddenIn(ctx, plan.userId, added);
    if (violations.length > 0) return refused(violations);

    day.meals = [...kept, ...added].sort(bySlot);
    await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    return { result: "ok" as const, kept: kept.length, added: added.length };
  },
});

export const toggleLock = mutation({
  args: { weekStart: v.string(), date: v.string(), slot: mealSlot },
  handler: async (ctx, args) => {
    const plan = await requirePlan(ctx, args.weekStart);
    const day = requireDay(plan, args.date);
    const meal = day.meals.find((m) => m.slot === args.slot);
    if (!meal) throw new Error("Aucun repas sur ce créneau");

    meal.locked = meal.locked !== true;
    await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    return { locked: meal.locked };
  },
});

export const shoppingList = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const found = await planFor(ctx, user._id, args.weekStart);
    return shoppingListFrom(found?.days ?? []);
  },
});

export const addLogEntry = mutation({
  args: {
    date: v.string(),
    slot: mealSlot,
    name: v.string(),
    quantity: v.optional(v.string()),
    macros,
    source: v.union(v.literal("plan"), v.literal("manual"), v.literal("image")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db.insert("foodLog", {
      userId: user._id,
      date: args.date,
      slot: args.slot,
      name: args.name,
      ...(args.quantity !== undefined && { quantity: args.quantity }),
      macros: clampMacros(args.macros),
      source: args.source,
    });
  },
});

/** Copies a planned meal into the log as-is: "j'ai mangé ce qui était prévu". */
export const logPlannedMeal = mutation({
  args: { date: v.string(), slot: mealSlot, weekStart: v.string() },
  handler: async (ctx, args) => {
    const plan = await requirePlan(ctx, args.weekStart);
    const day = requireDay(plan, args.date);
    const meal = day.meals.find((m) => m.slot === args.slot);
    if (!meal) throw new Error("Aucun repas prévu sur ce créneau");

    return await ctx.db.insert("foodLog", {
      userId: plan.userId,
      date: args.date,
      slot: args.slot,
      name: meal.name,
      macros: clampMacros(meal.macros),
      source: "plan",
    });
  },
});

async function ownedEntry(ctx: MutationCtx, id: Id<"foodLog">) {
  const user = await requireCurrentUser(ctx);
  const entry = await ctx.db.get("foodLog", id);
  if (!entry || entry.userId !== user._id) throw new Error("Entrée introuvable");
  return entry;
}

export const updateLogEntry = mutation({
  args: { id: v.id("foodLog"), quantity: v.optional(v.string()), macros: v.optional(macros) },
  handler: async (ctx, args) => {
    const entry = await ownedEntry(ctx, args.id);
    // Absent means "don't touch", not "erase" — see saveProfile.
    await ctx.db.patch("foodLog", entry._id, {
      ...(args.quantity !== undefined && { quantity: args.quantity }),
      ...(args.macros !== undefined && { macros: clampMacros(args.macros) }),
    });
    return null;
  },
});

export const deleteLogEntry = mutation({
  args: { id: v.id("foodLog") },
  handler: async (ctx, args) => {
    const entry = await ownedEntry(ctx, args.id);
    await ctx.db.delete("foodLog", entry._id);
    return null;
  },
});

/** "Same thing again" — the most common way anyone logs food twice. */
export const duplicateLogEntry = mutation({
  args: { id: v.id("foodLog"), date: v.string(), slot: mealSlot },
  handler: async (ctx, args) => {
    const entry = await ownedEntry(ctx, args.id);
    return await ctx.db.insert("foodLog", {
      userId: entry.userId,
      date: args.date,
      slot: args.slot,
      name: entry.name,
      ...(entry.quantity !== undefined && { quantity: entry.quantity }),
      macros: entry.macros,
      source: entry.source,
    });
  },
});

export const history = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const entries = await ctx.db
      .query("foodLog")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).gte("date", args.from).lte("date", args.to),
      )
      .order("desc")
      // ponytail: ~2 months of a diligent logger. Paginate if a range ever
      // outgrows it.
      .take(1000);

    // The index already returns dates descending, so grouping in order keeps the
    // result sorted without a second sort.
    const byDate = new Map<string, Doc<"foodLog">[]>();
    for (const entry of entries) {
      const day = byDate.get(entry.date) ?? [];
      day.push(entry);
      byDate.set(entry.date, day);
    }
    return [...byDate].map(([date, day]) => ({
      date,
      consumed: sumMacros(day),
      entries: day.length,
    }));
  },
});

export const setHydration = mutation({
  args: { date: v.string(), ml: v.number() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // 6 L is already medically silly; a typo of 60000 is not a reason to fail.
    const ml = Math.round(clamp(args.ml, 0, 6000));

    const existing = await ctx.db
      .query("hydration")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .unique();
    if (existing) await ctx.db.patch("hydration", existing._id, { ml });
    else await ctx.db.insert("hydration", { userId: user._id, date: args.date, ml });
    return null;
  },
});

export const inventory = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    // ponytail: a fridge and a cupboard, capped. Paginate if someone inventories
    // a restaurant.
    return await ctx.db
      .query("inventory")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(200);
  },
});

const inventoryItem = v.object({ name: v.string(), quantity: v.optional(v.string()) });

export const setInventory = mutation({
  args: {
    items: v.array(inventoryItem),
    mode: v.union(v.literal("add"), v.literal("replace")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(200);

    if (args.mode === "replace") {
      for (const row of rows) await ctx.db.delete("inventory", row._id);
    }
    const existing = new Map<string, Id<"inventory">>(
      args.mode === "add" ? rows.map((row) => [normalizeName(row.name), row._id]) : [],
    );

    for (const item of args.items) {
      const name = item.name.trim();
      const key = normalizeName(name);
      if (!key) continue;
      const rowId = existing.get(key);
      if (rowId) {
        // Same ingredient named twice: keep the row, update the quantity only if
        // this call carries one (patching `undefined` would delete it).
        if (item.quantity !== undefined) {
          await ctx.db.patch("inventory", rowId, { quantity: item.quantity });
        }
        continue;
      }
      existing.set(
        key,
        await ctx.db.insert("inventory", {
          userId: user._id,
          name,
          ...(item.quantity !== undefined && { quantity: item.quantity }),
        }),
      );
    }
    // The size of the inventory afterwards, which is what the Chef needs to know.
    return { count: existing.size };
  },
});

/** Used up / thrown out. Matched on the normalised name, so "Tomates" clears "tomate". */
export const consumeInventory = mutation({
  args: { names: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const wanted = new Set(args.names.map(normalizeName));
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(200);

    let removed = 0;
    for (const row of rows) {
      if (!wanted.has(normalizeName(row.name))) continue;
      await ctx.db.delete("inventory", row._id);
      removed += 1;
    }
    return { removed };
  },
});
