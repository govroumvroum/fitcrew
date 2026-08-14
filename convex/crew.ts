import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import { MODEL_ID, languageModel } from "./model";
import {
  SetLite,
  currentStreak,
  shift,
  statsByExercise,
  weekStart,
  weeklyBuckets,
} from "./progress";
import { challengeMetric } from "./schema";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure logic. No ctx, no clock — see src/components/crew/crew.check.ts.
// ---------------------------------------------------------------------------

export type ChallengeMetric = "sessions" | "volume" | "max_reps" | "max_weight" | "est_1rm";

/**
 * One participant's standing in a challenge, from their sets over the week.
 *
 * Everything but `sessions` folds through `statsByExercise` for the challenge's
 * one exercise, so unchecked sets never count and the maths matches /progres.
 * `max_reps` reads `bodyweightReps` for the same reason `prCandidates` does —
 * reps mean nothing with weight on the bar — which is what makes "most
 * pull-ups this week" a real contest instead of a curl-with-1kg contest.
 */
export function scoreChallenge(
  metric: ChallengeMetric,
  exerciseName: string | undefined,
  sets: SetLite[],
  sessions: number,
): number {
  if (metric === "sessions") return sessions;
  if (!exerciseName) return 0;
  const stat = statsByExercise(sets).get(exerciseName);
  if (!stat) return 0;
  switch (metric) {
    case "volume":
      return Math.round(stat.volume);
    case "max_reps":
      return stat.bodyweightReps;
    case "max_weight":
      return stat.maxWeight;
    case "est_1rm":
      return stat.est1rm;
  }
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

// ponytail: the crew is four people, so "everyone" is one bounded read. Paginate
// the leaderboard if this ever becomes a product with strangers in it.
const CREW_SIZE = 20;

const crew = (ctx: QueryCtx) => ctx.db.query("users").take(CREW_SIZE);

/** Every workout in range plus its sets, per user. ~5 séances x 1 index read. */
async function weekWork(ctx: QueryCtx, userId: Id<"users">, from: string, to: string) {
  const workouts = await ctx.db
    .query("workouts")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
    .take(50);

  const sets: SetLite[] = [];
  for (const workout of workouts) {
    sets.push(
      ...(await ctx.db
        .query("sets")
        .withIndex("by_workout", (q) => q.eq("workoutId", workout._id))
        .take(200)),
    );
  }
  return { workouts, sets };
}

/**
 * The crew leaderboard: consistency and PRs, one row per member.
 *
 * Deliberately NO total-volume column. The issue struck "volume king" out as too
 * easy to game — different programs make it a measure of exercise selection, not
 * effort. Volume survives only as an opt-in challenge metric, where everyone
 * agreed on the same exercise first. Don't "helpfully" add the column back.
 *
 * `from`/`to` are arguments, not `Date.now()` — a query doesn't rerun because
 * the clock moved, and the client owns "today" in its own timezone.
 */
export const leaderboard = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const rows = [];
    for (const member of await crew(ctx)) {
      const workouts = await ctx.db
        .query("workouts")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", member._id).gte("date", args.from).lte("date", args.to),
        )
        .take(200);

      // Only workout headers are read here, so there is no volume to bucket — the
      // zero is what weeklyBuckets wants as input, and only `sessions` comes back
      // out. Sessions per week is the consistency metric the issue asked for.
      const weeks = weeklyBuckets(
        workouts.map((workout) => ({ date: workout.date, volume: 0 })),
        args.from,
        args.to,
      );

      // Baselines excluded: a first-ever performance broke no record, so counting
      // them would put whoever logged the most new exercises on top.
      const prs = await ctx.db
        .query("prs")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", member._id).gte("date", args.from).lte("date", args.to),
        )
        .take(500);

      rows.push({
        userId: member._id,
        name: member.name,
        avatarUrl: member.avatarUrl,
        sessions: workouts.length,
        streak: currentStreak(weeks),
        prCount: prs.filter((pr) => !pr.baseline).length,
        weeks: weeks.map((week) => week.sessions),
      });
    }
    return rows;
  },
});

/**
 * "X just hit a PR on développé couché", newest first.
 *
 * There is no index on `prs.date` alone and there shouldn't be: one query per
 * crew member on `by_user_and_date` desc, merged in memory, is 4 index reads
 * instead of a table scan.
 */
