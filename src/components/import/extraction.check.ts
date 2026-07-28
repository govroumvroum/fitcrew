/**
 * Self-check for the extraction boundary. Run: `bun src/components/import/extraction.check.ts`
 * No test framework on purpose — this is the one thing that must fail loudly if
 * the normalizer starts letting hallucinated numbers through.
 */
import assert from "node:assert/strict";
import { normalizeExtraction } from "../../../convex/screenshots";

const TODAY = "2026-07-28";

/** Everything the model must return, all-null by default. */
const blank = {
  source: "zepp",
  type: "cardio",
  date: null,
  exercises: null,
  duration_min: null,
  distance_km: null,
  avg_hr: null,
  calories: null,
  weight_kg: null,
};

// A plain cardio row survives intact, and absent fields stay absent (not 0/null).
const [cardio] = normalizeExtraction(
  { entries: [{ ...blank, date: "2026-07-20", duration_min: 42, distance_km: 8.4, avg_hr: 151 }] },
  TODAY,
);
assert.deepEqual(cardio, {
  source: "zepp",
  type: "cardio",
  date: "2026-07-20",
  duration_min: 42,
  distance_km: 8.4,
  avg_hr: 151,
});

// Missing or malformed date falls back to today rather than inventing one.
assert.equal(normalizeExtraction({ entries: [{ ...blank, calories: 300 }] }, TODAY)[0].date, TODAY);
assert.equal(
  normalizeExtraction({ entries: [{ ...blank, date: "20/07", calories: 300 }] }, TODAY)[0].date,
  TODAY,
);

// Implausible magnitudes (misread digits) drop the field, keep the entry.
const [misread] = normalizeExtraction(
  { entries: [{ ...blank, duration_min: 42, avg_hr: 1510, weight_kg: -3 }] },
  TODAY,
);
assert.deepEqual(Object.keys(misread).sort(), ["date", "duration_min", "source", "type"]);

// An entry with no usable data at all is dropped, not shown as an empty form.
assert.equal(normalizeExtraction({ entries: [blank, { ...blank, calories: 0 }] }, TODAY).length, 0);

// Workouts: empty-named exercises and zero-rep sets are noise and get pruned.
const [workout] = normalizeExtraction(
  {
    entries: [
      {
        ...blank,
        type: "workout",
        date: "2026-07-21",
        exercises: [
          {
            name: " Squat ",
            sets: [
              { weight: 80, reps: 5 },
              { weight: 80, reps: 0 },
            ],
          },
          { name: "  ", sets: [{ weight: 60, reps: 8 }] },
          { name: "Curl", sets: [] },
        ],
      },
    ],
  },
  TODAY,
);
assert.deepEqual(workout.exercises, [{ name: "Squat", sets: [{ weight: 80, reps: 5 }] }]);

// Multi-day screenshots yield one entry per row, capped.
assert.equal(
  normalizeExtraction(
    { entries: Array.from({ length: 40 }, () => ({ ...blank, calories: 200 })) },
    TODAY,
  ).length,
  30,
);

// Garbage from the model is a hard failure, never a silent empty import.
assert.throws(() => normalizeExtraction({ entries: [{ source: "strava" }] }, TODAY));
assert.throws(() => normalizeExtraction("nope", TODAY));

console.log("extraction.check: ok");
