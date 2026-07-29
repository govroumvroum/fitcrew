"use client";

import { useMutation, useQuery } from "convex/react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Défis de la semaine</CardTitle>
        <CardDescription>
          On se met d&apos;accord sur un exercice, on compare. Lundi, ça repart à zéro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows === undefined ? (
          <Skeleton className="h-32" />
        ) : rows === null ? (
          <p className="py-2 text-sm text-muted-foreground">Profil en cours de création…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Aucun défi cette semaine. Lance-en un, les autres suivront.
          </p>
        ) : (
          rows.map((challenge) => (
            <div key={challenge._id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading font-semibold">{challenge.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {METRICS[challenge.metric].label}
                    {challenge.exerciseName ? ` · ${challenge.exerciseName}` : ""}
                    {/* No createdBy = the Monday cron wrote it, there's no human author. */}
                    {challenge.createdBy ? "" : " · proposé par le coach"}
                  </p>
                </div>
                <JoinButton challengeId={challenge._id} joined={challenge.joined} />
              </div>

              {challenge.standings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Personne d&apos;inscrit. Rejoins le défi pour ouvrir le classement.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {challenge.standings.map((row) => (
                    <li key={row.userId} className="flex items-center gap-2 py-1.5">
                      <Avatar size="sm">
                        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                        <AvatarFallback>{row.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate">{row.name}</span>
                      <span className="ml-auto shrink-0 font-heading font-semibold tabular-nums">
                        {row.score} {METRICS[challenge.metric].unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        <CreateDialog weekStart={weekStart} />
      </CardContent>
    </Card>
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
    <Button
      variant={joined ? "outline" : "default"}
      size="sm"
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
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <PlusIcon aria-hidden />
          Nouveau défi
        </Button>
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
            <p className="text-xs text-muted-foreground">
              Aucun exercice logué par la crew. Fais une séance d&apos;abord, ou lance un défi sur
              le nombre de séances.
            </p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="submit"
          disabled={pending || !title.trim() || (needsExercise && !exerciseName)}
        >
          Lancer le défi
        </Button>
      </DialogFooter>
    </form>
  );
}
