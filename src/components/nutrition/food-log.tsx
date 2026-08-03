"use client";

import { useMutation, useQuery } from "convex/react";
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { formatShort, fromDate } from "@/lib/dates";
import { formatNumber } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { Macros, MealSlot } from "../../../convex/nutrition";
import { SLOT_LABELS, SLOT_ORDER, groupBySlot, macroLine, parseNum, runMutation } from "./macros";

/**
 * Le journal alimentaire. Deliberately independent of the plan and of the
 * profile: issue #31 says it stays usable for someone who never asked the Chef
 * for a menu, so nothing here reads `todayMeals` or `targets`.
 *
 * `log` comes from the dashboard subscription rather than a second query — same
 * data, one websocket subscription, and the two can't disagree mid-render.
 */

type Fields = { quantity: string; calories: string; protein: string; carbs: string; fat: string };

const EMPTY: Fields = { quantity: "", calories: "", protein: "", carbs: "", fat: "" };

const NUMS = [
  { key: "calories", label: "kcal" },
  { key: "protein", label: "P (g)" },
  { key: "carbs", label: "G (g)" },
  { key: "fat", label: "L (g)" },
] as const;

const macrosOf = (f: Fields): Macros => ({
  calories: parseNum(f.calories),
  protein: parseNum(f.protein),
  carbs: parseNum(f.carbs),
  fat: parseNum(f.fat),
});

const fieldsOf = (entry: Doc<"foodLog">): Fields => ({
  quantity: entry.quantity ?? "",
  calories: String(entry.macros.calories),
  protein: String(entry.macros.protein),
  carbs: String(entry.macros.carbs),
  fat: String(entry.macros.fat),
});

/** Quantity plus the four figures. Shared by the add form and the inline edit —
 *  the two ask for exactly the same numbers. */
