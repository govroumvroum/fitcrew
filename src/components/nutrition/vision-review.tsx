"use client";

import { useMutation, useQuery } from "convex/react";
import { InfoIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MealSlot } from "../../../convex/nutrition";
import type { VisionIntent, VisionItem } from "../../../convex/vision";
import { SLOT_LABELS, SLOT_ORDER, parseNum, runMutation } from "./macros";

/**
 * The confirmation step between a photo analysis and the user's data: « corriger
 * et confirmer avant toute écriture » (issue #32). Nothing here is optional —
 * `api.vision.analyze` writes an unconfirmed row and this card is the ONLY path
 * from it to the food log or the inventory.
 *
 * Same shape as `import/extracted-review.tsx`, including why the committed state
 * is a subscription and not React state: the card lives in a permanent message
 * stream, so a reload would otherwise bring back every form, including the ones
 * already written.
 *
 * ponytail: no staggered entrance like the screenshot card's. A form the user has
 * to fill in wants to be there when they look, not arrive in six pieces.
 */

/** Which intents produce macros worth logging — see `normalizeVision`. */
const TO_LOG: readonly VisionIntent[] = ["plate", "label"];

const CONFIDENCE: Record<VisionItem["confidence"], string> = {
  low: "confiance faible",
  medium: "confiance moyenne",
  high: "confiance élevée",
};

/**
 * Numbers are edited as strings: an empty field has to stay empty rather than
 * snapping to 0, and a French keyboard offers a comma.
 */
type Row = {
  name: string;
  quantity: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  confidence: VisionItem["confidence"];
  needsConfirmation: boolean;
};

const NUMS = [
  { key: "calories", label: "kcal" },
  { key: "protein", label: "P (g)" },
  { key: "carbs", label: "G (g)" },
  { key: "fat", label: "L (g)" },
] as const satisfies readonly { key: keyof Row; label: string }[];

const toRow = (item: VisionItem): Row => ({
  name: item.name,
  quantity: item.quantityEstimate ?? "",
  calories: item.calories === undefined ? "" : String(item.calories),
  protein: item.macros === undefined ? "" : String(item.macros.protein),
  carbs: item.macros === undefined ? "" : String(item.macros.carbs),
  fat: item.macros === undefined ? "" : String(item.macros.fat),
  confidence: item.confidence,
  needsConfirmation: item.needsConfirmation,
});

/** Back to what the confirm mutations validate. Blank stays absent, not zero —
 *  `confirmToLog` already knows how to treat a missing figure. */
function toItem(row: Row): VisionItem {
  const filled = (raw: string) => raw.trim() !== "";
  const hasMacros = filled(row.protein) || filled(row.carbs) || filled(row.fat);
  return {
    name: row.name.trim(),
    ...(filled(row.quantity) && { quantityEstimate: row.quantity.trim() }),
    ...(filled(row.calories) && { calories: parseNum(row.calories) }),
    ...(hasMacros && {
      macros: {
        protein: parseNum(row.protein),
        carbs: parseNum(row.carbs),
        fat: parseNum(row.fat),
      },
    }),
    confidence: row.confidence,
    // The user has now seen and edited this line, so it no longer needs their
    // confirmation — that's what pressing the button means.
    needsConfirmation: false,
  };
}

