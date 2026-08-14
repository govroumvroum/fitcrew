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
  circuit: z
    .string()
    .nullish()
    .describe(
      'Label du circuit dans le jour ("A", "B"). Les exercices d\'un même circuit se suivent dans la liste. null pour un exercice classique.',
    ),
  slot: z
    .string()
    .nullish()
    .describe(
      'Identifiant unique de cette occurrence dans le jour ("A1", "A2"…). Obligatoire dès que `circuit` est renseigné, y compris si le même exercice revient deux fois.',
    ),
  restBetweenRoundsSeconds: z
    .number()
    .int()
    .min(0)
    .max(600)
    .nullish()
    .describe(
      "Repos entre deux tours du circuit, en secondes. Même valeur sur tous les exercices du circuit. null hors circuit.",
    ),
});

type Exercise = z.infer<typeof zExercise>;

/**
 * A circuit the model got subtly wrong produces an unrunnable séance, so it is
 * rejected here rather than in a downstream check: the model sees the message
 * and retries. Messages are addressed to it, in French.
 */
export function checkDayCircuits(exercises: Exercise[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const e of exercises) {
    if (!e.slot) continue;
    if (seen.has(e.slot))
      ctx.addIssue({
        code: "custom",
        message: `Deux exercices du jour portent le slot « ${e.slot} ». Chaque occurrence doit avoir un slot unique dans le jour.`,
      });
    seen.add(e.slot);
  }

  const circuits = new Map<string, number[]>();
  exercises.forEach((e, i) => {
    if (e.circuit) circuits.set(e.circuit, [...(circuits.get(e.circuit) ?? []), i]);
  });

  for (const [label, at] of circuits) {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (at.length < 2)
      issue(
        `Le circuit « ${label} » ne contient qu'un exercice : un circuit en enchaîne au moins 2, sinon c'est un exercice classique (circuit: null).`,
      );
    if (at[at.length - 1] - at[0] !== at.length - 1)
      issue(
        `Le circuit « ${label} » est interrompu par un autre exercice : les exercices d'un circuit doivent se suivre dans la liste du jour.`,
      );
    const rounds = exercises[at[0]].sets;
    if (at.some((i) => exercises[i].sets !== rounds))
      issue(
        `Les exercices du circuit « ${label} » n'ont pas le même \`sets\`. \`sets\` est le nombre de TOURS du circuit : il doit être identique pour tous ses exercices.`,
      );
    if (at.some((i) => !exercises[i].slot?.trim()))
      issue(`Chaque exercice du circuit « ${label} » doit porter un \`slot\` non vide.`);
  }
}

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
      z
        .object({
          name: z.string().describe('Ex: "Jour 1 — Push (pectoraux, épaules, triceps)"'),
          exercises: z.array(zExercise).min(3).max(10),
        })
        .superRefine((day, ctx) => checkDayCircuits(day.exercises, ctx)),
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
  // Only `circuit` ⇒ `slot` is checkable here: a swap carries one exercise and
  // no day, so slot uniqueness, order, size and the shared `sets` can't be seen.
  // The rest is enforced where the day exists, in `zGenerateProgram`.
  to: zExercise.refine((e) => !e.circuit || !!e.slot?.trim(), {
    message: "Un exercice qui appartient à un circuit doit porter un `slot` non vide.",
  }),
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
