import { generateObject } from "ai";
import { type Infer, v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import { MODEL_ID, languageModel } from "./model";
import { type PlannedMeal, forbiddenHits, normalizeName } from "./nutrition";
import { SECHE_CATALOGUE, SECHE_TAG } from "./recipeCatalogue";
import { type RecipeCategory, categoryForSlot } from "./recipeLogic";
import { plannedMeal, recipe as recipeValidator, recipeCategory } from "./schema";
import { getCurrentUser } from "./users";

type RecipeFields = Infer<typeof recipeValidator>;

// ---------------------------------------------------------------------------
// Pure logic. See recipes.check.ts.
// ---------------------------------------------------------------------------

/** Dedup key, within one owner: the shopping list's `normalizeName`, with « œ » and
 *  « æ » spelled out first — NFD leaves them whole, so « Bœuf » and « Boeuf »
 *  would otherwise be two recipes. */
export const recipeKey = (name: string) =>
  normalizeName(
    name.replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").replace(/Æ/g, "AE"),
  );

type MealRecipe = Pick<
  RecipeFields,
  "name" | "nameKey" | "category" | "ingredients" | "steps" | "prepMinutes" | "macros"
>;

/**
 * A plan's meals as library entries, one per normalised name. A dish that comes
 * back three times in the week is ONE recipe; the last occurrence wins, which is
 * the one most recently written. Nameless meals are dropped (nothing to key on).
 */
export function recipesFromMeals(meals: PlannedMeal[]): MealRecipe[] {
  const byKey = new Map<string, MealRecipe>();
  for (const meal of meals) {
    const name = meal.name.trim();
    const nameKey = recipeKey(name);
    if (!nameKey) continue;
    byKey.set(nameKey, {
      name,
      nameKey,
      category: categoryForSlot(meal.slot),
      ingredients: meal.ingredients,
      steps: meal.steps,
      prepMinutes: meal.prepMinutes,
      macros: meal.macros,
    });
  }
  return [...byKey.values()];
}

type Checkable = {
  name: string;
  ingredients: { name: string }[];
  allergens?: string[];
};

/**
 * Whether a recipe can be shown to someone with these allergies and exclusions.
 * The one health guard of the app, applied on every READ of the library.
 *
 * Checks `forbiddenHits` against the ingredients PLUS the dish name and the
 * curated `allergens` — over-hiding a recipe costs nothing, showing peanuts to
 * someone allergic costs a lot. « Skyr cacahuète-cacao » is hidden for a
 * cacahuète allergy by its name alone, and for a lactose one by its allergens.
 */
export function visibleTo(recipe: Checkable, forbidden: string[]): boolean {
  const words = [
    ...recipe.ingredients,
    { name: recipe.name },
    ...(recipe.allergens ?? []).map((name) => ({ name })),
  ];
  return forbiddenHits([{ name: recipe.name, ingredients: words }], forbidden).length === 0;
}

type Mergeable = {
  nameKey: string;
  photoUrl?: string;
  tags: string[];
  cheat?: boolean;
  allergens?: string[];
};

/**
 * Own recipes first, then the catalogue minus what the user already has under
 * the same name — the Chef picking « Bœuf teriyaki » out of the catalogue must
 * not show it twice. The user's copy wins (it's the version in their plan) but
 * inherits the catalogue's photo, tags, cheat flag and allergens: curated facts
 * about the same dish, and allergens only ever hide more.
 */
export function mergeLibrary<T extends Mergeable>(own: T[], catalogue: T[]): T[] {
  const shared = new Map(catalogue.map((r) => [r.nameKey, r]));
  const mine = own.map((r) => {
    const twin = shared.get(r.nameKey);
    if (!twin) return r;
    return {
      ...r,
      photoUrl: r.photoUrl ?? twin.photoUrl,
      tags: [...new Set([...r.tags, ...twin.tags])],
      cheat: r.cheat ?? twin.cheat,
      allergens: [...new Set([...(r.allergens ?? []), ...(twin.allergens ?? [])])],
    };
  });
  const ownKeys = new Set(own.map((r) => r.nameKey));
  return [...mine, ...catalogue.filter((r) => !ownKeys.has(r.nameKey))];
}

/**
 * The catalogue as a short list for the Chef's prompt: name, shelf, kcal,
 * protein. Read from the code constant, not the table, so it's stable (prompt
 * cache) and available before the seed has run. Filtered by the same guard as
 * the screen: a recipe the user can't eat is never suggested.
 */
export function secheCatalogueLines(forbidden: string[]): string[] {
  return SECHE_CATALOGUE.filter((r) => visibleTo(r, forbidden)).map(
    (r) =>
      `- ${r.name} (${r.category}${r.cheat ? ", cheat" : ""}) : ~${r.macros.calories} kcal, ~${r.macros.protein} g de protéines`,
  );
}

/** JSON with sorted keys: a stored document needn't come back in the key order
 *  it was written in, and a false « changed » would rewrite 31 rows per user. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The catalogue row a seed writes for one entry. */
export function catalogueRow(entry: (typeof SECHE_CATALOGUE)[number]): RecipeFields {
  return {
    name: entry.name,
    nameKey: recipeKey(entry.name),
    category: entry.category,
    ...(entry.cheat ? { cheat: true } : {}),
    tags: [SECHE_TAG],
    description: entry.description,
    ingredients: entry.ingredients,
    steps: entry.steps,
    prepMinutes: entry.prepMinutes,
    macros: entry.macros,
    photoUrl: entry.photoUrl,
    allergens: entry.allergens,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const byOwnerAndKey = (ctx: QueryCtx, userId: Id<"users"> | undefined, nameKey: string) =>
  ctx.db
    .query("recipes")
    .withIndex("by_user_and_name_key", (q) => q.eq("userId", userId).eq("nameKey", nameKey))
    .first();

/**
 * Every meal the Chef just wrote, upserted into the user's library. Called from
 * `savePlan`, `replaceMeal` and `regenerateDay` AFTER their allergy check, inside
 * the same transaction — a refused plan upserts nothing, and a plan that fails
 * to write rolls its recipes back with it.
 *
 * `userId` is an argument because this is internal: the caller already resolved
 * the user. 28 meals is ~28 index reads and as many writes, well inside a
 * transaction.
 */
export const upsertFromMeals = internalMutation({
  args: { userId: v.id("users"), meals: v.array(plannedMeal) },
  handler: async (ctx, args) => {
    for (const entry of recipesFromMeals(args.meals)) {
      const existing = await byOwnerAndKey(ctx, args.userId, entry.nameKey);
      if (existing) {
        // Patch, not replace: tags, photo and cheat may have been set on it.
        await ctx.db.patch("recipes", existing._id, entry);
      } else {
        await ctx.db.insert("recipes", { userId: args.userId, tags: [], ...entry });
      }
    }
    return null;
  },
});

/**
 * Upserts the 31 « sèche » recipes into the shared catalogue (no `userId`).
 * Idempotent on the normalised name, and writes nothing when a row already
 * matches — so the migration that calls it can run on every user, and rerunning
 * it never creates a duplicate.
 */
export async function seedCatalogue(
  ctx: MutationCtx,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const entry of SECHE_CATALOGUE) {
    const row = catalogueRow(entry);
    const existing = await byOwnerAndKey(ctx, undefined, row.nameKey);
    if (!existing) {
      await ctx.db.insert("recipes", row);
      inserted++;
      continue;
    }
    const { _id, _creationTime, ...current } = existing;
    if (canonical(current) !== canonical(row)) {
      await ctx.db.replace("recipes", _id, row);
      updated++;
    }
  }
  return { inserted, updated };
}

/** By hand, on a deployment the migration can't reach (no users yet):
 *    bunx convex run recipes:seed */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => await seedCatalogue(ctx),
});

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/** Bounds, not truncations anyone should hit: ~3 months of distinct dishes. */
const OWN_LIMIT = 400;
const CATALOGUE_LIMIT = 100;

