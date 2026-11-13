import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { estimateLevelTargets } from "./nutrition";
import { userPrograms } from "./programs";
import { seedCatalogue } from "./recipes";
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

/**
 * #118: every profile saved before day levels gets its three targets, computed
 * from the fields it already stores — exactly what `saveProfile` writes today.
 * `targets` is left as it is. Idempotent: a profile that already has
 * `targetsByLevel` is skipped. Readers fall back to `targets` until this has run
 * (`levelTargetsOf`), so the deploy doesn't depend on its timing.
 */
export const backfillTargetsByLevel = migrations.define({
  table: "nutritionProfiles",
  migrateOne: async (_ctx, profile) => {
    if (profile.targetsByLevel) return;
    return { targetsByLevel: estimateLevelTargets(profile) };
  },
});

/**
 * Seeds the shared « sèche » recipe catalogue (#119).
 *
 * A migration walks the rows of an existing table, and `recipes` starts empty —
 * so this one walks `users` and runs the idempotent `seedCatalogue` from each.
 * The first user inserts the 31 rows; every later one finds them all and writes
 * nothing. Rerunning it never duplicates (upsert by normalised name).
 *
 * A deployment with no user at all seeds nothing here: run `recipes:seed` there.
 * Production has users. The Recettes screen copes with an empty catalogue, which
 * it is between `convex deploy` and this running.
 *
 * Runs once per deployment: an edit to `SECHE_CATALOGUE` (a corrected macro, a
 * dead hotlink) reaches the table through a NEW migration that calls the same
 * `seedCatalogue` — say `seedRecipeCatalogue2`, one more line in `runAll`. The
 * seed upserts, so it rewrites only the rows that changed.
 */
export const seedRecipeCatalogue = migrations.define({
  table: "users",
  migrateOne: async (ctx) => {
    await seedCatalogue(ctx);
  },
});

/**
 * #127: everyone who already has an account when the welcome screen ships has
 * already found their way around — they get the « Premiers pas » card, never the
 * welcome. Stamped with their creation time, not now: it is a backfill, not an
 * event. Idempotent. Anyone created after this ran is new by definition.
 */
export const markExistingUsersWelcomed = migrations.define({
  table: "users",
  migrateOne: async (_ctx, user) => {
    if (user.welcomedAt !== undefined) return;
    return { welcomedAt: user._creationTime };
  },
});

// The deploy runs this list (see `buildCommand` in vercel.json). A new migration
// is one more line here — never a new command chained onto the deploy.
export const runAll = migrations.runner([
  internal.migrations.backfillLineage,
  internal.migrations.backfillTargetsByLevel,
  internal.migrations.seedRecipeCatalogue,
  internal.migrations.markExistingUsersWelcomed,
]);
