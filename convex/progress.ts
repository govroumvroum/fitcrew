import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { MutationCtx, query } from "./_generated/server";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure logic. No ctx, no clock — see src/components/progress/progress.check.ts.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export type SetLite = {
  exerciseName: string;
  weight: number;
  reps: number;
  completed: boolean;
};
export type PrType = "max_weight" | "max_reps" | "max_volume" | "est_1rm";

/**
 * Beyond this, Epley is fiction — it treats 30 reps as double your 1RM. A high-rep
 * set is a conditioning set and has no business claiming a strength record.
 */
const EPLEY_MAX_REPS = 15;

/** Epley. Rounded to the kilo: a 1RM estimate with decimals is false precision. */
export function epley1rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return Math.round(weight * (1 + reps / 30));
}

export type ExerciseStat = {
  maxWeight: number;
  maxReps: number;
  volume: number;
  est1rm: number;
  /**
   * Best reps from an UNLOADED set only. Reps alone say nothing when there's
   * weight on the bar — 50 reps at 1 kg would outrank 8 at 80 — but for pull-ups
   * and dips, where weight is 0, reps are the whole story.
   */
  bodyweightReps: number;
};

/**
 * One session's sets folded per exercise. Sets that weren't checked off never
 * count — an unchecked set is a set that didn't happen.
 */
export function statsByExercise(sets: SetLite[]): Map<string, ExerciseStat> {
  const out = new Map<string, ExerciseStat>();
  for (const set of sets) {
    if (!set.completed || set.reps <= 0) continue;
    const stat = out.get(set.exerciseName) ?? {
      maxWeight: 0,
      maxReps: 0,
      volume: 0,
      est1rm: 0,
      bodyweightReps: 0,
    };
    stat.maxWeight = Math.max(stat.maxWeight, set.weight);
    stat.maxReps = Math.max(stat.maxReps, set.reps);
    stat.volume += set.weight * set.reps;
    if (set.reps <= EPLEY_MAX_REPS) {
      stat.est1rm = Math.max(stat.est1rm, epley1rm(set.weight, set.reps));
    }
    if (set.weight === 0) stat.bodyweightReps = Math.max(stat.bodyweightReps, set.reps);
    out.set(set.exerciseName, stat);
  }
  return out;
}

/**
 * What this session could have broken. Zero values are dropped, so bodyweight
 * work (weight 0) competes on reps only and never claims a 0 kg record.
 */
export function prCandidates(
  sets: SetLite[],
): { exerciseName: string; type: PrType; value: number }[] {
  const out: { exerciseName: string; type: PrType; value: number }[] = [];
  for (const [exerciseName, stat] of statsByExercise(sets)) {
    const byType: [PrType, number][] = [
      ["max_weight", stat.maxWeight],
      // Strength across rep ranges, so 8×80 outranks 12×70 and neither is
      // threatened by 50×1. This is the record that actually means "stronger".
      ["est_1rm", stat.est1rm],
      // Unloaded sets only — see ExerciseStat.bodyweightReps. A loaded exercise
      // never claims a reps record, because reps without weight rank nothing.
      ["max_reps", stat.bodyweightReps],
      // ponytail: inflatable by adding sets — it's a workload record, not a
      // strength one. Weight it per set if that ever reads as cheating.
      ["max_volume", Math.round(stat.volume)],
    ];
    for (const [type, value] of byType) {
      if (value > 0) out.push({ exerciseName, type, value });
    }
  }
  return out;
}

/**
 * Which program day comes next, from the user's newest séance alone.
 *
 * ponytail: program days cycle in order, one per séance, no rest-day calendar.
 * Add a schedule when someone wants fixed weekdays.
 *
 * Today's séance already picked its day, so it answers for itself; otherwise the
 * last one hands over to the following day and wraps past the last. Shared by
 * `workouts.today` and `programs.current` so the two screens can't disagree.
 */
export function nextDayIndex(
  dayCount: number,
  last: { date: string; dayIndex?: number } | null,
  date: string,
): number {
  if (!dayCount) return 0;
  if (last?.date === date) return last.dayIndex ?? 0;
  // No dayIndex at all: nothing has been followed yet (or the last séance was an
  // import), so start at the top.
  if (last?.dayIndex === undefined) return 0;
  return (last.dayIndex + 1) % dayCount;
}

/** `days` from a YYYY-MM-DD key, still a YYYY-MM-DD key. UTC so DST can't shift it. */
export const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Monday of the week containing `date` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function weekStart(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  const shift = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - shift * DAY).toISOString().slice(0, 10);
}

/**
 * Dense weekly buckets: a week with no session is a zero, not a hole. Charts
 * then show the gap instead of interpolating across it.
 */
export function weeklyBuckets(
  sessions: { date: string; volume: number }[],
  from: string,
  to: string,
): { week: string; volume: number; sessions: number }[] {
  const byWeek = new Map<string, { volume: number; sessions: number }>();
  for (const session of sessions) {
    const key = weekStart(session.date);
    const bucket = byWeek.get(key) ?? { volume: 0, sessions: 0 };
    bucket.volume += session.volume;
    bucket.sessions += 1;
    byWeek.set(key, bucket);
  }

  const out: { week: string; volume: number; sessions: number }[] = [];
  const end = Date.parse(`${weekStart(to)}T00:00:00Z`);
  for (let time = Date.parse(`${weekStart(from)}T00:00:00Z`); time <= end; time += 7 * DAY) {
    const week = new Date(time).toISOString().slice(0, 10);
    out.push({ week, ...(byWeek.get(week) ?? { volume: 0, sessions: 0 }) });
  }
  return out;
}

