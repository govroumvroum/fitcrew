/**
 * The Chef's visual skills (issue #32): one vision call per photo, four
 * intent-specific prompts, and NOTHING written to the user's data.
 *
 * Same architecture as `convex/screenshots.ts`, for the same reason:
 * interpretation and persistence are separate. `analyze` stores an unconfirmed
 * `visionAnalyses` row and hands back a proposal; only `confirmToLog` /
 * `confirmToInventory` write, and they write the items the USER edited in the
 * card, not the ones the model produced.
 *
 * Image lifecycle, which issue #32 asks to document:
 * - `discard` deletes the row AND the blob — nothing was committed, so nothing
 *   needs keeping.
 * - a confirmed analysis keeps the row (it's the audit trail of where a log line
 *   came from) but ALSO deletes the blob: a photo of someone's fridge has no
 *   reason to live in storage once its numbers have been extracted and accepted.
 * - so `status.url` is null after either one, which is what tells the card its
 *   work is over.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { type Infer, v } from "convex/values";
import { z } from "zod";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, action, internalMutation, mutation, query } from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import { type FoodFact, foodByBarcode, isBarcode } from "./foodFacts";
import { MODEL_ID } from "./model";
import { type NutritionGoal, clampMacros } from "./nutrition";
import { mealSlot, visionIntent } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";

export type VisionIntent = Infer<typeof visionIntent>;

/**
 * The shape the confirmation card edits and the confirm mutations commit.
 * `visionAnalyses.items` is `v.any()` in the schema, so this validator is the
 * only place the shape is enforced — on the way out of the model and on the way
 * back in from the client.
 *
 * `macros` here has no `calories`: the calorie figure travels on its own because
 * a label often prints energy without a full macro table.
 */
const visionItem = v.object({
  name: v.string(),
  quantityEstimate: v.optional(v.string()),
  calories: v.optional(v.number()),
  macros: v.optional(v.object({ protein: v.number(), carbs: v.number(), fat: v.number() })),
  confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  needsConfirmation: v.boolean(),
});

export type VisionItem = Infer<typeof visionItem>;

// ---------------------------------------------------------------------------
// Prompts — one per intent, exported so each can be read and tested alone.
// ---------------------------------------------------------------------------

/** Only what a photo analysis strictly needs of the user's profile. */
export type UserConstraints = {
  allergies?: string[];
  excluded?: string[];
  diet?: string;
  goal?: NutritionGoal;
};

const GOAL_LABEL: Record<NutritionGoal, string> = {
  perte: "perte de poids",
  maintien: "maintien du poids",
  prise: "prise de masse",
};

const COMMON_RULES = `RÈGLES ABSOLUES
1. Ne décris QUE ce qui est visible sur la photo. Un ingrédient que tu ne vois pas n'existe pas pour toi.
2. Sépare les registres dans "warnings", en préfixant chaque ligne par « Observation : », « Hypothèse : » ou « Estimation : ». Une observation est ce que tu vois, une hypothèse est ce qui est probable sans être visible, une estimation est un chiffre approché.
3. L'huile, le beurre, le sucre, la sauce, le sel d'un plat cuisiné sont des HYPOTHÈSES : jamais un item affirmé, uniquement une ligne d'avertissement.
4. Photo floue, sombre, coupée, prise de trop loin ou ambiguë → dis-le dans "warnings" et demande une meilleure photo (angle, lumière, cadrage). Ne devine pas pour combler un trou.
5. Photo inexploitable → "items": [] et un warning qui explique pourquoi et ce qu'il faut refaire. Ne renvoie JAMAIS un item inventé pour avoir l'air utile.
6. Les calories et les macros sont des ESTIMATIONS, jamais des mesures. "confidence" doit le refléter : "high" est réservé à un chiffre imprimé ou à un aliment brut évident et bien cadré.
7. Aucun diagnostic, aucune recommandation médicale, aucune interprétation de santé. Tu décris de la nourriture, c'est tout.
8. Champ non lisible → null. Un null est beaucoup plus utile qu'un nombre inventé.`;

/**
 * The user's hard constraints, and only those. Issue #32: "ne transmettre au
 * modèle que le contexte utilisateur strictement nécessaire" — a photo analysis
 * has no use for age, weight or targets.
 */
