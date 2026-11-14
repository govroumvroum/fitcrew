import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, mutation, query } from "./_generated/server";
import { latestPerLineage, lineageOf, userPrograms } from "./programs";
import { dayLevel } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";
import {
  type DayLevel,
  type DaySession,
  type LevelSource,
  type WeekEntry,
  cleanEntries,
  foreignEntry,
  resolveDayLevel,
} from "./weekTemplate";

/**
 * The semaine type (#118), shared by the Coach (`set_week_template`), the
 * /programme editor and the Chef (who reads it in his prompt). The pure half —
 * levels, weekdays, times — is `weekTemplate.ts`.
 */

export const templateFor = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("weekTemplates")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

/** A program as the template shows it: its name and whether it's still running. */
export type EntryProgram = { name: string; status: "active" | "archived" | "completed" };

/**
 * The template's entries, each with the program it points at — read from the
 * user's OWN programs, so an entry can only ever name one of his. An archived
 * program keeps its entry (he may still train that day) and says so; a lineage
 * that no longer resolves at all shows as a plain kind.
 */
export async function entriesWithPrograms(
  ctx: QueryCtx,
  userId: Id<"users">,
  entries: WeekEntry[],
): Promise<(WeekEntry & { program: EntryProgram | null })[]> {
  if (!entries.some((entry) => entry.lineageId)) return entries.map((e) => ({ ...e, program: null }));
  const latest = new Map(
    latestPerLineage(await userPrograms(ctx, userId)).map((row) => [lineageOf(row) as string, row]),
  );
  return entries.map((entry) => {
    const row = entry.lineageId ? latest.get(entry.lineageId) : undefined;
    return {
      ...entry,
      program: row ? { name: row.name, status: row.status ?? "active" } : null,
    };
  });
}

/** What was trained on `date`: séances (with their program's lineage) and cardio. */
export async function sessionsOn(
  ctx: QueryCtx,
  userId: Id<"users">,
  date: string,
): Promise<DaySession[]> {
  const workouts = await ctx.db
    .query("workouts")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
    .take(10);
  const cardio = await ctx.db
    .query("cardio")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
    .take(10);
  const sessions: DaySession[] = [];
  for (const workout of workouts) {
    const row = workout.programId ? await ctx.db.get("programs", workout.programId) : null;
    sessions.push(row && row.userId === userId ? { lineageId: lineageOf(row) } : {});
  }
  for (const entry of cardio) sessions.push({ kind: entry.kind });
  return sessions;
}

export type DayLevelView = {
  level: DayLevel | null; // null: no semaine type, the flat target applies
  source: LevelSource;
  planned: (WeekEntry & { program: EntryProgram | null })[];
};

/** Today's level for /nutrition and the Chef's `read_today` — see `resolveDayLevel`. */
export async function loadDayLevel(
  ctx: QueryCtx,
  userId: Id<"users">,
  date: string,
): Promise<DayLevelView> {
  const template = await templateFor(ctx, userId);
  const resolved = resolveDayLevel({
    date,
    entries: template?.entries ?? [],
    override: template?.override ?? null,
    sessions: await sessionsOn(ctx, userId, date),
  });
  return {
    level: resolved.level,
    source: resolved.source,
    planned: await entriesWithPrograms(ctx, userId, resolved.planned),
  };
}

/** The template with its programs, for the prompts. Null when he has none. */
export async function loadTemplate(ctx: QueryCtx, userId: Id<"users">) {
  const template = await templateFor(ctx, userId);
  if (!template || template.entries.length === 0) return null;
  return await entriesWithPrograms(ctx, userId, template.entries);
}

/** /programme's « Ma semaine ». Entries with their program; `[]` without a template. */
export const template = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await templateFor(ctx, user._id);
    return { entries: await entriesWithPrograms(ctx, user._id, row?.entries ?? []) };
  },
});

/**
 * The one write behind both the Coach's `set_week_template` and the /programme
 * editor. Replaces the whole template. Every refusal is RETURNED with an
 * `error`, never thrown: the Coach reads why and fixes its call, the screen
 * shows it in a toast, and nothing is written.
 *
 * `lineageId` is a plain string on purpose: the model types it, and a garbage id
 * must come back as a refusal, not a validator throw that kills the turn. It is
 * checked against the AUTHENTICATED user's own programs — another user's
 * lineage simply isn't in that list.
 */
export const save = mutation({
  args: {
    entries: v.array(
      v.object({
        weekday: v.number(),
        kind: v.string(),
        lineageId: v.optional(v.string()),
        level: dayLevel,
        time: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const cleaned = cleanEntries(args.entries);
    if ("error" in cleaned)
      return { result: "refused" as const, error: `${cleaned.error} Rien n'a été enregistré.` };

    const owned = new Set(
      latestPerLineage(await userPrograms(ctx, user._id)).map((row) => lineageOf(row) as string),
    );
    const foreign = foreignEntry(cleaned.entries, owned);
    if (foreign)
      return {
        result: "refused" as const,
        error: `Aucun de ses programmes n'a le lineageId « ${foreign.lineageId} » (${foreign.kind}). Relis read_programs, ou mets lineageId à null. Rien n'a été enregistré.`,
      };

    // Checked against `owned` just above, so the cast names a real lineage.
    const entries = cleaned.entries.map(({ lineageId, ...entry }) => ({
      ...entry,
      ...(lineageId ? { lineageId: lineageId as Id<"programs"> } : {}),
    }));
    const existing = await templateFor(ctx, user._id);
    if (existing) await ctx.db.patch("weekTemplates", existing._id, { entries });
    else await ctx.db.insert("weekTemplates", { userId: user._id, entries });

    return {
      result: "saved" as const,
      entries: await entriesWithPrograms(ctx, user._id, entries),
    };
  },
});

/**
 * /nutrition's one-tap selector. Valid for `date` only: a new day reads the
 * template again. Without a template there is no level to choose (the flat
 * target applies, see `resolveDayLevel`), so nothing is written — the screen
 * only offers the selector once a week exists.
 */
export const setDayLevel = mutation({
  args: { date: v.string(), level: dayLevel },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const existing: Doc<"weekTemplates"> | null = await templateFor(ctx, user._id);
    if (!existing) return null;
    await ctx.db.patch("weekTemplates", existing._id, {
      override: { date: args.date, level: args.level },
    });
    return null;
  },
});
