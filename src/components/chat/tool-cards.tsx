"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  DumbbellIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { z } from "zod";
import type {
  zExercise,
  zGenerateProgram,
  zLogWorkout,
  zSaveOnboarding,
  zSwapExercise,
} from "../../../convex/toolSchemas";
import { Badge } from "@/components/ui/badge";
import type { Block } from "@/lib/circuits";
import { betweenRoundsOf, groupCircuits, roundsOf } from "@/lib/circuits";
import { formatLoose } from "@/lib/dates";
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
 * `isNew` is the message still streaming: a card the agent just produced slides
 * in, every card already in the thread does not. Without it, opening a thread —
 * or paging in older ones — replayed the entrance on the whole history.
 *
 * Exported, like `Header`/`Field`/`Chips` below: the Chef's cards in
 * `chef-tool-cards.tsx` are the same surface with different contents, and a
 * second copy of them drifts the moment one of the two gets a fix.
 */
export function Surface({ isNew, children }: { isNew?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "w-full space-y-2.5 rounded-xl border bg-card p-3",
        // A 1px inset highlight on the top edge only. --card sits barely above
        // --background, so a flat border left every card looking like a faint
        // rectangle; this reads as an edge catching light from above and gives the
        // card a physical top without touching the palette.
        "shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]",
        isNew &&
          "duration-300 ease-[cubic-bezier(0.2,0,0,1)] animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
      )}
    >
      {children}
    </div>
  );
}

export function Header({
  icon,
  title,
  aside,
}: {
  icon?: React.ReactNode;
  title: string;
  aside?: string;
}) {
  return (
    // The rule underneath is what makes this read as a header rather than as the
    // card's first row — every card used to open with three lines of the same
    // weight and you had to read them to find out which was the title.
    <div className="flex items-center gap-2.5 border-b pb-2.5">
      {/* The icon gets a coin rather than floating loose at 16px: it anchors the
          left edge and gives the row a height the title alone didn't have.
          rounded-md against the card's rounded-xl minus p-3 — concentric. */}
      {icon ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground">
          {icon}
        </span>
      ) : null}
      {/* min-w-0 flex-1 on the title, shrink-0 on the badge: a long title (a meal
          name, an exercise name) otherwise pushes the badge off the card instead
          of truncating itself. */}
      <span className="min-w-0 flex-1 font-heading text-[15px] leading-tight font-semibold tracking-[-0.01em]">
        {title}
      </span>
      {aside && (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {aside}
        </Badge>
      )}
    </div>
  );
}

/** One exercise line: name left, prescription right, both scannable at a glance. */
function ExerciseRow({ exercise }: { exercise: Exercise }) {
  return (
    <li className="flex items-baseline gap-2 border-b px-1 py-2 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm">{exercise.name}</span>
      {/* `sets` on a circuit exercise is a ROUND count, not straight sets:
          printing "4×10" here would say the exact opposite of what the circuit
          prescribes. The rounds are stated once, by the block header above. */}
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {exercise.circuit ? exercise.reps : `${exercise.sets}×${exercise.reps}`}
      </span>
      <span className="w-14 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
        {rest(exercise.restSeconds)}
      </span>
    </li>
  );
}

/** The same block as /programme, at card density: rounds up top, order in the
 *  rows, the between-rounds rest on its own line so it can't be read as one more
 *  between-exercises rest. */
