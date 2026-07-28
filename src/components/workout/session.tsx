"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { CheckIcon, MinusIcon, PlusIcon, TrophyIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatShort } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { ExerciseDemo, useExerciseDemos } from "./demo";
import { defaultReps, workingValues } from "./prescription";
import { REST_OPTIONS, RestTimerBar, useRestTimer } from "./rest-timer";

type Values = { weight: number; reps: number };

const round = (n: number) => Math.round(n * 10) / 10;

export function Session({ date }: { date: string }) {
  const data = useQuery(api.workouts.today, { date });

  const start = useMutation(api.workouts.start);
  const finish = useMutation(api.workouts.finish);
  const logSet = useMutation(api.workouts.logSet).withOptimisticUpdate((store, args) => {
    // Check-off must feel instant with a phone on gym wifi.
    const current = store.getQuery(api.workouts.today, { date });
    if (!current) return;
    store.setQuery(
      api.workouts.today,
      { date },
      {
        ...current,
        sets: current.sets.map((set) =>
          set._id === args.setId
            ? { ...set, completed: args.completed, weight: args.weight, reps: args.reps }
            : set,
        ),
      },
    );
  });

  const timer = useRestTimer();
  // Unconditional (hook rules) and cheap: cached lookups, no GIF is fetched
  // until a sheet is actually opened.
  const demoUrlFor = useExerciseDemos(data?.day?.exercises.map((it) => it.name) ?? []);
  // Working weight/reps per exercise while the session runs; only written to a
  // set row when that set is checked off, so +/- taps cost nothing.
  const [edits, setEdits] = useState<Record<string, Values>>({});
  const [rest, setRest] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  if (data === null) return <Empty>Profil en cours de création…</Empty>;

  const { day, workout, sets } = data;
  if (!day) {
    return (
      <Empty>
        Pas encore de programme.
        <Button asChild size="lg" className="mt-4 h-14 w-full text-base">
          <Link href="/coach">Passe voir le coach</Link>
        </Button>
      </Empty>
    );
  }

  const rowsFor = (name: string) =>
    sets.filter((set) => set.exerciseName === name).sort((a, b) => a.index - b.index);

  const valuesFor = (name: string, repsSpec: string) =>
    edits[name] ?? workingValues(rowsFor(name), repsSpec);

  const done = sets.filter((set) => set.completed);

  if (!workout) {
    const seed = day.exercises.flatMap((exercise) => {
      const last = data.prefill.find((p) => p.name === exercise.name);
      return Array.from({ length: exercise.sets }, (_, index) => ({
        exerciseName: exercise.name,
        index,
        weight: last?.weight ?? 0,
        reps: last?.reps ?? defaultReps(exercise.reps),
      }));
    });
    return (
      <div className="space-y-8 p-4">
        <div className="space-y-6">
          <div className="space-y-1">
            <SectionLabel>À venir</SectionLabel>
            <Header title={day.name} subtitle={`${day.exercises.length} exercices au programme`} />
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {day.exercises.map((exercise) => (
              <li key={exercise.name}>
                {exercise.name} — {exercise.sets} × {exercise.reps}
              </li>
            ))}
          </ul>
          <Button
            className="h-14 w-full text-base"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await start({ date, dayIndex: data.dayIndex, sets: seed });
              } finally {
                setBusy(false);
              }
            }}
          >
            C&apos;est parti
          </Button>
        </div>
        <History date={date} dayIndex={data.dayIndex} />
      </div>
    );
  }

  if (workout.endedAt) {
    return (
      <div className="space-y-4 p-4">
        <Header title={day.name} subtitle="Séance terminée 💪" />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat
            label="Durée"
            value={`${Math.round((workout.endedAt - workout.startedAt) / 60000)} min`}
          />
          <Stat label="Séries" value={`${done.length}`} />
          <Stat
            label="Volume"
            value={`${formatNumber(done.reduce((sum, set) => sum + set.weight * set.reps, 0))} kg`}
          />
        </div>
        {data.prs.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {data.prs.length > 1
                  ? `${data.prs.length} records qui tombent`
                  : "Un record qui tombe"}
              </CardTitle>
              <CardDescription>T&apos;as mis la barre plus haut. Littéralement.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {data.prs.map((pr) => (
                  <li key={pr._id} className="flex items-center gap-2 py-2">
                    <TrophyIcon className={TROPHY} />
                    <span className="truncate">{pr.exerciseName}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {PR_LABELS[pr.type].text}
                    </Badge>
                    <span className="ml-auto shrink-0 font-heading font-semibold tabular-nums">
                      {pr.value} {PR_LABELS[pr.type].unit}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
        {workout.notes ? <p className="text-sm text-muted-foreground">{workout.notes}</p> : null}
        {/* Looking back is exactly what you do once it's done — without this the
            history vanished for the rest of the day. No rotation here: the next
            séance isn't today's business. */}
        <History date={date} />
        {/* A finished session is a dead end otherwise: nothing left to tap. */}
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild size="lg" className="h-14 text-base">
            <Link href="/progres">Voir ma progression</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-12">
            <Link href="/coach">Parler au coach</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-3 p-4">
        <Header
          title={day.name}
          subtitle={`${done.length}/${sets.length} séries · démarrée à ${new Date(workout.startedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
        />
        <Progress value={sets.length ? (done.length / sets.length) * 100 : 0} className="h-2" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Repos</span>
          <Select
            value={rest === null ? "auto" : String(rest)}
            onValueChange={(value) => setRest(value === "auto" ? null : Number(value))}
          >
            <SelectTrigger className="h-12 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Programme</SelectItem>
              {REST_OPTIONS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {seconds < 60 ? `${seconds} s` : `${seconds / 60} min`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 6rem clears the sticky action bar, --tab-bar clears the tab bar under it.
          Two columns at md+ halves the scroll during a session; a single-column
          grid with gap-4 is the same geometry as the space-y-4 it replaces. */}
      <div className="grid gap-4 px-4 pb-[calc(6rem+var(--tab-bar))] md:grid-cols-2 md:items-start">
        {day.exercises.map((exercise) => {
          const rows = rowsFor(exercise.name);
          const values = valuesFor(exercise.name, exercise.reps);
          const setValues = (next: Values) =>
            setEdits((prev) => ({ ...prev, [exercise.name]: next }));
          // No match (or not resolved yet) → no affordance at all.
          const demoUrl = demoUrlFor(exercise.name);

          return (
            <Card key={exercise.name}>
              <CardHeader>
                <CardTitle>{exercise.name}</CardTitle>
                <CardDescription>
                  {exercise.sets} × {exercise.reps} · repos {rest ?? exercise.restSeconds}s
                  {exercise.notes ? ` · ${exercise.notes}` : ""}
                </CardDescription>
                {demoUrl ? (
                  <CardAction>
                    <ExerciseDemo name={exercise.name} gifUrl={demoUrl} />
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Prochaine série</p>
                  <div className="flex gap-2">
                    <Stepper
                      label="kg"
                      value={values.weight}
                      step={2.5}
                      onChange={(weight) => setValues({ ...values, weight })}
                    />
                    <Stepper
                      label="reps"
                      value={values.reps}
                      step={1}
                      onChange={(reps) => setValues({ ...values, reps })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map((row) => (
                    <SetChip
                      key={row._id}
                      row={row}
                      onToggle={() => {
                        const completed = !row.completed;
                        void logSet({
                          setId: row._id,
                          completed,
                          weight: completed ? values.weight : row.weight,
                          reps: completed ? values.reps : row.reps,
                        });
                        if (completed) {
                          navigator.vibrate?.(15);
                          timer.start(rest ?? exercise.restSeconds);
                        }
                      }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* ponytail: native <details> instead of a collapsible component, and
            one notes field for the whole séance — the schema has no
            per-exercise notes field. */}
        <details className="rounded-lg border p-4 md:col-span-2">
          <summary className="min-h-12 cursor-pointer text-sm font-medium">Notes de séance</summary>
          <Textarea
            className="mt-2"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Sensations, douleurs, ce qui a bien marché…"
          />
        </details>
      </div>

      {/* Sticks above the tab bar, not under it: the page reserves --tab-bar at
          its bottom, so the clamped position matches this offset exactly. */}
      <div className="sticky bottom-[var(--tab-bar)] mt-auto space-y-3 border-t bg-background/95 p-4 backdrop-blur">
        {timer.total > 0 && timer.remaining > 0 ? <RestTimerBar timer={timer} /> : null}
        <Button
          variant="outline"
          className="h-14 w-full text-base"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await finish({ workoutId: workout._id, notes: notes.trim() || undefined });
              timer.stop();
            } finally {
              setBusy(false);
            }
          }}
        >
          Terminer la séance
        </Button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{children}</p>
  );
}

/**
 * Its own subscription, and never mounted during a live session: that screen
 * resubscribes `today` on every check-off and must not drag the history along.
 */
function History({ date, dayIndex }: { date: string; dayIndex?: number }) {
  const data = useQuery(api.workouts.history, { date });
  if (!data) return null;

  // No dates, ever: program days rotate one per séance, whenever you train, so
  // "next" is an order and not a calendar. Wraps past the last day. No dayIndex
  // (the finished screen) means no rotation at all — just "déjà fait".
  const upcoming =
    dayIndex === undefined
      ? []
      : Array.from({ length: Math.max(0, data.dayNames.length - 1) }, (_, offset) => {
          return data.dayNames[(dayIndex + 1 + offset) % data.dayNames.length];
        });

  return (
    <>
      {upcoming.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {upcoming.map((name) => (
            <li key={name}>puis {name}</li>
          ))}
        </ul>
      ) : null}

      {data.past.length > 0 ? (
        <section className="space-y-2">
          <SectionLabel>Déjà fait</SectionLabel>
          <ul className="divide-y border-t">
            {data.past.map((session) => (
              <li key={session.id}>
                {/* ponytail: native <details>, same reason as the notes field —
                    one expandable row doesn't need a component. */}
                <details>
                  <summary className="cursor-pointer list-item py-3">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="tabular-nums">{formatShort(session.date)}</span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {session.dayName ?? (session.imported ? "Importée" : "Séance")}
                      </span>
                      {session.pr ? <TrophyIcon className={TROPHY} /> : null}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {session.sets} séries · {formatNumber(session.volume)} kg
                    </span>
                  </summary>
                  <ul className="pb-3 text-xs text-muted-foreground">
                    {session.exercises.length === 0 ? (
                      <li>Rien de coché ce jour-là.</li>
                    ) : (
                      session.exercises.map((exercise) => (
                        <li key={exercise.name} className="flex gap-3 py-0.5">
                          <span className="min-w-0 truncate">{exercise.name}</span>
                          <span className="ml-auto shrink-0 tabular-nums">
                            {exercise.sets.map((set) => `${set.weight}×${set.reps}`).join(" · ")}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-muted-foreground">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Stepper({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-1 items-center gap-1">
      <Button
        variant="outline"
        className="size-12 shrink-0"
        onClick={() => onChange(Math.max(0, round(value - step)))}
        aria-label={`Moins ${label}`}
      >
        <MinusIcon />
      </Button>
      <div className="flex-1 text-center">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
      <Button
        variant="outline"
        className="size-12 shrink-0"
        onClick={() => onChange(round(value + step))}
        aria-label={`Plus ${label}`}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

function SetChip({ row, onToggle }: { row: Doc<"sets">; onToggle: () => void }) {
  return (
    <Button
      variant={row.completed ? "default" : "outline"}
      className={cn(
        "h-12 min-w-16 flex-col gap-0 px-3",
        // Only the check-off dips: un-checking is a correction, not an achievement.
        !row.completed && "transition-transform active:scale-[0.96]",
      )}
      onClick={onToggle}
      aria-pressed={row.completed}
      aria-label={`Série ${row.index + 1}`}
    >
      <span className="flex items-center gap-1 text-sm font-semibold">
        {row.completed ? <CheckIcon /> : null}
        {row.index + 1}
      </span>
      <span className="text-[10px] opacity-80 tabular-nums">
        {row.weight}×{row.reps}
      </span>
    </Button>
  );
}
