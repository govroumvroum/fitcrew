import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type QueryCtx, mutation, query } from "./_generated/server";
import {
  type PlannedMeal,
  bySlot,
  clampMeal,
  dayTargets,
  planFor,
  profileFor,
  shoppingListFrom,
  normalizeName,
} from "./nutrition";
import { planWeeks } from "./planWeeks";
import { byOwnerAndKey, forbiddenFor, libraryFor, photoFor, recipeKey, visibleTo } from "./recipes";
import { categoryForSlot } from "./recipeLogic";
import { mealSlot } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";
import { sessionsOn, templateFor } from "./week";
import { resolveDayLevel } from "./weekTemplate";
import { liveChecks, nextChecks, pickCandidates } from "./weekPlanLogic";

/**
 * /nutrition's week view and shopping list (#121): the current week and the
 * next one, read without the chat. Replacing a meal by a library recipe is a
 * plain mutation here — no model, no `aiUsage` row. Inventing a meal stays the
 * Chef's job.
 *
 * Which Monday is the server's call (`planWeeks`), from the client's local
 * `today` and « current » / « next » — the same two weeks the Chef writes.
 */

const planWeek = v.union(v.literal("current"), v.literal("next"));

const DAY = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * A planned meal as a card: its own ingredients, steps and macros (they may
 * differ from the library copy), with the photo of the recipe of the same name —
 * the user's own, else the catalogue twin, else the photo cache. Same key as the
 * library (`recipeKey`), so a meal and its recipe card always show one picture.
 */
async function mealCard(ctx: QueryCtx, userId: Id<"users">, meal: PlannedMeal) {
  const key = recipeKey(meal.name);
  const own = key ? await byOwnerAndKey(ctx, userId, key) : null;
  const twin = key ? await byOwnerAndKey(ctx, undefined, key) : null;
  const direct = own?.photoUrl ?? twin?.photoUrl;
  const cached = direct || !key ? null : await photoFor(ctx, key);
  return {
    ...meal,
    category: categoryForSlot(meal.slot),
    cheat: (own?.cheat ?? twin?.cheat) === true,
    tags: [...new Set([...(own?.tags ?? []), ...(twin?.tags ?? [])])],
    photoUrl: direct ?? cached?.photoUrl ?? null,
    // Only the user's own recipes are ever looked up (`resolvePhotos`), and a
    // catalogue twin lends its photo instead — same rule as `pendingPhotoNames`.
    photoPending: own !== null && !direct && !twin && !cached,
  };
}

/**
 * One week, seven days, Monday first — a day without a plan is there with no
 * meals, so the tabs never shift. Each day carries its level and targets (#118)
 * when the user has a semaine type; a day before today counts its séances.
 */
export const week = query({
  args: { today: v.string(), week: planWeek },
  handler: async (ctx, args) => {
    const weekStart = planWeeks(args.today)[args.week];
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const user = await getCurrentUser(ctx);
    if (!user) {
      return {
        weekStart,
        hasPlan: false,
        days: dates.map((date) => ({ date, level: null, targets: null, meals: [] })),
      };
    }

    const plan = await planFor(ctx, user._id, weekStart);
    const profile = await profileFor(ctx, user._id);
    const template = await templateFor(ctx, user._id);

    const days = await Promise.all(
      dates.map(async (date) => {
        const { level } = resolveDayLevel({
          date,
          entries: template?.entries ?? [],
          override: template?.override ?? null,
          // The future has no séances yet: no read.
          sessions: date <= args.today ? await sessionsOn(ctx, user._id, date) : [],
        });
        const meals = plan?.days.find((day) => day.date === date)?.meals ?? [];
        return {
          date,
          level,
          targets: dayTargets(profile, { level }),
          meals: await Promise.all(meals.map((meal) => mealCard(ctx, user._id, meal))),
        };
      }),
    );
    return { weekStart, hasPlan: plan !== null, days };
  },
});

const slotArgs = { weekStart: v.string(), date: v.string(), slot: mealSlot };

/**
 * « Changer »: up to three library recipes for one planned meal — same shelf,
 * close kcal, never the meal itself, « sèche » first on a weight-loss goal.
 * The library is already cleared against allergies and exclusions
 * (`libraryFor`); `swapMeal` checks again at write time.
 *
 * Nothing for a locked meal: the lock means « leave this one alone », and the
 * screen doesn't offer « Changer » on it either.
 */
