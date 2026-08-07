"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  DumbbellIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  StretchHorizontalIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
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
import type { Id } from "../../../convex/_generated/dataModel";
import type { ChifoumiThrow } from "../../../convex/households";
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
  /** The foyer's state, not derived from display strings — the UI branches on
   *  this, and a partner's name can legitimately be empty. */
  complete: boolean;
  sharedSlots: MealSlot[];
  partnerName: string | null;
  pendingCode: string | null;
  partnerHasProfile: boolean;
  canShare: boolean;
  /** Le compteur du chifoumi, une entrée par membre ayant joué. */
  chifoumiScore: { userId: string; wins: number }[];
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
  const me = useQuery(api.users.me);

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
  if (!household.complete) {
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
  const partnerName = household.partnerName?.trim() || "Ton partenaire";
  const myWins =
    household.chifoumiScore.find((entry) => entry.userId === me?._id)?.wins ?? 0;
  const partnerWins =
    household.chifoumiScore.find((entry) => entry.userId !== me?._id)?.wins ?? 0;
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[1.05rem] font-bold">Foyer — {partnerName}</h2>
        <p className="text-sm text-muted-foreground">
          Les repas des créneaux cochés se cuisinent une fois pour deux.
        </p>
      </div>

      {/* Le compteur du chifoumi : +1 au gagnant à chaque duel tranché. */}
      <div className="flex items-center justify-between rounded-xl border bg-card px-3 py-2">
        <p className="eyebrow">Chifoumi</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {me?.name?.split(" ")[0] ?? "Toi"} <span className="font-bold text-foreground">{myWins}</span>
          <span className="mx-1.5">·</span>
          {partnerName} <span className="font-bold text-foreground">{partnerWins}</span>
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
          Ton foyer est prêt, mais {partnerName} doit compléter son profil nutrition pour que les
          repas soient partagés.
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
          if (!window.confirm("Quitter le foyer ? Chacun garde ses repas, avec sa portion."))
            return;
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
  // La bannière « duel tranché » : le duel disparaît des données au moment où
  // il se résout, l'état local la maintient encore quelques secondes.
  const [resolved, setResolved] = useState<{ slot: MealSlot; dish: string } | null>(null);

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

      {meals.map((meal) => {
        const resolvedDish = resolved?.slot === meal.slot ? resolved.dish : null;
        // Le spread resserre `duel` à sa valeur non-optionnelle : le branchement
        // ne suffit pas à TypeScript pour ce prop.
        const duelMeal = meal.duel ? { ...meal, duel: meal.duel } : null;
        return duelMeal ? (
          <DuelCard
            key={meal.slot}
            meal={duelMeal}
            today={today}
            weekStart={weekStart}
            onResolved={(dish) => {
              setResolved({ slot: meal.slot, dish });
              setTimeout(
                () => setResolved((r) => (r?.slot === meal.slot && r.dish === dish ? null : r)),
                6000,
              );
            }}
          />
        ) : (
          <MealCard
            key={meal.slot}
            meal={meal}
            today={today}
            weekStart={weekStart}
            resolvedDish={resolvedDish}
          />
        );
      })}
    </section>
  );
}

function MealCard({
  meal,
  today,
  weekStart,
  resolvedDish,
}: {
  meal: PlannedMeal & { sharedWith?: string };
  today: string;
  weekStart: string;
  resolvedDish: string | null;
}) {
  const logPlannedMeal = useMutation(api.nutrition.logPlannedMeal);
  const toggleLock = useMutation(api.nutrition.toggleLock);

  return (
    // Concentric radii: rounded-xl with p-3 outside, rounded-md rows inside.
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      {resolvedDish ? (
        <p className="rounded-md bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary">
          Le duel est tranché : {resolvedDish}
        </p>
      ) : null}
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
          <p className="text-[11px] text-muted-foreground tabular-nums">{macroLine(meal.macros)}</p>
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

      <RecipeAccordion ingredients={meal.ingredients} steps={meal.steps} />

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
  );
}

/** La recette en accordéon : ingrédients et étapes, ouverte quand on cuisine.
 *  Native <details>, like the coach's program cards — shared by the meal card
 *  and the two halves of a duel. */
