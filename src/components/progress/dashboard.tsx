"use client";

import { useQuery } from "convex/react";
import { TrophyIcon } from "lucide-react";
import { useState } from "react";
import { formatDay, formatShort, fromDate } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { formatNumber } from "@/lib/utils";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../../../convex/_generated/api";

const RANGES = {
  "4s": { label: "4 semaines", days: 28 },
  "12s": { label: "12 semaines", days: 84 },
  all: { label: "Tout", days: null },
} as const;

type RangeKey = keyof typeof RANGES;

/** `unknown` in: recharts hands its formatters a ReactNode, always a date string here. */
const dayLabel = (date: unknown) => formatDay(String(date));

/** Tonnes above 10 t, kilos below — "0,4 t" reads as nothing. */
const tonnage = (kg: number) =>
  kg >= 10000
    ? { value: formatNumber(kg / 1000, 1), unit: "tonnes" }
    : { value: formatNumber(kg), unit: "kg" };

const kgTick = (v: number) =>
  v >= 1000 ? `${formatNumber(v / 1000, v < 10000 ? 1 : 0)} t` : formatNumber(v);

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
  const [range, setRange] = useState<RangeKey>("12s");
  const [exercise, setExercise] = useState<string | null>(null);

  const from = fromDate(today, RANGES[range].days);
  const data = useQuery(api.progress.overview, { from, to: today });

  if (data === undefined) return <Skeleton className="m-4 h-64" />;
  // The level-1 still has to exist on this branch — the visible heading below
  // never renders. Same string and same markup as Today's null state.
  if (data === null)
    return (
      <>
        <h1 className="sr-only">Progrès</h1>
        <p className="p-6 text-center text-muted-foreground">Profil en cours de création…</p>
      </>
    );

  const selected =
    data.exercises.find((item) => item.name === exercise) ?? data.exercises[0] ?? null;

  // The standing records are all-time; the header says "sur la période", so the
  // range has to actually filter them. "Tout" puts every one of them back.
  // `overview` already keeps records and first attempts apart; both lists are
  // all-time standing bests, so the range still has to filter them.
  const prs = data.prs.filter((pr) => pr.date >= from);
  const firsts = data.baselines.filter((pr) => pr.date >= from);
  const hero = tonnage(data.totalVolume);

  // Oldest first for a chart, and only rows where the scale reported a weight —
  // a body-fat-only entry would draw a hole.
  const bodyweight = [...data.weights]
    .reverse()
    .filter((entry): entry is typeof entry & { weightKg: number } => entry.weightKg !== undefined);

  const hasCharts = data.sessions.length > 0 || bodyweight.length > 1;

  // No bottom padding below: /progres reserves --tab-bar for the tab bar.
  // ph-mask: weight, body fat and lean mass are masked in session replay.
  return (
    <div className="ph-mask flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-3">
        <div>
          <p className="eyebrow">Ma progression</p>
          <h1 className="text-[clamp(1.4rem,6vw,1.9rem)] font-bold">
            Les chiffres montent, ou pas.
          </h1>
        </div>

        <Tabs value={range} onValueChange={(value) => setRange(value as RangeKey)}>
          {/* Named: "4 semaines / 12 semaines / Tout" says nothing about what
              it filters when it's read out on its own. Weeks on both windows,
              same as /crew: the charts below bucket by week, so months would be
              a second unit for the same thing. */}
          <TabsList aria-label="Période" className="w-full">
            {Object.entries(RANGES).map(([key, { label }]) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      {/* The screen's one slab: the period total is what the whole page is
          about. */}
      <section className="slab flex flex-wrap items-end gap-4">
        <div>
          <p className="eyebrow">Tonnage sur la période</p>
          <div className="hero-num">
            {hero.value}
            <span className="unit">{hero.unit}</span>
          </div>
        </div>
        {/* Two cells, not four: four under a numeral is the hero-metric template.
            "Volume moyen / semaine" is gone because it's the mean of the bars
            below, and on one week of data it printed the hero's own string; the
            streak is Today's. */}
        <div className="band ml-auto grid-cols-2">
          <BandCell value={formatNumber(data.sessions.length)} label="Séances" />
          <BandCell value={formatNumber(prs.length)} label="Records battus" />
        </div>
      </section>

      {hasCharts ? (
        <>
          <Separator />

          {/* Charts pair up only at lg+: at md the column is still narrow enough
              that halving it would put every bar chart back into Scroller's
              horizontal scroll. */}
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
            {/* Two buckets minimum, same bar as the curves: one bucket draws a
                single block filling the plot area, which is a rectangle and not a
                chart. */}
            {data.weeks.length >= 2 ? (
              <>
                <ChartSection
                  title="Volume par semaine"
                  hint="Kilos déplacés, séries validées uniquement"
                  alt={`${data.weeks.length} semaines, de la plus ancienne à la plus récente : ${data.weeks
                    .map((week) => `${dayLabel(week.week)} ${formatNumber(week.volume)} kg`)
                    .join(", ")}`}
                >
                  <Scroller count={data.weeks.length}>
                    <BarChart data={data.weeks}>
                      <Grid />
                      <XAxis
                        {...axis}
                        dataKey="week"
                        tickFormatter={dayLabel}
                        interval={thin(data.weeks.length, 6)}
                      />
                      <YAxis {...axis} width={40} tickCount={3} tickFormatter={kgTick} />
                      <Tooltip
                        {...tooltip}
                        formatter={(value) => `${formatNumber(Number(value))} kg`}
                        labelFormatter={(week) => `Semaine du ${dayLabel(week)}`}
                      />
                      <Bar
                        dataKey="volume"
                        name="Volume"
                        fill="var(--chart-1)"
                        radius={[3, 3, 0, 0]}
                        {...bars}
                      >
                        {data.weeks.map((week, index) => (
                          <Cell
                            key={week.week}
                            fillOpacity={index === data.weeks.length - 1 ? 0.4 : 1}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </Scroller>
                </ChartSection>

                <ChartSection
                  title="Séances par semaine"
                  hint="La régularité, c'est tout ce qui compte"
                  alt={`${data.weeks.length} semaines, de la plus ancienne à la plus récente : ${data.weeks
                    .map((week) => `${dayLabel(week.week)} ${week.sessions}`)
                    .join(", ")}`}
                >
                  <Scroller count={data.weeks.length} height="h-32">
                    <BarChart data={data.weeks}>
                      <Grid />
                      <XAxis
                        {...axis}
                        dataKey="week"
                        tickFormatter={dayLabel}
                        interval={thin(data.weeks.length, 6)}
                      />
                      <YAxis {...axis} width={40} tickCount={3} allowDecimals={false} />
                      <Tooltip
                        {...tooltip}
                        formatter={(value) => `${value} séance${Number(value) > 1 ? "s" : ""}`}
                        labelFormatter={(week) => `Semaine du ${dayLabel(week)}`}
                      />
                      <Bar
                        dataKey="sessions"
                        name="Séances"
                        fill="var(--chart-2)"
                        radius={[3, 3, 0, 0]}
                        {...bars}
                      >
                        {data.weeks.map((week, index) => (
                          <Cell
                            key={week.week}
                            fillOpacity={index === data.weeks.length - 1 ? 0.4 : 1}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </Scroller>
                </ChartSection>
              </>
            ) : data.sessions.length > 0 ? (
              <ChartSection title="Par semaine" hint="Volume et régularité, semaine par semaine">
                <p className="py-6 text-sm text-muted-foreground">
                  Pas encore assez de semaines pour tracer une courbe. Deux suffisent.
                </p>
              </ChartSection>
            ) : null}

            {selected ? (
              <ChartSection
                title="Par exercice"
                hint="Charge max et 1RM estimé, séance par séance"
                alt={`${selected.name}, une séance par point : ${selected.points
                  .map((point) => `${dayLabel(point.date)} ${point.maxWeight} kg`)
                  .join(", ")}`}
              >
                <Select value={selected.name} onValueChange={setExercise}>
                  <SelectTrigger aria-label="Exercice" className="h-12 w-full text-base sm:text-sm">
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

                {selected.points.length < 2 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    Pas encore assez de séances sur {selected.name} pour tracer une courbe. Deux
                    suffisent.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3.5 text-sm text-muted-foreground">
                      <Key color="var(--chart-1)">Charge max (kg)</Key>
                      <Key color="var(--chart-3)">1RM estimé (kg)</Key>
                    </div>
                    <Scroller count={selected.points.length}>
                      <AreaChart data={selected.points}>
                        <Grid />
                        <XAxis
                          {...axis}
                          dataKey="date"
                          tickFormatter={dayLabel}
                          interval={thin(selected.points.length, 5)}
                        />
                        <YAxis {...axis} width={40} tickCount={3} domain={valueWindow} />
                        <Tooltip
                          {...tooltip}
                          formatter={(value) => `${formatNumber(Number(value), 1)} kg`}
                          labelFormatter={dayLabel}
                        />
                        <Area dataKey="maxWeight" name="Charge max" {...fill("var(--chart-1)")} />
                        <Area dataKey="est1rm" name="1RM estimé" {...fill("var(--chart-3)")} />
                      </AreaChart>
                    </Scroller>
                    <p className="text-sm text-muted-foreground">{delta(selected.points)}</p>
                  </>
                )}
              </ChartSection>
            ) : null}

            {/* The ponytail note this replaces said a trend chart would be a dot:
                true with one weigh-in, which is why it waits for two. From two up
                the line is the whole point — the list of numbers it used to be
                never showed whether they were going anywhere. */}
            {bodyweight.length > 1 ? (
              <ChartSection
                title="Poids de corps"
                hint={`Relevé sur la balance, jamais lissé ni corrigé. Dernière mesure : ${
                  measures(data.weights[0]) || "rien de lisible"
                }`}
                alt={`${bodyweight.length} pesées, de la plus ancienne à la plus récente : ${bodyweight
                  .map((entry) => `${dayLabel(entry.date)} ${entry.weightKg} kg`)
                  .join(", ")}`}
              >
                <Scroller count={bodyweight.length}>
                  <AreaChart data={bodyweight}>
                    <Grid />
                    <XAxis
                      {...axis}
                      dataKey="date"
                      tickFormatter={dayLabel}
                      interval={thin(bodyweight.length, 5)}
                    />
                    <YAxis {...axis} width={40} tickCount={3} domain={valueWindow} />
                    <Tooltip
                      {...tooltip}
                      formatter={(value) => `${formatNumber(Number(value), 1)} kg`}
                      labelFormatter={dayLabel}
                    />
                    <Area dataKey="weightKg" name="Poids" {...fill("var(--chart-1)")} />
                  </AreaChart>
                </Scroller>
                {/* Rule 5: no colour on this delta. Down is good or bad depending
                    on a goal the app was never told. */}
                <p className="text-sm text-muted-foreground">
                  {signed(bodyweight.at(-1)!.weightKg - bodyweight[0].weightKg)} kg sur la période,
                  en {bodyweight.length} pesées.
                </p>
              </ChartSection>
            ) : data.weights.length > 0 ? (
              <ChartSection
                title="Poids de corps"
                hint={`Dernière mesure : ${measures(data.weights[0]) || "rien de lisible"}`}
              >
                <p className="text-sm text-muted-foreground">
                  Pas encore assez de pesées pour tracer une courbe. Deux suffisent.
                </p>
              </ChartSection>
            ) : null}
          </div>
        </>
      ) : null}

      <Separator />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <section className="flex flex-col gap-2">
          <h2 className="text-[1.05rem] font-bold">Records sur la période</h2>
          <ul className="divide-y">
            {prs.length === 0 ? (
              <li className="flex min-h-11 items-center py-2.5 text-sm text-muted-foreground">
                Aucun record sur cette période. Ça arrive.
              </li>
            ) : (
              prs.map((pr) => (
                <li
                  key={`${pr.exerciseName}|${pr.type}`}
                  className="flex min-h-11 items-center gap-3 py-2.5 text-sm"
                >
                  <TrophyIcon className={TROPHY} />
                  <span className="min-w-0 flex-1 truncate">{pr.exerciseName}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {PR_LABELS[pr.type].text}
                  </Badge>
                  {/* min-w, so the badge column stops shifting row to row as the
                      value goes from "8 kg" to "3 600 kg". */}
                  <span className="min-w-20 shrink-0 text-right font-semibold tabular-nums">
                    {formatNumber(pr.value)} {PR_LABELS[pr.type].unit}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Its own section and no trophy: a first attempt beat nothing, it's the
            number the next one has to pass. */}
        {firsts.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[1.05rem] font-bold">Premières références</h2>
            <ul className="divide-y">
              {firsts.map((pr) => (
                <li
                  key={`${pr.exerciseName}|${pr.type}`}
                  className="flex min-h-11 items-center gap-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{pr.exerciseName}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {PR_LABELS[pr.type].text}
                  </Badge>
                  <span className="min-w-20 shrink-0 text-right font-semibold tabular-nums">
                    {formatNumber(pr.value)} {PR_LABELS[pr.type].unit}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ponytail: the eight most recent, no pagination. The charts above are
            where a long history is supposed to be read. */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[1.05rem] font-bold">Déjà fait</h2>
          <ul className="divide-y">
            {data.sessions.length === 0 ? (
              <li className="flex min-h-11 items-center py-2.5 text-sm text-muted-foreground">
                Rien sur cette période. Va soulever quelque chose.
              </li>
            ) : (
              [...data.sessions]
                .reverse()
                .slice(0, 8)
                .map((session) => (
                  <li
                    key={session.date}
                    className="flex min-h-11 items-center gap-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate tabular-nums">
                      {formatShort(session.date)}
                    </span>
                    {session.pr ? <TrophyIcon className={TROPHY} /> : null}
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {session.sets} série{session.sets > 1 ? "s" : ""} ·{" "}
                      {formatNumber(session.volume)} kg
                    </span>
                  </li>
                ))
            )}
          </ul>
        </section>

        {/* Imported cardio, its own section: no sets and no volume, so these rows
            would read as broken muscu rows next to "Déjà fait". Hidden entirely
            when there's nothing — a permanent 0 tells you nothing. */}
        {data.cardio.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[1.05rem] font-bold">Cardio</h2>
            <p className="text-sm text-muted-foreground">Importé de tes captures</p>
            <ul className="divide-y">
              {data.cardio.map((entry) => (
                <li key={entry._id} className="flex min-h-11 items-center gap-3 py-2.5 text-sm">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {dayLabel(entry.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.kind}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
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
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Heading, hint, and the text equivalent screen readers get instead of the SVG. */
function ChartSection({
  title,
  hint,
  alt,
  children,
}: {
  title: string;
  hint: string;
  alt?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[1.05rem] font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {alt ? (
        <p className="sr-only">
          {title} — {alt}.
        </p>
      ) : null}
      {children}
    </section>
  );
}

const Key = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span>
    <span
      aria-hidden
      className="mr-1.5 inline-block size-2.5 rounded-[2px] align-[-1px]"
      style={{ background: color }}
    />
    {children}
  </span>
);

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

/**
 * THE POINT OF THIS SCREEN. Plotted from zero, a bench going 72,5 → 82,5 kg is a
 * flat line and the progress is invisible. The grid spans the real value window
 * instead, padded either side so the top point isn't glued to the frame.
 */
const valueWindow = ([min, max]: readonly [number, number]): [number, number] => [
  min * 0.9,
  max * 1.05,
];

const signed = (kg: number) => `${kg > 0 ? "+" : ""}${formatNumber(kg, 1)}`;

function delta(points: { maxWeight: number }[]) {
  const kg = points.at(-1)!.maxWeight - points[0].maxWeight;
  if (kg > 0) return `+${formatNumber(kg, 1)} kg sur la période, en ${points.length} séances.`;
  if (kg === 0) return "Charge identique sur la période. Le volume, lui, a peut-être bougé.";
  return `${formatNumber(kg, 1)} kg sur la période. Un deload, une blessure, ou juste une mauvaise passe.`;
}

/**
 * Render one tick in every `ceil(count / target)`, as a recharts skip count. Dense
 * ranges otherwise overprint their own date labels.
 */
const thin = (count: number, target: number) => Math.ceil(count / target) - 1;

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
    // The scale's body step, not one under it: a tooltip is a readout, and 12
    // was a size nobody could tell from the 11px axis ticks.
    fontSize: 14,
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

/** A zero week keeps a 2px stub: visible as a zero, not as a gap. The last
 *  bucket is dimmed by its Cell — a Monday shouldn't read as a collapse. */
const bars = { ...series, minPointSize: 2 } as const;

/** Line plus filled area, so the shape reads before the numbers do. */
const fill = (color: string) =>
  ({
    ...series,
    type: "linear",
    stroke: color,
    strokeWidth: 2,
    fill: color,
    fillOpacity: 0.18,
    dot: { r: 3, fill: "var(--background)", stroke: color, strokeWidth: 2 },
  }) as const;

const Grid = () => <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;

function BandCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="band-value">{value}</div>
      <div className="band-label">{label}</div>
    </div>
  );
}
