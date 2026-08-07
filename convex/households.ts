import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation } from "./_generated/server";
import { macros, mealSlot, planDay, plannedMeal } from "./schema";
import { requireCurrentUser } from "./users";

export type Macros = Infer<typeof macros>;
export type MealSlot = Infer<typeof mealSlot>;
export type PlannedMeal = Infer<typeof plannedMeal>;
export type PlanDay = Infer<typeof planDay>;

/** Le choix d'un membre dans un duel : "a" = l'incumbent, "b" = le challenger. */
export type DuelChoice = "a" | "b";

/** Un geste de chifoumi, en version salle de sport. */
export type ChifoumiThrow = "pierre" | "papier" | "ciseaux";

/**
 * Règles du chifoumi : la pierre bat les ciseaux, les ciseaux battent le
 * papier, le papier bat la pierre. Égalité → rejouer. Pure, testée.
 */
export function chifoumiResult(a: ChifoumiThrow, b: ChifoumiThrow): DuelChoice | "draw" {
  if (a === b) return "draw";
  if (
    (a === "pierre" && b === "ciseaux") ||
    (a === "ciseaux" && b === "papier") ||
    (a === "papier" && b === "pierre")
  ) {
    return "a";
  }
  return "b";
}

// ---------------------------------------------------------------------------
// Pure logic. No ctx, no clock — see households.check.ts.
// ---------------------------------------------------------------------------

// Local copy, not an import from nutrition.ts: nutrition.ts imports this module
// to route meals, so a runtime import the other way would be a cycle. Same
// numbers, same clamps — the foyer copies are bounded anyway (they come from
// already-clamped macros).
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function clampMacros(m: Macros): Macros {
  return {
    calories: clamp(m.calories, 0, 3000),
    protein: clamp(m.protein, 0, 300),
    carbs: clamp(m.carbs, 0, 300),
    fat: clamp(m.fat, 0, 300),
  };
}

const SLOT_ORDER: MealSlot[] = ["petit_dejeuner", "dejeuner", "collation", "diner"];

/** Chronological, same as nutrition.ts's `bySlot`. */
const bySlot = (a: PlannedMeal, b: PlannedMeal) =>
  SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);

/**
 * A member's portion of a shared meal. The recipe's macros are for ONE portion;
 * the dish totals `macros × portions` (default 2), and the split follows the
 * two partners' calorie targets — round to integers. If either target is
 * missing or zero at compute time, fall back to an equal split.
 *
 * The ratio is the ONLY thing ever derived from the partners' targets: targets
 * themselves are read here and never leave this function.
 */
export function sharedPortion(meal: PlannedMeal, myCalories: number, partnerCalories: number): Macros {
  const portions = meal.portions ?? 2;
  const total = {
    calories: meal.macros.calories * portions,
    protein: meal.macros.protein * portions,
    carbs: meal.macros.carbs * portions,
    fat: meal.macros.fat * portions,
  };
  if (!myCalories || !partnerCalories) {
    return {
      calories: Math.round(total.calories / 2),
      protein: Math.round(total.protein / 2),
      carbs: Math.round(total.carbs / 2),
      fat: Math.round(total.fat / 2),
    };
  }
  const myShare = myCalories / (myCalories + partnerCalories);
  return {
    calories: Math.round(total.calories * myShare),
    protein: Math.round(total.protein * myShare),
    carbs: Math.round(total.carbs * myShare),
    fat: Math.round(total.fat * myShare),
  };
}

/**
 * Le duel est tranché : le gagnant "a" garde l'incumbent, "b" promeut le
 * challenger (sa recette s'étale sur le repas, son auteur gardé). Dans les
 * deux cas les champs de duel meurent avec la décision — le créneau redevient
 * un repas partagé normal. Pure : le caller écrit le résultat.
 */
export function applyDuelResolution(meal: PlannedMeal, winner: DuelChoice): PlannedMeal {
  const challenger = meal.duel;
  const {
    duel: _duel,
    duelVotes: _duelVotes,
    duelThrows: _duelThrows,
    ...rest
  } = meal;
  if (winner !== "b" || !challenger) return rest;
  return { ...rest, ...challenger.vs, proposedBy: challenger.proposedBy };
}/**
 * Le plat qu'un membre récupère quand un créneau en duel se dissout (split, ou
 * le foyer qui se sépare) : le plat pour lequel il a VOTÉ — "b" veut dire le
 * challenger — sinon l'incumbent (un membre sans vote, par sécurité). Les
 * champs du foyer (portions, duel, duelVotes) sont retirés et les macros
 * gardées telles quelles : le plat est à portion seule et rien que pour lui.
 */
