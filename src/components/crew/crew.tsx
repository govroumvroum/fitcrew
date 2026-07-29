"use client";

import { useQuery } from "convex/react";
import { TrophyIcon } from "lucide-react";
import { useState } from "react";
import { Challenges } from "@/components/crew/challenges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShort, fromDate } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { api } from "../../../convex/_generated/api";

// Same idiom as /progres, one window shorter: consistency over 4 weeks is the
// interesting comparison, 3 months is the season.
const RANGES = {
  "4s": { label: "4 semaines", days: 28 },
  "12s": { label: "12 semaines", days: 84 },
  all: { label: "Tout", days: null },
} as const;

type RangeKey = keyof typeof RANGES;

export function Crew({ today }: { today: string }) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">La crew</h1>
        <p className="text-sm text-muted-foreground">
          Qui vient s&apos;entraîner, et qui trouve des excuses.
        </p>
      </div>

      <Leaderboard today={today} />
      <Challenges today={today} />
      <Feed />
    </div>
  );
}

/** Every crew query answers `null` until StoreUser has created the users row. */
function Profile() {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">Profil en cours de création…</p>
  );
}

function Leaderboard({ today }: { today: string }) {
  const [range, setRange] = useState<RangeKey>("4s");
  const me = useQuery(api.users.me);
  const rows = useQuery(api.crew.leaderboard, {
    from: fromDate(today, RANGES[range].days),
    to: today,
  });

  // Sorted here, not in the query: the ranking is a display decision and the
  // crew is four rows. Régularité first, records only as a tiebreak.
  const ranked = rows
    ? [...rows].sort(
        (a, b) => b.sessions - a.sessions || b.streak - a.streak || b.prCount - a.prCount,
      )
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Classement</CardTitle>
        <CardDescription>
          Séances, semaines d&apos;affilée et records. Pas de volume : trop facile à gonfler.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={range} onValueChange={(value) => setRange(value as RangeKey)}>
          <TabsList className="w-full">
            {Object.entries(RANGES).map(([key, { label }]) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {rows === undefined ? (
          <Skeleton className="h-40" />
        ) : rows === null ? (
          <Profile />
        ) : ranked.every((row) => row.sessions === 0) ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Personne n&apos;a rien logué sur cette période. Termine une séance pour apparaître ici.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {ranked.map((row, i) => (
              <li
                key={row.userId}
                className={
                  row.userId === me?._id
                    ? "-mx-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-2"
                    : "flex items-center gap-2 py-2"
                }
              >
                <span className="w-4 text-center text-muted-foreground tabular-nums">{i + 1}</span>
                <Avatar size="sm">
                  {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{row.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="truncate">{row.name}</span>
                {row.userId === me?._id ? (
                  <Badge variant="secondary" className="shrink-0">
                    toi
                  </Badge>
                ) : null}
                <Spark weeks={row.weeks} />
                <span className="ml-auto shrink-0 text-right text-muted-foreground tabular-nums">
                  <span className="font-heading font-semibold text-foreground">{row.sessions}</span>{" "}
                  séances · {row.streak} sem. · {row.prCount} PR
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Séances per week, one bar each, newest on the right.
 *
 * ponytail: divs, not recharts — a chart component per row for twelve integers
 * is a lot of runtime for a 64px picture. A zero keeps a 4% stub so the gap
 * reads as "nothing that week" instead of a missing bar.
 */
function Spark({ weeks }: { weeks: number[] }) {
  const shown = weeks.slice(-12);
  const max = Math.max(1, ...shown);
  return (
    <div className="hidden h-6 w-16 shrink-0 items-end gap-px sm:flex" aria-hidden>
      {shown.map((sessions, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-[var(--chart-2)]"
          style={{ height: `${(sessions / max) * 100 || 4}%` }}
        />
      ))}
    </div>
  );
}

function Feed() {
  const rows = useQuery(api.crew.feed, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fil d&apos;actualité</CardTitle>
        <CardDescription>Les records de la crew, les plus récents en haut</CardDescription>
      </CardHeader>
      <CardContent>
        {rows === undefined ? (
          <Skeleton className="h-32" />
        ) : rows === null ? (
          <Profile />
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Aucun record pour l&apos;instant. Bats-en un, tout le monde le verra.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((pr, i) => (
              <li key={pr._id}>
                {/* Date heading only when the day changes: the feed is already
                    sorted newest-first, so a run of same-day PRs shares one. */}
                {i === 0 || rows[i - 1].date !== pr.date ? (
                  <p className="pb-1 text-xs text-muted-foreground">{formatShort(pr.date)}</p>
                ) : null}
                <div className="flex items-center gap-2">
                  <TrophyIcon className={TROPHY} />
                  <Avatar size="sm">
                    {pr.avatarUrl ? <AvatarImage src={pr.avatarUrl} alt="" /> : null}
                    <AvatarFallback>{pr.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">
                    <span className="font-medium">{pr.name}</span> a battu son record sur{" "}
                    {pr.exerciseName}
                  </span>
                  <span className="ml-auto shrink-0 font-heading font-semibold tabular-nums">
                    {pr.value} {PR_LABELS[pr.type].unit}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
