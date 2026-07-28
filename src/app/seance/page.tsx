"use client";

import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Session } from "@/components/workout/session";
import { useLocalDate } from "@/lib/dates";

export default function SeancePage() {
  const date = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <PageHeader />
      {date ? <Session date={date} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}