export function dueledMealFor(meal: PlannedMeal, userId: Id<"users">): PlannedMeal {
  const vote = meal.duelVotes?.find((vote) => vote.userId === userId);
  const challenger = vote?.choice === "b" ? meal.duel : null;
  const {
    duel: _duel,
    duelVotes: _duelVotes,
    duelThrows: _duelThrows,
    portions: _portions,
    ...rest
  } = meal;
  if (!challenger) return rest;
  return { ...rest, ...challenger.vs, proposedBy: challenger.proposedBy };
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

const profileFor = (ctx: QueryCtx | MutationCtx, userId: Id<"users">) =>
  ctx.db
    .query("nutritionProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

/**
 * The caller's foyer row, if any. Read through `users.householdId`: Convex
 * indexes compare an array field as a WHOLE, so "which row contains me" cannot
 * be answered from `households.memberIds` — the pointer on the user is the
 * lookup, and the array is only ever read whole once the row is in hand.
 */
export async function householdFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"households"> | null> {
  const user = await ctx.db.get("users", userId);
  if (!user?.householdId) return null;
  return await ctx.db.get("households", user.householdId);
}

export function householdPlanFor(
  ctx: QueryCtx | MutationCtx,
  householdId: Id<"households">,
  week: string,
): Promise<Doc<"householdMealPlans"> | null> {
  return ctx.db
    .query("householdMealPlans")
    .withIndex("by_household_and_week", (q) => q.eq("householdId", householdId).eq("weekStart", week))
    .unique();
}

/**
 * Everything a handler needs to route meals, fetched ONCE per handler call —
 * one household read + two profile reads, whatever the number of slots. The
 * per-slot decision is `isSharedSlot` below, pure.
 */
export type HouseholdContext = {
  household: Doc<"households"> | null;
  /** The partner's users row — null while an invite is pending. */
  partner: Doc<"users"> | null;
  myProfile: Doc<"nutritionProfiles"> | null;
  partnerProfile: Doc<"nutritionProfiles"> | null;
  /** Both members joined (2 in `memberIds`). */
  complete: boolean;
  /** Complete AND both profiles exist: shared slots are live. */
  active: boolean;
};

export async function householdContext(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<HouseholdContext> {
  const household = await householdFor(ctx, userId);
  if (!household) {
    return {
      household: null,
      partner: null,
      myProfile: null,
      partnerProfile: null,
      complete: false,
      active: false,
    };
  }
  const partnerId = household.memberIds.find((id) => id !== userId) ?? null;
  const [partner, myProfile, partnerProfile] = await Promise.all([
    partnerId ? ctx.db.get("users", partnerId) : Promise.resolve(null),
    profileFor(ctx, userId),
    partnerId ? profileFor(ctx, partnerId) : Promise.resolve(null),
  ]);
  const complete = household.memberIds.length === 2;
  return {
    household,
    partner,
    myProfile,
    partnerProfile,
    complete,
    active: complete && myProfile !== null && partnerProfile !== null,
  };
}

/**
 * A slot is SHARED-ACTIVE when the foyer is complete, the slot is in
 * `sharedSlots` and BOTH partners have a profile. A solo user or a pending
 * foyer is completely unaffected — this never returns true for them.
 */
export function isSharedSlot(h: HouseholdContext, slot: MealSlot): boolean {
  return h.active && h.household!.sharedSlots.includes(slot);
}

// ---------------------------------------------------------------------------
// Invite lifecycle
// ---------------------------------------------------------------------------

// No 0/O/1/I: an invite code is read aloud and typed by hand.
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}

async function pendingCodeTaken(ctx: MutationCtx, code: string): Promise<boolean> {
  const rows = await ctx.db
    .query("households")
    .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
    .take(1);
  return rows.length > 0;
}

export const invite = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    if (await householdFor(ctx, user._id)) throw new Error("Tu es déjà dans un foyer");

    // 32^6 codes: a collision is a lottery win, but retry rather than fail.
    let code = randomInviteCode();
    for (let tries = 0; tries < 20 && (await pendingCodeTaken(ctx, code)); tries++) {
      code = randomInviteCode();
    }

    const householdId = await ctx.db.insert("households", {
      memberIds: [user._id],
      sharedSlots: ["diner"],
      inviteCode: code,
    });
    // The pointer that makes `householdFor` find the row — set together with
    // `memberIds`, cleared together too (see cancelInvite, join, leave).
    await ctx.db.patch("users", user._id, { householdId });
    return { code };
  },
});

