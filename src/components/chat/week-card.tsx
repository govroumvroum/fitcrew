"use client";

import { CalendarDaysIcon } from "lucide-react";
import Link from "next/link";
import { Header, Surface } from "@/components/chat/tool-cards";
import { type ShownEntry, WeekRows } from "@/components/week/week-rows";

/**
 * `set_week_template` (#118). Reads the OUTPUT, not the input: the output is the
 * week as it was saved — times normalised (« 18h30 » → 18:30), programs named
 * from the database rather than from a lineageId the model typed. Only drawn on
 * success; a refusal carries an `error` and the shell shows the failed line.
 */
export function WeekCard({ entries, isNew }: { entries: ShownEntry[]; isNew?: boolean }) {
  const planned = new Set(entries.filter((e) => e.level !== "off").map((e) => e.weekday)).size;
  return (
    <Surface isNew={isNew}>
      <Header
        icon={<CalendarDaysIcon className="size-4 text-muted-foreground" />}
        title="Ta semaine type"
        aside={`${planned} jour${planned > 1 ? "s" : ""} d'entraînement`}
      />
      <WeekRows entries={entries} />
      <p className="text-sm text-muted-foreground">
        Le Chef cale tes repas dessus. Tu peux la changer sur{" "}
        <Link href="/programme" className="underline underline-offset-2">
          Programme
        </Link>
        .
      </p>
    </Surface>
  );
}
