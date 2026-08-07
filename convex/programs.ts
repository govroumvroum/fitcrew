import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, mutation, query } from "./_generated/server";
import { lastInLineage, nextDayIndex } from "./progress";
import { programStatus } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure logic — see src/components/progress/progress.check.ts
// ---------------------------------------------------------------------------

/** The default is the contract: a row without a lineage is its own root. */
export const lineageOf = <T extends { _id: string; lineageId?: string }>(row: T) =>
  row.lineageId ?? row._id;

type LineageRow = { _id: string; _creationTime: number; lineageId?: string; version: number };

/**
 * One row per lineage — the highest version wins, because that's the program as
 * it stands. Ordered newest lineage first, by when the lineage was STARTED and
 * not by its latest row: swapping an exercise in an old program must not make it
 * jump to the top of the list.
 */
export function latestPerLineage<T extends LineageRow>(rows: T[]): T[] {
  const best = new Map<string, { row: T; born: number }>();
  for (const row of rows) {
    const key = lineageOf(row);
    const seen = best.get(key);
    if (!seen) best.set(key, { row, born: row._creationTime });
    else {
      seen.born = Math.min(seen.born, row._creationTime);
      if (row.version > seen.row.version) seen.row = row;
    }
  }
  return [...best.values()].sort((a, b) => b.born - a.born).map((entry) => entry.row);
}

/**
 * Every row id of each lineage, keyed by lineage. A séance stamps the exact
 * program row it followed, so recognising "a séance of this program" means
 * matching against all of that program's versions.
 */
