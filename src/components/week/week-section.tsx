"use client";

import { useMutation, useQuery } from "convex/react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import {
  type DayLevel,
  DAY_LEVELS,
  LEVEL_LABEL,
  MAX_PER_DAY,
  WEEKDAYS,
  entriesOn,
  weekdayOf,
} from "../../../convex/weekTemplate";
import { type ShownEntry, WeekRows } from "./week-rows";

/**
 * /programme's « Ma semaine » (#118): which weekdays he trains, at what level
 * and when. The Coach writes the same template with `set_week_template`; both go
 * through `api.week.save`, which replaces the whole week — so a day edited here
 * is sent back with the six others untouched.
 *
 * It never touches the rotation: the template says WHICH days, the program says
 * WHICH séance.
 */

type ActiveProgram = { lineageId: string; name: string };

const MOMENTS = ["matin", "midi", "soir"] as const;
const MAX_KIND = 40;

export function WeekSection({ date, programs }: { date: string; programs: ActiveProgram[] }) {
  const template = useQuery(api.week.template, {});
  const [editing, setEditing] = useState<number | null>(null);

  const loaded = template !== undefined;
  // /nutrition links to `/programme#ma-semaine`. The section only exists once
  // the query lands — after the browser already looked for the anchor — so
  // scroll to it ourselves.
  useEffect(() => {
    if (loaded && location.hash === "#ma-semaine")
      document.getElementById("ma-semaine")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (template === undefined) return <Skeleton className="h-80" />;
  const entries: ShownEntry[] = template?.entries ?? [];

  return (
    <section
      id="ma-semaine"
      className="flex scroll-mt-4 flex-col gap-2 rounded-lg border bg-card/55 p-3.5"
    >
      <div>
        <p className="eyebrow">Ma semaine</p>
        <p className="text-sm text-muted-foreground">
          {entries.length === 0
            ? "Dis quels jours tu t'entraînes : le Chef cale tes repas dessus. Touche un jour pour le remplir."
            : "Les jours où tu t'entraînes. Le Chef cale tes repas dessus. La rotation, elle, ne bouge pas."}
        </p>
      </div>
      <WeekRows entries={entries} onPick={setEditing} today={weekdayOf(date)} />
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null ? (
          <DayEditor
            // Remounted per day, so a draft never carries over to another day.
            key={editing}
            weekday={editing}
            entries={entries}
            programs={programs}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </section>
  );
}

type Draft = { kind: string; lineageId?: string; level: DayLevel; time?: string };

const toDraft = (entry: ShownEntry): Draft => ({
  kind: entry.kind,
  level: entry.level,
  ...(entry.lineageId ? { lineageId: entry.lineageId } : {}),
  ...(entry.time ? { time: entry.time } : {}),
});

function DayEditor({
  weekday,
  entries,
  programs,
  onDone,
}: {
  weekday: number;
  entries: ShownEntry[];
  programs: ActiveProgram[];
  onDone: () => void;
}) {
  const save = useMutation(api.week.save);
  const [draft, setDraft] = useState<Draft[]>(() => entriesOn(entries, weekday).map(toDraft));
  const [saving, setSaving] = useState(false);
  // An archived program in the template keeps its entry: offer it as a chip too,
  // or editing its time would silently drop the link to it.
  const known = new Map(programs.map((p) => [p.lineageId, p.name]));
  for (const entry of entries)
    if (entry.lineageId && entry.program && !known.has(entry.lineageId))
      known.set(entry.lineageId, entry.program.name);

  const update = (index: number, patch: Partial<Draft>) =>
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const submit = () => {
    const blank = draft.findIndex((row) => row.kind.trim() === "");
    if (blank >= 0) {
      toast.error("Donne un nom à chaque séance, ou retire-la.");
      return;
    }
    // The whole week goes back: `save` replaces it, so the six other days are
    // sent as they are. Keys set to undefined by a chip are dropped, not sent.
    const all = [
      ...entries
        .filter((entry) => entry.weekday !== weekday)
        .map((entry) => ({ ...toDraft(entry), weekday: entry.weekday })),
      ...draft.map((row) => ({ ...toDraft({ ...row, weekday }), weekday })),
    ];
    setSaving(true);
    void save({ entries: all })
      .then((result) => {
        if (result.result === "refused") toast.error(result.error);
        // No success toast: the sheet closing on the updated row says it, and a
        // toast sat over the next day's « Enregistrer » for four seconds.
        else onDone();
      })
      .catch(() => toast.error("Pas enregistré, réessaie."))
      .finally(() => setSaving(false));
  };

  return (
    <SheetContent side="bottom" className="max-h-[90dvh] gap-3 overflow-y-auto rounded-t-xl p-4">
      <SheetHeader className="p-0 pr-10">
        <SheetTitle className="text-lg font-semibold">{capitalize(WEEKDAYS[weekday])}</SheetTitle>
        <SheetDescription>
          Ce que tu fais ce jour-là. Sans séance, c&apos;est un jour off.
        </SheetDescription>
      </SheetHeader>

      {draft.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Repos. Ajoute une séance si tu t&apos;entraînes ce jour-là.
        </p>
      ) : null}

      {draft.map((row, index) => (
        <fieldset key={index} className="flex flex-col gap-3 rounded-lg border bg-card/55 p-3">
          <legend className="sr-only">Séance {index + 1}</legend>
          <div className="flex items-center gap-2">
            <Input
              value={row.kind}
              maxLength={MAX_KIND}
              placeholder="boxe, muscu, course…"
              aria-label="Séance"
              className="h-11 flex-1"
              onChange={(event) => update(index, { kind: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Retirer cette séance"
              onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trash2Icon className="size-4" aria-hidden />
            </Button>
          </div>

          {known.size > 0 ? (
            <Chips label="Programme">
              <Chip
                pressed={!row.lineageId}
                onClick={() => update(index, { lineageId: undefined })}
              >
                Aucun
              </Chip>
              {[...known].map(([lineageId, name]) => (
                <Chip
                  key={lineageId}
                  pressed={row.lineageId === lineageId}
                  onClick={() =>
                    update(index, {
                      lineageId,
                      // Picking a program names the séance after it, unless
                      // he already wrote something.
                      // « Gainage — 1 jour, 20 min » → « Gainage »: the part
                      // before the dash is the name, the rest is its spec.
                      kind: row.kind.trim() ? row.kind : shortName(name),
                    })
                  }
                >
                  <span className="truncate">{name}</span>
                </Chip>
              ))}
            </Chips>
          ) : null}

          <Chips label="Niveau">
            {DAY_LEVELS.map((level) => (
              <Chip
                key={level}
                pressed={row.level === level}
                onClick={() => update(index, { level })}
              >
                {LEVEL_LABEL[level]}
              </Chip>
            ))}
          </Chips>

          <Chips label="Moment">
            <Chip pressed={!row.time} onClick={() => update(index, { time: undefined })}>
              —
            </Chip>
            {MOMENTS.map((moment) => (
              <Chip
                key={moment}
                pressed={row.time === moment}
                onClick={() => update(index, { time: moment })}
              >
                {capitalize(moment)}
              </Chip>
            ))}
            <Input
              type="time"
              aria-label="Heure précise"
              className="h-11 w-28"
              value={row.time && /^\d{2}:\d{2}$/.test(row.time) ? row.time : ""}
              onChange={(event) => update(index, { time: event.target.value || undefined })}
            />
          </Chips>
        </fieldset>
      ))}

      {draft.length < MAX_PER_DAY ? (
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setDraft((rows) => [...rows, { kind: "", level: "dur" }])}
        >
          <PlusIcon className="size-4" aria-hidden />
          Ajouter une séance
        </Button>
      ) : null}

      <Button size="lg" className="h-14 text-base" disabled={saving} onClick={submit}>
        Enregistrer
      </Button>
    </SheetContent>
  );
}

function Chips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="eyebrow mb-1.5">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      size="sm"
      aria-pressed={pressed}
      className={cn(
        "h-auto min-h-11 max-w-60 px-3.5 text-sm",
        pressed && "border-primary/50 ring-1 ring-primary/30",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

const shortName = (name: string) => (name.split(/\s+[—–-]\s+/)[0] ?? name).slice(0, MAX_KIND).trim();

const capitalize =(text: string) => text.charAt(0).toUpperCase() + text.slice(1);