async function forbiddenFor(ctx: QueryCtx, userId: Id<"users">): Promise<string[]> {
  const profile = await ctx.db
    .query("nutritionProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return profile ? [...profile.allergies, ...profile.excluded] : [];
}

const ownedBy = (ctx: QueryCtx, userId: Id<"users"> | undefined, category?: RecipeCategory) =>
  category
    ? ctx.db
        .query("recipes")
        .withIndex("by_user_and_category", (q) => q.eq("userId", userId).eq("category", category))
    : ctx.db.query("recipes").withIndex("by_user_and_name_key", (q) => q.eq("userId", userId));

const photoFor = (ctx: QueryCtx, nameKey: string) =>
  ctx.db
    .query("recipePhotos")
    .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
    .unique();

/**
 * The Recettes screen: the user's own recipes (newest first), then the shared
 * catalogue, without anything their allergies or exclusions forbid.
 *
 * A category filter goes through the index; « cheat » and sorting are done by
 * the screen on this bounded list. Answers `[]` for a signed-out user or an
 * empty catalogue (the seed runs after the deploy, so the screen must cope).
 *
 * `photoUrl: null` + `photoPending: false` = draw the illustration;
 * `photoPending: true` = nobody has looked yet, the screen asks
 * `resolvePhotos` and draws the illustration meanwhile.
 */
export const library = query({
  args: { category: v.optional(recipeCategory) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const forbidden = await forbiddenFor(ctx, user._id);
    const own = (await ownedBy(ctx, user._id, args.category).take(OWN_LIMIT)).sort(
      (a, b) => b._creationTime - a._creationTime,
    );
    // Seed order (diet's order: by shelf), not the index's alphabetical one.
    const catalogue = (await ownedBy(ctx, undefined, args.category).take(CATALOGUE_LIMIT)).sort(
      (a, b) => a._creationTime - b._creationTime,
    );

    const visible = mergeLibrary(own, catalogue).filter((r) => visibleTo(r, forbidden));

    return await Promise.all(
      visible.map(async (r) => {
        const cached = r.photoUrl ? null : await photoFor(ctx, r.nameKey);
        return {
          _id: r._id,
          mine: r.userId !== undefined,
          name: r.name,
          category: r.category,
          cheat: r.cheat === true,
          tags: r.tags,
          description: r.description ?? null,
          ingredients: r.ingredients,
          steps: r.steps,
          prepMinutes: r.prepMinutes,
          macros: r.macros,
          photoUrl: r.photoUrl ?? cached?.photoUrl ?? null,
          photoPending: !r.photoUrl && !cached,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Photos: TheMealDB, looked up once per name at READ time, cached forever.
// ---------------------------------------------------------------------------

/** Names per call. The screen calls again while some are still pending. */
const RESOLVE_BATCH = 6;

/**
 * The user's recipes nobody has looked up yet. Only THEIR recipe names, read
 * here — the action takes no names, so nobody can make us spend model calls on
 * arbitrary strings.
 */
export const pendingPhotoNames = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ userId: Id<"users"> | null; names: string[] }> => {
    const user = await getCurrentUser(ctx);
    if (!user) return { userId: null, names: [] };
    const names: string[] = [];
    for (const r of await ownedBy(ctx, user._id).take(OWN_LIMIT)) {
      if (names.length >= RESOLVE_BATCH) break;
      if (r.photoUrl || (await photoFor(ctx, r.nameKey))) continue;
      // A Chef recipe named like a catalogue one borrows the catalogue's photo.
      if (await byOwnerAndKey(ctx, undefined, r.nameKey)) continue;
      names.push(r.name);
    }
    return { userId: user._id, names };
  },
});

export const cachePhoto = internalMutation({
  args: {
    name: v.string(),
    englishGuess: v.optional(v.string()),
    photoUrl: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const nameKey = recipeKey(args.name);
    const existing = await photoFor(ctx, nameKey);
    if (existing) await ctx.db.patch("recipePhotos", existing._id, args);
    else await ctx.db.insert("recipePhotos", { nameKey, ...args });
    return null;
  },
});

/**
 * Drops cached answers so they get looked up again — a cached `null` is
 * otherwise permanent.
 *   bunx convex run recipes:forgetPhotos '{"names":["Bœuf teriyaki"]}'
 */
export const forgetPhotos = internalMutation({
  args: { names: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const name of args.names) {
      const cached = await photoFor(ctx, recipeKey(name));
      if (cached) await ctx.db.delete("recipePhotos", cached._id);
    }
    return null;
  },
});

const MEALDB_SEARCH = "https://www.themealdb.com/api/json/v1/1/search.php";

type MealDbMeal = { idMeal: string; strMeal: string; strMealThumb: string | null };

/** Every meal whose name contains `term`. TheMealDB answers `{ meals: null }`
 *  for no match, which is not an error. */
async function searchMealDb(term: string): Promise<MealDbMeal[]> {
  const url = new URL(MEALDB_SEARCH);
  url.searchParams.set("s", term);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TheMealDB ${response.status}`);
  const body = (await response.json()) as { meals: MealDbMeal[] | null };
  return (body.meals ?? []).filter((m) => m.strMealThumb);
}

const zTranslate = z.object({
  english: z.string().describe("The dish's usual English name, 1-4 words"),
  queries: z
    .array(z.string())
    .describe(
      "1 to 4 short search terms (1-2 words each), most specific first; the site matches a substring of the dish name (e.g. 'beef teriyaki', 'teriyaki'; 'pumpkin soup', 'pumpkin', 'squash'; 'lasagn')",
    ),
});

const zPick = z.object({
  idMeal: z
    .string()
    .nullable()
    .describe("The idMeal of the candidate that is the same dish, or null if none is"),
});

/**
 * Looks up a photo for the user's recipes that have none yet: translate the
 * French name, search TheMealDB, then make the model PICK one of the results or
 * none — the `exerciseDemos.resolve` lesson: free translation plus fuzzy match
 * fails silently and wrongly (« Bœuf teriyaki » -> a salmon), constrained picking
 * fails honestly with a null. The picked id is checked against the results.
 *
 * The answer is cached either way, `null` included, so a name costs at most two
 * small text calls, ever. A transient failure (network, no key) caches nothing,
 * so the next visit retries.
 */
export const resolvePhotos = action({
  args: {},
  handler: async (ctx) => {
    const { userId, names } = await ctx.runQuery(internal.recipes.pendingPhotoNames, {});
    if (!userId) return null;

    const bill = async (
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
        inputTokenDetails?: { cacheReadTokens?: number };
      },
      providerMetadata: Parameters<typeof costUsdFrom>[0],
    ) => {
      await ctx.runMutation(internal.aiUsage.record, {
        userId,
        feature: "photos",
        model: MODEL_ID,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
        costUsd: costUsdFrom(providerMetadata),
      });
    };

    for (const name of names) {
      try {
        const translated = await generateObject({
          model: languageModel(),
          providerOptions: { openrouter: { usage: { include: true } } },
          schema: zTranslate,
          temperature: 0,
          system:
            "Tu traduis le nom d'un plat français en anglais, pour chercher sa photo sur un site de " +
            "recettes anglophone. Donne le nom anglais usuel du plat, et 1 à 4 termes de recherche du " +
            "plus précis au plus général. Le site cherche une SOUS-CHAÎNE dans le nom du plat : des " +
            "termes courts (1 ou 2 mots), dont le mot-clé du plat seul, au radical quand l'orthographe " +
            "varie (« lasagn » trouve « Lasagne » et « Lasagna »). Pas de marque, pas de quantité.",
          prompt: name,
        });
        await bill(translated.usage, translated.providerMetadata);

        const seen = new Map<string, MealDbMeal>();
        for (const term of translated.object.queries.slice(0, 4)) {
          for (const meal of await searchMealDb(term)) seen.set(meal.idMeal, meal);
        }
        const candidates = [...seen.values()].slice(0, 30);

        let photoUrl: string | null = null;
        if (candidates.length > 0) {
          const picked = await generateObject({
            model: languageModel(),
            providerOptions: { openrouter: { usage: { include: true } } },
            schema: zPick,
            temperature: 0,
            system:
              "Tu choisis la photo d'un plat. On te donne un plat (en français et en anglais) et des " +
              "candidats `idMeal<TAB>nom`. Réponds avec l'idMeal d'un candidat qui est LE MÊME plat : " +
              "même type de plat ET même ingrédient principal. « Bœuf teriyaki » n'est PAS « Teriyaki " +
              "Salmon ». Si aucun ne l'est vraiment, réponds null : une illustration vaut mieux " +
              "qu'une photo d'un autre plat.",
            prompt:
              `Plat : ${name} (${translated.object.english})\n\nCandidats :\n` +
              candidates.map((m) => `${m.idMeal}\t${m.strMeal}`).join("\n"),
          });
          await bill(picked.usage, picked.providerMetadata);
          // The model's id is a claim: only a candidate we actually got counts.
          photoUrl = seen.get(picked.object.idMeal ?? "")?.strMealThumb ?? null;
        }

        await ctx.runMutation(internal.recipes.cachePhoto, {
          name,
          englishGuess: translated.object.english,
          photoUrl,
        });
      } catch (error) {
        // Transient: leave it unresolved, the next visit retries.
        console.error(
          "recipes.resolvePhotos",
          name,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return null;
  },
});