function constraintsBlock(c: UserConstraints): string {
  const lines: string[] = [];
  if (c.allergies?.length) lines.push(`Allergies déclarées : ${c.allergies.join(", ")}.`);
  if (c.excluded?.length) lines.push(`Aliments exclus : ${c.excluded.join(", ")}.`);
  if (c.diet) lines.push(`Régime : ${c.diet}.`);
  if (c.goal) lines.push(`Objectif : ${GOAL_LABEL[c.goal]}.`);
  if (lines.length === 0) return "";

  return `

CONTEXTE UTILISATEUR
${lines.join("\n")}
Si un élément visible entre PEUT-ÊTRE en conflit avec une allergie ou une exclusion, écris-le comme un doute à vérifier dans "warnings". N'affirme jamais qu'un plat contient un allergène que tu ne vois pas, et n'affirme jamais qu'il n'en contient pas : la fausse alerte et le faux feu vert sont deux erreurs symétriques, et la seconde est dangereuse.`;
}

export function platePrompt(c: UserConstraints = {}): string {
  return `Tu analyses la photo d'une assiette pour un journal alimentaire.

${COMMON_RULES}

CETTE ASSIETTE
- Un item par composant identifiable du plat (la protéine, le féculent, les légumes, la sauce si elle est visible, le pain, la boisson). Ne fusionne pas tout en « plat complet » quand les composants se distinguent.
- "quantityEstimate" en termes ménagers, tels qu'un humain les dirait : « une poignée », « deux cuillères à soupe », « ≈150 g », « la moitié de l'assiette ». Pas de fausse précision au gramme : « 148 g » est un mensonge, « ≈150 g » est une estimation honnête.
- Une assiette photographiée du dessus cache la hauteur, donc le volume : quand l'angle empêche de juger l'épaisseur, mets-le en warning et baisse la confiance, ne compense pas en inventant un poids.
- "calories" et les macros sont estimées par composant, en cohérence avec la quantité que tu viens d'annoncer.${constraintsBlock(c)}`;
}

export function fridgePrompt(c: UserConstraints = {}): string {
  return `Tu relèves le contenu visible d'un frigo ou d'un placard pour alimenter un inventaire de cuisine.

${COMMON_RULES}

CE FRIGO / CE PLACARD
- Un item par ingrédient ou produit reconnaissable. Ce qui est caché derrière un autre produit, flou au fond de l'étagère ou dans un contenant opaque non étiqueté n'est pas relevé : signale-le en warning.
- "quantityEstimate" approximatif et utile pour cuisiner : « 3 œufs », « ≈ 1/2 botte », « un pot entamé », « 2 briques ». Lis les quantités imprimées quand l'emballage est lisible.
- Laisse "calories", "protein", "carbs" et "fat" à null : une étagère de frigo n'est pas un repas, et l'inventaire n'a pas besoin de macros.
- Nomme les produits comme un humain les écrirait sur une liste de courses, sans la marque sauf si c'est la seule chose lisible.${constraintsBlock(c)}`;
}

export function nutritionLabelPrompt(c: UserConstraints = {}): string {
  return `Tu transcris une étiquette nutritionnelle imprimée. Tu es un OCR structuré, PAS un analyste.

${COMMON_RULES}

CETTE ÉTIQUETTE
- Un seul item en général : le produit. Recopie les valeurs IMPRIMÉES, ne recalcule rien.
- La base compte autant que les chiffres : indique-la dans "quantityEstimate", littéralement, « pour 100 g », « pour 100 ml » ou « par portion (30 g) ». Si le tableau donne les deux colonnes, prends celle pour 100 g / 100 ml et dis-le.
- Énergie donnée seulement en kJ → convertis en kcal (/ 4,184) et mentionne la conversion en warning. C'est la seule opération autorisée.
- Virgule décimale française : « 8,9 » vaut 8.9.
- "barcode" : recopie le code-barres (EAN, 8 à 14 chiffres) s'il est net et entièrement visible. Un chiffre douteux rend le code entier inutilisable → null.
- Un chiffre imprimé et net justifie "high". Un tableau flou, coupé ou photographié de biais ne le justifie pas.
- Une valeur imprimée reste une valeur pour la base indiquée : la portion réellement mangée est une autre question, et elle est estimée.${constraintsBlock(c)}`;
}

