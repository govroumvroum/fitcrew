import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Macros } from "./nutrition";
import { assertOpen, missingFields, sanitizeAnswers, toProfileArgs } from "./questionnaireAnswers";
import { requireCurrentUser, getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Opens the onboarding card, or hands back the one already on screen — calling
 * the tool twice must not stack two forms in the thread.
 *
 * A user redoing their profile starts from what they already answered.
 */
export const open = internalMutation({
  args: { threadId: v.string() },
  // Annotated for the same circular-inference reason as `submit` below: this
  // handler reads through `api`, whose type includes this module.
  handler: async (
    ctx,
    args,
  ): Promise<{ questionnaireId: Id<"questionnaires">; resumed: boolean }> => {
    const user = await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("questionnaires")
      .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "open"))
      .first();
    if (existing) {
      // The form the user is looking at NOW is the one that must get the echo,
      // so a card resumed in another conversation follows him there.
      //
      // The cost is that the stale card still rendered in the ORIGINAL thread
      // now echoes into the new one. That is the lesser evil: NOT re-pointing
      // means the card he is actually looking at answers into a conversation he
      // left, so he validates and nothing happens on screen — a silent failure
      // beats a noisy one only when someone is watching. And there is at most
      // one open row per user (the guard just above), so the two cards are the
      // same questionnaire seen from two places, not two forms: `assertOpen`
      // refuses whichever validation comes second.
      if (existing.threadId !== args.threadId) {
        await ctx.db.patch("questionnaires", existing._id, { threadId: args.threadId });
      }
      return { questionnaireId: existing._id, resumed: true };
    }

    const profile: Doc<"nutritionProfiles"> | null = await ctx.runQuery(api.nutrition.profile, {});
    const questionnaireId = await ctx.db.insert("questionnaires", {
      userId: user._id,
      kind: "chef_onboarding",
      threadId: args.threadId,
      answers: sanitizeAnswers(profile),
      status: "open",
    });
    return { questionnaireId, resumed: false };
  },
});

/**
 * The card lives in a permanent message stream, so its state has to come from
 * here rather than from React — a reload must not bring back a blank form, nor
 * one that was already validated or abandoned.
 *
 * `null` means the row isn't the caller's, or doesn't exist. `threadId` is the
 * conversation the card belongs to — where its echo message goes after a submit.
 */
export const status = query({
  args: { questionnaireId: v.id("questionnaires") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await ctx.db.get("questionnaires", args.questionnaireId);
    if (!row || row.userId !== user._id) return null;
    return { status: row.status, threadId: row.threadId, answers: sanitizeAnswers(row.answers) };
  },
});

/** The three guards every write shares: authenticated, owner, still open. */
async function claim(ctx: MutationCtx, questionnaireId: Id<"questionnaires">) {
  const user = await requireCurrentUser(ctx);
  const row = await ctx.db.get("questionnaires", questionnaireId);
  if (!row || row.userId !== user._id) throw new Error("Questionnaire introuvable");
  assertOpen(row.status);
  return row;
}

/** Draft save: this is what makes a reload find the form as the user left it. */
export const save = mutation({
  args: { questionnaireId: v.id("questionnaires"), answers: v.any() },
  handler: async (ctx, args) => {
    const row = await claim(ctx, args.questionnaireId);
    await ctx.db.patch("questionnaires", row._id, { answers: sanitizeAnswers(args.answers) });
    return null;
  },
});

/**
 * The only path from the card to a nutrition profile. Incomplete answers write
 * NOTHING: a half-filled profile that looks complete is the bug this whole card
 * exists to avoid.
 */
export const submit = mutation({
  args: { questionnaireId: v.id("questionnaires"), answers: v.any() },
  // Annotated because the handler calls back into `api`, whose type includes this
  // module: without it TypeScript reports a circular inference error here and
  // collapses the whole generated API to `any`.
  handler: async (ctx, args): Promise<{ targets: Macros }> => {
    const row = await claim(ctx, args.questionnaireId);
    const answers = sanitizeAnswers(args.answers);
    const missing = missingFields(answers);
    if (missing.length > 0) throw new Error(`Il manque : ${missing.join(", ")}`);

    // Reused rather than reimplemented: `saveProfile` owns the clamping and the
    // target estimation, and is what the prose fallback calls too.
    const { targets }: { targets: Macros } = await ctx.runMutation(
      api.nutrition.saveProfile,
      toProfileArgs(answers),
    );
    await ctx.db.patch("questionnaires", row._id, { answers, status: "completed" });
    return { targets };
  },
});

/**
 * Unlike `vision.discard` the row STAYS: the card is in the thread forever and
 * has to keep saying « abandonné » instead of coming back blank.
 */
export const abandon = mutation({
  args: { questionnaireId: v.id("questionnaires") },
  handler: async (ctx, args) => {
    const row = await claim(ctx, args.questionnaireId);
    await ctx.db.patch("questionnaires", row._id, { status: "abandoned" });
    return null;
  },
});