export const cancelInvite = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");
    if (household.memberIds.length !== 1) {
      throw new Error("Le foyer n'a pas d'invitation en attente");
    }
    await ctx.db.patch("users", user._id, { householdId: undefined });
    await ctx.db.delete("households", household._id);
    return null;
  },
});

export const join = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    if (await householdFor(ctx, user._id)) throw new Error("Tu es déjà dans un foyer");

    const code = args.code.trim().toUpperCase();
    const rows = await ctx.db
      .query("households")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .take(1);
    const household = rows[0] ?? null;
    // One message for "no such code" and "already taken": neither is useful to
    // guess apart, and the pending owner is the only one who can see the truth.
    if (!household || household.memberIds.length !== 1) {
      throw new Error("Ce code n'est plus valide");
    }
    if (household.memberIds[0] === user._id) {
      throw new Error("Ce code n'est plus valide");
    }

    const partnerId = household.memberIds[0];
    await ctx.db.patch("households", household._id, {
      memberIds: [partnerId, user._id],
      // Convex `patch` DELETES a key set to `undefined`: the code dies with the
      // invite — see the saveProfile comment in nutrition.ts.
      inviteCode: undefined,
    });
    // Both members point at the row now: the joiner, and the inviter whose
    // pointer was set at `invite`.
    await ctx.db.patch("users", user._id, { householdId: household._id });
    // The default slot (dîner) becomes shared the moment the foyer completes:
    // meals already planned on it move into the foyer's week, so a visible meal
    // is never left behind the routing.
    await adoptOwnMealsIntoFoyer(ctx, household._id, household.sharedSlots);
    const partner = await ctx.db.get("users", partnerId);
    return { partnerName: partner?.name ?? null };
  },
});

// ---------------------------------------------------------------------------
// Shared slots + leaving
// ---------------------------------------------------------------------------

/** The meal a member now owns: their portion, portions field dropped (only
 *  shared foyer meals carry one), `locked` preserved — a locked shared meal
 *  stays locked for both. */
function ownMealFor(
  meal: PlannedMeal,
  mine: Doc<"nutritionProfiles"> | null,
  partner: Doc<"nutritionProfiles"> | null,
): PlannedMeal {
  const portion = sharedPortion(
    meal,
    mine?.targets.calories ?? 0,
    partner?.targets.calories ?? 0,
  );
  const own = { ...meal };
  delete own.portions;
  return { ...own, macros: clampMacros(portion) };
}

/** Replace-by-slot in a member's own plan: an occupied slot is overwritten, a
 *  missing week doc is created. Nothing is written for an empty `meals` list. */
async function adoptIntoMemberPlan(
  ctx: MutationCtx,
  memberId: Id<"users">,
  week: string,
  meals: { date: string; meal: PlannedMeal }[],
) {
  if (meals.length === 0) return;

  const plan = await ctx.db
    .query("mealPlans")
    .withIndex("by_user_and_week", (q) => q.eq("userId", memberId).eq("weekStart", week))
    .unique();

  if (plan) {
    const days = plan.days.map((day) => ({ ...day, meals: [...day.meals] }));
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const { date, meal } of meals) {
      let day = byDate.get(date);
      if (!day) {
        day = { date, meals: [] };
        byDate.set(date, day);
        days.push(day);
      }
      const index = day.meals.findIndex((m) => m.slot === meal.slot);
      if (index >= 0) day.meals[index] = meal;
      else day.meals.push(meal);
      day.meals.sort(bySlot);
    }
    await ctx.db.patch("mealPlans", plan._id, { days });
  } else {
    const days = new Map<string, PlanDay>();
    for (const { date, meal } of meals) {
      const day = days.get(date) ?? { date, meals: [] };
      day.meals.push(meal);
      day.meals.sort(bySlot);
      days.set(date, day);
    }
    await ctx.db.insert("mealPlans", {
      userId: memberId,
      weekStart: week,
      days: [...days.values()],
    });
  }
}

/** Every shared-slot meal of a foyer week, split per member with each one's
 *  portion — the shared copy step used by both `leave` and `setSharedSlots`. */