function RecipeAccordion({
  ingredients,
  steps,
}: {
  ingredients: { name: string; quantity: string }[];
  steps: string[];
}) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium marker:hidden hover:bg-muted/60">
        <ChevronDownIcon className="chevron" />
        <span className="min-w-0 flex-1">La recette</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {ingredients.length} ingrédient{ingredients.length > 1 ? "s" : ""}
        </span>
      </summary>
      <ul className="mt-1">
        {ingredients.map((ingredient) => (
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
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

/** Comme runMutation, mais le message de succès est décidé par le retour de la
 *  mutation : voter peut trancher le duel, lancer peut faire égalité. */
async function runDuelMutation(action: () => Promise<string>, fallback: string) {
  try {
    toast.success((await action()) || fallback);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Ça a raté, réessaie.");
  }
}

type DuelMeal = PlannedMeal & { sharedWith?: string } & { duel: NonNullable<PlannedMeal["duel"]> };

/**
 * Un créneau partagé en duel : deux plats s'affrontent, chaque membre vote, et
 * le duel se tranche par un accord ou par le chifoumi. Tout est piloté par la
 * souscription — les mutations sont poussées ici, l'état (vote, lancer) vient
 * des données — et le composant redevient une carte normale dès que le duel
 * disparaît. Pas de verrou, pas de journal, pas de « Changer » : le créneau
 * n'a pas encore de plat choisi.
 */
function DuelCard({
  meal,
  today,
  weekStart,
  onResolved,
}: {
  meal: DuelMeal;
  today: string;
  weekStart: string;
  onResolved: (dish: string) => void;
}) {
  const me = useQuery(api.users.me);
  const voteDuel = useMutation(api.households.voteDuel);
  const resolveDuel = useMutation(api.households.resolveDuel);
  const chifoumiThrow = useMutation(api.households.chifoumiThrow);

  const [busy, setBusy] = useState(false);
  // Passer au chifoumi est un choix local : le serveur ne le dit nulle part. Le
  // lancer du partenaire (duelThrows non vide) suffit aussi à y basculer.
  const [chifoumi, setChifoumi] = useState(false);
  // Une égalité efface les deux lancers des données : le « relancez » ne peut
  // venir que du retour de la mutation, il vit ici jusqu'au prochain lancer.
  const [tied, setTied] = useState(false);

  const myId = me?._id;
  const partnerName = meal.sharedWith ?? "Ton partenaire";
  const myName = me?.name?.trim() || "Toi";

  const votes = meal.duelVotes ?? [];
  const myVote = votes.find((vote) => vote.userId === myId);
  const partnerVote = votes.find((vote) => vote.userId !== myId);
  const throws = meal.duelThrows ?? [];
  const myThrow = throws.find((t) => t.userId === myId);
  const partnerThrow = throws.find((t) => t.userId !== myId);

  const bothVoted = votes.length === 2;
  const conflict = bothVoted && myVote?.choice !== partnerVote?.choice;
  const throwPhase = chifoumi || throws.length > 0;

  const proposerName = (proposedBy: Id<"users"> | undefined) =>
    proposedBy === undefined ? "le Chef" : proposedBy === myId ? myName : partnerName;

  const guard = (action: () => Promise<string>, fallback: string) => {
    setBusy(true);
    runDuelMutation(action, fallback).finally(() => setBusy(false));
  };

  const vote = (choice: "a" | "b") =>
    guard(async () => {
      const result = await voteDuel({ weekStart, date: today, slot: meal.slot, choice });
      if (result.resolved === true) {
        const winner = result.winner === "a" ? meal.name : meal.duel.vs.name;
        onResolved(winner);
        return `Le duel est tranché : ${winner}`;
      }
      return result.resolved === false
        ? "Votes contraires — il faut trancher."
        : "Ton choix est noté.";
    }, "Ton choix est noté.");

  const split = () =>
    guard(
      () => resolveDuel({ weekStart, date: today, slot: meal.slot }).then(() => ""),
      "Repas séparé — chacun son plat.",
    );

  const throwGesture = (gesture: ChifoumiThrow) => {
    setTied(false);
    guard(async () => {
      const result = await chifoumiThrow({
        weekStart,
        date: today,
        slot: meal.slot,
        throw: gesture,
      });
      if (result.resolved === true) {
        // Si je suis le second à lancer, le lancer du partenaire est dans les
        // données ; sinon son geste est inconnu et le plat gagnant suffit.
        if (partnerThrow) {
          const winnerName = result.winnerMemberId === myId ? myName : partnerName;
          return `${myName} a lancé ${gesture}, ${partnerName} a lancé ${partnerThrow.throw} — ${winnerName} gagne !`;
        }
        const winner = result.winner === "a" ? meal.name : meal.duel.vs.name;
        return `Le duel est tranché : ${winner}`;
      }
      if (result.tied) {
        setTied(true);
        return "Égalité — relancez !";
      }
      return "Lancer envoyé !";
    }, "Lancer envoyé !");
  };

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow">{SLOT_LABELS[meal.slot]}</p>
        {meal.sharedWith ? (
          <Badge variant="secondary" className="shrink-0">
            Partagé avec {meal.sharedWith}
          </Badge>
        ) : null}
      </div>
      <div>
        <p className="font-heading font-semibold">Duel de recettes</p>
        <p className="text-[11px] text-muted-foreground">
          Chacun propose un plat — le gagnant sera sur le créneau.
        </p>
      </div>

      {throwPhase ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-medium">Chifoumi — le gagnant impose son plat.</p>
            {tied ? (
              <p className="text-[11px] font-medium text-destructive">Égalité — relancez !</p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CHIFOUMI_GESTURES.map(({ gesture, label, icon }) => (
              <ThrowButton
                key={gesture}
                label={label}
                icon={icon}
                selected={myThrow?.throw === gesture}
                disabled={busy || myThrow !== undefined}
                onClick={() => throwGesture(gesture)}
              />
            ))}
          </div>
          {myThrow && !partnerThrow ? (
            <p className="text-[11px] text-muted-foreground">
              En attente du lancer de {partnerName}.
            </p>
          ) : null}
        </div>
      ) : conflict ? (
        <div className="flex flex-col gap-2.5 rounded-xl border bg-background p-3">
          <div>
            <p className="text-sm font-medium">Votes contraires.</p>
            <p className="text-[11px] text-muted-foreground">
              {myName} veut {meal.name}, {partnerName} veut {meal.duel.vs.name}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={split}>
              Séparer le repas
            </Button>
            <Button className="h-11 flex-1" disabled={busy} onClick={() => setChifoumi(true)}>
              Chifoumi
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Empilées sur mobile (390 px), côte à côte à partir de sm. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <DuelDish
              label="Plat A"
              dish={meal}
              proposer={proposerName(meal.proposedBy)}
              selected={myVote?.choice === "a"}
              disabled={busy}
              onChoose={() => vote("a")}
            />
            <DuelDish
              label="Plat B"
              dish={meal.duel.vs}
              proposer={proposerName(meal.duel.proposedBy)}
              selected={myVote?.choice === "b"}
              disabled={busy}
              onChoose={() => vote("b")}
            />
          </div>
          {myVote && !partnerVote ? (
            <p className="text-[11px] text-muted-foreground">
              En attente du vote de {partnerName}.
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

/** Une moitié du duel : la recette du plat et son bouton de vote. */
function DuelDish({
  label,
  dish,
  proposer,
  selected,
  disabled,
  onChoose,
}: {
  label: string;
  dish: Pick<PlannedMeal, "name" | "macros" | "ingredients" | "steps" | "prepMinutes" | "mealPrep">;
  proposer: string;
  selected: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-3">
      <div>
        <p className="eyebrow">{label}</p>
        <p className="font-heading font-semibold">{dish.name}</p>
      </div>
      <p className="text-[11px] text-muted-foreground">Proposé par {proposer}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums">{macroLine(dish.macros)}</p>
      <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ClockIcon className="size-3" aria-hidden />
          {dish.prepMinutes} min
        </span>
        {dish.mealPrep ? <span>{dish.mealPrep}</span> : null}
      </div>
      <RecipeAccordion ingredients={dish.ingredients} steps={dish.steps} />
      <Button
        variant={selected ? "default" : "outline"}
        className="h-10 w-full"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onChoose}
      >
        {selected ? "Ton choix" : "Je choisis ça"}
      </Button>
    </div>
  );
}

/** Un geste de chifoumi : icône au-dessus du libellé, en salle de sport. */
function ThrowButton({
  label,
  icon,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-medium transition-colors active:scale-[0.96] disabled:opacity-50",
        selected
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-input text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** La corde à sauter du chifoumi : un arc de corde et ses deux poignées. Pas
 *  d'icône de corde dans lucide — dessinée à la main, même grammaire visuelle
 *  que les icônes lucide (stroke, currentColor). */
function RopeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="size-7"
      aria-hidden
    >
      <path d="M4.5 4.5 8.5 7" />
      <path d="M19.5 4.5 15.5 7" />
      <path d="M8.5 7c0 7.5 7 7.5 7 0" />
    </svg>
  );
}

/** Pierre, papier, ciseaux en version salle de sport : haltère, yoga, corde. */
const CHIFOUMI_GESTURES = [
  { gesture: "pierre", label: "Pierre", icon: <DumbbellIcon className="size-7" aria-hidden /> },
  {
    gesture: "papier",
    label: "Papier",
    icon: <StretchHorizontalIcon className="size-7" aria-hidden />,
  },
  { gesture: "ciseaux", label: "Ciseaux", icon: <RopeIcon /> },
] as const satisfies readonly { gesture: ChifoumiThrow; label: string; icon: ReactNode }[];

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
