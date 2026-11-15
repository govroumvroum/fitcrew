"use client";

import { Suspense } from "react";
import { ShoppingList, ShoppingListSkeleton } from "@/components/nutrition/shopping-list";
import { useLocalDate } from "@/lib/dates";

export default function ShoppingPage() {
  // ph-mask: what someone buys says what they eat, like the rest of /nutrition.
  // Suspense: `?semaine=` is read with useSearchParams.
  return (
    <main className="ph-mask mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-xl">
      <Suspense fallback={<ShoppingListSkeleton />}>
        <Shopping />
      </Suspense>
    </main>
  );
}

function Shopping() {
  const today = useLocalDate();
  return today ? <ShoppingList today={today} /> : <ShoppingListSkeleton />;
}