async function adoptFoyerWeek(  ctx: MutationCtx,
  household: Doc<"households">,
  row: Doc<"householdMealPlans">,
  onlySlots: MealSlot[] | null,
) {
  const profiles = await Promise.all(household.memberIds.map((id) => profileFor(ctx, id)));
  const meals = row.days.flatMap((day) =>
    day.meals
      .filter((meal) => onlySlots === null || onlySlots.includes(meal.slot))
      .map((meal) => ({ date: day.date, meal })),
  );
  for (const [i, memberId] of household.memberIds.entries()) {
    const mine = profiles[i] ?? null;
    const partner = profiles[1 - i] ?? null;
    await adoptIntoMemberPlan(
      ctx,
      memberId,
      row.weekStart,
      meals.map(({ date, meal }) => ({
        date,
        // Un créneau en duel se dissout en sortant : chaque membre repart avec
        // le plat pour lequel il a voté (sinon l'incumbent), champs du foyer
        // retirés, macros gardées telles quelles.
        meal: meal.duel ? dueledMealFor(meal, memberId) : ownMealFor(meal, mine, partner),
      })),
    );
  }
}

/**
 * Inverse of `adoptFoyerWeek`: when a slot becomes shared, the meals already
 * planned on it move from BOTH members' own plans into the foyer's week — a
 * visible meal must never be left behind the routing, which follows the config.
 * Per (date, slot) the locked meal wins, else the first member's. No-op while a
 * profile is missing: a slot only routes to the foyer once it is shared-active.
 * Also called from `saveProfile`: a foyer can become active by the SECOND
 * profile appearing, and the same adoption must run then.
 */
export async function adoptOwnMealsIntoFoyer(
  ctx: MutationCtx,
  householdId: Id<"households">,
  slots: MealSlot[],
) {
  const household = await ctx.db.get("households", householdId);
  if (!household) return;
  // Complete AND both profiles: the slot only routes to the foyer once the
  // foyer is live, so adoption only makes sense then too.
  if (household.memberIds.length !== 2) return;
  const profiles = await Promise.all(household.memberIds.map((id) => profileFor(ctx, id)));
  if (profiles.some((p) => p === null)) return;

  // <week, <date, <slot, meal>>> — the meal that wins each (date, slot).
  const winners = new Map<string, Map<string, Map<MealSlot, PlannedMeal>>>();
  for (const memberId of household.memberIds) {
    const plans = await ctx.db
      .query("mealPlans")
      .withIndex("by_user_and_week", (q) => q.eq("userId", memberId))
      .take(100); // ponytail: weeks of a two-person foyer. Paginate if it ever grows.
    for (const plan of plans) {
      for (const day of plan.days) {
        for (const meal of day.meals) {
          if (!slots.includes(meal.slot)) continue;
          const week = winners.get(plan.weekStart) ?? new Map();
          const date = week.get(day.date) ?? new Map();
          const existing = date.get(meal.slot);
          // Locked beats everything; otherwise the first member in the row.
          if (!existing || (meal.locked === true && existing.locked !== true)) {
            date.set(meal.slot, { ...meal, portions: 2 });
          }
          week.set(day.date, date);
          winners.set(plan.weekStart, week);
        }
      }
    }
  }
  if (winners.size === 0) return;

  // Write the winners into the foyer's week (created on demand) — the dish is
  // now the couple's, not one member's alone.
  for (const [week, byDate] of winners) {
    const foyerWeek = await householdPlanFor(ctx, householdId, week);
    const days = foyerWeek ? foyerWeek.days.map((day) => ({ ...day, meals: [...day.meals] })) : [];
    for (const [date, slotsForDate] of byDate) {
      const day = days.find((d) => d.date === date) ?? { date, meals: [] };
      if (!days.includes(day)) days.push(day);
      for (const [slot, meal] of slotsForDate) {
        const index = day.meals.findIndex((m) => m.slot === slot);
        if (index >= 0) day.meals[index] = meal;
        else day.meals.push(meal);
      }
      day.meals.sort(bySlot);
    }
    if (foyerWeek) {
      await ctx.db.patch("householdMealPlans", foyerWeek._id, { days });
    } else {
      await ctx.db.insert("householdMealPlans", { householdId, weekStart: week, days });
    }
  }

  // Then out of every member's own plan: the slot is shared now, one dish only.
  for (const memberId of household.memberIds) {
    for (const [week, byDate] of winners) {
      const plan = await ctx.db
        .query("mealPlans")
        .withIndex("by_user_and_week", (q) => q.eq("userId", memberId).eq("weekStart", week))
        .unique();
      if (!plan) continue;
      const days = plan.days.map((day) => {
        const slotsToDrop = byDate.get(day.date);
        if (!slotsToDrop) return day;
        return { ...day, meals: day.meals.filter((m) => !slotsToDrop.has(m.slot)) };
      });
      await ctx.db.patch("mealPlans", plan._id, { days });
    }
  }
}

