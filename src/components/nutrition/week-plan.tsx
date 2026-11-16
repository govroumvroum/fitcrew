"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronRightIcon,
  CookingPotIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  ShoppingCartIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull, formatShort } from "@/lib/dates";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { MealSlot } from "../../../convex/nutrition";
import { type PlanWeek, defaultPlanWeek, planWeeks } from "../../../convex/planWeeks";
import {
  batchLeftover,
  logOptions,
  portionLine,
  shareLabel,
} from "../../../convex/portionLogic";
import { type DayLevel, LEVEL_LABEL } from "../../../convex/weekTemplate";
import { SLOT_LABELS, runMutation } from "./macros";
import { RecipeCard, RecipeSheet, libraryEyebrow, usePhotoLookup } from "./recipe-card";

type Week = FunctionReturnType<typeof api.weekPlan.week>;
type Day = Week["days"][number];
type Meal = Day["meals"][number];
type Batch = Week["batches"][number];

/**
 * The week, in the URL: `?semaine=prochaine&jour=2026-11-19`. Never local
 * state — /nutrition stays mounted between navigations (cacheComponents puts it
 * on <Activity>), so a remembered day would outlive the week it belongs to.
 */
const WEEK_PARAM: Record<PlanWeek, string> = { current: "en-cours", next: "prochaine" };

export const WEEK_TABS: { value: PlanWeek; label: string }[] = [
  { value: "current", label: "Cette semaine" },
  { value: "next", label: "Semaine prochaine" },
];

/**
 * The week the URL asks for, else the Chef's default: Friday to Sunday it's
 * the next one, when it has a plan — the shopping is for Monday. Earlier in the
 * week, the current one.
 */
export function useWeekParam(today: string, hasPlanNextWeek: boolean) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get("semaine");
  const week: PlanWeek =
    asked === WEEK_PARAM.next
      ? "next"
      : asked === WEEK_PARAM.current
        ? "current"
        : defaultPlanWeek(today) === "next" && hasPlanNextWeek
          ? "next"
          : "current";

  const go = (next: { week?: PlanWeek; day?: string | null }) => {
    const search = new URLSearchParams(params.toString());
    search.set("semaine", WEEK_PARAM[next.week ?? week]);
    if (next.day) search.set("jour", next.day);
    else search.delete("jour");
    router.replace(`${pathname}?${search}`, { scroll: false });
  };
  return { week, day: params.get("jour"), go, param: WEEK_PARAM[week] };
}

/** « Cette semaine / Semaine prochaine », above the days and on the shopping list. */
export function WeekToggle({
  week,
  onChange,
}: {
  week: PlanWeek;
  onChange: (week: PlanWeek) => void;
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-2 gap-1.5">
      <legend className="sr-only">Semaine</legend>
      {WEEK_TABS.map((tab) => {
        const pressed = tab.value === week;
        return (
          <Button
            key={tab.value}
            type="button"
            variant={pressed ? "secondary" : "outline"}
            aria-pressed={pressed}
            className={cn(
              "h-11 text-sm transition-transform active:scale-[0.96]",
              pressed && "border-primary/50 ring-1 ring-primary/30",
            )}
            onClick={() => !pressed && onChange(tab.value)}
          >
            {tab.label}
          </Button>
        );
      })}
    </fieldset>
  );
}

const LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAME: Record<DayLevel, string> = {
  off: "Jour off",
  leger: "Jour léger",
  dur: "Jour dur",
};

/**
 * /nutrition's week (#121): this week and the next, seven day tabs, each
 * planned meal as a recipe card. The meal's own actions sit under its card:
 * the lock, « Changer » (a library recipe, no model) and, for today, « Ajouter
 * au journal ». Inventing something new is still the Chef's.
 */
