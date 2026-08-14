"use client";

import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BoxIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClipboardListIcon,
  DatabaseIcon,
  DumbbellIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  RefrigeratorIcon,
  ShoppingBasketIcon,
  ShoppingCartIcon,
  TagIcon,
  UtensilsCrossedIcon,
  UtensilsIcon,
} from "lucide-react";
import Image from "next/image";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Macros } from "../../../convex/nutrition";
import type { VisionIntent, VisionItem } from "../../../convex/vision";
import { AgentChat, type AgentConfig } from "@/components/chat/agent-chat";
import {
  FoodLogCard,
  InventoryCard,
  LookupFoodCard,
  MealPlanCard,
  MoveMealCard,
  NutritionProfileCard,
  PlannedMealLoggedCard,
  RecipesCard,
  RegenerateDayCard,
  ReplaceMealCard,
  ShoppingListCard,
  type FoodLogInput,
  type InventoryInput,
  type LookupFoodOutput,
  type MealPlanInput,
  type MoveMealInput,
  type NutritionProfileInput,
  type PlannedMealInput,
  type RecipesOutput,
  type RegenerateDayInput,
  type ReplaceMealInput,
  type ShoppingListOutput,
} from "@/components/chat/chef-tool-cards";
import { OnboardingQuestionnaire } from "@/components/nutrition/questionnaire";
import { VisionReview } from "@/components/nutrition/vision-review";

/** What `api.vision.analyze` hands back — the four photo tools all return it. */
type AnalyzeOutput = {
  analysisId: Id<"visionAnalyses">;
  intent: VisionIntent;
  items: VisionItem[];
  warnings: string[];
};

/**
 * « Le Chef », as a configuration of the shared chat shell. Structure lives in
 * `agent-chat.tsx`; this file is the Chef's identity and its tool cards.
 */
