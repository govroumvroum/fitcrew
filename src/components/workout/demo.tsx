"use client";

import { useAction, useQuery } from "convex/react";
import { PlayIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "../../../convex/_generated/api";

/**
 * Media paths are deterministic, so we build them from the id rather than
 * trusting a URL stored months ago (their docs mention rotation on paid tiers).
 */
const gifUrlFor = (externalId: string) => `https://static.exercisedb.dev/media/${externalId}.gif`;

/**
 * Demo URLs for a day's exercises. Resolution is cached server-side per name,
 * so this fires the action at most once per exercise name for the whole app.
 *
 * `undefined` for a name means "not answered yet", `null` means "the dataset
 * doesn't have it". Both render nothing — no placeholder, no flash.
 */
export function useExerciseDemos(names: string[]) {
  const resolve = useAction(api.exerciseDemos.resolve);
  const demos = useQuery(api.exerciseDemos.forNames, names.length ? { names } : "skip");

  // Newline-joined so the effect keys on the value: `names` is a fresh array
  // every render, and a name the query didn't return has never been resolved.
  const missing = demos
    ? names.filter((name) => !demos.some((d) => d.name === name)).join("\n")
    : "";
  useEffect(() => {
    if (missing) void resolve({ names: missing.split("\n") });
  }, [missing, resolve]);

  return (name: string) => {
    const id = demos?.find((d) => d.name === name)?.externalId;
    return id ? gifUrlFor(id) : null;
  };
}

/** Bottom sheet: thumb-reachable, and it doesn't steal room from the set chips. */
export function ExerciseDemo({ name, gifUrl }: { name: string; gifUrl: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="size-11 shrink-0 [&_svg]:size-4"
          aria-label={`Voir la démo : ${name}`}
        >
          <PlayIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="gap-3 rounded-t-xl p-4">
        <SheetHeader className="p-0 pr-10">
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>Mouvement en boucle, pas une consigne de charge.</SheetDescription>
        </SheetHeader>
        {/* Fixed box: the GIF is only fetched now that the sheet is open (Radix
            doesn't mount closed content), so the layout must not jump on load.
            Capped at 360px because the source is 180x180 and that's the ceiling
            on the free tier — no @2x, and ?resolution= is ignored. A phone shows
            it near that width anyway; without the cap a wide desktop sheet
            stretched a 180px GIF past 600px. */}
        <div className="mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-lg bg-muted outline outline-white/10">
          {/* Plain <img>, not next/image: hotlinked third-party GIF, and their
              terms say don't proxy or re-host — which is exactly what the
              optimizer would do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gifUrl}
            alt={`Démonstration de ${name}`}
            // contain, not cover: every GIF is square today, but a non-square one
            // would get cropped rather than letterboxed, and a cropped
            // demonstration is worse than a padded one.
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Démos :{" "}
          <a
            href="https://exercisedb.dev"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            ExerciseDB
          </a>
        </p>
      </SheetContent>
    </Sheet>
  );
}
