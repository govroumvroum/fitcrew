import { v } from "convex/values";
import { query } from "./_generated/server";
import { nextDayIndex } from "./progress";
import { getCurrentUser } from "./users";

/**
 * The whole current program, plus which of its days comes next.
 *
 * `date` is an argument and not `Date.now()` for the same reason as in
 * `workouts.today`: queries don't rerun as the clock advances, and the client
 * owns "today" in its own timezone.
 *
 * Older versions live in the same table (`by_user_and_version`) and are
 * deliberately not read — the page shows what's in force, not a changelog.
 */
export const current = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user?.currentProgramId) return null;

    const program = await ctx.db.get("programs", user.currentProgramId);
    if (!program) return null;

    const last = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    return { program, nextDayIndex: nextDayIndex(program.days.length, last, args.date) };
  },
});
