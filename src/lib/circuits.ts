/**
 * A day is a flat list of exercises. A circuit is *implicit* in that list:
 * consecutive exercises carrying the same `circuit` label are one block, read in
 * array order. No `rounds` field — a circuit exercise does one set per round, so
 * `sets` IS the round count and every exercise of the block carries the same one.
 *
 * Kept dumb on purpose (no validation, no repair): it's read by /programme, the
 * public share page, the coach cards and `program.check.ts`.
 */

import { circuitRuns } from "../../convex/toolSchemas";

/** The only fields grouping needs. Anything wider (a Convex row, a zod input) fits. */
type Grouped = {
  name: string;
  circuit?: string | null;
  slot?: string | null;
};

export type Block<E> =
  | { kind: "exercise"; key: string; exercise: E }
  | { kind: "circuit"; key: string; label: string; exercises: E[] };

/**
 * Blocks for rendering. The grouping rule itself lives in `circuitRuns` — one
 * implementation for the backend render and this one — and a run only becomes a
 * block here: a classic run is one block per exercise, a circuit run is one
 * block. Same label but NOT consecutive is therefore two blocks, on purpose:
 * merging them would reorder the day, the one thing a circuit day can't survive.
 */
export function groupCircuits<E extends Grouped>(exercises: readonly E[]): Block<E>[] {
  let i = 0;
  return circuitRuns(exercises).flatMap<Block<E>>(({ circuit, items }) => {
    const start = i;
    i += items.length;
    return circuit
      ? [{ kind: "circuit", key: `circuit-${circuit}-${start}`, label: circuit, exercises: items }]
      : items.map((exercise, k) => ({
          kind: "exercise" as const,
          key: `${exercise.name}-${start + k}`,
          exercise,
        }));
  });
}

/** Rounds of a circuit block: one set per round, so it's the first exercise's `sets`. */
export const roundsOf = <E extends { sets: number }>(block: { exercises: E[] }) =>
  block.exercises[0].sets;

/** Rest between two rounds, carried on every exercise of the block; read from the first. */
export const betweenRoundsOf = <E extends { restBetweenRoundsSeconds?: number | null }>(block: {
  exercises: E[];
}) => block.exercises[0].restBetweenRoundsSeconds ?? 0;

/** A set costs its rest plus ~35 s of work. Estimated, never a measurement. */
const WORK_SECONDS = 35;

type Timed = Grouped & {
  sets: number;
  restSeconds: number;
  restBetweenRoundsSeconds?: number | null;
};

/**
 * Estimated seconds for one day.
 *
 * A classic exercise costs `sets × (restSeconds + 35)` — unchanged, so a day
 * with no circuit metadata still comes out at exactly the number it always did.
 * A circuit costs, per round, the work of every exercise + the rest *between*
 * them (so not after the last one, that's where the between-rounds rest goes) +
 * `restBetweenRoundsSeconds` once.
 */
export function daySeconds<E extends Timed>(exercises: readonly E[]): number {
  return groupCircuits(exercises).reduce((total, block) => {
    if (block.kind === "exercise") {
      const { sets, restSeconds } = block.exercise;
      return total + sets * (restSeconds + WORK_SECONDS);
    }
    const between = block.exercises
      .slice(0, -1)
      .reduce((sum, exercise) => sum + exercise.restSeconds, 0);
    const work = block.exercises.length * WORK_SECONDS;
    return total + roundsOf(block) * (work + between + betweenRoundsOf(block));
  }, 0);
}
