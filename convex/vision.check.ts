/** Self-check for the vision boundary. Run: `bun convex/vision.check.ts` */
import assert from "node:assert/strict";
import {
  applyBarcodeFact,
  fridgePrompt,
  nutritionLabelPrompt,
  normalizeVision,
  platePrompt,
} from "./vision";

/** A model answer, with every nullable field spelled out like strict output does. */
const item = (over: Record<string, unknown> = {}) => ({
  name: "Poulet rôti",
  quantityEstimate: "≈150 g",
  calories: 250,
  protein: 40,
  carbs: 0,
  fat: 9,
  confidence: "medium",
  ...over,
});

const raw = (items: unknown[], warnings: string[] = [], barcode: string | null = null) => ({
  items,
  warnings,
  barcode,
});

// A clean plate comes out as usable items: names trimmed, numbers kept.
{
  const out = normalizeVision(
    raw([item(), item({ name: "  Riz basmati  ", calories: 200, protein: 4, carbs: 44, fat: 1 })]),
    "plate",
  );
  assert.equal(out.items.length, 2);
  assert.equal(out.items[1].name, "Riz basmati");
  assert.deepEqual(out.items[0].macros, { protein: 40, carbs: 0, fat: 9 });
  assert.equal(out.items[0].calories, 250);
}

// Anything short of "high" needs the user's eyes, whatever the model claims.
{
  const out = normalizeVision(raw([item({ confidence: "low" })]), "plate");
  assert.equal(out.items[0].needsConfirmation, true);
}

// "high" + complete macros is the only combination that skips confirmation.
{
  const out = normalizeVision(raw([item({ confidence: "high" })]), "plate");
  assert.equal(out.items[0].needsConfirmation, false);
}

// A missing macro forces confirmation even at "high": two macros out of three is
// not a breakdown, so `macros` is absent entirely.
{
  const out = normalizeVision(raw([item({ confidence: "high", fat: null })]), "plate");
  assert.equal(out.items[0].macros, undefined);
  assert.equal(out.items[0].needsConfirmation, true);
}

// An absurd magnitude loses the FIELD, not the item — the user retypes one
// number instead of re-shooting the photo.
{
  const out = normalizeVision(raw([item({ confidence: "high", calories: 99999 })]), "plate");
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].calories, undefined);
  assert.equal(out.items[0].needsConfirmation, true);
  // The rest of the item survived intact.
  assert.deepEqual(out.items[0].macros, { protein: 40, carbs: 0, fat: 9 });
}

// 0 kcal is a real reading (water, black coffee), a negative one is not.
{
  const out = normalizeVision(
    raw([item({ confidence: "high", calories: 0, protein: 0, carbs: 0, fat: -1 })]),
    "plate",
  );
  assert.equal(out.items[0].calories, 0);
  assert.equal(out.items[0].macros, undefined);
}

// An unusable photo is an empty list plus a preserved warning — never a throw.
// This is what the card renders alongside the manual-entry fallback.
{
  const out = normalizeVision(
    raw([], ["Observation : image trop floue, reprends la photo"]),
    "plate",
  );
  assert.deepEqual(out.items, []);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /floue/);
}

// Empty and whitespace-only warnings and names are dropped, not shown blank.
{
  const out = normalizeVision(raw([item({ name: "   " })], ["", "   ", "vrai warning"]), "plate");
  assert.deepEqual(out.items, []);
  assert.deepEqual(out.warnings, ["vrai warning"]);
}

// The 30-item cap holds whatever the model dumps.
{
  const out = normalizeVision(
    raw(Array.from({ length: 45 }, (_, i) => item({ name: `Aliment ${i}` }))),
    "plate",
  );
  assert.equal(out.items.length, 30);
}

