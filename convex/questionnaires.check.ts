/** Self-check for the questionnaire boundary. Run: `bun convex/questionnaires.check.ts` */
import assert from "node:assert/strict";
import { assertOpen, missingFields, sanitizeAnswers, toProfileArgs } from "./questionnaireAnswers";

const complete = {
  goal: "perte",
  age: 34,
  sex: "h",
  heightCm: 181,
  weightKg: 78,
  activityLevel: "modere",
  allergies: [],
  excluded: [],
  mealsPerDay: 3,
};

// A complete form submits, and produces exactly the keys `saveProfile` accepts —
// the unanswered optionals ABSENT, never undefined: Convex `patch` deletes a key
// set to undefined, which would erase a diet the user gave last time.
{
  const answers = sanitizeAnswers(complete);
  assert.deepEqual(missingFields(answers), []);
  const args = toProfileArgs(answers);
  assert.deepEqual(Object.keys(args).sort(), [
    "activityLevel",
    "age",
    "allergies",
    "excluded",
    "goal",
    "heightCm",
    "mealsPerDay",
    "sex",
    "weightKg",
  ]);
  assert.ok(!("diet" in args));
  assert.ok(!("budget" in args));
  assert.ok(!("cookMinutes" in args));
  assert.ok(!("people" in args));
  assert.deepEqual(args.allergies, []);
}

// The optionals travel when they're answered.
{
  const args = toProfileArgs(
    sanitizeAnswers({
      ...complete,
      diet: " végétarien ",
      budget: "serré",
      cookMinutes: 30,
      people: 2,
    }),
  );
  assert.equal(args.diet, "végétarien");
  assert.equal(args.budget, "serré");
  assert.equal(args.cookMinutes, 30);
  assert.equal(args.people, 2);
}

// Empty allergies / excluded are a real answer (« aucune »), not a blocker.
{
  const answers = sanitizeAnswers({ ...complete, allergies: [], excluded: [] });
  assert.deepEqual(missingFields(answers), []);
  assert.deepEqual(toProfileArgs(answers).excluded, []);
}

// A half-filled form names what's missing, in French, and nothing else.
{
  const answers = sanitizeAnswers({ goal: "prise", age: 28, sex: "f", diet: "halal" });
  assert.deepEqual(missingFields(answers), [
    "taille",
    "poids",
    "niveau d'activité",
    "nombre de repas par jour",
  ]);
  assert.throws(() => toProfileArgs(answers), /Il manque : taille, poids/);
}

// The client writes `answers`, so junk is dropped silently: wrong types,
// out-of-range measurements, unknown keys, blank free text.
{
  const answers = sanitizeAnswers({
    goal: "musculation", // not one of the three
    age: 4, // below the schema's floor
    heightCm: 900,
    weightKg: "78", // a string where a number belongs
    sex: "h",
    mealsPerDay: 12, // above the schema's ceiling
    diet: "   ", // blank is « aucun », i.e. absent — never ""
    budget: null,
    people: 2.5, // not an integer
    favoriteColor: "bleu", // unknown key
  });
  assert.deepEqual(answers, { sex: "h" });
  assert.ok(!("diet" in answers));
}

// Array entries are cleaned one by one: a bad entry must not cost the whole list.
{
  const answers = sanitizeAnswers({
    allergies: ["  arachide ", "", 42, null, "lactose"],
    excluded: "porc", // not a list at all
  });
  assert.deepEqual(answers.allergies, ["arachide", "lactose"]);
  assert.ok(!("excluded" in answers));
}

// Non-objects don't throw — a client can send anything.
assert.deepEqual(sanitizeAnswers(null), {});
assert.deepEqual(sanitizeAnswers("nope"), {});

// The duplicate-submission guard: a validated card can never be resubmitted, and
// an abandoned one never comes back to life.
assert.throws(() => assertOpen("completed"), /déjà validé/);
assert.throws(() => assertOpen("abandoned"), /abandonné/);
assert.doesNotThrow(() => assertOpen("open"));

console.log("questionnaire boundary ok");
