"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";
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

const NUMBERS = [
  { key: "age", label: "Âge", unit: "ans", mode: "numeric" },
  { key: "heightCm", label: "Taille", unit: "cm", mode: "numeric" },
  { key: "weightKg", label: "Poids", unit: "kg", mode: "decimal" },
  { key: "mealsPerDay", label: "Repas par jour", unit: null, mode: "numeric" },
  { key: "cookMinutes", label: "Temps de cuisine par repas", unit: "min", mode: "numeric" },
  { key: "people", label: "Nombre de couverts", unit: null, mode: "numeric" },
] as const satisfies readonly {
  key: keyof Draft;
  label: string;
  unit: string | null;
  mode: "numeric" | "decimal";
}[];

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
  if (q.status === "abandoned") {
    return (
      <p className="text-sm text-muted-foreground">
        Questionnaire abandonné, rien n&apos;a été enregistré.
      </p>
    );
  }

  // A separate component so its `useState` is seeded from the loaded answers:
  // mounted only once the query has resolved, it can't start from `undefined`
  // and then have to be re-synced in an effect.
  return <Form questionnaireId={questionnaireId} threadId={q.threadId} initial={q.answers} />;
}

function Form({
  questionnaireId,
  threadId,
  initial,
}: {
  questionnaireId: Id<"questionnaires">;
  threadId: string;
  initial: Answers;
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

  /** Selects have no blur worth waiting for — the choice IS the edit. The next
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

      <div className="flex flex-col gap-3">
        <Choice
          id={`${id}-goal`}
          label="Objectif"
          items={GOAL}
          value={draft.goal}
          onChange={(value) => choose("goal", value)}
        />
        <Choice
          id={`${id}-sex`}
          label="Sexe"
          items={SEX}
          value={draft.sex}
          onChange={(value) => choose("sex", value)}
        />
        <Choice
          id={`${id}-activity`}
          label="Niveau d'activité (hors muscu)"
          items={ACTIVITY}
          value={draft.activityLevel}
          onChange={(value) => choose("activityLevel", value)}
        />

        {NUMBERS.map(({ key, label, unit, mode }) => (
          <Field key={key} id={`${id}-${key}`} label={unit ? `${label} (${unit})` : label}>
            <Input
              id={`${id}-${key}`}
              inputMode={mode}
              value={draft[key]}
              // 16px on the phone or iOS zooms the whole page when it focuses.
              className="h-11 text-base tabular-nums sm:text-sm"
              onChange={(e) => set(key, e.target.value)}
              onBlur={() => persist(draft)}
            />
          </Field>
        ))}

        <Field id={`${id}-diet`} label="Régime alimentaire">
          <Input
            id={`${id}-diet`}
            value={draft.diet}
            placeholder="végétarien, halal, sans lactose…"
            className="h-11 text-base sm:text-sm"
            onChange={(e) => set("diet", e.target.value)}
            onBlur={() => persist(draft)}
          />
        </Field>

        <Field id={`${id}-budget`} label="Budget courses">
          <Input
            id={`${id}-budget`}
            value={draft.budget}
            placeholder="serré, normal…"
            className="h-11 text-base sm:text-sm"
            onChange={(e) => set("budget", e.target.value)}
            onBlur={() => persist(draft)}
          />
        </Field>

        <Field
          id={`${id}-allergies`}
          label="Allergies"
          hint="Sépare par des virgules. Je ne mettrai jamais ça dans un repas — laisse vide si tu n'en as aucune."
        >
          <Input
            id={`${id}-allergies`}
            aria-describedby={`${id}-allergies-hint`}
            value={draft.allergies}
            placeholder="arachides, fruits de mer…"
            className="h-11 text-base sm:text-sm"
            onChange={(e) => set("allergies", e.target.value)}
            onBlur={() => persist(draft)}
          />
        </Field>

        <Field
          id={`${id}-excluded`}
          label="Aliments que tu refuses"
          hint="Sépare par des virgules. Je ne t'en proposerai pas."
        >
          <Input
            id={`${id}-excluded`}
            aria-describedby={`${id}-excluded-hint`}
            value={draft.excluded}
            placeholder="abats, coriandre…"
            className="h-11 text-base sm:text-sm"
            onChange={(e) => set("excluded", e.target.value)}
            onBlur={() => persist(draft)}
          />
        </Field>
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

function Choice({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      {/* `items` because Base UI's <SelectValue> prints the value, not the
          selected option's text — and the options aren't mounted while closed. */}
      <Select items={items} value={value} onValueChange={(v) => onChange((v as string) ?? "")}>
        <SelectTrigger id={id} className="h-11 w-full text-base sm:text-sm">
          <SelectValue placeholder="Choisis…" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
