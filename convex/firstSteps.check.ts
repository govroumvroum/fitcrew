/** Self-check for the welcome and the « Premiers pas » card (#127). Run: `bun convex/firstSteps.check.ts` */
import assert from "node:assert/strict";
import { type Facts, STEPS, isNewcomer, stepsDone, summarize } from "./firstSteps";

const blank: Facts = {
  hasCoachProfile: false,
  hasProgram: false,
  hasWorkout: false,
  hasFinishedWorkout: false,
  hasWeek: false,
  hasMeasure: false,
  inCrew: false,
  hasNutrition: false,
};

const everything: Facts = {
  ...blank,
  welcomedAt: 1,
  installedAt: 2,
  hasCoachProfile: true,
  hasProgram: true,
  hasWorkout: true,
  hasFinishedWorkout: true,
  hasWeek: true,
  hasMeasure: true,
  inCrew: true,
  hasNutrition: true,
};

// --- Who gets the welcome ----------------------------------------------------
// A brand-new account: nothing at all.
assert.equal(isNewcomer(blank), true);
// Finished or skipped once: never again, even with no data (skipped on day one).
assert.equal(isNewcomer({ ...blank, welcomedAt: 1 }), false);
// The net under the flag: an account from before the backfill that already
// talked to the Coach, has a program, or trained is not a stranger.
assert.equal(isNewcomer({ ...blank, hasCoachProfile: true }), false);
assert.equal(isNewcomer({ ...blank, hasProgram: true }), false);
assert.equal(isNewcomer({ ...blank, hasWorkout: true }), false);
// Things that do NOT make you an old hand: a nutrition profile alone, a week,
// an installed app — none of them mean you've met the Coach.
assert.equal(isNewcomer({ ...blank, hasNutrition: true, hasWeek: true, installedAt: 1 }), true);

// --- The card -----------------------------------------------------------------
// Six required steps and one optional, in a fixed order, Chef last.
assert.deepEqual(
  STEPS.map((step) => step.key),
  ["coach", "week", "seance", "capture", "crew", "install", "chef"],
);
assert.deepEqual(
  STEPS.filter((step) => step.optional).map((step) => step.key),
  ["chef"],
);

// New: nothing done, card shown.
{
  const summary = summarize(stepsDone(blank), false);
  assert.equal(summary.required, 6);
  assert.equal(summary.requiredDone, 0);
  assert.equal(summary.visible, true);
  assert.ok(summary.steps.every((step) => !step.done));
}

// Right after the Coach's questionnaire: the program ticks « coach », nothing else.
{
  const summary = summarize(stepsDone({ ...blank, hasCoachProfile: true, hasProgram: true }), false);
  assert.equal(summary.requiredDone, 1);
  assert.deepEqual(
    summary.steps.filter((step) => step.done).map((step) => step.key),
    ["coach"],
  );
  assert.equal(summary.visible, true);
}

// A profile saved without a program yet does not tick « coach »: the step is
// about having something to train.
assert.equal(stepsDone({ ...blank, hasCoachProfile: true }).coach, false);

// A séance started and never finished is not « ta première séance ».
assert.equal(stepsDone({ ...blank, hasWorkout: true }).seance, false);

// Everything done: the card goes.
assert.equal(summarize(stepsDone(everything), false).visible, false);

// The Chef never blocks « all done »: every required step without a nutrition
// profile still hides the card.
{
  const summary = summarize(stepsDone({ ...everything, hasNutrition: false }), false);
  assert.equal(summary.requiredDone, summary.required);
  assert.equal(summary.visible, false);
}

// …and doing ONLY the Chef doesn't count towards the required total.
assert.equal(summarize(stepsDone({ ...blank, hasNutrition: true }), false).requiredDone, 0);

// One required step left keeps it up (install is the usual straggler).
assert.equal(summarize(stepsDone({ ...everything, installedAt: undefined }), false).visible, true);

// Dismissed: hidden whatever is left.
assert.equal(summarize(stepsDone(blank), true).visible, false);

// The client ORs its own standalone check into `done` before summarising.
{
  const done = { ...stepsDone({ ...everything, installedAt: undefined }), install: true };
  assert.equal(summarize(done, false).visible, false);
}

// A browser that can't install (desktop Firefox) drops the step entirely: five
// required, and everything else done hides the card instead of pinning it at 5/6.
{
  const summary = summarize(
    stepsDone({ ...everything, installedAt: undefined }),
    false,
    ["install"],
  );
  assert.equal(summary.required, 5);
  assert.equal(summary.requiredDone, 5);
  assert.equal(summary.visible, false);
  assert.ok(!summary.steps.some((step) => step.key === "install"));
}

console.log("firstSteps.check: ok");
