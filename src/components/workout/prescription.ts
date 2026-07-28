/** Pure helpers shared by the séance screen. No React, no Convex — see prescription.check.ts. */

export type SetRow = { index: number; weight: number; reps: number; completed: boolean };

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
