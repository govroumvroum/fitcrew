/**
 * Self-check for the program shape helpers in convex/coach.ts and the lineage
 * grouping in convex/programs.ts.
 * Run: `bun src/components/chat/program.check.ts`
 */
import assert from "node:assert/strict";
import { swapInDays, toDays } from "../../../convex/coach";
import { latestPerLineage, lineageMembers, lineageOf } from "../../../convex/programs";
import { formatLoose } from "@/lib/dates";

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
