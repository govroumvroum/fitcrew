"use client";

import { NutritionDashboard, NutritionSkeleton } from "@/components/nutrition/dashboard";
import { useLocalDate } from "@/lib/dates";

export default function NutritionPage() {
  // `today` is the user's local date, and it's null on the server and on first
  // paint — the dashboard query must never read the clock itself.
  const today = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-3xl lg:max-w-5xl">
      {today ? <NutritionDashboard today={today} /> : <NutritionSkeleton />}
    </main>
  );
}
