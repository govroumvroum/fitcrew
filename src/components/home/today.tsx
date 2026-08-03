"use client";

import { useQuery } from "convex/react";
import { CheckIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { JoinButton, METRICS } from "@/components/crew/challenges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull, formatShort } from "@/lib/dates";
import { PR_LABELS, TROPHY } from "@/lib/prs";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

/**
 * Also the placeholder the page renders before the local date exists, so the
 * two waits are one shape: a different skeleton per phase shifted the layout
 * twice before any content arrived.
 */
export function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 pb-[var(--tab-bar)]">
      <Skeleton className="h-64" />
      <Skeleton className="h-24" />
    </div>
  );
}

export function Today({ date }: { date: string }) {
  const today = useQuery(api.workouts.today, { date });
  const stats = useQuery(api.home.stats, { date });

  if (today === undefined || stats === undefined) return <TodaySkeleton />;
  if (today === null || stats === null) {
    return <p className="p-6 text-center text-muted-foreground">Profil en cours de création…</p>;
  }

  const { day, workout, sets, prefill } = today;
  const done = sets.filter((set) => set.completed).length;
  const volume = Math.round(
    sets.reduce((total, set) => (set.completed ? total + set.weight * set.reps : total), 0),
  );
  const running = workout !== null && !workout.endedAt;
  const setsPlanned = day?.exercises.reduce((total, exercise) => total + exercise.sets, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5 p-4 pb-[var(--tab-bar)]">
      <p className="eyebrow normal-case first-letter:uppercase">{formatFull(date)}</p>

      <div className="md:grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:items-start md:gap-5">
        <div className="flex flex-col gap-5">
          {/* The screen's one dominant surface, and the only red button on it.
              Everything below is a band or a panel. */}
          <section className="slab flex flex-col gap-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {/* Just the label. The half that explained the rotation has no
                    calendar was the app describing its own plumbing — that
                    belongs on /programme, which does say it. */}
                <p className="eyebrow">{day ? "À suivre" : "Programme"}</p>
                {/* Fixed size and clamped, not clamp(): a real day name ("Jour 1 —
                    Haut du corps et puissance (pectoraux, dos, épaules, gainage)")
                    ran to six lines and pushed the button out of the viewport. The
                    full string stays — the muscle list is what you decide on. */}
                <h2 className="line-clamp-2 font-heading text-[1.375rem] leading-tight font-bold">
                  {day ? day.name : "Pas encore de programme"}
                </h2>
              </div>
              {day ? (
                <Badge variant="secondary" className="shrink-0">
                  {day.exercises.length} exercice{day.exercises.length > 1 ? "s" : ""} ·{" "}
                  {setsPlanned} série{setsPlanned > 1 ? "s" : ""}
                </Badge>
              ) : null}
            </div>

            {!day ? (
              <p className="text-sm text-muted-foreground">
                Le coach t&apos;en écrit un après quelques questions.
              </p>
            ) : workout?.endedAt ? (
              /* A finished day has no next action, so there is no red button to
                 be the screen's dominant element — the confirmation takes the
                 job instead of sitting as a small line where the CTA used to be.
                 Display face at heading size, and the tick in chart-1: a logged
                 séance is recorded data, and the commit red is rationed to
                 things you can still tap. */
              <div className="flex items-center gap-3">
                <CheckIcon className="size-7 shrink-0 stroke-[2.5] text-chart-1" />
                <div className="min-w-0">
                  <p className="font-display text-[clamp(1.75rem,8vw,2.5rem)] leading-[0.95] font-extrabold">
                    Séance pliée. À demain.
                  </p>
                  {/* 0 série · 0 kg is a real row in the history (a séance
                      terminée sans rien cocher), and reading it as an
                      achievement would be a lie. */}
                  <p className="text-sm text-muted-foreground">
                    {done === 0
                      ? "Rien de coché, rien de compté. Le jour suivant est déjà en place."
                      : `${done} série${done > 1 ? "s" : ""} · ${formatNumber(volume)} kg déplacés`}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y">
                {day.exercises.map((exercise) => {
                  const last = prefill.find((entry) => entry.name === exercise.name);
                  return (
                    <li key={exercise.name} className="flex items-center gap-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {exercise.sets} × {exercise.reps}
                      </span>
                      <span className="w-18 shrink-0 text-right tabular-nums">
                        {last ? `${formatNumber(last.weight, 1)} kg` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {running ? (
              <div className="flex flex-col gap-2">
                {/* chart-1 instead of the default bg-primary: the red on this
                    screen is spoken for by the button below. Hidden at zero: an
                    empty track is indistinguishable from the divide-y hairlines
                    right above it, so it reads as one more rule. */}
                {done > 0 ? (
                  <Progress
                    value={(done / sets.length) * 100}
                    className="[&_[data-slot=progress-indicator]]:bg-chart-1"
                  />
                ) : null}
                <p className="text-sm text-muted-foreground tabular-nums">
                  {done}/{sets.length} séries validées
                </p>
              </div>
            ) : null}

            {!day ? (
              <Cta href="/coach">Fais ton profil avec le coach</Cta>
            ) : workout?.endedAt ? null : (
              <Cta href="/seance">{running ? "Reprendre la séance" : "Commencer la séance"}</Cta>
            )}

            {day ? (
              <Button asChild variant="ghost" className="h-11 w-full">
                <Link href="/programme">Voir le programme entier</Link>
              </Button>
            ) : null}
          </section>

          {stats.streak >= 2 ? (
            <Streak streak={stats.streak} weeks={stats.weeks8} />
          ) : stats.hasHistory ? (
            <Lapsed weeks={stats.weeks8} />
          ) : null}

          {stats.hasHistory ? (
            <>
              <Separator />
              <StatBand stats={stats} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tes stats arrivent dès la première séance terminée.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-5 md:mt-0">
          {stats.prs.length > 0 ? (
            <section className="flex flex-col gap-2 rounded-lg border bg-card/55 p-3.5">
              <div className="flex items-center gap-3">
                <p className="eyebrow min-w-0 flex-1">Derniers records</p>
                {/* -my-3 keeps the row the eyebrow's height while the tap area
                    is 44px. */}
                <Link
                  href="/progres"
                  className="-my-3 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Tout voir
                </Link>
              </div>
              <ul className="divide-y">
                {stats.prs.map((pr) => (
                  <li
                    key={`${pr.date}|${pr.exerciseName}|${pr.type}`}
                    className="flex min-h-11 items-center gap-3 py-2.5 text-sm"
                  >
                    <TrophyIcon className={TROPHY} />
                    <span className="min-w-0 flex-1 truncate">{pr.exerciseName}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {PR_LABELS[pr.type].text}
                    </Badge>
                    {/* min-w so the badges before it line up into a column, and
                        formatNumber so a 3 600 kg volume record groups the same
                        here as it does on /progres. */}
                    <span className="min-w-20 shrink-0 text-right font-semibold tabular-nums">
                      {formatNumber(pr.value)} {PR_LABELS[pr.type].unit}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Only for someone who's in none of them, and only if there's something
              to join: /crew already owns the empty state and the create button. */}
          {!stats.joinedAny && stats.weekChallenges.length > 0 && (
            <section className="flex flex-col gap-2.5 rounded-lg border bg-card/55 p-3.5">
              <p className="eyebrow">Les défis tournent sans toi</p>
              {stats.weekChallenges.map((challenge) => (
                <div key={challenge._id} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold">{challenge.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {METRICS[challenge.metric].label}
                      {challenge.exerciseName ? ` · ${challenge.exerciseName}` : ""}
                      {challenge.byCoach ? " · proposé par le coach" : ""}
                      {" · "}
                      {challenge.participants === 0
                        ? "personne d'inscrit"
                        : `${challenge.participants} inscrit${challenge.participants > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  {/* Every row here is one the user isn't in — that's the filter. */}
                  <JoinButton challengeId={challenge._id} joined={false} />
                </div>
              ))}
            </section>
          )}

          <section className="flex flex-col gap-2.5 rounded-lg border bg-card/55 p-3.5">
            <div>
              <p className="eyebrow">Ta crew</p>
              <p className="text-sm text-muted-foreground">
                Séances, semaines d&apos;affilée et records, côte à côte.
              </p>
            </div>
            <Button asChild variant="outline" className="h-11 w-full">
              <Link href="/crew">Voir le classement</Link>
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Cta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button
      asChild
      size="lg"
      className="h-14 w-full rounded-lg text-base transition-transform active:scale-[0.96]"
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

const WEEKS = ["", "Une", "Deux", "Trois", "Quatre", "Cinq", "Six", "Sept"];

/**
 * Below two weeks there is no streak to draw: one filled slot out of eight isn't
 * a shape, and the numeral beside it would be a large figure describing an
 * absence. An absence gets a sentence. Replaces the old
 * `weeks8.some(sessions > 0)` gate, which showed the chart to someone who
 * trained once a month ago and to someone in their first week alike.
 */
function Lapsed({ weeks }: { weeks: { week: string; sessions: number }[] }) {
  const last = weeks.findLastIndex((week) => week.sessions > 0);
  const since = weeks.length - 1 - last;

  return (
    <p className="text-sm text-muted-foreground">
      {last === -1
        ? "Rien depuis plus de deux mois."
        : since === 0
          ? "Une séance cette semaine. Rien à rattraper, juste à continuer."
          : `${WEEKS[since]} semaine${since > 1 ? "s" : ""} sans séance. Le programme t'attend où tu l'as laissé.`}
    </p>
  );
}

/**
 * The streak as a physical object: one slot per week, filled or not, under the
 * screen's single hero numeral. The number and the shape say the same thing two
 * ways.
 *
 * Eight slots, not the prototype's twelve: `home.stats` returns `weeks8` and a
 * padded zero would be a fake week — the caption says how many there are.
 *
 * The bars are decoration; the sentence beside them is the real content. A
 * screen reader handed eight bare numbers and no weeks learns nothing.
 */
function Streak({
  streak,
  weeks,
}: {
  streak: number;
  weeks: { week: string; sessions: number }[];
}) {
  const peak = Math.max(...weeks.map((week) => week.sessions), 1);
  // The current week is excluded: a Monday with no séance yet is not a gap you
  // "reprise sans discuter".
  const gap = weeks.slice(0, -1).findLastIndex((week) => week.sessions === 0);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Semaines d&apos;affilée</p>
          <div className="hero-num">
            {streak}
            <span className="unit">sem.</span>
          </div>
        </div>
        <p className="max-w-48 text-right text-sm text-muted-foreground">
          {gap === -1
            ? `Aucune semaine vide sur ${weeks.length}. C'est rare, garde-le.`
            : `Une semaine vide le ${formatShort(weeks[gap].week)}. Tu l'as reprise sans discuter.`}
        </p>
      </div>

      <p className="sr-only">
        {weeks
          .map((week) => `Semaine du ${formatFull(week.week)} : ${week.sessions} séance(s).`)
          .join(" ")}
      </p>
      <div className="flex h-13 items-end gap-1" aria-hidden>
        {weeks.map((week, i) => (
          <div
            key={week.week}
            title={`Semaine du ${formatShort(week.week)} · ${week.sessions} séance(s)`}
            className={cn(
              // Capped: with one week, flex-1 alone stretched a single bar to a
              // 415px striped banner that read as an error state.
              "min-w-0 max-w-12 flex-1 rounded-t-[3px] rounded-b-sm",
              week.sessions > 0 ? "bg-chart-1" : "bg-secondary",
            )}
            style={{
              // An empty week stays a visible baseline, not a gap. The current
              // week is striped rather than dimmed: a Monday shouldn't read as a
              // collapse in form.
              height: week.sessions === 0 ? 6 : 14 + (week.sessions / peak) * 38,
              ...(i === weeks.length - 1 && week.sessions > 0
                ? {
                    background:
                      "repeating-linear-gradient(-60deg, var(--chart-1) 0 3px, color-mix(in oklab, var(--chart-1) 40%, var(--card)) 3px 6px)",
                  }
                : null),
            }}
          />
        ))}
      </div>

      {/* .eyebrow, not a 10px near-copy of it: this is the same micro-label role
          and the two spellings were one step apart. */}
      <div className="eyebrow flex justify-between">
        <span>
          {weeks.length} semaine{weeks.length > 1 ? "s" : ""}
        </span>
        <span>Cette semaine</span>
      </div>
    </section>
  );
}

/**
 * One horizontal run of hairline-separated numbers instead of a grid of
 * identical bordered tiles.
 *
 * The cardio cell is gated on `doesCardio`, which is true as soon as there is
 * one cardio row ever — not on the last seven days. So `0 min` does show up, and
 * that's the point: for someone who does cardio a zero week is the information.
 * The weight cells are gated on the measurement existing at all.
 */
function StatBand({
  stats,
}: {
  stats: {
    volume7d: number;
    thisWeek: number;
    thisMonth: number;
    doesCardio: boolean;
    cardio7d: { sessions: number; minutes: number };
    measure: { weightKg?: number; bodyFatPct?: number; deltaKg?: number } | null;
  };
}) {
  const cells: { value: number; unit?: string; digits?: number; label: string }[] = [
    { value: stats.volume7d, unit: "kg", label: "Volume 7 jours" },
    { value: stats.thisWeek, label: "Séances cette semaine" },
    { value: stats.thisMonth, label: "Séances ce mois" },
  ];
  if (stats.doesCardio) {
    cells.push({
      value: stats.cardio7d.minutes,
      unit: "min",
      label: `Cardio 7 jours${stats.cardio7d.sessions > 0 ? ` · ${stats.cardio7d.sessions}×` : ""}`,
    });
  }
  if (stats.measure?.weightKg !== undefined) {
    cells.push({
      value: stats.measure.weightKg,
      unit: "kg",
      digits: 1,
      // Deliberately uncoloured, and in the label: whether down is good depends
      // on the goal, and the app doesn't get to decide that. 0 is worth showing
      // — "unchanged" is an answer.
      label:
        stats.measure.deltaKg === undefined
          ? "Poids"
          : stats.measure.deltaKg === 0
            ? "Poids · stable"
            : // ASCII hyphen, not U+2212: every other negative in the app comes
              // out of Intl, which uses this one.
              `Poids · ${stats.measure.deltaKg > 0 ? "+" : "-"}${formatNumber(Math.abs(stats.measure.deltaKg), 1)}`,
    });
  }
  if (stats.measure?.bodyFatPct !== undefined) {
    cells.push({ value: stats.measure.bodyFatPct, unit: "%", digits: 1, label: "Masse grasse" });
  }

  return (
    // Up to six cells, so the run wraps at three per line; the nth-child rules
    // move the shared hairline to the start of each line instead of column 1.
    <div className="band grid-cols-3 gap-y-3 [&>*:nth-child(3n+1)]:border-l-0 [&>*:nth-child(3n+1)]:pl-0">
      {cells.map((cell) => (
        <Link key={cell.label} href="/progres" className="band-cell">
          <div className="band-value">
            {formatNumber(cell.value, cell.digits ?? 0)}
            {cell.unit ? <small> {cell.unit}</small> : null}
          </div>
          <div className="band-label">{cell.label}</div>
        </Link>
      ))}
    </div>
  );
}
