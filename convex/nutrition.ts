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
import {
  type HouseholdContext,
  adoptOwnMealsIntoFoyer,
  householdContext,
  householdPlanFor,
  isSharedSlot,
  sharedPortion,
} from "./households";

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

/** Two lists of days merged by date, meals concatenated and sorted by slot —
 *  used by `savePlan` to recombine the foyer's locked meals with the incoming
 *  week. */
function mergeDays(a: PlanDay[], b: PlanDay[]): PlanDay[] {
  const byDate = new Map<string, PlannedMeal[]>();
  for (const day of [...a, ...b]) {
    const meals = byDate.get(day.date) ?? [];
    meals.push(...day.meals);
    meals.sort(bySlot);
    byDate.set(day.date, meals);
  }
  return [...byDate].map(([date, meals]) => ({ date, meals }));
}

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

async function requirePlan(ctx: MutationCtx, week: string) {
  const user = await requireCurrentUser(ctx);
  const plan = await planFor(ctx, user._id, week);
  if (!plan) throw new Error("Aucun plan pour cette semaine");
  return plan;
}

/**
 * The member's own plan, created on demand when the foyer already has a week
 * for it — the only way a member can face a week without their own plan (the
 * partner generated it: the shared dinners are visible and `hasPlan` is true,
 * so the Chef believes a plan exists). A solo user keeps the historical
 * behaviour: an absent plan is an error.
 */
async function planOrCreate(
  ctx: MutationCtx,
  userId: Id<"users">,
  h: HouseholdContext,
  week: string,
) {
  const found = await planFor(ctx, userId, week);
  if (found) return found;
  const foyerWeek = h.household ? await householdPlanFor(ctx, h.household._id, week) : null;
  if (!foyerWeek) throw new Error("Aucun plan pour cette semaine");
  const created = await ctx.db.insert("mealPlans", { userId, weekStart: week, days: [] });
  const plan = await ctx.db.get("mealPlans", created);
  if (!plan) throw new Error("Aucun plan pour cette semaine");
  return plan;
}

/** The day's meals, mutable in place — the caller patches `plan.days` back.
 *  Works on both `mealPlans` and `householdMealPlans` docs: they share `days`. */