export const setSharedSlots = mutation({
  args: { slots: v.array(mealSlot) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");

    const wanted = new Set(args.slots);
    const slots = SLOT_ORDER.filter((slot) => wanted.has(slot));
    const removed = household.sharedSlots.filter((slot) => !wanted.has(slot));
    const added = slots.filter((slot) => !household.sharedSlots.includes(slot));

    // A slot that stops being shared must not orphan its meal: copy it into
    // BOTH members' own plans, each with their own portion, BEFORE unsharing.
    if (removed.length > 0) {
      const rows = await ctx.db
        .query("householdMealPlans")
        .withIndex("by_household_and_week", (q) => q.eq("householdId", household._id))
        .take(100); // ponytail: weeks of a two-person foyer. Paginate if it ever grows.
      for (const row of rows) {
        await adoptFoyerWeek(ctx, household, row, removed);
        const days = row.days.map((day) => ({
          ...day,
          meals: day.meals.filter((meal) => !removed.includes(meal.slot)),
        }));
        await ctx.db.patch("householdMealPlans", row._id, { days });
      }
    }

    // And a slot that starts being shared takes the meals already planned on
    // it INTO the foyer's week, so the routing and the display never disagree.
    if (added.length > 0) {
      await adoptOwnMealsIntoFoyer(ctx, household._id, added);
    }

    await ctx.db.patch("households", household._id, { sharedSlots: slots });
    return { sharedSlots: slots };
  },
});

