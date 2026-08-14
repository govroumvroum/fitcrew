"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { missingFields, sanitizeAnswers, type Answers } from "../../../convex/questionnaireAnswers";
import { parseNum, runMutation } from "./macros";

/**
 * The onboarding form the Chef opens with `ask_questionnaire`: all the nutrition
 * profile's questions at once, filled in by the user rather than asked one by one
 * in prose.
 *
 * Same shape as `vision-review.tsx`, for the same reason: the card lives forever
 * in a message stream and is re-rendered on every reload, so what it shows comes
 * from the `status` subscription — never from local state, which would bring back
 * a blank form over an already-validated profile.
 *
 * The questions themselves come from the model, like Claude Code's
 * `AskUserQuestion`: it writes the wording AND the likely answers, and the user
 * TAPS a chip. Only `age`, `heightCm` and `weightKg` still open a keyboard —
 * `estimateTargets` needs the figure, not a bracket.
 */

const GOAL = {
  perte: "Perte de poids",
  maintien: "Maintien",
  prise: "Prise de masse",
} as const;

const SEX = { h: "Homme", f: "Femme" } as const;

const ACTIVITY = {
  sedentaire: "Sédentaire",
  leger: "Léger",
  modere: "Modéré",
  actif: "Actif",
  tres_actif: "Très actif",
} as const;

/**
 * Every field is edited as a STRING, selects included: an empty number must stay
 * empty rather than snapping to 0, and a French keyboard offers a comma (see the
 * same note in `vision-review.tsx`). `toAnswers` converts on the way out —
 * `sanitizeAnswers` runs `z.number()`, so a string "31" would be dropped silently.
 */
type Draft = Record<keyof Answers, string>;

/**
 * One question as the model wrote it, already sanitised server-side: the key is
 * a real profile field, and each option's `value` is one `sanitizeAnswers` keeps.
 * Declared here rather than imported so the card doesn't pull the backend in —
 * same contract as `Answers`.
 */
type Question = {
  key: keyof Draft;
  label: string;
  options: { value: string; label: string; hint: string | null }[] | null;
  multiple: boolean | null;
};

/** Which keys deserve a digits keyboard — for the three typed questions AND for
 *  an « Autre… » typed on a numeric field. Absent = plain text keyboard. */
const KEYBOARD: Partial<Record<keyof Draft, "numeric" | "decimal">> = {
  age: "numeric",
  heightCm: "numeric",
  weightKg: "decimal",
  mealsPerDay: "numeric",
  cookMinutes: "numeric",
  people: "numeric",
};

const split = (raw: string) => raw.split(",").map((entry) => entry.trim());

/** Blank stays ABSENT, never 0: `cookMinutes: 0` is a valid answer, so an empty
 *  field going through `parseNum` would store « je ne cuisine pas ». */
const num = (raw: string) => (raw.trim() === "" ? undefined : parseNum(raw));

function toDraft(answers: Answers): Draft {
  const text = (value: string | number | undefined) => (value === undefined ? "" : String(value));
  return {
    goal: text(answers.goal),
    sex: text(answers.sex),
    activityLevel: text(answers.activityLevel),
    age: text(answers.age),
    heightCm: text(answers.heightCm),
    weightKg: text(answers.weightKg),
    mealsPerDay: text(answers.mealsPerDay),
    cookMinutes: text(answers.cookMinutes),
    people: text(answers.people),
    diet: text(answers.diet),
    budget: text(answers.budget),
    allergies: (answers.allergies ?? []).join(", "),
    excluded: (answers.excluded ?? []).join(", "),
  };
}

/** Through `sanitizeAnswers` so the client sees exactly what the server will
 *  keep — otherwise a half-typed "31,5 ans" reads as answered here and gets
 *  dropped there, and the submit throws on a button that looked enabled. */
