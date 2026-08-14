/** Self-check for the choices boundary. Run: `bun convex/choices.check.ts` */
import assert from "node:assert/strict";
import { assertOpen, sanitizeAnswers, sanitizeQuestions } from "./choices";

const two = [{ label: "Oui", hint: null }, { label: "Non" }];

// A question the card cannot render is dropped whole: fewer than 2 clean options,
// more than 4, or no label at all.
{
  const questions = sanitizeQuestions([
    { label: "Une seule ?", options: [{ label: "Oui" }] },
    { label: "Cinq ?", options: "abcde".split("").map((label) => ({ label })) },
    { label: "   ", options: two },
    { label: "Pas un tableau", options: "oui" },
    { label: "Bonne question ?", options: two },
  ]);
  assert.deepEqual(
    questions.map((q) => q.label),
    ["Bonne question ?"],
  );
  assert.deepEqual(questions[0].options, [
    { label: "Oui", hint: null },
    { label: "Non", hint: null },
  ]);
  assert.equal(questions[0].multiple, false);
}

// A blank option goes alone, not with the question next to it — 3 clean out of 4.
{
  const [question] = sanitizeQuestions([
    {
      label: "Où ?",
      options: [{ label: " Salle " }, { label: "" }, { label: "Maison" }, { label: "Parc" }],
      multiple: true,
    },
  ]);
  assert.deepEqual(
    question.options.map((o) => o.label),
    ["Salle", "Maison", "Parc"],
  );
  assert.equal(question.multiple, true);
}

// Four questions asked, three kept: the tool is a small aside, not a form.
{
  const questions = sanitizeQuestions(
    [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, options: two })),
  );
  assert.deepEqual(
    questions.map((q) => q.label),
    ["Q1", "Q2", "Q3"],
  );
}

// Everything dropped leaves NOTHING, and `open` refuses to insert that rather
// than showing an empty card: `complete` is true on an empty list, so « Envoyer »
// would be enabled and would send an empty turn to the agent.
{
  assert.deepEqual(
    sanitizeQuestions([
      { label: "   ", options: two },
      { label: "Une seule option", options: [{ label: "Oui" }] },
    ]),
    [],
  );
}

const questions = sanitizeQuestions([
  { label: "Où ?", options: [{ label: "Salle" }, { label: "Maison" }] },
  { label: "Matériel ?", options: [{ label: "Haltères" }, { label: "Barre" }], multiple: true },
]);

// The three answer states stay distinct, and a label that isn't on offer is
// dropped rather than trusted — it's the client writing this.
{
  const answers = sanitizeAnswers([["Salle", "Piscine"], null], questions);
  assert.deepEqual(answers, [["Salle"], null]);
}

// `[]` is « je préfère t'expliquer » and must survive as itself, never become null.
{
  assert.deepEqual(sanitizeAnswers([[], ["Barre", "Haltères"]], questions), [
    [],
    ["Barre", "Haltères"],
  ]);
}

// Always aligned to the questions: a short, long or absent array all come back
// with one entry per question.
{
  assert.deepEqual(sanitizeAnswers([["Maison"]], questions), [["Maison"], null]);
  assert.deepEqual(sanitizeAnswers([null, null, ["Salle"]], questions), [null, null]);
  assert.deepEqual(sanitizeAnswers("n'importe quoi", questions), [null, null]);
}

// Single-choice keeps one answer, even if the client sends two.
{
  assert.deepEqual(sanitizeAnswers([["Salle", "Maison"], null], questions), [["Salle"], null]);
}

// The card can only be written once.
{
  assert.doesNotThrow(() => assertOpen("open"));
  assert.throws(() => assertOpen("completed"), /envoy/);
  assert.throws(() => assertOpen("abandoned"), /abandonn/);
}

console.log("choices ok");
