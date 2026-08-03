"use client";

import { ChefHatIcon } from "lucide-react";
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
import { ConsultLine } from "@/components/chat/tool-cards";
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
  // No /chef.png to pair with the Coach's photo, so an icon in a coin of the same
  // 28 px — the two headers have to line up when you switch tabs.
  coin: (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-white/10"
      aria-hidden
    >
      <ChefHatIcon className="size-4 text-muted-foreground" />
    </span>
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
      case "tool-ask_coach":
        return <ConsultLine label="Demande au Coach" isNew={isNew} />;
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
