/**
 * Self-check for the pure parts of convex/coach.ts — `lookupHistory`,
 * `activeLineages`, and the circuit round-trip (schema -> toDays -> render).
 * Run: `bun convex/coach.check.ts`
 */
import assert from "node:assert/strict";
import {
  activeLineages,
  activeProgramsNote,
  editInDays,
  editRefusal,
  lookupHistory,
  renderProgram,
  resolveProgram,
  swapInDays,
  systemPrompt,
  toDays,
} from "./coach";
import { circuitErrors, zEditProgram, zGenerateProgram, zSwapExercise } from "./toolSchemas";
import type { Doc } from "./_generated/dataModel";

type Status = "active" | "archived" | "completed";
let t = 0;
const row = (id: string, name: string, version: number, lineageId?: string, status?: Status) => ({
  _id: id,
  _creationTime: ++t,
  name,
  version,
  ...(lineageId ? { lineageId } : {}),
  ...(status ? { status } : {}),
});

// Full body: active lineage with 3 versions (v3 is latest).
const fullBody = [
  row("fb1", "Full Body 3 jours", 1, "fb1", "active"),
  row("fb2", "Full Body 3 jours", 2, "fb1", "active"),
  row("fb3", "Full Body 3 jours", 3, "fb1", "active"),
];
// Boxe: archived lineage.
const boxe = [
  row("bx1", "Boxe explosivité", 1, "bx1", "archived"),
  row("bx2", "Boxe explosivité", 2, "bx1", "archived"),
];
// Legacy row: no lineageId, no status — the `?? _id` / `?? "active"` contract.
const legacy = [row("old1", "Programme historique", 1)];
// Completed lineage.
const done = [row("c1", "Prépa marathon", 1, "c1", "completed")];
const rows = [...fullBody, ...boxe, ...legacy, ...done];

// (a) Old version of an active lineage, by name + version.
let r = lookupHistory(rows, { name: "full body 3 jours", version: 2 });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "fb2");
  assert.equal(r.status, "active");
  assert.deepEqual(r.versions, [1, 2, 3]);
}

// No version asked: the latest of the lineage.
r = lookupHistory(rows, { name: "Full Body 3 jours" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.row._id, "fb3");

// (b) Archived lineage found by substring, status explicit — never "not found".
r = lookupHistory(rows, { name: "boxe" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "bx2");
  assert.equal(r.status, "archived");
}

// Completed status comes back as-is.
r = lookupHistory(rows, { name: "Prépa marathon" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.status, "completed");

// Legacy row without lineageId/status: lineage is its own id, status defaults active.
r = lookupHistory(rows, { name: "Programme historique" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.lineageId, "old1");
  assert.equal(r.status, "active");
}

// Lookup by lineageId, exact version.
r = lookupHistory(rows, { lineageId: "bx1", version: 1 });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.row._id, "bx1");

// Missing version: explicit, with what DOES exist.
r = lookupHistory(rows, { name: "Boxe explosivité", version: 7 });
assert.equal(r.result, "version_not_found");
if (r.result === "version_not_found") assert.deepEqual(r.versions, [1, 2]);

// An exact hit does NOT bury its longer-named siblings: the coach's context
// only lists active programs, so « Boxe » is how it asks for an archived
// « Boxe explosivité » it can't see and can't name.
const sibling = [...rows, row("bxa", "Boxe", 1, "bxa")];
r = lookupHistory(sibling, { name: "Boxe" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "bxa");
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Boxe explosivité"],
  );
}
// …including when the version asked for doesn't exist: it may well live in the
// sibling the exact match shadowed.
r = lookupHistory(sibling, { name: "Boxe", version: 2 });
assert.equal(r.result, "version_not_found");
if (r.result === "version_not_found") {
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Boxe explosivité"],
  );
}
// …and a lone exact hit carries no siblings.
r = lookupHistory(rows, { name: "Full Body 3 jours" });
if (r.result === "found") assert.deepEqual(r.otherMatches, []);