function CircuitRow({ block }: { block: Extract<Block<Exercise>, { kind: "circuit" }> }) {
  const rounds = roundsOf(block);
  const betweenRounds = betweenRoundsOf(block);

  return (
    <li className="border-b px-1 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">Circuit {block.label}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {rounds} tour{rounds > 1 ? "s" : ""}
        </span>
      </div>
      <ol className="mt-1 border-l pl-2.5">
        {block.exercises.map((exercise, index) => (
          // The slot tells two occurrences of the same exercise apart.
          <li
            key={exercise.slot ?? `${exercise.name}-${index}`}
            className="flex items-baseline gap-2 py-0.5"
          >
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 text-sm">{exercise.name}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{exercise.reps}</span>
            <span className="w-14 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
              {index === block.exercises.length - 1 ? "—" : rest(exercise.restSeconds)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-sm text-muted-foreground">
        Entre deux tours&#8239;:{" "}
        <span className="tabular-nums">{betweenRounds > 0 ? rest(betweenRounds) : "enchaîné"}</span>
      </p>
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
        // Every generated program is now a new lineage at v1, so the version
        // badge would say "v1" on every card and mean nothing. It only carries
        // information once a swap has bumped the program past its first row.
        aside={version && version > 1 ? `v${version}` : "Nouveau"}
      />

      {/* The tool used to overwrite the one program you had. It doesn't any
          more, and nothing else on this card says so. */}
      <p className="text-sm text-muted-foreground">
        Il s&apos;ajoute à tes programmes, rien n&apos;est remplacé&#8239;: tu peux les suivre en
        parallèle.
      </p>

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
            {groupCircuits(day.exercises).map((block) =>
              block.kind === "circuit" ? (
                <CircuitRow key={block.key} block={block} />
              ) : (
                <ExerciseRow key={block.key} exercise={block.exercise} />
              ),
            )}
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

export function Field({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-2">
      {/* .eyebrow: "Niveau", "Ton", "Séances" are micro-labels, which is exactly
          what the class is for — these were the last hand-rolled 12px in /coach. */}
      <dt className="eyebrow">{label}</dt>
      {/* The value is the answer, the label is only how to read it: without the
          weight bump both sat at the same size and the eye had nowhere to land. */}
      <dd className={cn("font-medium", numeric && "tabular-nums")}>{value}</dd>
    </div>
  );
}

/** The estimation disclaimer. Mandatory on every card that shows kcal or macros. */
export function Estimated({ children }: { children?: React.ReactNode }) {
  return (
    <p className="border-t pt-2 text-[11px] text-muted-foreground">
      {children ?? "Les calories et les macros sont des estimations, pas des mesures."}
    </p>
  );
}

/**
 * One agent consulting the other — a marker, not a card.
 *
 * The consulted agent's answer is already in the prose right below this line,
 * rewritten in the asking agent's own words: rendering the question AND the
 * structured answer on top of that said everything twice. So all the UI owes the
 * user is that the detour happened, in one line.
 *
 * Same line for both directions, so a Coach→Chef consult and a Chef→Coach one are
 * visibly the same thing.
 */
/** Any lucide icon. Typed structurally so this file doesn't depend on lucide's
 *  own exported type name. */
export type ToolIcon = React.ComponentType<{ className?: string }>;

/**
 * A tool as a single line, whatever state it is in.
 *
 * One component for all four states on purpose. Each state used to render its own
 * markup with its own icon — none while pending or running, a warning triangle on
 * failure, an arrow when a consult completed — so a row changed identity as it
 * progressed instead of staying the same row doing something new. The icon is the
 * tool's, and it does not change; only the text and whether it shimmers do.
 *
 * Used by the chat shell for pending / running / failed, by the consult tools for
 * their completed state, and by /demo — which previously had to keep its own copy
 * of two private components and drift from them.
 */
export function ToolLine({
  Icon,
  text,
  tone = "neutral",
  shimmer,
  isNew,
}: {
  Icon: ToolIcon;
  text: string;
  /**
   * `done` and `failed` are colour-coded; in-flight states stay neutral, because
   * a line that is still working has no outcome to report yet.
   *
   * Colour is never the only signal: failure also gets its own icon next to the
   * tool's, so it survives a red-green colour deficiency and a greyscale
   * screenshot.
   */
  tone?: "neutral" | "done" | "failed";
  /** In flight: the text animates. `shimmer` turns itself off under
   *  prefers-reduced-motion, so this needs no motion guard of its own. */
  shimmer?: boolean;
  isNew?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[11px]",
        tone === "neutral" && "text-muted-foreground",
        tone === "done" && "text-success-text",
        tone === "failed" && "text-danger-text",
        shimmer && "shimmer",
        isNew &&
          "duration-300 ease-[cubic-bezier(0.2,0,0,1)] animate-in fade-in motion-reduce:animate-none",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {tone === "failed" && <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />}
      {text}
    </p>
  );
}

export function Chips({ label, items }: { label: string; items: string[] }) {
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
      {/* The swap carries one exercise and no day, so the block header the row
          relies on doesn't exist here — this line is it. */}
      {input.to.circuit ? (
        <p className="text-sm text-muted-foreground">
          Dans le circuit {input.to.circuit}
          {" · "}
          <span className="tabular-nums">{input.to.sets}</span> tour
          {input.to.sets > 1 ? "s" : ""}
          {input.to.restBetweenRoundsSeconds
            ? ` · entre deux tours ${rest(input.to.restBetweenRoundsSeconds)}`
            : ""}
        </p>
      ) : null}
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
      <Header title={formatLoose(input.date)} aside={sets ? `${sets} séries` : undefined} />
      <ul className="space-y-1">
        {input.exercises.map((exercise) => (
          <li
            key={exercise.name}
            className="flex items-baseline gap-2 border-b px-1 py-2 last:border-b-0"
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
          <li key={result.url} className="border-b px-1 py-2 last:border-b-0">
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
