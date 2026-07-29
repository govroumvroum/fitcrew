import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { QueryCtx, mutation, query } from "./_generated/server";
import { SetLite, currentStreak, statsByExercise, weekStart, weeklyBuckets } from "./progress";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure logic. No ctx, no clock — see src/components/crew/crew.check.ts.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export type ChallengeMetric = "sessions" | "volume" | "max_reps" | "max_weight" | "est_1rm";

/**
 * One participant's standing in a challenge, from their sets over the week.
 *
 * Everything but `sessions` folds through `statsByExercise` for the challenge's
 * one exercise, so unchecked sets never count and the maths matches /progres.
 * `max_reps` reads `bodyweightReps` for the same reason `prCandidates` does —
 * reps mean nothing with weight on the bar — which is what makes "most
 * pull-ups this week" a real contest instead of a curl-with-1kg contest.
 */
export function scoreChallenge(
  metric: ChallengeMetric,
  exerciseName: string | undefined,
  sets: SetLite[],
  sessions: number,
): number {
  if (metric === "sessions") return sessions;
  if (!exerciseName) return 0;
  const stat = statsByExercise(sets).get(exerciseName);
  if (!stat) return 0;
  switch (metric) {
    case "volume":
      return Math.round(stat.volume);
    case "max_reps":
      return stat.bodyweightReps;
    case "max_weight":
      return stat.maxWeight;
    case "est_1rm":
      return stat.est1rm;
  }
}

/** `days` from a YYYY-MM-DD key, still a YYYY-MM-DD key. UTC so DST can't shift it. */
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

// ponytail: the crew is four people, so "everyone" is one bounded read. Paginate
// the leaderboard if this ever becomes a product with strangers in it.
const CREW_SIZE = 20;

const crew = (ctx: QueryCtx) => ctx.db.query("users").take(CREW_SIZE);

/** Every workout in range plus its sets, per user. ~5 séances x 1 index read. */
async function weekWork(ctx: QueryCtx, userId: Id<"users">, from: string, to: string) {
  const workouts = await ctx.db
    .query("workouts")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
    .take(50);

  const sets: SetLite[] = [];
  for (const workout of workouts) {
    sets.push(
      ...(await ctx.db
        .query("sets")
        .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
        .take(200)),
    );
  }
  return { workouts, sets };
}

/**
 * The crew leaderboard: consistency and PRs, one row per member.
 *
 * Deliberately NO total-volume column. The issue struck "volume king" out as too
 * easy to game — different programs make it a measure of exercise selection, not
 * effort. Volume survives only as an opt-in challenge metric, where everyone
 * agreed on the same exercise first. Don't "helpfully" add the column back.
 *
 * `from`/`to` are arguments, not `Date.now()` — a query doesn't rerun because
 * the clock moved, and the client owns "today" in its own timezone.
 */
export const leaderboard = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const rows = [];
    for (const member of await crew(ctx)) {
      const workouts = await ctx.db
        .query("workouts")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", member._id).gte("date", args.from).lte("date", args.to),
        )
        .take(200);

      // Only workout headers are read here, so there is no volume to bucket — the
      // zero is what weeklyBuckets wants as input, and only `sessions` comes back
      // out. Sessions per week is the consistency metric the issue asked for.
      const weeks = weeklyBuckets(
        workouts.map((workout) => ({ date: workout.date, volume: 0 })),
        args.from,
        args.to,
      );

      // Baselines excluded: a first-ever performance broke no record, so counting
      // them would put whoever logged the most new exercises on top.
      const prs = await ctx.db
        .query("prs")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", member._id).gte("date", args.from).lte("date", args.to),
        )
        .take(500);

      rows.push({
        userId: member._id,
        name: member.name,
        avatarUrl: member.avatarUrl,
        sessions: workouts.length,
        streak: currentStreak(weeks),
        prCount: prs.filter((pr) => !pr.baseline).length,
        weeks: weeks.map((week) => week.sessions),
      });
    }
    return rows;
  },
});

/**
 * "X just hit a PR on développé couché", newest first.
 *
 * There is no index on `prs.date` alone and there shouldn't be: one query per
 * crew member on `by_user_and_date` desc, merged in memory, is 4 index reads
 * instead of a table scan.
 */