export function groceriesPrompt(c: UserConstraints = {}): string {
  return `Tu relèves des courses (sac, cabas, ticket de caisse photographié, produits étalés sur une table) pour mettre à jour un inventaire de cuisine.

${COMMON_RULES}

CES COURSES
- Un item par produit distinct. Deux paquets identiques = un item avec la quantité, pas deux items.
- "quantityEstimate" : ce qui est imprimé sur l'emballage quand c'est lisible (« 1 kg », « 6 œufs », « 500 ml »), sinon une estimation ménagère.
- Laisse "calories", "protein", "carbs" et "fat" à null : ces produits vont à l'inventaire, pas au journal.
- Un produit dont l'emballage est retourné, masqué ou illisible n'est pas deviné à sa forme : signale-le en warning.${constraintsBlock(c)}`;
}

/** Not an image prompt — used by the Chef's `suggest_recipes_from_ingredients`. */
export function recipeFromIngredientsPrompt(ingredients: string[], constraints: string[]): string {
  return `Tu es un cuisinier pragmatique. Tu proposes des recettes réalisables avec ce qu'il y a DÉJÀ dans la cuisine.

RÈGLES
1. N'utilise que les ingrédients listés, plus les basiques d'un placard (sel, poivre, eau, huile). Si une recette a besoin d'autre chose, elle ne va pas dans la liste.
2. Les contraintes ci-dessous sont ABSOLUES : une allergie ou une exclusion ne se négocie pas, même « en petite quantité ».
3. Les macros sont des ESTIMATIONS par portion, pas des mesures.
4. Étapes courtes et exécutables, dans l'ordre. "prepMinutes" est le temps total réaliste, préparation comprise.
5. Aucun conseil médical, aucun jugement sur ce que la personne mange.
6. Trois recettes maximum, et moins s'il n'y a honnêtement pas de quoi.

INGRÉDIENTS DISPONIBLES
${ingredients.length > 0 ? ingredients.join(", ") : "(aucun ingrédient fourni — dis-le plutôt que d'inventer une liste de courses)"}

CONTRAINTES
${constraints.length > 0 ? constraints.join("\n") : "(aucune contrainte déclarée)"}`;
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

// Every field that can be missing is required-and-nullable: strict structured
// outputs reject optional keys, and `null` is what lets the model say "pas
// visible" instead of inventing a number. `normalizeVision` drops the nulls.
//
// The macros are flat here and nested in `visionItem`: a nullable nested object
// is one more thing for the model to get wrong, and three nullable numbers say
// the same thing.
const zItem = z.object({
  name: z.string(),
  quantityEstimate: z
    .string()
    .nullable()
    .describe("« une poignée », « ≈150 g »… null si indéterminable"),
  calories: z.number().nullable().describe("kcal estimées, null si non estimable"),
  protein: z.number().nullable().describe("grammes"),
  carbs: z.number().nullable().describe("grammes"),
  fat: z.number().nullable().describe("grammes"),
  confidence: z.enum(["low", "medium", "high"]),
});

const zVision = z.object({
  items: z.array(zItem),
  warnings: z
    .array(z.string())
    .describe("Observations, hypothèses, estimations et demandes de meilleure photo"),
  barcode: z.string().nullable().describe("Code-barres lisible sur l'emballage, sinon null"),
});

// A hallucinated or misread magnitude. Drop the FIELD, never the whole item —
// the user keeps the rest and retypes one number. Same limits as
// `nutrition.clampMacros`, so nothing we propose can be rejected downstream.
const LIMITS = { calories: 3000, protein: 300, carbs: 300, fat: 300 } as const;

/** 0 is legitimate (a glass of water, a sugar-free drink), a negative is not. */
function plausible(n: number | null, limit: number): number | undefined {
  if (n === null || !Number.isFinite(n) || n < 0 || n > limit) return undefined;
  return Math.round(n * 10) / 10;
}

/**
 * Model output -> what we are willing to store and show. Exported for
 * `convex/vision.check.ts`.
 *
 * An unusable image is NOT an error here: the model returns `items: []` with a
 * warning, and the card renders that plus a manual-entry fallback. Only output
 * we cannot parse at all throws, and that's a bug in the call, not a bad photo.
 */
export function normalizeVision(
  raw: unknown,
  intent: VisionIntent,
): { items: VisionItem[]; warnings: string[]; barcode?: string } {
  const parsed = zVision.safeParse(raw);
  if (!parsed.success) throw new Error(`Analyse illisible : ${parsed.error.message}`);

  // A fridge shelf is not a meal: for the inventory intents we drop the numbers
  // even when the model volunteered them, because nothing downstream reads them
  // and a kcal figure on a jar of mustard only invites the user to trust it.
  const wantsMacros = intent === "plate" || intent === "label";

  // ponytail: 30 items. More than any single plate, fridge shelf or till
  // receipt worth reviewing in one card; paginate the card before raising it.
  const items = parsed.data.items.slice(0, 30).flatMap<VisionItem>((item) => {
    const name = item.name.trim().slice(0, 80);
    if (name === "") return [];

    const quantityEstimate = item.quantityEstimate?.trim().slice(0, 60) || undefined;
    const calories = wantsMacros ? plausible(item.calories, LIMITS.calories) : undefined;
    const protein = wantsMacros ? plausible(item.protein, LIMITS.protein) : undefined;
    const carbs = wantsMacros ? plausible(item.carbs, LIMITS.carbs) : undefined;
    const fat = wantsMacros ? plausible(item.fat, LIMITS.fat) : undefined;
    // All three or none: two macros out of three is not a macro breakdown, and
    // the log needs the full triplet.
    const complete = protein !== undefined && carbs !== undefined && fat !== undefined;

    return [
      {
        name,
        ...(quantityEstimate !== undefined && { quantityEstimate }),
        ...(calories !== undefined && { calories }),
        ...(complete && { macros: { protein, carbs, fat } }),
        confidence: item.confidence,
        // Computed here, never taken from the model: it has every incentive to
        // look confident. Anything short of a printed number with complete
        // macros goes in front of the user before it goes in the log.
        needsConfirmation: item.confidence !== "high" || calories === undefined || !complete,
      },
    ];
  });

  const warnings = parsed.data.warnings
    .map((w) => w.trim().slice(0, 300))
    .filter((w) => w !== "")
    // ponytail: 10 warnings. Past that it's a wall of text nobody reads.
    .slice(0, 10);

  const barcode = legibleBarcode(parsed.data.barcode);
  return { items, warnings, ...(barcode !== undefined && { barcode }) };
}

/** A code with a doubtful digit is not a code — `isBarcode` is the same test the food API uses. */
function legibleBarcode(raw: string | null): string | undefined {
  const code = raw?.trim() ?? "";
  return code !== "" && isBarcode(code) ? code : undefined;
}

/**
 * Open Food Facts REPLACES what the OCR read (contract §6b): a crowdsourced
 * per-100 g table beats a photographed one, and the barcode identifies the
 * product exactly. The warning says where the numbers come from so the user
 * doesn't check them against a label that no longer matches.
 *
 * Exported for the self-check.
 */
export function applyBarcodeFact(fact: FoodFact): { items: VisionItem[]; warning: string } {
  const portion = fact.servingSize
    ? ` Portion imprimée : ${fact.servingSize} — ce que tu as mangé reste une estimation.`
    : "";
  return {
    items: [
      {
        name: fact.brand ? `${fact.name} — ${fact.brand}` : fact.name,
        quantityEstimate: "pour 100 g",
        calories: fact.per100g.calories,
        macros: {
          protein: fact.per100g.protein,
          carbs: fact.per100g.carbs,
          fat: fact.per100g.fat,
        },
        confidence: "high",
        needsConfirmation: false,
      },
    ],
    warning: `Observation : valeurs pour 100 g issues d'Open Food Facts (code-barres ${fact.code}), pas de la photo.${portion}`,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

const PROMPTS: Record<VisionIntent, (c: UserConstraints) => string> = {
  plate: platePrompt,
  fridge: fridgePrompt,
  label: nutritionLabelPrompt,
  groceries: groceriesPrompt,
};

const ASK: Record<VisionIntent, string> = {
  plate: "Analyse cette assiette.",
  fridge: "Relève ce que contient ce frigo ou ce placard.",
  label: "Transcris cette étiquette nutritionnelle.",
  groceries: "Relève les produits de ces courses.",
};

/** Always `confirmed: false` — only the two confirm mutations ever flip it. */
export const save = internalMutation({
  args: {
    storageId: v.id("_storage"),
    intent: visionIntent,
    items: v.array(visionItem),
    warnings: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db.insert("visionAnalyses", {
      userId: user._id,
      storageId: args.storageId,
      intent: args.intent,
      items: args.items,
      warnings: args.warnings,
      confirmed: false,
    });
  },
});

/**
 * One vision call per photo. Stores an unconfirmed row and returns the proposal —
 * it writes NOTHING to the food log or the inventory. Callable from a client or
 * from the Chef's tools via `ctx.runAction`.
 */
export const analyze = action({
  args: {
    storageId: v.id("_storage"),
    intent: visionIntent,
    // Accepted for signature parity with the other image flows and with the
    // Chef's tools; a plate has no date to resolve, so nothing reads it.
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY manquant");

    // `save` would reject an anonymous caller anyway; here it's also who the
    // vision call gets billed to.
    const user = await ctx.runQuery(api.users.me, {});
    if (!user) throw new Error("Non authentifié");

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Photo introuvable");

    // Only the hard constraints cross into the prompt — see `constraintsBlock`.
    const profile = await ctx.runQuery(api.nutrition.profile, {});
    const constraints: UserConstraints = {
      allergies: profile?.allergies,
      excluded: profile?.excluded,
      ...(profile?.diet !== undefined && { diet: profile.diet }),
      ...(profile !== null && { goal: profile.goal }),
    };

    const { object, usage, providerMetadata } = await generateObject({
      // `usage.include` asks OpenRouter for the real cost; `user` is its
      // anti-abuse identifier, not the measurement.
      model: createOpenRouter({ apiKey }).chat(MODEL_ID, {
        user: user._id,
        usage: { include: true },
      }),
      schema: zVision,
      // Extraction, not creativity: the same photo must not read differently twice.
      temperature: 0,
      system: PROMPTS[args.intent](constraints),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ASK[args.intent] },
            {
              type: "image",
              image: new Uint8Array(await blob.arrayBuffer()),
              mediaType: blob.type || "image/jpeg",
            },
          ],
        },
      ],
    });

    await ctx.runMutation(internal.aiUsage.record, {
      userId: user._id,
      feature: "vision",
      model: MODEL_ID,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
      costUsd: costUsdFrom(providerMetadata),
    });

    const normalized = normalizeVision(object, args.intent);
    let items = normalized.items;
    const warnings = [...normalized.warnings];

    // A legible barcode on a label beats the photographed table (contract §6b).
    // Wrapped: Open Food Facts having a bad day must degrade to the OCR values,
    // never fail an analysis the user already paid a vision call for.
    if (args.intent === "label" && normalized.barcode) {
      try {
        const fact = await foodByBarcode(normalized.barcode);
        if (fact) {
          const applied = applyBarcodeFact(fact);
          items = applied.items;
          warnings.push(applied.warning);
        }
      } catch (error) {
        console.error("foodByBarcode a échoué, on garde les valeurs de la photo", error);
      }
    }

    const analysisId: Id<"visionAnalyses"> = await ctx.runMutation(internal.vision.save, {
      storageId: args.storageId,
      intent: args.intent,
      items,
      warnings,
    });
    return { analysisId, intent: args.intent, items, warnings, source: "image" as const };
  },
});

