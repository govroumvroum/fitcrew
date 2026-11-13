"use client";

import { RecipeLibrary } from "@/components/nutrition/recipes";

export default function RecipesPage() {
  // ph-mask: someone's own recipes say what they eat, like the rest of /nutrition.
  return (
    <main className="ph-mask mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-3xl lg:max-w-5xl">
      <RecipeLibrary />
    </main>
  );
}
