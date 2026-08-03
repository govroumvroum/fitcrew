import {
  Agent,
  createThread,
  createTool,
  getThreadMetadata,
  listUIMessages,
  stepCountIs,
  syncStreams,
  updateThreadMetadata,
  type ToolCtx,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v, type GenericId } from "convex/values";
import { z } from "zod";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import { languageModel } from "./model";
import { programExercise } from "./schema";
import { searchWeb } from "./search";
import { zGenerateProgram, zLogWorkout, zSaveOnboarding, zSwapExercise } from "./toolSchemas";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure shape conversion (model output -> what the schema accepts)
// ---------------------------------------------------------------------------

type ModelExercise = {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string | null;
};
type ModelDay = { name: string; exercises: ModelExercise[] };
type Days = Doc<"programs">["days"];

/** Strict structured output can't express "optional", so nulls come back instead. */
export function toDays(days: ModelDay[]): Days {
  return days.map((day) => ({
    name: day.name,
    exercises: day.exercises.map(({ notes, ...rest }) => ({
      ...rest,
      ...(notes ? { notes } : {}),
    })),
  }));
}

/** Exported for the self-check in `src/components/chat/program.check.ts`. */
export function swapInDays(
  days: Days,
  dayIndex: number,
  from: string,
  to: Days[number]["exercises"][number],
): Days {
  const day = days[dayIndex];
  if (!day) throw new Error(`Jour ${dayIndex} introuvable dans le programme`);
  const i = day.exercises.findIndex(
    (e) => e.name.toLowerCase().trim() === from.toLowerCase().trim(),
  );
  if (i === -1) throw new Error(`Exercice « ${from} » introuvable dans « ${day.name} »`);
  return days.map((d, j) =>
    j === dayIndex ? { ...d, exercises: d.exercises.map((e, k) => (k === i ? to : e)) } : d,
  );
}

// ---------------------------------------------------------------------------
// Program persistence — always a new version, never an edit
// ---------------------------------------------------------------------------

const programDays = v.array(v.object({ name: v.string(), exercises: v.array(programExercise) }));

export const saveProgram = internalMutation({
  args: {
    name: v.string(),
    days: programDays,
    progressionRules: v.string(),
    deloadEveryWeeks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const latest = await ctx.db
      .query("programs")
      .withIndex("by_user_and_version", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const programId = await ctx.db.insert("programs", { userId: user._id, version, ...args });
    await ctx.db.patch("users", user._id, { currentProgramId: programId });
    return { version, days: args.days.length };
  },
});

export const swapExercise = internalMutation({
  args: { dayIndex: v.number(), from: v.string(), to: programExercise },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const current = user.currentProgramId
      ? await ctx.db.get("programs", user.currentProgramId)
      : null;
    if (!current) throw new Error("Pas encore de programme à modifier");

    const days = swapInDays(current.days, args.dayIndex, args.from, args.to);
    const programId = await ctx.db.insert("programs", {
      userId: user._id,
      version: current.version + 1,
      name: current.name,
      days,
      progressionRules: current.progressionRules,
      deloadEveryWeeks: current.deloadEveryWeeks,
    });
    await ctx.db.patch("users", user._id, { currentProgramId: programId });
    return { version: current.version + 1, dayName: days[args.dayIndex].name };
  },
});

// ---------------------------------------------------------------------------
// Reads the coach needs
// ---------------------------------------------------------------------------

async function loadContext(ctx: QueryCtx) {
  const user = await requireCurrentUser(ctx);
  const program = user.currentProgramId
    ? await ctx.db.get("programs", user.currentProgramId)
    : null;
  return { user, program };
}

/**
 * Adds what the user did outside the gym. Fixed counts rather than a date
 * window: a query can't read the clock, and "the last few" is what the coach
 * needs anyway. Not in `loadContext` — `exerciseContext` would pay for reads it
 * never uses.
 */
export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const base = await loadContext(ctx);
    const cardio = await ctx.db
      .query("cardio")
      .withIndex("by_user_and_date", (q) => q.eq("userId", base.user._id))
      .order("desc")
      .take(5);
    const weights = await ctx.db
      .query("bodyweight")
      .withIndex("by_user_and_date", (q) => q.eq("userId", base.user._id))
      .order("desc")
      .take(1);
    return { ...base, cardio, weight: weights[0] ?? null };
  },
});

