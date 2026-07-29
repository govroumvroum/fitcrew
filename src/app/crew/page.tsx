"use client";

import { Crew } from "@/components/crew/crew";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";

export default function CrewPage() {
  const today = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-3xl lg:max-w-6xl">
      {today ? <Crew today={today} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}
