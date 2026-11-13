"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, ClockIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import {
  CATEGORY_LABELS,
  FILTERS,
  type RecipeFilter,
  type RecipeSort,
  SORTS,
  matchesFilter,
  prepLabel,
  proteinDensity,
  sortRecipes,
} from "../../../convex/recipeLogic";
import { RecipeArt } from "./recipe-art";

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

/**
 * Asks the server to look up photos for recipes nobody has looked up yet. Keyed
 * on the pending names joined, so it fires once per set, not per render; the
 * server picks the names itself and caches every answer, `null` included.
 */
function usePhotoLookup(recipes: Recipe[] | undefined) {
  const resolve = useAction(api.recipes.resolvePhotos);
  const pending = (recipes ?? [])
    .filter((r) => r.photoPending)
    .map((r) => r.name)
    .join("\n");
  useEffect(() => {
    if (pending) void resolve({}).catch(() => {});
  }, [pending, resolve]);
}

/**
 * The photo, with the generated illustration underneath it: shown while the
 * photo loads, when there is none, and when it fails (offline, dead hotlink).
 * Plain <img>, not next/image — third-party hosts not in `remotePatterns`, same
 * as vision-review.tsx.
 */
function RecipeVisual({ recipe, className }: { recipe: Recipe; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = recipe.photoUrl && failed !== recipe.photoUrl ? recipe.photoUrl : null;
  return (
    <div className={cn("relative aspect-[320/190] overflow-hidden bg-muted", className)}>
      <RecipeArt
        name={recipe.name}
        category={recipe.category}
        ingredients={recipe.ingredients.map((i) => i.name)}
        className="absolute inset-0 size-full"
      />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {recipe.cheat ? (
        <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white">
          Cheat compatible
        </span>
      ) : null}
    </div>
  );
}

function Numbers({ recipe }: { recipe: Recipe }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {[
        [formatNumber(recipe.macros.calories), "kcal"],
        [`${formatNumber(recipe.macros.protein)} g`, "protéines"],
        [prepLabel(recipe.prepMinutes), "prépa"],
      ].map(([value, label]) => (
        <div key={label} className="flex flex-col-reverse rounded-md bg-muted/50 px-1 py-1.5">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="font-heading font-bold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecipeCard({
  recipe,
  maxDensity,
  onOpen,
}: {
  recipe: Recipe;
  maxDensity: number;
  onOpen: () => void;
}) {
  const density = proteinDensity(recipe.macros);
  const summary =
    recipe.description ??
    recipe.ingredients
      .map((i) => i.name)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase());

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${recipe.name} — voir la recette`}
      className="flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition-transform active:scale-[0.98]"
    >
      <RecipeVisual recipe={recipe} />
      <div className="flex flex-col gap-2 p-3">
        <p className="eyebrow">
          {CATEGORY_LABELS[recipe.category]}
          {recipe.mine ? " · du Chef" : recipe.tags.includes("seche") ? " · sèche" : ""}
        </p>
        <h3 className="font-heading text-[1.05rem] leading-tight font-semibold">{recipe.name}</h3>
        <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>
        <Numbers recipe={recipe} />
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${maxDensity > 0 ? Math.round((density / maxDensity) * 100) : 0}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {formatNumber(density, 1)} g de protéines pour 100 kcal
          </p>
        </div>
      </div>
    </button>
  );
}

function RecipeSheet({ recipe }: { recipe: Recipe }) {
  return (
    <DialogContent
      showCloseButton={false}
      className="flex max-h-[88dvh] flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
    >
      <RecipeVisual recipe={recipe} className="shrink-0 rounded-t-xl" />
      <DialogClose
        render={
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2 size-11 rounded-full"
            aria-label="Fermer la recette"
          />
        }
      >
        <XIcon className="size-4" aria-hidden />
      </DialogClose>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <p className="eyebrow">{CATEGORY_LABELS[recipe.category]}</p>
          <DialogTitle className="text-xl leading-tight font-bold">{recipe.name}</DialogTitle>
        </div>
        <Numbers recipe={recipe} />
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatNumber(recipe.macros.carbs)} g de glucides · {formatNumber(recipe.macros.fat)} g de
          lipides — estimations
        </p>

        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Ingrédients</h3>
          <ul>
            {recipe.ingredients.map((ingredient) => (
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
          <h3 className="inline-flex items-center gap-2 font-semibold">
            Préparation
            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground tabular-nums">
              <ClockIcon className="size-3" aria-hidden />
              {prepLabel(recipe.prepMinutes)}
            </span>
          </h3>
          <ol className="flex list-decimal flex-col gap-1 pl-6 text-sm">
            {recipe.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </div>
    </DialogContent>
  );
}
