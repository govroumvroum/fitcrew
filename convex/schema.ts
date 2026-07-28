import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const tone = v.union(v.literal("motivant"), v.literal("neutre"), v.literal("direct"));

export const onboarding = v.object({
  experience: v.union(v.literal("debutant"), v.literal("intermediaire"), v.literal("avance")),
  goals: v.array(v.string()),
  sport: v.optional(v.string()),
  limitations: v.optional(v.string()),
  daysPerWeek: v.number(),
  sessionMinutes: v.number(),
  equipment: v.array(v.string()),
});

// A program is written once per generation and read whole: nesting days and
// exercises keeps it one document. Bounded (~5 days x ~8 exercises).
export const programExercise = v.object({
  name: v.string(),
  sets: v.number(),
  reps: v.string(), // "8" or "8-12" or "AMRAP"
  restSeconds: v.number(),
  notes: v.optional(v.string()),
});

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    onboarding: v.optional(onboarding),
    tone: v.optional(tone),
    currentProgramId: v.optional(v.id("programs")),
  }).index("by_token", ["tokenIdentifier"]),

  programs: defineTable({
    userId: v.id("users"),
    version: v.number(),
    name: v.string(),
    days: v.array(
      v.object({
        name: v.string(), // "Jour 1 — Push"
        exercises: v.array(programExercise),
      }),
    ),
    progressionRules: v.string(),
    deloadEveryWeeks: v.optional(v.number()),
  }).index("by_user_and_version", ["userId", "version"]),

  workouts: defineTable({
    userId: v.id("users"),
    programId: v.optional(v.id("programs")),
    dayIndex: v.optional(v.number()), // which program day this session follows
    date: v.string(), // YYYY-MM-DD, local to the user
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    // An array, not a record keyed by exercise name: Convex field names must be
    // non-control ASCII and every exercise name here is French, so
    // "Développé couché" as a key throws at serialisation.
    exerciseNotes: v.optional(v.array(v.object({ exercise: v.string(), note: v.string() }))),
  }).index("by_user_and_date", ["userId", "date"]),

  // Own table, not an array on workouts: every set check-off is a write, and
  // progression graphs read across workouts by exercise.
  sets: defineTable({
    workoutId: v.id("workouts"),
    userId: v.id("users"),
    exerciseName: v.string(),
    index: v.number(), // set order within the exercise
    weight: v.number(),
    reps: v.number(),
    completed: v.boolean(),
  })
    .index("by_workout", ["workoutId"])
    .index("by_user_and_exercise", ["userId", "exerciseName"]),

  prs: defineTable({
    userId: v.id("users"),
    exerciseName: v.string(),
    type: v.union(
      v.literal("max_weight"),
      v.literal("max_reps"),
      v.literal("max_volume"),
      v.literal("est_1rm"),
    ),
    value: v.number(),
    date: v.string(),
    workoutId: v.id("workouts"),
    // First-ever performance on this exercise+type: a standing best, but nothing
    // was beaten. Needed as the baseline the next session compares against, and
    // excluded from the celebration — a first session broke no records, and
    // showering it with 13 trophies makes a real PR look like nothing.
    baseline: v.optional(v.boolean()),
  })
    .index("by_user_and_exercise", ["userId", "exerciseName"])
    .index("by_user_and_date", ["userId", "date"]),

  // Imported from fitness apps (screenshots) or logged directly. Separate from
  // `workouts` because there are no sets — nothing to check off.
  cardio: defineTable({
    userId: v.id("users"),
    date: v.string(),
    kind: v.string(), // "course", "vélo", "marche", "boxe"… free text, user's words
    durationMin: v.optional(v.number()),
    distanceKm: v.optional(v.number()),
    avgHr: v.optional(v.number()),
    calories: v.optional(v.number()),
    source: v.optional(v.string()),
  }).index("by_user_and_date", ["userId", "date"]),

  // One row per measurement day, not per screenshot: scales split a single
  // weigh-in across a weight screen and a body-composition screen, so two
  // imports merge into one row keyed by date.
  //
  // Every field is optional because a composition screen carries fat/muscle and
  // no weight at all. A row with nothing in it is never written.
  bodyweight: defineTable({
    userId: v.id("users"),
    date: v.string(),
    weightKg: v.optional(v.number()),
    // Bioimpedance: ±3-5% in absolute terms, but consistent enough on one scale
    // to read as a trend. Stored as measured, never averaged or corrected.
    bodyFatPct: v.optional(v.number()),
    muscleKg: v.optional(v.number()),
    source: v.optional(v.string()),
  }).index("by_user_and_date", ["userId", "date"]),

  // Reference data seeded once from exercisedb's free v1 dataset (~1500 rows).
  // English names — the dataset has no translations.
  exerciseDemos: defineTable({
    externalId: v.string(),
    name: v.string(), // english, lowercase, as delivered
    slug: v.string(), // normalised for matching: lowercased, unaccented, punctuation stripped
    gifUrl: v.string(),
    bodyParts: v.array(v.string()),
    targetMuscles: v.array(v.string()),
    equipments: v.array(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_external_id", ["externalId"]),

  // French name -> demo, resolved once per distinct name and cached forever.
  // `demoId: null` is a real answer ("no match"), cached so we stop re-asking
  // the model about an exercise the dataset simply doesn't have.
  exerciseDemoMatches: defineTable({
    exerciseName: v.string(), // the French name as the coach wrote it
    englishGuess: v.optional(v.string()), // what the model translated it to
    demoId: v.union(v.id("exerciseDemos"), v.null()),
  }).index("by_exercise_name", ["exerciseName"]),

  screenshots: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    source: v.optional(
      v.union(v.literal("apple_health"), v.literal("zepp"), v.literal("mi_fitness")),
    ),
    // Shape varies per source app and is only ever read back into the
    // confirmation form; validated at the extraction boundary instead.
    extracted: v.optional(v.any()),
    confirmed: v.boolean(),
  }).index("by_user", ["userId"]),
});
