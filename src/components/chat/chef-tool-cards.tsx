"use client";

import {
  ArrowRightIcon,
  BoxIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  DumbbellIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import type { z } from "zod";
import type {
  zAddFoodLogEntry,
  zGenerateMealPlan,
  zLogPlannedMeal,
  zMoveMeal,
  zPlannedMeal,
  zRegenerateDay,
  zReplaceMeal,
  zSaveNutritionProfile,
  zUpdateInventory,
} from "../../../convex/chefToolSchemas";
import type { ConsultAnswer } from "../../../convex/consult";
import type { FoodFact } from "../../../convex/foodFacts";
import type { Macros } from "../../../convex/nutrition";
import { Chips, Field, Header, Surface } from "@/components/chat/tool-cards";
import { SLOT_LABELS, macroLine } from "@/components/nutrition/macros";
import { formatFull } from "@/lib/dates";
import { formatNumber } from "@/lib/utils";

/**
 * The Chef's tool-result cards. Same conventions as `tool-cards.tsx`: they read
 * the tool's *input*, because that's what the model produced, and the output is
 * usually just a count. The four exceptions say so on themselves.
 *
 * Concentric radii throughout: card is rounded-xl with p-3, inner rows are
 * rounded-md — outer radius minus padding.
 *
 * Every card that prints a kcal or a macro also says it's an estimation. That is
 * an acceptance criterion of both issues, not a nicety.
 *
 * `Surface` / `Header` / `Field` / `Chips` come from `tool-cards.tsx`, so a fix to
 * the shared surface lands on both agents' cards at once.
 */

type Meal = z.infer<typeof zPlannedMeal>;

export type NutritionProfileInput = z.infer<typeof zSaveNutritionProfile>;
export type MealPlanInput = z.infer<typeof zGenerateMealPlan>;
export type ReplaceMealInput = z.infer<typeof zReplaceMeal>;
export type MoveMealInput = z.infer<typeof zMoveMeal>;
export type RegenerateDayInput = z.infer<typeof zRegenerateDay>;
export type FoodLogInput = z.infer<typeof zAddFoodLogEntry>;
export type PlannedMealInput = z.infer<typeof zLogPlannedMeal>;
export type InventoryInput = z.infer<typeof zUpdateInventory>;

/** `api.nutrition.shoppingList` — the consolidated list IS the result. */
export type ShoppingListOutput = { name: string; quantities: string[] }[];

/** `api.vision.suggestRecipes` — the recipes are the result, nothing is saved. */
export type RecipesOutput = {
  recipes: {
    name: string;
    ingredients: { name: string; quantity: string }[];
    steps: string[];
    prepMinutes: number;
    macros: Macros;
  }[];
};

/** The `lookup_food` tool's own envelope around `convex/foodFacts`. */
export type LookupFoodOutput = {
  query: string;
  source?: string;
  basis?: string;
  results: FoodFact[];
  error?: string;
};

const GOAL: Record<NutritionProfileInput["goal"], string> = {
  perte: "Perte de poids",
  maintien: "Maintien",
  prise: "Prise de masse",
};

const ACTIVITY: Record<NutritionProfileInput["activityLevel"], string> = {
  sedentaire: "Sédentaire",
  leger: "Léger",
  modere: "Modéré",
  actif: "Actif",
  tres_actif: "Très actif",
};

/** The estimation disclaimer. Mandatory on every card that shows kcal or macros. */
function Estimated({ children }: { children?: React.ReactNode }) {
  return (
    <p className="border-t pt-2 text-[11px] text-muted-foreground">
      {children ?? "Les calories et les macros sont des estimations, pas des mesures."}
    </p>
  );
}

/** Dates in a tool's input are written by the model, and `Intl` THROWS on an
 *  unparseable one rather than returning a placeholder. Falls back to the raw
 *  string: a card showing "2026-13-40" beats a card that takes the chat down. */
function dateLabel(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatFull(date) : date;
}

const icon = (Icon: typeof CheckIcon) => <Icon className="size-4 shrink-0 text-muted-foreground" />;

/** One planned meal, stacked rather than in columns — 390 px has no room for both
 *  a dish name and four figures on the same line. */
function MealBlock({ meal }: { meal: Meal }) {
  return (
    <li className="space-y-0.5 rounded-md px-2 py-1.5 odd:bg-muted/40">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow min-w-0 flex-1">{SLOT_LABELS[meal.slot]}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {meal.prepMinutes} min
        </span>
      </div>
      <p className="text-sm">{meal.name}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums">≈ {macroLine(meal.macros)}</p>
      {/* ponytail: ingredient names, no quantities, and no steps. The whole recipe
          for 21 meals is a wall on a phone; the Chef narrates the day and
          /nutrition shows today's meals in full. */}
      <p className="text-[11px] text-muted-foreground">
        {meal.ingredients.map((i) => i.name).join(", ")}
      </p>
      {meal.mealPrep ? <p className="text-[11px] text-muted-foreground">{meal.mealPrep}</p> : null}
    </li>
  );
}

const dayCalories = (meals: Meal[]) => meals.reduce((sum, m) => sum + m.macros.calories, 0);

export function NutritionProfileCard({
  input,
  targets,
  isNew,
}: {
  input: NutritionProfileInput;
  targets?: Macros;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header icon={icon(CheckIcon)} title="Profil nutrition enregistré" />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Field label="Objectif" value={GOAL[input.goal]} />
        <Field label="Activité" value={ACTIVITY[input.activityLevel]} />
        <Field
          label="Âge / sexe"
          value={`${input.age} ans · ${input.sex === "h" ? "homme" : "femme"}`}
          numeric
        />
        <Field
          label="Taille / poids"
          value={`${input.heightCm} cm · ${input.weightKg} kg`}
          numeric
        />
        <Field label="Repas / jour" value={String(input.mealsPerDay)} numeric />
        {input.cookMinutes !== null ? (
          <Field label="Cuisine" value={`${input.cookMinutes} min / repas`} numeric />
        ) : null}
        {input.people !== null ? (
          <Field label="Couverts" value={String(input.people)} numeric />
        ) : null}
        {input.budget ? <Field label="Budget" value={input.budget} /> : null}
        {input.diet ? <Field label="Régime" value={input.diet} /> : null}
      </dl>
      {/* Always rendered, even empty: "aucune allergie déclarée" is information,
          and a missing section reads as a section the app forgot to ask about. */}
      <Chips label="Allergies" items={input.allergies.length ? input.allergies : ["aucune"]} />
      <Chips label="Aliments exclus" items={input.excluded.length ? input.excluded : ["aucun"]} />
      {targets ? (
        <div className="space-y-0.5 border-t pt-2">
          <span className="eyebrow">Cibles quotidiennes</span>
          <p className="text-sm tabular-nums">≈ {macroLine(targets)}</p>
        </div>
      ) : null}
      <Estimated>
        Cibles estimées (Mifflin-St Jeor) à partir de ce que tu as dit. Ce n&apos;est ni une mesure
        ni une prescription médicale.
      </Estimated>
    </Surface>
  );
}

export function MealPlanCard({
  input,
  meals,
  isNew,
}: {
  input: MealPlanInput;
  meals?: number;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(CalendarDaysIcon)}
        title="Ta semaine de repas"
        aside={meals ? `${meals} repas` : undefined}
      />
      {/* Native <details>: a disclosure without a dependency or a state hook.
          First day open, the rest collapsed — seven days at once is a wall. */}
      {input.days.map((day, i) => (
        <details key={day.date} open={i === 0} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium marker:hidden hover:bg-muted/60">
            <ChevronDownIcon className="chevron" />
            <span className="min-w-0 flex-1 capitalize">{dateLabel(day.date)}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              ≈ {formatNumber(dayCalories(day.meals))} kcal
            </span>
          </summary>
          <ul className="mt-1 mb-2">
            {day.meals.map((meal) => (
              <MealBlock key={`${meal.slot}-${meal.name}`} meal={meal} />
            ))}
          </ul>
        </details>
      ))}
      <Estimated />
    </Surface>
  );
}

