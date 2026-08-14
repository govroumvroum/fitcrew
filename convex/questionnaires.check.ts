/** Self-check for the questionnaire boundary. Run: `bun convex/questionnaires.check.ts` */
import assert from "node:assert/strict";
import {
  assertOpen,
  missingFields,
  sanitizeAnswers,
  sanitizeQuestions,
  toProfileArgs,
} from "./questionnaireAnswers";

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

// --- The questions, written by the model ------------------------------------

const goal = {
  key: "goal",
  label: " Ton objectif ? ",
  options: [
    { value: "perte", label: "Perdre du gras", hint: null },
    { value: "prise", label: "Prendre du muscle", hint: "  " },
  ],
  multiple: null,
};

// A well-formed question comes back trimmed, with `multiple` forced to a boolean.
{
  const [q] = sanitizeQuestions([goal]);
  assert.equal(q?.label, "Ton objectif ?");
  assert.equal(q?.multiple, false);
  assert.deepEqual(
    q?.options?.map((o) => o.value),
    ["perte", "prise"],
  );
  assert.equal(q?.options?.[0]?.hint, null);
}

// THE case the enum exists for: an invented key would write a profile field that
// doesn't exist, silently.
assert.deepEqual(
  sanitizeQuestions([
    { key: "favoriteColor", label: "Ta couleur ?", options: goal.options, multiple: null },
  ]),
  [],
);

// A question nobody can answer is dropped: no options, or a single one.
assert.deepEqual(sanitizeQuestions([{ ...goal, options: [] }]), []);
assert.deepEqual(sanitizeQuestions([{ ...goal, options: null }]), []);
assert.deepEqual(sanitizeQuestions([{ ...goal, options: [goal.options[0]] }]), []);
// Blank label, same fate.
assert.deepEqual(sanitizeQuestions([{ ...goal, label: "   " }]), []);

// The typed three open a keyboard, so their options are dead pixels even when the
// model insists on sending some.
{
  const [q] = sanitizeQuestions([
    {
      key: "age",
      label: "Ton âge ?",
      options: [
        { value: "25", label: "25 ans", hint: null },
        { value: "35", label: "35 ans", hint: null },
      ],
      multiple: null,
    },
  ]);
  assert.equal(q?.key, "age");
  assert.equal(q?.options, null);
}

// An option whose value can't become a valid answer for its key is dropped, one
// by one — and the question dies when fewer than two survive.
{
  const [q] = sanitizeQuestions([
    {
      key: "goal",
      label: "Ton objectif ?",
      options: [
        { value: "recomposition", label: "Recomp", hint: null }, // not one of the three
        { value: "perte", label: "Perdre du gras", hint: null },
        { value: "maintien", label: "Maintenir", hint: null },
      ],
      multiple: null,
    },
  ]);
  assert.deepEqual(
    q?.options?.map((o) => o.value),
    ["perte", "maintien"],
  );
}
assert.deepEqual(
  sanitizeQuestions([
    {
      key: "mealsPerDay",
      label: "Combien de repas ?",
      options: [
        { value: "beaucoup", label: "Beaucoup", hint: null }, // not a number
        { value: "12", label: "Douze", hint: null }, // above the ceiling
        { value: "3", label: "Trois", hint: null },
      ],
      multiple: null,
    },
  ]),
  [],
);

// Five options is the wall the card replaced; the question goes with them.
assert.deepEqual(
  sanitizeQuestions([
    {
      key: "activityLevel",
      label: "Ton activité ?",
      options: ["sedentaire", "leger", "modere", "actif", "tres_actif"].map((value) => ({
        value,
        label: value,
        hint: null,
      })),
      multiple: null,
    },
  ]),
  [],
);

// Duplicate keys collapse on the first: two answers for one field is a bug.
{
  const questions = sanitizeQuestions([goal, { ...goal, label: "Et sinon, ton objectif ?" }]);
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.label, "Ton objectif ?");
}

// `multiple` only means something for the two lists.
{
  const [multi] = sanitizeQuestions([
    {
      key: "allergies",
      label: "Des allergies ?",
      options: [
        { value: "arachide", label: "Arachide", hint: null },
        { value: "lactose", label: "Lactose", hint: "beurre, crème…" },
      ],
      multiple: true,
    },
  ]);
  assert.equal(multi?.multiple, true);
  assert.equal(multi?.options?.[1]?.hint, "beurre, crème…");
  assert.equal(sanitizeQuestions([{ ...goal, multiple: true }])[0]?.multiple, false);
}

// The model can send anything, including nothing that is a list.
assert.deepEqual(sanitizeQuestions(null), []);
assert.deepEqual(sanitizeQuestions({ questions: [goal] }), []);
assert.deepEqual(sanitizeQuestions(["nope", null, 42]), []);

console.log("questionnaire boundary ok");