export const feed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const limit = args.limit ?? 20;

    const rows = [];
    for (const member of await crew(ctx)) {
      // ponytail: takes 50 per member to find the non-baselines among them — a
      // first session writes one baseline per exercise per type, so the newest
      // rows are mostly baselines.
      const prs = await ctx.db
        .query("prs")
        .withIndex("by_user_and_date", (q) => q.eq("userId", member._id))
        .order("desc")
        .take(50);

      for (const pr of prs) {
        if (pr.baseline) continue;
        rows.push({
          _id: pr._id,
          userId: member._id,
          name: member.name,
          avatarUrl: member.avatarUrl,
          exerciseName: pr.exerciseName,
          type: pr.type,
          value: pr.value,
          date: pr.date,
          at: pr._creationTime,
        });
      }
    }
    // `date` is day-granular, so two PRs from the same session would order
    // arbitrarily — _creationTime breaks the tie in the order they were written.
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, limit);
  },
});

/**
 * Every exercise the crew has ever logged, so the create form is a picker and
 * not a text field. Scoring matches `exerciseName` exactly — a typo would score
 * the whole challenge 0 and look like nobody trained.
 *
 * Read off `prs`, not `sets`: `recordPrs` writes a baseline row the first time
 * anyone touches an exercise, so this table already holds the distinct names and
 * it's a fraction of the size.
 */
export const exerciseNames = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const names = new Set<string>();
    for (const member of await crew(ctx)) {
      const prs = await ctx.db
        .query("prs")
        .withIndex("by_user_and_exercise", (q) => q.eq("userId", member._id))
        .take(1000);
      for (const pr of prs) names.add(pr.exerciseName);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "fr"));
  },
});

/** The week's challenges with standings already sorted, so the UI just renders. */
export const challenges = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const members = new Map((await crew(ctx)).map((member) => [member._id, member]));
    const rows = await ctx.db
      .query("challenges")
      .withIndex("by_week", (q) => q.eq("weekStart", args.weekStart))
      .take(20);

    const out = [];
    for (const challenge of rows) {
      // Scored over the challenge's own week, never the leaderboard's window.
      const to = shift(challenge.weekStart, 6);
      const standings = [];
      for (const participantId of challenge.participants) {
        const member = members.get(participantId);
        if (!member) continue; // left the crew
        const { workouts, sets } = await weekWork(ctx, participantId, challenge.weekStart, to);
        standings.push({
          userId: participantId,
          name: member.name,
          avatarUrl: member.avatarUrl,
          score: scoreChallenge(challenge.metric, challenge.exerciseName, sets, workouts.length),
        });
      }
      out.push({
        _id: challenge._id,
        title: challenge.title,
        weekStart: challenge.weekStart,
        metric: challenge.metric,
        exerciseName: challenge.exerciseName,
        createdBy: challenge.createdBy,
        joined: challenge.participants.includes(user._id),
        standings: standings.sort((a, b) => b.score - a.score),
      });
    }
    return out;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    weekStart: v.string(),
    metric: v.union(
      v.literal("sessions"),
      v.literal("volume"),
      v.literal("max_reps"),
      v.literal("max_weight"),
      v.literal("est_1rm"),
    ),
    exerciseName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // Any other day would silently score a window nobody agreed on, and the
    // by_week index would never find it.
    if (weekStart(args.weekStart) !== args.weekStart) {
      throw new Error("weekStart must be a Monday");
    }
    // Fairness: comparing "most volume" across a boxer's and a bodybuilder's
    // whole programs measures exercise selection, not effort.
    if (args.metric !== "sessions" && !args.exerciseName) {
      throw new Error("exerciseName is required for this metric");
    }

    // You don't open a challenge you're not in.
    return await ctx.db.insert("challenges", {
      ...args,
      createdBy: user._id,
      participants: [user._id],
    });
  },
});

/** The whole opt-in mechanism: membership in `participants` is the entry. */
export const toggleJoin = mutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const challenge = await ctx.db.get("challenges", args.challengeId);
    if (!challenge) throw new Error("Challenge not found");

    const joined = challenge.participants.includes(user._id);
    await ctx.db.patch("challenges", challenge._id, {
      participants: joined
        ? challenge.participants.filter((id) => id !== user._id)
        : [...challenge.participants, user._id],
    });
    return !joined;
  },
});
