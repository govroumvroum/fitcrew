/**
 * Self-check for the program shape helpers in convex/coach.ts and the lineage
 * grouping in convex/programs.ts, plus the circuit blocks in src/lib/circuits.ts
 * and how a circuit renders.
 * Run: `bun src/components/chat/program.check.ts`
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { swapInDays, toDays } from "../../../convex/coach";
import { latestPerLineage, lineageMembers, lineageOf } from "../../../convex/programs";
import { daySeconds, groupCircuits } from "@/lib/circuits";
import { formatLoose } from "@/lib/dates";
import { ProgramCard } from "./tool-cards";

const squat = { name: "Squat", sets: 4, reps: "8", restSeconds: 120, notes: null };
const presse = { name: "Presse à cuisses", sets: 4, reps: "10", restSeconds: 90 };

// A null note must disappear, not land in the document as null.
const days = toDays([
  { name: "Jour 1 — Legs", exercises: [squat, { ...squat, name: "Fentes", notes: "tempo 3-1-1" }] },
]);
assert.deepEqual(days[0].exercises[0], { name: "Squat", sets: 4, reps: "8", restSeconds: 120 });
assert.equal(days[0].exercises[1].notes, "tempo 3-1-1");

// Swap replaces in place, leaves everything else identical.
const swapped = swapInDays(days, 0, "squat", presse);
assert.deepEqual(swapped[0].exercises[0], presse);
assert.deepEqual(swapped[0].exercises[1], days[0].exercises[1]);
assert.notEqual(swapped, days);
assert.equal(days[0].exercises[0].name, "Squat", "l'original ne doit pas être muté");

// Unknown exercise or day is the model hallucinating — must throw, not no-op.
assert.throws(() => swapInDays(days, 0, "Développé couché", presse), /introuvable/);
assert.throws(() => swapInDays(days, 3, "Squat", presse), /Jour 3/);

console.log("coach program helpers ok");

// ---------------------------------------------------------------------------
// Lineages: a program is a chain of versioned rows, several run in parallel.
// ---------------------------------------------------------------------------

const row = (_id: string, _creationTime: number, version: number, lineageId?: string) => ({
  _id,
  _creationTime,
  version,
  ...(lineageId ? { lineageId } : {}),
});

// A legacy row, written before lineages existed, is its own root.
assert.equal(lineageOf(row("legacy", 1, 1)), "legacy");
assert.equal(lineageOf(row("m2", 5, 2, "m1")), "m1");

// muscu (3 versions) and boxe (1), out of order, plus one unmigrated row.
const rows = [
  row("m2", 20, 2, "m1"),
  row("b1", 30, 1, "b1"),
  row("m1", 10, 1, "m1"),
  row("m3", 25, 3, "m1"),
  row("legacy", 5, 7),
];
const latest = latestPerLineage(rows);
// Highest version per lineage wins…
assert.deepEqual(
  latest.map((p) => p._id),
  ["b1", "m3", "legacy"],
);
// …and the order is by when each LINEAGE started (b1 at 30, muscu at 10, legacy
// at 5), not by its newest row — a swap must not make an old program jump up.
assert.equal(latest[1].version, 3);

// Two rows at the SAME version is a corrupted lineage, and this is why it must
// never happen: the tie goes to whichever comes first out of the index, and
// `by_user_and_lineage` is ["userId", "lineageId", "version"] — so equal
// versions come out oldest-first and the newer row is invisible on every screen,
// for good. `latestInLineage` is the one way to pick the row a new version is
// numbered from, precisely so nothing can mint a duplicate.
const tied = latestPerLineage([...rows, row("m4", 40, 3, "m1")]);
assert.equal(
  tied.find((p) => lineageOf(p) === "m1")?._id,
  "m3",
  "à version égale c'est la plus ancienne qui gagne — donc personne ne doit créer d'égalité",
);

const members = lineageMembers(rows);
assert.deepEqual([...(members.get("m1") ?? [])].sort(), ["m1", "m2", "m3"]);
assert.deepEqual([...(members.get("b1") ?? [])], ["b1"]);
// The unmigrated row answers for its own lineage, so its rotation still works.
assert.deepEqual([...(members.get("legacy") ?? [])], ["legacy"]);

console.log("program lineages ok");

// ---------------------------------------------------------------------------
// formatLoose: a date written by a model, not by us.
// ---------------------------------------------------------------------------

// The regression that failed a production build: "2026-13-40" matches the shape
// `\d{4}-\d{2}-\d{2}`, so the old shape-only guard let it through and
// `Intl.format` threw RangeError inside a card, taking the whole chat route down.
assert.equal(formatLoose("2026-13-40"), "2026-13-40");
// A date that doesn't exist but looks plausible: no 31st of February. Caught by
// the round-trip, not by the NaN test, in case an engine rolls it into March.
assert.equal(formatLoose("2026-02-31"), "2026-02-31");
// Outright garbage, and empty, come back untouched rather than throwing.
assert.equal(formatLoose("bientôt"), "bientôt");
assert.equal(formatLoose(""), "");
// A real date still formats — the guard must not cost us the happy path.
assert.equal(formatLoose("2026-08-03"), "lundi 3 août");

console.log("formatLoose ok");

// ---------------------------------------------------------------------------
// Circuits: a block is implicit in the flat exercise list.
// ---------------------------------------------------------------------------

const circuitExercise = (
  name: string,
  slot: string,
  reps: string,
  restSeconds: number,
): Parameters<typeof groupCircuits>[0][number] & {
  sets: number;
  reps: string;
  restSeconds: number;
  restBetweenRoundsSeconds: number;
  notes: null;
} => ({
  name,
  sets: 4, // 4 TOURS — the same value on every exercise of the circuit.
  reps,
  restSeconds,
  notes: null,
  circuit: "A",
  slot,
  restBetweenRoundsSeconds: 90,
});

// A classic exercise: no circuit, no slot, no between-rounds rest.
const rameur = {
  name: "Rameur",
  sets: 1,
  reps: "5 min",
  restSeconds: 60,
  notes: null,
  circuit: null,
  slot: null,
  restBetweenRoundsSeconds: null,
};
const circuitDay = [
  rameur,
  circuitExercise("Pompes", "A1", "10", 20),
  circuitExercise("Abdos", "A2", "15", 20),
  circuitExercise("Pompes", "A3", "AMRAP", 20),
  {
    ...circuitExercise("Fentes", "B1", "12", 15),
    sets: 3,
    circuit: "B",
    restBetweenRoundsSeconds: 60,
  },
  {
    ...circuitExercise("Gainage", "B2", "45 s", 15),
    sets: 3,
    circuit: "B",
    restBetweenRoundsSeconds: 60,
  },
];

const blocks = groupCircuits(circuitDay);
assert.deepEqual(
  blocks.map((b) => (b.kind === "circuit" ? `circuit ${b.label}` : b.exercise.name)),
  ["Rameur", "circuit A", "circuit B"],
  "l'ordre du jour doit être préservé, un circuit = un bloc",
);
// The same exercise twice in one circuit stays two entries, told apart by `slot`.
const blockA = blocks[1];
assert.equal(blockA.kind === "circuit" && blockA.exercises.length, 3);
assert.deepEqual(
  blockA.kind === "circuit" ? blockA.exercises.map((e) => `${e.name}/${e.slot}`) : [],
  ["Pompes/A1", "Abdos/A2", "Pompes/A3"],
);

// A day with no circuit metadata is untouched: one block per exercise, and the
// duration estimate is exactly the old `sets × (rest + 35)` sum.
const classicDay = [
  { name: "Squat", sets: 4, reps: "8", restSeconds: 120, notes: null },
  { name: "Fentes", sets: 3, reps: "10", restSeconds: 90, notes: null },
];
assert.deepEqual(
  groupCircuits(classicDay).map((b) => b.kind),
  ["exercise", "exercise"],
);
assert.equal(
  daySeconds(classicDay),
  classicDay.reduce((n, ex) => n + ex.sets * (ex.restSeconds + 35), 0),
);
// A circuit pays its between-exercises rest once per round (not once per set),
// and the between-rounds rest once per round instead of a rest after the last
// exercise. Circuit A: 4 × (3×35 + 20+20 + 90) = 4 × 235.
assert.equal(
  daySeconds(circuitDay),
  1 * (60 + 35) + 4 * (3 * 35 + 40 + 90) + 3 * (2 * 35 + 15 + 60),
);

// The regression that would come back the day someone "simplifies" the renderer:
// `sets` on a circuit exercise is a ROUND count, so printing it per exercise as
// "4×10" says the opposite of what the circuit prescribes — 4 straight sets of
// pompes before touching the abdos. Asserted on the real rendered output, not on
// a helper, because it's the rendering that lies.
const html = renderToStaticMarkup(
  createElement(ProgramCard, {
    input: {
      name: "Circuits",
      days: [{ name: "Jour 1", exercises: circuitDay }],
      progressionRules: "…",
      deloadEveryWeeks: null,
    },
  }),
);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
assert.match(text, /Circuit A/);
// Rounds stated once, by the block header, as tours.
assert.equal(text.match(/4 tours/g)?.length, 1);
assert.doesNotMatch(
  text,
  /4\s*×\s*10/,
  "un exercice de circuit ne doit jamais afficher ses tours comme des séries",
);
assert.doesNotMatch(text, /4\s*×\s*AMRAP/);
// The classic exercise of the same day keeps its set count.
assert.match(text, /1×5 min/);
// Both rests are distinguishable: 20 s between exercises, 1 min 30 between rounds.
assert.match(text, /Entre deux tours/);

console.log("circuits ok");