/**
 * Whether this analysis is still awaiting confirmation, and where to see the
 * photo. The card lives in a permanent message stream, so its state has to come
 * from here rather than from React — a reload must not bring back a card that
 * was already confirmed or discarded.
 *
 * `null` means the row is gone (discarded) or isn't the caller's. `url` is null
 * once the blob has been deleted, which happens on both confirm and discard.
 */
export const status = query({
  args: { analysisId: v.id("visionAnalyses") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const analysis = await ctx.db.get("visionAnalyses", args.analysisId);
    if (!analysis || analysis.userId !== user._id) return null;
    return { confirmed: analysis.confirmed, url: await ctx.storage.getUrl(analysis.storageId) };
  },
});

/** The three guards every confirmation shares: authenticated, owner, not already done. */
async function claimAnalysis(ctx: MutationCtx, analysisId: Id<"visionAnalyses">) {
  const user = await requireCurrentUser(ctx);
  const analysis = await ctx.db.get("visionAnalyses", analysisId);
  if (!analysis || analysis.userId !== user._id) throw new Error("Analyse introuvable");
  if (analysis.confirmed) throw new Error("Analyse déjà confirmée");
  return { user, analysis };
}

/**
 * The only path from a photo to the food log. `items` is what the user edited in
 * the card, NOT what the model produced — that's the whole point of the
 * unconfirmed row.
 */
