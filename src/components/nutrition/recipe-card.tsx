"use client";

import { useAction } from "convex/react";
import { ClockIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Macros } from "../../../convex/nutrition";
import {
  CATEGORY_LABELS,
  type RecipeCategory,
  prepLabel,
  proteinDensity,
} from "../../../convex/recipeLogic";
import { RecipeArt } from "./recipe-art";

/**
 * diet's recipe card and recipe sheet, shared by /nutrition/recettes (a library
 * recipe), the week view on /nutrition (a planned meal, #121) and the
 * « Changer » sheet (its candidates). One component so the three can't drift.
 *
 * A planned meal fits the same shape: it carries its own ingredients, steps and
 * macros, and borrows the photo of the recipe of the same name.
 */
export type RecipeView = {
  name: string;
  category: RecipeCategory;
  cheat: boolean;
  tags: string[];
  mine?: boolean;
  description?: string | null;
  ingredients: { name: string; quantity: string }[];
  steps: string[];
  prepMinutes: number;
  macros: Macros;
  photoUrl: string | null;
};

/** What the library shows above a recipe's name: its shelf and where it's from. */
export const libraryEyebrow = (recipe: RecipeView) =>
  `${CATEGORY_LABELS[recipe.category]}${
    recipe.mine ? " · du Chef" : recipe.tags.includes("seche") ? " · sèche" : ""
  }`;

/**
 * Asks the server to look up photos for recipes nobody has looked up yet. Keyed
 * on the pending names joined, so it fires once per set, not per render; the
 * server picks the names itself and caches every answer, `null` included.
 */
export function usePhotoLookup(recipes: { name: string; photoPending: boolean }[] | undefined) {
  const resolve = useAction(api.recipes.resolvePhotos);
  const pending = (recipes ?? [])
    .filter((r) => r.photoPending)
    .map((r) => r.name)
    .join("\n");
  // One call at a time. `pending` shrinks while a call is still working through
  // its batch, and the server reads its queue at the start of each call, so a
  // second concurrent call would be handed — and bill — the same names again.
  // When a call ends and the set has moved on, the next one starts from there;
  // when it hasn't (a transient failure cached nothing), nothing loops.
  const inFlight = useRef(false);
  const latest = useRef("");
  useEffect(() => {
    latest.current = pending;
    if (!pending || inFlight.current) return;
    const run = () => {
      inFlight.current = true;
      const asked = latest.current;
      void resolve({})
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
          if (latest.current && latest.current !== asked) run();
        });
    };
    run();
  }, [pending, resolve]);
}

/**
 * The photo, with the generated illustration underneath it: shown while the
 * photo loads, when there is none, and when it fails (offline, dead hotlink).
 * Plain <img>, not next/image — third-party hosts not in `remotePatterns`, same
 * as vision-review.tsx.
 */
export function RecipeVisual({ recipe, className }: { recipe: RecipeView; className?: string }) {
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

function Numbers({ recipe }: { recipe: RecipeView }) {
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

/**
 * The card. The whole top is one button (`onOpen`, or whatever `label` says it
 * does); `footer` holds actions that are not « open », as siblings of that
 * button — never inside it. `maxDensity` draws diet's protein bar, relative to
 * the densest recipe on screen; without it, no bar.
 */
export function RecipeCard({
  recipe,
  onOpen,
  eyebrow = libraryEyebrow(recipe),
  label = `${recipe.name} — voir la recette`,
  maxDensity,
  summary = true,
  opensDialog = true,
  footer,
}: {
  recipe: RecipeView;
  onOpen: () => void;
  eyebrow?: ReactNode;
  label?: string;
  maxDensity?: number;
  summary?: boolean;
  /** False when the tap does something else than open the sheet (« Changer »). */
  opensDialog?: boolean;
  footer?: ReactNode;
}) {
  const density = proteinDensity(recipe.macros);
  const text =
    recipe.description ??
    recipe.ingredients
      .map((i) => i.name)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup={opensDialog ? "dialog" : undefined}
        aria-label={label}
        className="flex w-full flex-col text-left transition-transform active:scale-[0.98]"
      >
        <RecipeVisual recipe={recipe} />
        <div className="flex w-full flex-col gap-2 p-3">
          <p className="eyebrow">{eyebrow}</p>
          <h3 className="font-heading text-[1.05rem] leading-tight font-semibold">{recipe.name}</h3>
          {summary ? <p className="line-clamp-2 text-sm text-muted-foreground">{text}</p> : null}
          <Numbers recipe={recipe} />
          {maxDensity !== undefined ? (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{
                    width: `${maxDensity > 0 ? Math.round((density / maxDensity) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatNumber(density, 1)} g de protéines pour 100 kcal
              </p>
            </div>
          ) : null}
        </div>
      </button>
      {footer ? <div className="px-3 pb-3">{footer}</div> : null}
    </div>
  );
}

/** The sheet: photo, numbers, ingredients, steps. Goes inside a `<Dialog>`. */
export function RecipeSheet({
  recipe,
  eyebrow = CATEGORY_LABELS[recipe.category],
  children,
}: {
  recipe: RecipeView;
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
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
          <p className="eyebrow">{eyebrow}</p>
          <DialogTitle className="text-xl leading-tight font-bold">{recipe.name}</DialogTitle>
        </div>
        <Numbers recipe={recipe} />
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatNumber(recipe.macros.carbs)} g de glucides · {formatNumber(recipe.macros.fat)} g de
          lipides — estimations
        </p>
        {children}

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
