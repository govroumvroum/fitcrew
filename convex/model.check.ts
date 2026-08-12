/** Self-check for the agents' context window. Run: `bun convex/model.check.ts` */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_OPTIONS } from "./model";

// #70: the window was 20 rows while the chef's onboarding asks 11 questions one
// at a time (~2 rows per exchange, plus the hidden kickoff turn). It ran out
// mid-onboarding and the agent re-asked what the user had already answered.
// Anything below one full onboarding brings that back.
const ROWS_PER_EXCHANGE = 2;
const LONGEST_ONBOARDING_QUESTIONS = 11; // convex/chef.ts QUESTIONS
assert.ok(
  CONTEXT_OPTIONS.recentMessages > LONGEST_ONBOARDING_QUESTIONS * ROWS_PER_EXCHANGE * 4,
  `recentMessages=${CONTEXT_OPTIONS.recentMessages} is too small: an onboarding alone needs ~${
    LONGEST_ONBOARDING_QUESTIONS * ROWS_PER_EXCHANGE
  } rows, and a real conversation continues after it`,
);

// Bounded, though: this is a pagination `numItems`, not a "give me everything".
assert.ok(Number.isInteger(CONTEXT_OPTIONS.recentMessages), "must be a finite integer");
assert.ok(CONTEXT_OPTIONS.recentMessages <= 5000, "still a bounded read, like every read here");

// The coach and the chef must share it. They already drifted once: identical 20s
// with two hand-written comments justifying them, one of which was factually
// wrong about what the prompt contained. A literal here is how that starts.
const dir = import.meta.dirname;
const offenders = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && f !== "model.ts" && !f.endsWith(".check.ts"))
  .filter((f) => /recentMessages\s*:/.test(readFileSync(join(dir, f), "utf8")));
assert.deepEqual(
  offenders,
  [],
  `these files set recentMessages themselves instead of importing CONTEXT_OPTIONS: ${offenders.join(", ")}`,
);

console.log("model.check.ts ok");