function toAnswers(draft: Draft): Answers {
  return sanitizeAnswers({
    goal: draft.goal,
    sex: draft.sex,
    activityLevel: draft.activityLevel,
    age: num(draft.age),
    heightCm: num(draft.heightCm),
    weightKg: num(draft.weightKg),
    mealsPerDay: num(draft.mealsPerDay),
    cookMinutes: num(draft.cookMinutes),
    people: num(draft.people),
    diet: draft.diet,
    budget: draft.budget,
    allergies: split(draft.allergies),
    excluded: split(draft.excluded),
  });
}

/**
 * The message sent back into the conversation after a submit: the agent never
 * sees the form's fields, so without this echo it doesn't know what was answered.
 * The user's voice, because it lands in the thread as the user's message.
 */
function recap(a: Answers): string {
  const parts = [
    a.goal && GOAL[a.goal].toLowerCase(),
    a.age !== undefined && `${a.age} ans`,
    a.sex && SEX[a.sex].toLowerCase(),
    a.heightCm !== undefined && `${a.heightCm} cm`,
    a.weightKg !== undefined && `${a.weightKg} kg`,
    a.activityLevel && `activité ${ACTIVITY[a.activityLevel].toLowerCase()}`,
    a.mealsPerDay !== undefined && `${a.mealsPerDay} repas/jour`,
    a.cookMinutes !== undefined && `${a.cookMinutes} min de cuisine par repas`,
    a.people !== undefined && `${a.people} couverts`,
    a.diet && `régime : ${a.diet}`,
    a.budget && `budget : ${a.budget}`,
    `allergies : ${a.allergies?.length ? a.allergies.join(", ") : "aucune"}`,
    `aliments exclus : ${a.excluded?.length ? a.excluded.join(", ") : "aucun"}`,
  ].filter((part): part is string => typeof part === "string");
  return `J'ai rempli le questionnaire : ${parts.join(", ")}.`;
}

export function OnboardingQuestionnaire({
  questionnaireId,
}: {
  questionnaireId: Id<"questionnaires">;
}) {
  const q = useQuery(api.questionnaires.status, { questionnaireId });

  if (q === undefined) return <Skeleton className="h-24 w-full" />;
  if (q === null) {
    return <p className="text-sm text-muted-foreground">Ce questionnaire n&apos;existe plus.</p>;
  }
  if (q.status === "completed") {
    return <p className="text-sm text-muted-foreground">Profil enregistré.</p>;
  }
  // Scoped to the FORM, not to the profile: abandoning sends the Chef back to the
  // prose questions, which end in `save_nutrition_profile`. « rien n'a été
  // enregistré » would then sit above a saved profile and lie.
  if (q.status === "abandoned") {
    return (
      <p className="text-sm text-muted-foreground">
        Questionnaire abandonné : ce formulaire n&apos;a rien enregistré.
      </p>
    );
  }

  // A separate component so its `useState` is seeded from the loaded answers:
  // mounted only once the query has resolved, it can't start from `undefined`
  // and then have to be re-synced in an effect.
  return (
    <Form
      questionnaireId={questionnaireId}
      threadId={q.threadId}
      initial={q.answers}
      questions={q.questions}
    />
  );
}