function MacroFields({ value, onChange }: { value: Fields; onChange: (next: Fields) => void }) {
  const id = useId();

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-q`} className="text-[11px] text-muted-foreground">
          Quantité
        </Label>
        <Input
          id={`${id}-q`}
          value={value.quantity}
          placeholder="1 bol, 150 g…"
          onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        />
      </div>
      {/* Four across at 390px: ~85px a cell, enough for "1 200" in a number
          field. Estimations, so nobody types decimals here. */}
      <div className="grid grid-cols-4 gap-2">
        {NUMS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`${id}-${key}`} className="text-[11px] text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`${id}-${key}`}
              inputMode="decimal"
              value={value[key]}
              placeholder="0"
              className="tabular-nums"
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </>
  );
}

/** « Ajouter un repas » — reachable with no plan, no profile, nothing. */
function QuickAdd({ today }: { today: string }) {
  const addLogEntry = useMutation(api.nutrition.addLogEntry);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<MealSlot>("dejeuner");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const id = useId();

  if (!open) {
    return (
      <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" aria-hidden />
        Ajouter un repas
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        await runMutation(
          () =>
            addLogEntry({
              date: today,
              slot,
              name: trimmed,
              ...(fields.quantity.trim() && { quantity: fields.quantity.trim() }),
              macros: macrosOf(fields),
              source: "manual",
            }),
          "Ajouté au journal.",
        );
        setName("");
        setFields(EMPTY);
        setOpen(false);
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`} className="text-[11px] text-muted-foreground">
          Ce que tu as mangé
        </Label>
        <Input
          id={`${id}-name`}
          value={name}
          required
          placeholder="Poulet riz brocolis"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

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

      <MacroFields value={fields} onChange={setFields} />

      {/* Zeros are allowed through: "j'ai mangé une pomme" with no numbers is
          still a logged meal, and demanding four figures is the friction the
          issue asks us to remove. */}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1">
          Ajouter
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function EntryRow({ entry, today }: { entry: Doc<"foodLog">; today: string }) {
  const updateLogEntry = useMutation(api.nutrition.updateLogEntry);
  const deleteLogEntry = useMutation(api.nutrition.deleteLogEntry);
  const duplicateLogEntry = useMutation(api.nutrition.duplicateLogEntry);
  const [fields, setFields] = useState<Fields | null>(null);

  if (fields) {
    return (
      <li className="flex flex-col gap-3 rounded-md bg-muted/40 p-2.5">
        <p className="text-sm font-medium">{entry.name}</p>
        <MacroFields value={fields} onChange={setFields} />
        <div className="flex gap-2">
          <Button
            className="h-11 flex-1"
            onClick={async () => {
              await runMutation(
                () =>
                  updateLogEntry({
                    id: entry._id,
                    quantity: fields.quantity.trim(),
                    macros: macrosOf(fields),
                  }),
                "Modifié.",
              );
              setFields(null);
            }}
          >
            Enregistrer
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setFields(null)}>
            Annuler
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {entry.name}
          {entry.quantity ? (
            <span className="text-muted-foreground"> · {entry.quantity}</span>
          ) : null}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">{macroLine(entry.macros)}</p>
      </div>
      {/* Icon-only at 44px: three labelled buttons per row don't fit a 390px
          phone, and the actions repeat on every row so the words would be noise. */}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label={`Dupliquer ${entry.name}`}
        onClick={() =>
          runMutation(
            () => duplicateLogEntry({ id: entry._id, date: today, slot: entry.slot }),
            "Dupliqué.",
          )
        }
      >
        <CopyIcon className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label={`Modifier ${entry.name}`}
        onClick={() => setFields(fieldsOf(entry))}
      >
        <PencilIcon className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground"
        aria-label={`Supprimer ${entry.name}`}
        onClick={() => runMutation(() => deleteLogEntry({ id: entry._id }), "Supprimé.")}
      >
        <Trash2Icon className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/** The last two weeks, today excluded — today is the list right above. */
function History({ today }: { today: string }) {
  const days = useQuery(api.nutrition.history, { from: fromDate(today, 14), to: today });

  if (days === undefined) return <Skeleton className="h-24" />;

  const past = days.filter((day) => day.date !== today);
  if (past.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Rien de logué avant aujourd&apos;hui. L&apos;historique se remplit tout seul.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {past.map((day) => (
        <li key={day.date} className="flex min-h-11 items-center gap-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1 truncate tabular-nums">{formatShort(day.date)}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {day.entries} entrée{day.entries > 1 ? "s" : ""}
          </span>
          <span className="min-w-24 shrink-0 text-right font-semibold tabular-nums">
            {formatNumber(day.consumed.calories)} kcal
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FoodLog({ today, log }: { today: string; log: Doc<"foodLog">[] }) {
  const groups = groupBySlot(log);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[1.05rem] font-bold">Journal du jour</h2>
        <p className="text-sm text-muted-foreground">
          Valeurs estimées. Pas la peine de viser le gramme.
        </p>
      </div>

      <QuickAdd today={today} />

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Rien de logué aujourd&apos;hui. Un repas suffit pour commencer.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.slot} className="flex flex-col gap-1">
            <p className="eyebrow">{SLOT_LABELS[group.slot]}</p>
            <ul className="divide-y">
              {group.entries.map((entry) => (
                <EntryRow key={entry._id} entry={entry} today={today} />
              ))}
            </ul>
          </div>
        ))
      )}

      <div className="mt-2">
        <h2 className="text-[1.05rem] font-bold">Jours précédents</h2>
        {/* ponytail: totals per day, not the entries. Re-logging an old meal goes
            through today's rows above ("dupliquer"), which is where the thing you
            eat every morning already is. Expand a day here if the two weeks-old
            meal turns out to be what people want back. */}
        <p className="mb-2 text-sm text-muted-foreground">Sur les deux dernières semaines</p>
        <History today={today} />
      </div>
    </section>
  );
}