/**
 * Consecutive trailing weeks with at least `min` sessions. The last bucket is
 * the current, unfinished week — an empty one pauses the streak rather than
 * killing it.
 */
export function currentStreak(weeks: { sessions: number }[], min = 1): number {
  let i = weeks.length - 1;
  if (i >= 0 && weeks[i].sessions < min) i -= 1;
  let streak = 0;
  for (; i >= 0 && weeks[i].sessions >= min; i -= 1) streak += 1;
  return streak;
}

/** Highest value per exercise+type. Records only ever go up, so max is the record. */
export function bestPrs<T extends { exerciseName: string; type: PrType; value: number }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.exerciseName}|${row.type}`;
    const current = best.get(key);
    if (!current || row.value > current.value) best.set(key, row);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

/**
 * Called from `workouts.finish`, so a PR read is a lookup and never a scan of
 * every set ever logged. Idempotent: re-finishing a session ties its own
 * records and a tie is not a record — hence an empty list the second time.
 */
export async function recordPrs(
  ctx: MutationCtx,
  workout: Doc<"workouts">,
): Promise<{ exerciseName: string; type: PrType; value: number }[]> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
    .take(200);

  // ponytail: reads the user's whole PR history (a few rows per exercise) to
  // find the standing records. Narrow to by_user_and_exercise per candidate if
  // someone ever logs hundreds of exercises.
  const history = await ctx.db
    .query("prs")
    .withIndex("by_user_and_exercise", (q) => q.eq("userId", workout.userId))
    .take(1000);
  const standing = new Map(
    bestPrs(history).map((pr) => [`${pr.exerciseName}|${pr.type}`, pr.value]),
  );

  const broken: { exerciseName: string; type: PrType; value: number }[] = [];
  for (const candidate of prCandidates(sets)) {
    const previous = standing.get(`${candidate.exerciseName}|${candidate.type}`);
    if (previous !== undefined && candidate.value <= previous) continue;
    const baseline = previous === undefined;
    await ctx.db.insert("prs", {
      userId: workout.userId,
      exerciseName: candidate.exerciseName,
      type: candidate.type,
      value: candidate.value,
      date: workout.date,
      workoutId: workout._id,
      ...(baseline && { baseline: true }),
    });
    if (!baseline) broken.push(candidate);
  }
  return broken;
}

// ponytail: newest 150 sessions in range (~a year of training). Paginate or
// pre-aggregate per week if someone's history outgrows that.
const MAX_WORKOUTS = 150;

/**
 * Everything /progres draws, in one subscription. `from`/`to` are arguments,
 * not `Date.now()` — a query doesn't rerun because the clock moved.
 */
export const overview = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const workouts = (
      await ctx.db
        .query("workouts")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", user._id).gte("date", args.from).lte("date", args.to),
        )
        .order("desc")
        .take(MAX_WORKOUTS)
    ).reverse();

    // Imported from screenshots, never from a logged session: no sets, so these
    // sit outside `sessions` and the volume maths entirely.
    // ponytail: written out twice rather than behind a generic helper — a
    // parameterised table name loses the index types.
    const cardio = await ctx.db
      .query("cardio")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).gte("date", args.from).lte("date", args.to),
      )
      .order("desc")
      .take(100);

    const weights = await ctx.db
      .query("bodyweight")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).gte("date", args.from).lte("date", args.to),
      )
      .order("desc")
      .take(100);

    const prs = bestPrs(
      await ctx.db
        .query("prs")
        .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(500),
    ).sort((a, b) => b.date.localeCompare(a.date));
    const prWorkouts = new Set(prs.map((pr) => pr.workoutId));

    const sessions: {
      date: string;
      volume: number;
      sets: number;
      pr: boolean;
    }[] = [];
    const exercises = new Map<
      string,
      { date: string; maxWeight: number; volume: number; est1rm: number }[]
    >();

    for (const workout of workouts) {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
        .take(200);

      let volume = 0;
      let done = 0;
      for (const [name, stat] of statsByExercise(sets)) {
        volume += stat.volume;
        const points = exercises.get(name) ?? [];
        points.push({
          date: workout.date,
          maxWeight: stat.maxWeight,
          volume: Math.round(stat.volume),
          est1rm: stat.est1rm,
        });
        exercises.set(name, points);
      }
      for (const set of sets) if (set.completed) done += 1;

      sessions.push({
        date: workout.date,
        volume: Math.round(volume),
        sets: done,
        pr: prWorkouts.has(workout._id),
      });
    }

    // "All time" starts at the first session, not at the epoch, or the weekly
    // chart would be thousands of empty bars wide.
    const from = sessions.length && sessions[0].date > args.from ? sessions[0].date : args.from;
    const weeks = weeklyBuckets(sessions, from, args.to);

    return {
      sessions,
      weeks,
      streak: currentStreak(weeks),
      totalVolume: sessions.reduce((sum, session) => sum + session.volume, 0),
      exercises: [...exercises.entries()]
        .map(([name, points]) => ({ name, points }))
        .sort((a, b) => b.points.length - a.points.length),
      prs,
      cardio,
      weights,
    };
  },
});
