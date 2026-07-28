import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import { recordPrs } from "./progress";
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

    return { workout, sets, day, dayIndex, prefill };
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
    await recordPrs(ctx, workout);
    return null;
  },
});