/** Grounding for "pourquoi cet exercice ?" — the prescription plus what the user actually lifted. */
export const exerciseContext = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { user, program } = await loadContext(ctx);
    const needle = args.name.toLowerCase().trim();

    let prescription: { day: string; exercise: Days[number]["exercises"][number] } | null = null;
    for (const day of program?.days ?? []) {
      const found = day.exercises.find((e) => e.name.toLowerCase().trim() === needle);
      if (found) prescription = { day: day.name, exercise: found };
    }

    const recentSets = await ctx.db
      .query("sets")
      .withIndex("by_user_and_exercise", (q) =>
        q.eq("userId", user._id).eq("exerciseName", args.name),
      )
      .order("desc")
      .take(10);
    const prs = await ctx.db
      .query("prs")
      .withIndex("by_user_and_exercise", (q) =>
        q.eq("userId", user._id).eq("exerciseName", args.name),
      )
      .order("desc")
      .take(3);

    return {
      prescription,
      goals: user.onboarding?.goals ?? [],
      limitations: user.onboarding?.limitations ?? null,
      recentSets: recentSets.map((s) => ({ weight: s.weight, reps: s.reps, done: s.completed })),
      prs: prs.map((p) => ({ type: p.type, value: p.value, date: p.date })),
    };
  },
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `today` is closed over rather than asked of the model: it's the one value the
 * model can't know and would happily invent.
 */
