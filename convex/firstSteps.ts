// The welcome screen and the « Premiers pas » card (#127), as pure logic: no
// ctx, no clock. `welcome.ts` gathers the facts, the home screen renders the
// result. Self-check: `bun convex/firstSteps.check.ts`.

export type StepKey = "coach" | "week" | "seance" | "capture" | "crew" | "install" | "chef";

/**
 * In the order the card lists them, which is the order the app is learned in:
 * the Coach writes the program, the week gives it days, then you train, measure,
 * and find the others. The Chef is last and never required — a lot of people
 * want a coach and not a meal plan.
 */
export const STEPS: readonly { key: StepKey; optional: boolean }[] = [
  { key: "coach", optional: false },
  { key: "week", optional: false },
  { key: "seance", optional: false },
  { key: "capture", optional: false },
  { key: "crew", optional: false },
  { key: "install", optional: false },
  { key: "chef", optional: true },
];

/** What the database says about one user. Every flag comes from a bounded read. */
export type Facts = {
  welcomedAt?: number;
  dismissedAt?: number;
  installedAt?: number;
  /** The Coach's questionnaire was saved (`users.onboarding`). */
  hasCoachProfile: boolean;
  hasProgram: boolean;
  /** Any séance, even one never finished. */
  hasWorkout: boolean;
  hasFinishedWorkout: boolean;
  hasWeek: boolean;
  /** A cardio or a bodyweight row: what a watch or scale capture writes. */
  hasMeasure: boolean;
  inCrew: boolean;
  hasNutrition: boolean;
};

/**
 * Welcome only someone who has never done anything. The flag is the rule; the
 * data is the net under it — a user the Clerk webhook created long ago, or one
 * from before the backfill ran, already HAS a profile or a séance and must not
 * be greeted like a stranger.
 */
export const isNewcomer = (facts: Facts): boolean =>
  facts.welcomedAt === undefined &&
  !facts.hasCoachProfile &&
  !facts.hasProgram &&
  !facts.hasWorkout;

export const stepsDone = (facts: Facts): Record<StepKey, boolean> => ({
  coach: facts.hasProgram,
  week: facts.hasWeek,
  seance: facts.hasFinishedWorkout,
  capture: facts.hasMeasure,
  crew: facts.inCrew,
  install: facts.installedAt !== undefined,
  chef: facts.hasNutrition,
});

export type Summary = {
  steps: { key: StepKey; optional: boolean; done: boolean }[];
  required: number;
  requiredDone: number;
  /** Shown until every REQUIRED step is done, or until dismissed. */
  visible: boolean;
};

/**
 * `done` comes from the server; the client may OR its own knowledge in first
 * (it sees standalone mode before the mutation recording it lands), which is why
 * this takes the map rather than the facts.
 */
export function summarize(
  done: Record<StepKey, boolean>,
  dismissed: boolean,
  /**
   * Steps this device can't do at all, left out of the list and the count —
   * « installer l'app » on desktop Firefox, which has no install. Otherwise the
   * card would sit at 5 of 6 forever.
   */
  skip: readonly StepKey[] = [],
): Summary {
  const steps = STEPS.filter((step) => !skip.includes(step.key)).map((step) => ({
    key: step.key,
    optional: step.optional,
    done: done[step.key],
  }));
  const required = steps.filter((step) => !step.optional);
  const requiredDone = required.filter((step) => step.done).length;
  return {
    steps,
    required: required.length,
    requiredDone,
    visible: !dismissed && requiredDone < required.length,
  };
}
