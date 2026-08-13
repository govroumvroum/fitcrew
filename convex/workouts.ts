import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import { latestPerLineage, lineageOf, lineageRows, nextDayIndexFor, prefillFor } from "./programs";
import { lastInLineage, recordPrs, statsByExercise } from "./progress";
import { getCurrentUser, requireCurrentUser } from "./users";

/** A set row belongs to exactly one user; every set mutation routes through this. */
async function ownSet(ctx: MutationCtx, setId: Id<"sets">): Promise<Doc<"sets">> {
  const user = await requireCurrentUser(ctx);
  const set = await ctx.db.get("sets", setId);
  if (!set || set.userId !== user._id) throw new Error("Série introuvable");
  return set;
}

/**
 * The séance the screen is on, out of today's rows (newest first).
 *
 * A row with no `programId` — the Coach's retroactive log, a screenshot import —
 * is never it: there is no prescription to render and nothing ever calls
 * `finish` on one, so treating it as "in progress" wedges /seance for the rest
 * of the day. Those rows are history, and `history` shows them.
 *
 * Of what's left, an unfinished séance is what the user is doing right now;
 * otherwise the last one finished today, so the récap and its records survive a
 * reload.
 */
export function sessionOf<T extends { programId?: string; endedAt?: number }>(
  todays: T[],
): T | null {
  const rows = todays.filter((w) => w.programId !== undefined);
  return rows.find((w) => w.endedAt === undefined) ?? rows[0] ?? null;
}

/**
 * The séance in progress, if there is one: its prescription, its set rows, and
 * the weight/reps to prefill from the last time each exercise was done.
 *
 * Programs run in parallel, so there is no "today's séance" to derive from a
 * selection — `workout: null` means nothing is running and the client picks a
 * program from `programs.list`. The day shown is the one the RUNNING séance
 * chose, read back off the row.
 *
 * `date` is an argument, not `Date.now()`, because queries don't rerun as the
 * clock advances — the client owns "today" in its own timezone.
 */
export const today = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    // Today's séances, newest first — two programs can both be trained in a day.
    const todays = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .order("desc")
      .take(10);
    const workout = sessionOf(todays);

    const program = workout?.programId ? await ctx.db.get("programs", workout.programId) : null;

    const dayIndex = workout?.dayIndex ?? 0;
    const day = program?.days[dayIndex] ?? null;

    const sets = workout
      ? await ctx.db
          .query("sets")
          .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
          .take(200)
      : [];

    // Same lookup `programs.list` seeds the picker with — one helper, so the
    // running séance and the one about to start can't disagree on the numbers.
    const prefill = await prefillFor(ctx, user._id, day?.exercises ?? []);

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
          ).filter((pr) => pr.workoutId === workout._id && !pr.baseline);

    return {
      workout,
      sets,
      day,
      programName: program?.name ?? null,
      prefill,
      prs,
    };
  },
});

// ponytail: newest 30 séances, each with its sets. Paginate when someone wants
// to scroll further back than that.
const HISTORY_LIMIT = 30;

/**
 * Past séances, each named by the program it followed. Separate from `today`
 * because `today` is resubscribed on every set check-off and must not pay for
 * this.
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
          (workout.dayIndex === undefined ? undefined : program?.days[workout.dayIndex]?.name) ??
          null,
        programName: program?.name ?? null,
        sets: done,
        volume: Math.round(volume),
        pr: prWorkouts.has(workout._id),
        exercises: [...byExercise].map(([name, rows]) => ({ name, sets: rows })),
      });
    }

    // No `dayNames` any more: "what comes after today" is per program now, and
    // `programs.list` answers it with each program's own next day.
    return { past };
  },
});

/**
 * Starts (or resumes) a session of ONE program and writes the prescribed set
 * rows up front, so each check-off afterwards is a single small patch.
 *
 * The program is named explicitly — with programs running in parallel, nothing
 * on the user row could tell us which one this séance is. `dayIndex` is derived
 * here rather than trusted from the client: it's that program's own rotation,
 * and there's no reason for two answers to it.
 *
 * `programId` absent = a séance attached to no program (a retroactive log, an
 * import). Those keep no day and don't move any rotation.
 */