export function ReplaceMealCard({ input, isNew }: { input: ReplaceMealInput; isNew?: boolean }) {
  return (
    <Surface isNew={isNew}>
      <Header icon={icon(UtensilsCrossedIcon)} title={`${SLOT_LABELS[input.slot]} remplacé`} />
      <p className="text-[11px] text-muted-foreground capitalize">{dateLabel(input.date)}</p>
      <ul>
        <MealBlock meal={input.meal} />
      </ul>
      <Estimated />
    </Surface>
  );
}

export function MoveMealCard({
  input,
  name,
  isNew,
}: {
  input: MoveMealInput;
  name?: string;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header icon={icon(ArrowRightIcon)} title={name ?? "Repas déplacé"} />
      {/* Stacked, not side by side: two dates and two slot names never fit on one
          390 px line without truncating the part that matters. */}
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground line-through">
          <span className="capitalize">{dateLabel(input.from.date)}</span> —{" "}
          {SLOT_LABELS[input.from.slot]}
        </p>
        <p className="font-medium">
          <span className="capitalize">{dateLabel(input.to.date)}</span> —{" "}
          {SLOT_LABELS[input.to.slot]}
        </p>
      </div>
    </Surface>
  );
}

export function RegenerateDayCard({
  input,
  kept,
  isNew,
}: {
  input: RegenerateDayInput;
  kept?: number;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(RefreshCwIcon)}
        title={`Journée refaite — ${dateLabel(input.date)}`}
        aside={kept ? `${kept} gardé(s)` : undefined}
      />
      <ul>
        {input.meals.map((meal) => (
          <MealBlock key={`${meal.slot}-${meal.name}`} meal={meal} />
        ))}
      </ul>
      <Estimated />
    </Surface>
  );
}

