"use client";

import { Show, useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Block } from "@/lib/circuits";
import { betweenRoundsOf, groupCircuits, roundsOf } from "@/lib/circuits";
import { api } from "../../../../convex/_generated/api";

/** Same rendering as /programme: a rest is read, not computed. */
const restLabel = (s: number) =>
  s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60}`;

type SharedProgram = NonNullable<(typeof api.shares.shared)["_returnType"]>;
type DayExercise = SharedProgram["days"][number]["exercises"][number];

/** Same block as /programme, minus the demo affordance — this page is read-only. */
function CircuitBlock({ block }: { block: Extract<Block<DayExercise>, { kind: "circuit" }> }) {
  const rounds = roundsOf(block);
  const betweenRounds = betweenRoundsOf(block);

  return (
    <div className="rounded-md border bg-card/45 p-2.5">
      <div className="flex items-baseline gap-2">
        <p className="eyebrow min-w-0 flex-1">Circuit {block.label}</p>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {rounds} tour{rounds > 1 ? "s" : ""}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Les exercices s&apos;enchaînent dans l&apos;ordre, puis on recommence.
      </p>
      <ol className="mt-2 divide-y">
        {block.exercises.map((exercise, index) => {
          // The last exercise of a round is followed by the between-rounds rest,
          // not by its own `restSeconds`.
          const last = index === block.exercises.length - 1;
          return (
            <li
              key={exercise.slot ?? `${exercise.name}-${index}`}
              className="flex min-h-11 items-center gap-3 py-2"
            >
              <span className="w-4 shrink-0 text-sm text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{exercise.name}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">
                    {exercise.reps}
                  </span>
                  {last ? null : (
                    <>
                      {" "}
                      · puis <span className="tabular-nums">{restLabel(exercise.restSeconds)}</span>
                    </>
                  )}
                </p>
                {exercise.notes ? (
                  <p className="text-sm text-muted-foreground">{exercise.notes}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">
        Entre deux tours&#8239;:{" "}
        <span className="tabular-nums text-foreground">
          {betweenRounds > 0 ? restLabel(betweenRounds) : "enchaîne"}
        </span>
      </p>
    </div>
  );
}

/**
 * A shared program, readable signed-out (the route is public in src/proxy.ts
 * and `api.shares.shared` does no auth). Read-only by design: the visitor
 * copies it into their own account or just looks.
 */
export default function SharedProgramPage({ params }: { params: Promise<{ code: string }> }) {
  // `use(params)` is URL data: under Cache Components it must sit inside a
  // Suspense boundary or it blocks the prerender (same story as the sign-in
  // page). The fallback matches the loading state below, so nothing flashes.
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-4 md:-ml-18">
          <Skeleton className="h-64" />
        </main>
      }
    >
      <SharedProgram params={params} />
    </Suspense>
  );
}

function SharedProgram({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { isSignedIn } = useAuth();
  const program = useQuery(api.shares.shared, { code });
  const copy = useMutation(api.shares.copyShared);
  const router = useRouter();
  const [copying, setCopying] = useState(false);

  return (
    // -ml-18 cancels the body's md:pl-18 rail offset, but ONLY signed-out: the
    // rail exists at md+ for a signed-in visitor, and cancelling it for them
    // would push this page 72px left of where every other page centres.
    <main
      className={`mx-auto flex w-full max-w-md flex-1 flex-col p-4 pb-[var(--tab-bar)] ${
        isSignedIn === false ? "md:-ml-18" : ""
      }`}
    >
      {program === undefined ? (
        <Skeleton className="h-64" />
      ) : program === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-2xl font-semibold">Ce lien n&apos;existe pas ou a été révoqué</h1>
          <p className="text-sm text-muted-foreground">
            Demande à la personne qui te l&apos;a envoyé de le repartager.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <p className="eyebrow">Programme partagé · par {program.author}</p>
            <h1 className="text-2xl font-semibold">{program.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums">{program.days.length}</span> jour
              {program.days.length > 1 ? "s" : ""} par cycle, en lecture seule. Copie-le pour le
              suivre à ton rythme.
            </p>
          </header>

          <div className="flex flex-col gap-2.5">
            {program.days.map((day) => (
              <section key={day.name} className="rounded-lg border bg-card/55 px-3 pb-3">
                <h2 className="flex min-h-11 items-center text-sm font-medium">{day.name}</h2>
                <ul className="divide-y">
                  {groupCircuits(day.exercises).map((block) =>
                    block.kind === "circuit" ? (
                      <li key={block.key} className="py-2.5">
                        <CircuitBlock block={block} />
                      </li>
                    ) : (
                      // Key from the block: a day can legitimately repeat an
                      // exercise ("Course facile" twice in a run day), so the
                      // name isn't unique.
                      <li key={block.key} className="min-h-11 py-2.5">
                        <p className="truncate text-sm font-medium">{block.exercise.name}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold tabular-nums text-foreground">
                            {block.exercise.sets} × {block.exercise.reps}
                          </span>{" "}
                          · repos{" "}
                          <span className="tabular-nums">
                            {restLabel(block.exercise.restSeconds)}
                          </span>
                        </p>
                        {block.exercise.notes ? (
                          <p className="text-sm text-muted-foreground">{block.exercise.notes}</p>
                        ) : null}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ))}
          </div>

          <Show when="signed-in">
            <Button
              size="lg"
              className="h-14 w-full text-base"
              disabled={copying}
              onClick={() => {
                setCopying(true);
                copy({ code })
                  .then(() => {
                    toast.success("Programme copié dans tes programmes");
                    router.push("/programme");
                  })
                  .catch(() => {
                    toast.error("Copie impossible, réessaie.");
                    setCopying(false);
                  });
              }}
            >
              Copier dans mes programmes
            </Button>
          </Show>
          <Show when="signed-out">
            <Button asChild size="lg" className="h-14 w-full text-base">
              <Link href={`/sign-in?redirect_url=/p/${code}`}>Se connecter pour copier</Link>
            </Button>
          </Show>
        </div>
      )}
    </main>
  );
}
