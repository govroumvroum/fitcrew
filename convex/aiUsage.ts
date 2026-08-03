import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { aiFeature } from "./schema";

// ---------------------------------------------------------------------------
// Pure logic. See aiUsage.check.ts.
// ---------------------------------------------------------------------------

type UsageRow = Pick<
  Doc<"aiUsage">,
  "inputTokens" | "outputTokens" | "reasoningTokens" | "costUsd"
>;

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

/** Totals over any set of rows. Missing reasoning tokens / cost count as zero. */
export function sumUsage(rows: UsageRow[]) {
  return rows.reduce<Totals>(
    (t, r) => ({
      calls: t.calls + 1,
      inputTokens: t.inputTokens + r.inputTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      reasoningTokens: t.reasoningTokens + (r.reasoningTokens ?? 0),
      costUsd: t.costUsd + (r.costUsd ?? 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  );
}

/**
 * OpenRouter's real cost in USD, or undefined. Only present when the request
 * asked for it (`usage: { include: true }`), so never assume it's there — and
 * never substitute tokens x a hardcoded rate, which goes stale silently.
 */
export function costUsdFrom(providerMetadata: unknown): number | undefined {
  const cost = (providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)
    ?.openrouter?.usage?.cost;
  return typeof cost === "number" ? cost : undefined;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * One row per LLM call. `userId` omitted = collective cost (the demo cache, and
 * the Monday défi generation).
 */
export const record = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    feature: aiFeature,
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    reasoningTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // UTC, computed here so no call site has to remember to pass it. A call at
    // 01:00 in Bordeaux lands on the previous day; irrelevant for a monthly bill.
    const date = new Date().toISOString().slice(0, 10);
    await ctx.db.insert("aiUsage", { ...args, date });
    return null;
  },
});

/**
 * Who spent what over a period. Internal: `bunx convex run aiUsage:byUser
 * '{"from":"2026-07-01","to":"2026-07-31"}'`. No UI, no public endpoint — the
 * crew is four people.
 */
export const byUser = internalQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const range = (userId: Id<"users"> | undefined) =>
      ctx.db
        .query("aiUsage")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", userId).gte("date", args.from).lte("date", args.to),
        )
        // ponytail: one month of one user's calls, capped. Reach for
        // @convex-dev/aggregate if a period ever exceeds this.
        .take(5000);

    const users = await ctx.db.query("users").take(100);
    const perUser = await Promise.all(
      users.map(async (user) => ({ user: user.name, ...sumUsage(await range(user._id)) })),
    );
    // The demo cache is shared, so it belongs to nobody and to everybody.
    return { perUser, shared: sumUsage(await range(undefined)) };
  },
});