export const start = mutation({
  args: {
    date: v.string(),
    programId: v.optional(v.id("programs")),
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

    const program = args.programId ? await ctx.db.get("programs", args.programId) : null;
    if (args.programId && program?.userId !== user._id) throw new Error("Programme introuvable");

    // Same day AND same program: training musculation then boxing on a Tuesday
    // is two séances, not a duplicate.
    const todays = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .order("desc")
      .take(10);
    // "Same program" means same LINEAGE, not same row id: a coach swap committed
    // after the card rendered leaves the client holding a superseded version's
    // id, while today's séance is stamped with the version it was started from.
    // Matching ids exactly would create a duplicate séance. Reading the lineage
    // range here also keeps the OCC protection `lineageRows` documents, and the
    // rows feed the `currentProgramId` stamp below. `todays` is newest-first so
    // a same-lineage duplicate already created before this fix dedupes to the
    // most recent séance, same preference as `today`. A séance already FINISHED
    // today for this lineage also matches — deliberate, unchanged: returning
    // its id lands the user back on the récap instead of a second séance.
    //
    // `lineageOf(program)` covers the unbackfilled fallback: a row with no
    // `lineageId` is its own lineage, and it's the same value as `program._id`.
    const rows = program
      ? await lineageRows(ctx, user._id, lineageOf(program) as Id<"programs">)
      : [];
    const lineage = new Set<string>([...(program ? [lineageOf(program)] : []), ...rows.map((row) => row._id)]);
    const existing = program
      ? lastInLineage(todays, lineage)
      : todays.find((w) => w.programId === undefined);
    if (existing) return existing._id;

    const workoutId = await ctx.db.insert("workouts", {
      userId: user._id,
      ...(program && {
        programId: program._id,
        dayIndex: await nextDayIndexFor(ctx, program, args.date, lineage),
      }),
      date: args.date,
      startedAt: Date.now(),
    });
    // Not a selection — the Coach and the crew read it as "what he's training
    // these days" (see `users.currentProgramId`).
    //
    // The LINEAGE's latest row, not the one the client handed us: a coach swap
    // that landed after the card rendered leaves `args.programId` pointing at a
    // superseded version, and everything downstream reads this field as "the
    // program as it stands" — `coach.swapExercise` bases the next version's
    // number AND its days on it, `consult.coachGrounding` and `crew` read its
    // days. Stamping the stale row there means a swap that computes
    // `version + 1` from a version that already exists: two rows tie, the older
    // one wins every read (`latestPerLineage` keeps the first at equal version),
    // and the swap the user just asked for is invisible for good. The lineage
    // range was already read above, which also puts it in the OCC read set, so
    // a swap racing this mutation conflicts and the retry sees it.
    if (program) {
      const latest = latestPerLineage(rows)[0] ?? null;
      // The workout row keeps `program._id`: its set rows were seeded from THAT
      // version's prescription, and `today` renders the day off it.
      await ctx.db.patch("users", user._id, { currentProgramId: latest?._id ?? program._id });
    }
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

/**
 * Backs out of a séance started by mistake: the row and its sets go away as if
 * it never happened.
 *
 * Nothing to revert on the program rotation: `nextDayIndex` derives the next day
 * from the newest séance row (neither `start` nor `finish` stores a counter), so
 * deleting the row rewinds it for free.
 */
export const cancel = mutation({
  args: { workoutId: v.id("workouts") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const workout = await ctx.db.get("workouts", args.workoutId);
    if (!workout || workout.userId !== user._id) throw new Error("Séance introuvable");
    // A finished séance is history — and its PR rows would outlive the sets they
    // came from. Deleting one is a different feature.
    if (workout.endedAt !== undefined) throw new Error("Séance déjà terminée");

    // Every set, not a bounded page: nothing caps how many a workout owns, and a
    // leftover row still answers by_user_and_exercise — it would keep feeding
    // prefill, history and PR candidates for a séance the user cancelled. The
    // index range is one workout, so this is naturally small.
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
      .collect();
    for (const set of sets) await ctx.db.delete("sets", set._id);
    await ctx.db.delete("workouts", workout._id);
    return null;
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