export function WeekPlan({ today, hasPlanNextWeek }: { today: string; hasPlanNextWeek: boolean }) {
  const { week, day: askedDay, go, param } = useWeekParam(today, hasPlanNextWeek);
  const data = useQuery(api.weekPlan.week, { today, week });
  usePhotoLookup(data?.days.flatMap((d) => d.meals));

  const weekStart = planWeeks(today)[week];
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${weekStart}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  );
  // A `jour` from the other week (or a stale link) falls back: today in the
  // current week, Monday in the next.
  const selected =
    askedDay && dates.includes(askedDay) ? askedDay : dates.includes(today) ? today : dates[0];
  const day = data?.days.find((d) => d.date === selected);

  return (
    <section id="semaine" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-[1.05rem] font-bold">Menu de la semaine</h2>
        <Link
          href={`/nutrition/courses?semaine=${param}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent-text"
        >
          <ShoppingCartIcon className="size-4" aria-hidden />
          Courses
        </Link>
      </div>

      {/* Stacked on a phone; one control bar at xl, where the column is wide
          enough that seven day tabs stretched across it would be 120 px each. */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
        <div className="xl:w-72 xl:shrink-0">
          <WeekToggle week={week} onChange={(next) => go({ week: next, day: null })} />
        </div>

        <fieldset className="grid min-w-0 grid-cols-7 gap-1 xl:flex-1">
          <legend className="sr-only">Jour</legend>
          {dates.map((date, i) => {
            const pressed = date === selected;
            const planned = (data?.days[i]?.meals.length ?? 0) > 0;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={pressed}
                aria-label={`${formatFull(date)}${date === today ? ", aujourd'hui" : ""}${planned ? "" : ", rien de prévu"}`}
                onClick={() => go({ day: date })}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm transition-[transform,border-color] active:scale-[0.94]",
                  pressed
                    ? "border-primary/50 bg-secondary font-semibold ring-1 ring-primary/30"
                    : "bg-card hover:border-muted-foreground/40",
                  date === today && !pressed && "border-accent-text/60",
                )}
              >
                <span className={cn("text-[11px]", !pressed && "text-muted-foreground")}>
                  {LETTERS[i]}
                </span>
                <span className="tabular-nums">{Number(date.slice(8))}</span>
                <span
                  aria-hidden
                  className={cn(
                    "size-1 rounded-full",
                    planned ? "bg-accent-text" : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </fieldset>
      </div>

      {data === undefined || !day ? (
        <Skeleton className="h-96" />
      ) : (
        <DayMeals
          day={day}
          days={data.days}
          batches={data.batches}
          today={today}
          weekStart={data.weekStart}
          hasPlan={data.hasPlan}
          week={week}
        />
      )}
    </section>
  );
}

function DayMeals({
  day,
  days,
  batches,
  today,
  weekStart,
  hasPlan,
  week,
}: {
  day: Day;
  days: Day[];
  // Absent on a server from before #138 for one deploy at most; read as none.
  batches: Batch[] | undefined;
  today: string;
  weekStart: string;
  hasPlan: boolean;
  week: PlanWeek;
}) {
  const planned = day.meals.reduce((sum, meal) => sum + meal.macros.calories, 0);
  const cooked = (batches ?? []).filter((b) => b.cookDate === day.date);
  const potName = (id: string) => batches?.find((b) => b.id === id)?.name ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-heading font-semibold first-letter:uppercase">
          {formatFull(day.date)}
          {day.date === today ? " · aujourd'hui" : ""}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {[
            day.level !== null ? `${DAY_NAME[day.level]} (${LEVEL_LABEL[day.level]})` : null,
            day.targets ? `objectif ${formatNumber(day.targets.calories)} kcal` : null,
            day.meals.length > 0 ? `prévu ${formatNumber(planned)} kcal` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Valeurs estimées."}
        </p>
      </div>

      {cooked.map((batch) => (
        <BatchCard key={batch.id} batch={batch} days={days} />
      ))}

      {day.meals.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            {hasPlan
              ? "Pas de menu ce jour-là."
              : week === "next"
                ? "Pas encore de menu pour la semaine prochaine."
                : "Pas encore de menu cette semaine."}
          </p>
          <Button asChild variant="outline" className="h-11 w-fit">
            <Link href="/chef">Demander au Chef</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {day.meals.map((meal) => (
            <li key={meal.slot}>
              <MealCard
                meal={meal}
                date={day.date}
                today={today}
                weekStart={weekStart}
                potName={meal.batch ? potName(meal.batch.id) : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MealCard({
  meal,
  date,
  today,
  weekStart,
  potName,
}: {
  meal: Meal;
  date: string;
  today: string;
  weekStart: string;
  potName: string | null;
}) {
  const [open, setOpen] = useState<"recipe" | "swap" | "log" | null>(null);
  const toggleLock = useMutation(api.nutrition.toggleLock);
  const locked = meal.locked === true;
  // #138, decision A: the share of the pot, then the grams as an estimate.
  const portion = meal.batch ? (
    <p className="text-[11px] text-muted-foreground tabular-nums">
      {portionLine(meal.batch)}
      {potName ? ` (${potName})` : ""} — estimation
    </p>
  ) : null;

  return (
    <>
      <RecipeCard
        recipe={meal}
        eyebrow={`${SLOT_LABELS[meal.slot]}${locked ? " · verrouillé" : ""}`}
        onOpen={() => setOpen("recipe")}
        footer={
          <div className="flex flex-col gap-1.5">
            {portion}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={locked ? `Déverrouiller ${meal.name}` : `Verrouiller ${meal.name}`}
                aria-pressed={locked}
                onClick={() =>
                  runMutation(
                    () => toggleLock({ weekStart, date, slot: meal.slot }),
                    locked
                      ? "Repas déverrouillé."
                      : "Repas verrouillé, il survit à une régénération.",
                  )
                }
              >
                {locked ? (
                  <LockIcon className="size-4 text-accent-text" aria-hidden />
                ) : (
                  <LockOpenIcon className="size-4 text-muted-foreground" aria-hidden />
                )}
              </Button>
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={locked}
                aria-haspopup="dialog"
                onClick={() => setOpen("swap")}
              >
                Changer
              </Button>
              {/* The journal is today's: logging Thursday's dinner on Monday
                  would count it today. */}
              {date === today ? (
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  aria-haspopup="dialog"
                  onClick={() => setOpen("log")}
                >
                  <PlusIcon className="size-4" aria-hidden />
                  Journal
                </Button>
              ) : null}
            </div>
            {locked ? (
              <p className="text-[11px] text-muted-foreground">
                Verrouillé : il reste tel quel. Déverrouille-le pour le changer.
              </p>
            ) : null}
          </div>
        }
      />
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        {open === "recipe" ? (
          <RecipeSheet recipe={meal} eyebrow={`${SLOT_LABELS[meal.slot]} · ${formatFull(date)}`}>
            {portion}
            {meal.mealPrep ? (
              <p className="text-sm text-muted-foreground">{meal.mealPrep}</p>
            ) : null}
          </RecipeSheet>
        ) : open === "swap" ? (
          <SwapSheet meal={meal} date={date} weekStart={weekStart} onDone={() => setOpen(null)} />
        ) : open === "log" ? (
          <LogSheet meal={meal} date={date} weekStart={weekStart} onDone={() => setOpen(null)} />
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * « Changer »: three library recipes for this slot at close kcal, picked and
 * allergy-checked by the server. One tap writes — no model. Below them, the
 * Chef, for anything the library doesn't have.
 */
function SwapSheet({
  meal,
  date,
  weekStart,
  onDone,
}: {
  meal: Meal;
  date: string;
  weekStart: string;
  onDone: () => void;
}) {
  const slot: MealSlot = meal.slot;
  const candidates = useQuery(api.weekPlan.swapCandidates, { weekStart, date, slot });
  const swapMeal = useMutation(api.weekPlan.swapMeal);
  const [busy, setBusy] = useState(false);
  usePhotoLookup(candidates);

  const swap = async (recipeId: NonNullable<typeof candidates>[number]["_id"], name: string) => {
    setBusy(true);
    try {
      const result = await swapMeal({ weekStart, date, slot, recipeId });
      if (result.result === "ok") {
        toast.success(`${SLOT_LABELS[slot]} : ${name}.`);
        onDone();
      } else toast.error(result.note);
    } catch {
      toast.error("Ça a raté, réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const delta = (calories: number) => {
    const d = calories - meal.macros.calories;
    return d === 0 ? "mêmes kcal" : `${d > 0 ? "+" : "−"}${formatNumber(Math.abs(d))} kcal`;
  };

  return (
    <DialogContent className="flex max-h-[88dvh] flex-col gap-3 overflow-y-auto sm:max-w-md">
      <div className="flex flex-col gap-1 pr-10">
        <DialogTitle className="text-xl leading-tight font-bold">
          Changer : {SLOT_LABELS[slot].toLowerCase()}
        </DialogTitle>
        <DialogDescription>
          À la place de {meal.name} ({formatNumber(meal.macros.calories)} kcal), une recette de ta
          bibliothèque. Un tap, c&apos;est remplacé.
        </DialogDescription>
      </div>

      {candidates === undefined ? (
        <Skeleton className="h-72" />
      ) : candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Aucune recette de ta bibliothèque ne convient pour ce créneau.
        </p>
      ) : (
        <ul className={cn("flex flex-col gap-3", busy && "pointer-events-none opacity-60")}>
          {candidates.map((recipe) => (
            <li key={recipe._id}>
              <RecipeCard
                recipe={recipe}
                eyebrow={`${libraryEyebrow(recipe)} · ${delta(recipe.macros.calories)}`}
                label={`Remplacer par ${recipe.name}`}
                opensDialog={false}
                summary={false}
                onOpen={() => void swap(recipe._id, recipe.name)}
              />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/chef"
        className="flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm transition-transform active:scale-[0.98]"
      >
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Autre chose ?</span>{" "}
          <span className="text-muted-foreground">Demande au Chef.</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </DialogContent>
  );
}

/**
 * « J'ai mangé » (#138, decision B): as planned, or a bit less or more. A dish
 * built on pieces moves by one whole piece; anything else by a quarter. The
 * journal gets the plan's macros × the factor — the plan itself never moves.
 */
function LogSheet({
  meal,
  date,
  weekStart,
  onDone,
}: {
  meal: Meal;
  date: string;
  weekStart: string;
  onDone: () => void;
}) {
  const logPlannedMeal = useMutation(api.nutrition.logPlannedMeal);
  const options = logOptions(meal);
  const [factor, setFactor] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = options.find((o) => o.factor === factor) ?? options[0];

  const log = async () => {
    setBusy(true);
    await runMutation(
      () =>
        logPlannedMeal({
          date,
          slot: meal.slot,
          weekStart,
          // Absent when as planned: the entry reads exactly as before #138.
          ...(factor !== 1 && { factor, quantity: chosen.label }),
        }),
      "Ajouté au journal.",
    );
    setBusy(false);
    onDone();
  };

  return (
    <DialogContent className="flex flex-col gap-3 sm:max-w-md">
      <div className="flex flex-col gap-1 pr-10">
        <DialogTitle className="text-xl leading-tight font-bold">J&apos;ai mangé</DialogTitle>
        <DialogDescription>
          {meal.name}. Si tu en as pris plus ou moins, dis-le : le journal suit, le menu ne change
          pas.
        </DialogDescription>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">Quantité mangée</legend>
        {options.map((option) => {
          const pressed = option.factor === factor;
          return (
            <Button
              key={option.label}
              type="button"
              variant={pressed ? "secondary" : "outline"}
              aria-pressed={pressed}
              className={cn(
                "h-12 justify-between px-3 text-sm",
                pressed && "border-primary/50 ring-1 ring-primary/30",
              )}
              onClick={() => setFactor(option.factor)}
            >
              <span className="first-letter:uppercase">{option.label}</span>
              <span className="text-muted-foreground tabular-nums">
                ≈ {formatNumber(Math.round(meal.macros.calories * option.factor))} kcal
              </span>
            </Button>
          );
        })}
      </fieldset>
      <Button className="h-11" disabled={busy} onClick={() => void log()}>
        <PlusIcon className="size-4" aria-hidden />
        Ajouter au journal
      </Button>
      <p className="text-[11px] text-muted-foreground">Valeurs estimées.</p>
    </DialogContent>
  );
}

/**
 * The pot to cook on its day (#138): the whole pot, and how it's shared out
 * over the week — the share each meal takes, its cooked grams as an estimate,
 * and what's left. Its recipe opens in a sheet.
 */
function BatchCard({ batch, days }: { batch: Batch; days: Day[] }) {
  const [open, setOpen] = useState(false);
  const eaters = days.flatMap((d) =>
    d.meals.filter((m) => m.batch?.id === batch.id).map((m) => ({ date: d.date, meal: m })),
  );
  const leftover = batchLeftover(batch.id, days);

  return (
    <section
      aria-label={`Batch à cuisiner : ${batch.name}`}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <div className="flex items-start gap-2">
        <CookingPotIcon className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Batch · à cuisiner ce jour-là</p>
          <p className="font-heading leading-tight font-semibold">{batch.name}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            ≈ {formatNumber(batch.macros.calories)} kcal la marmite
            {batch.cookedGrams ? ` · ≈ ${formatNumber(batch.cookedGrams)} g cuit` : ""}
          </p>
        </div>
      </div>
      <ul className="flex flex-col">
        {eaters.map(({ date, meal }) => (
          <li
            key={`${date}-${meal.slot}`}
            className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm odd:bg-muted/40"
          >
            <span className="min-w-0 flex-1 first-letter:uppercase">
              {formatShort(date)} · {SLOT_LABELS[meal.slot].toLowerCase()}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {shareLabel(meal.batch!.share)}
              {meal.batch!.cookedGrams ? ` · ≈ ${meal.batch!.cookedGrams} g` : ""}
            </span>
          </li>
        ))}
        {leftover >= 0.05 ? (
          <li className="flex items-baseline gap-2 px-2 py-1 text-sm">
            <span className="min-w-0 flex-1 text-muted-foreground">Reste</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {shareLabel(leftover)}, à garder au frais ou congeler
            </span>
          </li>
        ) : null}
      </ul>
      <Button variant="outline" className="h-11" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Recette de la marmite
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent className="flex max-h-[88dvh] flex-col gap-3 overflow-y-auto sm:max-w-md">
            <div className="flex flex-col gap-1 pr-10">
              <p className="eyebrow">Batch · {formatFull(batch.cookDate)}</p>
              <DialogTitle className="text-xl leading-tight font-bold">{batch.name}</DialogTitle>
              <DialogDescription>
                Pour toute la marmite, pour toi seul. Les parts sont sur la fiche de chaque repas.
              </DialogDescription>
            </div>
            <section className="flex flex-col gap-1">
              <h3 className="font-semibold">Ingrédients</h3>
              <ul>
                {batch.ingredients.map((ingredient) => (
                  <li
                    key={`${ingredient.name}:${ingredient.quantity}`}
                    className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm odd:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 first-letter:uppercase">{ingredient.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {ingredient.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-1">
              <h3 className="font-semibold">Préparation</h3>
              <ol className="flex list-decimal flex-col gap-1 pl-6 text-sm">
                {batch.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
