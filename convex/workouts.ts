import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import { recordPrs, statsByExercise } from "./progress";
import { getCurrentUser, requireCurrentUser } from "./users";

/** A set row belongs to exactly one user; every set mutation routes through this. */
async function ownSet(ctx: MutationCtx, setId: Id<"sets">): Promise<Doc<"sets">> {
  const user = await requireCurrentUser(ctx);
  const set = await ctx.db.get("sets", setId);
  if (!set || set.userId !== user._id) throw new Error("Série introuvable");
  return set;
}

/**
 * Everything the séance screen needs for one day, in one subscription:
 * the prescription, the session (if started), its set rows, and the
 * weight/reps to prefill from the last time each exercise was done.
 *
 * `date` is an argument, not `Date.now()`, because queries don't rerun as the
 * clock advances — the client owns "today" in its own timezone.
 */
export const today = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    // Latest session overall: tells us both whether today's exists and which
    // program day comes next.
    const last = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    const workout = last?.date === args.date ? last : null;

    const program = user.currentProgramId
      ? await ctx.db.get("programs", user.currentProgramId)
      : null;

    // ponytail: program days cycle in order, one per session, no rest-day
    // calendar. Add a schedule when someone wants fixed weekdays.
    const dayCount = program?.days.length ?? 0;
    const dayIndex = !dayCount
      ? 0
      : workout
        ? (workout.dayIndex ?? 0)
        : last?.dayIndex === undefined
          ? 0
          : (last.dayIndex + 1) % dayCount;
    const day = program?.days[dayIndex] ?? null;

    const sets = workout
      ? await ctx.db
          .query("sets")
          .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
          .take(200)
      : [];

    // One lookup per exercise (~8 max per day), each hitting the index.
    //
    // An ARRAY, not a map keyed by exercise name: Convex field names must be
    // non-control ASCII, and every exercise here is French — "Développé couché"
    // as a key throws at serialisation. Values are fine, keys are not.
    const prefill: { name: string; weight: number; reps: number }[] = [];
    for (const exercise of day?.exercises ?? []) {
      const previous = await ctx.db
        .query("sets")
        .withIndex("by_user_and_exercise", (q) =>
          q.eq("userId", user._id).eq("exerciseName", exercise.name),
        )
        .order("desc")
        .filter((q) => q.eq(q.field("completed"), true))
        .first();
      if (previous) {
        prefill.push({ name: exercise.name, weight: previous.weight, reps: previous.reps });
      }
    }

    // The records this session broke. They come from the row and not from
    // `finish`'s return value, because the finished screen renders again after a
    // reload, when that value is long gone.
    const prs =
      workout?.endedAt === undefined
        ? []
        : (
            await ctx.db
              .query("prs")
              .withIndex("by_user_and_date", (q) =>
                q.eq("userId", user._id).eq("date", workout.date),
              )
              .take(50)
          ).filter((pr) => pr.workoutId === workout._id);

    return { workout, sets, day, dayIndex, prefill, prs };
  },
});

// ponytail: newest 30 séances, each with its sets. Paginate when someone wants
// to scroll further back than that.
const HISTORY_LIMIT = 30;

/**
 * Past séances, plus the names of the current program's days so the screen can
 * show what comes after today. Separate from `today` because `today` is
 * resubscribed on every set check-off and must not pay for this.
 *
 * `date` is an argument for the same reason as in `today`, and it bounds the
 * list to strictly before it — today's séance is the one being started.
 */