export const leave = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");

    // Copy BEFORE delete: every shared meal becomes each member's own, with
    // their own portion, so both leave with a usable menu.
    const rows = await ctx.db
      .query("householdMealPlans")
      .withIndex("by_household_and_week", (q) => q.eq("householdId", household._id))
      .take(100); // ponytail: weeks of a two-person foyer. Paginate if it ever grows.
    for (const row of rows) {
      await adoptFoyerWeek(ctx, household, row, null);
      await ctx.db.delete("householdMealPlans", row._id);
    }
    // Both pointers die with the row — the invariant holds on both sides.
    for (const memberId of household.memberIds) {
      await ctx.db.patch("users", memberId, { householdId: undefined });
    }
    await ctx.db.delete("households", household._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Duels de recettes
// ---------------------------------------------------------------------------

/** Le repas du foyer au (date, créneau), ou un message qui dit pourquoi non. */
async function foyerMealAt(
  ctx: MutationCtx,
  household: Doc<"households">,
  weekStart: string,
  date: string,
  slot: MealSlot,
) {
  const plan = await householdPlanFor(ctx, household._id, weekStart);
  if (!plan) throw new Error("Aucun plan pour cette semaine");
  const day = plan.days.find((d) => d.date === date);
  const index = day?.meals.findIndex((m) => m.slot === slot) ?? -1;
  const meal = index >= 0 ? day!.meals[index] : undefined;
  if (!meal) throw new Error("Aucun repas prévu sur ce créneau");
  if (!meal.duel) throw new Error("Ce créneau n'est pas en duel");
  return { plan, day: day!, index, meal };
}

/**
 * Un vote par membre sur le duel du créneau : "a" = le plat en place, "b" = le
 * challenger. Un vote remplace le vote précédent du même membre. Quand les
 * deux ont voté : à l'unanimité le duel se tranche immédiatement, à votes
 * contraires il reste ouvert — la résolution (split ou chifoumi) vient ensuite.
 */
export const voteDuel = mutation({
  args: {
    weekStart: v.string(),
    date: v.string(),
    slot: mealSlot,
    choice: v.union(v.literal("a"), v.literal("b")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");

    const { plan, day, index, meal } = await foyerMealAt(
      ctx,
      household,
      args.weekStart,
      args.date,
      args.slot,
    );

    // Mon vote remplace le mien : deux membres, deux voix max.
    const votes = (meal.duelVotes ?? []).filter((vote) => vote.userId !== user._id);
    votes.push({ userId: user._id, choice: args.choice });
    meal.duelVotes = votes;

    const allVoted =
      household.memberIds.length === 2 &&
      household.memberIds.every((id) => votes.some((vote) => vote.userId === id));

    if (allVoted) {
      if (votes[0].choice === votes[1].choice) {
        const winner = votes[0].choice;
        day.meals[index] = applyDuelResolution(meal, winner);
        await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
        return { resolved: true, winner };
      }
      await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
      return { resolved: false };
    }

    await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
    return { resolved: null };
  },
});

/**
 * La résolution du duel quand les votes sont contraires.
 * - split : le plat quitte la semaine du foyer, chaque membre récupère le plat
 *   pour lequel il a voté dans SON plan, macros à portion seule, telles
 *   quelles.
 * - chifoumi : une pièce décide ; le gagnant s'applique exactement comme un
 *   vote unanime.
 */
export const resolveDuel = mutation({
  args: {
    weekStart: v.string(),
    date: v.string(),
    slot: mealSlot,
    mode: v.literal("split"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");

    const { plan, day, index, meal } = await foyerMealAt(
      ctx,
      household,
      args.weekStart,
      args.date,
      args.slot,
    );

    // Split : le repas sort de la semaine foyer, les jours vidés tombent.
    day.meals.splice(index, 1);
    const days = plan.days.filter((d) => d.meals.length > 0);
    if (days.length > 0) {
      await ctx.db.patch("householdMealPlans", plan._id, { days });
    } else {
      await ctx.db.delete("householdMealPlans", plan._id);
    }
    // Chacun chez soi : le plat voté atterrit dans le plan du membre, en
    // remplaçant le créneau, semaine/jour créés à la volée si besoin.
    for (const memberId of household.memberIds) {
      await adoptIntoMemberPlan(ctx, memberId, args.weekStart, [
        { date: args.date, meal: dueledMealFor(meal, memberId) },
      ]);
    }
    return { winner: null };
  },
});

/**
 * Chifoumi : chacun lance pierre / papier / ciseaux (icônes salle de sport),
 * les règles classiques tranchent. Égalité → les lancers tombent et on
 * relance. Sinon le gagnant du lancer impose LE PLAT POUR LEQUEL IL A VOTÉ.
 * Les deux doivent avoir voté avant de lancer.
 */
export const chifoumiThrow = mutation({
  args: {
    weekStart: v.string(),
    date: v.string(),
    slot: mealSlot,
    throw: v.union(v.literal("pierre"), v.literal("papier"), v.literal("ciseaux")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const household = await householdFor(ctx, user._id);
    if (!household) throw new Error("Tu n'es pas dans un foyer");

    const { plan, day, index, meal } = await foyerMealAt(
      ctx,
      household,
      args.weekStart,
      args.date,
      args.slot,
    );
    if (!meal.duelVotes || meal.duelVotes.length < 2) {
      throw new Error("Les deux doivent avoir voté avant le chifoumi");
    }

    const mine = meal.duelThrows?.filter((t) => t.userId !== user._id) ?? [];
    const throws = [...mine, { userId: user._id, throw: args.throw }];
    const partner = throws.find((t) => t.userId !== user._id);

    // Un seul lancer en piste : on attend le second.
    if (!partner) {
      day.meals[index] = { ...meal, duelThrows: throws };
      await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
      return { resolved: null, tied: false };
    }

    const result = chifoumiResult(partner.throw, args.throw);
    if (result === "draw") {
      // Égalité : les lancers tombent, le créneau redevient en attente de
      // lancers — les votes, eux, restent.
      const cleared = { ...meal };
      delete cleared.duelThrows;
      day.meals[index] = cleared;
      await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
      return { resolved: false, tied: true };
    }

    // Le membre dont le geste gagne impose le plat pour lequel il a voté.
    const winnerMemberId = result === "a" ? partner.userId : user._id;
    const winnerVote = meal.duelVotes.find((vote) => vote.userId === winnerMemberId)?.choice ?? "a";
    day.meals[index] = applyDuelResolution(meal, winnerVote);
    await ctx.db.patch("householdMealPlans", plan._id, { days: plan.days });
    return { resolved: true, winner: winnerVote, winnerMemberId };
  },
});
