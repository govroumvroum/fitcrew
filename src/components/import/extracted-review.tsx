"use client";

import { useMutation, useQuery } from "convex/react";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Entry } from "../../../convex/screenshots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const SOURCE_LABEL: Record<Entry["source"], string> = {
  apple_health: "Apple Santé",
  zepp: "Zepp",
  mi_fitness: "Mi Fitness",
};

const TYPE_LABEL: Record<Entry["type"], string> = {
  workout: "Muscu",
  cardio: "Cardio",
  bodyweight: "Pesée",
};

/** Numeric fields, in display order, with the label the user reads. */
const NUM_FIELDS = [
  ["duration_min", "Durée (min)"],
  ["distance_km", "Distance (km)"],
  ["avg_hr", "FC moy. (bpm)"],
  ["calories", "Calories (kcal)"],
  ["weight_kg", "Poids (kg)"],
  ["body_fat_pct", "Masse grasse (%)"],
  ["muscle_kg", "Masse musculaire (kg)"],
] as const satisfies readonly (readonly [keyof Entry, string])[];

type NumField = (typeof NUM_FIELDS)[number][0];

/**
 * Review card for one extraction. Renders inline (chat bubble, sheet, page) —
 * no page-level layout, no max width of its own.
 */
export function ExtractedReview({
  screenshotId,
  entries: initial,
  onDone,
}: {
  screenshotId: Id<"screenshots">;
  entries: Entry[];
  onDone?: () => void;
}) {
  const confirm = useMutation(api.screenshots.confirm);
  const discard = useMutation(api.screenshots.discard);
  // The card lives in a permanent message stream, so its state has to come from
  // the row, not from React: `null` = discarded (the row is deleted), `confirmed`
  // = already imported. With local state only, a reload brought every form back.
  const status = useQuery(api.screenshots.status, { screenshotId });
  const [entries, setEntries] = useState(initial);
  const [pending, setPending] = useState(false);

  function patch(i: number, changes: Partial<Entry>) {
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...changes } : e)));
  }

  function setNum(i: number, field: NumField, raw: string) {
    const n = Number.parseFloat(raw.replace(",", "."));
    patch(i, { [field]: Number.isFinite(n) && n > 0 ? n : undefined });
  }

  async function run(action: "saved" | "discarded") {
    setPending(true);
    try {
      if (action === "saved") {
        const { workouts, others } = await confirm({ screenshotId, entries });
        const added = workouts + others;
        toast.success(
          added > 0 ? `C'est enregistré — ${added} entrée(s) ajoutée(s).` : "C'est enregistré.",
        );
      } else {
        await discard({ screenshotId });
        toast("Import annulé.");
      }
      // No local `done` flag: the `status` subscription reports the new state.
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ça a raté, réessaie.");
    } finally {
      setPending(false);
    }
  }

  if (status === undefined) return <Skeleton className="h-24 w-full" />;

  // Row gone = discarded. Flag set = already committed. Either way the form is
  // over, and it stays over across reloads.
  if (status === null) {
    return (
      <p className="text-sm text-muted-foreground">Import annulé, rien n&apos;a été enregistré.</p>
    );
  }
  if (status.confirmed) {
    return <p className="text-sm text-muted-foreground">Données ajoutées à ton profil. 💪</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Je n'ai rien pu lire de fiable sur cette capture. Réessaie avec une capture plus nette, ou
          dis-moi les chiffres.
        </p>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run("discarded")}>
          OK, oublie
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Voilà ce que j'ai lu. Corrige ce qui est faux, puis valide — rien n'est enregistré avant.
      </p>

      {/* The capture itself, so "is this right?" can be answered by looking.
          Plain <img>: the URL is a signed Convex storage link, not a known host
          next/image could be configured for. */}
      {status.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={status.url}
          alt="La capture importée"
          className="max-h-48 w-auto rounded-md outline outline-white/10"
        />
      )}

      {entries.map((entry, i) => (
        // Extractions have no stable id; the list only shrinks via the remove
        // button, so the index is a fine key here.
        <Card key={i} className="gap-0 py-3">
          <CardContent className="space-y-3 px-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{TYPE_LABEL[entry.type]}</Badge>
              <span className="truncate text-xs text-muted-foreground">
                {SOURCE_LABEL[entry.source]}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 text-muted-foreground"
                aria-label="Retirer cette ligne"
                onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>

            <Field label="Date" htmlFor={`date-${i}`}>
              <Input
                id={`date-${i}`}
                type="date"
                value={entry.date}
                onChange={(e) => patch(i, { date: e.target.value })}
              />
            </Field>

            {/* Cardio only: the activity label the app showed. Editable because
                it's the one cardio field that's OCR'd text, not a number. */}
            {entry.type === "cardio" && (
              <Field label="Activité" htmlFor={`kind-${i}`}>
                <Input
                  id={`kind-${i}`}
                  value={entry.kind ?? ""}
                  placeholder="Course, vélo…"
                  onChange={(e) => patch(i, { kind: e.target.value })}
                />
              </Field>
            )}

            {NUM_FIELDS.filter(([f]) => entry[f] !== undefined).map(([field, label]) => (
              <Field key={field} label={label} htmlFor={`${field}-${i}`}>
                <Input
                  id={`${field}-${i}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  defaultValue={entry[field] as number}
                  onChange={(e) => setNum(i, field, e.target.value)}
                />
              </Field>
            ))}

            {entry.exercises?.map((ex, xi) => (
              <div key={xi} className="space-y-2">
                <Separator />
                <Input
                  aria-label="Nom de l'exercice"
                  value={ex.name}
                  onChange={(e) =>
                    patch(i, {
                      exercises: entry.exercises?.map((x, j) =>
                        j === xi ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                {ex.sets.map((set, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-xs text-muted-foreground">S{si + 1}</span>
                    {(["weight", "reps"] as const).map((k) => (
                      <Input
                        key={k}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        aria-label={k === "weight" ? "Charge en kg" : "Répétitions"}
                        placeholder={k === "weight" ? "kg" : "reps"}
                        defaultValue={set[k]}
                        onChange={(e) => {
                          const n = Number.parseFloat(e.target.value.replace(",", "."));
                          patch(i, {
                            exercises: entry.exercises?.map((x, j) =>
                              j !== xi
                                ? x
                                : {
                                    ...x,
                                    sets: x.sets.map((s, l) =>
                                      l === si ? { ...s, [k]: Number.isFinite(n) ? n : 0 } : s,
                                    ),
                                  },
                            ),
                          });
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run("saved")}>
          {pending ? "Enregistrement…" : "C'est bon, enregistre"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run("discarded")}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
