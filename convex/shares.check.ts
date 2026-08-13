/** Self-check for convex/shares.ts. Run: `bun convex/shares.check.ts` */
import assert from "node:assert/strict";
import type { Id } from "./_generated/dataModel";
import { CODE_ALPHABET, CODE_LENGTH, generateCode, snapshotForCopy } from "./shares";

// --- generateCode ------------------------------------------------------------

const codes = new Set<string>();
for (let i = 0; i < 10_000; i++) {
  const code = generateCode();
  assert.equal(code.length, CODE_LENGTH);
  for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `bad char ${ch} in ${code}`);
  codes.add(code);
}
// 31^10 space: 10k draws colliding would mean the generator is broken.
assert.equal(codes.size, 10_000);
// No ambiguous characters in the alphabet itself.
for (const ch of "01loiLOI") assert.ok(!CODE_ALPHABET.includes(ch));

// --- snapshotForCopy ---------------------------------------------------------

const receiver = "user_receiver" as Id<"users">;
const source = {
  // Fields a real Doc<"programs"> row carries that must NOT leak into the copy.
  _id: "prog_source",
  _creationTime: 123,
  userId: "user_owner",
  lineageId: "prog_root",
  status: "archived",
  version: 7,
  name: "PPL 4 jours",
  days: [
    { name: "Jour 1 — Push", exercises: [{ name: "DC", sets: 4, reps: "8", restSeconds: 90 }] },
  ],
  progressionRules: "+2,5 kg quand toutes les séries passent",
  deloadEveryWeeks: 5,
};

const copy = snapshotForCopy(source, receiver);
assert.deepEqual(Object.keys(copy).sort(), [
  "days",
  "deloadEveryWeeks",
  "name",
  "progressionRules",
  "status",
  "userId",
  "version",
]);
assert.equal(copy.userId, receiver);
assert.equal(copy.version, 1);
assert.equal(copy.status, "active");
assert.equal(copy.deloadEveryWeeks, 5);

// Days are a deep copy: mutating the copy must not touch the source.
assert.deepEqual(copy.days, source.days);
copy.days[0].exercises[0].name = "mutated";
assert.equal(source.days[0].exercises[0].name, "DC");

// Absent deload stays absent (Convex rejects explicit `undefined`).
const bare = snapshotForCopy({ ...source, deloadEveryWeeks: undefined }, receiver);
assert.ok(!("deloadEveryWeeks" in bare));

console.log("convex/shares.ts ok");
