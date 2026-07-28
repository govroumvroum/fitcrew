import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { MutationCtx, QueryCtx, internalMutation, mutation, query } from "./_generated/server";
import { onboarding, tone } from "./schema";

/** The signed-in user, or null. Every user-scoped function routes through this. */
export async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/** Same, but throws — use in functions that make no sense unauthenticated. */
export async function requireCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  return user;
}

export const me = query({
  args: {},
  handler: getCurrentUser,
});

type Profile = { name: string; email?: string; avatarUrl?: string };

/**
 * Both the Clerk webhook and the client-side fallback land here, so they must
 * agree on tokenIdentifier or we'd insert the same person twice.
 */
async function upsertUser(ctx: MutationCtx, tokenIdentifier: string, profile: Profile) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();

  if (existing) {
    await ctx.db.patch("users", existing._id, profile);
    return existing._id;
  }
  return await ctx.db.insert("users", { tokenIdentifier, ...profile });
}

/** Convex derives tokenIdentifier as `{issuer}|{subject}`; Clerk sends only the subject. */
function tokenIdentifierFor(clerkUserId: string) {
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!issuer) throw new Error("CLERK_JWT_ISSUER_DOMAIN is not set");
  return `${issuer}|${clerkUserId}`;
}

/** Source of truth: `user.created` / `user.updated` from the Clerk webhook. */
export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertUser(ctx, tokenIdentifierFor(args.clerkUserId), {
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl,
    });
    return null;
  },
});

export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifierFor(args.clerkUserId)))
      .unique();
    // ponytail: leaves the user's workouts/sets/prs behind. Cascade when
    // someone actually leaves the crew.
    if (user) await ctx.db.delete("users", user._id);
    return null;
  },
});

/**
 * Fallback for the gap between first sign-in and the webhook landing. Keeps
 * working if webhook delivery is down; idempotent with upsertFromClerk.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await upsertUser(ctx, identity.tokenIdentifier, {
      name: identity.name ?? identity.email ?? "Anonyme",
      email: identity.email,
      avatarUrl: identity.pictureUrl,
    });
  },
});

export const saveOnboarding = mutation({
  args: { onboarding, tone },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await ctx.db.patch("users", user._id, {
      onboarding: args.onboarding,
      tone: args.tone,
    });
    return null;
  },
});
