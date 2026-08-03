"use client";

import { useQuery } from "convex/react";
import { TrophyIcon } from "lucide-react";
import { useState } from "react";
import { Challenges } from "@/components/crew/challenges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShort, fromDate } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col gap-5 p-4">
      <div>
        {/* No font-heading/tracking here: the base layer already gives h1–h3 the
            display face and -0.01em. */}
        <h1 className="text-2xl font-semibold">La crew</h1>
        <p className="text-sm text-muted-foreground">
          Qui vient s&apos;entraîner, et qui trouve des excuses.
        </p>
      </div>

      {/* The presence grid is the screen's one dominant surface, so it spans the
          full width and the two hairline sections share the row below it. */}
      <Leaderboard today={today} />
      <div className="flex flex-col gap-5 md:grid md:grid-cols-2 md:items-start">
        <Challenges today={today} />
        <Feed />
      </div>
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

  // The rank numeral only means something with somebody to out-rank. A podium of
  // one participant and three zeroes reads as a broken widget; four rows of
  // mostly-empty weeks reads as a true statement about this crew. The sort above
  // still runs, it just stops printing numbers.
  const contested = ranked.filter((row) => row.sessions > 0).length >= 2;
  // One cell more than the tab says: `days` back from today lands on the Monday
  // N weeks ago and weeklyBuckets is inclusive of both ends, so "4 semaines"
  // spans the 4 complete weeks plus the current one. The caption below labels
  // the strip's left edge by age instead of counting cells, which is what made
  // it read as contradicting the tab.
  const weeksShown = ranked[0]?.weeks.slice(-WEEK_CELLS).length ?? 0;

  return (
    <section className="slab flex flex-col gap-3.5">
      <div>
        <p className="eyebrow">Qui vient s&apos;entraîner</p>
        <p className="text-sm text-muted-foreground">
          {/* Narrow no-break space before the colon: French spacing, and it stops
              the colon wrapping alone onto the next line at 390px. */}
          Une case par membre et par semaine. Séances, semaines d&apos;affilée et records. Pas de
          volume&#8239;: trop facile à gonfler.
        </p>
      </div>

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
        <>
          <ul className="divide-y">
            {ranked.map((row, i) => (
              // No self-row tint: inside a slab that's a nested surface. The `toi`
              // badge and the bolder name carry it.
              <li key={row.userId} className="flex flex-col gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {contested ? (
                    <span className="w-4 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                  ) : null}
                  <Avatar size="sm">
                    {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                    <AvatarFallback>{row.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  {/* shrink-0 on the name, not flex-1: the name is the only field
                      that identifies the row, so the figure wraps to its own line
                      at 390px instead of clipping "Basile Vernouillet" to
                      "Basile VER…". max-w-full keeps an absurd name in the row. */}
                  <span
                    className={cn(
                      "max-w-full shrink-0 truncate text-sm",
                      row.userId === me?._id ? "font-semibold" : "font-medium",
                    )}
                  >
                    {row.name}
                  </span>
                  {row.userId === me?._id ? (
                    <Badge variant="secondary" className="shrink-0">
                      toi
                    </Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-sm text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground">{row.sessions}</span> séance
                    {row.sessions > 1 ? "s" : ""} · {row.streak} sem. · {row.prCount} PR
                  </span>
                </div>
                <WeekStrip weeks={row.weeks} />
              </li>
            ))}
          </ul>
          {/* .eyebrow, not a fourth hand-rolled uppercase size: this is the same
              micro-label as every other one on the screen. */}
          <div className="eyebrow flex justify-between gap-2">
            <span>
              il y a {weeksShown - 1} semaine{weeksShown > 2 ? "s" : ""}
            </span>
            <span>Cette semaine</span>
          </div>
        </>
      )}
    </section>
  );
}

// At 390px the slab is ~322px wide inside its padding, so 16 cells land at ~19px
// each with gap-px — the floor before a week stops being a readable target.
const WEEK_CELLS = 16;

/**
 * Four steps, not three: at 3 the top one landed on 2 séances/semaine, which is
 * an ordinary week here, so an ordinary member's whole row came out solid and
 * read as a progress bar rather than a matrix.
 *
 * Lightness measured in OKLCH after compositing over the slab (--card, L 0.205),
 * because the strip sits inside one — not over --background:
 *   0 → 0.265 · 1 → 0.412 · 2 → 0.550 · 3+ → 0.680
 * ΔL 0.147 / 0.138 / 0.130, i.e. even. Adding a step inside a range bounded by
 * --secondary below and --chart-2 above necessarily costs per-boundary contrast
 * (the old 0/1/2+ ladder had ΔL 0.194 / 0.221); what buys the separability back
 * is that no row saturates any more, so two rows differ in pattern and not only
 * in tint. Going brighter than --chart-2 would break the theme's equal-weight
 * contract — every chart hue is pinned at L 0.68.
 */
const PRESENCE = ["bg-secondary", "bg-chart-2/40", "bg-chart-2/70", "bg-chart-2"] as const;

/**
 * Séances per week, one cell each, newest on the right. Full row width, because
 * the whole point of the screen is reading one member's row against another's.
 *
 * The scale is discrete and SHARED by every row on purpose. The sparkline this
 * replaces normalised per row (`Math.max(1, ...shown)`), so an idle member's
 * single séance drew exactly as tall as an active member's best week — which
 * defeats a comparison grid.
 *
 * ponytail: divs and three classes, not recharts. Decoration only — the figure
 * on the line above is what a screen reader reads, so 4 x 16 bare numbers stay
 * out of the accessibility tree.
 */
function WeekStrip({ weeks }: { weeks: number[] }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-px" aria-hidden>
      {weeks.slice(-WEEK_CELLS).map((sessions, i) => (
        <div key={i} className={cn("h-2.5 rounded-sm", PRESENCE[Math.min(sessions, 3)])} />
      ))}
    </div>
  );
}

function Feed() {
  const rows = useQuery(api.crew.feed, {});

  return (
    <section className="flex flex-col gap-2">
      <div>
        <p className="eyebrow">Records de la crew</p>
        <p className="text-sm text-muted-foreground">Les plus récents en haut.</p>
      </div>

      {rows === undefined ? (
        <Skeleton className="h-32" />
      ) : rows === null ? (
        <Profile />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun record pour l&apos;instant. Bats-en un, tout le monde le verra.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((pr, i) => (
            <li key={pr._id} className="py-2">
              {/* Date heading only when the day changes: the feed is already
                  sorted newest-first, so a run of same-day PRs shares one. */}
              {i === 0 || rows[i - 1].date !== pr.date ? (
                <p className="eyebrow pb-1 tabular-nums">{formatShort(pr.date)}</p>
              ) : null}
              <div className="flex min-h-11 items-center gap-2 text-sm">
                <TrophyIcon className={TROPHY} />
                <Avatar size="sm">
                  {pr.avatarUrl ? <AvatarImage src={pr.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{pr.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{pr.name}</span> a battu son record sur{" "}
                  {pr.exerciseName}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {pr.value} {PR_LABELS[pr.type].unit}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
