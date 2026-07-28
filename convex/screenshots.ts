import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { type Infer, v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./users";

/** One edit swaps the vision model everywhere. */
export const VISION_MODEL = "openai/gpt-5.6-luna";

const source = v.union(v.literal("apple_health"), v.literal("zepp"), v.literal("mi_fitness"));

/**
 * The shape the confirmation UI edits and the confirm mutation commits.
 * `screenshots.extracted` is `v.any()` in the schema, so this validator is the
 * only place the shape is enforced — both on the way out of the model and on
 * the way back in from the client.
 */
const entry = v.object({
  source,
  type: v.union(v.literal("workout"), v.literal("cardio"), v.literal("bodyweight")),
  date: v.string(), // YYYY-MM-DD
  exercises: v.optional(
    v.array(
      v.object({
        name: v.string(),
        sets: v.array(v.object({ weight: v.number(), reps: v.number() })),
      }),
    ),
  ),
  duration_min: v.optional(v.number()),
  distance_km: v.optional(v.number()),
  avg_hr: v.optional(v.number()),
  calories: v.optional(v.number()),
  weight_kg: v.optional(v.number()),
});

export type Source = Infer<typeof source>;
export type Entry = Infer<typeof entry>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

// Every field is required-and-nullable: strict structured outputs reject
// optional keys, and "null" is what lets the model say "not visible" instead of
// inventing a number.
const zEntry = z.object({
  source: z.enum(["apple_health", "zepp", "mi_fitness"]),
  type: z.enum(["workout", "cardio", "bodyweight"]),
  date: z.string().nullable().describe("YYYY-MM-DD, null si aucune date lisible"),
  exercises: z
    .array(
      z.object({
        name: z.string(),
        sets: z.array(z.object({ weight: z.number(), reps: z.number() })),
      }),
    )
    .nullable(),
  duration_min: z.number().nullable(),
  distance_km: z.number().nullable(),
  avg_hr: z.number().nullable(),
  calories: z.number().nullable(),
  weight_kg: z.number().nullable(),
});

const zExtraction = z.object({ entries: z.array(zEntry) });

const APP_HINTS: Record<Source, string> = {
  apple_health: `App : Apple Santé / Apple Health (iOS).
- Les listes « Entraînements » / « Workouts » ont une ligne par séance : type de sport, durée, kcal, parfois distance. Une ligne = une entrée.
- Le poids est sous « Poids » / « Weight » : un graphe avec la dernière valeur en gros. Ne lis QUE la valeur affichée en chiffres, jamais un point du graphe.
- IGNORE : anneaux d'activité, pourcentages d'objectif, pas, étages, moyennes hebdomadaires, « Tendance ».`,
  zepp: `App : Zepp / Amazfit.
- Écran de détail de séance : gros en-tête (type de sport + durée), puis des tuiles (distance, FC moyenne en bpm, calories, allure).
- Les séances de muscu listent les exercices avec « séries x répétitions » et le poids par série. Si le poids n'est pas affiché pour une série, mets 0 plutôt que de deviner.
- IGNORE : PAI, charge d'entraînement, effet aérobie/anaérobie, VO2max, score de sommeil, récupération.`,
  mi_fitness: `App : Mi Fitness / Xiaomi Health.
- Tuiles de détail de séance très proches de Zepp : durée, distance, FC moy., calories.
- Attention : « Calories » peut être doublé en « Calories actives » / « Consommation totale ». Prends la valeur principale affichée pour la séance, une seule fois.
- IGNORE : objectifs de pas, temps debout, score de sommeil, « Vitalité ».`,
};

function systemPrompt(today: string, hint?: Source) {
  return `Tu transcris des captures d'écran d'applications de fitness. Tu es un OCR structuré, PAS un analyste.

RÈGLES ABSOLUES
1. Ne rapporte QUE des valeurs lisibles en chiffres sur l'image. Si une valeur n'est pas visible, mets null.
2. Ne calcule, ne déduis, ne moyenne, n'extrapole JAMAIS une valeur. Un champ null est BEAUCOUP plus utile qu'un nombre inventé.
3. Chiffre coupé, flou ou ambigu → null.
4. Une entrée par séance / ligne / jour distinct visible. Une capture peut donc contenir plusieurs entrées (liste sur plusieurs jours).
5. Ne renvoie aucune entrée pour ce qui n'est pas une séance, un cardio ou une pesée.

UNITÉS (seule exception à la règle 2, la conversion est obligatoire)
- Poids affiché en lb/lbs → kg (x 0,4536). Affiché en kg → tel quel.
- Distance en mi/miles → km (x 1,609). En m → km (/ 1000).
- Durée en h:mm ou « 1 h 05 » → minutes entières. Ignore les secondes.
- Virgule décimale française : « 8,5 » vaut 8.5.

DATES
- Aujourd'hui est le ${today}. « Aujourd'hui »/« Today » → cette date, « Hier »/« Yesterday » → la veille, un jour de la semaine seul → l'occurrence la plus récente.
- Format YYYY-MM-DD. Année absente → l'année de ${today}. Aucune date lisible → null.

TYPES
- "workout" : séance de muscu avec des exercices (séries, répétitions, charge).
- "cardio" : course, vélo, marche, rameur… (durée / distance / FC / calories).
- "bodyweight" : une pesée (weight_kg).

VOCABULAIRE (les UI sont en français OU en anglais, les deux se mélangent)
- Durée / Duration / Temps / Time → duration_min
- Distance / Dist. → distance_km
- FC moy. / Fréq. cardiaque moyenne / Avg HR / Average heart rate / bpm → avg_hr
- Calories / kcal / Énergie active / Active energy → calories
- Poids / Weight / Masse → weight_kg
- Séries / Sets / Reps / Répétitions / Charge / Load → exercises[].sets
- Allure / Pace / Cadence / Pas / Steps / Sommeil / Sleep → à ignorer, pas de champ pour ça.

${hint ? APP_HINTS[hint] : `L'app n'est pas connue à l'avance : identifie-la (barre d'état, typographie, couleurs, libellés) et remplis "source". Repères :\n${Object.values(APP_HINTS).join("\n")}`}`;
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

// A misread digit (a stray "1" prefix, a bpm read as calories) shows up as an
// absurd magnitude. Drop the FIELD, never the whole entry — the user still gets
// the rest and can retype what's missing.
const LIMITS = {
  duration_min: 1440,
  distance_km: 500,
  avg_hr: 250,
  calories: 20000,
  weight_kg: 400,
} as const;

function plausible(field: keyof typeof LIMITS, n: number | null): number | undefined {
  if (n === null || !Number.isFinite(n) || n <= 0 || n > LIMITS[field]) return undefined;
  return n;
}

/**
 * Model output -> what we are willing to store. Exported for the self-check in
 * `src/components/import/extraction.check.ts`.
 */
export function normalizeExtraction(raw: unknown, today: string): Entry[] {
  const parsed = zExtraction.safeParse(raw);
  if (!parsed.success) throw new Error(`Extraction illisible : ${parsed.error.message}`);

  // ponytail: 30 entries is more than any screenshot holds. Paginate the
  // review UI before raising it.
  return parsed.data.entries.slice(0, 30).flatMap((e) => {
    const exercises = (e.exercises ?? [])
      .map((ex) => ({
        name: ex.name.trim(),
        sets: ex.sets.filter((s) => s.reps > 0 && s.weight >= 0),
      }))
      .filter((ex) => ex.name !== "" && ex.sets.length > 0);

    const duration_min = plausible("duration_min", e.duration_min);
    const distance_km = plausible("distance_km", e.distance_km);
    const avg_hr = plausible("avg_hr", e.avg_hr);
    const calories = plausible("calories", e.calories);
    const weight_kg = plausible("weight_kg", e.weight_kg);

    const empty =
      exercises.length === 0 &&
      [duration_min, distance_km, avg_hr, calories, weight_kg].every((n) => n === undefined);
    if (empty) return [];

    return [
      {
        source: e.source,
        type: e.type,
        date: /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") ? e.date! : today,
        ...(exercises.length > 0 && { exercises }),
        ...(duration_min !== undefined && { duration_min }),
        ...(distance_km !== undefined && { distance_km }),
        ...(avg_hr !== undefined && { avg_hr }),
        ...(calories !== undefined && { calories }),
        ...(weight_kg !== undefined && { weight_kg }),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Always `confirmed: false` — only `confirm` below ever flips it. */
export const save = internalMutation({
  args: { storageId: v.id("_storage"), source: v.optional(source), extracted: v.array(entry) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db.insert("screenshots", {
      userId: user._id,
      storageId: args.storageId,
      source: args.source,
      extracted: args.extracted,
      confirmed: false,
    });
  },
});

/**
 * One vision call per screenshot. Stores an unconfirmed row and hands the
 * entries back for review — it commits NOTHING to the user's profile.
 * Callable from a client or from another action via `ctx.runAction`.
 */
export const extract = action({
  args: {
    storageId: v.id("_storage"),
    source: v.optional(source),
    /** Caller's local date, YYYY-MM-DD — the model needs it to resolve "hier". */
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY manquant");

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Capture introuvable");

    const today = /^\d{4}-\d{2}-\d{2}$/.test(args.today ?? "")
      ? args.today!
      : new Date().toISOString().slice(0, 10);

    const { object } = await generateObject({
      model: createOpenRouter({ apiKey }).chat(VISION_MODEL),
      schema: zExtraction,
      temperature: 0,
      system: systemPrompt(today, args.source),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcris cette capture." },
            {
              type: "image",
              image: new Uint8Array(await blob.arrayBuffer()),
              mediaType: blob.type || "image/jpeg",
            },
          ],
        },
      ],
    });

    const entries = normalizeExtraction(object, today);
    const screenshotId: Id<"screenshots"> = await ctx.runMutation(internal.screenshots.save, {
      storageId: args.storageId,
      source: args.source ?? entries[0]?.source,
      extracted: entries,
    });
    return { screenshotId, entries };
  },
});

/** The only path from an extraction to the user's profile. Explicit, once. */
/**
 * Whether this capture is still awaiting review, and where to see it.
 *
 * The review card lives in the message stream, which is permanent — so its state
 * has to come from here, not from React. Reloading used to bring every form
 * back, including ones already imported or cancelled.
 *
 * `null` means the row is gone, i.e. it was discarded. `confirm` sets the flag,
 * `discard` deletes the row, so those two cases are distinguishable.
 */
export const status = query({
  args: { screenshotId: v.id("screenshots") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const shot = await ctx.db.get("screenshots", args.screenshotId);
    if (!shot || shot.userId !== user._id) return null;
    return {
      confirmed: shot.confirmed,
      url: await ctx.storage.getUrl(shot.storageId),
    };
  },
});

export const confirm = mutation({
  args: { screenshotId: v.id("screenshots"), entries: v.array(entry) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const shot = await ctx.db.get("screenshots", args.screenshotId);
    if (!shot || shot.userId !== user._id) throw new Error("Capture introuvable");
    if (shot.confirmed) throw new Error("Capture déjà importée");

    await ctx.db.patch("screenshots", args.screenshotId, {
      extracted: args.entries,
      source: args.entries[0]?.source ?? shot.source,
      confirmed: true,
    });

    let workouts = 0;
    for (const e of args.entries) {
      if (e.type !== "workout" || !e.exercises?.length) continue;
      const workoutId = await ctx.db.insert("workouts", {
        userId: user._id,
        date: e.date,
        // ponytail: noon UTC — an imported screenshot has no start time and
        // midnight would flip the day in half the timezones.
        startedAt: Date.parse(`${e.date}T12:00:00Z`),
        notes: "Importé d'une capture",
      });
      for (const ex of e.exercises) {
        let index = 0;
        for (const s of ex.sets) {
          await ctx.db.insert("sets", {
            workoutId,
            userId: user._id,
            exerciseName: ex.name,
            index: index++,
            weight: s.weight,
            reps: s.reps,
            completed: true,
          });
        }
      }
      workouts++;
    }
    // ponytail: cardio and bodyweight entries stay on the screenshots row —
    // the schema has no table for them yet. Add `cardio` / `bodyweight` tables
    // and insert here.
    return { workouts };
  },
});

/** Cancel: nothing was committed, so drop the row and the file with it. */
export const discard = mutation({
  args: { screenshotId: v.id("screenshots") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const shot = await ctx.db.get("screenshots", args.screenshotId);
    if (!shot || shot.userId !== user._id) throw new Error("Capture introuvable");
    if (shot.confirmed) throw new Error("Capture déjà importée");
    await ctx.storage.delete(shot.storageId);
    await ctx.db.delete("screenshots", args.screenshotId);
    return null;
  },
});
