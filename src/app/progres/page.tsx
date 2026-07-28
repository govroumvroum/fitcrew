"use client";

import { Dashboard } from "@/components/progress/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";

export default function ProgresPage() {
  const today = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)]">
      {today ? <Dashboard today={today} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}