function coachTools(today: string) {
  return {
    save_onboarding: createTool({
      description:
        "Enregistre le profil du user et le ton de coaching. À appeler UNIQUEMENT après que le user a validé ton récapitulatif.",
      inputSchema: zSaveOnboarding,
      execute: async (ctx: ToolCtx, { tone, sport, limitations, ...rest }) => {
        await ctx.runMutation(api.users.saveOnboarding, {
          tone,
          onboarding: {
            ...rest,
            ...(sport ? { sport } : {}),
            ...(limitations ? { limitations } : {}),
          },
        });
        return { saved: true };
      },
    }),

    generate_program: createTool({
      description:
        "Crée et enregistre un nouveau programme. Chaque appel crée une nouvelle version, l'historique est conservé.",
      inputSchema: zGenerateProgram,
      execute: async (ctx: ToolCtx, input) => {
        return await ctx.runMutation(internal.coach.saveProgram, {
          name: input.name,
          days: toDays(input.days),
          progressionRules: input.progressionRules,
          ...(input.deloadEveryWeeks ? { deloadEveryWeeks: input.deloadEveryWeeks } : {}),
        });
      },
    }),

    swap_exercise: createTool({
      description:
        "Remplace un exercice du programme actuel par un autre. Crée une nouvelle version du programme.",
      inputSchema: zSwapExercise,
      execute: async (ctx: ToolCtx, { dayIndex, from, to }) => {
        const { notes, ...rest } = to;
        return await ctx.runMutation(internal.coach.swapExercise, {
          dayIndex,
          from,
          to: { ...rest, ...(notes ? { notes } : {}) },
        });
      },
    }),

    explain_exercise: createTool({
      description:
        "Récupère la prescription et l'historique réel du user sur un exercice, pour expliquer pourquoi il est là et où il en est.",
      inputSchema: z.object({ name: z.string().describe("Nom exact de l'exercice") }),
      execute: async (ctx: ToolCtx, { name }) =>
        await ctx.runQuery(internal.coach.exerciseContext, { name }),
    }),

    extract_screenshot: createTool({
      description:
        "Lit une capture d'écran d'app de fitness jointe au message du user. Ne valide rien : le user confirmera lui-même dans l'interface.",
      inputSchema: z.object({ storageId: z.string().describe("L'id de la capture jointe") }),
      execute: async (ctx: ToolCtx, { storageId }) =>
        await ctx.runAction(api.screenshots.extract, {
          storageId: storageId as Id<"_storage">,
          today,
        }),
    }),

    log_workout: createTool({
      description:
        "Enregistre APRÈS COUP une séance déjà faite (ex: « j'ai fait 5x5 à 80kg hier »). Jamais pour une séance en cours : le user a un écran dédié pour ça.",
      inputSchema: zLogWorkout.extend({
        date: z.string().describe(`YYYY-MM-DD. Aujourd'hui = ${today}`),
      }),
      execute: async (ctx: ToolCtx, input) => {
        // ponytail: reuses the live logger's mutations, so it's 2 writes per set
        // (insert then check off). Add a bulk mutation to workouts.ts if someone
        // starts back-filling whole months.
        const workoutId = await ctx.runMutation(api.workouts.start, {
          date: input.date,
          // ponytail: 0 = "no program day"; `start` needs the arg and a
          // retroactive log rarely maps onto one.
          dayIndex: 0,
          sets: [],
        });
        let logged = 0;
        for (const exercise of input.exercises) {
          let index = 0;
          for (const set of exercise.sets) {
            const setId = await ctx.runMutation(api.workouts.addSet, {
              workoutId,
              exerciseName: exercise.name,
              index: index++,
              weight: set.weight,
              reps: set.reps,
            });
            await ctx.runMutation(api.workouts.logSet, {
              setId,
              completed: true,
              weight: set.weight,
              reps: set.reps,
            });
            logged++;
          }
        }
        if (input.notes) {
          await ctx.runMutation(api.workouts.finish, { workoutId, notes: input.notes });
        }
        return { date: input.date, sets: logged };
      },
    }),

    ask_chef: createTool({
      description:
        "Consulte « Le Chef », l'assistant nutrition, quand la réponse dépend VRAIMENT de l'alimentation (quoi manger autour d'une séance, si ses apports collent à son objectif). Jamais pour ce qui est déjà dans ton contexte. Il n'a aucun outil et ne peut pas te reconsulter : une question, une réponse.",
      inputSchema: z.object({
        question: z.string().describe("Une seule question, précise, sur la nutrition"),
        context: z
          .string()
          .describe("Le strict nécessaire pour qu'il réponde. Pas l'historique de la conversation"),
      }),
      execute: async (ctx: ToolCtx, { question, context }) =>
        await ctx.runAction(internal.consult.askChef, {
          question,
          context,
          expectedFormat: "Recommandation courte, et des repas concrets si la question en demande.",
        }),
    }),

    search_web: createTool({
      description:
        "Cherche sur le web (SearXNG) ce que tu ne peux pas savoir : recommandations actuelles, un complément ou un terme dont le user te parle, la technique d'un exercice précis. Jamais pour ce qui est déjà dans ton contexte.",
      inputSchema: z.object({
        query: z.string().describe("Requête courte, 2 à 6 mots, dans la langue du sujet"),
      }),
      execute: async (_ctx: ToolCtx, { query }) => {
        try {
          return { query, results: await searchWeb(query) };
        } catch (error) {
          // Returned, not thrown: a dead SearXNG must not abort the coach's turn.
          const message = error instanceof Error ? error.message : String(error);
          console.error("search_web", message);
          return { query, results: [], error: message };
        }
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const TONE: Record<NonNullable<Doc<"users">["tone"]>, string> = {
  motivant: "Encourageant et énergique. Tu soulignes chaque progrès. Emojis rares mais permis.",
  neutre: "Factuel et concis. Tu parles chiffres, séries, charges. Zéro superlatif.",
  direct:
    "Cash, sans bullshit. Tu ne laisses rien passer et tu le dis franchement. Jamais insultant.",
};

const QUESTIONS = `1. Niveau (débutant / intermédiaire / avancé)
2. Objectifs (prise de masse, perte de poids, endurance, souplesse, performance…)
3. Sport ou activité pratiqué à côté
4. Blessures ou limitations physiques
5. Nombre de jours par semaine disponibles
6. Durée de séance préférée (30 min / 45 min / 1 h / 1 h+)
7. Matériel dispo (salle complète, haltères, poids du corps…)`;

function systemPrompt(
  user: Doc<"users">,
  program: Doc<"programs"> | null,
  today: string,
  cardio: Doc<"cardio">[] = [],
  weight: Doc<"bodyweight"> | null = null,
) {
  const onboarding = user.onboarding;

  return `Tu es le coach sportif de ${user.name} dans l'app FitCrew. Tu parles français, tu tutoies, tu es bref : c'est une conversation sur un téléphone, pas un article de blog. 2-6 phrases par message, sauf quand tu présentes un programme.

TON : ${user.tone ? TONE[user.tone] : "Chaleureux et simple, en attendant que le user choisisse son ton."}

Nous sommes le ${today}.

${
  onboarding
    ? `PROFIL CONNU
- Niveau : ${onboarding.experience}
- Objectifs : ${onboarding.goals.join(", ")}
- Sport à côté : ${onboarding.sport ?? "aucun"}
- Limitations : ${onboarding.limitations ?? "aucune"}
- ${onboarding.daysPerWeek} jours/semaine, séances de ${onboarding.sessionMinutes} min
- Matériel : ${onboarding.equipment.join(", ")}

Le profil est déjà fait. Si le user veut le refaire ou changer ses objectifs, reprends les questions une par une et rappelle \`save_onboarding\` à la fin.`
    : `PREMIÈRE SÉANCE — LE PROFIL N'EXISTE PAS ENCORE
C'est votre première conversation. Déroule exactement ça :
- Accueille en une ou deux phrases.
- Pose les questions suivantes UNE PAR UNE. Jamais deux questions dans le même message, jamais de liste à cocher. Tu rebondis sur la réponse avant d'enchaîner.
${QUESTIONS}
- Puis fais un récapitulatif de ce que tu as compris et demande si c'est bon.
- Une fois validé, propose un ton de coaching : motivant, neutre (orienté chiffres) ou direct (sans bullshit). Laisse-le décrire autre chose et range-le dans celui des trois qui colle le mieux.
- Appelle alors \`save_onboarding\`, puis propose de générer son programme.`
}

${
  program
    ? `PROGRAMME ACTUEL — « ${program.name} » (version ${program.version})
${program.days
  .map(
    (day, i) =>
      `[jour ${i}] ${day.name}\n${day.exercises
        .map((e, j) => `  ${j + 1}. ${e.name} — ${e.sets}×${e.reps} (repos ${e.restSeconds}s)`)
        .join("\n")}`,
  )
  .join("\n")}
Progression : ${program.progressionRules}
Deload : ${program.deloadEveryWeeks ? `toutes les ${program.deloadEveryWeeks} semaines` : "non défini"}`
    : "PROGRAMME ACTUEL : aucun."
}

${
  cardio.length > 0 || weight
    ? `HORS MUSCU (importé de ses captures — il ne te l'a pas raconté, ne fais pas semblant du contraire)
${cardio
  .map(
    (c) =>
      `- ${c.date} : ${c.kind}${c.durationMin ? ` ${c.durationMin} min` : ""}${c.distanceKm ? ` ${c.distanceKm} km` : ""}${c.avgHr ? ` FC ${c.avgHr}` : ""}`,
  )
  .join("\n")}${
        weight
          ? `\n- Dernière mesure (${weight.date}) : ${[
              weight.weightKg !== undefined && `${weight.weightKg} kg`,
              weight.bodyFatPct !== undefined && `${weight.bodyFatPct} % de masse grasse`,
              weight.muscleKg !== undefined && `${weight.muscleKg} kg de muscle`,
            ]
              .filter(Boolean)
              .join(
                ", ",
              )}\n  Une balance à impédance se trompe de 3 à 5 % dans l'absolu : commente la tendance, jamais le chiffre exact.`
          : ""
      }
Tiens-en compte pour la fatigue et le volume jambes, mais n'en parle que si c'est pertinent.`
    : ""
}

RÈGLES PROGRAMME (quand tu appelles generate_program)
- Un jour = un focus clair, nommé "Jour N — Focus (muscles)".
- L'ÉCHAUFFEMENT N'EST JAMAIS UN EXERCICE de la liste. Pas de ligne "Échauffement", "Mobilité" ou "Cardio d'échauffement" dans \`exercises\`. Si tu veux en parler, mets-le dans \`progressionRules\` ou dans ton message.
- Respecte le matériel dispo, la durée de séance et les limitations. Un exercice contre-indiqué est une faute.
- Si le user fait un sport, le programme doit le servir (boxe = explosivité, gainage, épaules solides, pas de jambes détruites la veille d'un sparring).
- Après \`generate_program\`, résume le programme jour par jour dans ton message : le user ne voit que ce que tu écris.

AUTRES OUTILS
- \`swap_exercise\` dès qu'il déteste ou ne peut pas faire un exercice. Propose un remplaçant équivalent, ne demande pas 3 fois confirmation.
- \`explain_exercise\` avant d'expliquer un exercice de son programme : ça te donne son historique réel.
- \`log_workout\` seulement pour une séance passée qu'il te raconte. Une séance en cours se loge dans l'écran Séance, pas ici.
- \`extract_screenshot\` dès qu'une capture est jointe à son message. Si l'outil renvoie des entrées, dis-lui juste de vérifier et valider la fiche affichée — tu n'enregistres rien toi-même. Si il renvoie une liste vide, NE LUI PARLE PAS de fiche à valider : il n'y en a aucune à l'écran. Dis-lui ce que tu vois sur la capture et ce qui manque (une pesée a besoin du poids réel, pas du poids idéal ni de la masse musculaire), et propose-lui de te donner le chiffre directement.
- Il veut changer la durée des séances ou le nombre de jours : régénère le programme avec \`generate_program\`.
- \`ask_chef\` seulement quand la réponse dépend vraiment de son alimentation (quoi manger autour d'une séance, si ses apports servent son objectif). Une seule question, avec le minimum de contexte : le Chef ne voit pas votre conversation. Ce n'est pas ton domaine : tu relaies sa réponse, tu ne la corriges pas, et tu rappelles que ses chiffres sont des estimations. La nutrition d'une pathologie ne se règle ni avec lui ni avec toi : c'est un professionnel de santé.
- \`search_web\` seulement pour ce que tu ne peux pas savoir : une recommandation à jour, un complément ou un terme dont il te parle, la technique d'un exercice précis. Jamais pour ce qui est déjà écrit au-dessus (son profil, son programme, ses records, son cardio) et jamais pour du conseil d'entraînement générique que tu connais déjà — une recherche inutile, c'est de l'attente et des tokens pour rien.
- Quand tu t'appuies sur une recherche, cite tes sources dans ta réponse (le nom du site ou le lien) pour qu'il puisse vérifier. Si l'outil renvoie une erreur ou zéro résultat, dis-lui simplement que la recherche ne marche pas là et continue avec ce que tu sais.
- TU N'ES PAS MÉDECIN. Douleur, blessure, symptôme, médicament : tu dis clairement que ça demande un professionnel (médecin, kiné) et tu ne présentes JAMAIS un résultat de recherche comme un diagnostic ou un protocole de soin. Tu peux adapter le programme pour ménager la zone, c'est tout.`;
}

// ---------------------------------------------------------------------------
// Agent + functions
// ---------------------------------------------------------------------------

/** Built on first use: the API key only exists in the deployment, not at import time. */
let agent: Agent | undefined;
function coach() {
  agent ??= new Agent(components.agent, {
    name: "Coach FitCrew",
    languageModel: languageModel(),
    instructions: "Tu es le coach sportif de l'app FitCrew. Tu réponds en français, en tutoyant.",
    // The component already knows the userId of every call it makes, so this one
    // hook covers the whole coach — all 8 steps of every turn, tools included.
    usageHandler: async (ctx, { userId, usage, providerMetadata, model }) => {
      await ctx.runMutation(internal.aiUsage.record, {
        userId: userId as Id<"users"> | undefined,
        feature: "coach",
        model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        costUsd: costUsdFrom(providerMetadata),
      });
    },
  });
  return agent;
}

/** A thread is the user's or it doesn't exist for them. */
async function authorize(ctx: QueryCtx | ActionCtx, threadId: string, userId: Id<"users">) {
  const thread = await getThreadMetadata(ctx, components.agent, { threadId });
  if (thread.userId !== userId) throw new Error("Conversation introuvable");
}

/**
 * The user's latest coach conversation. `null` means the profile row doesn't
 * exist yet (first sign-in, webhook in flight) — this query is reactive, so the
 * client just waits. `{ threadId: null }` means they've never talked to it.
 */
export const thread = query({
  // Epoch ms of the caller's local midnight. A timestamp, not a date string:
  // comparing `_creationTime` against a UTC-derived date would discard a thread
  // started at 00:30 in Bordeaux, which is 22:30 UTC the day before.
  args: { dayStart: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: user._id,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 1 },
    });

    const latest = threads.page[0];
    if (!latest) return { threadId: null };

    // One conversation per day. Continuity lives in the database — profile,
    // program, PRs are rebuilt into the system prompt on every call — so
    // yesterday's transcript is cost without value. Returning null makes the
    // client open a fresh thread, and the coach greets you for the new day.
    // ponytail: a chat spanning midnight splits in two. Nobody will notice.
    return { threadId: latest._creationTime >= args.dayStart ? latest._id : null };
  },
});

/** Untitled on purpose: the first user message names it (see `titleFrom`). */
export const newThread = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await createThread(ctx, components.agent, { userId: user._id });
  },
});