export const swapCandidates = query({
  args: slotArgs,
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const plan = await planFor(ctx, user._id, args.weekStart);
    const meal = plan?.days
      .find((day) => day.date === args.date)
      ?.meals.find((m) => m.slot === args.slot);
    if (!meal || meal.locked === true) return [];

    const profile = await profileFor(ctx, user._id);
    const library = await libraryFor(ctx, user._id, categoryForSlot(args.slot));
    return pickCandidates(
      library,
      { slot: args.slot, nameKey: recipeKey(meal.name), calories: meal.macros.calories },
      { secheFirst: profile?.goal === "perte" },
    );
  },
});

const refused = (note: string) => ({ result: "refused" as const, note });

/**
 * Replaces one planned meal by a library recipe. The client sends an id, never
 * a meal: the recipe is read here, must be the user's own or the shared
 * catalogue's, and goes through the allergy guard again — the profile may have
 * changed since the sheet opened (#84). Upserts no recipe: it already is one.
 *
 * Refusals are returned, like the Chef's mutations, so the screen can say why.
 */
export const swapMeal = mutation({
  args: { ...slotArgs, recipeId: v.id("recipes") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const plan = await planFor(ctx, user._id, args.weekStart);
    const day = plan?.days.find((d) => d.date === args.date);
    const index = day?.meals.findIndex((m) => m.slot === args.slot) ?? -1;
    if (!plan || !day || index < 0) return refused("Aucun repas à changer sur ce créneau.");
    if (day.meals[index].locked === true) {
      return refused("Ce repas est verrouillé. Déverrouille-le pour le changer.");
    }

    const recipe = await ctx.db.get("recipes", args.recipeId);
    if (!recipe || (recipe.userId !== undefined && recipe.userId !== user._id)) {
      return refused("Recette introuvable.");
    }
    // An own recipe inherits its catalogue twin's curated allergens, exactly as
    // the library merges them: allergens only ever hide more.
    const twin = recipe.userId ? await byOwnerAndKey(ctx, undefined, recipe.nameKey) : null;
    const allergens = [...(recipe.allergens ?? []), ...(twin?.allergens ?? [])];
    if (!visibleTo({ ...recipe, allergens }, await forbiddenFor(ctx, user._id))) {
      return refused("Cette recette contient un aliment que tu ne manges pas.");
    }

    const meal = clampMeal({
      slot: args.slot,
      name: recipe.name,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      prepMinutes: recipe.prepMinutes,
      macros: recipe.macros,
    });
    day.meals[index] = meal;
    day.meals.sort(bySlot);
    await ctx.db.patch("mealPlans", plan._id, { days: plan.days });
    return { result: "ok" as const, name: meal.name };
  },
});

const checksFor = (ctx: QueryCtx, userId: Id<"users">, weekStart: string) =>
  ctx.db
    .query("shoppingChecks")
    .withIndex("by_user_and_week", (q) => q.eq("userId", userId).eq("weekStart", weekStart))
    .unique();

/**
 * The week's shopping list with its ticks. Same consolidation as the Chef's
 * `shopping_list` (`shoppingListFrom`), so the screen and the chat agree line
 * for line. A tick whose ingredient left the plan is not shown.
 */
export const shoppingList = query({
  args: { today: v.string(), week: planWeek },
  handler: async (ctx, args) => {
    const weekStart = planWeeks(args.today)[args.week];
    const user = await getCurrentUser(ctx);
    if (!user) return { weekStart, hasPlan: false, items: [] };
    const plan = await planFor(ctx, user._id, weekStart);
    const lines = shoppingListFrom(plan?.days ?? []).map((line) => ({
      ...line,
      key: normalizeName(line.name),
    }));
    const checked = new Set(
      liveChecks(
        (await checksFor(ctx, user._id, weekStart))?.keys ?? [],
        lines.map((l) => l.key),
      ),
    );
    return {
      weekStart,
      hasPlan: plan !== null,
      items: lines.map((line) => ({ ...line, checked: checked.has(line.key) })),
    };
  },
});

/** One tick. Prunes the orphans while it's there (`nextChecks`). */
export const setShoppingCheck = mutation({
  args: { weekStart: v.string(), key: v.string(), checked: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const plan = await planFor(ctx, user._id, args.weekStart);
    if (!plan) return null;
    const listKeys = shoppingListFrom(plan.days).map((line) => normalizeName(line.name));
    const existing = await checksFor(ctx, user._id, args.weekStart);
    const keys = nextChecks(existing?.keys ?? [], listKeys, args.key, args.checked);
    if (existing) await ctx.db.patch("shoppingChecks", existing._id, { keys });
    else
      await ctx.db.insert("shoppingChecks", { userId: user._id, weekStart: args.weekStart, keys });
    return null;
  },
});