export const feed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const limit = args.limit ?? 20;

    const rows = [];
    for (const member of await crew(ctx)) {
      // ponytail: takes 50 per member to find the non-baselines among them — a
      // first session writes one baseline per exercise per type, so the newest
      // rows are mostly baselines.
      const prs = await ctx.db
        .query("prs")
        .withIndex("by_user_and_date", (q) => q.eq("userId", member._id))
        .order("desc")
        .take(50);

      for (const pr of prs) {
        if (pr.baseline) continue;
        rows.push({
          _id: pr._id,
          userId: member._id,
          name: member.name,
          avatarUrl: member.avatarUrl,
          exerciseName: pr.exerciseName,
          type: pr.type,
          value: pr.value,
          date: pr.date,
          at: pr._creationTime,
        });
      }
    }
    // `date` is day-granular, so two PRs from the same session would order
    // arbitrarily — _creationTime breaks the tie in the order they were written.
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, limit);
  },
});

/**
 * Every exercise the crew could be scored on, with the fairness counts.
 *
 * Union of logged and prescribed: `workouts.start` copies
 * `programs.days[].exercises[].name` verbatim into `sets.exerciseName`, so an
 * exercise somebody has in their program scores correctly even with zero
 * history — and a défi on what the whole crew is programmed to do beats one on
 * whatever happened to get logged first.
 *
 * `inPrograms` / `logged` are the fairness signal the model needs: a défi only
 * one person can do isn't a défi, which is the whole reason a boxer and a
 * bodybuilder don't compete on développé couché.
 */
async function candidateExercises(ctx: QueryCtx) {
  const counts = new Map<string, { inPrograms: number; logged: number }>();
  const bump = (name: string, key: "inPrograms" | "logged") => {
    const row = counts.get(name) ?? { inPrograms: 0, logged: 0 };
    row[key]++;
    counts.set(name, row);
  };

  for (const member of await crew(ctx)) {
    const prs = await ctx.db
      .query("prs")
      .withIndex("by_user_and_exercise", (q) => q.eq("userId", member._id))
      .take(1000);
    for (const name of new Set(prs.map((pr) => pr.exerciseName))) bump(name, "logged");

    // ponytail: the last program trained, one document per member. A member's
    // other programs and older versions hold exercises nobody trains this week;
    // read `by_user_and_lineage` if that ever becomes a signal worth having.
    const program = member.currentProgramId
      ? await ctx.db.get("programs", member.currentProgramId)
      : null;
    const prescribed = new Set(
      (program?.days ?? []).flatMap((day) => day.exercises.map((exercise) => exercise.name)),
    );
    for (const name of prescribed) bump(name, "inPrograms");
  }

  // Most-shared first: the model reads the top of the list as the best défis.
  return [...counts]
    .map(([name, count]) => ({ name, ...count }))
    .sort(
      (a, b) =>
        b.inPrograms - a.inPrograms || b.logged - a.logged || a.name.localeCompare(b.name, "fr"),
    );
}

/**
 * The create form's exercise picker. A picker and not a text field because
 * scoring matches `exerciseName` exactly — a typo would score the whole défi 0
 * and read as "nobody trained".
 */
export const exerciseNames = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    // Same candidate list the Monday cron generates from, so the form can create
    // any défi the coach can and both agree on what scores. Sorted by name here
    // — a picker reads alphabetically; the cron wants most-shared first.
    const candidates = await candidateExercises(ctx);
    return candidates.map((c) => c.name).sort((a, b) => a.localeCompare(b, "fr"));
  },
});

/** The week's challenges with standings already sorted, so the UI just renders. */
export const challenges = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const members = new Map((await crew(ctx)).map((member) => [member._id, member]));
    const rows = await ctx.db
      .query("challenges")
      .withIndex("by_week", (q) => q.eq("weekStart", args.weekStart))
      .take(20);

    const out = [];
    for (const challenge of rows) {
      // Scored over the challenge's own week, never the leaderboard's window.
      const to = shift(challenge.weekStart, 6);
      const standings = [];
      for (const participantId of challenge.participants) {
        const member = members.get(participantId);
        if (!member) continue; // left the crew
        const { workouts, sets } = await weekWork(ctx, participantId, challenge.weekStart, to);
        standings.push({
          userId: participantId,
          name: member.name,
          avatarUrl: member.avatarUrl,
          score: scoreChallenge(challenge.metric, challenge.exerciseName, sets, workouts.length),
        });
      }
      out.push({
        _id: challenge._id,
        title: challenge.title,
        weekStart: challenge.weekStart,
        metric: challenge.metric,
        exerciseName: challenge.exerciseName,
        createdBy: challenge.createdBy,
        joined: challenge.participants.includes(user._id),
        standings: standings.sort((a, b) => b.score - a.score),
      });
    }
    return out;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    weekStart: v.string(),
    metric: challengeMetric,
    exerciseName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // Any other day would silently score a window nobody agreed on, and the
    // by_week index would never find it.
    if (weekStart(args.weekStart) !== args.weekStart) {
      throw new Error("weekStart must be a Monday");
    }
    // Fairness: comparing "most volume" across a boxer's and a bodybuilder's
    // whole programs measures exercise selection, not effort.
    if (args.metric !== "sessions" && !args.exerciseName) {
      throw new Error("exerciseName is required for this metric");
    }

    // You don't open a challenge you're not in.
    return await ctx.db.insert("challenges", {
      ...args,
      createdBy: user._id,
      participants: [user._id],
    });
  },
});

