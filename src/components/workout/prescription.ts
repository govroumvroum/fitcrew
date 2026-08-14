/** Pure helpers shared by the séance screen. No React, no Convex — see prescription.check.ts. */

import { groupCircuits, roundsOf } from "@/lib/circuits";

export type SetRow = { index: number; weight: number; reps: number; completed: boolean };

/** What the séance screen needs of a day's exercise to walk it. */
type Occurrence = { name: string; sets: number; circuit?: string; slot?: string };
/** What it needs of a `sets` row. */
type Row = { exerciseName: string; index: number; slot?: string };

/**
 * A prescription's reps are free text: "8", "8-12", "AMRAP", "12 par jambe".
 * We need one number to seed the counter with; the low end of a range is the
 * honest starting point, and the user adjusts with +/-.
 */
export function defaultReps(spec: string): number {
  const first = spec.match(/\d+/);
  // ponytail: no digits (AMRAP, "à l'échec") → 10, a number to tap away from.
  return first ? Number(first[0]) : 10;
}

/**
 * The set rows `workouts.start` writes for a day: one per prescribed set,
 * pre-loaded with what that exercise was last done at so a séance opens on real
 * numbers instead of 0 kg. Unmatched exercise (never trained) → 0 and the
 * prescription's reps, which is the honest starting point.
 *
 * Lives here rather than in the séance screen because the picker seeds one of
 * these per program now, and two copies of the crossing would drift.
 */
export function seedSets(
  exercises: { name: string; sets: number; reps: string; circuit?: string; slot?: string }[],
  prefill: { name: string; weight: number; reps: number }[],
): {
  exerciseName: string;
  index: number;
  weight: number;
  reps: number;
  circuit?: string;
  slot?: string;
  round?: number;
}[] {
  return exercises.flatMap((exercise) => {
    const last = prefill.find((entry) => entry.name === exercise.name);
    return Array.from({ length: exercise.sets }, (_, index) => ({
      exerciseName: exercise.name,
      index,
      weight: last?.weight ?? 0,
      reps: last?.reps ?? defaultReps(exercise.reps),
      // Provenance only on a circuit set — `sets` IS the round count, so set
      // `index` and round are the same number, 1-based here. A classic row keeps
      // exactly the shape it has always had.
      ...(exercise.circuit && {
        circuit: exercise.circuit,
        round: index + 1,
        ...(exercise.slot && { slot: exercise.slot }),
      }),
    }));
  });
}

/**
 * The rows of ONE occurrence of an exercise in the day, in set order.
 *
 * `slot` is the identity, not the name: a circuit can run pompes twice, and
 * grouping those two occurrences by name would merge their rows into one.
 */
export function rowsOf<R extends Row>(
  exercise: { name: string; slot?: string },
  sets: readonly R[],
): R[] {
  const byIndex = (a: R, b: R) => a.index - b.index;
  if (exercise.slot) {
    const own = sets.filter((set) => set.slot === exercise.slot);
    // No stamped row at all: a séance started on the bundle before provenance
    // existed and resumed after the deploy. Falling back to the name is exactly
    // how that séance behaved when it started.
    if (own.length > 0) return own.sort(byIndex);
  }
  return sets.filter((set) => set.exerciseName === exercise.name).sort(byIndex);
}

/**
 * The day in the order it's actually performed: one step per set row. A classic
 * exercise runs set by set to completion; a circuit runs exercise 1 → 2 → 3 →
 * next round. `at` is the occurrence's index in `exercises`, which is what the
 * séance screen pages on.
 *
 * This is the whole ordering: the resume point is the first step whose row isn't
 * completed, and "next" is the first open step of another occurrence.
 */
export function sessionSteps<E extends Occurrence, R extends Row>(
  exercises: readonly E[],
  sets: readonly R[],
): { at: number; row: R }[] {
  return groupCircuits(exercises.map((exercise, at) => ({ ...exercise, at }))).flatMap((block) => {
    if (block.kind === "exercise") {
      return rowsOf(block.exercise, sets).map((row) => ({ at: block.exercise.at, row }));
    }
    const tracks = block.exercises.map((exercise) => ({
      at: exercise.at,
      rows: rowsOf(exercise, sets),
    }));
    // Rounds off the prescription, but never fewer than the rows on hand: a row
    // left out of the walk is a set nothing can reach.
    const rounds = Math.max(roundsOf(block), ...tracks.map((track) => track.rows.length));
    return Array.from({ length: rounds }, (_, round) =>
      tracks.flatMap(({ at, rows }) => (rows[round] ? [{ at, row: rows[round] }] : [])),
    ).flat();
  });
}

/**
 * The weight × reps the next set of an exercise should default to: what was
 * just lifted this session, else what the rows were seeded with (last
 * session's values), else the prescription.
 */
export function workingValues(rows: SetRow[], repsSpec: string): { weight: number; reps: number } {
  const done = rows.filter((r) => r.completed);
  const source = done.length
    ? done.reduce((a, b) => (b.index > a.index ? b : a))
    : rows.reduce<SetRow | null>((a, b) => (a === null || b.index < a.index ? b : a), null);
  return source
    ? { weight: source.weight, reps: source.reps }
    : { weight: 0, reps: defaultReps(repsSpec) };
}