export function VisionReview({
  analysisId,
  intent,
  items,
  warnings,
}: {
  analysisId: Id<"visionAnalyses">;
  intent: VisionIntent;
  items: VisionItem[];
  warnings: string[];
}) {
  const confirmToLog = useMutation(api.vision.confirmToLog);
  const confirmToInventory = useMutation(api.vision.confirmToInventory);
  const discard = useMutation(api.vision.discard);
  // `null` = discarded (the row is gone), `confirmed` = already written. With
  // local state only, a reload brought every form back.
  const status = useQuery(api.vision.status, { analysisId });
  const today = useLocalDate();
  const id = useId();

  const [rows, setRows] = useState(() => items.map(toRow));
  const [slot, setSlot] = useState<MealSlot>("dejeuner");
  const [pending, setPending] = useState(false);

  const toLog = TO_LOG.includes(intent);

  function patch(i: number, changes: Partial<Row>) {
    setRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...changes } : row)));
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setPending(true);
    // No local `done` flag: the `status` subscription reports the new state.
    await runMutation(action, ok);
    setPending(false);
  }

  if (status === undefined) return <Skeleton className="h-24 w-full" />;

  if (status === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Analyse abandonnée, rien n&apos;a été enregistré.
      </p>
    );
  }
  if (status.confirmed) {
    return (
      <p className="text-sm text-muted-foreground">
        {toLog ? "Ajouté à ton journal." : "Ajouté à ton inventaire."}
      </p>
    );
  }

  return (
    <div className="w-full space-y-3">
      {rows.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Voilà ce que j&apos;ai cru voir. Corrige ce qui est faux, puis valide — rien n&apos;est
          enregistré avant.
        </p>
      ) : (
        // An unusable photo goes through this card too, not through a bare
        // sentence: the row and its uploaded blob need the discard button, and
        // the user needs somewhere to go.
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Je n&apos;ai rien pu identifier de fiable sur cette photo. Réessaie avec une photo plus
            nette, ou dis-moi ce qu&apos;il y a — je l&apos;ajoute à la main.
          </p>
          {toLog && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/nutrition">Saisir à la main</Link>
            </Button>
          )}
        </div>
      )}

      {/* The photo itself, so "is this right?" can be answered by looking. Plain
          <img>: the URL is a signed Convex storage link, not a known host
          next/image could be configured for. */}
      {status.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={status.url}
          alt="Ce qui a été analysé"
          className="max-h-48 w-auto rounded-md outline outline-white/10"
        />
      )}

      <Warnings warnings={warnings} />

      {rows.map((row, i) => (
        // Vision items have no stable id; the list only shrinks via the remove
        // button, so the index is a fine key here.
        <Card key={i} className="gap-0 py-3">
          <CardContent className="space-y-3 px-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{CONFIDENCE[row.confidence]}</Badge>
              {row.needsConfirmation && (
                <Badge variant="outline" className="font-normal">
                  à vérifier
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                // 28px is the right visual weight next to a badge, but not a
                // thumb target: the pseudo-element takes the hit area to 44px.
                className="relative ml-auto size-7 text-muted-foreground after:absolute after:-inset-2"
                aria-label="Retirer cette ligne"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-name-${i}`} className="text-[11px] text-muted-foreground">
                Aliment
              </Label>
              <Input
                id={`${id}-name-${i}`}
                value={row.name}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-q-${i}`} className="text-[11px] text-muted-foreground">
                Quantité estimée
              </Label>
              <Input
                id={`${id}-q-${i}`}
                value={row.quantity}
                placeholder="une poignée, ≈150 g…"
                onChange={(e) => patch(i, { quantity: e.target.value })}
              />
            </div>

            {/* Inventory intents deliberately carry no macros — a jar of mustard
                on a shelf is not a meal (see `normalizeVision`). */}
            {toLog && (
              <div className="grid grid-cols-4 gap-2">
                {NUMS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Label
                      htmlFor={`${id}-${key}-${i}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {label}
                    </Label>
                    <Input
                      id={`${id}-${key}-${i}`}
                      inputMode="decimal"
                      value={row[key]}
                      placeholder="?"
                      className="tabular-nums"
                      onChange={(e) => patch(i, { [key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {toLog && rows.length > 0 && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-slot`} className="text-[11px] text-muted-foreground">
              Repas
            </Label>
            <Select value={slot} onValueChange={(v) => setSlot(v as MealSlot)}>
              <SelectTrigger id={`${id}-slot`} className="h-11 w-full text-base sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLOT_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Les calories et les macros lues sur une photo sont des estimations, pas des mesures.
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {rows.length > 0 &&
          (toLog ? (
            <Button
              size="sm"
              // `today` is null on the server and the first paint, and the log
              // needs the user's local date, never the server's.
              disabled={pending || today === null}
              onClick={() =>
                void run(
                  () =>
                    confirmToLog({
                      analysisId,
                      date: today as string,
                      slot,
                      items: rows.map(toItem),
                    }),
                  "Ajouté à ton journal.",
                )
              }
            >
              Ajouter au journal
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                void run(
                  () => confirmToInventory({ analysisId, items: rows.map(toItem) }),
                  "Ajouté à ton inventaire.",
                )
              }
            >
              Ajouter à mon inventaire
            </Button>
          ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => void run(() => discard({ analysisId }), "Analyse abandonnée.")}
        >
          Abandonner
        </Button>
      </div>
    </div>
  );
}

/**
 * The model's own caveats: "image floue", the overhead-angle problem, and the
 * « ces valeurs viennent d'Open Food Facts » line. They are the difference
 * between a number to check and a number to trust, so they render above the form.
 */
function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <ul className="space-y-1 rounded-md bg-muted/40 p-2">
      {warnings.map((warning) => (
        <li key={warning} className="flex gap-2 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}