/** The whole opt-in mechanism: membership in `participants` is the entry. */
export const toggleJoin = mutation({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const challenge = await ctx.db.get("challenges", args.challengeId);
    if (!challenge) throw new Error("Challenge not found");

    const joined = challenge.participants.includes(user._id);
    await ctx.db.patch("challenges", challenge._id, {
      participants: joined
        ? challenge.participants.filter((id) => id !== user._id)
        : [...challenge.participants, user._id],
    });
    return !joined;
  },
});

// ---------------------------------------------------------------------------
// The Monday cron: the coach proposes the week's défis
//
// The failure mode this fixes is nobody remembering to open one. Nobody is
// opted in — the défi lands with an empty standings list and each person taps
// « Rejoindre ».
// ---------------------------------------------------------------------------

// ponytail: a month and a half of history is enough to stop the model looping,
// and it's 6 equality reads on `by_week` — no new index, no scan. Widen the
// number, not the mechanism, if the défis still feel repetitive.
const RECENT_WEEKS = 6;

/** Everything the prompt gets, and nothing else. Bounded by the crew's size. */
export const weeklyContext = internalQuery({
  args: { weekStart: v.string() },
  handler: async (ctx, args) => {
    const members = [];
    for (const member of await crew(ctx)) {
      const workouts = await ctx.db
        .query("workouts")
        .withIndex("by_user_and_date", (q) =>
          q
            .eq("userId", member._id)
            .gte("date", shift(args.weekStart, -28))
            .lte("date", shift(args.weekStart, -1)),
        )
        .take(100);
      members.push({
        name: member.name,
        sessions: workouts.length,
        // Onboarding is optional — somebody signed up and never finished it.
        sport: member.onboarding?.sport,
        goals: member.onboarding?.goals ?? [],
        experience: member.onboarding?.experience,
      });
    }

    const week = (start: string) =>
      ctx.db
        .query("challenges")
        .withIndex("by_week", (q) => q.eq("weekStart", start))
        .take(20);

    // Labelled by age, not merged: repeating three weeks ago is forgivable,
    // repeating last week isn't, and the model can only tell if we say which.
    const recentWeeks = [];
    for (let weeksAgo = 1; weeksAgo <= RECENT_WEEKS; weeksAgo++) {
      const defis = (await week(shift(args.weekStart, -7 * weeksAgo))).map((challenge) => ({
        title: challenge.title,
        metric: challenge.metric,
        exerciseName: challenge.exerciseName,
      }));
      if (defis.length) recentWeeks.push({ weeksAgo, defis });
    }

    return {
      candidates: await candidateExercises(ctx),
      members,
      recentWeeks,
      // Idempotency: read here so the action needs a single roundtrip.
      alreadyGenerated: (await week(args.weekStart)).length > 0,
    };
  },
});

// Nullable, not optional: strict structured output can't express "absent".
const zDefis = z.object({
  defis: z
    .array(
      z.object({
        title: z
          .string()
          .describe("Titre court et parlant, en français. Ex : « Le plus de tractions »"),
        metric: z.enum(["sessions", "volume", "max_reps", "max_weight", "est_1rm"]),
        exerciseName: z
          .string()
          .nullable()
          .describe("Un nom copié EXACTEMENT depuis la liste fournie, ou null pour `sessions`"),
      }),
    )
    .min(1)
    .max(2),
});

