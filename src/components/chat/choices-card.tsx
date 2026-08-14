"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Question } from "../../../convex/choices";
import type { AgentApi } from "@/components/chat/agent-thread";
import { runMutation } from "@/components/nutrition/macros";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * One to three CLOSED questions the model wrote, each with its own likely
 * answers, rendered as tappable chips — like Claude Code's `AskUserQuestion`.
 * Its only job is to spare the user typing an answer that was always going to be
 * one of a few words. It owns no flow: the answers echo back into the thread and
 * the agent takes it from there.
 *
 * Same shape as `vision-review.tsx`, for the same reason: the card lives forever
 * in a message stream and is re-rendered on every reload, so what it shows comes
 * from the `status` subscription — never from local state, which would bring back
 * an empty card over answers already sent.
 */

/** Per question: `null` = untouched, `[]` = the escape hatch, otherwise the
 *  chosen option labels. Aligned with `questions`, index for index. */
type Answers = (string[] | null)[];

/** The chip on every question, whatever the model wrote: it offered 2 to 4
 *  answers it thought likely, and one it didn't think of must never trap the
 *  user. There is no text input here — the composer below is the app's one. */
const ESCAPE = "Je préfère t'expliquer";

/**
 * The message sent back into the conversation after a submit. The agent never
 * sees the card's state, so without this echo it doesn't know what was answered.
 * Built from labels because that is all there is — no keys, no values.
 */
export function recap(questions: Question[], answers: Answers): string {
  return questions
    .map((question, i) => {
      const chosen = answers[i] ?? [];
      const said = chosen.length > 0 ? chosen.join(", ").toLowerCase() : ESCAPE.toLowerCase();
      // The label is a question ("Ton objectif ?"); the echo is a statement.
      return `${question.label.replace(/\s*\?\s*$/, "")} : ${said}.`;
    })
    .join(" ");
}

export function ChoicesCard({
  choicesId,
  send,
}: {
  choicesId: Id<"choices">;
  /** The agent whose thread this card sits in — the echo has to land there. */
  send: AgentApi["send"];
}) {
  const q = useQuery(api.choices.status, { choicesId });

  if (q === undefined) return <Skeleton className="h-24 w-full" />;
  if (q === null)
    return <p className="text-sm text-muted-foreground">Ces choix n&apos;existent plus.</p>;
  if (q.status === "completed")
    return <p className="text-sm text-muted-foreground">Choix envoyés.</p>;
  // Scoped to the CARD: it writes nothing anywhere, so this says exactly that.
  if (q.status === "abandoned") {
    return <p className="text-sm text-muted-foreground">Abandonné, rien n&apos;a été envoyé.</p>;
  }

  // A separate component so its `useState` is seeded from the loaded answers:
  // mounted only once the query has resolved, it can't start from `undefined`
  // and then have to be re-synced in an effect.
  return (
    <Choices
      choicesId={choicesId}
      threadId={q.threadId}
      questions={q.questions}
      initial={q.answers}
      send={send}
    />
  );
}

