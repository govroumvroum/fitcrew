"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExerciseDemo, useExerciseDemos } from "@/components/workout/demo";
import { formatDay, useLocalDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

/** "45 s" · "2 min" · "1 min 30" — a rest is read, not computed. */
const restLabel = (s: number) =>
  s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60}`;

/** "Jour 1 — Haut du corps" → "Haut du corps", for the cramped rotation slots. */
const shortLabel = (name: string) => name.split("—")[1]?.trim() ?? name;

type Program = (typeof api.programs.list)["_returnType"][number];
type Status = Program["status"];

const STATUS_LABEL: Record<Status, string> = {
  active: "En cours",
  archived: "Archivé",
  completed: "Terminé",
};

export default function ProgrammePage() {
  const date = useLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col pb-[var(--tab-bar)] md:max-w-4xl">
      {date ? <Programme date={date} /> : <Skeleton className="m-4 h-64" />}
    </main>
  );
}

function Programme({ date }: { date: string }) {
  const programs = useQuery(api.programs.list, { date });
  const setStatus = useMutation(api.programs.setStatus);
  const share = useMutation(api.shares.share);
  const unshare = useMutation(api.shares.unshare);
  // lineageId → code, for labelling which programs already have a live link.
  const shares = useQuery(api.shares.mine, {});
  const shareCodes = new Map(shares?.map((row) => [row.lineageId, row.code]));

  // Unconditional (hook rules). ponytail: resolves every name of every program
  // at once instead of per open day — resolution is cached per name server-side,
  // so it's paid once for the app's lifetime, and no GIF loads until a sheet
  // opens.
  const demoUrlFor = useExerciseDemos([
    ...new Set(
      programs
        ?.filter((program) => program.status === "active")
        .flatMap((program) => program.days.flatMap((day) => day.exercises.map((it) => it.name))) ??
        [],
    ),
  ]);

  if (programs === undefined) return <Skeleton className="m-4 h-64" />;
  if (programs.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {/* The loaded branch gets its h1 from the page header; this one had none. */}
        <h1 className="sr-only">Programme</h1>
        <p>Pas encore de programme. Le coach t&apos;en écrit un quand tu veux.</p>
        <Button asChild size="lg" className="mt-4 h-14 w-full text-base">
          <Link href="/coach">Passe voir le coach</Link>
        </Button>
      </div>
    );
  }

  // `setStatus` keys on the LINEAGE, not on the row `id` — the row changes every
  // time the coach swaps an exercise, the lineage is the program.
  const change = (program: Program, status: Status) => {
    void setStatus({ lineageId: program.lineageId, status }).catch(() =>
      toast.error("Statut pas changé, réessaie."),
    );
  };

  const copyLink = (code: string) => {
    void navigator.clipboard
      .writeText(`${location.origin}/p/${code}`)
      .then(() => toast.success("Lien copié"))
      .catch(() => toast.error("Copie impossible, réessaie."));
  };

  // Share then copy in one tap: the code is the mutation's return value, so
  // there's nothing to wait for a subscription on.
  const shareProgram = (program: Program) =>
    share({ lineageId: program.lineageId })
      .then(copyLink)
      .catch(() => toast.error("Partage impossible, réessaie."));

  const unshareProgram = (program: Program) => {
    void unshare({ lineageId: program.lineageId })
      .then(() => toast.success("Lien révoqué"))
      .catch(() => toast.error("Pas révoqué, réessaie."));
  };

  const active = programs.filter((program) => program.status === "active");
  const past = programs.filter((program) => program.status !== "active");

  return (
    <div className="flex flex-col gap-6 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          {programs.length > 1 ? "Tes programmes" : "Ton programme"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {active.length > 1
            ? "Ils tournent en parallèle : chacun a sa propre rotation, un jour par séance, et aucun n'attend l'autre."
            : "Les jours tournent dans l'ordre, un par séance, quand tu t'entraînes. Pas de calendrier, pas de retard possible."}
        </p>
      </header>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun programme actif. Réactive-en un ci-dessous, ou demande-en un neuf au coach.
        </p>
      ) : (
        active.map((program) => (
          <ProgramSection
            key={program.lineageId}
            program={program}
            demoUrlFor={demoUrlFor}
            onStatus={change}
            shareCode={shareCodes.get(program.lineageId) ?? null}
            onShare={shareProgram}
            onUnshare={unshareProgram}
            onCopyLink={copyLink}
          />
        ))
      )}

      {past.length > 0 ? (
        // ponytail: native <details> again. Archived programs are kept, not
        // shown — a name, a version and a way back is all they owe.
        <details className="group rounded-lg border bg-card/45 p-3.5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground marker:hidden">
            <ChevronDownIcon className="chevron" />
            Archivés et terminés
            <Badge variant="secondary" className="ml-auto shrink-0 tabular-nums">
              {past.length}
            </Badge>
          </summary>
          <ul className="mt-1 divide-y">
            {past.map((program) => (
              <li key={program.lineageId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-muted-foreground">
                    {program.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {STATUS_LABEL[program.status]} ·{" "}
                    <span className="tabular-nums">{program.dayCount}</span> jour
                    {program.dayCount > 1 ? "s" : ""} ·{" "}
                    <span className="tabular-nums">v{program.version}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-11 shrink-0 px-3 active:scale-[0.98]"
                  onClick={() => change(program, "active")}
                >
                  Réactiver
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Read-only page: the programs belong to the coach, which owns writing a
          new one and swapping exercises. Nothing to edit here, just somewhere to
          ask. ponytail: plain navigation, no composed message — nothing in
          /coach reads a prefill (only `?thread=`), and inventing one would mean
          a backend protocol this screen has no business owning. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Un exercice qui ne passe pas, du matériel en moins, une séance trop longue&#8239;? Tu ne
          modifies pas le programme, tu le dis au coach et il le réécrit.
        </p>
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/coach">Demander un changement au coach</Link>
        </Button>
      </div>
    </div>
  );
}

function ProgramSection({
  program,
  demoUrlFor,
  onStatus,
  shareCode,
  onShare,
  onUnshare,
  onCopyLink,
}: {
  program: Program;
  demoUrlFor: (name: string) => string | null;
  onStatus: (program: Program, status: Status) => void;
  shareCode: string | null;
  onShare: (program: Program) => Promise<unknown>;
  onUnshare: (program: Program) => void;
  onCopyLink: (code: string) => void;
}) {
  // Which day is expanded — the only state here. The program is the coach's
  // document: no draft, no dirty flag, no save.
  const [opened, setOpened] = useState<number | null>(null);
  // A double-tap on Partager is two mints; the second one would be a second live
  // link for the same program. One tap at a time.
  const [sharing, setSharing] = useState(false);

  const { days, nextDayIndex } = program;
  const openDay = opened ?? nextDayIndex;
  // A one-slot rotation isn't a cycle, so drawing it as one would lie. Below
  // that threshold the day itself carries the section.
  const isLoop = days.length > 1;
  const totalSets = days.reduce(
    (sum, day) => sum + day.exercises.reduce((n, ex) => n + ex.sets, 0),
    0,
  );
  // A set costs its rest plus ~35 s of work. Estimated from the prescription,
  // never presented as a measurement — hence the caveat under the numbers.
  const avgMinutes =
    days.reduce(
      (sum, day) => sum + day.exercises.reduce((n, ex) => n + ex.sets * (ex.restSeconds + 35), 0),
      0,
    ) /
    60 /
    days.length;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <p className="eyebrow min-w-0 flex-1">
            Écrit par le coach · le{" "}
            <span className="tabular-nums">
              {formatDay(new Date(program.createdAt).toISOString().slice(0, 10))}
            </span>
          </p>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            v{program.version}
          </Badge>
        </div>
        {/* No font-heading/tracking here: the base layer already gives h1–h3 the
            display face and -0.01em. */}
        <h2 className="text-2xl font-semibold">{program.name}</h2>
      </header>

      {/* Where you are in the loop. A program has no calendar, so the shape is a
          rotation you're standing in — a slot opens its day below, nothing more.
          It must never grow into a week view. */}
      <div className={cn("flex flex-col gap-3", isLoop && "slab")}>
        <div className="min-w-0">
          <p className="eyebrow">{isLoop ? "La rotation" : "Un seul jour, répété à chaque séance"}</p>
          {isLoop ? (
            <p className="text-sm text-muted-foreground">
              Le jour qui vient, puis le suivant. Tu ne peux pas être en retard sur une boucle.
            </p>
          ) : null}
        </div>
        {isLoop ? (
          <div className="grid auto-cols-fr grid-flow-col gap-[3px]">
            {days.map((day, index) => {
              const next = index === nextDayIndex;
              const offset = (index - nextDayIndex + days.length) % days.length;
              return (
                <button
                  key={day.name}
                  type="button"
                  onClick={() => setOpened(index)}
                  aria-label={
                    next
                      ? `${day.name} — à suivre`
                      : `${day.name}, dans ${offset} séance${offset > 1 ? "s" : ""}`
                  }
                  className={cn(
                    "flex h-26 flex-col justify-between rounded-sm border bg-card/45 px-2 py-2 text-left text-muted-foreground transition-[color,background-color,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                    // Hover is gated: on this touch-first PWA a tap leaves the
                    // hover state stuck, so a second slot reads highlighted next
                    // to the real `next` one.
                    "pointer-fine:hover:bg-secondary pointer-fine:hover:text-foreground",
                    // The readable brand hue, not the commit red: the saturated
                    // accent is rationed to the "À suivre" chip and the one button.
                    next && "border-accent-text/50 bg-accent text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      // text-base, not an arbitrary 1.05rem: the 0.8px it bought
                      // was invisible and the scale is 10/11/14/16. The `next`
                      // numeral stays off-scale on purpose — it's a display
                      // numeral, the same register as .hero-num.
                      "block font-heading text-base font-bold leading-none",
                      next && "text-[2rem] font-extrabold leading-[0.85]",
                    )}
                  >
                    {index + 1}
                  </span>
                  {/* No `block`: it fights line-clamp's display:-webkit-box and
                      the clamp stops applying, so the slot ran to 4 lines. */}
                  <span className="line-clamp-2 text-[10px] uppercase leading-tight tracking-[0.04em]">
                    {shortLabel(day.name)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-start md:gap-5">
        <div className="flex flex-col gap-2.5">
          {days.map((day, index) => {
            const next = index === nextDayIndex;
            const sets = day.exercises.reduce((n, ex) => n + ex.sets, 0);
            return (
              // ponytail: native <details>, same reason as everywhere else here —
              // one expandable row doesn't need a component. `open` is driven so
              // the rotation strip can reveal a day; the toggle handler only
              // reacts to opening, so closing by hand sticks (React's own value
              // hasn't changed, so it won't re-open it).
              <details
                key={day.name}
                open={index === openDay}
                onToggle={(event) => {
                  if (event.currentTarget.open) setOpened(index);
                }}
                // min-w-0 is load-bearing: a grid item defaults to min-width:auto,
                // so without it this column widens to fit "Jour 1 — Haut du corps
                // et puissance (pectoraux, dos, épaules, gainage)" and the whole
                // page scrolls sideways. The inner `truncate` can't help until an
                // ancestor is actually allowed to be narrower than its content.
                className={cn(
                  "group min-w-0 overflow-hidden",
                  // With no cycle to draw, the day's own table is the section's
                  // dominant element, so it takes the slab (p-0: the rows carry
                  // their own padding).
                  // bg-card/55, like the two panels beside it: at /40 the day
                  // cards sat a step darker than their own row-mates in the md
                  // grid for no reason anyone could name.
                  isLoop ? "rounded-lg border bg-card/55" : "slab p-0",
                  next && isLoop && "border-accent-text/35",
                )}
              >
                {/* The rotation slots answer a pointer and these rows didn't, so
                    the page's main disclosure was its least responsive control.
                    pointer-fine: for the same reason as the slots — a tap would
                    otherwise leave one row lit. */}
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-1.5 transition-colors duration-100 marker:hidden pointer-fine:hover:bg-secondary/50">
                  <ChevronDownIcon className="chevron" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{day.name}</span>
                  {next ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 border-primary/45 bg-primary/20 text-accent-text"
                    >
                      À suivre
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {day.exercises.length} ex. · {sets} séries
                    </Badge>
                  )}
                </summary>
                <div className="px-3 pb-3">
                  <ul className="divide-y">
                    {day.exercises.map((exercise) => {
                      // No match (or not resolved yet) → no affordance at all.
                      const demoUrl = demoUrlFor(exercise.name);
                      return (
                        <li key={exercise.name} className="flex min-h-11 items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{exercise.name}</p>
                            <p className="text-sm text-muted-foreground">
                              <span className="font-semibold tabular-nums text-foreground">
                                {exercise.sets} × {exercise.reps}
                              </span>{" "}
                              · repos{" "}
                              <span className="tabular-nums">
                                {restLabel(exercise.restSeconds)}
                              </span>
                            </p>
                            {exercise.notes ? (
                              <p className="text-sm text-muted-foreground">{exercise.notes}</p>
                            ) : null}
                          </div>
                          {demoUrl ? <ExerciseDemo name={exercise.name} gifUrl={demoUrl} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                  {next ? (
                    <Button asChild variant="secondary" className="mt-3 h-11 w-full">
                      <Link href="/seance">Commencer cette séance</Link>
                    </Button>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5 rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">Comment ça progresse</p>
            {/* Indented, not striped: this is the coach's voice, not the app's,
                and a coloured side rule wider than a hairline is banned. */}
            <div className="flex flex-col gap-2 pl-3.5">
              <p className="text-base">{program.progressionRules}</p>
              <p className="text-sm text-muted-foreground">
                {program.deloadEveryWeeks ? (
                  <>
                    Deload toutes les{" "}
                    <span className="tabular-nums">{program.deloadEveryWeeks}</span> semaines. Tu
                    lèves moins, tu récupères. C&apos;est prévu.
                  </>
                ) : (
                  "Pas de deload programmé sur ce bloc."
                )}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border bg-card/55 p-3.5">
            <p className="eyebrow">Ce que ça pèse</p>
            <ul className="divide-y">
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Séries par cycle
                </span>
                <span className="font-semibold tabular-nums">{totalSets}</span>
              </li>
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Durée estimée par séance
                </span>
                <span className="font-semibold tabular-nums">{Math.round(avgMinutes)} min</span>
              </li>
              <li className="flex min-h-11 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Jours dans la rotation
                </span>
                <span className="font-semibold tabular-nums">{days.length}</span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Durée estimée à partir des temps de repos, pas mesurée sur tes séances.
            </p>
          </section>
        </div>
      </div>

      {/* Two ghost words, right-aligned: putting a program away is a rare,
          reversible decision and must not compete with the day list above it.
          Sharing joins them in the same register — short labels, four fit at
          390px because none of them earns more weight than the day list. */}
      {/* flex-wrap: shared, this row holds 4 buttons and overflows 390px otherwise. */}
      <div className="flex flex-wrap justify-end gap-1">
        {shareCode ? (
          <>
            <Button
              variant="ghost"
              className="h-11 px-3 text-muted-foreground active:scale-[0.98]"
              onClick={() => onCopyLink(shareCode)}
            >
              Copier le lien
            </Button>
            <Button
              variant="ghost"
              className="h-11 px-3 text-muted-foreground active:scale-[0.98]"
              onClick={() => onUnshare(program)}
            >
              Ne plus partager
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className="h-11 px-3 text-muted-foreground active:scale-[0.98]"
            disabled={sharing}
            onClick={() => {
              setSharing(true);
              void onShare(program).finally(() => setSharing(false));
            }}
          >
            Partager
          </Button>
        )}
        <Button
          variant="ghost"
          className="h-11 px-3 text-muted-foreground active:scale-[0.98]"
          onClick={() => onStatus(program, "completed")}
        >
          Terminé
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-3 text-muted-foreground active:scale-[0.98]"
          onClick={() => onStatus(program, "archived")}
        >
          Archiver
        </Button>
      </div>
    </section>
  );
}
