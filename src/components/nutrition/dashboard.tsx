"use client";

import { useMutation, useQuery } from "convex/react";
import { BookOpenIcon, ChevronRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull } from "@/lib/dates";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import {
  type DayLevel,
  type LevelSource,
  DAY_LEVELS,
  LEVEL_LABEL,
  entryLabel,
} from "../../../convex/weekTemplate";
import { FoodLog } from "./food-log";
import { MacroProgress, pct, runMutation } from "./macros";
import { WeekPlan } from "./week-plan";

/**
 * /nutrition. `api.nutrition.dashboard` for today (targets, journal,
 * hydration) and `api.weekPlan.week` for the menu of this week or the next.
 *
 * The rule since #121: swapping a meal for a recipe the library already has
 * happens here, with no model — `weekPlan.swapMeal`, re-checked against the
 * allergies on the server. Inventing a meal, moving one, « plus rapide »,
 * « sans poisson », a whole new week: that's language, so it's the Chef's, and
 * those stay links into /chef. The screen's other writes — journal, lock,
 * hydration, shopping ticks — have no model in the loop either.
 */

/** Also the placeholder the page shows before the local date exists, so the two
 *  waits are one shape (same reasoning as TodaySkeleton). */
export function NutritionSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  );
}

export function NutritionDashboard({ today }: { today: string }) {
  const data = useQuery(api.nutrition.dashboard, { today });

  if (data === undefined) return <NutritionSkeleton />;

  const { profile, log, consumed, hydrationMl, hasPlan, day } = data;
  // Today's level's targets; the flat one if the level isn't known.
  const targets = day?.targets ?? profile?.targets;

  // ph-mask: what someone eats, their targets and their weight-derived figures
  // are personal. PostHog session replay must not record any of it.
  return (
    <div className="ph-mask flex flex-col gap-5 p-4">
      <header>
        <p className="eyebrow">Nutrition</p>
        <h1 className="text-[clamp(1.4rem,6vw,1.9rem)] font-bold">Le carburant du jour.</h1>
        <p className="eyebrow normal-case first-letter:uppercase">{formatFull(today)}</p>
      </header>

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-5">
        <div className="flex flex-col gap-5">
          {/* The screen's one slab. Without a profile it explains Le Chef; with
              one it's the day's estimated numbers. Either way the journal below
              works — that's explicit in issue #31. */}
          <section className="slab flex flex-col gap-3.5">
            {profile && targets ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="eyebrow">
                      {day && day.level !== null
                        ? dayTitle(day.level, day.planned)
                        : `Objectif moyen · ${formatNumber(targets.calories)} kcal`}{" "}
                      · estimations
                    </p>
                    <h2 className="font-heading text-[1.375rem] leading-tight font-bold">
                      {formatNumber(consumed.calories)} kcal sur {formatNumber(targets.calories)}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {GOALS[profile.goal]}
                  </Badge>
                </div>
                <MacroProgress consumed={consumed} targets={targets} />
                {/* No semaine type: no level, no selector — the flat target is an
                    average that already includes sport. He fills his week first. */}
                {day && day.level !== null ? (
                  <DayLevelPicker today={today} level={day.level} source={day.source} />
                ) : (
                  <Link
                    href="/programme#ma-semaine"
                    className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2"
                  >
                    Dis au Coach tes jours d&apos;entraînement pour des objectifs jour par jour
                  </Link>
                )}
              </>
            ) : (
              <>
                {/* 40 px, not the chat header's 28: this slab is where someone
                    meets Le Chef for the first time, so he gets to be seen.
                    alt="" on purpose — his name is right there in the eyebrow, and
                    a screen reader announcing it twice is noise. */}
                <div className="flex items-start gap-3">
                  <Image
                    src="/chef.png"
                    alt=""
                    width={40}
                    height={40}
                    className="shrink-0 rounded-full ring-1 ring-white/10"
                    priority
                  />
                  <div className="min-w-0">
                    <p className="eyebrow">Le Chef</p>
                    <h2 className="font-heading text-[1.375rem] leading-tight font-bold">
                      Il te fait tes menus, tu ne cherches plus quoi manger.
                    </h2>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Dis-lui ton objectif, ton poids, ce que tu ne manges pas et le temps que tu as
                  pour cuisiner. Il en tire des objectifs caloriques estimés, un menu de la semaine
                  avec les recettes, et la liste de courses qui va avec. Le journal en dessous
                  marche déjà sans lui.
                </p>
              </>
            )}

            <Button
              asChild
              size="lg"
              className="h-14 w-full rounded-lg text-base transition-transform active:scale-[0.96]"
            >
              <Link href="/chef">
                {!profile
                  ? "Faire mon profil avec le Chef"
                  : hasPlan
                    ? "Ajuster ma semaine avec le Chef"
                    : "Générer mon menu de la semaine"}
              </Link>
            </Button>
            {/* #126: the Chef can prepare next week over the weekend. The line
                opens it in the week view below (#121). */}
            {profile && data.hasPlanNextWeek ? (
              <Link
                href="/nutrition?semaine=prochaine#semaine"
                className="-mt-1 text-center text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2"
              >
                Plan de la semaine prochaine prêt
              </Link>
            ) : null}
          </section>

          <WeekPlan today={today} hasPlanNextWeek={data.hasPlanNextWeek} />

          {/* #119: every recipe the Chef wrote, plus the sèche catalogue. */}
          <Link
            href="/nutrition/recettes"
            className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-transform active:scale-[0.98]"
          >
            <BookOpenIcon className="size-5 shrink-0 text-accent-text" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Recettes</span>
              <span className="block text-[11px] text-muted-foreground">
                Celles du Chef et le catalogue sèche, avec photos.
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>

          <Separator className="md:hidden" />
          <Hydration today={today} ml={hydrationMl} />
        </div>

        <div className="mt-5 flex flex-col gap-5 md:mt-0">
          <FoodLog today={today} log={log} />
        </div>
      </div>

      {/* Required by the issue, on the screen and not only in the chat: these are
          estimates and this is not medical advice. */}
      <p className="text-[11px] text-muted-foreground">
        Calories et macros sont des estimations, jamais une mesure. Ce n&apos;est pas un avis
        médical : pour une pathologie, un traitement ou un besoin particulier, parles-en à un
        professionnel de santé.
      </p>
    </div>
  );
}

