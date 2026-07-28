import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type QueryCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { languageModel } from "./model";

// ---------------------------------------------------------------------------
// Pure logic. See exerciseDemos.check.ts.
// ---------------------------------------------------------------------------

/**
 * Matching key: unaccented, lowercase, alphanumerics only — so "Développé
 * couché", "developpe couche" and "Developpé-Couché" all collide.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Slugs to try before spending an LLM call. The French name sometimes IS the
 * English one ("squat", "burpees"), and the dataset is singular throughout.
 * ponytail: one plural rule ("s"), because that's the only one that pays.
 * Real stemming belongs in the model call, which is the next step anyway.
 */
export function candidateSlugs(name: string): string[] {
  const slug = slugify(name);
  const singular = slug.replace(/s$/, "");
  return singular === slug ? [slug] : [slug, singular];
}

// ---------------------------------------------------------------------------
// Seed: exercisedb free v1, ~1500 rows. Run once:
//   bunx convex run exerciseDemos:seed
// ---------------------------------------------------------------------------

const API = "https://oss.exercisedb.dev/api/v1/exercises";
const PAGE = 25; // the API's documented hard maximum
const BATCH = 200; // rows per mutation — a 1500-row write does not fit in one

const demoFields = {
  externalId: v.string(),
  name: v.string(),
  slug: v.string(),
  gifUrl: v.string(),
  bodyParts: v.array(v.string()),
  targetMuscles: v.array(v.string()),
  equipments: v.array(v.string()),
};

type ApiExercise = {
  exerciseId: string;
  name: string;
  gifUrl: string;
  bodyParts: string[];
  targetMuscles: string[];
  equipments: string[];
};

export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    let after: string | null = null;
    let calls = 0;
    let rows = 0;
    let batch: ApiExercise[] = [];

    for (;;) {
      const url = new URL(API);
      url.searchParams.set("limit", String(PAGE));
      if (after) url.searchParams.set("after", after);
      // The free tier rate-limits somewhere around 60 sequential calls and
      // publishes no Retry-After. Linear backoff, five tries, then give up —
      // re-running the seed is idempotent so a partial run is safe to resume.
      let response = await fetch(url);
      for (let attempt = 1; response.status === 429 && attempt <= 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        response = await fetch(url);
      }
      if (!response.ok) throw new Error(`exercisedb ${response.status} after ${calls} calls`);
      calls++;
      const body = (await response.json()) as {
        data: ApiExercise[];
        meta: { hasNextPage: boolean; nextCursor: string | null };
      };
      batch.push(...body.data);
      after = body.meta.hasNextPage ? body.meta.nextCursor : null;

      if (batch.length >= BATCH || !after) {
        await ctx.runMutation(internal.exerciseDemos.upsertBatch, {
          rows: batch.map((exercise) => ({
            externalId: exercise.exerciseId,
            name: exercise.name,
            slug: slugify(exercise.name),
            gifUrl: exercise.gifUrl,
            bodyParts: exercise.bodyParts,
            targetMuscles: exercise.targetMuscles,
            equipments: exercise.equipments,
          })),
        });
        rows += batch.length;
        batch = [];
      }
      if (!after) break;
    }
    return { rows, calls };
  },
});

/** Idempotent on `externalId`, so re-running the seed just refreshes. */
export const upsertBatch = internalMutation({
  args: { rows: v.array(v.object(demoFields)) },
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("exerciseDemos")
        .withIndex("by_external_id", (q) => q.eq("externalId", row.externalId))
        .unique();
      if (existing) await ctx.db.replace("exerciseDemos", existing._id, row);
      else await ctx.db.insert("exerciseDemos", row);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Lazy French -> demo matching, cached forever (including the misses).
// ---------------------------------------------------------------------------

/**
 * Only the names already resolved. A name absent from the result is still
 * being worked out; an `externalId: null` entry is a settled "the dataset
 * doesn't have this one". The UI needs to tell those two apart to stay silent.
 *
 * Returns the id, not the URL: media paths are deterministic
 * (`/media/{externalId}.gif`) and their docs mention URL rotation on paid
 * tiers, so the client builds the URL and a rotation can't strand a stored one.
 */
export const forNames = query({
  args: { names: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out: { name: string; externalId: string | null }[] = [];
    for (const name of args.names) {
      const match = await ctx.db
        .query("exerciseDemoMatches")
        .withIndex("by_exercise_name", (q) => q.eq("exerciseName", name))
        .unique();
      if (!match) continue;
      const demo = match.demoId ? await ctx.db.get("exerciseDemos", match.demoId) : null;
      out.push({ name, externalId: demo?.externalId ?? null });
    }
    return out;
  },
});

/** Cache probe + the free deterministic attempt, in one transaction. */
export const probe = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("exerciseDemoMatches")
      .withIndex("by_exercise_name", (q) => q.eq("exerciseName", args.name))
      .unique();
    if (cached) return { cached: true, demoId: null };
    return { cached: false, demoId: await bySlugs(ctx, candidateSlugs(args.name)) };
  },
});

