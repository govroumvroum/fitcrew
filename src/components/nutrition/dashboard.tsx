"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDownIcon, ClockIcon, LockIcon, LockOpenIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull, monday } from "@/lib/dates";
import { formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { PlannedMeal } from "../../../convex/nutrition";
import { FoodLog } from "./food-log";
import { MacroProgress, SLOT_LABELS, macroLine, pct, runMutation } from "./macros";

/**
 * /nutrition. Reads one subscription (`api.nutrition.dashboard`) for today's
 * plan, log, hydration and targets.
 *
 * This screen cannot generate anything: a menu comes out of the Chef's
 * `generate_meal_plan` tool, and replacing / moving / adapting a meal is natural
 * language. So every one of those is a link into /chef rather than a button that
 * would have to reimplement the agent. What it does own is the journal, the lock
 * toggle and hydration — three writes with no model in the loop.
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
  // Same Monday the query computed server-side; the mutations key on it too, and
  // the backend rejects anything that isn't a Monday.
  const weekStart = monday(today);

  if (data === undefined) return <NutritionSkeleton />;

  const { profile, todayMeals, log, consumed, hydrationMl, hasPlan } = data;

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
            {profile ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="eyebrow">Aujourd&apos;hui · estimations</p>
                    <h2 className="font-heading text-[1.375rem] leading-tight font-bold">
                      {formatNumber(consumed.calories)} kcal sur{" "}
                      {formatNumber(profile.targets.calories)}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {GOALS[profile.goal]}
                  </Badge>
                </div>
                <MacroProgress consumed={consumed} targets={profile.targets} />
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
          </section>

          <Meals meals={todayMeals} today={today} weekStart={weekStart} hasPlan={hasPlan} />

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

function Meals({
  meals,
  today,
  weekStart,
  hasPlan,
}: {
  meals: PlannedMeal[];
  today: string;
  weekStart: string;
  hasPlan: boolean;
}) {
  const logPlannedMeal = useMutation(api.nutrition.logPlannedMeal);
  const toggleLock = useMutation(api.nutrition.toggleLock);

  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[1.05rem] font-bold">Repas prévus</h2>
        <p className="text-sm text-muted-foreground">
          {meals.length === 0
            ? hasPlan
              ? "Rien de prévu aujourd'hui dans ton menu."
              : "Pas encore de menu. Le Chef en écrit un pour la semaine."
            : "Valeurs estimées par repas. Verrouille ceux que tu gardes avant une régénération."}
        </p>
      </div>

      {meals.map((meal) => (
        // Concentric radii: rounded-xl with p-3 outside, rounded-md rows inside.
        <article key={meal.slot} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{SLOT_LABELS[meal.slot]}</p>
              <p className="font-heading font-semibold">{meal.name}</p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {macroLine(meal.macros)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label={meal.locked ? `Déverrouiller ${meal.name}` : `Verrouiller ${meal.name}`}
              aria-pressed={meal.locked === true}
              onClick={() =>
                runMutation(
                  () => toggleLock({ weekStart, date: today, slot: meal.slot }),
                  meal.locked
                    ? "Repas déverrouillé."
                    : "Repas verrouillé, il survit à une régénération.",
                )
              }
            >
              {meal.locked ? (
                <LockIcon className="size-4 text-accent-text" aria-hidden />
              ) : (
                <LockOpenIcon className="size-4 text-muted-foreground" aria-hidden />
              )}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ClockIcon className="size-3" aria-hidden />
              {meal.prepMinutes} min
            </span>
            {meal.mealPrep ? <span>{meal.mealPrep}</span> : null}
          </div>

          {/* Native <details>, like the coach's program cards: the recipe is what
              you open when you cook, not what you scan at 8h. */}
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium marker:hidden hover:bg-muted/60">
              <ChevronDownIcon className="chevron" />
              <span className="min-w-0 flex-1">La recette</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {meal.ingredients.length} ingrédient{meal.ingredients.length > 1 ? "s" : ""}
              </span>
            </summary>
            <ul className="mt-1">
              {meal.ingredients.map((ingredient) => (
                <li
                  key={ingredient.name}
                  className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm odd:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">{ingredient.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {ingredient.quantity}
                  </span>
                </li>
              ))}
            </ul>
            <ol className="mt-1 flex list-decimal flex-col gap-1 pl-6 text-sm">
              {meal.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              onClick={() =>
                runMutation(
                  () => logPlannedMeal({ date: today, slot: meal.slot, weekStart }),
                  "Ajouté au journal.",
                )
              }
            >
              <PlusIcon className="size-4" aria-hidden />
              Ajouter au journal
            </Button>
            {/* Remplacer, déplacer, "plus rapide", "sans poisson" — all one
                sentence to the Chef. A dropdown of canned alternatives here would
                be a worse version of the thing that can actually cook. */}
            <Button asChild variant="ghost" className="h-11">
              <Link href="/chef">Changer</Link>
            </Button>
          </div>
        </article>
      ))}
    </section>
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
