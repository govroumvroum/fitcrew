"use client";

import { useQuery } from "convex/react";
import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExerciseDemo, useExerciseDemos } from "@/components/workout/demo";
import { useLocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

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
        Pas encore de programme. Le coach t&apos;en écrit un quand tu veux.
        <Button asChild size="lg" className="mt-4 h-14 w-full text-base">
          <Link href="/coach">Passe voir le coach</Link>
        </Button>
      </div>
    );
  }

  const { program } = data;

  return (
    <div className="space-y-6 p-4">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Ton programme
        </p>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 font-heading text-2xl font-semibold tracking-tight">
            {program.name}
          </h1>
          <Badge variant="secondary" className="mt-1 shrink-0 tabular-nums">
            v{program.version}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums">{program.days.length}</span> jours qui tournent dans
          l&apos;ordre, un par séance. Pas de calendrier.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        {program.days.map((day, index) => {
          const next = index === data.nextDayIndex;
          return (
            // ponytail: native <details>, same reason as everywhere else here —
            // one expandable row doesn't need a component. The next day opens
            // itself; the rest stay folded because the whole program is a wall.
            <details
              key={day.name}
              open={next}
              className={cn("group rounded-lg border p-3", next && "border-primary")}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 marker:hidden">
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground -rotate-90 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-open:rotate-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{day.name}</span>
                {next ? (
                  <Badge className="shrink-0">À suivre</Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {day.exercises.length} ex.
                  </span>
                )}
              </summary>
              <ul className="mt-1 divide-y">
                {day.exercises.map((exercise) => {
                  // No match (or not resolved yet) → no affordance at all.
                  const demoUrl = demoUrlFor(exercise.name);
                  return (
                    <li key={exercise.name} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{exercise.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {exercise.sets} × {exercise.reps} · repos {exercise.restSeconds}s
                        </p>
                        {exercise.notes ? (
                          <p className="text-xs text-muted-foreground">{exercise.notes}</p>
                        ) : null}
                      </div>
                      {demoUrl ? <ExerciseDemo name={exercise.name} gifUrl={demoUrl} /> : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-heading text-sm font-semibold">Comment ça progresse</h2>
        <p className="text-sm text-muted-foreground">{program.progressionRules}</p>
        {program.deloadEveryWeeks ? (
          <p className="text-sm text-muted-foreground">
            Deload toutes les <span className="tabular-nums">{program.deloadEveryWeeks}</span>{" "}
            semaines. Tu lèves moins, tu récupères. C&apos;est prévu.
          </p>
        ) : null}
      </section>

      {/* Read-only page: the program belongs to the coach, which owns the swap
          and the regeneration. Nothing to edit here, just somewhere to ask. */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Un exercice qui ne passe pas, du matériel en moins ? Dis-le au coach, il réécrit.
        </p>
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/coach">Demander un changement</Link>
        </Button>
      </div>
    </div>
  );
}
