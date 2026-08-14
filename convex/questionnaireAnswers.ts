/**
 * The questionnaire's pure boundary: zod and types only, NO Convex server
 * imports — same contract as `chefToolSchemas.ts`, and for the same reason. The
 * card imports `sanitizeAnswers` and `missingFields` at runtime to disable a
 * submit button that the server would refuse, and pulling `_generated/server`
 * and `./users` into the client bundle to do it would be absurd.
 */
import type { z } from "zod";
import type { Doc } from "./_generated/dataModel";
import { TYPED_KEYS, zQuestionKey, zSaveNutritionProfile } from "./chefToolSchemas";

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

// ---------------------------------------------------------------------------
// The questions themselves (written by the model, so: a trust boundary)
// ---------------------------------------------------------------------------

type QuestionKey = z.infer<typeof zQuestionKey>;

/** One card question. `options: null` = the user types (see `TYPED_KEYS`). */
export type Question = {
  key: QuestionKey;
  label: string;
  options: { value: string; label: string; hint: string | null }[] | null;
  multiple: boolean;
};

/** The card can only ask 13 things: one per profile field. */
const MAX_QUESTIONS = zQuestionKey.options.length;
const TYPED = new Set<string>(TYPED_KEYS);
/** The only two answers that are a LIST, so the only two that can be ticked twice. */
const MULTI = new Set<string>(["allergies", "excluded"]);
/** The keys whose answer is a number once `toAnswers` has parsed the draft string. */
const NUMERIC = new Set<string>([
  "age",
  "heightCm",
  "weightKg",
  "mealsPerDay",
  "cookMinutes",
  "people",
]);

/**
 * The card holds a draft of `Record<key, string>` and `toAnswers` converts on the
 * way out — numbers parsed, the two lists comma-split, the rest as-is. So an
 * option's `value` is only usable if it survives that same trip: this replays it
 * rather than restating the ranges, which live in `zSaveNutritionProfile`.
 */
function usableValue(key: QuestionKey, value: string): boolean {
  const converted = MULTI.has(key) ? value.split(",") : NUMERIC.has(key) ? Number(value) : value;
  // `sanitizeAnswers` keeps the key only if the value is a real answer for it.
  return key in sanitizeAnswers({ [key]: converted });
}

/**
 * The model writes the questions, so nothing here can be trusted: a question the
 * card cannot answer is worse than a question it never asked. Everything bad is
 * dropped silently — a partly usable card still gets the profile written.
 */
export function sanitizeQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  const questions: Question[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;

    // THE case `zQuestionKey` exists for: an invented key would write a profile
    // field that doesn't exist, and fail silently all the way down.
    const parsed = zQuestionKey.safeParse(source.key);
    if (!parsed.success) continue;
    const key = parsed.data;
    // First one wins: asking the same thing twice gives two answers for one field.
    if (seen.has(key)) continue;

    const label = typeof source.label === "string" ? source.label.trim() : "";
    if (label === "") continue;

    // The typed three open a keyboard, so options would be dead pixels even if
    // the model insisted on sending some.
    const typed = TYPED.has(key);
    const options = typed ? null : cleanOptions(key, source.options);
    if (!typed && options === null) continue;

    seen.add(key);
    questions.push({
      key,
      label,
      options,
      multiple: MULTI.has(key) && source.multiple === true,
    });
    if (questions.length === MAX_QUESTIONS) break;
  }

  return questions;
}

/** `null` = unusable, and its question dies with it: a chip nobody can tap. */
function cleanOptions(key: QuestionKey, raw: unknown): Question["options"] {
  if (!Array.isArray(raw)) return null;

  // Bad options go one by one; the 2..4 rule is applied to what's left, so one
  // hallucinated value doesn't cost the three good ones next to it.
  const options: NonNullable<Question["options"]> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const label = typeof source.label === "string" ? source.label.trim() : "";
    const value = typeof source.value === "string" ? source.value.trim() : "";
    if (label === "" || value === "" || !usableValue(key, value)) continue;
    if (options.some((o) => o.value === value)) continue;
    const hint = typeof source.hint === "string" ? source.hint.trim() : "";
    options.push({ value, label, hint: hint === "" ? null : hint });
  }

  // One option is not a choice, five turn the card back into the wall it replaced.
  return options.length >= 2 && options.length <= 4 ? options : null;
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
