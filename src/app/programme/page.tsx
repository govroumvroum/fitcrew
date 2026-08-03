"use client";

import { useQuery } from "convex/react";
import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExerciseDemo, useExerciseDemos } from "@/components/workout/demo";
import { formatDay, useLocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

/** "45 s" · "2 min" · "1 min 30" — a rest is read, not computed. */
const restLabel = (s: number) =>
  s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60}`;

/** "Jour 1 — Haut du corps" → "Haut du corps", for the cramped rotation slots. */
const shortLabel = (name: string) => name.split("—")[1]?.trim() ?? name;

export default function ProgrammePage() {
  const date = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-4xl">
      {date ? <Programme date={date} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}

function Programme({ date }: { date: string }) {
  const data = useQuery(api.programs.current, { date });

  // Which day is expanded — the only state on the page. The program is the
  // coach's document: no draft, no dirty flag, no save.
  const [opened, setOpened] = useState<number | null>(null);

  // Unconditional (hook rules). ponytail: resolves every name in the program at
  // once instead of per open day — resolution is cached per name server-side, so
  // it's paid once for the app's lifetime, and no GIF loads until a sheet opens.
  const demoUrlFor = useExerciseDemos([
    ...new Set(data?.program.days.flatMap((day) => day.exercises.map((it) => it.name)) ?? []),
  ]);

  if (data === undefined) return <Skeleton className="m-4 h-64" />;
  if (data === null) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {/* The loaded branch gets its h1 from program.name; this one had none. */}
        <h1 className="sr-only">Programme</h1>
        <p>Pas encore de programme. Le coach t&apos;en écrit un quand tu veux.</p>
        <Button asChild size="lg" className="mt-4 h-14 w-full text-base">
          <Link href="/coach">Passe voir le coach</Link>
        </Button>
      </div>
    );
  }

  const { program, nextDayIndex } = data;
  const openDay = opened ?? nextDayIndex;
  // A one-slot rotation isn't a cycle, so drawing it as one would lie. Below
  // that threshold the day itself carries the page.
  const isLoop = program.days.length > 1;
  const totalSets = program.days.reduce(
    (sum, day) => sum + day.exercises.reduce((n, ex) => n + ex.sets, 0),
    0,
  );
  // A set costs its rest plus ~35 s of work. Estimated from the prescription,
  // never presented as a measurement — hence the caveat under the numbers.
  const avgMinutes =
    program.days.reduce(
      (sum, day) => sum + day.exercises.reduce((n, ex) => n + ex.sets * (ex.restSeconds + 35), 0),
      0,
    ) /
    60 /
    program.days.length;

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <p className="eyebrow min-w-0 flex-1">
            Écrit par le coach · le{" "}
            <span className="tabular-nums">
              {formatDay(new Date(program._creationTime).toISOString().slice(0, 10))}
            </span>
          </p>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            v{program.version}
          </Badge>
        </div>
        {/* No font-heading/tracking here: the base layer already gives h1–h3 the
            display face and -0.01em. */}
        <h1 className="text-2xl font-semibold">{program.name}</h1>
        <p className="text-sm text-muted-foreground">
          Les jours tournent dans l&apos;ordre, un par séance, quand tu t&apos;entraînes. Pas de
          calendrier, pas de retard possible.
        </p>
      </header>

      {/* Where you are in the loop. The program has no calendar, so the shape is
          a rotation you're standing in — a slot opens its day below, nothing
          more. It must never grow into a week view. */}
      <section className={cn("flex flex-col gap-3", isLoop && "slab")}>
        <div className="min-w-0">
          <p className="eyebrow">
            {isLoop ? "La rotation" : "Un seul jour, répété à chaque séance"}
          </p>
          {isLoop ? (
            <p className="text-sm text-muted-foreground">
              Le jour qui vient, puis le suivant. Tu ne peux pas être en retard sur une boucle.
            </p>
          ) : null}
        </div>
        {isLoop ? (
          <div className="grid auto-cols-fr grid-flow-col gap-[3px]">
            {program.days.map((day, index) => {
              const next = index === nextDayIndex;
              const offset = (index - nextDayIndex + program.days.length) % program.days.length;
              return (
                <button
                  key={day.name}
                  type="button"
                  onClick={() => setOpened(index)}
                  aria-label={
                    next
                      ? `${day.name} — à suivre`
                      : `${day.name}, dans ${offset} séance${offset > 1 ? "s" : ""}`
                  }
                  className={cn(
                    "flex h-26 flex-col justify-between rounded-sm border bg-card/45 px-2 py-2 text-left text-muted-foreground transition-[color,background-color,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                    // Hover is gated: on this touch-first PWA a tap leaves the
                    // hover state stuck, so a second slot reads highlighted next
                    // to the real `next` one.
                    "pointer-fine:hover:bg-secondary pointer-fine:hover:text-foreground",
                    // The readable brand hue, not the commit red: the saturated
                    // accent is rationed to the "À suivre" chip and the one button.
                    next && "border-accent-text/50 bg-accent text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      // text-base, not an arbitrary 1.05rem: the 0.8px it bought
                      // was invisible and the scale is 10/11/14/16. The `next`
                      // numeral stays off-scale on purpose — it's a display
                      // numeral, the same register as .hero-num.
                      "block font-heading text-base font-bold leading-none",
                      next && "text-[2rem] font-extrabold leading-[0.85]",
                    )}
                  >
                    {index + 1}
                  </span>
                  {/* No `block`: it fights line-clamp's display:-webkit-box and
                      the clamp stops applying, so the slot ran to 4 lines. */}
                  <span className="line-clamp-2 text-[10px] uppercase leading-tight tracking-[0.04em]">
                    {shortLabel(day.name)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-start md:gap-5">
        <div className="flex flex-col gap-2.5">
          {program.days.map((day, index) => {
            const next = index === nextDayIndex;
            const sets = day.exercises.reduce((n, ex) => n + ex.sets, 0);
            return (
              // ponytail: native <details>, same reason as everywhere else here —
              // one expandable row doesn't need a component. `open` is driven so
              // the rotation strip can reveal a day; the toggle handler only
              // reacts to opening, so closing by hand sticks (React's own value
              // hasn't changed, so it won't re-open it).
              <details
                key={day.name}
                open={index === openDay}
                onToggle={(event) => {
                  if (event.currentTarget.open) setOpened(index);
                }}
                // min-w-0 is load-bearing: a grid item defaults to min-width:auto,
                // so without it this column widens to fit "Jour 1 — Haut du corps
                // et puissance (pectoraux, dos, épaules, gainage)" and the whole
                // page scrolls sideways. The inner `truncate` can't help until an
                // ancestor is actually allowed to be narrower than its content.
                className={cn(
                  "group min-w-0 overflow-hidden",
                  // With no cycle to draw, the day's own table is the page's
                  // dominant element, so it takes the slab (p-0: the rows carry
                  // their own padding).
                  // bg-card/55, like the two panels beside it: at /40 the day
                  // cards sat a step darker than their own row-mates in the md
                  // grid for no reason anyone could name.
                  isLoop ? "rounded-lg border bg-card/55" : "slab p-0",
                  next && isLoop && "border-accent-text/35",
                )}
              >
                {/* The rotation slots answer a pointer and these rows didn't, so
                    the page's main disclosure was its least responsive control.
                    pointer-fine: for the same reason as the slots — a tap would
                    otherwise leave one row lit. */}
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-1.5 transition-colors duration-100 marker:hidden pointer-fine:hover:bg-secondary/50">
                  <ChevronDownIcon className="chevron" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{day.name}</span>
                  {next ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 border-primary/45 bg-primary/20 text-accent-text"
                    >
                      À suivre
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {day.exercises.length} ex. · {sets} séries
                    </Badge>
                  )}
                </summary>
                <div className="px-3 pb-3">
                  <ul className="divide-y">
                    {day.exercises.map((exercise) => {
                      // No match (or not resolved yet) → no affordance at all.
                      const demoUrl = demoUrlFor(exercise.name);
                      return (
                        <li key={exercise.name} className="flex min-h-11 items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{exercise.name}</p>
                            <p className="text-sm text-muted-foreground">
                              <span className="font-semibold tabular-nums text-foreground">
                                {exercise.sets} × {exercise.reps}
                              </span>{" "}
                              · repos{" "}
                              <span className="tabular-nums">
                                {restLabel(exercise.restSeconds)}
                              </span>
                            </p>
                            {exercise.notes ? (
                              <p className="text-sm text-muted-foreground">{exercise.notes}</p>
                            ) : null}
                          </div>
                          {demoUrl ? <ExerciseDemo name={exercise.name} gifUrl={demoUrl} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                  {next ? (
                    <Button asChild variant="secondary" className="mt-3 h-11 w-full">
                      <Link href="/seance">Commencer cette séance</Link>
                    </Button>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5 rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">Comment ça progresse</p>
            {/* Indented, not striped: this is the coach's voice, not the app's,
                and a coloured side rule wider than a hairline is banned. */}
            <div className="flex flex-col gap-2 pl-3.5">
              <p className="text-base">{program.progressionRules}</p>
              <p className="text-sm text-muted-foreground">
                {program.deloadEveryWeeks ? (
                  <>
                    Deload toutes les{" "}
                    <span className="tabular-nums">{program.deloadEveryWeeks}</span> semaines. Tu
                    lèves moins, tu récupères. C&apos;est prévu.
                  </>
                ) : (
                  "Pas de deload programmé sur ce bloc."
                )}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">Ce que ça pèse</p>
            <ul className="divide-y">
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Séries par cycle
                </span>
                <span className="font-semibold tabular-nums">{totalSets}</span>
              </li>
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Durée estimée par séance
                </span>
                <span className="font-semibold tabular-nums">{Math.round(avgMinutes)} min</span>
              </li>
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Jours dans la rotation
                </span>
                <span className="font-semibold tabular-nums">{program.days.length}</span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Durée estimée à partir des temps de repos, pas mesurée sur tes séances.
            </p>
          </section>
        </div>
      </div>

      {/* Read-only page: the program belongs to the coach, which owns the swap
          and the regeneration. Nothing to edit here, just somewhere to ask.
          ponytail: plain navigation, no composed message — nothing in /coach
          reads a prefill (only `?thread=`), and inventing one would mean a
          backend protocol this screen has no business owning. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Un exercice qui ne passe pas, du matériel en moins, une séance trop longue&#8239;? Tu ne
          modifies pas le programme, tu le dis au coach et il le réécrit.
        </p>
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/coach">Demander un changement au coach</Link>
        </Button>
      </div>
    </div>
  );
}
