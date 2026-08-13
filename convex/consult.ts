import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalQuery } from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import { MODEL_ID, languageModel } from "./model";
import { weekStart } from "./progress";
import { requireCurrentUser } from "./users";

/**
 * Coach <-> Chef collaboration. One agent asks the other a single question and
 * gets a single answer back.
 */

// ---------------------------------------------------------------------------
// Pure boundary. No ctx, no clock — see consult.check.ts.
// ---------------------------------------------------------------------------

export type ConsultMeal = { name: string; timing: string; calories: number };

export type ConsultAnswer = {
  recommendation: string;
  meals?: ConsultMeal[];
  constraints?: string[];
  /** Never "measured": a consult is one agent's opinion about the other's field. */
  confidence: "estimated";
};

/** ponytail: 800 chars ≈ a paragraph. Widen it only if answers come out blind. */
const MAX_CONTEXT = 800;

/**
 * The caller's `context` string is the ONLY thing of the user's data the calling
 * agent gets to hand over, and it is written by a model — so it is bounded here
 * rather than trusted. Truncation is visible ("…") so the consultee can tell it
 * was cut and ask for less rather than assume it saw everything.
 */
export function truncateContext(text: string, max = MAX_CONTEXT): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * Strict structured output cannot express "optional", so the model returns nulls.
 * They are dropped rather than forwarded: an `undefined` key and a `null` key
 * read the same to a human but not to a consumer doing `answer.meals?.length`.
 * An empty array is dropped too — "no meals" and "[]" are the same answer, and
 * one of them renders as an empty section.
 */
export function normalizeConsult(raw: {
  recommendation: string;
  meals: ConsultMeal[] | null;
  constraints: string[] | null;
}): ConsultAnswer {
  return {
    recommendation: raw.recommendation.trim(),
    ...(raw.meals?.length ? { meals: raw.meals } : {}),
    ...(raw.constraints?.length ? { constraints: raw.constraints } : {}),
    confidence: "estimated",
  };
}

const zConsultAnswer = z.object({
  recommendation: z.string().describe("2 à 5 phrases, en français, tutoiement. Pas de préambule."),
  meals: z
    .array(
      z.object({
        name: z.string(),
        timing: z.string().describe('Ex : "2 h avant la séance", "juste après"'),
        calories: z.number().min(0).describe("Estimation en kcal"),
      }),
    )
    .nullable()
    .describe("Repas concrets proposés, ou null si la question n'en demande pas"),
  constraints: z
    .array(z.string())
    .nullable()
    .describe("Contraintes que l'autre agent doit respecter, ou null s'il n'y en a pas"),
});

// ---------------------------------------------------------------------------
// Grounding — deliberately narrow
// ---------------------------------------------------------------------------

/**
 * What the Coach is allowed to see of the training side when the Chef asks.
 * Issue #31 asks to "ne partager entre agents que le contexte nécessaire", so
 * this projection IS the boundary: cardio imports, bodyweight, PRs and the food
 * log are all readable here and deliberately not read.
 */
export const coachGrounding = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const program = user.currentProgramId
      ? await ctx.db.get("programs", user.currentProgramId)
      : null;
    const sessions = await ctx.db
      .query("workouts")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(5);

    return {
      userId: user._id,
      program: program && {
        name: program.name,
        days: program.days.map((day) => ({
          name: day.name,
          exercises: day.exercises.map((e) => `${e.name} ${e.sets}×${e.reps}`),
        })),
        progressionRules: program.progressionRules,
      },
      recentSessions: sessions.map((s) => ({ date: s.date, dayIndex: s.dayIndex ?? null })),
      goals: user.onboarding?.goals ?? [],
      limitations: user.onboarding?.limitations ?? null,
    };
  },
});

/**
 * What the Chef is allowed to see of the nutrition side when the Coach asks.
 * Same rule as above: the food log, the hydration figure and the inventory are
 * the user's day-to-day and none of the Coach's business — only the profile, the
 * stored targets and today's planned meals cross.
 */
