"use client";

import { ArrowRightIcon, CheckIcon, ChevronDownIcon, DumbbellIcon, SearchIcon } from "lucide-react";
import type { z } from "zod";
import type {
  zExercise,
  zGenerateProgram,
  zLogWorkout,
  zSaveOnboarding,
  zSwapExercise,
} from "../../../convex/toolSchemas";
import { Badge } from "@/components/ui/badge";
import { formatFull } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Tool-result cards.
 *
 * These read the tool's *input*, not its output: the input carries the whole
 * program / profile because that's what the model produced, while the output is
 * only `{ version, days: 2 }`. So rich cards cost no backend change.
 *
 * Concentric radii throughout: card is rounded-xl with p-3, inner rows are
 * rounded-md — outer radius minus padding.
 */

type Exercise = z.infer<typeof zExercise>;

export type ProgramInput = z.infer<typeof zGenerateProgram>;
export type ProfileInput = z.infer<typeof zSaveOnboarding>;
export type SwapInput = z.infer<typeof zSwapExercise>;
export type LoggedInput = z.infer<typeof zLogWorkout>;

const TONE: Record<ProfileInput["tone"], string> = {
  motivant: "Motivant",
  neutre: "Neutre",
  direct: "Direct, sans bullshit",
};

const EXPERIENCE: Record<ProfileInput["experience"], string> = {
  debutant: "Débutant",
  intermediaire: "Intermédiaire",
  avance: "Avancé",
};

const rest = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/**
 * `isNew` is the message still streaming: a card the coach just produced slides
 * in, every card already in the thread does not. Without it, opening a thread —
 * or paging in older ones — replayed the entrance on the whole history.
 */
function Surface({ isNew, children }: { isNew?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "w-full space-y-2 rounded-xl border bg-card p-3",
        isNew &&
          "duration-300 ease-[cubic-bezier(0.2,0,0,1)] animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
      )}
    >
      {children}
    </div>
  );
}

function Header({ icon, title, aside }: { icon?: React.ReactNode; title: string; aside?: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="font-heading text-sm font-semibold tracking-[-0.01em]">{title}</span>
      {aside && (
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {aside}
        </Badge>
      )}
    </div>
  );
}

/** One exercise line: name left, prescription right, both scannable at a glance. */
function ExerciseRow({ exercise }: { exercise: Exercise }) {
  return (
    <li className="flex items-baseline gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
      <span className="min-w-0 flex-1 text-sm">{exercise.name}</span>
      <span className="shrink-0 text-sm tabular-nums">
        {exercise.sets}×{exercise.reps}
      </span>
      <span className="w-14 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
        {rest(exercise.restSeconds)}
      </span>
    </li>
  );
}

export function ProgramCard({
  input,
  version,
  isNew,
}: {
  input: ProgramInput;
  version?: number;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={<DumbbellIcon className="size-4 text-muted-foreground" />}
        title={input.name}
        aside={version ? `v${version}` : undefined}
      />

      {/* Native <details>: a disclosure without a dependency or a state hook.
          First day open, the rest collapsed — the whole program at once is a wall. */}
      {input.days.map((day, i) => (
        <details key={day.name} open={i === 0} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium marker:hidden hover:bg-muted/60">
            <ChevronDownIcon className="chevron" />
            <span className="min-w-0 flex-1">{day.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {day.exercises.length} ex.
            </span>
          </summary>
          <ul className="mt-1 mb-2">
            {day.exercises.map((exercise) => (
              <ExerciseRow key={exercise.name} exercise={exercise} />
            ))}
          </ul>
        </details>
      ))}

      <p className="border-t pt-2 text-sm text-muted-foreground">{input.progressionRules}</p>
      {input.deloadEveryWeeks ? (
        <p className="text-sm text-muted-foreground">
          Deload toutes les <span className="tabular-nums">{input.deloadEveryWeeks}</span> semaines.
        </p>
      ) : null}
    </Surface>
  );
}

export function ProfileCard({ input, isNew }: { isNew?: boolean; input: ProfileInput }) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={<CheckIcon className="size-4 text-muted-foreground" />}
        title="Profil enregistré"
      />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Field label="Niveau" value={EXPERIENCE[input.experience]} />
        <Field label="Ton" value={TONE[input.tone]} />
        <Field label="Séances" value={`${input.daysPerWeek}/semaine`} numeric />
        <Field label="Durée" value={`${input.sessionMinutes} min`} numeric />
      </dl>
      <Chips label="Objectifs" items={input.goals} />
      <Chips label="Matériel" items={input.equipment} />
      {input.sport ? <Chips label="Sport" items={[input.sport]} /> : null}
      {input.limitations ? (
        <p className="text-sm text-muted-foreground">À ménager&#8239;: {input.limitations}</p>
      ) : null}
    </Surface>
  );
}

function Field({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      {/* .eyebrow: "Niveau", "Ton", "Séances" are micro-labels, which is exactly
          what the class is for — these were the last hand-rolled 12px in /coach. */}
      <dt className="eyebrow">{label}</dt>
      <dd className={numeric ? "tabular-nums" : undefined}>{value}</dd>
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <span className="eyebrow">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="outline" className="font-normal">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SwapCard({
  input,
  dayName,
  version,
  isNew,
}: {
  input: SwapInput;
  dayName?: string;
  version?: number;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header title={dayName ?? "Exercice remplacé"} aside={version ? `v${version}` : undefined} />
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 text-muted-foreground line-through">{input.from}</span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 font-medium">{input.to.name}</span>
      </div>
      <ul>
        <ExerciseRow exercise={input.to} />
      </ul>
      {input.to.notes ? <p className="text-sm text-muted-foreground">{input.to.notes}</p> : null}
    </Surface>
  );
}

export function LoggedCard({
  input,
  sets,
  isNew,
}: {
  input: LoggedInput;
  sets?: number;
  isNew?: boolean;
}) {
  const volume = input.exercises.reduce(
    (total, exercise) => total + exercise.sets.reduce((sum, set) => sum + set.weight * set.reps, 0),
    0,
  );

  return (
    <Surface isNew={isNew}>
      <Header title={formatFull(input.date)} aside={sets ? `${sets} séries` : undefined} />
      <ul className="space-y-1">
        {input.exercises.map((exercise) => (
          <li
            key={exercise.name}
            className="flex items-baseline gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
          >
            <span className="min-w-0 flex-1 text-sm">{exercise.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {exercise.sets.map((set) => `${set.weight}×${set.reps}`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      {volume > 0 && (
        <p className="border-t pt-2 text-sm text-muted-foreground">
          Volume total <span className="tabular-nums">{Math.round(volume)}</span> kg
        </p>
      )}
    </Surface>
  );
}

export type SearchOutput = {
  query: string;
  results: { title: string; url: string; snippet: string }[];
};

/**
 * Unlike `explain_exercise`, the prose is NOT the whole result here: it can't
 * carry a clickable link. The point of this card is that a claim the coach makes
 * from the web is checkable in one tap. Snippets stay out — the coach already
 * paraphrased them.
 */
export function SourcesCard({ output, isNew }: { output: SearchOutput; isNew?: boolean }) {
  if (output.results.length === 0) return null;

  return (
    <Surface isNew={isNew}>
      <Header
        icon={<SearchIcon className="size-4 text-muted-foreground" />}
        title={`Sources — « ${output.query} »`}
      />
      <ul>
        {output.results.map((result) => (
          <li key={result.url} className="rounded-md px-2 py-1.5 odd:bg-muted/40">
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-current"
            >
              {result.title}
            </a>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
