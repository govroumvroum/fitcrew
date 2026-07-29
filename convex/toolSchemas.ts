import { z } from "zod";

/**
 * The coach's tool inputSchemas, zod only — no Convex server imports, so the
 * client can `z.infer` them for the cards without pulling the backend in.
 */

export const zExercise = z.object({
  name: z.string().describe("Nom français de l'exercice, sans le nombre de séries"),
  sets: z.number().int().min(1).max(10),
  reps: z.string().describe('"8", "8-12", "AMRAP", "12 par jambe"…'),
  restSeconds: z.number().int().min(0).max(600),
  notes: z.string().nullable().describe("Tempo ou consigne courte, null si rien à dire"),
});

export const zSaveOnboarding = z.object({
  experience: z.enum(["debutant", "intermediaire", "avance"]),
  goals: z.array(z.string()).min(1).describe("Objectifs dans les mots du user"),
  sport: z.string().nullable().describe("Sport pratiqué à côté, null si aucun"),
  limitations: z.string().nullable().describe("Blessures / limitations, null si aucune"),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(15).max(180),
  equipment: z.array(z.string()).min(1),
  tone: z.enum(["motivant", "neutre", "direct"]).describe("Ton de coaching choisi par le user"),
});

export const zGenerateProgram = z.object({
  name: z.string().describe('Ex: "Push/Pull/Legs 4 jours — boxe"'),
  days: z
    .array(
      z.object({
        name: z.string().describe('Ex: "Jour 1 — Push (pectoraux, épaules, triceps)"'),
        exercises: z.array(zExercise).min(3).max(10),
      }),
    )
    .min(1)
    .max(7),
  progressionRules: z
    .string()
    .describe("Comment monter en charge/reps semaine après semaine. 2-4 phrases."),
  deloadEveryWeeks: z.number().int().min(3).max(12).nullable(),
});

export const zSwapExercise = z.object({
  dayIndex: z.number().int().min(0).describe("Index du jour, 0 = premier jour"),
  from: z.string().describe("Nom exact de l'exercice à retirer"),
  to: zExercise,
});

/** `date`'s description needs today's date — the call site `.extend()`s it in. */
export const zLogWorkout = z.object({
  date: z.string(),
  exercises: z
    .array(
      z.object({
        name: z.string(),
        sets: z
          .array(z.object({ weight: z.number().min(0), reps: z.number().int().min(1) }))
          .min(1),
      }),
    )
    .min(1),
  notes: z.string().nullable(),
});
