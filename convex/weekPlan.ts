import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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
import { type PlanWeek, planWeeks } from "./planWeeks";
import { byOwnerAndKey, forbiddenFor, libraryFor, photoFor, recipeKey, visibleTo } from "./recipes";
import { categoryForSlot } from "./recipeLogic";
import { mealSlot } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";
import { sessionsOn, templateFor } from "./week";
import { resolveDayLevel } from "./weekTemplate";
import { checkKeys, liveChecks, pickCandidates } from "./weekPlanLogic";

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
    const user = await getCurrentUser(ctx);
    if (!user) return emptyWeek(args.today, args.week);
    return await weekFor(ctx, user._id, args.today, args.week);
  },
});

/** Today's Monday and its seven dates, Monday first. */
function weekDates(today: string, week: PlanWeek) {
  const weekStart = planWeeks(today)[week];
  return { weekStart, dates: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) };
}

function emptyWeek(today: string, week: PlanWeek) {
  const { weekStart, dates } = weekDates(today, week);
  return {
    weekStart,
    hasPlan: false,
    days: dates.map((date) => ({ date, level: null, targets: null, meals: [] })),
  };
}

/**
 * The week for a known user. The public query resolves the Clerk identity, the
 * MCP tool passes the verified `userId` from its key (#135) — one reader, so the
 * screen and the agent can't drift.
 */
async function weekFor(ctx: QueryCtx, userId: Id<"users">, today: string, week: PlanWeek) {
  const { weekStart, dates } = weekDates(today, week);
  const plan = await planFor(ctx, userId, weekStart);
  const profile = await profileFor(ctx, userId);
  const template = await templateFor(ctx, userId);

  const days = await Promise.all(
    dates.map(async (date) => {
      const { level } = resolveDayLevel({
        date,
        entries: template?.entries ?? [],
        override: template?.override ?? null,
        // The future has no séances yet: no read.
        sessions: date <= today ? await sessionsOn(ctx, userId, date) : [],
      });
      const meals = plan?.days.find((day) => day.date === date)?.meals ?? [];
      return {
        date,
        level,
        targets: dayTargets(profile, { level }),
        meals: await Promise.all(meals.map((meal) => mealCard(ctx, userId, meal))),
      };
    }),
  );
  return { weekStart, hasPlan: plan !== null, days };
}

/**
 * The same week for the MCP tool. The tool's `returns` is an allowlist, so the
 * projection here is what leaves FitCrew: no steps, photos or tags.
 */
export const weekForMcp = internalQuery({
  args: { userId: v.id("users"), today: v.string(), week: planWeek },
  handler: async (ctx, args) => {
    const plan = await weekFor(ctx, args.userId, args.today, args.week);
    return {
      weekStart: plan.weekStart,
      hasPlan: plan.hasPlan,
      days: plan.days.map((day) => ({
        date: day.date,
        level: day.level,
        targets: day.targets,
        meals: day.meals.map((meal) => ({
          slot: meal.slot,
          name: meal.name,
          ingredients: meal.ingredients,
          macros: meal.macros,
          prepMinutes: meal.prepMinutes,
          locked: meal.locked,
        })),
      })),
    };
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
    const user = await getCurrentUser(ctx);
    if (!user) return { weekStart: planWeeks(args.today)[args.week], hasPlan: false, items: [] };
    return await shoppingListFor(ctx, user._id, args.today, args.week);
  },
});

/** The list for a known user — the screen's query and the MCP tool share it. */
async function shoppingListFor(ctx: QueryCtx, userId: Id<"users">, today: string, week: PlanWeek) {
  const weekStart = planWeeks(today)[week];
  const plan = await planFor(ctx, userId, weekStart);
  const lines = shoppingListFrom(plan?.days ?? []).map((line) => ({
    ...line,
    key: normalizeName(line.name),
  }));
  const checked = new Set(
    liveChecks(
      (await checksFor(ctx, userId, weekStart))?.keys ?? [],
      lines.map((l) => l.key),
    ),
  );
  return {
    weekStart,
    hasPlan: plan !== null,
    items: lines.map((line) => ({ ...line, checked: checked.has(line.key) })),
  };
}

/** The same list for the MCP tool (`get_shopping_list`). */
export const shoppingListForMcp = internalQuery({
  args: { userId: v.id("users"), today: v.string(), week: planWeek },
  handler: async (ctx, args) => shoppingListFor(ctx, args.userId, args.today, args.week),
});

type CheckWrite = { hasPlan: boolean; keys: string[] };

/**
 * Ticks a batch of keys for one week in a single transaction. `nextChecks` keeps
 * only keys the list actually has, so a model-written (or stale) key writes
 * nothing; a week without a plan writes nothing at all.
 */
async function writeChecks(
  ctx: MutationCtx,
  userId: Id<"users">,
  weekStart: string,
  keys: readonly string[],
  checked: boolean,
): Promise<CheckWrite> {
  const plan = await planFor(ctx, userId, weekStart);
  if (!plan) return { hasPlan: false, keys: [] };
  const listKeys = shoppingListFrom(plan.days).map((line) => normalizeName(line.name));
  const existing = await checksFor(ctx, userId, weekStart);
  const next = checkKeys(existing?.keys ?? [], listKeys, keys, checked);
  if (existing) await ctx.db.patch("shoppingChecks", existing._id, { keys: next });
  else if (next.length > 0)
    await ctx.db.insert("shoppingChecks", { userId, weekStart, keys: next });
  return { hasPlan: true, keys: next };
}

/** One tick. Prunes the orphans while it's there (`nextChecks`). */
export const setShoppingCheck = mutation({
  args: { weekStart: v.string(), key: v.string(), checked: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await writeChecks(ctx, user._id, args.weekStart, [args.key], args.checked);
    return null;
  },
});

/**
 * The same ticks for `check_shopping_items`: a whole basket, one transaction,
 * as the verified MCP user. The public mutation above keeps its one-key shape
 * for already-loaded PWA clients.
 */
export const setShoppingChecksForMcp = internalMutation({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    keys: v.array(v.string()),
    checked: v.boolean(),
  },
  handler: async (ctx, args) =>
    writeChecks(ctx, args.userId, args.weekStart, args.keys, args.checked),
});
