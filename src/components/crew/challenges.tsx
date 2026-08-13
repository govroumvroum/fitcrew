"use client";

import { useMutation, useQuery } from "convex/react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { monday } from "@/lib/dates";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ChallengeMetric } from "../../../convex/crew";

export const METRICS = {
  sessions: { label: "Nombre de séances", unit: "séances" },
  volume: { label: "Volume", unit: "kg" },
  max_reps: { label: "Reps max", unit: "reps" },
  max_weight: { label: "Charge max", unit: "kg" },
  est_1rm: { label: "Force (1RM est.)", unit: "kg" },
} as const satisfies Record<ChallengeMetric, { label: string; unit: string }>;

export function Challenges({ today }: { today: string }) {
  const weekStart = monday(today);
  const rows = useQuery(api.crew.challenges, { weekStart });

  return (
    <section className="flex flex-col gap-2">
      <div>
        <p className="eyebrow">Défis de la semaine</p>
        <p className="text-sm text-muted-foreground">
          On se met d&apos;accord sur un exercice, on compare. Lundi, ça repart à zéro.
        </p>
      </div>

      {rows === undefined ? (
        <Skeleton className="h-32" />
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">Profil en cours de création…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun défi cette semaine. Lance-en un, les autres suivront.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((challenge) => (
            <li key={challenge._id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                {/* No size: 15px was off the 10/11/14/16 scale, and Today renders
                    the same challenge title at the inherited 16px. */}
                <p className="truncate font-heading font-semibold">{challenge.title}</p>
                <p className="text-sm text-muted-foreground">
                  {METRICS[challenge.metric].label}
                  {challenge.exerciseName ? ` · ${challenge.exerciseName}` : ""}
                  {/* No createdBy = the Monday cron wrote it, there's no human author. */}
                  {challenge.createdBy ? "" : " · proposé par le coach"}
                  {/* Same segment, same words as Today: one fact, one voice. Per
                      row rather than once for the list, because a list where only
                      some rows are empty left those rows saying nothing. */}
                  {challenge.standings.length === 0 ? " · personne d'inscrit" : ""}
                </p>
                {/* One inline line, not a sub-table: with four people a nested
                    <ul> with its own hairlines and avatars is more structure than
                    the data. First names only — full names would wrap the line at
                    390px, and the crew knows who Basile is. */}
                {challenge.standings.length > 0 ? (
                  <p className="text-sm tabular-nums">
                    {challenge.standings
                      .map((row) => `${row.name.split(" ")[0]} ${row.score}`)
                      .join(" · ")}
                    <span className="text-muted-foreground"> {METRICS[challenge.metric].unit}</span>
                  </p>
                ) : null}
              </div>
              <JoinButton challengeId={challenge._id} joined={challenge.joined} />
            </li>
          ))}
        </ul>
      )}

      <CreateDialog weekStart={weekStart} />
    </section>
  );
}

export function JoinButton({
  challengeId,
  joined,
}: {
  challengeId: Id<"challenges">;
  joined: boolean;
}) {
  const toggleJoin = useMutation(api.crew.toggleJoin);
  const [pending, setPending] = useState(false);

  return (
    // Not `default`: that variant's gradient and red glow are reserved for the
    // one commit action of a screen, and /crew has none — two of them in one
    // viewport made joining a défi look like validating a set. h-11 because
    // size="sm" is 28px, under the touch target.
    <Button
      variant={joined ? "outline" : "secondary"}
      size="sm"
      className="h-11"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          // The `challenges` subscription reports the new state, so nothing is
          // mirrored in local state — only the in-flight flag.
          const now = await toggleJoin({ challengeId });
          toast.success(now ? "Tu es dans le défi." : "Tu as quitté le défi.");
        } catch {
          toast.error("Ça a raté, réessaie.");
        } finally {
          setPending(false);
        }
      }}
    >
      {joined ? "Quitter" : "Rejoindre"}
    </Button>
  );
}

function CreateDialog({ weekStart }: { weekStart: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* h-11 like the other trailing outline buttons: the default h-9 is under
          the 44px touch target on a phone. */}
      <DialogTrigger render={<Button variant="outline" className="h-11 w-full" />}>
        <PlusIcon aria-hidden />
        Nouveau défi
      </DialogTrigger>
      <DialogContent>
        {/* Mounted only while open, so the form state resets by itself and
            exerciseNames isn't subscribed to on every /crew visit. */}
        <CreateForm weekStart={weekStart} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ weekStart, onDone }: { weekStart: string; onDone: () => void }) {
  const create = useMutation(api.crew.create);
  const names = useQuery(api.crew.exerciseNames, {});
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<ChallengeMetric>("sessions");
  const [exerciseName, setExerciseName] = useState("");
  const [pending, setPending] = useState(false);

  const needsExercise = metric !== "sessions";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await create({
        title: title.trim(),
        weekStart,
        metric,
        exerciseName: needsExercise ? exerciseName : undefined,
      });
      toast.success("Défi lancé. À toi de gagner.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ça a raté, réessaie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Nouveau défi</DialogTitle>
        <DialogDescription>
          Sur la semaine en cours, du lundi au dimanche. Tu y es inscrit d&apos;office.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="challenge-title">Titre</Label>
        <Input
          id="challenge-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Le plus de tractions"
          required
          className="h-12 text-base sm:h-9 sm:text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label>Ce qu&apos;on mesure</Label>
        <Select value={metric} onValueChange={(value) => setMetric(value as ChallengeMetric)}>
          <SelectTrigger className="h-12 w-full text-base sm:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(METRICS).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Every metric but "séances" is scored on one exercise — comparing whole
          programs measures exercise choice, not effort. */}
      {needsExercise ? (
        <div className="space-y-2">
          <Label>Exercice</Label>
          <Select value={exerciseName} onValueChange={setExerciseName}>
            <SelectTrigger className="h-12 w-full text-base sm:text-sm">
              <SelectValue placeholder="Choisis un exercice" />
            </SelectTrigger>
            <SelectContent>
              {(names ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {names?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun exercice logué par la crew. Fais une séance d&apos;abord, ou lance un défi sur
              le nombre de séances.
            </p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter>
        {/* h-11 like every other button on this screen: the default h-8 is well
            under the touch target, and this one is the commit action. */}
        <Button
          type="submit"
          className="h-11"
          disabled={pending || !title.trim() || (needsExercise && !exerciseName)}
        >
          Lancer le défi
        </Button>
      </DialogFooter>
    </form>
  );
}