export const CHEF: AgentConfig = {
  api: api.chef,
  name: "Le Chef",
  // Same treatment as the Coach's photo, down to the 28 px and the ring: the two
  // headers have to line up when you switch tabs. The source PNG has no alpha, so
  // the white field becomes the coin — hence ring rather than a border.
  coin: (
    <Image
      src="/chef.png"
      alt=""
      width={28}
      height={28}
      className="rounded-full ring-1 ring-white/10"
      priority
    />
  ),
  placeholder: "Écris au Chef…",
  attach: { label: "Joindre une photo", prompt: "Regarde cette photo." },
  thinking: "Le Chef réfléchit…",
  unreachable: "Le Chef ne répond pas.",
  sidebarEmpty: "Pas encore de conversation. Écris au Chef, elle apparaîtra ici.",
  // The cards whose RESULT is the output, not the model's input: the four photo
  // analyses, the consolidated shopping list, the recipes, and the food database
  // hits. Everything else is hidden until its input has landed.
  outputOnly: [
    "tool-analyze_plate",
    "tool-analyze_fridge",
    "tool-read_nutrition_label",
    "tool-analyze_groceries",
    "tool-shopping_list",
    "tool-suggest_recipes_from_ingredients",
    "tool-lookup_food",
    // The form reads everything off the OUTPUT — the questions included, via
    // `api.questionnaires.status`. Its input is a long array that streams in
    // piece by piece, and the guard would hide the card until it lands.
    "tool-ask_questionnaire",
  ],
  toolLabels: {
    "tool-ask_questionnaire": {
      icon: ClipboardListIcon,
      pending: "Je prépare tes questions…",
      running: "J'ouvre ton questionnaire…",
      done: "Questionnaire nutrition",
      failed: "Le questionnaire n'a pas pu s'ouvrir.",
    },
    "tool-save_nutrition_profile": {
      icon: CheckIcon,
      pending: "Je récapitule…",
      running: "J'enregistre ton profil…",
      done: "Profil nutrition enregistré",
      failed: "Le profil n'a pas pu être enregistré.",
    },
    // The long one: writing 21 meals takes a while, and this line is the only
    // thing telling the user the app hasn't hung.
    "tool-generate_meal_plan": {
      icon: CalendarDaysIcon,
      pending: "Je réfléchis à ta semaine…",
      running: "J'écris tes repas de la semaine…",
      done: "Semaine générée",
      failed: "Le menu n'a pas pu être généré.",
    },
    "tool-replace_meal": {
      icon: ArrowLeftRightIcon,
      pending: "Je cherche autre chose…",
      running: "Je remplace ce repas…",
      done: "Repas remplacé",
      failed: "Le repas n'a pas pu être remplacé.",
    },
    "tool-move_meal": {
      icon: ArrowRightIcon,
      pending: "Je déplace ce repas…",
      done: "Repas déplacé",
      failed: "Le repas n'a pas pu être déplacé.",
    },
    "tool-regenerate_day": {
      icon: RefreshCwIcon,
      pending: "Je repense cette journée…",
      running: "Je réécris la journée…",
      done: "Journée refaite",
      failed: "La journée n'a pas pu être régénérée.",
    },
    "tool-shopping_list": {
      icon: ShoppingCartIcon,
      pending: "Je rassemble tes ingrédients…",
      running: "Je monte ta liste de courses…",
      done: "Liste de courses",
    },
    "tool-add_food_log_entry": {
      icon: NotebookPenIcon,
      pending: "Je note ça…",
      running: "J'ajoute à ton journal…",
      done: "Ajouté au journal",
      failed: "Ça n'a pas pu être ajouté au journal.",
    },
    "tool-log_planned_meal": {
      icon: NotebookPenIcon,
      pending: "Je note ce repas…",
      running: "J'ajoute à ton journal…",
      done: "Repas ajouté au journal",
      failed: "Ça n'a pas pu être ajouté au journal.",
    },
    "tool-update_inventory": {
      icon: BoxIcon,
      pending: "Je regarde ton inventaire…",
      running: "Je mets ton inventaire à jour…",
      done: "Inventaire à jour",
      failed: "L'inventaire n'a pas pu être mis à jour.",
    },
    "tool-suggest_recipes_from_ingredients": {
      icon: UtensilsCrossedIcon,
      pending: "Je regarde ce que tu as…",
      running: "Je cherche des recettes…",
      done: "Idées de recettes",
      failed: "Je n'ai pas trouvé de recette.",
    },
    "tool-lookup_food": {
      icon: DatabaseIcon,
      pending: "Je prépare ma recherche…",
      running: "Je cherche dans Open Food Facts…",
      done: "Valeurs Open Food Facts",
      failed: "Open Food Facts ne répond pas.",
    },
    // The four photo skills each get their own icon: at a glance the row says
    // WHAT was photographed, which is the only thing distinguishing them.
    // "J'ouvre" while the model is still choosing the analysis, "je regarde" once
    // it actually is.
    "tool-analyze_plate": {
      icon: UtensilsIcon,
      pending: "J'ouvre ta photo…",
      running: "Je regarde ton assiette…",
      done: "Assiette analysée",
      failed: "Je n'ai pas réussi à analyser cette photo.",
    },
    "tool-analyze_fridge": {
      icon: RefrigeratorIcon,
      pending: "J'ouvre ta photo…",
      running: "Je regarde ton frigo…",
      done: "Frigo analysé",
      failed: "Je n'ai pas réussi à analyser cette photo.",
    },
    "tool-read_nutrition_label": {
      icon: TagIcon,
      pending: "J'ouvre ta photo…",
      running: "Je lis l'étiquette…",
      done: "Étiquette lue",
      failed: "Je n'ai pas réussi à lire cette étiquette.",
    },
    "tool-analyze_groceries": {
      icon: ShoppingBasketIcon,
      pending: "J'ouvre ta photo…",
      running: "Je regarde tes courses…",
      done: "Courses analysées",
      failed: "Je n'ai pas réussi à analyser cette photo.",
    },
    // The Coach's own icon, not a generic arrow: the row says WHO was asked.
    "tool-ask_coach": {
      icon: DumbbellIcon,
      pending: "Je demande au Coach…",
      done: "Demande au Coach",
      failed: "Le Coach n'a pas répondu.",
    },
  },
  // The four photo analyses: nothing reaches the journal or the inventory until
  // the user has corrected and confirmed, so their card must never be collapsed.
  needsValidation: [
    "tool-analyze_plate",
    "tool-analyze_fridge",
    "tool-read_nutrition_label",
    "tool-analyze_groceries",
    // A form nobody can see is a form nobody fills in: the whole point of the
    // tool is that the user acts on it.
    "tool-ask_questionnaire",
  ],
  renderTool: (tool, isNew) => {
    const { input, output } = tool;

    switch (tool.type) {
      // The four photo analyses share one card: it is the only path from an
      // analysis to the food log or the inventory, and `items: []` (unusable
      // photo) goes through it too — it carries the warnings AND the discard
      // button, which a bare sentence doesn't, so the row and its blob leak
      // without it.
      case "tool-analyze_plate":
      case "tool-analyze_fridge":
      case "tool-read_nutrition_label":
      case "tool-analyze_groceries": {
        const done = output as AnalyzeOutput;
        return (
          <VisionReview
            analysisId={done.analysisId}
            intent={done.intent}
            items={done.items}
            warnings={done.warnings}
          />
        );
      }

      // The onboarding form. Its state lives in Convex, so the card only needs
      // the id — everything else comes from `api.questionnaires.status`.
      case "tool-ask_questionnaire":
        return (
          <OnboardingQuestionnaire
            questionnaireId={(output as { questionnaireId: Id<"questionnaires"> }).questionnaireId}
          />
        );

      case "tool-save_nutrition_profile":
        return (
          <NutritionProfileCard
            input={input as NutritionProfileInput}
            targets={(output as { targets?: Macros })?.targets}
            isNew={isNew}
          />
        );
      case "tool-generate_meal_plan":
        return (
          <MealPlanCard
            input={input as MealPlanInput}
            meals={(output as { meals?: number })?.meals}
            isNew={isNew}
          />
        );
      case "tool-replace_meal":
        return <ReplaceMealCard input={input as ReplaceMealInput} isNew={isNew} />;
      case "tool-move_meal":
        return (
          <MoveMealCard
            input={input as MoveMealInput}
            name={(output as { name?: string })?.name}
            isNew={isNew}
          />
        );
      case "tool-regenerate_day":
        return (
          <RegenerateDayCard
            input={input as RegenerateDayInput}
            kept={(output as { kept?: number })?.kept}
            isNew={isNew}
          />
        );
      case "tool-shopping_list":
        return <ShoppingListCard output={output as ShoppingListOutput} isNew={isNew} />;
      case "tool-add_food_log_entry":
        return <FoodLogCard input={input as FoodLogInput} isNew={isNew} />;
      case "tool-log_planned_meal":
        return <PlannedMealLoggedCard input={input as PlannedMealInput} isNew={isNew} />;
      case "tool-update_inventory":
        return (
          <InventoryCard
            input={input as InventoryInput}
            count={(output as { count?: number })?.count}
            isNew={isNew}
          />
        );
      case "tool-suggest_recipes_from_ingredients":
        return <RecipesCard output={output as RecipesOutput} isNew={isNew} />;
      case "tool-lookup_food":
        return <LookupFoodCard output={output as LookupFoodOutput} isNew={isNew} />;
      // No card: a consult's answer is already in the prose, rewritten by the
      // agent that asked. Returning null makes the shell render the one-line
      // marker from `toolLabels` — returning a line here would get wrapped in a
      // disclosure whose summary is that same line.
      case "tool-ask_coach":
        return null;
      default:
        // Every tool the Chef has today is covered above — none of them has a
        // prose-only result. This guards a tool added to `chef.ts` later: no card
        // beats a crash.
        return null;
    }
  },
};

export function ChefChat() {
  return <AgentChat agent={CHEF} />;
}