function requireDay(plan: { days: PlanDay[] }, date: string) {
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

    // A foyer can become shared-active by THIS profile appearing — the second
    // one to exist (the UI says « … doit compléter son profil »). Adoption moves
    // the meals already planned on the shared slots into the foyer's week, so
    // the routing and the display never diverge. No-op outside a live foyer.
    const h = await householdContext(ctx, user._id);
    if (h.active && h.household) {
      await adoptOwnMealsIntoFoyer(ctx, h.household._id, h.household.sharedSlots);
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
        household: null,
      };
    }

    // One household fetch + two profile fetches for the whole query: `active`
    // only becomes true with a complete foyer AND both profiles, and everything
    // below routes on it.
    const h = await householdContext(ctx, user._id);
    const plan = await planFor(ctx, user._id, week);
    const sharedPlan = h.household ? await householdPlanFor(ctx, h.household._id, week) : null;
    const log = await ctx.db
      .query("foodLog")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.today))
      .take(100);
    const water = await ctx.db
      .query("hydration")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.today))
      .unique();

    const ownDay = plan?.days.find((d) => d.date === args.today);
    const sharedDay = sharedPlan?.days.find((d) => d.date === args.today);
    // A slot present in the foyer's plan REPLACES the member's own one: the
    // foyer's dish wins, and it is never generated twice.
    const sharedSlots = new Set(sharedDay?.meals.map((m) => m.slot) ?? []);
    const ownMeals = (ownDay?.meals ?? []).filter((m) => !sharedSlots.has(m.slot));
    const todayMeals: (PlannedMeal & { sharedWith?: string })[] = sharedDay
      ? [
          ...ownMeals,
          ...sharedDay.meals.map((meal) => ({
            ...meal,
            // The dish's macros are per portion: mine, never the partner's.
            macros: sharedPortion(
              meal,
              h.myProfile?.targets.calories ?? 0,
              h.partnerProfile?.targets.calories ?? 0,
            ),
            ...(h.partner ? { sharedWith: h.partner.name } : {}),
          })),
        ].sort(bySlot)
      : ownMeals;

    return {
      profile: await profileFor(ctx, user._id),
      todayMeals,
      log,
      consumed: sumMacros(log),
      hydrationMl: water?.ml ?? 0,
      weekStart: week,
      hasPlan: plan !== null || sharedPlan !== null,
      // The foyer's shape, as the client and the Chef's prompt read it — its
      // single definition (see the type in chef.ts).
      household: h.household
        ? {
            householdId: h.household._id,
            // The foyer's state, not derived from display strings: the UI
            // branches on it, and a partner's name can legitimately be empty.
            complete: h.household.memberIds.length === 2,
            sharedSlots: h.household.sharedSlots,
            partnerName: h.partner?.name ?? null,
            pendingCode:
              h.household.memberIds.length === 1 ? (h.household.inviteCode ?? null) : null,
            partnerHasProfile: h.complete && h.partnerProfile !== null,
            canShare: h.active,
          }
        : null,
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

    // One household fetch + two profile fetches, then route every meal: shared
    // slots to the foyer's plan, the rest to the member's own. A solo user has
    // no household, so every meal lands in their own plan — untouched behavior.
    const h = await householdContext(ctx, user._id);
    const days = args.days.map((day) => ({
      date: day.date,
      meals: day.meals.map(clampMeal).sort(bySlot),
    }));
    const own = days.map((day) => ({
      ...day,
      meals: day.meals.filter((meal) => !isSharedSlot(h, meal.slot)),
    }));
    const shared = days.map((day) => ({
      ...day,
      meals: day.meals.filter((meal) => isSharedSlot(h, meal.slot)),
    }));

    const existing = await planFor(ctx, user._id, args.weekStart);
    if (existing) {
      await ctx.db.patch("mealPlans", existing._id, { days: own });
    } else {
      await ctx.db.insert("mealPlans", { userId: user._id, weekStart: args.weekStart, days: own });
    }

    if (h.household) {
      const foyerWeek = await householdPlanFor(ctx, h.household._id, args.weekStart);
      // Two Chefs can regenerate the same foyer week, so a lock here means more
      // than in a solo plan: an incoming proposal for a locked (date, slot) is
      // DROPPED and the locked meal stays — same rule as `regenerateDay`,
      // applied to the foyer realm where the other member may be generating.
      const lockedSlots = new Map<string, MealSlot[]>();
      for (const day of foyerWeek?.days ?? []) {
        const slots = day.meals.filter((m) => m.locked === true).map((m) => m.slot);
        if (slots.length) lockedSlots.set(day.date, slots);
      }
      const incoming = shared
        .map((day) => ({
          ...day,
          meals: day.meals.filter((m) => !(lockedSlots.get(day.date) ?? []).includes(m.slot)),
        }))
        .filter((day) => day.meals.length > 0);
      const kept = (foyerWeek?.days ?? []).map((day) => ({
        ...day,
        meals: day.meals.filter((m) => m.locked === true),
      }));

      const days = mergeDays(kept, incoming);
      if (foyerWeek) {
        await ctx.db.patch("householdMealPlans", foyerWeek._id, { days });
      } else if (days.length > 0) {
        await ctx.db.insert("householdMealPlans", {
          householdId: h.household._id,
          weekStart: args.weekStart,
          days,
        });
      }
    }

    return { meals: days.reduce((n, day) => n + day.meals.length, 0) };
  },
});