export const confirmToLog = mutation({
  args: {
    analysisId: v.id("visionAnalyses"),
    date: v.string(),
    slot: mealSlot,
    items: v.array(visionItem),
  },
  handler: async (ctx, args) => {
    const { user, analysis } = await claimAnalysis(ctx, args.analysisId);

    // Inserted here rather than through `api.nutrition.addLogEntry`: that would
    // be one sub-transaction and one auth lookup per item for the same three
    // lines. `clampMacros` is imported so the plausibility rules stay in one
    // place, which is the part that actually matters.
    let logged = 0;
    for (const item of args.items) {
      const name = item.name.trim();
      if (name === "") continue;
      await ctx.db.insert("foodLog", {
        userId: user._id,
        date: args.date,
        slot: args.slot,
        name,
        ...(item.quantityEstimate !== undefined && { quantity: item.quantityEstimate }),
        // Missing numbers land as 0: the user saw the card and chose to log it
        // anyway, and a 0 they can correct beats refusing the entry.
        macros: clampMacros({
          calories: item.calories ?? 0,
          protein: item.macros?.protein ?? 0,
          carbs: item.macros?.carbs ?? 0,
          fat: item.macros?.fat ?? 0,
        }),
        source: "image",
      });
      logged += 1;
    }

    await ctx.db.patch("visionAnalyses", analysis._id, { items: args.items, confirmed: true });
    // The numbers are out; the photo has no reason to stay in storage.
    await ctx.storage.delete(analysis.storageId);
    return { logged };
  },
});