const GOALS = {
  perte: "Perte de poids",
  maintien: "Maintien",
  prise: "Prise de masse",
} as const;

const DAY_NAME: Record<DayLevel, string> = {
  off: "Jour off",
  leger: "Jour léger",
  dur: "Jour dur",
};

/** "Jour dur · boxe 18h30" — the level, then what the week planned for today. */
const dayTitle = (level: DayLevel, planned: { kind: string; time?: string; level: DayLevel }[]) =>
  [DAY_NAME[level], ...planned.filter((e) => e.level !== "off").map(entryLabel)].join(" · ");

const WHY: Partial<Record<LevelSource, string>> = {
  manual: "Choisi à la main, pour aujourd'hui seulement.",
  session: "Tu t'es entraîné aujourd'hui : ta semaine disait off.",
};

/**
 * One tap changes today's level — for today only (`week.setDayLevel`). Only
 * shown with a semaine type. The targets above follow through the dashboard
 * subscription; nothing local to keep in sync.
 */
function DayLevelPicker({
  today,
  level: current,
  source,
}: {
  today: string;
  level: DayLevel;
  source: LevelSource;
}) {
  const setDayLevel = useMutation(api.week.setDayLevel);
  const why = WHY[source];

  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="grid min-w-0 grid-cols-3 gap-1.5">
        <legend className="sr-only">Niveau du jour</legend>
        {DAY_LEVELS.map((level) => {
          const pressed = current === level;
          return (
            <Button
              key={level}
              type="button"
              variant={pressed ? "secondary" : "outline"}
              aria-pressed={pressed}
              className={cn(
                "h-11 text-sm transition-transform active:scale-[0.96]",
                pressed && "border-primary/50 ring-1 ring-primary/30",
              )}
              onClick={() =>
                pressed
                  ? undefined
                  : runMutation(
                      () => setDayLevel({ date: today, level }),
                      `${DAY_NAME[level]} pour aujourd'hui.`,
                    )
              }
            >
              {LEVEL_LABEL[level]}
            </Button>
          );
        })}
      </fieldset>
      {why ? <p className="text-[11px] text-muted-foreground">{why}</p> : null}
    </div>
  );
}

/** 2 L: the round number people aim at, not a computed need. */
const WATER_TARGET = 2000;

function Hydration({ today, ml }: { today: string; ml: number }) {
  const setHydration = useMutation(api.nutrition.setHydration);
  const add = (delta: number) =>
    runMutation(
      () => setHydration({ date: today, ml: Math.max(0, ml + delta) }),
      "Hydratation notée.",
    );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-[1.05rem] font-bold">Hydratation</h2>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatNumber(ml / 1000, 1)}
          <span className="font-normal text-muted-foreground"> / 2</span> L
        </span>
      </div>
      <Progress
        value={pct(ml, WATER_TARGET)}
        className="[&_[data-slot=progress-indicator]]:bg-chart-3"
      />
      {/* Two taps for a glass and a bottle, and a way back for the mis-tap. The
          server clamps 0…6000. */}
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1 tabular-nums" onClick={() => add(250)}>
          + 25 cl
        </Button>
        <Button variant="outline" className="h-11 flex-1 tabular-nums" onClick={() => add(500)}>
          + 50 cl
        </Button>
        <Button
          variant="ghost"
          className="h-11 tabular-nums"
          disabled={ml === 0}
          onClick={() => add(-250)}
        >
          − 25 cl
        </Button>
      </div>
    </section>
  );
}