function Choices({
  choicesId,
  threadId,
  questions,
  initial,
  send: sendRef,
}: {
  choicesId: Id<"choices">;
  threadId: string;
  questions: Question[];
  initial: Answers;
  send: AgentApi["send"];
}) {
  const save = useMutation(api.choices.answer);
  const submit = useMutation(api.choices.submit);
  const abandon = useMutation(api.choices.abandon);
  const send = useAction(sendRef);
  const today = useLocalDate();

  const [answers, setAnswers] = useState<Answers>(initial);
  const [pending, setPending] = useState(false);

  const complete = questions.every((_, i) => answers[i] !== null);

  /** A tap has no blur to wait for — the choice IS the edit, so it saves right
   *  away and a reload finds the card as it was left. No toast and no error
   *  surfaced: the submit is what has to speak up if the server refuses. The
   *  next state is built here rather than inside the updater, because a mutation
   *  fired from a state updater runs twice under StrictMode. */
  function put(index: number, value: string[] | null) {
    const next = answers.map((a, i) => (i === index ? value : a));
    setAnswers(next);
    void save({ choicesId, answers: next }).catch(() => {});
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setPending(true);
    // No local `done` flag: the `status` subscription reports the new state.
    await runMutation(action, ok);
    setPending(false);
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <Group
            // Labels are unique in practice and there is no id to key on — at
            // most three questions, written once and never reordered.
            key={question.label}
            question={question}
            chosen={answers[index]}
            onChange={(value) => put(index, value)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          // `today` is null on the server and the first paint, and the echo
          // message needs the user's local date, never the server's.
          disabled={pending || !complete || today === null}
          onClick={() =>
            void run(async () => {
              await submit({ choicesId, answers });
              // The agent never sees the card: without this echo it doesn't know
              // what was answered. Not awaited for its reply — that arrives over
              // the `listMessages` subscription, like a normal send.
              void send({
                threadId,
                prompt: recap(questions, answers),
                today: today as string,
                // The app writes this one on his behalf, so it must not name the
                // conversation: it can be the FIRST user-role message of a
                // thread, and the sidebar would read « Ton objectif : prise de
                // mas… » instead of his own words.
                skipTitle: true,
              }).catch(() =>
                toast.error("Tes choix sont enregistrés, mais ils ne sont pas partis."),
              );
            }, "Choix envoyés.")
          }
        >
          Envoyer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || today === null}
          onClick={() =>
            void run(async () => {
              await abandon({ choicesId });
              // Symmetric with the submit path, and for the same reason: without
              // this the agent keeps waiting for an answer that will never come —
              // its turn ended on the tool call — and nothing tells it the card
              // is gone.
              void send({
                threadId,
                prompt: "Laisse tomber ces questions, je préfère t'expliquer.",
                today: today as string,
                skipTitle: true,
              }).catch(() => toast.error("Abandonné, mais le message n'est pas parti."));
            }, "Abandonné.")
          }
        >
          Abandonner
        </Button>
      </div>
    </div>
  );
}

function Group({
  question,
  chosen,
  onChange,
}: {
  question: Question;
  chosen: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const escaped = chosen !== null && chosen.length === 0;
  const on = (label: string) => chosen?.includes(label) === true;

  function toggle(label: string) {
    if (question.multiple) {
      const next = on(label)
        ? (chosen ?? []).filter((entry) => entry !== label)
        : [...(chosen ?? []), label];
      // Emptying a multiple question is back to untouched, not to the escape
      // hatch — otherwise unticking the last chip silently answers for the user.
      return onChange(next.length > 0 ? next : null);
    }
    // Single choice: tapping the pressed chip clears it — nothing else can unset
    // an answer.
    onChange(on(label) ? null : [label]);
  }

  return (
    // A fieldset, not a div with role="group": chips are buttons and `htmlFor`
    // points at ONE control, so the question belongs to the group — that's what a
    // legend is.
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] text-muted-foreground">{question.label}</legend>

      <div className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            hint={option.hint}
            pressed={on(option.label)}
            onClick={() => toggle(option.label)}
          />
        ))}

        <Chip
          label={ESCAPE}
          hint={null}
          pressed={escaped}
          // Hands the question back to the conversation: an empty array is an
          // answer, so the submit unlocks without forcing a chip that lies.
          onClick={() => onChange(escaped ? null : [])}
        />
      </div>
    </fieldset>
  );
}

function Chip({
  label,
  hint,
  pressed,
  onClick,
}: {
  label: string;
  hint: string | null;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      size="sm"
      aria-pressed={pressed}
      // min-h-11 rather than the `after:-inset-*` trick: a chip is its own tap
      // target, it isn't a 28px icon squeezed next to a badge. `whitespace-normal`
      // is what lets a long answer wrap instead of scrolling the thread sideways.
      className={cn(
        "h-auto min-h-11 flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal",
        pressed && "border-primary/50 ring-1 ring-primary/30",
      )}
      onClick={onClick}
    >
      <span className="text-sm">{label}</span>
      {hint ? <span className="text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </Button>
  );
}
