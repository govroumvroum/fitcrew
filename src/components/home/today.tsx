"use client";

import { useQuery } from "convex/react";
import { ChevronRightIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull } from "@/lib/dates";
import { api } from "../../../convex/_generated/api";

// Same trophy treatment as /progres — red text on our background fails
// contrast, so records use the lightened brand hue.
const TROPHY = "size-4 shrink-0 text-[oklch(0.8_0.086_27.255)]";

const PR_LABELS = {
  max_weight: { text: "Charge max", unit: "kg" },
  max_reps: { text: "Reps max", unit: "reps" },
  max_volume: { text: "Volume max", unit: "kg" },
} as const;

export function Today({ date }: { date: string }) {
  const today = useQuery(api.workouts.today, { date });
  const stats = useQuery(api.home.stats, { date });

  if (today === undefined || stats === undefined) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-44" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }
  if (today === null || stats === null) {
    return <p className="p-6 text-center text-muted-foreground">Profil en cours de création…</p>;
  }

  const { day, workout, sets } = today;
  const done = sets.filter((set) => set.completed).length;
  const volume = Math.round(
    sets.reduce((total, set) => (set.completed ? total + set.weight * set.reps : total), 0),
  );

  return (
    <div className="space-y-4 p-4 pb-16">
      <p className="text-sm text-muted-foreground first-letter:uppercase">{formatFull(date)}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{day ? day.name : "Pas encore de programme"}</CardTitle>
          <CardDescription>
            {!day
              ? "Le coach t'en écrit un après quelques questions."
              : workout?.endedAt
                ? `${done} série${done > 1 ? "s" : ""} · ${volume} kg déplacés`
                : `${day.exercises.length} exercice${day.exercises.length > 1 ? "s" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {workout && !workout.endedAt ? (
            <>
              <Progress value={sets.length ? (done / sets.length) * 100 : 0} />
              <p className="text-sm text-muted-foreground tabular-nums">
                {done}/{sets.length} séries validées
              </p>
            </>
          ) : null}

          {!day ? (
            <Cta href="/coach">Fais ton profil avec le coach</Cta>
          ) : workout?.endedAt ? (
            <p className="font-heading text-base font-medium">Séance pliée. À demain.</p>
          ) : (
            <Cta href="/seance">{workout ? "Reprendre la séance" : "Commencer la séance"}</Cta>
          )}
        </CardContent>
      </Card>

      {stats.hasHistory ? (
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Semaines d'affilée" value={stats.streak} />
          <Tile label="Séances cette semaine" value={stats.thisWeek} />
          <Tile label="Volume 7 jours" value={stats.volume7d} unit="kg" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Tes stats arrivent dès la première séance terminée.
        </p>
      )}

      {stats.prs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Derniers records</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {stats.prs.map((pr) => (
                <li
                  key={`${pr.date}|${pr.exerciseName}|${pr.type}`}
                  className="flex items-center gap-2 py-2"
                >
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

      <nav className="flex flex-col gap-1">
        <SecondaryLink href="/coach">Parler au coach</SecondaryLink>
        <SecondaryLink href="/progres">Ma progression</SecondaryLink>
      </nav>
    </div>
  );
}

function Cta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild size="lg" className="h-14 w-full rounded-lg text-base">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="ghost" className="h-12 justify-between px-3 text-base">
      <Link href={href}>
        {children}
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </Button>
  );
}

function Tile({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="font-heading text-2xl font-semibold tabular-nums">
        {value}
        {unit ? <span className="text-sm text-muted-foreground"> {unit}</span> : null}
      </div>
      <div className="text-xs leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}