export const chefGrounding = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const profile = await ctx.db
      .query("nutritionProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const plan = await ctx.db
      .query("mealPlans")
      .withIndex("by_user_and_week", (q) =>
        q.eq("userId", user._id).eq("weekStart", weekStart(args.today)),
      )
      .unique();

    return {
      userId: user._id,
      profile: profile && {
        goal: profile.goal,
        targets: profile.targets,
        diet: profile.diet ?? null,
        allergies: profile.allergies,
        excluded: profile.excluded,
        mealsPerDay: profile.mealsPerDay,
        cookMinutes: profile.cookMinutes ?? null,
      },
      todayMeals: (plan?.days.find((d) => d.date === args.today)?.meals ?? []).map((meal) => ({
        slot: meal.slot,
        name: meal.name,
        macros: meal.macros,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// The two consults
// ---------------------------------------------------------------------------

const consultArgs = {
  question: v.string(),
  context: v.string(),
  expectedFormat: v.optional(v.string()),
};

/**
 * One `generateObject` call, and NO `tools` argument at all.
 *
 * That absence is the loop prevention asked for by "les échanges inter-agents
 * sont bornés et ne peuvent pas boucler indéfiniment". It is structural, not a
 * depth counter: with no tools in the request, the consultee has no `ask_coach`
 * / `ask_chef` to call, so it physically cannot consult back and the maximum
 * round-trip depth is 1 by construction. A counter would have to be threaded
 * through every call site and could be got wrong; this cannot.
 */
async function consult(
  ctx: ActionCtx,
  who: string,
  userId: Id<"users">,
  system: string,
  question: string,
  context: string,
  expectedFormat: string | undefined,
): Promise<ConsultAnswer> {
  const bounded = truncateContext(context);
  // Traceability: who asked what, and what came back. The acceptance criterion is
  // about bounded exchanges, and a bounded exchange you can't see is only a claim.
  console.log(`consult:${who} question=${JSON.stringify(question.slice(0, 200))}`);

  const { object, usage, providerMetadata } = await generateObject({
    model: languageModel(),
    providerOptions: { openrouter: { user: userId, usage: { include: true } } },
    schema: zConsultAnswer,
    system,
    prompt:
      `QUESTION DE L'AUTRE AGENT :\n${question}\n\n` +
      `CONTEXTE QU'IL TE DONNE :\n${bounded || "(rien)"}\n\n` +
      (expectedFormat ? `FORMAT ATTENDU : ${expectedFormat}\n\n` : "") +
      "Réponds directement. Tu parles à un collègue, pas au user.",
  });

  await ctx.runMutation(internal.aiUsage.record, {
    userId,
    feature: "consult",
    model: MODEL_ID,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    costUsd: costUsdFrom(providerMetadata),
  });

  const answer = normalizeConsult(object);
  console.log(
    `consult:${who} answer=${JSON.stringify(truncateContext(answer.recommendation, 200))}`,
  );
  return answer;
}

const SHARED_RULES = `Tu réponds à un autre agent de l'app, pas au user. Sois bref et directement exploitable.
Tu n'as AUCUN outil : tu réponds avec ce qui est écrit ci-dessous et rien d'autre. Si l'info te manque, dis-le dans \`recommendation\` au lieu d'inventer.
Tu n'es ni médecin ni diététicien : pathologie, symptôme, médicament, trouble alimentaire, grossesse, enfant → tu renvoies vers un professionnel de santé et tu ne produis pas de plan.`;

/** Called by the Coach's `ask_chef` tool. */
export const askChef = internalAction({
  args: consultArgs,
  handler: async (ctx, args): Promise<ConsultAnswer> => {
    // An action may read the clock (a query may not), and the consult args are
    // fixed by the contract — so today is derived here. UTC: a consult at 01:00
    // in Bordeaux reads yesterday's plan, which is the wrong day but never the
    // wrong user, and nothing is written from it.
    const today = new Date().toISOString().slice(0, 10);
    const g = await ctx.runQuery(internal.consult.chefGrounding, { today });

    const system = `Tu es « Le Chef », l'assistant nutrition de FitCrew. Le coach sportif te consulte.
${SHARED_RULES}
Toute valeur en kcal ou en macros est une ESTIMATION : dis-le.
Les allergies et les aliments exclus sont des contraintes DURES. Une proposition qui en contient une est un bug, pas un choix de style. Remonte-les dans \`constraints\`.

${
  g.profile
    ? `PROFIL NUTRITION
- Objectif : ${g.profile.goal}
- Cibles quotidiennes (estimées) : ${g.profile.targets.calories} kcal, ${g.profile.targets.protein} g P / ${g.profile.targets.carbs} g G / ${g.profile.targets.fat} g L
- Régime : ${g.profile.diet ?? "aucun"}
- Allergies : ${g.profile.allergies.join(", ") || "aucune"}
- Exclusions : ${g.profile.excluded.join(", ") || "aucune"}
- ${g.profile.mealsPerDay} repas/jour${g.profile.cookMinutes ? `, ${g.profile.cookMinutes} min de cuisine par repas` : ""}`
    : "PROFIL NUTRITION : aucun. Dis-le au coach — sans profil tes chiffres ne valent rien."
}

REPAS PRÉVUS AUJOURD'HUI (${today}) :
${g.todayMeals.map((m) => `- ${m.slot} : ${m.name} (~${m.macros.calories} kcal, ${m.macros.protein} g P)`).join("\n") || "(aucun plan pour aujourd'hui)"}`;

    return await consult(
      ctx,
      "chef",
      g.userId,
      system,
      args.question,
      args.context,
      args.expectedFormat,
    );
  },
});

/** Called by the Chef's `ask_coach` tool. */
export const askCoach = internalAction({
  args: consultArgs,
  handler: async (ctx, args): Promise<ConsultAnswer> => {
    const g = await ctx.runQuery(internal.consult.coachGrounding, {});

    const system = `Tu es le coach sportif de FitCrew. « Le Chef », l'assistant nutrition, te consulte.
${SHARED_RULES}
Ce qui l'intéresse : quelle séance arrive, son intensité, quels muscles, et ce que ça implique pour l'alimentation autour. Ne remplis \`meals\` que si on te le demande explicitement — ce n'est pas ton métier.

${
  g.program
    ? `PROGRAMME ACTUEL — « ${g.program.name} »
${g.program.days.map((day, i) => `[jour ${i}] ${day.name} : ${day.exercises.join(", ")}`).join("\n")}
Progression : ${g.program.progressionRules}`
    : "PROGRAMME ACTUEL : aucun. Dis-le au Chef."
}

DERNIÈRES SÉANCES (les jours du programme se suivent dans l'ordre, une séance = un jour) :
${g.recentSessions.map((s) => `- ${s.date}${s.dayIndex === null ? " (importée)" : ` — jour ${s.dayIndex}`}`).join("\n") || "(aucune)"}

Objectifs : ${g.goals.join(", ") || "non renseignés"}
Limitations : ${g.limitations ?? "aucune"}`;

    return await consult(
      ctx,
      "coach",
      g.userId,
      system,
      args.question,
      args.context,
      args.expectedFormat,
    );
  },
});