/** Every catalogue entry, `externalId\tname` per line, for the model to pick from. */
export const catalogue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const lines: string[] = [];
    for await (const demo of ctx.db.query("exerciseDemos")) {
      lines.push(`${demo.externalId}\t${demo.name}`);
    }
    return lines.join("\n");
  },
});

export const byExternalId = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const demo = await ctx.db
      .query("exerciseDemos")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();
    return demo?._id ?? null;
  },
});

async function bySlugs(ctx: QueryCtx, slugs: string[]): Promise<Id<"exerciseDemos"> | null> {
  for (const slug of slugs) {
    const hit = await ctx.db
      .query("exerciseDemos")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (hit) return hit._id;
  }
  return null;
}

export const cacheMatch = internalMutation({
  args: {
    exerciseName: v.string(),
    englishGuess: v.optional(v.string()),
    demoId: v.union(v.id("exerciseDemos"), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("exerciseDemoMatches")
      .withIndex("by_exercise_name", (q) => q.eq("exerciseName", args.exerciseName))
      .unique();
    if (existing) await ctx.db.patch("exerciseDemoMatches", existing._id, args);
    else await ctx.db.insert("exerciseDemoMatches", args);
    return null;
  },
});

/**
 * Drops cached answers so they get re-resolved. Needed after a seed refresh or
 * a prompt change, since a cached `null` is otherwise permanent.
 *   bunx convex run exerciseDemos:forget '{"names":["Squat"]}'
 */
export const forget = internalMutation({
  args: { names: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const name of args.names) {
      const match = await ctx.db
        .query("exerciseDemoMatches")
        .withIndex("by_exercise_name", (q) => q.eq("exerciseName", name))
        .unique();
      if (match) await ctx.db.delete("exerciseDemoMatches", match._id);
    }
    return null;
  },
});

const zPick = z.object({
  externalId: z
    .string()
    .nullable()
    .describe("The exerciseId of the matching catalogue line, or null if none matches"),
  name: z.string().nullable().describe("The catalogue name you picked, copied exactly"),
});

/**
 * Resolves names the cache doesn't have yet: slug first (free), then ONE
 * structured call that must pick a line out of the catalogue we hand it.
 *
 * Deliberately NOT "translate then match": free-form translation plus fuzzy
 * lookup was measured at ~11/16 and its failures are silent and wrong
 * ("Soulevé de terre" -> "Car Deadlift"). Constrained picking measured 33/35,
 * and its failures are honest nulls. The returned id is verified against the
 * table, so an invented one degrades to "no match" rather than a wrong GIF.
 *
 * The answer is cached either way, so a name costs at most one call, ever.
 */
export const resolve = action({
  args: { names: v.array(v.string()) },
  handler: async (ctx, args) => {
    let catalogue: string | null = null;

    for (const name of args.names) {
      const { cached, demoId } = await ctx.runQuery(internal.exerciseDemos.probe, { name });
      if (cached) continue;

      if (demoId) {
        await ctx.runMutation(internal.exerciseDemos.cacheMatch, { exerciseName: name, demoId });
        continue;
      }

      let pick: { externalId: string | null; name: string | null };
      try {
        // ponytail: the whole 1500-line catalogue in the prompt (~15k tokens).
        // Simple, and it's one call per name for the app's lifetime. Pre-filter
        // by body part / equipment if the bill ever shows up.
        catalogue ??= await ctx.runQuery(internal.exerciseDemos.catalogue, {});
        const { object } = await generateObject({
          model: languageModel(),
          schema: zPick,
          temperature: 0,
          system:
            "Tu associes un nom d'exercice de musculation en français à une entrée d'un " +
            "catalogue anglais. Le catalogue ci-dessous a une entrée par ligne, au format " +
            "`exerciseId<TAB>nom`.\n\n" +
            "Règles absolues :\n" +
            "- Tu ne peux répondre qu'avec un exerciseId présent tel quel dans le catalogue.\n" +
            "- N'invente jamais d'id ni de nom.\n" +
            "- Le mouvement ET le matériel doivent correspondre. « Développé couché à la " +
            "barre » n'est PAS « dumbbell bench press », « soulevé de terre » n'est PAS " +
            "« car deadlift ».\n" +
            "- Si le nom français ne précise PAS le matériel (« Squat », « Fentes »), prends " +
            "la variante la plus standard du mouvement — pas une variante exotique.\n" +
            "- Si aucune ligne ne correspond vraiment, réponds `null` pour les deux champs. " +
            "Une absence de réponse vaut mieux qu'un mouvement faux.\n\n" +
            `CATALOGUE :\n${catalogue}`,
          prompt: name,
        });
        pick = object;
      } catch {
        // Transient (rate limit, no key). Don't cache a failure as "no match" —
        // leaving it unresolved means the next page view retries.
        continue;
      }

      // Verify against the table: the model's id is a claim, not a fact.
      const matchedId = pick.externalId
        ? await ctx.runQuery(internal.exerciseDemos.byExternalId, { externalId: pick.externalId })
        : null;

      await ctx.runMutation(internal.exerciseDemos.cacheMatch, {
        exerciseName: name,
        englishGuess: pick.name ?? undefined,
        demoId: matchedId,
      });
    }
    return null;
  },
});
