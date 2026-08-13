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
import { CONTEXT_OPTIONS, languageModel } from "./model";
import { latestPerLineage, lineageOf, userPrograms } from "./programs";
import { programExercise } from "./schema";
import { searchWeb } from "./search";
import { zGenerateProgram, zLogWorkout, zSaveOnboarding, zSwapExercise } from "./toolSchemas";
import { KICKOFF, COACH_ATTACHMENTS, isSentinel } from "./sentinels";
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
// Program persistence — always a new row, never an edit
// ---------------------------------------------------------------------------

const programDays = v.array(v.object({ name: v.string(), exercises: v.array(programExercise) }));

/**
 * A brand new program — a new lineage at version 1. The user's other programs
 * are left exactly as they were: generating a boxing program is not a reason to
 * throw away the musculation one. They run in parallel from here.
 */
export const saveProgram = internalMutation({
  args: {
    name: v.string(),
    days: programDays,
    progressionRules: v.string(),
    deloadEveryWeeks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const programId = await ctx.db.insert("programs", {
      userId: user._id,
      version: 1,
      status: "active",
      ...args,
    });
    // A root row's lineage is itself, and we only know the id after the insert.
    await ctx.db.patch("programs", programId, { lineageId: programId });
    await ctx.db.patch("users", user._id, { currentProgramId: programId });
    return { version: 1, days: args.days.length };
  },
});

export const swapExercise = internalMutation({
  args: { dayIndex: v.number(), from: v.string(), to: programExercise },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // The last program trained, which is the one the conversation is almost
    // always about. ponytail: no way to swap inside another program from the
    // chat — add a `program` argument to the tool if that ever bites.
    const current = user.currentProgramId
      ? await ctx.db.get("programs", user.currentProgramId)
      : null;
    if (!current) throw new Error("Pas encore de programme à modifier");

    const days = swapInDays(current.days, args.dayIndex, args.from, args.to);
    // A new version WITHIN the lineage of the last program trained, leaving the
    // others untouched. `current.version` is the lineage's maximum because every
    // writer of `currentProgramId` stamps the lineage's latest row — the two are
    // `saveProgram` above and `workouts.start`, which resolves it through
    // `latestInLineage` rather than trusting the id the client sent. Break that
    // and this line writes a version that already exists; the older row wins
    // every read and this swap disappears.
    const programId = await ctx.db.insert("programs", {
      userId: user._id,
      lineageId: current.lineageId ?? current._id,
      ...(current.status ? { status: current.status } : {}),
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

/**
 * The user plus every program they're currently running — plural on purpose:
 * a musculation program and a boxing one are both live at once.
 */
async function loadContext(ctx: QueryCtx) {
  const user = await requireCurrentUser(ctx);
  const rows = await ctx.db
    .query("programs")
    .withIndex("by_user_and_lineage", (q) => q.eq("userId", user._id))
    .take(500);
  return { user, programs: activeLineages(rows), currentProgramId: user.currentProgramId ?? null };
}

/**
 * What the user did outside the gym. Fixed counts rather than a date window: a
 * query can't read the clock, and "the last few" is what the coach needs anyway.
 */
async function outsideOf(ctx: QueryCtx, userId: Id<"users">) {
  const cardio = await ctx.db
    .query("cardio")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
    .order("desc")
    .take(5);
  const weights = await ctx.db
    .query("bodyweight")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
    .order("desc")
    .take(1);
  return { cardio, weight: weights[0] ?? null };
}

/**
 * Kept as it was even though the prompt now only reads `user` from it: an older
 * bundle may still be calling it (see AGENTS.md on expand/contract).
 */
export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const base = await loadContext(ctx);
    return { ...base, ...(await outsideOf(ctx, base.user._id)) };
  },
});

/**
 * What `stream` actually injects, and nothing more: the user row the prompt is
 * built from. The programs, the cardio and the pesée are read by
 * `read_programs` / `read_cardio_and_bodyweight` when the model asks, so a plain
 * turn no longer pays for 500 program rows.
 */
export const streamContext = internalQuery({
  args: {},
  handler: async (ctx) => ({ user: await requireCurrentUser(ctx) }),
});

/**
 * The coach's `read_cardio_and_bodyweight` tool. The provenance and the scale's
 * margin travel WITH the numbers: they used to sit next to them in the prompt,
 * and a caveat left behind in a prompt that no longer holds the data is a caveat
 * the model never sees.
 */
export const outsideTraining = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const { cardio, weight } = await outsideOf(ctx, user._id);
    if (cardio.length === 0 && !weight) {
      return {
        result: "empty" as const,
        note: "Aucun cardio ni aucune pesée enregistrés. Ne suppose rien, demande-lui.",
      };
    }
    return {
      result: "found" as const,
      provenance:
        "Importé de ses captures d'écran — il ne te l'a pas raconté, ne fais pas semblant du contraire.",
      usage:
        "Tiens-en compte pour la fatigue et le volume jambes, mais n'en parle que si c'est pertinent.",
      cardio: cardio.map((c) => ({
        date: c.date,
        kind: c.kind,
        durationMin: c.durationMin ?? null,
        distanceKm: c.distanceKm ?? null,
        avgHr: c.avgHr ?? null,
      })),
      bodyweight: weight
        ? {
            date: weight.date,
            weightKg: weight.weightKg ?? null,
            bodyFatPct: weight.bodyFatPct ?? null,
            muscleKg: weight.muscleKg ?? null,
            caveat:
              "Une balance à impédance se trompe de 3 à 5 % dans l'absolu : commente la tendance, jamais le chiffre exact.",
          }
        : null,
    };
  },
});

