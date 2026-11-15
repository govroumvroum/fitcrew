import { Doc } from "./_generated/dataModel";
import { QueryCtx, mutation, query } from "./_generated/server";
import { type Facts, type StepKey, isNewcomer, stepsDone } from "./firstSteps";
import { getCurrentUser, requireCurrentUser } from "./users";

// ponytail: the crew opens 2 or 3 défis a week, so 100 is well over a year of
// them. There is no index by participant, and a 4-person crew doesn't need one.
const RECENT_CHALLENGES = 100;
// Enough to find a finished séance behind a few abandoned ones.
const RECENT_WORKOUTS = 20;

async function factsFor(ctx: QueryCtx, user: Doc<"users">): Promise<Facts> {
  const userId = user._id;

  const program = await ctx.db
    .query("programs")
    .withIndex("by_user_and_lineage", (q) => q.eq("userId", userId))
    .first();

  const workouts = await ctx.db
    .query("workouts")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
    .order("desc")
    .take(RECENT_WORKOUTS);

  const week = await ctx.db
    .query("weekTemplates")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  const cardio = await ctx.db
    .query("cardio")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
    .first();
  const bodyweight = cardio
    ? null
    : await ctx.db
        .query("bodyweight")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
        .first();

  const challenges = await ctx.db
    .query("challenges")
    .withIndex("by_week")
    .order("desc")
    .take(RECENT_CHALLENGES);

  const nutrition = await ctx.db
    .query("nutritionProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  return {
    welcomedAt: user.welcomedAt,
    dismissedAt: user.firstStepsDismissedAt,
    installedAt: user.installedAt,
    hasCoachProfile: user.onboarding !== undefined,
    hasProgram: program !== null,
    hasWorkout: workouts.length > 0,
    hasFinishedWorkout: workouts.some((workout) => workout.endedAt !== undefined),
    hasWeek: (week?.entries.length ?? 0) > 0,
    hasMeasure: cardio !== null || bodyweight !== null,
    inCrew: challenges.some(
      (challenge) => challenge.createdBy === userId || challenge.participants.includes(userId),
    ),
    hasNutrition: nutrition !== null,
  };
}

/**
 * The home screen's onboarding state, in one subscription: whether to greet
 * this user, and which first steps are done. Labels and links live in the
 * client; this only says what the data says.
 */
export const state = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ welcome: boolean; dismissed: boolean; done: Record<StepKey, boolean> } | null> => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const facts = await factsFor(ctx, user);
    return {
      welcome: isNewcomer(facts),
      dismissed: facts.dismissedAt !== undefined,
      done: stepsDone(facts),
    };
  },
});

/** Finished or skipped: either way it is never shown again, on any device. */
export const finish = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    if (user.welcomedAt === undefined) {
      await ctx.db.patch("users", user._id, { welcomedAt: Date.now() });
    }
    return null;
  },
});

export const dismissFirstSteps = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    if (user.firstStepsDismissedAt === undefined) {
      await ctx.db.patch("users", user._id, { firstStepsDismissedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Called by the client when it finds itself running as an installed app. A
 * claim, not a proof — but the worst a lie buys is one ticked box on your own
 * card.
 */
export const markInstalled = mutation({
  args: {},
  handler: async (ctx) => {
    // Not `requireCurrentUser`: on a first launch this can race `users.store`.
    const user = await getCurrentUser(ctx);
    if (user && user.installedAt === undefined) {
      await ctx.db.patch("users", user._id, { installedAt: Date.now() });
    }
    return null;
  },
});
