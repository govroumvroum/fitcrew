"use client";

import { useMutation } from "convex/react";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChefHatIcon,
  ChevronRightIcon,
  DumbbellIcon,
  ImageIcon,
  MessageCircleIcon,
  SmartphoneIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallHelp } from "@/components/onboarding/install-help";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { type InstallState, promptInstall, useInstall } from "@/lib/install";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import { type StepKey, summarize } from "../../../convex/firstSteps";

export type WelcomeState = {
  welcome: boolean;
  dismissed: boolean;
  done: Record<StepKey, boolean>;
};

/** Words and destinations. Which step is done is the server's call, never a tap. */
const COPY: Record<StepKey, { title: string; hint: string; href?: string; Icon: typeof CheckIcon }> = {
  coach: {
    title: "Parle au Coach",
    hint: "Quelques questions, et il t'écrit ton programme.",
    href: "/coach",
    Icon: MessageCircleIcon,
  },
  week: {
    title: "Remplis ta semaine type",
    hint: "Tes jours de sport, pour que le Coach et le Chef s'y calent.",
    href: "/programme#ma-semaine",
    Icon: CalendarDaysIcon,
  },
  seance: {
    title: "Fais ta première séance",
    hint: "Coche tes séries, les records se comptent tout seuls.",
    href: "/seance",
    Icon: DumbbellIcon,
  },
  capture: {
    title: "Envoie une capture de montre ou une pesée",
    hint: "Une capture d'écran au Coach, il range les chiffres.",
    href: "/coach",
    Icon: ImageIcon,
  },
  crew: {
    title: "Rejoins un défi de la crew",
    hint: "Le classement de la semaine, entre potes.",
    href: "/crew",
    Icon: TrophyIcon,
  },
  install: {
    title: "Installe l'app",
    hint: "Sur ton écran d'accueil, en plein écran.",
    Icon: SmartphoneIcon,
  },
  chef: {
    title: "Si tu veux, le Chef s'occupe aussi de tes repas",
    hint: "Menus de la semaine, recettes, courses. Facultatif.",
    href: "/chef",
    Icon: ChefHatIcon,
  },
};

/**
 * Records the install the moment the client sees it — the server has no other
 * way to know. Rendered by the home gate whether or not the card shows, since
 * the step is also how someone who dismissed the card keeps a true record.
 */
export function useRecordInstall(state: WelcomeState | null | undefined) {
  const install = useInstall();
  const markInstalled = useMutation(api.welcome.markInstalled);
  const seen = install?.installed === true;
  const recorded = state?.done.install === true;
  useEffect(() => {
    if (state && seen && !recorded) void markInstalled();
  }, [state, seen, recorded, markInstalled]);
}

/**
 * « Premiers pas » (#127): for everyone, old hands included — it's how they
 * find what shipped since they last looked. Every tick comes from real data,
 * the card leaves on its own once the required steps are done (the Chef never
 * holds it up), and « masquer » is stored on the server.
 *
 * Done steps stay listed, folded to one quiet line: the progress is the
 * reward, and what's left keeps the full row with its link.
 */
export function FirstSteps({ state }: { state: WelcomeState }) {
  const install = useInstall();
  const dismiss = useMutation(api.welcome.dismissFirstSteps);
  const [installOpen, setInstallOpen] = useState(false);

  // Standalone right now counts before the mutation recording it lands.
  const done = { ...state.done, install: state.done.install || install?.installed === true };
  const summary = summarize(done, state.dismissed);
  if (!summary.visible) return null;

  const required = summary.steps.filter((step) => !step.optional);
  const optional = summary.steps.filter((step) => step.optional);

  return (
    <section
      aria-labelledby="first-steps-title"
      className="flex flex-col gap-3 rounded-lg border bg-card/55 p-3.5"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p id="first-steps-title" className="eyebrow">
            Premiers pas
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {summary.requiredDone} sur {summary.required} faits
          </p>
        </div>
        {/* -my/-mr keep the header the eyebrow's height while the hit area is 44px. */}
        <Button
          variant="ghost"
          size="icon"
          className="-my-2 -mr-2 size-11 text-muted-foreground"
          aria-label="Masquer les premiers pas"
          onClick={() => void dismiss()}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* One segment per required step, filled as they're done. Decoration: the
          count above already says it in words. */}
      <div className="flex gap-1" aria-hidden>
        {required.map((step) => (
          <span
            key={step.key}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              step.done ? "bg-chart-1" : "bg-secondary",
            )}
          />
        ))}
      </div>

      <ul className="-mx-1 flex flex-col">
        {[...required, ...optional].map((step) => (
          <li key={step.key} className={cn(step.optional && "mt-1 border-t pt-1")}>
            {step.done ? (
              <DoneRow title={COPY[step.key].title} />
            ) : step.key === "install" ? (
              <TodoRow
                step={step.key}
                onClick={() => {
                  // One tap installs where the browser allows it; elsewhere the
                  // gestures, in a drawer.
                  if (install?.canPrompt) promptInstall();
                  else setInstallOpen(true);
                }}
              />
            ) : (
              <TodoRow step={step.key} />
            )}
          </li>
        ))}
      </ul>

      <InstallDrawer open={installOpen} onOpenChange={setInstallOpen} install={install} />
    </section>
  );
}

function DoneRow({ title }: { title: string }) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-1 text-sm text-muted-foreground">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-chart-1/20">
        <CheckIcon className="size-3 stroke-[3] text-chart-1" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="sr-only">fait</span>
    </div>
  );
}

function TodoRow({ step, onClick }: { step: StepKey; onClick?: () => void }) {
  const copy = COPY[step];
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
        <copy.Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug">{copy.title}</span>
        <span className="block text-sm text-muted-foreground">{copy.hint}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  const className =
    "flex min-h-14 w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2";

  return copy.href ? (
    <Link href={copy.href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function InstallDrawer({
  open,
  onOpenChange,
  install,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  install: InstallState | null;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Installer FitCrew</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            Installée, elle s&apos;ouvre en plein écran comme une vraie app. La case se coche toute
            seule la première fois que tu l&apos;ouvres depuis l&apos;icône.
          </p>
          {install ? <InstallHelp install={install} /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
