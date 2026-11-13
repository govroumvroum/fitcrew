"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Session } from "@/components/workout/session";
import { useLocalDate } from "@/lib/dates";

export default function SeancePage() {
  // Suspense: `?programme=&jour=` (a day picked on /programme) is read with
  // useSearchParams, which a static prerender can't know — the build fails
  // without a boundary.
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-4xl">
      <Suspense fallback={<Skeleton className="m-4 h-64" />}>
        <Seance />
      </Suspense>
    </main>
  );
}

function Seance() {
  const date = useLocalDate();
  const params = useSearchParams();
  // Read from the URL on every render, never copied into state: the route stays
  // mounted between navigations, and a remembered choice would leak into the
  // next séance opened from a plain `/seance` link.
  const chosen = { programme: params.get("programme"), jour: params.get("jour") };
  return date ? <Session date={date} chosen={chosen} /> : <Skeleton className="m-4 h-64" />;
}