// Ambiguous name: two lineages named the same — candidates listed, none picked.
const twins = [...rows, row("fb9", "Full Body 3 jours", 1, "fb9", "archived")];
r = lookupHistory(twins, { name: "Full Body 3 jours" });
assert.equal(r.result, "ambiguous");
if (r.result === "ambiguous") {
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(new Set(r.candidates.map((c) => c.lineageId)), new Set(["fb1", "fb9"]));
}
// Ambiguity doesn't drop the shadowed siblings either: « Full Body » here is
// two exact twins AND a longer-named third program.
r = lookupHistory([...twins, row("fbx", "Full Body 3 jours express", 1, "fbx")], {
  name: "Full Body 3 jours",
});
assert.equal(r.result, "ambiguous");
if (r.result === "ambiguous") {
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Full Body 3 jours express"],
  );
}
// …and disambiguated by lineageId.
r = lookupHistory(twins, { lineageId: "fb9" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.status, "archived");

// Exact match wins over substring: "Boxe" exact must not collide with "Boxe explosivité".
const near = [...rows, row("b9", "Boxe", 1, "b9", "active")];
r = lookupHistory(near, { name: "Boxe" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.lineageId, "b9");

// Unknown name: not_found, with the user's lineages listed so the coach can ask.
r = lookupHistory(rows, { name: "Yoga" });
assert.equal(r.result, "not_found");
if (r.result === "not_found") assert.equal(r.programs.length, 4);

// Foreign/garbage lineageId (user isolation is index-scoped upstream; here it
// simply matches nothing): explicit not_found, never someone else's rows.
r = lookupHistory(rows, { lineageId: "someone_elses_id" });
assert.equal(r.result, "not_found");

// No selector at all with several programs: ambiguous, not a silent pick.
r = lookupHistory(rows, {});
assert.equal(r.result, "ambiguous");

// ---------------------------------------------------------------------------
// activeLineages — what `read_programs` renders, now that the prompt doesn't.
// ---------------------------------------------------------------------------

// One row per lineage, latest version only, archived and completed dropped. The
// legacy row (no status) counts as active — that's the `?? "active"` contract.
const active = activeLineages(rows);
assert.deepEqual(
  active.map((p) => `${p.name} v${p.version}`),
  ["Programme historique v1", "Full Body 3 jours v3"],
);

// An empty lineage list is an empty result, never a fallback to "everything":
// `read_programs` says "aucun programme" and the coach must not invent one.
assert.deepEqual(activeLineages([]), []);

// Every row archived: still empty, and in particular NOT the archived rows.
assert.deepEqual(activeLineages(boxe), []);

// ---------------------------------------------------------------------------
// activeProgramsNote — the cap has to be IN the note, not just in `truncated`.
// ---------------------------------------------------------------------------

// Nothing active: the note forbids inventing a program, and says nothing about a cap.
assert.match(activeProgramsNote(0), /Aucun programme en cours/);
assert.doesNotMatch(activeProgramsNote(0), /ATTENTION/);

// At or under the cap: the plain note, no warning.
for (const n of [1, 5]) {
  assert.match(activeProgramsNote(n), /EN PARALLÈLE/);
  assert.doesNotMatch(activeProgramsNote(n), /ATTENTION/);
}

// Over the cap: how many exist, how many are rendered, and the way out.
const capped = activeProgramsNote(7);
assert.match(capped, /ATTENTION/);
assert.match(capped, /7 programmes actifs/);
assert.match(capped, /seuls 5 sont rendus/);
assert.match(capped, /lookup_program_history/);

// The rendered count is a parameter, not a hardcoded 5 in the prose.
assert.match(activeProgramsNote(4, 2), /il a 4 programmes actifs et seuls 2 sont rendus/);

// ---------------------------------------------------------------------------
// Circuits — schema -> toDays -> renderProgram, and what the schema refuses
// ---------------------------------------------------------------------------

type ModelExercise = Parameters<typeof toDays>[0][number]["exercises"][number];
const ex = (name: string, over: Partial<ModelExercise> = {}): ModelExercise => ({
  name,
  sets: 4,
  reps: "10",
  restSeconds: 90,
  notes: null,
  circuit: null,
  slot: null,
  restBetweenRoundsSeconds: null,
  ...over,
});
const inCircuit = (name: string, slot: string, over: Partial<ModelExercise> = {}) =>
  ex(name, {
    circuit: "A",
    slot,
    sets: 4,
    restSeconds: 30,
    restBetweenRoundsSeconds: 120,
    ...over,
  });

const program = (days: { name: string; exercises: ModelExercise[] }[]) =>
  ({
    name: "Test",
    version: 1,
    days: toDays(days),
    progressionRules: "+2,5 kg",
  }) as unknown as Doc<"programs">;

// (a) A classic program renders EXACTLY as it did before circuits existed, and
// stores exactly the same keys — that's the whole no-migration promise.
const classicDays = toDays([
  {
    name: "Jour 1 — Push",
    exercises: [ex("Développé couché"), ex("Dips", { sets: 3, reps: "8-12", restSeconds: 60 })],
  },
]);
assert.deepEqual(classicDays, [
  {
    name: "Jour 1 — Push",
    exercises: [
      { name: "Développé couché", sets: 4, reps: "10", restSeconds: 90 },
      { name: "Dips", sets: 3, reps: "8-12", restSeconds: 60 },
    ],
  },
]);
assert.equal(
  renderProgram(program([{ name: "Jour 1 — Push", exercises: [ex("Développé couché")] }]), false),
  `« Test » (v1, 1 jours)
[jour 0] Jour 1 — Push
  1. Développé couché — 4×10 (repos 90s)
Progression : +2,5 kg
Deload : non défini`,
);

// (a') A timed exercise: « corde à sauter 3×60 s » is `durationSec: 60`, and the
// null the strict schema returns for every other exercise stores nothing at all.
const timedDays = toDays([
  {
    name: "Jour 1 — Cardio",
    exercises: [
      ex("Corde à sauter", { sets: 3, reps: "60 s", restSeconds: 60, durationSec: 60 }),
      ex("Pompes", { durationSec: null }),
    ],
  },
]);
assert.deepEqual(timedDays[0].exercises, [
  { name: "Corde à sauter", sets: 3, reps: "60 s", restSeconds: 60, durationSec: 60 },
  { name: "Pompes", sets: 4, reps: "10", restSeconds: 90 },
]);
// The schema takes it, and still takes an exercise that never heard of it.
assert.equal(
  zGenerateProgram.safeParse({
    name: "P",
    progressionRules: "x",
    deloadEveryWeeks: null,
    days: [
      {
        name: "J",
        exercises: [
          ex("Corde à sauter", { reps: "60 s", durationSec: 60 }),
          ex("Squat"),
          { name: "Dips", sets: 3, reps: "8", restSeconds: 60, notes: null },
        ],
      },
    ],
  }).success,
  true,
);

// (b) A circuit survives generate -> toDays -> render: label, order, tours, and
// the two rest kinds, which a reader must not confuse.
const circuitDay = {
  name: "Jour 1 — Circuit",
  exercises: [
    ex("Squat"),
    inCircuit("Pompes", "A1", { reps: "15" }),
    inCircuit("Abdos", "A2", { reps: "20" }),
    inCircuit("Tractions", "A3", { reps: "8" }),
  ],
};
assert.equal(
  zGenerateProgram.safeParse({
    name: "P",
    progressionRules: "x",
    deloadEveryWeeks: null,
    days: [circuitDay],
  }).success,
  true,
);
assert.equal(
  renderProgram(program([circuitDay]), false),
  `« Test » (v1, 1 jours)
[jour 0] Jour 1 — Circuit
  1. Squat — 4×10 (repos 90s)
  Circuit A — 4 tours, dans l'ordre :
    2. Pompes — 15 (repos 30s avant l'exo suivant)
    3. Abdos — 20 (repos 30s avant l'exo suivant)
    4. Tractions — 8
    repos entre les tours : 120s
Progression : +2,5 kg
Deload : non défini`,
);

// The regression this whole issue exists to prevent: `sets` doubles as the round
// count, so any renderer that keeps the `4×10` form on a circuit exercise tells
// the user "four straight sets then move on" — the opposite of a circuit. The
// count belongs in the block header, as tours, and nowhere else.
const circuitRender = renderProgram(program([circuitDay]), false);
assert.match(circuitRender, /Circuit A — 4 tours/);
for (const line of circuitRender.split("\n").filter((l) => /Pompes|Abdos|Tractions/.test(l)))
  assert.doesNotMatch(line, /\d+×/, `un exercice de circuit rendu en séries×reps : ${line}`);

// Nulls never reach the document, and the metadata does.
const stored = toDays([circuitDay])[0].exercises;
assert.deepEqual(stored[0], {
  name: "Squat",
  sets: 4,
  reps: "10",
  restSeconds: 90,
});
assert.deepEqual(stored[1], {
  name: "Pompes",
  sets: 4,
  reps: "15",
  restSeconds: 30,
  circuit: "A",
  slot: "A1",
  restBetweenRoundsSeconds: 120,
});

// (c) The same exercise twice in one circuit stays two distinguishable rows.
const twice = toDays([
  {
    name: "Jour 1",
    exercises: [
      inCircuit("Pompes", "A1", { reps: "15" }),
      inCircuit("Gainage", "A2", { reps: "30s" }),
      inCircuit("Pompes", "A3", { reps: "10" }),
    ],
  },
])[0].exercises;
assert.deepEqual(
  twice.map((e) => e.slot),
  ["A1", "A2", "A3"],
);
assert.equal(twice.filter((e) => e.name === "Pompes").length, 2);

// (d) What the schema refuses. Each is a circuit the séance screen could not run.
const day = (exercises: ModelExercise[]) => ({
  name: "Jour 1",
  exercises,
});
const rejects = (exercises: ModelExercise[], why: RegExp) => {
  const r = zGenerateProgram.safeParse({
    name: "P",
    progressionRules: "x",
    deloadEveryWeeks: null,
    days: [day(exercises)],
  });
  assert.equal(r.success, false, `attendu rejeté : ${why}`);
  assert.match(r.error?.issues.map((i) => i.message).join(" | ") ?? "", why);
};

// One exercise alone under a label is not a circuit.
rejects([inCircuit("Pompes", "A1"), ex("Squat"), ex("Rowing")], /qu'un exercice/);
// `sets` is the round count: it can't differ inside a circuit.
rejects(
  [inCircuit("Pompes", "A1"), inCircuit("Abdos", "A2", { sets: 3 }), ex("Squat")],
  /nombre de TOURS/,
);
// A circuit exercise without a slot has no identity in the séance.
rejects([inCircuit("Pompes", "A1"), inCircuit("Abdos", "  "), ex("Squat")], /`slot` non vide/);
// Two occurrences claiming the same slot would merge in the séance log.
rejects([inCircuit("Pompes", "A1"), inCircuit("Abdos", "A1"), ex("Squat")], /portent le slot/);
// Interrupted then resumed: array order IS the circuit, so this is unrunnable.
rejects([inCircuit("Pompes", "A1"), ex("Squat"), inCircuit("Abdos", "A2")], /interrompu/);

// A swap has no day context; the one rule it can enforce is circuit ⇒ slot.
assert.equal(
  zSwapExercise.safeParse({
    dayIndex: 0,
    from: "Pompes",
    to: inCircuit("Dips", "A1"),
  }).success,
  true,
);
assert.equal(
  zSwapExercise.safeParse({
    dayIndex: 0,
    from: "Pompes",
    to: ex("Dips", { circuit: "A" }),
  }).success,
  false,
);

// (e) The second write path. `swap_exercise` rewrites a day without ever going
// through `zGenerateProgram`, so the same invariants are re-checked on the
// RESULTING day — the swap validator sees one exercise and cannot know any of
// this. `swapInDays` is what the mutation calls, so testing it tests the guard.
const swapDay = toDays([
  {
    name: "Jour 1 — Circuit",
    exercises: [
      ex("Squat"),
      inCircuit("Pompes", "A1", { reps: "15" }),
      inCircuit("Abdos", "A2", { reps: "20" }),
    ],
  },
]);
const swapTo = (name: string, over: Partial<ModelExercise> = {}) =>
  toDays([{ name: "x", exercises: [ex(name, over)] }])[0].exercises[0];

// A slot already taken by another exercise of the day.
assert.throws(
  () => swapInDays(swapDay, 0, "Pompes", swapTo("Dips", { circuit: "A", slot: "A2", sets: 4 })),
  /portent le slot/,
);
// `sets` is the round count: a swap can't disagree with the rest of the circuit.
assert.throws(
  () => swapInDays(swapDay, 0, "Pompes", swapTo("Dips", { circuit: "A", slot: "A1", sets: 3 })),
  /nombre de TOURS/,
);
// Swapping a member of a 2-exercise circuit out leaves a circuit of one.
assert.throws(() => swapInDays(swapDay, 0, "Pompes", swapTo("Dips")), /qu'un exercice/);
// A legitimate swap inside the circuit goes through…
const swappedIn = swapInDays(
  swapDay,
  0,
  "Pompes",
  swapTo("Dips", { circuit: "A", slot: "A1", sets: 4, restBetweenRoundsSeconds: 120 }),
);
assert.deepEqual(
  swappedIn[0].exercises.map((e) => e.name),
  ["Squat", "Dips", "Abdos"],
);
// …and so does a classic swap outside it.
assert.equal(swapInDays(swapDay, 0, "Squat", swapTo("Presse"))[0].exercises[0].name, "Presse");
// A day with no circuit at all is untouched by any of this.
assert.equal(swapInDays(classicDays, 0, "Dips", swapTo("Pompes"))[0].exercises[1].name, "Pompes");

// The pure function under it all: valid day, no messages.
assert.deepEqual(circuitErrors(swapDay[0].exercises), []);
assert.equal(circuitErrors([{ sets: 4, circuit: "A", slot: "A1" }]).length, 1);

// ---------------------------------------------------------------------------
// editInDays — the third write path (#107): operations on one day
// ---------------------------------------------------------------------------

// Day 0 classic, day 1 the circuit day of the swap tests above.
const editDays = [
  ...toDays([
    { name: "Jour 1 — Push", exercises: [ex("Développé couché"), ex("Dips", { sets: 3 })] },
  ]),
  swapDay[0],
];
const corde = swapTo("Corde à sauter", { sets: 3, reps: "3 min", restSeconds: 60 });
const namesOf = (days: typeof editDays, i: number) => days[i].exercises.map((e) => e.name);

// Add at the end (no position), the other day untouched, the input not mutated.
let edited = editInDays(editDays, 0, [{ op: "add", exercise: corde }]);
assert.deepEqual(namesOf(edited, 0), ["Développé couché", "Dips", "Corde à sauter"]);
assert.deepEqual(edited[0].exercises[2], {
  name: "Corde à sauter",
  sets: 3,
  reps: "3 min",
  restSeconds: 60,
});
assert.equal(edited[1], editDays[1]);
assert.equal(editDays[0].exercises.length, 2, "l'original ne doit pas être muté");

// Add at a position.
edited = editInDays(editDays, 0, [{ op: "add", exercise: corde, position: 0 }]);
assert.deepEqual(namesOf(edited, 0), ["Corde à sauter", "Développé couché", "Dips"]);
assert.throws(
  () => editInDays(editDays, 0, [{ op: "add", exercise: corde, position: 5 }]),
  /Position 5 hors limites/,
);

// Remove, matched like swapInDays (case and whitespace don't matter).
edited = editInDays(editDays, 0, [{ op: "remove", name: " dips " }]);
assert.deepEqual(namesOf(edited, 0), ["Développé couché"]);

// Update: only the given fields move, the name never does.
edited = editInDays(editDays, 0, [
  {
    op: "update",
    name: "Dips",
    changes: { sets: 5, reps: "6-8", restSeconds: 150, notes: "lesté" },
  },
]);
assert.deepEqual(edited[0].exercises[1], {
  name: "Dips",
  sets: 5,
  reps: "6-8",
  restSeconds: 150,
  notes: "lesté",
});
// "" clears a note; absent leaves it alone.
assert.equal(
  editInDays(edited, 0, [{ op: "update", name: "Dips", changes: { notes: "" } }])[0].exercises[1]
    .notes,
  undefined,
);
assert.equal(
  editInDays(edited, 0, [{ op: "update", name: "Dips", changes: { sets: 4 } }])[0].exercises[1]
    .notes,
  "lesté",
);
// A rename is refused — loads and records are keyed by the exact name (#103)…
assert.throws(
  () =>
    editInDays(editDays, 0, [
      { op: "update", name: "Dips", changes: { name: "Dips lestés", sets: 4 } },
    ]),
  /ne renomme jamais/,
);
// …but restating the same name is not a rename.
assert.equal(
  editInDays(editDays, 0, [{ op: "update", name: "Dips", changes: { name: "dips", sets: 2 } }])[0]
    .exercises[1].name,
  "Dips",
);
// And the tool schema has no field to send one through: zod strips it.
const parsedRename = zEditProgram.parse({
  lineageId: "x",
  dayIndex: 0,
  operations: [{ op: "update", name: "Dips", changes: { name: "Dips lestés", sets: 4 } }],
});
assert.equal("name" in (parsedRename.operations[0] as { changes: object }).changes, false);

// Operations apply in order: remove then add at the freed position is a move.
edited = editInDays(editDays, 0, [
  { op: "remove", name: "Dips" },
  { op: "add", exercise: swapTo("Dips", { sets: 3 }), position: 0 },
]);
assert.deepEqual(namesOf(edited, 0), ["Dips", "Développé couché"]);

// Unknown exercise: says which, and lists what the day has.
assert.throws(
  () => editInDays(editDays, 0, [{ op: "remove", name: "Squat" }]),
  /« Squat » introuvable.*Développé couché, Dips/,
);
assert.throws(
  () => editInDays(editDays, 0, [{ op: "update", name: "Squat", changes: { sets: 3 } }]),
  /introuvable/,
);
// Unknown day: an error naming the range, never another day edited.
assert.throws(
  () => editInDays(editDays, 2, [{ op: "add", exercise: corde }]),
  /Jour 2 introuvable.*2 jour\(s\)/,
);
// Duplicate add outside a circuit: the model re-adding what's there.
assert.throws(
  () => editInDays(editDays, 0, [{ op: "add", exercise: swapTo("dips") }]),
  /déjà dans/,
);
// A day emptied entirely is refused: removing days is out of scope.
assert.throws(
  () =>
    editInDays(editDays, 0, [
      { op: "remove", name: "Dips" },
      { op: "remove", name: "Développé couché" },
    ]),
  /plus aucun exercice/,
);

// Circuits, checked on the day AFTER the operations. Day 1 is Squat + circuit A
// (Pompes A1, Abdos A2), 4 rounds.
// Removing one of two members leaves a circuit of one.
assert.throws(() => editInDays(editDays, 1, [{ op: "remove", name: "Abdos" }]), /qu'un exercice/);
// Adding a classic exercise in the middle of the block interrupts it.
assert.throws(
  () => editInDays(editDays, 1, [{ op: "add", exercise: swapTo("Presse"), position: 2 }]),
  /interrompu/,
);
// Adding into the circuit with a different round count.
const intoA = (over: Partial<ModelExercise>) =>
  swapTo("Gainage", { circuit: "A", slot: "A3", sets: 4, restSeconds: 30, ...over });
assert.throws(
  () => editInDays(editDays, 1, [{ op: "add", exercise: intoA({ sets: 3 }) }]),
  /nombre de TOURS/,
);
// Updating one member's sets alone breaks the rounds too.
assert.throws(
  () => editInDays(editDays, 1, [{ op: "update", name: "Pompes", changes: { sets: 5 } }]),
  /nombre de TOURS/,
);
// A slot already taken.
assert.throws(
  () => editInDays(editDays, 1, [{ op: "add", exercise: intoA({ slot: "A1" }) }]),
  /portent le slot/,
);
// A well-formed add at the end of the circuit goes through…
edited = editInDays(editDays, 1, [{ op: "add", exercise: intoA({}) }]);
assert.deepEqual(namesOf(edited, 1), ["Squat", "Pompes", "Abdos", "Gainage"]);
// …as does the same exercise twice in one circuit, which is two slots.
edited = editInDays(editDays, 1, [
  { op: "add", exercise: swapTo("Pompes", { circuit: "A", slot: "A3", sets: 4 }) },
]);
assert.deepEqual(namesOf(edited, 1), ["Squat", "Pompes", "Abdos", "Pompes"]);
// …and changing every round count together keeps the circuit valid.
edited = editInDays(editDays, 1, [
  { op: "update", name: "Pompes", changes: { sets: 5 } },
  { op: "update", name: "Abdos", changes: { sets: 5 } },
]);
assert.deepEqual(
  edited[1].exercises.map((e) => e.sets),
  [4, 5, 5],
);
// …but a name listed twice can't be targeted: which one?
assert.throws(
  () =>
    editInDays(
      editInDays(editDays, 1, [
        { op: "add", exercise: swapTo("Pompes", { circuit: "A", slot: "A3", sets: 4 }) },
      ]),
      1,
      [{ op: "remove", name: "Pompes" }],
    ),
  /apparaît 2 fois/,
);

// ---------------------------------------------------------------------------
// resolveProgram — which program the two write tools act on
// ---------------------------------------------------------------------------

// Found by lineageId, and by exact name — the latest row's status comes back.
let target = resolveProgram(rows, { lineageId: "fb1" });
assert.equal(target.result, "found");
if (target.result === "found") {
  assert.equal(target.lineageId, "fb1");
  assert.equal(target.status, "active");
}
target = resolveProgram(rows, { name: "boxe explosivité" });
assert.equal(target.result, "found");
if (target.result === "found") assert.equal(target.status, "archived");
// Legacy row without lineageId/status: its own lineage, active.
target = resolveProgram(rows, { name: "Programme historique" });
assert.equal(target.result, "found");
if (target.result === "found") {
  assert.equal(target.lineageId, "old1");
  assert.equal(target.status, "active");
}
// Unknown name: nothing to write, the user's programs listed so the coach asks.
target = resolveProgram(rows, { name: "Yoga" });
assert.equal(target.result, "not_found");
assert.match("error" in target ? target.error : "", /Rien n'a été modifié/);
// Someone else's lineageId: `rows` is the caller's own, so it matches nothing.
target = resolveProgram(rows, { lineageId: "someone_elses_id" });
assert.equal(target.result, "not_found");
// Two lineages with the same name: ambiguous, nothing picked.
target = resolveProgram(twins, { name: "Full Body 3 jours" });
assert.equal(target.result, "ambiguous");
if (target.result === "ambiguous") assert.equal(target.candidates.length, 2);
// An exact hit with a longer-named sibling is ALSO ambiguous for a write, where
// `lookupHistory` would have answered "found".
target = resolveProgram(sibling, { name: "Boxe" });
assert.equal(target.result, "ambiguous");
if (target.result === "ambiguous")
  assert.deepEqual(
    target.candidates.map((c) => c.name),
    ["Boxe", "Boxe explosivité"],
  );
// …and a lineageId settles it.
assert.equal(resolveProgram(sibling, { lineageId: "bxa" }).result, "found");
// No selector at all: the tool never picks for him, even with one program.
assert.equal(resolveProgram(fullBody, {}).result, "missing_selector");

// Editing an archived or completed program is refused, pointing at the fix.
assert.equal(editRefusal("Full Body", "active"), null);
assert.equal(editRefusal("Vieux", undefined), null, "une ligne sans statut est active");
assert.match(editRefusal("Boxe", "archived") ?? "", /archivé.*set_program_status/);
assert.match(editRefusal("Marathon", "completed") ?? "", /terminé.*set_program_status/);

// ---------------------------------------------------------------------------
// The prompt rule the issue makes an acceptance criterion
// ---------------------------------------------------------------------------

const prompt = systemPrompt({ name: "Basile" } as unknown as Doc<"users">, "2026-08-14");
assert.match(prompt, /Tu ne transformes JAMAIS en silence une séance classique en circuit/);
assert.match(prompt, /Tu annonces la structure que tu proposes/);
assert.match(prompt, /UNIQUEMENT quand le profil, l'objectif ou la demande le réclament/);
assert.match(prompt, /`sets` EST le nombre de tours/);
// #107: nothing claimed without the tool that did it, no app feature invented,
// and a modification is an edit, not a second program.
assert.match(prompt, /Ne dis JAMAIS « c'est fait »/);
assert.match(
  prompt,
  /sans avoir appelé l'outil qui le fait, DANS CE TOUR, et sans qu'il ait réussi/,
);
assert.match(prompt, /On ne peut PAS modifier un programme à la main dans l'app/);
assert.match(prompt, /c'est `edit_program`, jamais `generate_program`/);
assert.match(prompt, /« Supprime-le » veut dire archiver/);
assert.match(prompt, /`set_program_status`/);
// The old advice that sent him to create a second program is gone.
assert.doesNotMatch(prompt, /Utilise `swap_exercise`, ou dis-lui/);

console.log(
  "convex/coach.ts lookupHistory + activeLineages + activeProgramsNote + circuits + editInDays + resolveProgram ok",
);
