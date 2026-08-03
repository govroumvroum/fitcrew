"use client";

import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/utils";
import type { Macros, MealSlot } from "../../../convex/nutrition";

/**
 * Shared nutrition display bits: the slot vocabulary, the arithmetic behind the
 * bars, and the bars themselves. Both /nutrition's dashboard and its journal read
 * from here so a kcal figure is spelled the same way twice.
 *
 * Type-only import from convex/nutrition — erased at compile, so the Convex
 * server runtime never reaches the browser bundle (same trick as challenges.tsx).
 */

/** Chronological, matching SLOT_ORDER in convex/nutrition.ts. */
export const SLOT_ORDER = ["petit_dejeuner", "dejeuner", "collation", "diner"] as const;

export const SLOT_LABELS: Record<MealSlot, string> = {
  petit_dejeuner: "Petit-déjeuner",
  dejeuner: "Déjeuner",
  collation: "Collation",
  diner: "Dîner",
};

/**
 * Fill percentage for a bar, 0…100. Clamped at the top on purpose: 150 % of a
 * target must render a full bar, not a 1.5× wide one overflowing its track. An
 * absent or zero target reads as 0 rather than dividing by it.
 */
export function pct(consumed: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.max(0, (consumed / target) * 100));
}

/**
 * What's left of a target. Negative means over — the caller words it, because
 * whether over is bad depends on the goal and the app doesn't get to decide.
 * `null` when there's no target to count down from.
 */
export function remaining(consumed: number, target: number): number | null {
  return target > 0 ? Math.round(target - consumed) : null;
}

/** "520 kcal · P 32 g · G 60 g · L 12 g" — one meal or one entry, on one line. */
/**
 * The three macros without the energy figure, for callers that already show the
 * calories on their own (a card where the kcal is the headline number). Split out
 * rather than given a `calories: false` flag: a boolean parameter at a call site
 * reads as a mystery, `macrosOnly` doesn't.
 */
export function macrosOnly(m: Macros): string {
  return [
    `P ${formatNumber(m.protein)} g`,
    `G ${formatNumber(m.carbs)} g`,
    `L ${formatNumber(m.fat)} g`,
  ].join(" · ");
}

export function macroLine(m: Macros): string {
  return `${formatNumber(m.calories)} kcal · ${macrosOnly(m)}`;
}

/**
 * Entries bucketed by meal slot, in chronological slot order. Empty slots are
 * dropped: a journal showing four headings with nothing under three of them is
 * mostly headings.
 */
export function groupBySlot<T extends { slot: MealSlot }>(
  entries: T[],
): { slot: MealSlot; entries: T[] }[] {
  return SLOT_ORDER.map((slot) => ({
    slot,
    entries: entries.filter((entry) => entry.slot === slot),
  })).filter((group) => group.entries.length > 0);
}

/** "12" -> 12, "12,5" -> 12.5, "" or junk -> 0. Typing a comma is what a French
 *  phone keyboard offers, and a NaN in a macros object is a failed mutation. */
export function parseNum(raw: string): number {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Every write on /nutrition, wrapped: a toast on success, the server's message on
 * failure. No optimistic state — the dashboard subscription reports the new value
 * before the toast is read, and local copies of server data drift.
 */
export async function runMutation(action: () => Promise<unknown>, ok: string) {
  try {
    await action();
    toast.success(ok);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Ça a raté, réessaie.");
  }
}

const ROWS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protéines", unit: "g" },
  { key: "carbs", label: "Glucides", unit: "g" },
  { key: "fat", label: "Lipides", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

/**
 * Consumed vs target for the four figures, one bar each.
 *
 * ponytail: four flat bars, not rings and not recharts. A ring needs a legend to
 * say which arc is which; these are four labelled rows and the numbers are right
 * there. chart-1 rather than the default red: the red on this screen is spoken
 * for by the CTA (same reasoning as Today's session progress).
 *
 * `targets: null` = no nutrition profile yet. Then there is nothing to divide by,
 * so it prints the totals and no bars.
 */
export function MacroProgress({ consumed, targets }: { consumed: Macros; targets: Macros | null }) {
  return (
    <div className="flex flex-col gap-2.5">
      {ROWS.map(({ key, label, unit }) => {
        const target = targets?.[key] ?? 0;
        const left = remaining(consumed[key], target);
        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1">{label}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatNumber(consumed[key])}
                {target > 0 ? (
                  <span className="font-normal text-muted-foreground">
                    {" / "}
                    {formatNumber(target)}
                  </span>
                ) : null}{" "}
                {unit}
              </span>
            </div>
            {target > 0 ? (
              <>
                <Progress
                  value={pct(consumed[key], target)}
                  className="[&_[data-slot=progress-indicator]]:bg-chart-1"
                />
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {left === null
                    ? null
                    : left >= 0
                      ? `Reste ${formatNumber(left)} ${unit}`
                      : `Dépassé de ${formatNumber(-left)} ${unit}`}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