// Null optional fields are ABSENT from the output, not null: the confirm
// validator uses v.optional, which rejects an explicit null.
{
  const out = normalizeVision(
    raw([item({ quantityEstimate: null, calories: null, protein: null, carbs: null, fat: null })]),
    "plate",
  );
  assert.deepEqual(Object.keys(out.items[0]).sort(), ["confidence", "name", "needsConfirmation"]);
  assert.ok(!("quantityEstimate" in out.items[0]));
  assert.ok(!("calories" in out.items[0]));
}

// A fridge shelf is not a meal: the inventory intents drop the numbers even when
// the model volunteered them, so nothing invites the user to trust a kcal figure
// stuck on a jar.
{
  const out = normalizeVision(raw([item({ confidence: "high" })]), "fridge");
  assert.equal(out.items[0].calories, undefined);
  assert.equal(out.items[0].macros, undefined);
  assert.equal(out.items[0].quantityEstimate, "≈150 g");
  assert.equal(out.items[0].needsConfirmation, true);
}

// Barcodes: only a well-formed one is handed to Open Food Facts, and only the
// label intent ever asks for one.
assert.equal(normalizeVision(raw([], [], "3017620422003"), "label").barcode, "3017620422003");
assert.equal(normalizeVision(raw([], [], " 3017620422003 "), "label").barcode, "3017620422003");
assert.equal(normalizeVision(raw([], [], "301762042200?"), "label").barcode, undefined);
assert.equal(normalizeVision(raw([], [], ""), "label").barcode, undefined);
assert.equal(normalizeVision(raw([], [], null), "label").barcode, undefined);

// A database hit replaces the OCR values and stops asking for confirmation —
// with a warning that says the numbers no longer come from the photo.
{
  const applied = applyBarcodeFact({
    code: "3017620422003",
    name: "Nutella",
    brand: "Ferrero",
    servingSize: "15 g",
    per100g: { calories: 539, protein: 6.3, carbs: 57.5, fat: 30.9 },
  });
  assert.equal(applied.items.length, 1);
  assert.equal(applied.items[0].name, "Nutella — Ferrero");
  assert.equal(applied.items[0].confidence, "high");
  assert.equal(applied.items[0].needsConfirmation, false);
  assert.equal(applied.items[0].calories, 539);
  assert.equal(applied.items[0].quantityEstimate, "pour 100 g");
  assert.match(applied.warning, /Open Food Facts/);
  assert.match(applied.warning, /3017620422003/);
  assert.match(applied.warning, /15 g/);
}

// Output we cannot parse at all is a bug in the call, not a bad photo — that one
// throws rather than silently returning an empty analysis.
assert.throws(() => normalizeVision({ items: "nope" }, "plate"), /Analyse illisible/);
assert.throws(() => normalizeVision(null, "plate"), /Analyse illisible/);

// The guard-rails are in the prompt text, and a refactor must not quietly drop
// them: no invisible ingredient, no medical claim, a better photo when in doubt.
for (const prompt of [platePrompt(), fridgePrompt(), nutritionLabelPrompt()]) {
  assert.match(prompt, /visible/);
  assert.match(prompt, /Hypothèse/);
  assert.match(prompt, /ESTIMATION/i);
  assert.match(prompt, /meilleure photo/);
  assert.match(prompt, /médical/);
}

// Allergies and exclusions are injected as a doubt to raise, never as a verdict.
{
  const withAllergies = platePrompt({ allergies: ["arachide"], excluded: ["porc"], goal: "perte" });
  assert.match(withAllergies, /arachide/);
  assert.match(withAllergies, /porc/);
  assert.match(withAllergies, /perte de poids/);
  assert.match(withAllergies, /N'affirme jamais/);
  // No profile yet: no context block at all, rather than an empty heading.
  assert.ok(!platePrompt().includes("CONTEXTE UTILISATEUR"));
  assert.ok(!platePrompt({ allergies: [], excluded: [] }).includes("CONTEXTE UTILISATEUR"));
}

console.log("vision boundary ok");