export const generateWeekly = internalAction({
  args: {},
  handler: async (ctx) => {
    // An action may read the clock; a query may not. This is the only place the
    // week is decided.
    const monday = weekStart(new Date().toISOString().slice(0, 10));

    const context = await ctx.runQuery(internal.crew.weeklyContext, { weekStart: monday });
    // A cron retries, and this is also run by hand to test it.
    if (context.alreadyGenerated) return null;

    const { object, usage, providerMetadata } = await generateObject({
      model: languageModel(),
      providerOptions: { openrouter: { usage: { include: true } } },
      schema: zDefis,
      system:
        "Tu es le coach de FitCrew, une app de muscu pour une bande de quatre potes. " +
        "Tu proposes les défis de la semaine. Tu parles français, tu tutoies, tu es bref.\n\n" +
        "Règles :\n" +
        "- 1 ou 2 défis, pas plus. Dès que la liste d'exercices ci-dessous n'est pas vide, " +
        "propose un défi sur un exercice, et ajoute un défi de régularité (`sessions`) si " +
        "la crew a besoin d'un coup de pied. Un historique vide n'est pas une raison de " +
        "s'abstenir : le programme suffit.\n" +
        "- Choisis en priorité un exercice que le plus de monde a dans son programme : un " +
        "défi que deux personnes sur quatre peuvent faire n'est pas un défi. La colonne " +
        "« programmes » compte les membres qui l'ont dans leur programme actuel, « logué » " +
        "ceux qui l'ont déjà chargé. Un exercice programmé sans historique est un défi " +
        "valable. Si l'exercice est partagé par toute la crew, dis-le dans le titre.\n" +
        "- Respecte le sport et les objectifs de chacun : ne mets pas un boxeur et un " +
        "powerlifter en concurrence sur un exercice qui n'intéresse qu'un des deux.\n" +
        "- `exerciseName` doit être copié EXACTEMENT depuis la liste des exercices " +
        "ci-dessous. N'invente rien, ne reformule rien, ne traduis rien.\n" +
        "- `sessions` est le seul metric sans exercice : mets `null`. Tous les autres en " +
        "exigent un.\n" +
        "- `max_reps` ne compte que les reps au poids du corps (tractions, pompes, dips).\n" +
        "- Ne réutilise pas un metric ou un exercice des semaines récentes. Plus le défi est " +
        "récent, plus le répéter est mauvais : la semaine dernière, jamais ; il y a six " +
        "semaines, tolérable.\n" +
        "- Si la liste d'exercices est vide, un seul défi `sessions` est la bonne réponse, " +
        "pas un échec.\n" +
        "- Les titres sont courts, concrets, sans emoji.\n\n" +
        `EXERCICES POSSIBLES (programmes actuels + historique) :\n${
          context.candidates
            .map((c) => `${c.name} — programmes : ${c.inPrograms}, logué : ${c.logged}`)
            .join("\n") || "(aucun)"
        }\n\n` +
        `LA CREW (séances sur les 4 dernières semaines) :\n${
          context.members
            .map(
              (m) =>
                `${m.name} : ${m.sessions} séances` +
                `${m.sport ? `, sport : ${m.sport}` : ""}` +
                `${m.experience ? `, niveau : ${m.experience}` : ""}` +
                `${m.goals.length ? `, objectifs : ${m.goals.join(", ")}` : ""}`,
            )
            .join("\n") || "(personne)"
        }\n\n` +
        `DÉFIS RÉCENTS :\n${
          context.recentWeeks
            .map(
              (w) =>
                `Il y a ${w.weeksAgo} semaine${w.weeksAgo > 1 ? "s" : ""} : ` +
                w.defis
                  .map(
                    (c) => `${c.title} (${c.metric}${c.exerciseName ? `, ${c.exerciseName}` : ""})`,
                  )
                  .join(" ; "),
            )
            .join("\n") || "(aucun)"
        }`,
      prompt: `Propose les défis de la semaine du ${monday}.`,
    });

    await ctx.runMutation(internal.aiUsage.record, {
      feature: "challenge",
      model: MODEL_ID,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
      costUsd: costUsdFrom(providerMetadata),
    });

    // Scoring matches `exerciseName` byte for byte, so a hallucinated or merely
    // reworded name scores the whole crew 0 and reads as "nobody trained".
    // Dropping the défi is the honest failure; inserting it is the silent one.
    const valid = new Set(context.candidates.map((candidate) => candidate.name));
    const defis = object.defis.filter((defi) =>
      defi.metric === "sessions" ? true : !!defi.exerciseName && valid.has(defi.exerciseName),
    );
    if (defis.length === 0) return null;

    await ctx.runMutation(internal.crew.insertGenerated, {
      weekStart: monday,
      defis: defis.map((defi) => ({
        title: defi.title,
        metric: defi.metric,
        ...(defi.metric === "sessions" ? {} : { exerciseName: defi.exerciseName ?? undefined }),
      })),
    });
    return null;
  },
});

/** Actions have no `ctx.db`. No `createdBy`, no participants — nobody is opted in. */
export const insertGenerated = internalMutation({
  args: {
    weekStart: v.string(),
    defis: v.array(
      v.object({
        title: v.string(),
        metric: challengeMetric,
        exerciseName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const defi of args.defis) {
      await ctx.db.insert("challenges", { ...defi, weekStart: args.weekStart, participants: [] });
    }
    return null;
  },
});
