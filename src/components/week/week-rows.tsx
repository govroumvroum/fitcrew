"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type DayLevel,
  type WeekEntry,
  LEVEL_LABEL,
  WEEKDAYS,
  entriesOn,
  formatTime,
  levelOfWeekday,
} from "../../../convex/weekTemplate";

/**
 * The semaine type, seven rows, read-only — shared by the Coach's
 * `set_week_template` card and /programme's « Ma semaine ». `weekTemplate.ts` is
 * pure (no Convex server import), so importing it here costs the bundle nothing.
 */

export type ShownEntry = WeekEntry & {
  program?: { name: string; status: "active" | "archived" | "completed" } | null;
};

export const SHORT_DAY = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

/** Off is quiet, léger a step up, dur the one that reads from across the room. */
export function LevelBadge({ level, className }: { level: DayLevel; className?: string }) {
  return (
    <Badge
      variant={level === "off" ? "outline" : "secondary"}
      className={cn(
        "shrink-0",
        level === "off" && "text-muted-foreground",
        level === "dur" && "border-primary/45 bg-primary/20 text-accent-text",
        className,
      )}
    >
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

/** "boxe · 18h30", "muscu · soir", or just the kind. */
export const entryLine = (entry: { kind: string; time?: string }) =>
  entry.time ? `${entry.kind} · ${formatTime(entry.time)}` : entry.kind;

export function DaySummary({ entries }: { entries: ShownEntry[] }) {
  if (entries.length === 0) return <span className="text-muted-foreground">Repos</span>;
  return (
    <span className="flex min-w-0 flex-col">
      {entries.map((entry, i) => (
        <span key={i} className="truncate">
          {entryLine(entry)}
          {entry.program && entry.program.status !== "active" ? (
            <span className="text-muted-foreground">
              {" "}
              · {entry.program.status === "archived" ? "archivé" : "terminé"}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

export function WeekRows({
  entries,
  onPick,
  today,
}: {
  entries: ShownEntry[];
  /** Makes each row a button that opens that day. Read-only without it. */
  onPick?: (weekday: number) => void;
  /** 0-6, to mark today's row. */
  today?: number;
}) {
  return (
    <ul className="divide-y">
      {WEEKDAYS.map((name, weekday) => {
        const day = entriesOn(entries, weekday);
        const content = (
          <>
            <span
              className={cn(
                "w-9 shrink-0 text-sm font-semibold",
                weekday === today ? "text-accent-text" : "text-muted-foreground",
              )}
            >
              {SHORT_DAY[weekday]}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <DaySummary entries={day} />
            </span>
            <LevelBadge level={levelOfWeekday(day, weekday)} />
          </>
        );
        return (
          <li key={name}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(weekday)}
                aria-label={`Modifier le ${name}`}
                className="flex min-h-11 w-full items-center gap-3 py-2 text-left transition-colors duration-100 active:bg-muted/50 pointer-fine:hover:bg-muted/40"
              >
                {content}
              </button>
            ) : (
              <div className="flex min-h-11 items-center gap-3 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