/** Reads the OUTPUT: the consolidated list is the result — the input is empty. */
export function ShoppingListCard({
  output,
  isNew,
}: {
  output: ShoppingListOutput;
  isNew?: boolean;
}) {
  if (!Array.isArray(output) || output.length === 0) return null;

  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(ShoppingCartIcon)}
        title="Liste de courses"
        aside={`${output.length} articles`}
      />
      <ul>
        {output.map((line) => (
          <li
            key={line.name}
            className="flex items-baseline gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
          >
            <span className="min-w-0 flex-1 text-sm">{line.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {line.quantities.join(" + ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t pt-2 text-[11px] text-muted-foreground">
        Quantités additionnées depuis les repas de la semaine — à ajuster selon ce que tu as déjà.
      </p>
    </Surface>
  );
}

export function FoodLogCard({ input, isNew }: { input: FoodLogInput; isNew?: boolean }) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(NotebookPenIcon)}
        title={SLOT_LABELS[input.slot]}
        aside={dateLabel(input.date)}
      />
      <p className="text-sm">
        {input.name}
        {input.quantity ? <span className="text-muted-foreground"> — {input.quantity}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground tabular-nums">≈ {macroLine(input.macros)}</p>
      <Estimated />
    </Surface>
  );
}

/** No macros of its own: the numbers are the plan's, already shown when it was made. */
export function PlannedMealLoggedCard({
  input,
  isNew,
}: {
  input: PlannedMealInput;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(CheckIcon)}
        title={`${SLOT_LABELS[input.slot]} prévu, mangé`}
        aside={dateLabel(input.date)}
      />
      <p className="text-[11px] text-muted-foreground">
        Recopié du plan dans ton journal, avec ses valeurs estimées.
      </p>
    </Surface>
  );
}

export function InventoryCard({
  input,
  count,
  isNew,
}: {
  input: InventoryInput;
  count?: number;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header
        icon={icon(BoxIcon)}
        title={input.mode === "replace" ? "Inventaire refait" : "Inventaire complété"}
        aside={count !== undefined ? `${count} en stock` : undefined}
      />
      <ul>
        {input.items.map((item) => (
          <li
            key={item.name}
            className="flex items-baseline gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
          >
            <span className="min-w-0 flex-1 text-sm">{item.name}</span>
            {item.quantity ? (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {item.quantity}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

/** Reads the OUTPUT: the recipes are the result, and nothing was saved. */
export function RecipesCard({ output, isNew }: { output: RecipesOutput; isNew?: boolean }) {
  if (!output?.recipes?.length) return null;

  return (
    <Surface isNew={isNew}>
      <Header icon={icon(UtensilsCrossedIcon)} title="Avec ce que tu as" />
      {output.recipes.map((recipe, i) => (
        <details key={recipe.name} open={i === 0} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium marker:hidden hover:bg-muted/60">
            <ChevronDownIcon className="chevron" />
            <span className="min-w-0 flex-1">{recipe.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {recipe.prepMinutes} min
            </span>
          </summary>
          <div className="mt-1 mb-2 space-y-1 px-2">
            <p className="text-[11px] text-muted-foreground tabular-nums">
              ≈ {macroLine(recipe.macros)}
            </p>
            <ul className="text-sm text-muted-foreground">
              {recipe.ingredients.map((ing) => (
                <li key={ing.name}>
                  {ing.name} — <span className="tabular-nums">{ing.quantity}</span>
                </li>
              ))}
            </ul>
            <ol className="list-inside list-decimal space-y-0.5 text-sm">
              {recipe.steps.map((step, s) => (
                <li key={s}>{step}</li>
              ))}
            </ol>
          </div>
        </details>
      ))}
      <Estimated>
        Macros estimées par portion. Rien n&apos;est enregistré : dis-moi si tu en choisis une.
      </Estimated>
    </Surface>
  );
}

/**
 * Reads the OUTPUT: the Open Food Facts hits ARE the result. The source line is
 * not decoration — it's what tells the user these numbers were looked up rather
 * than guessed by the model.
 */
export function LookupFoodCard({ output, isNew }: { output: LookupFoodOutput; isNew?: boolean }) {
  const results = output?.results ?? [];

  return (
    <Surface isNew={isNew}>
      <Header icon={icon(DatabaseIcon)} title={`« ${output.query} »`} aside="Open Food Facts" />
      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {output.error
            ? "La base Open Food Facts n'a pas répondu — les chiffres ci-dessus sont donc une estimation."
            : "Rien trouvé dans la base — les chiffres ci-dessus sont donc une estimation."}
        </p>
      ) : (
        <ul className="space-y-1">
          {results.map((fact) => (
            <li key={fact.code} className="space-y-0.5 rounded-md px-2 py-1.5 odd:bg-muted/40">
              <p className="text-sm">
                {fact.name}
                {fact.brand ? <span className="text-muted-foreground"> — {fact.brand}</span> : null}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {macroLine({
                  calories: fact.per100g.calories,
                  protein: fact.per100g.protein,
                  carbs: fact.per100g.carbs,
                  fat: fact.per100g.fat,
                })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {output.basis ?? "pour 100 g / 100 ml"}
                {fact.servingSize ? ` · portion imprimée : ${fact.servingSize}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Estimated>
        Valeurs relevées dans Open Food Facts, pas produites par le Chef. Elles valent pour la base
        indiquée : la portion que tu as réellement mangée reste une estimation.
      </Estimated>
    </Surface>
  );
}

/**
 * The Coach <-> Chef collaboration, made visible: an acceptance criterion of both
 * issues. Shows the question the Chef asked as well as the answer, so the user can
 * see what crossed between the two agents.
 */
export function AskCoachCard({
  question,
  answer,
  isNew,
}: {
  question: string;
  answer?: ConsultAnswer;
  isNew?: boolean;
}) {
  return (
    <Surface isNew={isNew}>
      <Header icon={icon(DumbbellIcon)} title="Le Chef a consulté le Coach" />
      <p className="text-sm text-muted-foreground italic">« {question} »</p>
      {answer ? (
        <>
          <p className="text-sm">{answer.recommendation}</p>
          {answer.meals?.length ? (
            <ul>
              {answer.meals.map((meal) => (
                <li
                  key={`${meal.name}-${meal.timing}`}
                  className="flex items-baseline gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 text-sm">{meal.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{meal.timing}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    ≈ {formatNumber(meal.calories)} kcal
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {answer.constraints?.length ? (
            <Chips label="Contraintes remontées" items={answer.constraints} />
          ) : null}
          <Estimated>
            Réponse du Coach sur la base de ton programme : une estimation, comme tous les chiffres
            ici.
          </Estimated>
        </>
      ) : null}
    </Surface>
  );
}