export const history = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const workouts = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).lt("date", args.date))
      .order("desc")
      .take(HISTORY_LIMIT);

    // A séance's day name must come from the program THAT séance used: programs
    // are versioned and regenerated, so an old dayIndex read against today's
    // program silently renames the séance. Cached because a run of séances
    // shares one program.
    const cache = new Map<Id<"programs">, Doc<"programs"> | null>();
    const programFor = async (id: Id<"programs">) => {
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      const program = await ctx.db.get("programs", id);
      cache.set(id, program);
      return program;
    };

    // Oldest date in the list is enough of a floor; rows above it that belong to
    // no listed séance just never match.
    const prWorkouts = new Set(
      (
        await ctx.db
          .query("prs")
          .withIndex("by_user_and_date", (q) =>
            q.eq("userId", user._id).gte("date", workouts.at(-1)?.date ?? args.date),
          )
          .take(200)
      ).map((pr) => pr.workoutId),
    );

    const past = [];
    for (const workout of workouts) {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
        .take(200);

      let volume = 0;
      for (const stat of statsByExercise(sets).values()) volume += stat.volume;

      let done = 0;
      const byExercise = new Map<string, { weight: number; reps: number }[]>();
      for (const set of sets) {
        if (!set.completed) continue;
        done += 1;
        const rows = byExercise.get(set.exerciseName) ?? [];
        rows.push({ weight: set.weight, reps: set.reps });
        byExercise.set(set.exerciseName, rows);
      }

      const program = workout.programId ? await programFor(workout.programId) : null;
      past.push({
        id: workout._id,
        date: workout.date,
        // No program link at all: it came from a screenshot import, and there is
        // no day to name rather than a day whose name we lost.
        imported: workout.programId === undefined,
        dayName:
          (workout.dayIndex === undefined
            ? undefined
            : program?.days[workout.dayIndex]?.name) ?? null,
        sets: done,
        volume: Math.round(volume),
        pr: prWorkouts.has(workout._id),
        exercises: [...byExercise].map(([name, rows]) => ({ name, sets: rows })),
      });
    }

    const current = user.currentProgramId ? await programFor(user.currentProgramId) : null;
    return { dayNames: current?.days.map((day) => day.name) ?? [], past };
  },
});

/**
 * Starts (or resumes) today's session and writes the prescribed set rows up
 * front, so each check-off afterwards is a single small patch.
 */
export const start = mutation({
  args: {
    date: v.string(),
    dayIndex: v.number(),
    sets: v.array(
      v.object({
        exerciseName: v.string(),
        index: v.number(),
        weight: v.number(),
        reps: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const existing = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .first();
    if (existing) return existing._id;

    const workoutId = await ctx.db.insert("workouts", {
      userId: user._id,
      programId: user.currentProgramId,
      dayIndex: args.dayIndex,
      date: args.date,
      startedAt: Date.now(),
    });
    for (const set of args.sets) {
      await ctx.db.insert("sets", { ...set, workoutId, userId: user._id, completed: false });
    }
    return workoutId;
  },
});

/** One set check-off (or correction): the smallest write in the app. */
export const logSet = mutation({
  args: {
    setId: v.id("sets"),
    completed: v.boolean(),
    weight: v.number(),
    reps: v.number(),
  },
  handler: async (ctx, args) => {
    const set = await ownSet(ctx, args.setId);
    await ctx.db.patch("sets", set._id, {
      completed: args.completed,
      weight: args.weight,
      reps: args.reps,
    });
    return null;
  },
});

/** Extra set beyond the prescription — appended at the end of the exercise. */
export const addSet = mutation({
  args: {
    workoutId: v.id("workouts"),
    exerciseName: v.string(),
    index: v.number(),
    weight: v.number(),
    reps: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const workout = await ctx.db.get("workouts", args.workoutId);
    if (!workout || workout.userId !== user._id) throw new Error("Séance introuvable");
    return await ctx.db.insert("sets", {
      workoutId: workout._id,
      userId: user._id,
      exerciseName: args.exerciseName,
      index: args.index,
      weight: args.weight,
      reps: args.reps,
      completed: false,
    });
  },
});

/** Closes the session. Unchecked sets stay as they are — they just weren't done. */
export const finish = mutation({
  args: { workoutId: v.id("workouts"), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const workout = await ctx.db.get("workouts", args.workoutId);
    if (!workout || workout.userId !== user._id) throw new Error("Séance introuvable");
    await ctx.db.patch("workouts", workout._id, { endedAt: Date.now(), notes: args.notes });
    // Records are written here, once, so /progres only ever reads them.
    return await recordPrs(ctx, workout);
  },
});