export const replaceMeal = internalMutation({
  args: { weekStart: v.string(), date: v.string(), slot: mealSlot, meal: plannedMeal },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const h = await householdContext(ctx, user._id);
    const meal = clampMeal({ ...args.meal, slot: args.slot });

    // Shared slot: the foyer's week owns the meal. One household fetch up top,
    // no per-meal reads.
    if (isSharedSlot(h, args.slot) && h.household) {
      const plan = await householdPlanFor(ctx, h.household._id, args.weekStart);
      const days = plan ? plan.days.map((day) => ({ ...day, meals: [...day.meals] })) : [];
      const day = days.find((d) => d.date === args.date) ?? { date: args.date, meals: [] };
      if (!days.includes(day)) days.push(day);
      const index = day.meals.findIndex((m) => m.slot === args.slot);
      if (index >= 0) day.meals[index] = meal;
      else day.meals.push(meal);
      day.meals.sort(bySlot);

      // Upsert the foyer's week when it doesn't exist yet: a meal can be
      // replaced before the week was ever generated.
      if (plan) {
        await ctx.db.patch("householdMealPlans", plan._id, { days });
      } else {
        await ctx.db.insert("householdMealPlans", {
          householdId: h.household._id,
          weekStart: args.weekStart,
          days,
        });
      }
      return { name: meal.name };
    }

    const plan = await planOrCreate(ctx, user._id, h, args.weekStart);
    const days = plan.days.map((day) => ({ ...day, meals: [...day.meals] }));
    const day = days.find((d) => d.date === args.date) ?? { date: args.date, meals: [] };
    if (!days.includes(day)) days.push(day);

    const index = day.meals.findIndex((m) => m.slot === args.slot);
    if (index >= 0) day.meals[index] = meal;
    else day.meals.push(meal);
    day.meals.sort(bySlot);

    await ctx.db.patch("mealPlans", plan._id, { days });
    return { name: meal.name };
  },
});

const slotRef = v.object({ date: v.string(), slot: mealSlot });

export const moveMeal = internalMutation({
  args: { weekStart: v.string(), from: slotRef, to: slotRef },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const h = await householdContext(ctx, user._id);
    const fromShared = isSharedSlot(h, args.from.slot);
    const toShared = isSharedSlot(h, args.to.slot);
    // Crossing the foyer boundary would duplicate or orphan the dish: the
    // shared realm and the personal realm never swap meals.
    if (fromShared !== toShared) {
      throw new Error(
        "Impossible de déplacer un repas partagé vers un créneau personnel (ou l'inverse)",
      );
    }

    if (fromShared && h.household) {
      const plan = await householdPlanFor(ctx, h.household._id, args.weekStart);
      if (!plan) throw new Error("Aucun plan pour cette semaine");
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
      await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
      return { name: moved.name };
    }

    const plan = await planOrCreate(ctx, user._id, h, args.weekStart);
    const days = plan.days.map((day) => ({ ...day, meals: [...day.meals] }));
    const from = days.find((d) => d.date === args.from.date) ?? { date: args.from.date, meals: [] };
    if (!days.includes(from)) days.push(from);
    const to = days.find((d) => d.date === args.to.date) ?? { date: args.to.date, meals: [] };
    if (!days.includes(to)) days.push(to);

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
    await ctx.db.patch("mealPlans", plan._id, { days });
    return { name: moved.name };
  },
});

/**
 * Regenerates a day while keeping what the user locked. `meals` is what the model
 * produced for the free slots; an incoming meal aimed at a locked slot is
 * DROPPED, not appended — a locked meal means "leave this one alone", and two
 * dinners on one evening is not what anyone asked for.
 *
 * With a foyer, the day is split per realm: shared slots regenerate the foyer's
 * day (locked shared meals stay there), the rest regenerate the member's own —
 * a lock never leaks across the boundary.
 */
