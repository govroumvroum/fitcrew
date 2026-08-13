import { customAlphabet } from "nanoid";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, mutation, query } from "./_generated/server";
import { latestInLineage } from "./programs";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure logic — see convex/shares.check.ts
// ---------------------------------------------------------------------------

/** No 0/o/1/l/i: a share code gets read out loud or retyped from a screen. */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CODE_LENGTH = 10;
export const generateCode = customAlphabet(CODE_ALPHABET, CODE_LENGTH);

type ProgramSnapshot = Pick<
  Doc<"programs">,
  "name" | "days" | "progressionRules" | "deloadEveryWeeks"
>;

/**
 * The insert doc for a copy: a NEW independent lineage owned by the receiver,
 * at version 1. Nothing from the source row leaks — no _id, no old lineage, no
 * old status. Days are deep-copied so the copy can never alias the original.
 */
export function snapshotForCopy(program: ProgramSnapshot, receiverId: Id<"users">) {
  return {
    userId: receiverId,
    version: 1,
    status: "active" as const,
    name: program.name,
    days: structuredClone(program.days),
    progressionRules: program.progressionRules,
    ...(program.deloadEveryWeeks !== undefined
      ? { deloadEveryWeeks: program.deloadEveryWeeks }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

/** The lineage's latest row, IF the caller owns it. Throws otherwise. */
async function requireOwnedLineage(ctx: QueryCtx, userId: Id<"users">, lineageId: Id<"programs">) {
  const latest = await latestInLineage(ctx, userId, lineageId);
  if (!latest) throw new Error("Programme introuvable");
  return latest;
}

// .first(), not .unique(): if two concurrent `share` calls ever did land two rows
// on one lineage, .unique() would throw from then on and the owner could never
// revoke. Reading the first and deleting them all in `unshare` makes that
// impossible to wedge.
const shareByLineage = (ctx: QueryCtx, lineageId: Id<"programs">) =>
  ctx.db
    .query("programShares")
    .withIndex("by_lineage", (q) => q.eq("lineageId", lineageId))
    .first();

/** Share a program: returns its code, minting one on first call (idempotent). */
export const share = mutation({
  args: { lineageId: v.id("programs") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await requireOwnedLineage(ctx, user._id, args.lineageId);

    const existing = await shareByLineage(ctx, args.lineageId);
    if (existing) return existing.code;

    // 31^10 codes: a collision is near-impossible, but a guessable error state
    // isn't worth the two lines this loop costs.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const taken = await ctx.db
        .query("programShares")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (!taken) {
        await ctx.db.insert("programShares", { lineageId: args.lineageId, userId: user._id, code });
        return code;
      }
    }
    throw new Error("Impossible de générer un lien, réessaie");
  },
});

/** Revoke the link. The page behind it 404s from the next read on. */
export const unshare = mutation({
  args: { lineageId: v.id("programs") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await requireOwnedLineage(ctx, user._id, args.lineageId);
    // Every row, not just the first: revoking has to kill every live link.
    const rows = await ctx.db
      .query("programShares")
      .withIndex("by_lineage", (q) => q.eq("lineageId", args.lineageId))
      .collect();
    for (const row of rows) await ctx.db.delete("programShares", row._id);
    return null;
  },
});

/** The caller's own share links, for /programme to label which are shared.
 * Empty when signed out, like every list query here — a subscription can open
 * before the auth token lands, and that must not throw. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("programShares")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(500);
    return rows.map((row) => ({ lineageId: row.lineageId, code: row.code }));
  },
});

/** The latest row behind a share, or null if the code is dead. */
async function resolveShare(ctx: QueryCtx, code: string) {
  const share = await ctx.db
    .query("programShares")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (!share) return null;
  // Scoped to the sharer, same resolver as everything else — a swap after
  // sharing shows up here because the lineage's highest version wins.
  const program = await latestInLineage(ctx, share.userId, share.lineageId);
  if (!program) return null;
  return { share, program };
}

/**
 * PUBLIC — no auth on purpose, this is what the /p/[code] page renders
 * signed-out (same stance as exerciseDemos.forNames). Returns only what the
 * page shows; never the owner's userId.
 */
export const shared = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveShare(ctx, args.code);
    if (!resolved) return null;
    const owner = await ctx.db.get("users", resolved.share.userId);
    return {
      name: resolved.program.name,
      days: resolved.program.days,
      author: owner?.name ?? "Anonyme",
    };
  },
});

/** Copy the shared program into the caller's account, as a fresh lineage. */
export const copyShared = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const resolved = await resolveShare(ctx, args.code);
    if (!resolved) throw new Error("Ce lien n'est plus valide");

    // Same two-step as coach.saveProgram: a root row's lineage is itself, and
    // we only know the id after the insert. `currentProgramId` is NOT touched —
    // it means "most recently trained", and a copy was never trained.
    const programId = await ctx.db.insert("programs", snapshotForCopy(resolved.program, user._id));
    await ctx.db.patch("programs", programId, { lineageId: programId });
    return programId;
  },
});
