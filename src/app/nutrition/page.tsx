"use client";

import { Suspense } from "react";
import { NutritionDashboard, NutritionSkeleton } from "@/components/nutrition/dashboard";
import { useLocalDate } from "@/lib/dates";

export default function NutritionPage() {
  // Suspense: the week view reads `?semaine=&jour=` with useSearchParams, which
  // a static prerender can't know — the build fails without a boundary.
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-3xl lg:max-w-5xl">
      <Suspense fallback={<NutritionSkeleton />}>
        <Nutrition />
      </Suspense>
    </main>
  );
}

function Nutrition() {
  // `today` is the user's local date, and it's null on the server and on first
  // paint — the dashboard query must never read the clock itself.
  const today = useLocalDate();
  return today ? <NutritionDashboard today={today} /> : <NutritionSkeleton />;
}
