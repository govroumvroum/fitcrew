import { v } from "convex/values";
import { query } from "./_generated/server";
import { currentStreak, statsByExercise, weekStart, weeklyBuckets } from "./progress";
import { getCurrentUser } from "./users";

const DAY = 86_400_000;

/** `days` from a YYYY-MM-DD key, still a YYYY-MM-DD key. UTC so DST can't shift it. */
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// ponytail: newest 100 sessions, headers only — enough streak history for ~a
// year of training. Pre-aggregate per week if someone outgrows it.
const MAX_WORKOUTS = 100;

/**
 * The homepage tiles and its podium, in one subscription. Deliberately does not
 * cover the hero: `workouts.today` already returns exactly that (and owns the
 * program-day cycling logic), so the hero reuses it instead of forking it.
 *
 * `date` is an argument, not `Date.now()` — queries don't rerun as the clock
 * advances, the client owns "today" in its own timezone.
 */
export const stats = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const workouts = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).lte("date", args.date))
      .order("desc")
      .take(MAX_WORKOUTS);

    // Sets are only read for the last 7 days — the tile is a week, not a year.
    const since = shift(args.date, -6);
    let volume7d = 0;
    for (const workout of workouts) {
      if (workout.date < since) break; // desc order: everything after is older
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
        .take(200);
      for (const stat of statsByExercise(sets).values()) volume7d += stat.volume;
    }

    const week = weekStart(args.date);
    const oldest = workouts.at(-1)?.date ?? args.date;
    const weeks = weeklyBuckets(
      workouts.map((workout) => ({ date: workout.date, volume: 0 })),
      oldest,
      args.date,
    );

    const prs = await ctx.db
      .query("prs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(3);

    const cardio7d = await ctx.db
      .query("cardio")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).gte("date", since).lte("date", args.date),
      )
      .take(50);

    // Whether to show a cardio tile at all. Someone who never does cardio
    // shouldn't stare at a permanent 0; someone who does deserves to see a zero
    // week, which is real information.
    const doesCardio =
      cardio7d.length > 0 ||
      (await ctx.db
        .query("cardio")
        .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
        .first()) !== null;

    // Two, not one: the delta is the interesting half of a weigh-in.
    const measures = await ctx.db
      .query("bodyweight")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).lte("date", args.date))
      .order("desc")
      .take(2);
    const [latest, previous] = measures;

    return {
      // Lets the client omit the tiles entirely rather than show a row of zeros.
      hasHistory: workouts.length > 0 || doesCardio || measures.length > 0,
      streak: currentStreak(weeks),
      thisWeek: workouts.filter((workout) => workout.date >= week).length,
      // A month is comfortably inside MAX_WORKOUTS, unlike an all-time count.
      thisMonth: workouts.filter((workout) => workout.date >= args.date.slice(0, 7)).length,
      volume7d: Math.round(volume7d),
      doesCardio,
      cardio7d: {
        sessions: cardio7d.length,
        minutes: cardio7d.reduce((sum, entry) => sum + (entry.durationMin ?? 0), 0),
      },
      measure: latest
        ? {
            date: latest.date,
            weightKg: latest.weightKg,
            bodyFatPct: latest.bodyFatPct,
            // Only against a previous row that measured the same thing.
            deltaKg:
              latest.weightKg !== undefined && previous?.weightKg !== undefined
                ? Math.round((latest.weightKg - previous.weightKg) * 10) / 10
                : undefined,
          }
        : null,
      prs: prs.map(({ exerciseName, type, value, date }) => ({
        exerciseName,
        type,
        value,
        date,
      })),
    };
  },
});