/** Same contract as `confirmToLog`, for the inventory. */
export const confirmToInventory = mutation({
  args: { analysisId: v.id("visionAnalyses"), items: v.array(visionItem) },
  // Annotated because the handler calls back into `api`, whose type includes this
  // module: without it TypeScript reports a circular inference error here and
  // collapses the whole generated API to `any`.
  handler: async (ctx, args): Promise<{ count: number }> => {
    const { analysis } = await claimAnalysis(ctx, args.analysisId);

    // Reused rather than reimplemented: `setInventory` already merges by
    // normalised name and knows that patching `undefined` deletes a quantity.
    const { count }: { count: number } = await ctx.runMutation(api.nutrition.setInventory, {
      items: args.items
        .map((item) => ({
          name: item.name.trim(),
          ...(item.quantityEstimate !== undefined && { quantity: item.quantityEstimate }),
        }))
        .filter((item) => item.name !== ""),
      mode: "add",
    });

    await ctx.db.patch("visionAnalyses", analysis._id, { items: args.items, confirmed: true });
    await ctx.storage.delete(analysis.storageId);
    return { count };
  },
});

/** Abandon: nothing was committed, so drop the row and the photo with it. */
export const discard = mutation({
  args: { analysisId: v.id("visionAnalyses") },
  handler: async (ctx, args) => {
    const { analysis } = await claimAnalysis(ctx, args.analysisId);
    await ctx.storage.delete(analysis.storageId);
    await ctx.db.delete("visionAnalyses", analysis._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Recipes from what's in the kitchen
// ---------------------------------------------------------------------------

const zRecipes = z.object({
  recipes: z.array(
    z.object({
      name: z.string(),
      ingredients: z.array(z.object({ name: z.string(), quantity: z.string() })),
      steps: z.array(z.string()),
      prepMinutes: z.number(),
      macros: z.object({
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
      }),
    }),
  ),
});

/**
 * Backs the Chef's `suggest_recipes_from_ingredients`. No image, no write — it
 * proposes, the Chef presents, `savePlan` or the log persist if the user says so.
 */
export const suggestRecipes = action({
  args: { ingredients: v.array(v.string()), constraints: v.array(v.string()) },
  // Annotated for the same circular-inference reason as `confirmToInventory`.
  handler: async (ctx, args): Promise<z.infer<typeof zRecipes>> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY manquant");
    const user = await ctx.runQuery(api.users.me, {});
    if (!user) throw new Error("Non authentifié");

    const { object, usage, providerMetadata } = await generateObject({
      model: createOpenRouter({ apiKey }).chat(MODEL_ID, {
        user: user._id,
        usage: { include: true },
      }),
      schema: zRecipes,
      temperature: 0,
      system: recipeFromIngredientsPrompt(args.ingredients, args.constraints),
      prompt: "Propose des recettes réalisables avec ces ingrédients.",
    });

    await ctx.runMutation(internal.aiUsage.record, {
      userId: user._id,
      feature: "vision",
      model: MODEL_ID,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
      costUsd: costUsdFrom(providerMetadata),
    });

    // ponytail: 3 recipes, the ceiling the prompt already asks for. Same clamps
    // as a planned meal, so a suggestion can be saved into a plan unchanged.
    return {
      recipes: object.recipes.slice(0, 3).map((recipe) => ({
        ...recipe,
        prepMinutes: Math.max(0, Math.min(600, Math.round(recipe.prepMinutes))),
        macros: clampMacros(recipe.macros),
      })),
    };
  },
});
