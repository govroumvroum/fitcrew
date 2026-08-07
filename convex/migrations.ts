import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { userPrograms } from "./programs";
import schema from "./schema";

export const migrations = new Migrations(components.migrations, { schema });

/**
 * Every program row an existing user has is a version of one program, so they
 * all join that user's oldest row's lineage.
 *
 * Runs over `users`, not `programs`: the grouping is per-user ("the oldest row
 * this user owns wins"), which a per-program-row pass can't see. Idempotent —
 * rows that already carry a `lineageId` are skipped — and it never touches
 * `currentProgramId`: everyone keeps the program they were training.
 */
export const backfillLineage = migrations.define({
  table: "users",
  migrateOne: async (ctx, user) => {
    const rows = await userPrograms(ctx, user._id);
    const root = rows.reduce<Doc<"programs"> | null>(
      (oldest, row) => (!oldest || row._creationTime < oldest._creationTime ? row : oldest),
      null,
    );
    if (!root) return;
    for (const row of rows) {
      if (row.lineageId) continue;
      await ctx.db.patch("programs", row._id, { lineageId: root._id, status: "active" });
    }
  },
});

// The deploy runs this list (see `buildCommand` in vercel.json). A new migration
// is one more line here — never a new command chained onto the deploy.
export const runAll = migrations.runner([internal.migrations.backfillLineage]);
