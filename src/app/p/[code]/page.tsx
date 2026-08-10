"use client";

import { Show } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../../../convex/_generated/api";

/** Same rendering as /programme: a rest is read, not computed. */
const restLabel = (s: number) =>
  s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60}`;

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
  const program = useQuery(api.shares.shared, { code });
  const copy = useMutation(api.shares.copyShared);
  const router = useRouter();
  const [copying, setCopying] = useState(false);

  return (
    // -ml-18 cancels the body's rail offset: a signed-out visitor has no rail,
    // and this page must not sit 72px right of centre for them.
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-4 pb-[var(--tab-bar)] md:-ml-18">
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
                  {day.exercises.map((exercise, i) => (
                    // Index key: a day can legitimately repeat an exercise
                    // ("Course facile" twice in a run day), so the name isn't unique.
                    <li key={`${exercise.name}-${i}`} className="min-h-11 py-2.5">
                      <p className="truncate text-sm font-medium">{exercise.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold tabular-nums text-foreground">
                          {exercise.sets} × {exercise.reps}
                        </span>{" "}
                        · repos{" "}
                        <span className="tabular-nums">{restLabel(exercise.restSeconds)}</span>
                      </p>
                      {exercise.notes ? (
                        <p className="text-sm text-muted-foreground">{exercise.notes}</p>
                      ) : null}
                    </li>
                  ))}
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
