"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatWeekOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import { WeekToggle, useWeekParam } from "./week-plan";

/**
 * /nutrition/courses (#121): the shopping list of this week or the next, one
 * checkbox per line. Same consolidation as the Chef's `shopping_list`, so the
 * screen and the chat say the same thing. The ticks live on the server, per
 * user and week, so they survive a reload and follow him to another phone.
 */
export function ShoppingList({ today }: { today: string }) {
  const home = useQuery(api.nutrition.dashboard, { today });
  const { week, go } = useWeekParam(today, home?.hasPlanNextWeek ?? false);
  const data = useQuery(api.weekPlan.shoppingList, { today, week });
  const setCheck = useMutation(api.weekPlan.setShoppingCheck).withOptimisticUpdate(
    (store, args) => {
      const current = store.getQuery(api.weekPlan.shoppingList, { today, week });
      if (!current || current.weekStart !== args.weekStart) return;
      store.setQuery(
        api.weekPlan.shoppingList,
        { today, week },
        {
          ...current,
          items: current.items.map((item) =>
            item.key === args.key ? { ...item, checked: args.checked } : item,
          ),
        },
      );
    },
  );

  const done = data?.items.filter((item) => item.checked).length ?? 0;
  const weekOf = data ? formatWeekOf(data.weekStart) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <Link
          href="/nutrition"
          className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Nutrition
        </Link>
        <h1 className="text-[clamp(1.4rem,6vw,1.9rem)] font-bold">Liste de courses</h1>
        <p className="text-sm text-muted-foreground">
          {weekOf ? `Semaine du lundi ${weekOf}, tirée de ton menu.` : "Tirée de ton menu."} Coche
          au fur et à mesure : c&apos;est gardé, même sur un autre téléphone.
        </p>
      </header>

      <WeekToggle week={week} onChange={(next) => go({ week: next, day: null })} />

      {data === undefined ? (
        <Skeleton className="h-96" />
      ) : data.items.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">
            {data.hasPlan
              ? "Ton menu n'a aucun ingrédient cette semaine-là."
              : "Pas de menu pour cette semaine, donc pas de courses. Le Chef peut l'écrire."}
          </p>
          <Button asChild variant="outline" className="h-11 w-fit">
            <Link href="/chef">Demander au Chef</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {done} sur {data.items.length} dans le panier
          </p>
          <ul className="flex flex-col overflow-hidden rounded-xl border bg-card">
            {data.items.map((item) => (
              <li key={item.key} className="border-b last:border-b-0">
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 active:bg-muted/60">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={item.checked}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCheck({ weekStart: data.weekStart, key: item.key, checked }).catch(() =>
                        toast.error("Ça a raté, réessaie."),
                      );
                    }}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                      item.checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/50",
                    )}
                  >
                    {item.checked ? <CheckIcon className="size-4" strokeWidth={3} /> : null}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 first-letter:uppercase",
                      item.checked && "text-muted-foreground line-through",
                    )}
                  >
                    {item.name}
                  </span>
                  {item.quantities.length > 0 ? (
                    <span
                      className={cn(
                        "max-w-[45%] shrink-0 text-right text-sm text-muted-foreground tabular-nums",
                        item.checked && "line-through",
                      )}
                    >
                      {item.quantities.join(" + ")}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ShoppingListSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-11" />
      <Skeleton className="h-96" />
    </div>
  );
}
