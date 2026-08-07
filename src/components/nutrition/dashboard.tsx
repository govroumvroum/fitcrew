"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDownIcon, ClockIcon, CopyIcon, LockIcon, LockOpenIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFull, monday } from "@/lib/dates";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { MealSlot, PlannedMeal } from "../../../convex/nutrition";
import { FoodLog } from "./food-log";
import { MacroProgress, SLOT_LABELS, SLOT_ORDER, macroLine, pct, runMutation } from "./macros";

/**
 * /nutrition. Reads one subscription (`api.nutrition.dashboard`) for today's
 * plan, log, hydration and targets.
 *
 * This screen cannot generate anything: a menu comes out of the Chef's
 * `generate_meal_plan` tool, and replacing / moving / adapting a meal is natural
 * language. So every one of those is a link into /chef rather than a button that
 * would have to reimplement the agent. What it does own is the journal, the lock
 * toggle, hydration and the foyer card — four writes with no model in the loop.
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

          <Household household={data.household} />

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

/** The dashboard's `household` field. The card reads it from the page's one
 *  subscription rather than a second query: two subscriptions could disagree
 *  mid-render (same rule as the journal's `log` in food-log.tsx). */
type HouseholdStatus = {
  sharedSlots: MealSlot[];
  partnerName: string | null;
  pendingCode: string | null;
  partnerHasProfile: boolean;
  canShare: boolean;
};

/**
 * Repas à deux: one dish, two portions, each computed for its eater's targets.
 * The whole foyer lifecycle lives here — invite, join, shared slots, leave.
 * Every write goes through `runMutation` so the server's French message is the
 * one shown on failure, and the busy state keeps a second tap from racing the
 * first while the subscription catches up.
 */
function Household({ household }: { household: HouseholdStatus | null }) {
  const invite = useMutation(api.households.invite);
  const cancelInvite = useMutation(api.households.cancelInvite);
  const join = useMutation(api.households.join);
  const setSharedSlots = useMutation(api.households.setSharedSlots);
  const leave = useMutation(api.households.leave);

  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const id = useId();

  const guard = (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    runMutation(action, ok).finally(() => setBusy(false));
  };

  // No foyer yet: create an invite or enter one.
  if (!household) {
    return (
      <section className="flex flex-col gap-2.5">
        <div>
          <h2 className="text-[1.05rem] font-bold">Repas à deux</h2>
          <p className="text-sm text-muted-foreground">
            Un même plat cuisiné une fois, deux portions — chacune calculée pour vos objectifs.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            className="h-11"
            disabled={busy}
            onClick={() => guard(() => invite(), "Code créé, partage-le.")}
          >
            Créer un code d&apos;invitation
          </Button>
          <form
            className="flex flex-col gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = code.trim();
              if (!trimmed) return;
              setJoinError(null);
              setBusy(true);
              try {
                await join({ code: trimmed });
                setCode("");
                toast.success("Foyer créé !");
              } catch (err) {
                // The server's message ("Ce code n'est plus valide"…) stays
                // visible until the next attempt: a toast would vanish before
                // the user has typed the code again.
                setJoinError(err instanceof Error ? err.message : "Ça a raté, réessaie.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-code`} className="text-[11px] text-muted-foreground">
                Rejoindre avec un code
              </Label>
              <Input
                id={`${id}-code`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setJoinError(null);
                }}
                placeholder="ABC234"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={joinError !== null}
                className="h-11 text-base uppercase tracking-widest sm:text-sm"
              />
              {joinError ? <p className="text-[11px] text-destructive">{joinError}</p> : null}
            </div>
            <Button
              type="submit"
              variant="outline"
              className="h-11"
              disabled={busy || code.trim() === ""}
            >
              Rejoindre le foyer
            </Button>
          </form>
        </div>
      </section>
    );
  }

  // One member, an invite out. The code is only shown to its owner; the
  // code-less variant below exists for the foyer whose invite code was cleared
  // without a join — unreachable through the API, but the cancel is the way out.
  if (!household.partnerName) {
    return (
      <section className="flex flex-col gap-2.5">
        <div>
          <h2 className="text-[1.05rem] font-bold">Repas à deux</h2>
          <p className="text-sm text-muted-foreground">En attente de l&apos;autre personne.</p>
        </div>
        {household.pendingCode ? (
          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <p className="min-w-0 flex-1 text-center font-heading text-2xl font-bold tracking-[0.25em] tabular-nums">
              {household.pendingCode}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Copier le code d'invitation"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(household.pendingCode!);
                  toast.success("Code copié.");
                } catch {
                  toast.error("Impossible de copier le code.");
                }
              }}
            >
              <CopyIcon className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {household.pendingCode
            ? "L'autre personne entre ce code dans Repas à deux pour rejoindre."
            : "L'invitation n'a pas de code pour l'instant."}
        </p>
        <Button
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => guard(() => cancelInvite(), "Invitation annulée.")}
        >
          Annuler l&apos;invitation
        </Button>
      </section>
    );
  }

  // The foyer is complete: pick the slots the two eat together.
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[1.05rem] font-bold">Foyer — {household.partnerName}</h2>
        <p className="text-sm text-muted-foreground">
          Les repas des créneaux cochés se cuisinent une fois pour deux.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="eyebrow">Repas partagés</p>
        <div className="flex flex-wrap gap-2">
          {SLOT_ORDER.map((slot) => {
            const on = household.sharedSlots.includes(slot);
            return (
              <button
                key={slot}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  // When a slot is removed, the server copies its meals into
                  // both own plans before unsharing — nothing is orphaned.
                  runMutation(
                    () =>
                      setSharedSlots({
                        slots: on
                          ? household.sharedSlots.filter((s) => s !== slot)
                          : [...household.sharedSlots, slot],
                      }),
                    on ? "Créneau retiré du partage." : "Créneau partagé.",
                  ).finally(() => setBusy(false));
                }}
                className={cn(
                  "h-8 rounded-full border px-3 text-[11px] font-medium transition-colors active:scale-[0.96] disabled:opacity-50",
                  on
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground",
                )}
              >
                {SLOT_LABELS[slot]}
              </button>
            );
          })}
        </div>
      </div>

      {!household.partnerHasProfile ? (
        <p className="text-[11px] text-muted-foreground">
          Ton foyer est prêt, mais {household.partnerName} doit compléter son profil nutrition pour
          que les repas soient partagés.
        </p>
      ) : null}

      <Button
        variant="destructive"
        className="h-11"
        disabled={busy}
        onClick={() => {
          // ponytail: native confirm, like the séance's cancel. Leaving copies
          // the shared meals into both own plans server-side, so nobody loses a
          // dish — only the sharing.
          if (!window.confirm("Quitter le foyer ? Chacun garde ses repas, avec sa portion.")) return;
          guard(() => leave(), "Foyer quitté.");
        }}
      >
        Quitter le foyer
      </Button>
    </section>
  );
}

function Meals({
  meals,
  today,
  weekStart,
  hasPlan,
}: {
  meals: (PlannedMeal & { sharedWith?: string })[];
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow">{SLOT_LABELS[meal.slot]}</p>
                {meal.sharedWith ? (
                  <Badge variant="secondary" className="shrink-0">
                    Partagé avec {meal.sharedWith}
                  </Badge>
                ) : null}
              </div>
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
