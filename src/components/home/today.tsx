"use client";

import { useQuery } from "convex/react";
import { TrophyIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

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
    <div className="space-y-4 p-4 pb-[var(--tab-bar)]">
      <p className="text-sm text-muted-foreground first-letter:uppercase">{formatFull(date)}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{day ? day.name : "Pas encore de programme"}</CardTitle>
          <CardDescription>
            {!day
              ? "Le coach t'en écrit un après quelques questions."
              : workout?.endedAt
                ? `${done} série${done > 1 ? "s" : ""} · ${formatNumber(volume)} kg déplacés`
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
        // Cardio and weight tiles appear only for people who have that data:
        // a permanent 0 tells you nothing, a zero week tells you something.
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Semaines d'affilée" value={stats.streak} />
          <Tile label="Séances cette semaine" value={stats.thisWeek} />
          <Tile label="Séances ce mois" value={stats.thisMonth} />
          <Tile label="Volume 7 jours" value={stats.volume7d} unit="kg" />
          {stats.doesCardio && (
            <Tile
              label={`Cardio 7 jours${stats.cardio7d.sessions > 0 ? ` · ${stats.cardio7d.sessions}×` : ""}`}
              value={stats.cardio7d.minutes}
              unit="min"
            />
          )}
          {stats.measure?.weightKg !== undefined && (
            <Tile
              label="Poids"
              value={stats.measure.weightKg}
              unit="kg"
              digits={1}
              delta={stats.measure.deltaKg}
            />
          )}
          {stats.measure?.bodyFatPct !== undefined && (
            <Tile label="Masse grasse" value={stats.measure.bodyFatPct} unit="%" digits={1} />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Tes stats arrivent dès la première séance terminée.
        </p>
      )}

      {stats.weeks8.some((week) => week.sessions > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Régularité</CardTitle>
            <CardDescription>8 dernières semaines</CardDescription>
          </CardHeader>
          <CardContent>
            <Sparkline weeks={stats.weeks8} />
          </CardContent>
        </Card>
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

/**
 * Eight bars, no charting library: home is the landing page and recharts is a
 * lot of bundle for one glanceable graphic. /progres has the real charts.
 *
 * The bars are decoration; the sentence above them is the real content. A
 * screen reader handed eight bare numbers and no weeks learns nothing.
 */
function Sparkline({ weeks }: { weeks: { week: string; sessions: number }[] }) {
  const peak = Math.max(...weeks.map((week) => week.sessions), 1);

  return (
    <>
      <p className="sr-only">
        {weeks
          .map((week) => `Semaine du ${formatFull(week.week)} : ${week.sessions} séance(s).`)
          .join(" ")}
      </p>
      <div className="flex items-end gap-1">
        {weeks.map((week, i) => (
          <div key={week.week} className="flex flex-1 flex-col items-center gap-1" aria-hidden>
            <span className="font-heading text-xs tabular-nums text-muted-foreground">
              {week.sessions > 0 ? week.sessions : ""}
            </span>
            {/* min-h so an empty week is still a visible baseline, not a gap. */}
            <div
              className={cn(
                "min-h-0.5 w-full rounded-sm",
                // The last bucket is the current, unfinished week: dimmed so a
                // Monday doesn't read as a collapse in form.
                i === weeks.length - 1 ? "bg-primary/40" : "bg-primary",
              )}
              style={{ height: `${(week.sessions / peak) * 40}px` }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  unit,
  delta,
  digits = 0,
}: {
  label: string;
  value: number;
  unit?: string;
  delta?: number;
  digits?: number;
}) {
  return (
    <div className="rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="font-heading text-2xl font-semibold tabular-nums">
        {formatNumber(value, digits)}
        {unit ? <span className="text-sm text-muted-foreground"> {unit}</span> : null}
      </div>
      {/* Deliberately uncoloured: whether losing weight is good depends on the
          goal, and the app doesn't get to decide that. 0 is worth showing —
          "unchanged" is an answer. */}
      {delta !== undefined && (
        <div className="text-xs tabular-nums text-muted-foreground">
          {delta > 0 ? "+" : delta < 0 ? "−" : "="}
          {delta !== 0 && formatNumber(Math.abs(delta), 1)}
        </div>
      )}
      <div className="text-xs leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}
