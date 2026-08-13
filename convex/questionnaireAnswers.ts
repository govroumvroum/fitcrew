/**
 * The questionnaire's pure boundary: zod and types only, NO Convex server
 * imports — same contract as `chefToolSchemas.ts`, and for the same reason. The
 * card imports `sanitizeAnswers` and `missingFields` at runtime to disable a
 * submit button that the server would refuse, and pulling `_generated/server`
 * and `./users` into the client bundle to do it would be absurd.
 */
import type { z } from "zod";
import type { Doc } from "./_generated/dataModel";
import { zSaveNutritionProfile } from "./chefToolSchemas";

type Profile = z.infer<typeof zSaveNutritionProfile>;

/**
 * What the card holds while it's being filled in: the nutrition profile, every
 * field optional. Derived from `zSaveNutritionProfile` so the two can't drift —
 * `NonNullable` because the model's strict-output nulls have no place here, an
 * unanswered question is an ABSENT key.
 */
export type Answers = Partial<{ [K in keyof Profile]: NonNullable<Profile[K]> }>;

const SHAPE = zSaveNutritionProfile.shape;

/** Everything but the two arrays, which need per-entry cleaning of their own. */
const SCALARS = [
  "goal",
  "age",
  "sex",
  "heightCm",
  "weightKg",
  "activityLevel",
  "diet",
  "mealsPerDay",
  "budget",
  "cookMinutes",
  "people",
] as const;

const strings = (raw: unknown) =>
  Array.isArray(raw)
    ? raw
        .filter((e) => typeof e === "string")
        .map((e) => e.trim())
        .filter((e) => e !== "")
    : undefined;

/**
 * The trust boundary: the client writes `answers`, so junk must never reach the
 * table. Unknown keys, wrong types and out-of-range numbers are dropped
 * SILENTLY — a half-typed form is the normal case, not an error to report.
 * Ranges come from `zSaveNutritionProfile` rather than being restated here.
 */
export function sanitizeAnswers(raw: unknown): Answers {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const answers: Record<string, unknown> = {};

  for (const key of SCALARS) {
    const value = typeof source[key] === "string" ? source[key].trim() : source[key];
    // A blank `diet` or `budget` is « aucun », i.e. absent — never the empty
    // string, which would render as an answered question.
    if (value === undefined || value === null || value === "") continue;
    const parsed = SHAPE[key].safeParse(value);
    if (parsed.success && parsed.data !== null) answers[key] = parsed.data;
  }

  for (const key of ["allergies", "excluded"] as const) {
    // One bad entry drops that entry, not the whole list: an empty array is a
    // real answer (« aucune ») and losing it would block the submit.
    const list = strings(source[key]);
    if (list) answers[key] = list;
  }

  return answers as Answers;
}

/**
 * The seven answers without which no profile can exist: `nutritionProfile` in
 * schema.ts declares them non-optional, and `estimateTargets` cannot compute a
 * single target without age, sex, height and weight.
 *
 * Everything else is genuinely optional — an empty `allergies` means « aucune »,
 * and diet / budget / cookMinutes / people are `v.optional` in the table.
 */
const REQUIRED = {
  goal: "objectif",
  age: "âge",
  sex: "sexe",
  heightCm: "taille",
  weightKg: "poids",
  activityLevel: "niveau d'activité",
  mealsPerDay: "nombre de repas par jour",
} as const;

export function missingFields(a: Answers): string[] {
  return Object.entries(REQUIRED)
    .filter(([key]) => a[key as keyof typeof REQUIRED] === undefined)
    .map(([, label]) => label);
}

/** Both the duplicate-submission guard and the « ne resoumets pas » of the card. */
export function assertOpen(status: Doc<"questionnaires">["status"]) {
  if (status === "completed") throw new Error("Questionnaire déjà validé.");
  if (status === "abandoned") throw new Error("Questionnaire abandonné.");
}

/** The args `api.nutrition.saveProfile` accepts, or a throw naming what's missing. */
export function toProfileArgs(a: Answers) {
  const { goal, age, sex, heightCm, weightKg, activityLevel, mealsPerDay } = a;
  if (
    goal === undefined ||
    age === undefined ||
    sex === undefined ||
    heightCm === undefined ||
    weightKg === undefined ||
    activityLevel === undefined ||
    mealsPerDay === undefined
  ) {
    throw new Error(`Il manque : ${missingFields(a).join(", ")}`);
  }
  return {
    goal,
    age,
    sex,
    heightCm,
    weightKg,
    activityLevel,
    mealsPerDay,
    allergies: a.allergies ?? [],
    excluded: a.excluded ?? [],
    // Absent, not undefined: Convex `patch` DELETES a key set to `undefined`, so
    // an unanswered budget would erase the one the user gave last time (same
    // trap as `save_nutrition_profile`, see the comment in `saveProfile`).
    ...(a.diet !== undefined && { diet: a.diet }),
    ...(a.budget !== undefined && { budget: a.budget }),
    ...(a.cookMinutes !== undefined && { cookMinutes: a.cookMinutes }),
    ...(a.people !== undefined && { people: a.people }),
  };
}
