"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import {
  FILTERS,
  type RecipeFilter,
  type RecipeSort,
  SORTS,
  matchesFilter,
  proteinDensity,
  sortRecipes,
} from "../../../convex/recipeLogic";
import { RecipeCard, RecipeSheet, usePhotoLookup } from "./recipe-card";

type Recipe = FunctionReturnType<typeof api.recipes.library>[number];

/**
 * /nutrition/recettes: the user's own recipes (every meal the Chef wrote into a
 * plan) and the shared « sèche » catalogue, as diet's cards — photo, time, kcal,
 * protein, the protein-per-100-kcal bar. Filters, sorts, and a sheet with the
 * ingredients and steps.
 *
 * Read-only: no editing, no favourites (out of scope, #119). What the server
 * returns is already cleared against the user's allergies and exclusions.
 */
export function RecipeLibrary() {
  const [filter, setFilter] = useState<RecipeFilter>("all");
  const [sort, setSort] = useState<RecipeSort>("recent");
  const [openId, setOpenId] = useState<Recipe["_id"] | null>(null);

  // A shelf goes through the server's category index; « Cheat » and « Tout »
  // read everything. While the new answer is on its way, the previous one is
  // filtered client-side, so a tap never flashes a skeleton.
  const category = filter === "all" || filter === "cheat" ? undefined : filter;
  const fresh = useQuery(api.recipes.library, category ? { category } : {});
  const [last, setLast] = useState(fresh);
  if (fresh !== undefined && fresh !== last) setLast(fresh);
  const data = fresh ?? last;

  usePhotoLookup(data);
  // The live row, not a snapshot from the click: a photo resolved while the
  // sheet is open has to reach it.
  const open = data?.find((r) => r._id === openId) ?? null;

  if (data === undefined) return <RecipesSkeleton />;

  const shown = sortRecipes(
    data.filter((r) => matchesFilter(r, filter)),
    sort,
  );
  // diet's bar is relative to the densest recipe on screen.
  const maxDensity = Math.max(0, ...shown.map((r) => proteinDensity(r.macros)));

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
        <h1 className="text-[clamp(1.4rem,6vw,1.9rem)] font-bold">Recettes</h1>
        <p className="text-sm text-muted-foreground">
          Celles que le Chef t&apos;a cuisinées et le catalogue sèche. Calories et macros sont des
          estimations.
        </p>
      </header>

      <div className="flex flex-col gap-2.5">
        <fieldset className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          <legend className="sr-only">Filtrer les recettes</legend>
          {FILTERS.map((f) => {
            const pressed = f.value === filter;
            return (
              <Button
                key={f.value}
                type="button"
                variant={pressed ? "secondary" : "outline"}
                size="sm"
                aria-pressed={pressed}
                onClick={(event) => {
                  setFilter(f.value);
                  // « Cheat » sits past the edge at 390 px: bring the pressed
                  // chip fully into the row, never scroll the page.
                  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
                className={cn(
                  "h-auto min-h-11 shrink-0 px-3.5 text-sm",
                  pressed && "border-primary/50 ring-1 ring-primary/30",
                )}
              >
                {f.label}
              </Button>
            );
          })}
        </fieldset>
        <div className="flex items-center gap-2">
          <span id="recipe-sort" className="text-sm text-muted-foreground">
            Trier
          </span>
          <Select
            items={Object.fromEntries(SORTS.map((s) => [s.value, s.label]))}
            value={sort}
            onValueChange={(value) => value && setSort(value as RecipeSort)}
          >
            <SelectTrigger aria-labelledby="recipe-sort" className="h-11 min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {shown.length} recette{shown.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Rien ici pour l&apos;instant. Chaque repas que le Chef met dans ton menu arrive dans cette
          liste, et le catalogue sèche s&apos;y ajoute au prochain déploiement.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Aucune recette dans cette catégorie.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((recipe) => (
            <li key={recipe._id}>
              <RecipeCard
                recipe={recipe}
                maxDensity={maxDensity}
                onOpen={() => setOpenId(recipe._id)}
              />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        {open ? <RecipeSheet recipe={open} /> : null}
      </Dialog>
    </div>
  );
}

export function RecipesSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-20" />
      <Skeleton className="h-11" />
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  );
}
