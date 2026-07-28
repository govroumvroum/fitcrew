"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Session } from "@/components/workout/session";
import { useLocalDate } from "@/lib/dates";

export default function SeancePage() {
  const date = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-4xl">
      {date ? <Session date={date} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}
