/** Self-check for the consult boundary. Run: `bun convex/consult.check.ts` */
import assert from "node:assert/strict";
import { normalizeConsult, truncateContext } from "./consult";

// The caller's context is written by a model, so it is bounded, not trusted.
assert.equal(truncateContext("  autour de sa séance de jambes  "), "autour de sa séance de jambes");
assert.equal(truncateContext("abcdef", 3), "abc…");
// The cut is visible AND doesn't leave a dangling space before the ellipsis.
assert.equal(truncateContext("ab cdef", 3), "ab…");
// Exactly at the limit is not truncated — no gratuitous "…".
assert.equal(truncateContext("abc", 3), "abc");
assert.equal(truncateContext(""), "");

// Nulls come back because strict structured output can't express "optional".
// They must be ABSENT afterwards, not null: a consumer writes `answer.meals?.length`.
const bare = normalizeConsult({
  recommendation: "  Rien de spécial à changer.  ",
  meals: null,
  constraints: null,
});
assert.deepEqual(bare, { recommendation: "Rien de spécial à changer.", confidence: "estimated" });
assert.ok(!("meals" in bare), "meals doit être absent, pas null");
assert.ok(!("constraints" in bare), "constraints doit être absent, pas null");

// An empty array is the same answer as "none" and must not survive as a key —
// otherwise the UI renders an empty section.
const empty = normalizeConsult({ recommendation: "ok", meals: [], constraints: [] });
assert.deepEqual(empty, { recommendation: "ok", confidence: "estimated" });

// A full answer keeps everything, and `confidence` is always "estimated": a
// consult is one agent's opinion about the other's field, never a measurement.
assert.deepEqual(
  normalizeConsult({
    recommendation: "Charge en glucides la veille.",
    meals: [{ name: "Riz + poulet", timing: "2 h avant", calories: 650 }],
    constraints: ["sans lactose"],
  }),
  {
    recommendation: "Charge en glucides la veille.",
    meals: [{ name: "Riz + poulet", timing: "2 h avant", calories: 650 }],
    constraints: ["sans lactose"],
    confidence: "estimated",
  },
);

console.log("consult boundary ok");
