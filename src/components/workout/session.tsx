"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  TrophyIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, PRESS } from "@/components/ui/button";
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
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { ExerciseDemo, useExerciseDemos } from "./demo";
import { seedSets, workingValues } from "./prescription";
import { REST_OPTIONS, RestTimerBar, useRestOutro, useRestTimer } from "./rest-timer";

type Values = { weight: number; reps: number };

const round = (n: number) => Math.round(n * 10) / 10;

/** French decimals in the load field: 82,5 is what's written on the plates here. */
const fmt = (n: number) => String(n).replace(".", ",");
const parseNum = (raw: string) => {
  const n = Number(raw.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const SPRING = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function Session({ date }: { date: string }) {
  const data = useQuery(api.workouts.today, { date });
  // Every program, each with its own next day and its own prefill: the picker
  // below is one card per active one.
  const programs = useQuery(api.programs.list, { date });

  const router = useRouter();
  const finish = useMutation(api.workouts.finish);
  const cancel = useMutation(api.workouts.cancel);
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

  // Every check-off and correction goes through here: the optimistic tick makes
  // a failed write look like a saved one, then it reverts with nothing said. On
  // gym wifi that's the app losing the only data it exists to keep.
  const write = (args: { setId: Id<"sets">; completed: boolean; weight: number; reps: number }) => {
    void logSet(args).catch(() =>
      toast.error(
        args.completed
          ? "Série pas enregistrée, réessaie."
          : "Correction pas enregistrée, réessaie.",
      ),
    );
  };

  const timer = useRestTimer();
  const outro = useRestOutro(timer);
  const reduce = useReducedMotion();
  // Unconditional (hook rules) and cheap: cached lookups, no GIF is fetched
  // until a sheet is actually opened.
  const demoUrlFor = useExerciseDemos(data?.day?.exercises.map((it) => it.name) ?? []);
  // Working weight/reps per exercise while the session runs; only written to a
  // set row when that set is checked off, so +/- taps cost nothing.
  const [edits, setEdits] = useState<Record<string, Values>>({});
  // Which exercise the pager shows. null = nobody has paged yet, so we open on
  // the first one with work left (reloading mid-séance must not land on a
  // finished exercise).
  const [pick, setPick] = useState<number | null>(null);
  const [rest, setRest] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (data === undefined || programs === undefined) return <Skeleton className="h-64 w-full" />;
  if (data === null) return <Empty>Profil en cours de création…</Empty>;

  const { day, workout, sets } = data;
  // Every program runs at once, so there is nothing to select: the ones not
  // archived are all startable, and each carries its own next day.
  const active = programs.filter((program) => program.status === "active");

  // Nothing running: pick a program. One card each, and no `day` to read —
  // `workouts.today` only knows a day once a séance has chosen one.
  if (!workout) {
    if (active.length === 0) {
      const none = programs.length === 0;
      return (
        <Empty>
          <h1 className="sr-only">Séance</h1>
          {none ? "Pas encore de programme." : "Aucun programme actif."}
          <Button asChild className="mt-4 h-14 w-full text-base active:scale-[0.97]">
            <Link href={none ? "/coach" : "/programme"}>
              {none ? "Passe voir le coach" : "Réactive un programme"}
            </Link>
          </Button>
        </Empty>
      );
    }
    return (
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* The cards carry the program names, so a visible page title would only
            repeat them. */}
        <h1 className="sr-only">Séance</h1>
        {active.map((program) => (
          <ProgramPick
            key={program.lineageId}
            date={date}
            program={program}
            open={active.length === 1}
          />
        ))}
        <History date={date} />
      </div>
    );
  }

  const rowsFor = (name: string) =>
    sets.filter((set) => set.exerciseName === name).sort((a, b) => a.index - b.index);

  const valuesFor = (name: string, repsSpec: string) =>
    edits[name] ?? workingValues(rowsFor(name), repsSpec);

  const done = sets.filter((set) => set.completed);

  // A séance attached to no program — the Coach's retroactive log leaves one
  // open when the user gave no notes. There is no prescription to render.
  if (!day) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4">
        <Empty>Une séance sans programme est en cours. Elle a été notée par le coach.</Empty>
        <History date={date} />
      </div>
    );
  }

  if (workout.endedAt) {
    // Muscu ce matin, boxe ce soir: the récap must not be a dead end for the
    // programs still untouched today.
    const left = active.filter((program) => !program.trainedToday);
    return (
      <div className="flex flex-1 flex-col gap-5 p-4">
        <section className="slab flex flex-col gap-4">
          <div>
            <p className="eyebrow">
              Séance pliée{data.programName ? ` · ${data.programName}` : ""}
            </p>
            <h1 className="font-heading text-2xl font-bold sm:text-3xl">{day.name}</h1>
            <p className="text-sm text-muted-foreground">
              {done.length === 0
                ? "Rien de coché. On ne juge pas, mais on ne compte pas non plus."
                : "À demain."}
            </p>
          </div>
          {/* One run of numbers split by hairlines, where three bordered tiles
              used to repeat the same rectangle three times. */}
          <div className="band grid-cols-3">
            <div>
              <div className="band-value">
                {Math.round((workout.endedAt - workout.startedAt) / 60000)}
                <small>min</small>
              </div>
              <div className="band-label">Durée</div>
            </div>
            <div>
              <div className="band-value">{done.length}</div>
              <div className="band-label">Séries</div>
            </div>
            <div>
              <div className="band-value">
                {formatNumber(done.reduce((sum, set) => sum + set.weight * set.reps, 0))}
                <small>kg</small>
              </div>
              <div className="band-label">Volume</div>
            </div>
          </div>
        </section>

        {data.prs.length > 0 ? (
          <section className="rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">
              {data.prs.length > 1
                ? `${data.prs.length} records qui tombent`
                : "Un record qui tombe"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              T&apos;as mis la barre plus haut. Littéralement.
            </p>
            <ul className="mt-2 divide-y text-sm">
              {/* The one flourish in the app: records land one after another
                  instead of the whole list appearing at once. Capped at 4
                  steps so a big day doesn't crawl; the CTAs below are outside
                  it and never wait. */}
              {data.prs.map((pr, i) => (
                <motion.li
                  key={pr._id}
                  className="flex min-h-11 items-center gap-3 py-2.5"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: reduce ? 0 : Math.min(i, 3) * 0.1 }}
                >
                  <TrophyIcon className={TROPHY} />
                  <span className="min-w-0 flex-1 truncate">{pr.exerciseName}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {PR_LABELS[pr.type].text}
                  </Badge>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {pr.value} {PR_LABELS[pr.type].unit}
                  </span>
                </motion.li>
              ))}
            </ul>
          </section>
        ) : null}

        {workout.notes ? <p className="text-sm text-muted-foreground">{workout.notes}</p> : null}

        {left.length > 0 ? (
          <section className="flex flex-col gap-4">
            <p className="eyebrow">Il te reste</p>
            {left.map((program) => (
              <ProgramPick key={program.lineageId} date={date} program={program} />
            ))}
          </section>
        ) : null}

        {/* Looking back is exactly what you do once it's done — without this the
            history vanished for the rest of the day. No rotation here: the next
            séance isn't today's business. */}
        <History date={date} />
        {/* A finished session is a dead end otherwise: nothing left to tap. */}
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild className="h-14 text-base active:scale-[0.97]">
            <Link href="/progres">Voir ma progression</Link>
          </Button>
          <Button asChild variant="ghost" className="h-12 active:scale-[0.98]">
            <Link href="/coach">Parler au coach</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ── Live séance: one exercise at a time ──────────────────────────────────
  const exercises = day.exercises;
  const firstOpen = exercises.findIndex((item) => rowsFor(item.name).some((r) => !r.completed));
  const current = Math.min(pick ?? Math.max(firstOpen, 0), exercises.length - 1);
  const exercise = exercises[current];
  const rows = rowsFor(exercise.name);
  const values = valuesFor(exercise.name, exercise.reps);
  const setValues = (next: Values) => setEdits((prev) => ({ ...prev, [exercise.name]: next }));
  const restSeconds = rest ?? exercise.restSeconds;
  // No match (or not resolved yet) → no affordance at all.
  const demoUrl = demoUrlFor(exercise.name);
  const lastTime = data.prefill.find((p) => p.name === exercise.name);
  // The set the commit button will write. -1 when this exercise is done.
  const nextAt = rows.findIndex((row) => !row.completed);
  const activeId = nextAt === -1 ? null : rows[nextAt]._id;
  // First exercise other than this one that still has work left.
  const otherOpen = () =>
    exercises.findIndex((item, i) => i !== current && rowsFor(item.name).some((r) => !r.completed));

  // Nothing in the schema says an exercise is bodyweight, so the only honest
  // signal is the history: an exercise you've already loaded isn't a pull-up, so
  // 0 kg there is a slip on the way to the plate count. Never logged, or always
  // logged at 0, stays loggable — blocking tractions would be the worse bug.
  const zeroLoad = values.weight === 0 && (lastTime?.weight ?? 0) > 0;

  const validate = (row: Doc<"sets">) => {
    // The chips log too, so the gate lives here and not only on the dock button.
    if (zeroLoad) {
      toast.error("Mets la charge avant de valider.");
      return;
    }
    write({ setId: row._id, completed: true, weight: values.weight, reps: values.reps });
    navigator.vibrate?.(15);
    timer.start(restSeconds);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* One 11px row, where three lines of display face used to sit under
                it: mid-séance you know which séance you're in, so the header is
                orientation and the <h1> belongs on the exercise below. */}
            <p className="eyebrow">
              {data.programName ? `${data.programName} · ` : ""}
              {day.name} · démarrée à{" "}
              {new Date(workout.startedAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="secondary" className="tabular-nums">
              {done.length}/{sets.length} séries
            </Badge>
            {/* Up here, not in the dock: a started séance you can't get rid of is
                a dead end, but the way out must not sit under the thumb that
                validates sets. Gone as soon as there's something to lose. */}
            {done.length === 0 ? (
              <Button
                variant="ghost"
                // No size override: a Button's own text-sm is already the scale's
                // body step, and 12px here was a step nothing else used.
                className="h-11 px-2 text-muted-foreground active:scale-[0.98]"
                disabled={busy}
                onClick={async () => {
                  // ponytail: native confirm. One irreversible tap in the whole
                  // app doesn't need a dialog component.
                  if (!window.confirm("Annuler la séance ? Rien ne sera gardé.")) return;
                  setBusy(true);
                  try {
                    await cancel({ workoutId: workout._id });
                    timer.stop();
                    router.push("/");
                  } catch {
                    toast.error("Séance pas annulée, réessaie.");
                    setBusy(false);
                  }
                }}
              >
                Annuler la séance
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 pb-[calc(10rem+var(--tab-bar))] md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-start md:gap-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="size-12 shrink-0 active:scale-[0.96]"
              disabled={current === 0}
              onClick={() => setPick(current - 1)}
              aria-label="Exercice précédent"
            >
              <ArrowLeftIcon />
            </Button>
            {/* One strip, not two. The header carried a per-set tick bar and this
                row a per-exercise dot pager: same thin rounded marks, same three
                colours, 40px apart, and mid-séance they read as one widget
                rendered twice. Merged: one tick per set of the whole séance, in
                order, grouped per exercise, and each group is the pager's tap
                target. The wide gap between groups is what makes them groups.

                Dots are 48px tall targets with a 4px mark inside: the mark is
                what you read, the button is what a thumb hits. */}
            <div className="flex min-w-0 flex-1 gap-1.5">
              {exercises.map((item, i) => {
                const itemRows = rowsFor(item.name);
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={cn(PRESS, "grid h-12 min-w-0 place-items-center active:scale-[0.9]")}
                    // Weighted by set count so every tick in the strip is the
                    // same width, whatever the exercise it belongs to.
                    style={{ flex: itemRows.length }}
                    aria-current={i === current}
                    aria-label={item.name}
                    onClick={() => setPick(i)}
                  >
                    <span className="flex w-full gap-px">
                      {itemRows.map((row) => (
                        <span
                          key={row._id}
                          className={cn(
                            "min-w-0 flex-1 rounded-full transition-colors",
                            i === current ? "h-1.5" : "h-1",
                            row.completed
                              ? "bg-chart-1"
                              : row._id === activeId
                                ? "bg-accent-text"
                                : "bg-accent",
                          )}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              variant="outline"
              className="size-12 shrink-0 active:scale-[0.96]"
              disabled={current === exercises.length - 1}
              onClick={() => setPick(current + 1)}
              aria-label="Exercice suivant"
            >
              <ArrowRightIcon />
            </Button>
          </div>

          {/* The active exercise is the screen's one dominant surface. */}
          <section className="slab flex flex-col gap-[1.125rem]">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">
                  Exercice {current + 1} sur {exercises.length}
                </p>
                {/* The page's <h1> now that the day name is an eyebrow, and the
                    largest *text* on the screen — but ~3.6:1 under the load
                    numeral, which is what makes the hierarchy read on a squint. */}
                <h1 className="font-heading text-lg font-bold">{exercise.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {exercise.sets} × {exercise.reps} · repos {restSeconds} s
                </p>
              </div>
              {demoUrl ? <ExerciseDemo name={exercise.name} gifUrl={demoUrl} /> : null}
            </div>

            {exercise.notes ? (
              <p className="text-sm text-muted-foreground">{exercise.notes}</p>
            ) : null}

            <div className="flex flex-col gap-3">
              <p className="eyebrow">
                {nextAt === -1
                  ? `${rows.length} séries validées · exercice bouclé`
                  : `Prochaine série · ${nextAt + 1} sur ${rows.length}`}
              </p>
              <LoadField
                label="kg"
                ariaLabel="Charge en kilos"
                mode="decimal"
                size="clamp(3.5rem, 17vw, 5.25rem)"
                value={values.weight}
                onChange={(weight) => setValues({ ...values, weight: Math.max(0, round(weight)) })}
                onStep={(sign) =>
                  setValues({ ...values, weight: Math.max(0, round(values.weight + sign * 2.5)) })
                }
              />
              <LoadField
                label="reps"
                ariaLabel="Répétitions"
                mode="numeric"
                size="clamp(2.25rem, 10vw, 3.25rem)"
                value={values.reps}
                onChange={(reps) => setValues({ ...values, reps: Math.max(1, Math.round(reps)) })}
                onStep={(sign) => setValues({ ...values, reps: Math.max(1, values.reps + sign) })}
              />
              <p className="text-sm text-muted-foreground">
                {lastTime
                  ? `La dernière fois : ${fmt(lastTime.weight)} kg × ${lastTime.reps}`
                  : "Première fois sur cet exercice. On note la référence."}
              </p>
            </div>

            <div>
              <p className="eyebrow mb-2">Séries</p>
              <div className="flex flex-wrap gap-2">
                {rows.map((row) => (
                  <SetChip
                    key={row._id}
                    row={row}
                    next={row._id === activeId}
                    onToggle={() => {
                      // Tapping a chip corrects a set: un-checking is a fix, so
                      // no rest and no buzz.
                      if (row.completed) {
                        write({
                          setId: row._id,
                          completed: false,
                          weight: row.weight,
                          reps: row.reps,
                        });
                      } else {
                        validate(row);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border bg-card/55 p-3.5">
            <span className="text-sm text-muted-foreground">Repos</span>
            <Select
              value={rest === null ? "auto" : String(rest)}
              onValueChange={(value) => setRest(value === "auto" ? null : Number(value))}
            >
              <SelectTrigger className="h-12 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Comme le programme</SelectItem>
                {REST_OPTIONS.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {seconds < 60 ? `${seconds} s` : `${seconds / 60} min`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* What's left, in order — and a way to jump there. This is what the
              five stacked cards were actually for; the pager needs it back. */}
          <section className="rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">Ce qui reste</p>
            <ul className="mt-1 divide-y">
              {exercises.map((item, i) => {
                const left = rowsFor(item.name).filter((row) => !row.completed).length;
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      onClick={() => setPick(i)}
                      className={cn(
                        PRESS,
                        "flex min-h-12 w-full items-center gap-3 py-2.5 text-left text-sm active:scale-[0.98]",
                        i === current ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {left === 0 ? "bouclé" : `${left} série${left > 1 ? "s" : ""}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ponytail: native <details> instead of a collapsible component, and
              one notes field for the whole séance — the schema has no
              per-exercise notes field. */}
          <details className="group rounded-lg border bg-card/55 p-3.5">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-medium marker:hidden">
              <ChevronDownIcon className="chevron" />
              Notes de séance
            </summary>
            <Textarea
              className="mt-2"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Sensations, douleurs, ce qui a bien marché…"
            />
          </details>
        </div>
      </div>

      {/* The dock. Sticks above the tab bar, not under it: the page reserves
          --tab-bar at its bottom, so the clamped position matches this offset
          exactly. The rest bar takes it over the moment a set is validated. */}
      <div className="sticky bottom-[var(--tab-bar)] z-30 mt-auto space-y-2 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md">
        {/* The slot keeps its height once the first rest has run, so the commit
            button never slides out from under a thumb when rest ends mid-set.
            Reserved from the first check-off rather than always, so a séance
            doesn't open with an empty 4rem band above the button. */}
        {timer.total > 0 ? (
          <div className="min-h-16">
            {/* The jarring part of the bar arriving is the reflow that shoves the
                commit button down 4rem, so it comes in with it rather than after.
                The outro's fade runs on a 1.5 s animation-delay and the hook
                unmounts once it's played. */}
            {outro.show ? (
              <RestTimerBar
                timer={timer}
                className={
                  outro.tail
                    ? "animate-out fade-out delay-[1500ms] duration-[140ms] ease-out fill-mode-forwards motion-reduce:animate-none"
                    : "animate-in fade-in slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none"
                }
              />
            ) : null}
          </div>
        ) : null}
        {/* The most-tapped element in the app, and it only had the base 1px dip
            over Tailwind's 150ms ease-in-out. The dip now comes from Button's
            base variant. */}
        <Button
          className="h-14 w-full text-base active:scale-[0.97]"
          disabled={(nextAt === -1 && otherOpen() === -1) || zeroLoad}
          onClick={() => {
            if (nextAt === -1) {
              const upcoming = otherOpen();
              if (upcoming !== -1) setPick(upcoming);
              return;
            }
            validate(rows[nextAt]);
            // Bouclé by this very set → page forward. Read off the rows we
            // already hold: the optimistic write lands after this returns.
            if (rows.filter((row) => !row.completed).length === 1) {
              const upcoming = otherOpen();
              if (upcoming !== -1) setPick(upcoming);
            }
          }}
        >
          {nextAt === -1
            ? otherOpen() === -1
              ? "Tout est validé, termine la séance"
              : "Passer à l'exercice suivant"
            : zeroLoad
              ? "Mets la charge pour valider"
              : `Valider la série ${nextAt + 1} · ${fmt(values.weight)} kg × ${values.reps}`}
        </Button>
        <Button
          variant="ghost"
          className="h-12 w-full active:scale-[0.98]"
          disabled={busy}
          onClick={async () => {
            // Finishing empty is permanent: a 0 série · 0 kg row in the history
            // and the program rotates to the next day anyway.
            if (
              done.length === 0 &&
              !window.confirm(
                "Rien de coché. Terminer quand même ? Ça écrit une séance à 0 kg dans ton historique.",
              )
            ) {
              return;
            }
            setBusy(true);
            try {
              await finish({ workoutId: workout._id, notes: notes.trim() || undefined });
              timer.stop();
            } catch {
              toast.error("Séance pas terminée, réessaie.");
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

type ProgramEntry = (typeof api.programs.list)["_returnType"][number];

/**
 * One startable program. There is no selection to make first — every active
 * program is live, so the screen shows them side by side and the tap IS the
 * choice.
 *
 * ponytail: nothing stops a second séance being started from another tab while
 * one runs here; the screen simply never offers it, because `workouts.today`
 * hands back the running séance and this card isn't rendered. `start` dedupes on
 * (date, program), so the worst case is resuming the same one.
 */
function ProgramPick({
  date,
  program,
  open,
}: {
  date: string;
  program: ProgramEntry;
  open?: boolean;
}) {
  const start = useMutation(api.workouts.start);
  const [busy, setBusy] = useState(false);
  const exercises = program.days[program.nextDayIndex]?.exercises ?? [];
  const total = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);

  return (
    <section className="slab flex flex-col gap-4">
      <div>
        {/* The program is the eyebrow and the day is the heading: with two
            programs live, "Jour 2" alone doesn't say which séance this is. */}
        <p className="eyebrow">{program.name}</p>
        <h2 className="font-heading text-2xl font-bold sm:text-3xl">
          {program.nextDayName ?? "Prochaine séance"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {exercises.length} exercice{exercises.length > 1 ? "s" : ""} ·{" "}
          <span className="tabular-nums">{total}</span> série{total > 1 ? "s" : ""}
          {/* Marked, never hidden: a second séance on the same program is
              allowed, it just shouldn't be the obvious next tap. */}
          {program.trainedToday ? " · déjà fait aujourd'hui" : ""}
        </p>
      </div>

      {/* ponytail: native <details>, like everywhere else here. Open when it's
          the only program — with several, the whole prescription of each is a
          wall before the first button. */}
      <details open={open} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium marker:hidden">
          <ChevronDownIcon className="chevron" />
          Le détail
        </summary>
        <ul className="divide-y">
          {exercises.map((exercise) => (
            <li key={exercise.name} className="flex min-h-11 items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {exercise.sets} × {exercise.reps}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* Red on every card, not just the first: the programs are equals and
          there is no selection, so ranking one of them would be a lie. Each slab
          is its own surface and carries its own commit — what the app rations is
          two red buttons competing inside ONE surface. A program already trained
          today drops to secondary, which is the only ranking there is. */}
      <Button
        className="h-14 w-full text-base active:scale-[0.97]"
        variant={program.trainedToday ? "secondary" : "default"}
        disabled={busy || exercises.length === 0}
        onClick={async () => {
          setBusy(true);
          try {
            await start({
              date,
              programId: program.id,
              sets: seedSets(exercises, program.prefill),
            });
          } catch {
            toast.error("Séance pas démarrée, réessaie.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {program.trainedToday ? "En refaire une" : "C'est parti"}
      </Button>
    </section>
  );
}

/**
 * Its own subscription, and never mounted during a live session: that screen
 * resubscribes `today` on every check-off and must not drag the history along.
 */
function History({ date }: { date: string }) {
  const data = useQuery(api.workouts.history, { date });
  if (!data) return null;

  // No "À suivre" list here any more: with programs running in parallel there is
  // no single rotation to project, and each program's own next day is on its
  // card up the screen.
  return (
    <>
      {data.past.length > 0 ? (
        <section className="space-y-2">
          <p className="eyebrow">Déjà fait</p>
          <ul className="divide-y border-t">
            {data.past.map((session) => (
              <li key={session.id}>
                {/* ponytail: native <details>, same reason as the notes field —
                    one expandable row doesn't need a component. */}
                <details className="group">
                  {/* Two lines, not one: the day names are long enough
                      ("Jour 1 — Haut du corps et puissance (…)") that putting the
                      volume on the same row truncates them to "Jour 1 — H…". */}
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 py-3 text-sm marker:hidden">
                    <ChevronDownIcon className="chevron" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {/* shrink-0: "jeu. 30 juil." wrapped to two lines. */}
                        <span className="shrink-0 tabular-nums">{formatShort(session.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {session.dayName ??
                            session.programName ??
                            (session.imported ? "Importée" : "Séance")}
                        </span>
                        {session.pr ? <TrophyIcon className={TROPHY} /> : null}
                      </span>
                      {/* Which program the séance belonged to: with a muscu and a
                          boxe program running at once, "Jour 2" alone is ambiguous.
                          Only when the day name already took the line above. */}
                      <span className="block text-muted-foreground">
                        {session.dayName && session.programName
                          ? `${session.programName} · `
                          : null}
                        <span className="tabular-nums">
                          {session.sets} séries · {formatNumber(session.volume)} kg
                        </span>
                      </span>
                    </span>
                  </summary>
                  {/* pl-6 = chevron + gap: the detail lines up with the day name
                      above it, not with the chevron. */}
                  <ul className="pb-3 pl-6 text-sm text-muted-foreground">
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-muted-foreground">{children}</div>;
}

/**
 * The load field: the number IS the input, at 72px, flanked by 48px steppers.
 *
 * Display face, not the body face. Big Shoulders has no tabular figures, but
 * this numeral is centred inside a fixed grid track — the steppers sit in their
 * own tracks and cannot be pushed sideways however wide the digits get, which is
 * the same reason `.hero-num` keeps the display face. A ticking clock next to
 * buttons in the same flex row is the case that needs boxed digits; this isn't.
 *
 * Uncontrolled and keyed on the committed value: React's onChange fires per
 * keystroke, which would parse "82," to 82 and fight the typist. Committing on
 * blur is the native `change` semantics the prototype uses, and the key remounts
 * the field when a stepper tap changes the value under it.
 */
function LoadField({
  label,
  ariaLabel,
  mode,
  size,
  value,
  onChange,
  onStep,
}: {
  label: string;
  ariaLabel: string;
  mode: "decimal" | "numeric";
  size: string;
  value: number;
  onChange: (value: number) => void;
  onStep: (sign: 1 | -1) => void;
}) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
      <Button
        variant="outline"
        className="size-12 active:scale-[0.96]"
        onClick={() => onStep(-1)}
        aria-label={`Moins ${label}`}
      >
        <MinusIcon />
      </Button>
      <div className="min-w-0 text-center">
        <input
          key={value}
          type="text"
          inputMode={mode}
          defaultValue={fmt(value)}
          aria-label={ariaLabel}
          // Retyping a weight beats arrowing to the end of it.
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => onChange(parseNum(event.currentTarget.value))}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-center font-display font-extrabold leading-none tracking-[-0.005em] outline-none focus:text-accent-text"
          style={{ fontSize: size }}
        />
        <div className="eyebrow">{label}</div>
      </div>
      <Button
        variant="outline"
        className="size-12 active:scale-[0.96]"
        onClick={() => onStep(1)}
        aria-label={`Plus ${label}`}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

/**
 * A validated set is recorded data, not an action, so it takes the chart hue the
 * streak bars use and leaves the saturated commit red to the dock button. The
 * next one up is outlined in the readable red instead.
 */
function SetChip({
  row,
  next,
  onToggle,
}: {
  row: Doc<"sets">;
  next: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-12 min-w-16 flex-col gap-0 px-3",
        // A tint, not a fill. Measured in APCA over --card: a saturated chart-1
        // ground can't carry both lines — near-black reached Lc 43 and near-white
        // -60, and the 10px weight line at opacity-80 fell to -45, all under the
        // 60 label floor. At /20 the two lines sit at -98 and -72. The check glyph
        // keeps the hue, so "done" still reads chromatically.
        // pointer-fine:, not bare hover:: this is a touch-first PWA, and an
        // ungated hover state stays lit under the finger after every tap.
        row.completed && "border-chart-1/70 bg-chart-1/20 pointer-fine:hover:bg-chart-1/30",
        next && "border-accent-text",
        // Only the check-off dips: un-checking is a correction, not an achievement.
        !row.completed && "active:scale-[0.96]",
      )}
      onClick={onToggle}
      aria-pressed={row.completed}
      aria-label={`Série ${row.index + 1}`}
    >
      <span className="flex items-center gap-1 text-sm font-semibold">
        {/* Always in the flow: mounting the check on validation shoved the set
            number 20px sideways, a hundred times a séance. */}
        <CheckIcon className={row.completed ? "text-chart-1" : "invisible"} />
        {row.index + 1}
      </span>
      <span className="text-[10px] opacity-80 tabular-nums">
        {row.completed ? `${row.weight}×${row.reps}` : "—"}
      </span>
    </Button>
  );
}