export const regenerateDay = internalMutation({
  args: { weekStart: v.string(), date: v.string(), meals: v.array(plannedMeal) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const h = await householdContext(ctx, user._id);

    let kept = 0;
    let added = 0;
    // The day is created on demand: a day being regenerated always exists in
    // the own plan, but the foyer's week may not have one (or exist at all) —
    // same on-demand rule as `replaceMeal`.
    const apply = (days: PlanDay[], incoming: PlannedMeal[]) => {
      const day = days.find((d) => d.date === args.date) ?? { date: args.date, meals: [] };
      if (!days.includes(day)) days.push(day);
      const lockedMeals = day.meals.filter((meal) => meal.locked === true);
      const locked = new Set(lockedMeals.map((meal) => meal.slot));
      const fresh = incoming.filter((meal) => !locked.has(meal.slot)).map(clampMeal);
      kept += lockedMeals.length;
      added += fresh.length;
      day.meals = [...lockedMeals, ...fresh].sort(bySlot);
    };

    const ownIncoming = args.meals.filter((meal) => !isSharedSlot(h, meal.slot));
    const sharedIncoming = args.meals.filter((meal) => isSharedSlot(h, meal.slot));

    if (ownIncoming.length > 0) {
      const plan = await planOrCreate(ctx, user._id, h, args.weekStart);
      apply(plan.days, ownIncoming);
      await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    }

    if (sharedIncoming.length > 0 && h.household) {
      const plan = await householdPlanFor(ctx, h.household._id, args.weekStart);
      const days = plan ? plan.days.map((day) => ({ ...day, meals: [...day.meals] })) : [];
      apply(days, sharedIncoming);
      if (plan) {
        await ctx.db.patch("householdMealPlans", plan._id, { days });
      } else {
        await ctx.db.insert("householdMealPlans", {
          householdId: h.household._id,
          weekStart: args.weekStart,
          days,
        });
      }
    }

    return { kept, added };
  },
});

export const toggleLock = mutation({
  args: { weekStart: v.string(), date: v.string(), slot: mealSlot },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const h = await householdContext(ctx, user._id);

    if (isSharedSlot(h, args.slot) && h.household) {
      const plan = await householdPlanFor(ctx, h.household._id, args.weekStart);
      if (!plan) throw new Error("Aucun plan pour cette semaine");
      const day = requireDay(plan, args.date);
      const meal = day.meals.find((m) => m.slot === args.slot);
      if (!meal) throw new Error("Aucun repas sur ce créneau");

      meal.locked = meal.locked !== true;
      await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
      return { locked: meal.locked };
    }

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
    const h = await householdContext(ctx, user._id);
    const found = await planFor(ctx, user._id, args.weekStart);

    // A complete foyer: one consolidated list — the foyer's meals and the
    // member's own, merged so a shared dish appears exactly once. Solo or
    // pending: unchanged behavior. `shoppingListFrom` already merges by
    // normalised name (foyer first, its spelling wins), so concatenating the
    // days is enough.
    if (h.household && h.complete) {
      const shared = await householdPlanFor(ctx, h.household._id, args.weekStart);
      return shoppingListFrom([...(shared?.days ?? []), ...(found?.days ?? [])]);
    }
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
    const user = await requireCurrentUser(ctx);
    const h = await householdContext(ctx, user._id);

    // A shared meal: the foyer's dish, but MY portion of it — never the
    // partner's, and the dish's macros are per portion anyway.
    if (isSharedSlot(h, args.slot) && h.household) {
      const plan = await householdPlanFor(ctx, h.household._id, args.weekStart);
      if (!plan) throw new Error("Aucun plan pour cette semaine");
      const day = requireDay(plan, args.date);
      const meal = day.meals.find((m) => m.slot === args.slot);
      if (!meal) throw new Error("Aucun repas prévu sur ce créneau");

      return await ctx.db.insert("foodLog", {
        userId: user._id,
        date: args.date,
        slot: args.slot,
        name: meal.name,
        macros: clampMacros(
          sharedPortion(
            meal,
            h.myProfile?.targets.calories ?? 0,
            h.partnerProfile?.targets.calories ?? 0,
          ),
        ),
        source: "plan",
      });
    }

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
