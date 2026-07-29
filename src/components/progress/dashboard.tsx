"use client";

import { useQuery } from "convex/react";
import { TrophyIcon } from "lucide-react";
import { useState } from "react";
import { formatDay, fromDate } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { formatNumber } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../../../convex/_generated/api";

const RANGES = {
  "4s": { label: "4 semaines", days: 28 },
  "3m": { label: "3 mois", days: 92 },
  all: { label: "Tout", days: null },
} as const;

type RangeKey = keyof typeof RANGES;

/** `unknown` in: recharts hands its formatters a ReactNode, always a date string here. */
const dayLabel = (date: unknown) => formatDay(String(date));

/**
 * Whichever of the three a scale actually reported. Every field is optional —
 * a body-composition screen carries fat and muscle but no weight — so this
 * prints what exists rather than "undefined kg".
 */
function measures(entry: { weightKg?: number; bodyFatPct?: number; muscleKg?: number }) {
  return [
    entry.weightKg !== undefined && `${entry.weightKg} kg`,
    entry.bodyFatPct !== undefined && `${entry.bodyFatPct} % MG`,
    entry.muscleKg !== undefined && `${entry.muscleKg} kg muscle`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function Dashboard({ today }: { today: string }) {
  const [range, setRange] = useState<RangeKey>("3m");
  const [exercise, setExercise] = useState<string | null>(null);

  const data = useQuery(api.progress.overview, {
    from: fromDate(today, RANGES[range].days),
    to: today,
  });

  if (data === undefined) return <Skeleton className="m-4 h-64" />;
  if (data === null) return <Empty>Profil en cours de création…</Empty>;

  const selected =
    data.exercises.find((item) => item.name === exercise) ?? data.exercises[0] ?? null;

  // No bottom padding below: /progres reserves --tab-bar for the tab bar.
  // ph-mask: weight, body fat and lean mass are masked in session replay.
  return (
    <div className="ph-mask space-y-4 p-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Ma progression</h1>
        <p className="text-sm text-muted-foreground">Les chiffres montent, ou pas. On verra.</p>
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

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Séances" value={data.sessions.length} />
        <Stat label="Volume" value={Math.round(data.totalVolume / 1000)} unit="t" />
        <Stat label="Semaines d'affilée" value={data.streak} />
      </div>

      {/* Only "nothing here" when there's genuinely nothing: an imported cardio
          with no muscu session still renders its own card below. */}
      {data.sessions.length === 0 ? (
        data.cardio.length === 0 && data.weights.length === 0 ? (
          <Empty>Rien sur cette période. Va soulever quelque chose.</Empty>
        ) : null
      ) : (
        <>
          {/* Charts pair up only at lg+: at md the column is still narrow enough
              that halving it would put every bar chart back into Scroller's
              horizontal scroll. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle>Volume par semaine</CardTitle>
                <CardDescription>Kilos déplacés, séries validées uniquement</CardDescription>
              </CardHeader>
              <CardContent>
                <Scroller count={data.weeks.length}>
                  <BarChart data={data.weeks}>
                    <Grid />
                    <XAxis {...axis} dataKey="week" tickFormatter={dayLabel} />
                    <YAxis {...axis} width={40} />
                    <Tooltip
                      {...tooltip}
                      labelFormatter={(week) => `Semaine du ${dayLabel(week)}`}
                    />
                    <Bar
                      dataKey="volume"
                      name="kg"
                      fill="var(--chart-1)"
                      radius={[3, 3, 0, 0]}
                      {...series}
                    />
                  </BarChart>
                </Scroller>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Séances par semaine</CardTitle>
                <CardDescription>La régularité, c&apos;est tout ce qui compte</CardDescription>
              </CardHeader>
              <CardContent>
                <Scroller count={data.weeks.length} height="h-32">
                  <BarChart data={data.weeks}>
                    <Grid />
                    <XAxis {...axis} dataKey="week" tickFormatter={dayLabel} />
                    <YAxis {...axis} width={40} allowDecimals={false} />
                    <Tooltip
                      {...tooltip}
                      labelFormatter={(week) => `Semaine du ${dayLabel(week)}`}
                    />
                    <Bar
                      dataKey="sessions"
                      name="séances"
                      fill="var(--chart-2)"
                      radius={[3, 3, 0, 0]}
                      {...series}
                    />
                  </BarChart>
                </Scroller>
              </CardContent>
            </Card>

            {selected ? (
              <Card>
                <CardHeader>
                  <CardTitle>Par exercice</CardTitle>
                  <CardDescription>Charge max, 1RM estimé et volume par séance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={selected.name} onValueChange={setExercise}>
                    <SelectTrigger className="h-12 w-full text-base sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.exercises.map((item) => (
                        <SelectItem key={item.name} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Scroller count={selected.points.length}>
                    <LineChart data={selected.points}>
                      <Grid />
                      <XAxis {...axis} dataKey="date" tickFormatter={dayLabel} />
                      <YAxis {...axis} yAxisId="kg" width={40} />
                      <YAxis {...axis} yAxisId="vol" orientation="right" width={40} />
                      <Tooltip {...tooltip} labelFormatter={dayLabel} />
                      <Line
                        yAxisId="kg"
                        dataKey="maxWeight"
                        name="charge (kg)"
                        stroke="var(--chart-1)"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        {...series}
                      />
                      <Line
                        yAxisId="kg"
                        dataKey="est1rm"
                        name="1RM est. (kg)"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        dot={false}
                        {...series}
                      />
                      <Line
                        yAxisId="vol"
                        dataKey="volume"
                        name="volume (kg)"
                        stroke="var(--chart-3)"
                        strokeWidth={2}
                        dot={false}
                        {...series}
                      />
                    </LineChart>
                  </Scroller>
                  <p className="text-xs text-muted-foreground">
                    Un point par séance : les semaines sans cet exercice n&apos;en ont pas.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Dernières séances</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {[...data.sessions]
                  .reverse()
                  .slice(0, 8)
                  .map((session) => (
                    <li key={session.date} className="flex items-center gap-2 py-2">
                      <span className="tabular-nums">{dayLabel(session.date)}</span>
                      {session.pr ? <TrophyIcon className={TROPHY} /> : null}
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {session.sets} séries · {formatNumber(session.volume)} kg
                      </span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {/* Imported cardio and weigh-ins. Their own cards, not merged into
          "Dernières séances": they have no sets and no volume, so they'd read
          as broken muscu rows. Hidden entirely when there's nothing. */}
      {data.cardio.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cardio</CardTitle>
            <CardDescription>Importé de tes captures</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.cardio.map((entry) => (
                <li key={entry._id} className="flex items-baseline gap-2 py-2">
                  <span className="tabular-nums text-muted-foreground">{dayLabel(entry.date)}</span>
                  <span className="truncate">{entry.kind}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {[
                      entry.durationMin && `${entry.durationMin} min`,
                      entry.distanceKm && `${entry.distanceKm} km`,
                      entry.avgHr && `${entry.avgHr} bpm`,
                      entry.calories && `${entry.calories} kcal`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {data.weights.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Poids &amp; composition</CardTitle>
            <CardDescription>
              {/* ponytail: latest values + list. A weight/masse grasse trend
                  chart once there are enough weigh-ins for a line to mean
                  anything — with one row it would be a dot. */}
              Dernière mesure : {measures(data.weights[0]) || "rien de lisible"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.weights.map((entry) => (
                <li key={entry._id} className="flex items-baseline gap-2 py-2">
                  <span className="tabular-nums text-muted-foreground">{dayLabel(entry.date)}</span>
                  <span className="ml-auto font-heading font-semibold tabular-nums">
                    {measures(entry)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
          <CardDescription>Tous temps, toutes périodes confondues</CardDescription>
        </CardHeader>
        <CardContent>
          {data.prs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun record pour l&apos;instant. Termine une séance, il en tombera.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {data.prs.map((pr) => (
                <li key={`${pr.exerciseName}|${pr.type}`} className="flex items-center gap-2 py-2">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Charts get a minimum width per data point and scroll sideways on a phone. */
function Scroller({
  count,
  height = "h-48",
  children,
}: {
  count: number;
  height?: string;
  children: React.ReactElement;
}) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <div className={height} style={{ minWidth: Math.max(280, count * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const axis = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const tooltip = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  labelStyle: { color: "var(--muted-foreground)" },
} as const;

/**
 * recharts replays every series over 1500ms on each range change and on first
 * paint, with no reduced-motion awareness — a second and a half of movement
 * across a chart you're trying to read. The data appearing is the answer.
 */
const series = { isAnimationActive: false } as const;

const Grid = () => <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="font-heading text-xl font-semibold tabular-nums">
        {value}
        {unit ? <span className="text-sm text-muted-foreground"> {unit}</span> : null}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-muted-foreground">{children}</p>;
}
