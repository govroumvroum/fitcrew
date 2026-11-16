import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, internalMutation } from "./_generated/server";
import { type FoodValues, type Macros, type Unit, normalizeName } from "./portionLogic";
import { macros } from "./schema";
import { requireCurrentUser } from "./users";

/**
 * The per-user food reference (#138, decision C): what one ingredient is worth,
 * per 100 g and/or per piece, and where that number comes from.
 *
 * Precedence: a photographed label or an Open Food Facts product replaces
 * anything; the model's estimate only fills a gap and never overwrites them. An
 * estimate is written once and then reused, so the same ingredient is worth the
 * same all week.
 */

export type FoodRef = Doc<"foodRefs">;

/** Every distinct name, looked up once. Bounded by the meals being written. */
export async function refsFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  names: Iterable<string>,
): Promise<Map<string, FoodRef>> {
  const out = new Map<string, FoodRef>();
  for (const key of new Set([...names].map(normalizeName))) {
    if (!key) continue;
    const row = await ctx.db
      .query("foodRefs")
      .withIndex("by_user_and_name_key", (q) => q.eq("userId", userId).eq("nameKey", key))
      .unique();
    if (row) out.set(key, row);
  }
  return out;
}

export const valuesOf = (ref: FoodRef | undefined): FoodValues | undefined =>
  ref && {
    ...(ref.per100 && { per100: ref.per100 }),
    ...(ref.perPiece && { perPiece: ref.perPiece }),
    ...(ref.pieceGrams && { pieceGrams: ref.pieceGrams }),
  };

/** The model's guess for one ingredient, on the basis of the unit it wrote. */
export type Estimate = { name: string; unit: Unit; macros: Macros };

const clampMacro = (m: Macros, max: number): Macros => ({
  calories: Math.min(Math.max(m.calories, 0), max * 9),
  protein: Math.min(Math.max(m.protein, 0), max),
  carbs: Math.min(Math.max(m.carbs, 0), max),
  fat: Math.min(Math.max(m.fat, 0), max),
});

/**
 * Writes the model's estimates for the ingredients the reference doesn't know
 * yet, and adds them to `refs` so the caller computes with them right away.
 * An ingredient already known — by any source — is left alone.
 *
 * Per 100 g can't exceed 100 g of anything (900 kcal is pure fat); a piece is
 * bounded at 1 kg's worth.
 */
export async function recordEstimates(
  ctx: MutationCtx,
  userId: Id<"users">,
  estimates: Estimate[],
  refs: Map<string, FoodRef>,
): Promise<string[]> {
  const written: string[] = [];
  for (const estimate of estimates) {
    const nameKey = normalizeName(estimate.name);
    if (!nameKey || refs.has(nameKey)) continue;
    const values =
      estimate.unit === "piece"
        ? { perPiece: clampMacro(estimate.macros, 1000) }
        : { per100: clampMacro(estimate.macros, 100) };
    const row = { userId, nameKey, name: estimate.name.trim(), source: "estimate" as const, ...values };
    const id = await ctx.db.insert("foodRefs", row);
    refs.set(nameKey, { _id: id, _creationTime: Date.now(), ...row });
    written.push(row.name);
  }
  return written;
}

/**
 * `save_food_ref`: the Chef records a label it read or an Open Food Facts
 * product he picked. Replaces whatever was there, estimate included — that's
 * the point of photographing the pack. The user comes from the session, never
 * from the model.
 */
export const save = internalMutation({
  args: {
    name: v.string(),
    per100: v.optional(macros),
    perPiece: v.optional(macros),
    pieceGrams: v.optional(v.number()),
    source: v.union(v.literal("label"), v.literal("off")),
    offCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const nameKey = normalizeName(args.name);
    if (!nameKey) return { result: "refused" as const, note: "Nom d'ingrédient vide." };
    if (!args.per100 && !args.perPiece) {
      return {
        result: "refused" as const,
        note: "Rien n'a été enregistré : il faut des valeurs pour 100 g ou pour une pièce.",
      };
    }
    const pieceGrams =
      args.pieceGrams !== undefined && args.pieceGrams > 0 && args.pieceGrams <= 2000
        ? args.pieceGrams
        : undefined;
    const row = {
      userId: user._id,
      nameKey,
      name: args.name.trim(),
      source: args.source,
      ...(args.per100 && { per100: clampMacro(args.per100, 100) }),
      ...(args.perPiece && { perPiece: clampMacro(args.perPiece, 1000) }),
      ...(pieceGrams !== undefined && { pieceGrams }),
      ...(args.offCode && { offCode: args.offCode }),
    };
    const existing = (await refsFor(ctx, user._id, [args.name])).get(nameKey);
    // `replace`, not `patch`: a label read per 100 g must drop the per-piece
    // estimate it supersedes, or the two would disagree.
    if (existing) await ctx.db.replace("foodRefs", existing._id, row);
    else await ctx.db.insert("foodRefs", row);
    return {
      result: "ok" as const,
      name: row.name,
      replaced: existing ? existing.source : null,
      note: "Les prochains repas qui utilisent cet ingrédient seront calculés avec ces valeurs. Les repas déjà au plan ne changent pas tant qu'on ne les réécrit pas.",
    };
  },
});