/** The sidebar's list. Paginated — nobody needs every conversation at once. */
export const threads = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: user._id,
      order: "desc",
      paginationOpts: args.paginationOpts,
    });
    return {
      ...result,
      page: result.page.map((t) => ({
        _id: t._id,
        _creationTime: t._creationTime,
        title: t.title ?? null,
      })),
    };
  },
});

export const renameThread = mutation({
  args: { threadId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    await updateThreadMetadata(ctx, components.agent, {
      threadId: args.threadId,
      patch: { title: args.title.slice(0, 80) },
    });
    return null;
  },
});

/** Real delete, not archive: the component deletes the messages too, in pages. */
export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: args.threadId as GenericId<"threads">,
    });
    return null;
  },
});

/**
 * First user message becomes the title, truncated. No LLM call: a substring is
 * a perfectly good label and the whole point of this app's prompt budget is not
 * paying for prose nobody reads.
 * `"Coach"` was the old blanket title — treat it as unset so old threads get one.
 */
async function ensureTitle(ctx: ActionCtx, threadId: string, prompt: string) {
  const meta = await getThreadMetadata(ctx, components.agent, { threadId });
  if (meta.title && meta.title !== "Coach") return;
  const title = prompt.length > 40 ? `${prompt.slice(0, 39).trimEnd()}…` : prompt;
  await updateThreadMetadata(ctx, components.agent, { threadId, patch: { title } });
}

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    // Machine-generated turns are persisted as user messages; without this they
    // render as the user's own bubbles (see `KICKOFF`).
    const page = paginated.page.filter(
      (message) => !(message.role === "user" && isSentinel(message.text)),
    );
    return { ...paginated, page, streams };
  },
});