export function lineageMembers<T extends { _id: string; lineageId?: string }>(
  rows: T[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = lineageOf(row);
    const set = out.get(key) ?? new Set<string>([key]);
    set.add(row._id);
    out.set(key, set);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

// ponytail: a user owns a handful of programs, each a handful of versions.
// Paginate if someone ever hoards hundreds.
const MAX_PROGRAM_ROWS = 500;
// ponytail: far enough back to find the last séance of a program the user hasn't
// touched in weeks, cheap enough to read on every /programme subscription.
const RECENT_WORKOUTS = 100;

export const userPrograms = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("programs")
    .withIndex("by_user_and_lineage", (q) => q.eq("userId", userId))
    .take(MAX_PROGRAM_ROWS);

const recentWorkouts = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("workouts")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
    .order("desc")
    .take(RECENT_WORKOUTS);

/**
 * Which day of `program` comes next. The single entry point for the rotation:
 * every caller goes through it, so the scoping to the program's own history
 * can't be forgotten at one call site. `lineage` is the program's row ids —
 * the caller already read them (they're its dedupe and its OCC guard), so this
 * doesn't read the range a second time in the same mutation.
 */
export async function nextDayIndexFor(
  ctx: QueryCtx,
  program: Doc<"programs">,
  date: string,
  lineage: Set<string>,
): Promise<number> {
  return nextDayIndex(
    program.days.length,
    await recentWorkouts(ctx, program.userId),
    lineage,
    date,
  );
}

/**
 * What the user last actually lifted on each of these exercises, so a séance
 * opens on real numbers instead of 0 kg.
 *
 * Lives here and not in `workouts.today` because BOTH the picker (which has no
 * séance yet) and the running séance need it — gating it on a running workout
 * is exactly how every exercise ended up starting at zero.
 *
 * An ARRAY, not a map keyed by exercise name: Convex field names must be
 * non-control ASCII, and every exercise here is French — "Développé couché" as
 * a key throws at serialisation. Values are fine, keys are not.
 */
export async function prefillFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  exercises: { name: string }[],
): Promise<{ name: string; weight: number; reps: number }[]> {
  const out: { name: string; weight: number; reps: number }[] = [];
  // Deduped: an exercise listed twice in a day is one lookup, not two.
  for (const name of new Set(exercises.map((exercise) => exercise.name))) {
    const previous = await ctx.db
      .query("sets")
      .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseName", name))
      .order("desc")
      .filter((q) => q.eq(q.field("completed"), true))
      .first();
    if (previous) out.push({ name, weight: previous.weight, reps: previous.reps });
  }
  return out;
}

/** All rows of one lineage the caller owns. The index range is scoped to the
 * user, so "not found" and "not yours" are the same answer — deliberately.
 *
 * Reading the range is also what makes a concurrent version bump conflict: a row
 * inserted into it after this read fails the mutation's OCC check and the retry
 * sees the new latest. A caller that skips this and trusts an id it was handed
 * gets no such protection.
 *
 * ponytail: the read path tolerates a row with no `lineageId` (the `?? _id`
 * default), this write path requires the backfill — `.eq("lineageId", …)` can't
 * match a row that hasn't got the field. `backfillLineage` runs on every deploy
 * (see `runAll` and vercel.json), so an unbackfilled row can't reach a user's
 * screen; the day that stops being true, read the root row here as a fallback. */
export async function lineageRows(
  ctx: QueryCtx,
  userId: Id<"users">,
  lineageId: Id<"programs">,
): Promise<Doc<"programs">[]> {
  return await ctx.db
    .query("programs")
    .withIndex("by_user_and_lineage", (q) => q.eq("userId", userId).eq("lineageId", lineageId))
    .take(MAX_PROGRAM_ROWS);
}

/** The latest row of a lineage the caller owns, or null if it has none. */
export async function latestInLineage(
  ctx: QueryCtx,
  userId: Id<"users">,
  lineageId: Id<"programs">,
): Promise<Doc<"programs"> | null> {
  // One lineage in, so one row out — same "highest version wins" as every read.
  return latestPerLineage(await lineageRows(ctx, userId, lineageId))[0] ?? null;
}

/**
 * Every program the user has, whole, one entry per lineage, each with its OWN
 * next day and its own prefill. This is what both screens draw: `/programme`
 * renders the days, and the séance picker seeds `workouts.start` from
 * `days[nextDayIndex].exercises` — so the exercises have to be in here.
 *
 * Archived and completed lineages are included with their status; the screen
 * shows them apart rather than pretending they never existed.
 *
 * ponytail: returns every program's full days on every call, plus one index
 * read per exercise of each program's next day. A handful of programs of ~8
 * exercises — paginate, or split the prefill into its own query, if a user ever
 * has dozens.
 */
export const list = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const rows = await userPrograms(ctx, user._id);
    // One workouts read for all programs, not one per program.
    const recent = await recentWorkouts(ctx, user._id);
    const members = lineageMembers(rows);

    const out = [];
    for (const program of latestPerLineage(rows)) {
      const lineageId = lineageOf(program);
      const lineage = members.get(lineageId) ?? new Set([program._id]);
      const day = nextDayIndex(program.days.length, recent, lineage, args.date);
      const last = lastInLineage(recent, lineage);
      out.push({
        id: program._id,
        lineageId: lineageId as Id<"programs">,
        name: program.name,
        createdAt: program._creationTime,
        days: program.days,
        dayCount: program.days.length,
        progressionRules: program.progressionRules,
        deloadEveryWeeks: program.deloadEveryWeeks ?? null,
        version: program.version,
        status: program.status ?? "active",
        nextDayIndex: day,
        nextDayName: program.days[day]?.name ?? null,
        // `recent` is newest-first, so this program's newest séance being
        // today's IS "already trained today" — the client needs it to offer
        // boxe after muscu is finished instead of sitting on the récap.
        trainedToday: last?.date === args.date,
        prefill: await prefillFor(ctx, user._id, program.days[day]?.exercises ?? []),
      });
    }
    return out;
  },
});

/**
 * Archive / complete / reactivate a program. Status lives on the lineage's
 * latest row. Nothing to unselect: programs run in parallel, and archiving one
 * just takes it out of the active list.
 */
export const setStatus = mutation({
  args: { lineageId: v.id("programs"), status: programStatus },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const latest = await latestInLineage(ctx, user._id, args.lineageId);
    if (!latest) throw new Error("Programme introuvable");
    await ctx.db.patch("programs", latest._id, { status: args.status });
    return null;
  },
});