/** Grounding for "pourquoi cet exercice ?" — the prescription plus what the user actually lifted. */
export const exerciseContext = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { user, programs } = await loadContext(ctx);
    const needle = args.name.toLowerCase().trim();

    // Across every active program: the exercise the user is asking about may
    // well be in the boxing one rather than in the last one he trained.
    let prescription: {
      program: string;
      day: string;
      exercise: Days[number]["exercises"][number];
    } | null = null;
    for (const program of programs) {
      for (const day of program.days) {
        const found = day.exercises.find((e) => e.name.toLowerCase().trim() === needle);
        if (found) prescription = { program: program.name, day: day.name, exercise: found };
      }
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
// Program history — pure selection, exported for convex/coach.check.ts
// ---------------------------------------------------------------------------

type HistoryRow = {
  _id: string;
  _creationTime: number;
  lineageId?: string;
  version: number;
  name: string;
  status?: "active" | "archived" | "completed";
};

/** How many lineages a list result may carry back to the model. */
const HISTORY_LIST_LIMIT = 20;

/**
 * How many active programs `read_programs` renders IN FULL. A rendered program
 * is 20-60 lines, so this is the one list that can't use HISTORY_LIST_LIMIT.
 * ponytail: nobody runs 5 programs at once; raise it if someone does.
 */
const ACTIVE_RENDER_LIMIT = 5;

/**
 * What `read_programs` tells the model about what it just received. The cap is
 * in the note or the extras are silently absent: `truncated` alone is a field
 * nothing instructs the model to read.
 */
export function activeProgramsNote(count: number, rendered = ACTIVE_RENDER_LIMIT): string {
  if (count === 0)
    return "Aucun programme en cours. Ne fais pas semblant du contraire et n'en invente pas : propose de lui en générer un.";
  const base =
    "Ils tournent EN PARALLÈLE, chacun avance sa propre rotation de jours. Tu ne reçois ici que la DERNIÈRE version de chaque programme actif : pour une version antérieure, un programme archivé ou terminé, appelle `lookup_program_history`.";
  if (count <= rendered) return base;
  return `${base} ATTENTION : il a ${count} programmes actifs et seuls ${rendered} sont rendus ici — les autres ne sont PAS dans cette réponse. Si le user parle d'un programme qui n'y figure pas, va le chercher par son nom avec \`lookup_program_history\`.`;
}

/**
 * The programs the user is currently running — latest version of each lineage,
 * archived and completed ones dropped. Plural on purpose: a musculation program
 * and a boxing one are both live at once.
 */
export function activeLineages<T extends HistoryRow>(rows: T[]): T[] {
  return latestPerLineage(rows).filter((p) => (p.status ?? "active") === "active");
}

/**
 * Picks a program version out of the user's rows. Discriminated results on
 * purpose: "ambiguous" lists the candidates instead of silently picking one,
 * "version_not_found" says which versions DO exist, and "not_found" lists what
 * the user has — no hallucination-friendly empty strings.
 */
export function lookupHistory<T extends HistoryRow>(
  rows: T[],
  selector: { name?: string; lineageId?: string; version?: number },
) {
  const latest = latestPerLineage(rows);
  const versionsOf = (p: T) =>
    rows
      .filter((row) => lineageOf(row) === lineageOf(p))
      .map((row) => row.version)
      .sort((a, b) => a - b);
  // Every summary carries the lineage's whole version list, so picking an old
  // version out of an ambiguous list is one more call, not two.
  const summary = (p: T) => ({
    lineageId: lineageOf(p),
    name: p.name,
    status: p.status ?? "active",
    versions: versionsOf(p),
  });

  let candidates = latest;
  let siblings: T[] = [];
  if (selector.lineageId !== undefined) {
    candidates = latest.filter((p) => lineageOf(p) === selector.lineageId);
  } else if (selector.name !== undefined) {
    const needle = selector.name.toLowerCase().trim();
    candidates = latest.filter((p) => p.name.toLowerCase().trim() === needle);
    // Exact first; substring only as a fallback, so « Full Body » still finds
    // « Full Body 3 jours » without shadowing an exact match. But the exact hit
    // is reported WITH its longer-named siblings: the coach's context only
    // lists active programs, so « Boxe » is also how it asks for an archived
    // « Boxe explosivité » it can't see and can't name.
    if (candidates.length === 0) {
      candidates = latest.filter((p) => p.name.toLowerCase().includes(needle));
    } else {
      siblings = latest.filter(
        (p) => !candidates.includes(p) && p.name.toLowerCase().includes(needle),
      );
    }
  }

  // Carried by every answer that got a hit. A name the exact match shadowed is
  // the one the user meant often enough that neither "voici le programme" nor
  // "cette version n'existe pas" may be said without it.
  const otherMatches = siblings.slice(0, HISTORY_LIST_LIMIT).map(summary);

  if (candidates.length === 0) {
    return {
      result: "not_found" as const,
      programs: latest.slice(0, HISTORY_LIST_LIMIT).map(summary),
    };
  }
  if (candidates.length > 1) {
    return {
      result: "ambiguous" as const,
      candidates: candidates.slice(0, HISTORY_LIST_LIMIT).map(summary),
      otherMatches,
    };
  }

  const head = candidates[0];
  const key = lineageOf(head);
  const members = rows.filter((row) => lineageOf(row) === key);
  const row =
    selector.version === undefined ? head : members.find((m) => m.version === selector.version);
  if (!row) return { result: "version_not_found" as const, ...summary(head), otherMatches };
  return { result: "found" as const, ...summary(head), row, otherMatches };
}

/**
 * Read-only history for the coach's `lookup_program_history` tool. Everything
 * is scoped to the authenticated user before any selector the model sent is
 * applied — a foreign lineageId can only ever match nothing. Bounded by
 * `userPrograms`' 500-row cap; returns ONE rendered version, never all of them.
 */
export const programHistory = internalQuery({
  args: {
    // v.string(), not v.id: the model types this and garbage must come back as
    // "not_found", not a validator throw that aborts the coach's turn.
    lineageId: v.optional(v.string()),
    name: v.optional(v.string()),
    version: v.optional(v.number()),
    /** `read_programs`' mode: every ACTIVE program, rendered in full. */
    list: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const rows = await userPrograms(ctx, user._id);

    const { list, ...selector } = args;
    if (list) {
      const active = activeLineages(rows);
      return {
        // ponytail: no `count`/`truncated` fields. `activeProgramsNote` already
        // says both numbers in prose, which is the channel the model actually
        // reads — a field it has no instruction to check is dead output.
        result: "active_programs" as const,
        programs: active.slice(0, ACTIVE_RENDER_LIMIT).map((p) => ({
          lineageId: lineageOf(p),
          name: p.name,
          version: p.version,
          lastTrained: p._id === user.currentProgramId,
          program: renderProgram(p, p._id === user.currentProgramId),
        })),
        note: activeProgramsNote(active.length),
      };
    }

    const found = lookupHistory(rows, selector);
    if (found.result !== "found") return found;
    const { row, ...rest } = found;
    return {
      ...rest,
      version: row.version,
      isLatestVersion: row.version === found.versions.at(-1),
      program: renderProgram(row, false),
    };
  },
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `today` is closed over rather than asked of the model: it's the one value the
 * model can't know and would happily invent.
 *
 * It must NOT reach any tool DESCRIPTION, though. Tool definitions are part of
 * the prefix the provider caches, so a date-stamped description invalidates the
 * cache every midnight just as surely as a date-stamped system prompt. Inside
 * `execute` it is invisible to the model, which is where every use below is.
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
        "Crée et enregistre un NOUVEAU programme, qui s'ajoute à ceux que le user suit déjà : rien n'est remplacé ni archivé. Les programmes tournent en parallèle. Ne l'appelle pas pour modifier un programme existant.",
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
        "Remplace un exercice du programme le plus récemment travaillé par un autre. Crée une nouvelle version de CE programme, sans toucher aux autres.",
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

    read_programs: createTool({
      description:
        "Les programmes que le user suit ACTUELLEMENT, rendus en entier : jours, exercices, séries × reps, repos, règles de progression, deload. Ils ne sont pas dans ton prompt — appelle cet outil avant toute réponse qui parle de son programme, de sa prochaine séance ou d'un exercice qu'il suit, et avant swap_exercise.",
      inputSchema: z.object({}),
      execute: async (ctx: ToolCtx) =>
        await ctx.runQuery(internal.coach.programHistory, { list: true }),
    }),

    read_cardio_and_bodyweight: createTool({
      description:
        "Les derniers cardios du user et sa dernière pesée (poids, masse grasse, muscle). Ils ne sont pas dans ton prompt — appelle cet outil dès que la fatigue, le volume jambes, le poids ou la composition corporelle entrent dans la conversation.",
      inputSchema: z.object({}),
      execute: async (ctx: ToolCtx) => await ctx.runQuery(internal.coach.outsideTraining, {}),
    }),

    lookup_program_history: createTool({
      description:
        "Consulte l'historique des programmes du user : anciennes versions d'un programme actif, programmes archivés ou terminés. Pour les programmes en cours, c'est read_programs. Lecture seule — rien n'est restauré. Pour recréer un ancien programme, repasse par generate_program.",
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe("Nom (ou morceau de nom) du programme dont le user parle"),
        lineageId: z
          .string()
          .optional()
          .describe("lineageId renvoyé par un appel précédent, pour lever une ambiguïté"),
        version: z
          .number()
          .optional()
          .describe("Numéro de version précis ; sans lui, la dernière version"),
      }),
      execute: async (ctx: ToolCtx, { name, lineageId, version }) =>
        await ctx.runQuery(internal.coach.programHistory, {
          ...(name !== undefined ? { name } : {}),
          ...(lineageId !== undefined ? { lineageId } : {}),
          ...(version !== undefined ? { version } : {}),
        }),
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
        // No date interpolated here: this description is part of the cached
        // prefix. The actual date is at the END of the system prompt.
        date: z
          .string()
          .describe("YYYY-MM-DD. La date d'aujourd'hui est donnée à la fin de ton system prompt"),
      }),
      execute: async (ctx: ToolCtx, input) => {
        // ponytail: reuses the live logger's mutations, so it's 2 writes per set
        // (insert then check off). Add a bulk mutation to workouts.ts if someone
        // starts back-filling whole months.
        // No `programId`: a séance the user recounts after the fact is attached
        // to no program, so it never moves anyone's rotation.
        const workoutId = await ctx.runMutation(api.workouts.start, {
          date: input.date,
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
        "Consulte « Le Chef », l'assistant nutrition, quand la réponse dépend VRAIMENT de l'alimentation (quoi manger autour d'une séance, si ses apports collent à son objectif). Jamais pour ce que tes propres outils de lecture savent déjà. Il n'a aucun outil et ne peut pas te reconsulter : une question, une réponse.",
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
        "Cherche sur le web (SearXNG) ce que tu ne peux pas savoir : recommandations actuelles, un complément ou un terme dont le user te parle, la technique d'un exercice précis. Jamais pour l'état du user lui-même : ça, ce sont read_programs, read_cardio_and_bodyweight, explain_exercise et lookup_program_history.",
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

/** One program, written out for the model. */
const renderProgram = (program: Doc<"programs">, lastTrained: boolean) =>
  `« ${program.name} » (v${program.version}, ${program.days.length} jours)${lastTrained ? " — le plus récemment travaillé" : ""}
${program.days
  .map(
    (day, i) =>
      `[jour ${i}] ${day.name}\n${day.exercises
        .map((e, j) => `  ${j + 1}. ${e.name} — ${e.sets}×${e.reps} (repos ${e.restSeconds}s)`)
        .join("\n")}`,
  )
  .join("\n")}
Progression : ${program.progressionRules}
Deload : ${program.deloadEveryWeeks ? `toutes les ${program.deloadEveryWeeks} semaines` : "non défini"}`;

/**
 * Everything volatile — the rendered programs, the cardio, the weigh-in — left
 * this string for the read tools, because a cache hit needs a byte-identical
 * prefix and those blocks changed on every logged set. What stays is the persona,
 * the tone, and the onboarding profile: small, and rewritten about twice a year.
 *
 * `today` is the ONE dynamic value left, and it sits at the very END on purpose
 * (see the comment above the return). Do not move it back up.
 */
function systemPrompt(user: Doc<"users">, today: string) {
  const onboarding = user.onboarding;

  return `Tu es le coach sportif de ${user.name} dans l'app FitCrew. Tu parles français, tu tutoies, tu es bref : c'est une conversation sur un téléphone, pas un article de blog. 2-6 phrases par message, sauf quand tu présentes un programme.

TON : ${user.tone ? TONE[user.tone] : "Chaleureux et simple, en attendant que le user choisisse son ton."}

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

CE PROMPT NE CONTIENT PAS SES DONNÉES — TU VAS LES CHERCHER
Ses programmes, son cardio et ses pesées ne sont PAS écrits ici. Tu y as accès, mais par outil, et un outil qu'on n'appelle pas ne renvoie rien.
- \`read_programs\` : ses programmes en cours, en entier (jours, exercices, séries × reps, repos, progression). Appelle-le AVANT toute réponse qui parle de son programme, de sa prochaine séance ou d'un exercice qu'il suit, et avant \`swap_exercise\`.
- \`read_cardio_and_bodyweight\` : ses derniers cardios et sa dernière pesée. Appelle-le dès que la fatigue, le volume jambes, le poids ou la composition corporelle entrent dans la conversation.
- Ne dis JAMAIS que tu n'as pas accès à ces données, et n'invente jamais un exercice, un jour, une charge ou un chiffre de pesée : tout ça se lit.
- Ce que tu as déjà lu dans cette conversation reste valable : n'appelle pas deux fois le même outil pour la même chose. Mais après une écriture (\`generate_program\`, \`swap_exercise\`, \`log_workout\`) ou si le user dit avoir changé quelque chose dans l'app, relis avant de commenter.

RÈGLES PROGRAMME (quand tu appelles generate_program)
- \`generate_program\` crée un NOUVEAU programme, en plus de ceux qu'il suit déjà (\`read_programs\` te les donne). Il ne remplace rien. Le user peut en mener plusieurs de front (muscu + boxe, par exemple) et chacun a sa propre rotation.
- Pour MODIFIER un programme existant (durée des séances, nombre de jours, exercices qui ne passent pas), ne le régénère pas : ça en créerait un deuxième. Utilise \`swap_exercise\`, ou dis-lui clairement que tu vas en créer un nouveau et demande si c'est bien ce qu'il veut.
- Un jour = un focus clair, nommé "Jour N — Focus (muscles)".
- L'ÉCHAUFFEMENT N'EST JAMAIS UN EXERCICE de la liste. Pas de ligne "Échauffement", "Mobilité" ou "Cardio d'échauffement" dans \`exercises\`. Si tu veux en parler, mets-le dans \`progressionRules\` ou dans ton message.
- Respecte le matériel dispo, la durée de séance et les limitations. Un exercice contre-indiqué est une faute.
- Si le user fait un sport, le programme doit le servir (boxe = explosivité, gainage, épaules solides, pas de jambes détruites la veille d'un sparring).
- Après \`generate_program\`, résume le programme jour par jour dans ton message : le user ne voit que ce que tu écris.

AUTRES OUTILS
- \`swap_exercise\` dès qu'il déteste ou ne peut pas faire un exercice. Propose un remplaçant équivalent, ne demande pas 3 fois confirmation. Il agit sur le programme le plus récemment travaillé — celui que \`read_programs\` marque \`lastTrained\` : si l'exercice appartient à un autre, dis-le-lui plutôt que de le faire au mauvais endroit.
- \`lookup_program_history\` dès qu'il parle d'une ANCIENNE version d'un programme, d'un programme archivé ou terminé, ou veut comparer avec avant. \`read_programs\` ne te donne que la dernière version de chaque programme ACTIF : ne prétends jamais ne pas avoir accès au reste, va le chercher ici. Si l'outil renvoie plusieurs candidats, ou un résultat avec des \`otherMatches\`, demande-lui lequel plutôt que de choisir à sa place. Lecture seule : pour lui « refaire » un ancien programme, tu le recrées via \`generate_program\` (un NOUVEAU programme), tu ne restaures rien.
- \`explain_exercise\` avant d'expliquer un exercice de son programme : ça te donne son historique réel.
- \`log_workout\` seulement pour une séance passée qu'il te raconte. Une séance en cours se loge dans l'écran Séance, pas ici.
- \`extract_screenshot\` dès qu'une capture est jointe à son message. Si l'outil renvoie des entrées, dis-lui juste de vérifier et valider la fiche affichée — tu n'enregistres rien toi-même. Si il renvoie une liste vide, NE LUI PARLE PAS de fiche à valider : il n'y en a aucune à l'écran. Dis-lui ce que tu vois sur la capture et ce qui manque (une pesée a besoin du poids réel, pas du poids idéal ni de la masse musculaire), et propose-lui de te donner le chiffre directement.
- \`ask_chef\` seulement quand la réponse dépend vraiment de son alimentation (quoi manger autour d'une séance, si ses apports servent son objectif). Une seule question, avec le minimum de contexte : le Chef ne voit pas votre conversation. Ce n'est pas ton domaine : tu relaies sa réponse, tu ne la corriges pas, et tu rappelles que ses chiffres sont des estimations. La nutrition d'une pathologie ne se règle ni avec lui ni avec toi : c'est un professionnel de santé.
- \`search_web\` seulement pour ce que tu ne peux pas savoir : une recommandation à jour, un complément ou un terme dont il te parle, la technique d'un exercice précis. Jamais pour l'état du user : son profil est ci-dessus, et son programme, ses records et son cardio se lisent avec \`read_programs\`, \`explain_exercise\` et \`read_cardio_and_bodyweight\`. Jamais non plus pour du conseil d'entraînement générique que tu connais déjà — une recherche inutile, c'est de l'attente et des tokens pour rien.
- Quand tu t'appuies sur une recherche, cite tes sources dans ta réponse (le nom du site ou le lien) pour qu'il puisse vérifier. Si l'outil renvoie une erreur ou zéro résultat, dis-lui simplement que la recherche ne marche pas là et continue avec ce que tu sais.
- TU N'ES PAS MÉDECIN. Douleur, blessure, symptôme, médicament : tu dis clairement que ça demande un professionnel (médecin, kiné) et tu ne présentes JAMAIS un résultat de recherche comme un diagnostic ou un protocole de soin. Tu peux adapter le programme pour ménager la zone, c'est tout.

DATE
Nous sommes le ${today}.`;
  // ^ Deliberately the LAST line of the prompt. It's the only value that changes
  // from one turn to the next, and the provider's prompt cache matches on a
  // prefix: anything after the first differing byte is refused a cache hit. At
  // the end it costs one uncached line instead of the whole prompt. It cannot
  // leave the prompt entirely — a model doing calendar arithmetic invents dates.
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

    // One conversation per day. Continuity lives in the database, not in the
    // transcript: the profile is rebuilt into the system prompt on every call and
    // everything else — programs, PRs, cardio, pesées — is fetched on demand by
    // the read tools. So yesterday's transcript is cost without value. Returning
    // null makes the
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
      (message) => !(message.role === "user" && isSentinel(message.text, COACH_ATTACHMENTS)),
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
            content: `${COACH_ATTACHMENTS}, à lire avec extract_screenshot : ${args.storageIds.join(", ")})`,
          },
        ],
      }),
    });
    return null;
  },
});

/** The kickoff turn. Why it is persisted and hidden: see `convex/sentinels.ts`. */

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
  // Only `user` is read — for real: `streamContext` reads nothing else. The
  // programs and the cardio the prompt used to inject are fetched by
  // `read_programs` / `read_cardio_and_bodyweight`, when they're called.
  // `internal.coach.context` stays exported and unchanged for older bundles.
  const { user } = await ctx.runQuery(internal.coach.streamContext, {});
  await authorize(ctx, threadId, user._id);
  // After authorize, never before: this writes to the thread.
  if ("prompt" in promptArgs) await ensureTitle(ctx, threadId, promptArgs.prompt);

  const result = await coach().streamText(
    ctx,
    { userId: user._id, threadId },
    {
      ...promptArgs,
      system: systemPrompt(user, today),
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
      contextOptions: CONTEXT_OPTIONS,
    },
  );
  await result.consumeStream();
}