/**
 * Called straight from the client so the user's auth reaches the tools — they
 * write through the same authenticated mutations the UI uses. The reply arrives
 * over the `listMessages` subscription, so the caller need not await this.
 */
export const send = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    today: v.string(),
    /** Captures joined to this message. Kept out of the prompt so the user's
     * bubble stays readable — the ids reach the model as unsaved context. */
    storageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await stream(ctx, args.threadId, args.today, {
      prompt: args.prompt,
      ...(args.storageIds?.length && {
        messages: [
          {
            role: "user" as const,
            content: `${ATTACHMENTS}, à lire avec extract_screenshot : ${args.storageIds.join(", ")})`,
          },
        ],
      }),
    });
    return null;
  },
});

/**
 * The two machine-written user turns: the coach's kickoff, and the marker that
 * tells it which captures are attached. Both ARE saved — the component treats
 * the last `messages` entry as the prompt, and `storageOptions.saveMessages:
 * "none"` would drop the reply with it. `listMessages` hides them instead, which
 * also cleans the threads that already have the rows. Hiding is display-only:
 * later turns still replay them to the model, which is why the marker exists.
 */
export const KICKOFF = "(le user vient d'ouvrir la conversation)";
/** Prefix, not the whole string: the storage ids are appended to it in `send`. */
const ATTACHMENTS = "(captures jointes à ce message";

