import { createTool, type ToolCtx } from "@convex-dev/agent";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./users";

/**
 * The zod schema lives HERE, not in `toolSchemas.ts` (the Coach's) nor in
 * `chefToolSchemas.ts` (the Chef's): both agents own this tool, so it belongs to
 * neither file. The card only needs the TYPE on the client, and a type-only
 * import from a server module is already how we do that (see `VisionItem` in
 * `chef-chat.tsx`). Don't "fix" this by moving it into one agent's file.
 *
 * Same convention as those two: strict structured output cannot express
 * "optional", so anything that may be absent is `.nullable()` and the tool's
 * `execute` strips the nulls.
 */
export const zAskChoices = z.object({
  questions: z
    .array(
      z.object({
        label: z.string().describe("La question, courte, en tutoyant. Ex : « Ton objectif ? »"),
        options: z
          .array(
            z.object({
              label: z.string().describe("Ce que le user lit sur la puce. Ex : « Prise de masse »"),
              hint: z
                .string()
                .nullable()
                .describe("Une demi-ligne sous le libellé quand ça aide. null sinon"),
            }),
          )
          // One option is not a choice, five turn the card back into the wall it
          // replaced.
          .min(2)
          .max(4),
        multiple: z
          .boolean()
          .nullable()
          .describe("true si plusieurs réponses peuvent tenir ensemble. null sinon"),
      }),
    )
    .min(1)
    .max(3),
});

const TOOL_DESCRIPTION =
  "Pose 1 à 3 questions FERMÉES d'un coup : c'est toi qui écris la question ET les 2 à 4 réponses probables, et le user tape sur une puce au lieu de les écrire. Uniquement pour une question dont tu connais déjà l'éventail des réponses possibles — un âge, un poids, un ressenti se tapent dans la conversation, pas ici. Ne demande JAMAIS ce que la conversation t'a déjà dit. Ses réponses te reviennent dans le fil : c'est à toi d'en faire quelque chose ensuite, l'outil n'enregistre rien.";

/**
 * One tool, both agents: the Coach and the Chef register the same object. Built
 * at module level rather than per call because, unlike the others, it closes over
 * nothing — not even `today`.
 */
export const askChoices = createTool({
  description: TOOL_DESCRIPTION,
  inputSchema: zAskChoices,
  // Return type spelled out because `execute` calls back into `internal`, whose
  // type includes this module: without it TypeScript reports a circular inference
  // error and collapses the whole generated API to `any`.
  execute: async (
    ctx: ToolCtx,
    { questions },
  ): Promise<{ choicesId: Id<"choices">; note: string }> => {
    // The component injects `threadId` into every tool ctx it builds, but types it
    // optional because a tool can also run outside a thread. A throw, not a
    // fallback: the card sends its answers back into this conversation, and
    // guessing which one would send them to the wrong place.
    if (!ctx.threadId) throw new Error("ask_choices appelé hors conversation");
    return {
      ...(await ctx.runMutation(internal.choices.open, {
        threadId: ctx.threadId,
        // Same null-stripping convention as the other tools: strict output can't
        // say "absent", so `multiple: null` is just « non ».
        questions: questions.map(({ multiple, ...q }) => ({ ...q, multiple: multiple === true })),
      })),
      note: "Les puces sont à l'écran. Attends ses réponses — ne repose pas ces questions en prose par-dessus.",
    };
  },
});

// ---------------------------------------------------------------------------
// The trust boundary (the model writes the questions, the client the answers)
// ---------------------------------------------------------------------------

export type Question = {
  label: string;
  options: { label: string; hint: string | null }[];
  multiple: boolean;
};

/**
 * Aligned with the questions, one entry each. The three states are distinct and
 * the distinction is what lets the echo say which questions go back to the
 * conversation: `null` = pas encore répondu, `[]` = « je préfère t'expliquer »,
 * `[...]` = les libellés choisis.
 */
export type Answers = (string[] | null)[];

const MAX_QUESTIONS = 3;

/**
 * The model writes the questions, so nothing here is trusted: a question the card
 * cannot render is worse than one it never asked. Everything bad is dropped
 * silently — a partly usable card still gets answers.
 */
export function sanitizeQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  const questions: Question[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;

    const label = typeof source.label === "string" ? source.label.trim() : "";
    if (label === "") continue;

    const options = cleanOptions(source.options);
    if (options === null) continue;

    questions.push({ label, options, multiple: source.multiple === true });
    if (questions.length === MAX_QUESTIONS) break;
  }

  return questions;
}

