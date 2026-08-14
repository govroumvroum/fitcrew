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
  // Circuit metadata, all optional and all absent on a classic exercise: a day
  // without them IS a classic day, so no program ever needs migrating.
  //
  // `circuit` is a label local to the day ("A", "B"). Exercises sharing it AND
  // consecutive in `exercises` form one circuit, in array order.
  circuit: v.optional(v.string()),
  // The identity of THIS occurrence in the day, unique across the day. An array
  // index isn't enough: the same exercise can appear twice in one circuit.
  slot: v.optional(v.string()),
  // Rest after the last exercise of a round, as opposed to `restSeconds` which
  // is the rest before the circuit's NEXT exercise. Carried on every exercise of
  // the circuit; readers take the first one's.
  restBetweenRoundsSeconds: v.optional(v.number()),
  // No `rounds` field on purpose: `sets` is the round count (one set per round),
  // identical across the circuit. A second source of truth would drift, and
  // totalSets/duration arithmetic keeps working untouched.
});

export const challengeMetric = v.union(
  v.literal("sessions"),
  v.literal("volume"),
  v.literal("max_reps"),
  v.literal("max_weight"),
  v.literal("est_1rm"),
);

export const programStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
  v.literal("completed"),
);

export const nutritionGoal = v.union(v.literal("perte"), v.literal("maintien"), v.literal("prise"));

export const activityLevel = v.union(
  v.literal("sedentaire"),
  v.literal("leger"),
  v.literal("modere"),
  v.literal("actif"),
  v.literal("tres_actif"),
);

export const mealSlot = v.union(
  v.literal("petit_dejeuner"),
  v.literal("dejeuner"),
  v.literal("diner"),
  v.literal("collation"),
);

export const macros = v.object({
  calories: v.number(),
  protein: v.number(),
  carbs: v.number(),
  fat: v.number(),
});

export const plannedMeal = v.object({
  slot: mealSlot,
  name: v.string(),
  // An array, not a record keyed by the ingredient: a Convex field name must be
  // non-control ASCII and every one of these names is French.
  ingredients: v.array(v.object({ name: v.string(), quantity: v.string() })),
  steps: v.array(v.string()),
  prepMinutes: v.number(),
  macros,
  locked: v.optional(v.boolean()),
  mealPrep: v.optional(v.string()), // "se prépare la veille", when relevant
});

export const planDay = v.object({ date: v.string(), meals: v.array(plannedMeal) });

// Written once per generation and read whole, like `programs`: nesting days and
// meals keeps a week one document. Bounded (7 days x ~4 meals).
export const nutritionProfile = v.object({
  userId: v.id("users"),
  goal: nutritionGoal,
  age: v.number(),
  sex: v.union(v.literal("h"), v.literal("f")),
  heightCm: v.number(),
  weightKg: v.number(),
  activityLevel,
  diet: v.optional(v.string()), // "végétarien", "halal"… free text, user's words
  allergies: v.array(v.string()),
  excluded: v.array(v.string()),
  mealsPerDay: v.number(),
  budget: v.optional(v.string()), // "serré", "normal"… user's words
  cookMinutes: v.optional(v.number()), // time available per meal
  people: v.optional(v.number()),
  // Stored, not recomputed on read: the Chef generates a week against these
  // numbers and they must not silently drift under an existing plan when the
  // user logs a new weight.
  targets: macros,
});

export const visionIntent = v.union(
  v.literal("plate"),
  v.literal("fridge"),
  v.literal("label"),
  v.literal("groceries"),
);