function Form({
  questionnaireId,
  threadId,
  initial,
  questions,
}: {
  questionnaireId: Id<"questionnaires">;
  threadId: string;
  initial: Answers;
  questions: Question[];
}) {
  const save = useMutation(api.questionnaires.save);
  const submit = useMutation(api.questionnaires.submit);
  const abandon = useMutation(api.questionnaires.abandon);
  const send = useAction(api.chef.send);
  const today = useLocalDate();
  const id = useId();

  const [draft, setDraft] = useState(() => toDraft(initial));
  const [pending, setPending] = useState(false);

  const answers = toAnswers(draft);
  const missing = missingFields(answers);

  /** Draft save, so a reload finds the form as it was left. No toast and no
   *  error surfaced: this fires on every blur, and the submit is what has to
   *  speak up if the server refuses. */
  const persist = (next: Draft) =>
    void save({ questionnaireId, answers: toAnswers(next) }).catch(() => {});

  function set(key: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /** A tap has no blur worth waiting for — the choice IS the edit. The next
   *  draft is built here rather than inside the updater: a mutation fired from a
   *  state updater runs twice under StrictMode. */
  function choose(key: keyof Draft, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    persist(next);
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setPending(true);
    // No local `done` flag: the `status` subscription reports the new state.
    await runMutation(action, ok);
    setPending(false);
  }

  return (
    <div className="w-full space-y-3">
      <p className="text-sm text-muted-foreground">
        Réponds à tout ça et je calcule tes cibles. Tu peux t&apos;arrêter en cours de route, je
        garde ce que tu as déjà écrit.
      </p>

      <div className="flex flex-col gap-4">
        {questions.map((question) => (
          <QuestionField
            key={question.key}
            id={`${id}-${question.key}`}
            question={question}
            value={draft[question.key]}
            onType={(value) => set(question.key, value)}
            onChoose={(value) => choose(question.key, value)}
            onBlur={() => persist(draft)}
          />
        ))}
      </div>

      {missing.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Il manque encore : {missing.join(", ")}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          // `today` is null on the server and the first paint, and the echo
          // message needs the user's local date, never the server's.
          disabled={pending || missing.length > 0 || today === null}
          onClick={() =>
            void run(async () => {
              await submit({ questionnaireId, answers });
              // The agent never sees the form's fields: without this echo it
              // doesn't know what was answered. Not awaited for its reply — that
              // arrives over the `listMessages` subscription, like a normal send.
              void send({
                threadId,
                prompt: recap(answers),
                today: today as string,
                // The app writes this one on his behalf, so it must not name the
                // conversation: on the onboarding path it is the FIRST user-role
                // message, and the sidebar would read « J'ai rempli le
                // questionnaire : prise de mas… » instead of his own words.
                skipTitle: true,
              }).catch(() =>
                // Surfaced rather than swallowed: the profile IS written at this
                // point, so a silent failure leaves « Profil enregistré. » above
                // an agent that never answers, with nothing saying why.
                toast.error("Profil enregistré, mais le Chef n'a pas reçu tes réponses."),
              );
            }, "Profil enregistré.")
          }
        >
          Valider mon profil
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || today === null}
          onClick={() =>
            void run(async () => {
              await abandon({ questionnaireId });
              // Symmetric with the submit path, and for the same reason: the
              // Chef never sees the form. Without this it keeps waiting for a
              // « je l'ai rempli » that will never come — its turn ended on the
              // tool call — and the prose fallback the prompt promises is
              // unreachable, because nothing tells it the form is gone.
              void send({
                threadId,
                prompt: "Je ne veux pas remplir le formulaire. Pose-moi les questions à la place.",
                today: today as string,
                skipTitle: true,
              }).catch(() =>
                toast.error("Questionnaire abandonné, mais le Chef n'a pas été prévenu."),
              );
            }, "Questionnaire abandonné.")
          }
        >
          Abandonner
        </Button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </Label>
      {children}
      {/* `aria-describedby` on the input, not just a paragraph next to it: the
          comma rule is an instruction, and a screen reader that only reads the
          label never gets it. */}
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FieldProps = {
  id: string;
  question: Question;
  value: string;
  /** Typing: draft only, the blur is what saves — same as any Input here. */
  onType: (value: string) => void;
  /** Tapping: draft AND save, there is no blur to wait for. */
  onChoose: (value: string) => void;
  onBlur: () => void;
};

function QuestionField(props: FieldProps) {
  const { id, question, value, onType, onBlur } = props;
  const mode = KEYBOARD[question.key];

  // `options === null` is age / heightCm / weightKg: the only keyboards left.
  if (question.options === null) {
    return (
      <Field id={id} label={question.label}>
        <Input
          id={id}
          inputMode={mode}
          value={value}
          // 16px on the phone or iOS zooms the whole page when it focuses.
          className={cn("h-11 text-base sm:text-sm", mode && "tabular-nums")}
          onChange={(e) => onType(e.target.value)}
          onBlur={onBlur}
        />
      </Field>
    );
  }

  return <Chips {...props} options={question.options} />;
}

/**
 * The draft slot read as a selection: an entry matching an option is a pressed
 * chip, anything else is what was typed in « Autre… ». Nothing is stored twice —
 * a reload finds the card exactly as it was left, and the string is the one
 * `toAnswers` already comma-splits for `allergies` / `excluded`.
 */
export function readChips(value: string, known: Set<string>, multiple: boolean) {
  const entries = value === "" ? [] : multiple ? value.split(",") : [value];
  return {
    chosen: entries.filter((entry) => known.has(entry.trim())),
    typed: entries.filter((entry) => !known.has(entry.trim())).join(","),
  };
}

/** Back to one draft slot. A blank « Autre… » adds nothing, or every list would
 *  end in a stray comma. */
export const writeChips = (chosen: string[], other: string) =>
  [...chosen, ...(other.trim() === "" ? [] : [other])].join(",");

/**
 * The tappable answers, in place of the Selects and the free-text Inputs this
 * card used to be.
 */
function Chips({
  id,
  question,
  options,
  value,
  onType,
  onChoose,
  onBlur,
}: FieldProps & { options: NonNullable<Question["options"]> }) {
  const multiple = question.multiple === true;
  const known = new Set(options.map((option) => option.value));
  const { chosen, typed } = readChips(value, known, multiple);

  const [otherOpen, setOtherOpen] = useState(typed !== "");
  const otherId = `${id}-other`;

  function toggle(option: string) {
    const isOn = chosen.some((entry) => entry.trim() === option);
    if (multiple)
      return onChoose(
        writeChips(isOn ? chosen.filter((e) => e.trim() !== option) : [...chosen, option], typed),
      );
    // Single choice: tapping the pressed chip clears it — nothing else can unset
    // an answer. And a chip wins over what was typed in « Autre… ».
    setOtherOpen(false);
    onChoose(isOn ? "" : option);
  }

  return (
    // A fieldset, not a <label>: chips are buttons and `htmlFor` points at ONE
    // control, so the question belongs to the group — that's what a legend is.
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] text-muted-foreground">{question.label}</legend>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = chosen.some((entry) => entry.trim() === option.value);
          return (
            <Button
              key={option.value}
              type="button"
              variant={selected ? "secondary" : "outline"}
              size="sm"
              aria-pressed={selected}
              // min-h-11 rather than the `after:-inset-*` trick: a chip is its
              // own tap target, it isn't a 28px icon squeezed next to a badge.
              className={cn(
                "h-auto min-h-11 flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal",
                selected && "border-primary/50 ring-1 ring-primary/30",
              )}
              onClick={() => toggle(option.value)}
            >
              <span className="text-sm">{option.label}</span>
              {option.hint ? (
                <span className="text-[11px] font-normal text-muted-foreground">{option.hint}</span>
              ) : null}
            </Button>
          );
        })}

        {/* Unconditional, and NOT the model's decision: it wrote 2 to 4 answers
            it thought likely, and one it didn't think of must never trap the
            user. Closing it drops what was typed — that's how an answer given
            here gets unset. */}
        <Button
          type="button"
          variant={otherOpen ? "secondary" : "outline"}
          size="sm"
          // No `aria-controls`: the input it reveals doesn't exist while closed,
          // and pointing at a missing id is worse than not pointing at all.
          aria-pressed={otherOpen}
          className="h-auto min-h-11 px-3 py-2"
          onClick={() => {
            if (otherOpen && typed !== "") onChoose(multiple ? writeChips(chosen, "") : "");
            setOtherOpen(!otherOpen);
          }}
        >
          Autre…
        </Button>
      </div>

      {otherOpen ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {/* sr-only: the group's question is already on screen above, but the
              input still needs a label of its own. */}
          <Label htmlFor={otherId} className="sr-only">
            {question.label} — autre réponse
          </Label>
          <Input
            id={otherId}
            inputMode={KEYBOARD[question.key]}
            value={typed}
            placeholder={multiple ? "sépare par des virgules" : "ta réponse"}
            className="h-11 text-base sm:text-sm"
            onChange={(e) => onType(multiple ? writeChips(chosen, e.target.value) : e.target.value)}
            onBlur={onBlur}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