/** `null` = unusable, and its question dies with it: a chip nobody can tap. */
function cleanOptions(raw: unknown): Question["options"] | null {
  if (!Array.isArray(raw)) return null;

  // Bad options go one by one; the 2..4 rule applies to what's left, so one
  // mangled entry doesn't cost the three good ones next to it.
  const options: Question["options"] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const label = typeof source.label === "string" ? source.label.trim() : "";
    // Labels ARE the identity of an answer (there are no values), so a duplicate
    // would make the answer ambiguous.
    if (label === "" || options.some((o) => o.label === label)) continue;
    const hint = typeof source.hint === "string" ? source.hint.trim() : "";
    options.push({ label, hint: hint === "" ? null : hint });
  }

  return options.length >= 2 && options.length <= 4 ? options : null;
}

/**
 * The client writes `answers`, so junk must never reach the table. The result is
 * always exactly as long as `questions`, and only holds labels that question
 * actually offers.
 */
export function sanitizeAnswers(raw: unknown, questions: Question[]): Answers {
  const source = Array.isArray(raw) ? raw : [];
  return questions.map((question, i) => {
    const answer = source[i];
    if (!Array.isArray(answer)) return null;
    const labels = new Set(question.options.map((o) => o.label));
    const kept = [
      ...new Set(answer.filter((a): a is string => typeof a === "string" && labels.has(a))),
    ];
    // A single-choice question holding two answers is nonsense the card can't
    // render back.
    return question.multiple ? kept : kept.slice(0, 1);
  });
}

/** Both the duplicate-submission guard and the card's own « ne resoumets pas ». */
export function assertOpen(status: Doc<"choices">["status"]) {
  if (status === "completed") throw new Error("Ces choix ont déjà été envoyés.");
  if (status === "abandoned") throw new Error("Ces choix ont été abandonnés.");
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * One row per batch of questions. No resume, no dedupe: unlike a form, several
 * cards may legitimately be open at once — the agent asks three things now and
 * two more later, and both cards stay tappable in the thread.
 */
export const open = internalMutation({
  args: { threadId: v.string(), questions: v.any() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const questions = sanitizeQuestions(args.questions);
    const choicesId = await ctx.db.insert("choices", {
      userId: user._id,
      threadId: args.threadId,
      questions,
      answers: questions.map(() => null),
      status: "open",
    });
    return { choicesId };
  },
});

/**
 * The card lives in a permanent message stream, so its state has to come from
 * here rather than from React — a reload must not bring back blank chips, nor
 * ones already sent or abandoned.
 *
 * `null` means the row isn't the caller's, or doesn't exist. `threadId` is the
 * conversation the card belongs to — where its answers go after a submit.
 */
export const status = query({
  args: { choicesId: v.id("choices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await ctx.db.get("choices", args.choicesId);
    if (!row || row.userId !== user._id) return null;
    // `questions` comes from here too, never from the streamed tool part: the card
    // renders from the row, so a reload finds the same chips and the same taps.
    const questions = sanitizeQuestions(row.questions);
    return {
      status: row.status,
      threadId: row.threadId,
      questions,
      answers: sanitizeAnswers(row.answers, questions),
    };
  },
});

/** The three guards every write shares: authenticated, owner, still open. */
async function claim(ctx: MutationCtx, choicesId: Id<"choices">) {
  const user = await requireCurrentUser(ctx);
  const row = await ctx.db.get("choices", choicesId);
  if (!row || row.userId !== user._id) throw new Error("Choix introuvables");
  assertOpen(row.status);
  return row;
}

/** Draft save: this is what makes a reload find the card as the user left it. */
export const answer = mutation({
  args: { choicesId: v.id("choices"), answers: v.any() },
  handler: async (ctx, args) => {
    const row = await claim(ctx, args.choicesId);
    await ctx.db.patch("choices", row._id, {
      answers: sanitizeAnswers(args.answers, sanitizeQuestions(row.questions)),
    });
    return null;
  },
});

/**
 * Closes the card, and that's all it does. Nothing is written anywhere else: the
 * answers go back into the conversation as a message, and the agent decides what
 * to do with them exactly as it would with the same words typed by hand.
 */
export const submit = mutation({
  args: { choicesId: v.id("choices"), answers: v.any() },
  handler: async (ctx, args) => {
    const row = await claim(ctx, args.choicesId);
    await ctx.db.patch("choices", row._id, {
      answers: sanitizeAnswers(args.answers, sanitizeQuestions(row.questions)),
      status: "completed",
    });
    return null;
  },
});

/**
 * Unlike `vision.discard` the row STAYS: the card is in the thread forever and
 * has to keep saying « abandonné » instead of coming back blank.
 */
export const abandon = mutation({
  args: { choicesId: v.id("choices") },
  handler: async (ctx, args) => {
    const row = await claim(ctx, args.choicesId);
    await ctx.db.patch("choices", row._id, { status: "abandoned" });
    return null;
  },
});