// One union, two call sites: the table below and `aiUsage.record`'s args. They
// must never drift, or a recorded call fails validation at write time.
export const aiFeature = v.union(
  v.literal("coach"),
  v.literal("screenshot"),
  v.literal("demos"),
  v.literal("challenge"),
  v.literal("chef"),
  v.literal("vision"),
  v.literal("consult"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    onboarding: v.optional(onboarding),
    tone: v.optional(tone),
    // ponytail: the program most recently TRAINED, not a selection — programs
    // run in parallel and are all equally live. It exists so the coach, the crew
    // and the Chef have a default context to talk about. Stamped by
    // `workouts.start`; read it as a hint, never as "the" program.
    currentProgramId: v.optional(v.id("programs")),
  }).index("by_token", ["tokenIdentifier"]),

  // A program is a LINEAGE of versioned rows: `generate_program` starts one,
  // `swap_exercise` appends a version to it. Several lineages run in PARALLEL —
  // a musculation program and a boxing one are both live, each with its own day
  // rotation, derived from the séances stamped with one of its rows.
  programs: defineTable({
    userId: v.id("users"),
    // The id of the lineage's FIRST row; a root row points at itself.
    // ponytail: optional so pre-lineage rows keep working. Read it as
    // `p.lineageId ?? p._id` everywhere — that default IS the contract, and it's
    // why there's no widen/narrow deploy dance for a four-person app.
    lineageId: v.optional(v.id("programs")),
    // ponytail: optional for the same reason, read as `p.status ?? "active"`.
    // Carried on every row of the lineage; only the latest one is ever read.
    status: v.optional(programStatus),
    version: v.number(), // per lineage: a new program starts at 1
    name: v.string(),
    days: v.array(
      v.object({
        name: v.string(), // "Jour 1 — Push"
        exercises: v.array(programExercise),
      }),
    ),
    progressionRules: v.string(),
    deloadEveryWeeks: v.optional(v.number()),
  }).index("by_user_and_lineage", ["userId", "lineageId", "version"]),

  // A share link for a program. Keyed by the LINEAGE, not a row id, so the link
  // survives exercise swaps by construction. Deleting the row revokes the link.
  programShares: defineTable({
    lineageId: v.id("programs"), // the lineage root id (row.lineageId ?? row._id)
    userId: v.id("users"), // owner who shared
    code: v.string(),
  })
    .index("by_code", ["code"])
    .index("by_lineage", ["lineageId"])
    .index("by_user", ["userId"]),

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
    // Circuit provenance of the set. Written by nobody yet — the séance screen
    // (part 2 of #93) populates them; declared here so that PR can be frontend
    // only. Optional forever: a classic set carries none of them.
    circuit: v.optional(v.string()),
    slot: v.optional(v.string()), // the occurrence inside the day, see programExercise
    round: v.optional(v.number()), // 1-based tour number
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

  // A weekly challenge someone opens for the crew. There is no
  // `challengeEntries` table on purpose: opting in IS being in `participants`
  // (four people, so the array is bounded), and every score is recomputed at
  // read time from `workouts`/`sets`. An entry row would hold nothing.
  challenges: defineTable({
    // Absent means the coach generated it (the Monday cron): there is no human
    // author, and naming one would be a lie in the UI.
    createdBy: v.optional(v.id("users")),
    title: v.string(),
    weekStart: v.string(), // YYYY-MM-DD Monday, produced by weekStart()
    metric: challengeMetric,
    // Required for every metric except `sessions`: the fairness rule is that a
    // boxer and a bodybuilder compare on one named exercise, never globally.
    exerciseName: v.optional(v.string()),
    participants: v.array(v.id("users")),
  }).index("by_week", ["weekStart"]),

  nutritionProfiles: defineTable(nutritionProfile).index("by_user", ["userId"]),

  mealPlans: defineTable({
    userId: v.id("users"),
    weekStart: v.string(), // YYYY-MM-DD Monday, produced by monday()
    days: v.array(planDay),
  }).index("by_user_and_week", ["userId", "weekStart"]),

  foodLog: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD, local to the user
    slot: mealSlot,
    name: v.string(),
    quantity: v.optional(v.string()),
    macros,
    source: v.union(v.literal("plan"), v.literal("manual"), v.literal("image")),
  }).index("by_user_and_date", ["userId", "date"]),

  // One row per day, upserted: a water counter is a single number per date.
  hydration: defineTable({
    userId: v.id("users"),
    date: v.string(),
    ml: v.number(),
  }).index("by_user_and_date", ["userId", "date"]),

  inventory: defineTable({
    userId: v.id("users"),
    name: v.string(), // as the user/model names it, trimmed
    quantity: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Unconfirmed image analyses, exactly like `screenshots`: a proposal the user
  // edits and commits, or discards. Nothing is ever written to the log or the
  // inventory straight from a photo.
  visionAnalyses: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    intent: visionIntent,
    // Shape varies per intent and is only ever read back into the confirmation
    // form; validated at the vision boundary instead.
    items: v.any(),
    warnings: v.array(v.string()),
    confirmed: v.boolean(),
  }).index("by_user", ["userId"]),

  // One batch of tapped questions, same durable-state contract as
  // `visionAnalyses`: the card lives forever in a message stream, so a reload has
  // to find it exactly as the user left it — never blank, never re-tappable once
  // sent.
  //
  // `questions` (written by the model) and `answers` (written by the client) are
  // `v.any()` for the same reason as `visionAnalyses.items`: they're validated at
  // the boundary by `sanitizeQuestions` / `sanitizeAnswers`, which drop what's
  // wrong, rather than by the table, which would reject the whole write for one
  // bad option.
  choices: defineTable({
    userId: v.id("users"),
    // Carried on the row, not read from the client: the card sends its answers
    // back into ITS OWN conversation, which is not necessarily the thread
    // currently selected in the URL — and on /demo there is no URL state at all.
    threadId: v.string(),
    questions: v.any(),
    // Aligned with `questions`: null = not answered, [] = « je préfère
    // t'expliquer », [...] = the labels chosen.
    answers: v.any(),
    // No index: a card is always reached by its id, which the tool part carries.
    // The « one open card at a time » lookup that needed one is gone — several
    // may be open, and each is read on its own.
    status: v.union(v.literal("open"), v.literal("completed"), v.literal("abandoned")),
  }),

  // One row per LLM call, so we know who spends what. Written by the coach's and
  // the chef's `usageHandler`, and by hand at every `generateObject` site.
  //
  // `userId` is absent for `demos`: demo matching is a cache shared by everyone,
  // and billing the first person who triggered it would be a wrong number. Same
  // for `challenge`: the Monday cron writes défis for the crew, on nobody's behalf.
  aiUsage: defineTable({
    userId: v.optional(v.id("users")),
    feature: aiFeature,
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    // Billed as output. Separate because it's invisible in the transcript.
    reasoningTokens: v.optional(v.number()),
    // The part of `inputTokens` the provider already had cached, exactly as the
    // provider reports it — never computed here.
    cachedInputTokens: v.optional(v.number()),
    // OpenRouter's own figure when it returns one — never tokens x a hardcoded
    // rate, which would rot at the next model change.
    costUsd: v.optional(v.number()),
    date: v.string(), // YYYY-MM-DD (UTC), so aggregating never scans _creationTime
  }).index("by_user_and_date", ["userId", "date"]),
});