function isSentinel(text: string) {
  const trimmed = text.trim();
  return trimmed === KICKOFF || trimmed.startsWith(ATTACHMENTS);
}

export const greet = action({
  args: { threadId: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    await stream(ctx, args.threadId, args.today, {
      messages: [{ role: "user", content: KICKOFF }],
    });
    return null;
  },
});

async function stream(
  ctx: ActionCtx,
  threadId: string,
  today: string,
  promptArgs:
    | { prompt: string; messages?: { role: "user"; content: string }[] }
    | { messages: { role: "user"; content: string }[] },
) {
  const { user, program, cardio, weight } = await ctx.runQuery(internal.coach.context, {});
  await authorize(ctx, threadId, user._id);
  // After authorize, never before: this writes to the thread.
  if ("prompt" in promptArgs) await ensureTitle(ctx, threadId, promptArgs.prompt);

  const result = await coach().streamText(
    ctx,
    { userId: user._id, threadId },
    {
      ...promptArgs,
      system: systemPrompt(user, program, today, cardio, weight),
      tools: coachTools(today),
      // A tool call must be followed by the coach's own words, so one step is
      // never enough (the AI SDK default).
      stopWhen: stepCountIs(8),
      // `usage.include` makes OpenRouter return the real cost; `user` is its
      // anti-abuse identifier, not analytics — the numbers come from usageHandler.
      providerOptions: { openrouter: { user: user._id, usage: { include: true } } },
    },
    {
      saveStreamDeltas: true,
      // The component default is 100 recent messages, re-sent on every turn.
      // 20 is plenty here: the coach's actual state — profile, current program,
      // PRs — lives in Convex and is rebuilt into the system prompt each call,
      // so old transcript is chatter, not memory.
      contextOptions: { recentMessages: 20 },
    },
  );
  await result.consumeStream();
}
