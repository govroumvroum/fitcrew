"use client";

import { CheckIcon, EllipsisVerticalIcon, ShareIcon, SquarePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type InstallState, promptInstall } from "@/lib/install";

/**
 * How to put FitCrew on the home screen, for THIS browser. Shared by the
 * welcome's install step and the « Premiers pas » drawer, so the two never
 * disagree on the gestures.
 *
 * Three cases, because browsers split three ways: Chrome & co. hand us a prompt
 * (one button), iOS never will (Safari's share sheet, two gestures), and the
 * rest have an « Installer » entry in their own menu.
 */
export function InstallHelp({ install }: { install: InstallState }) {
  if (install.installed) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <CheckIcon className="size-4 shrink-0 stroke-[2.5] text-chart-1" aria-hidden />
        C&apos;est fait, FitCrew est sur ton écran d&apos;accueil.
      </p>
    );
  }

  if (install.canPrompt) {
    return (
      // The red one: where the browser offers a real install, that IS the step.
      // The welcome demotes its own « Plus tard » to match.
      <Button
        size="lg"
        className="h-14 w-full rounded-lg text-base active:scale-[0.96]"
        onClick={promptInstall}
      >
        <SquarePlusIcon aria-hidden />
        Installer FitCrew
      </Button>
    );
  }

  const steps = install.ios
    ? [
        {
          Icon: ShareIcon,
          text: (
            <>
              Dans Safari, touche <strong className="font-semibold">Partager</strong>
            </>
          ),
        },
        {
          Icon: SquarePlusIcon,
          text: (
            <>
              Choisis <strong className="font-semibold">Sur l&apos;écran d&apos;accueil</strong>
            </>
          ),
        },
      ]
    : [
        {
          Icon: EllipsisVerticalIcon,
          text: <>Ouvre le menu du navigateur</>,
        },
        {
          Icon: SquarePlusIcon,
          text: (
            <>
              Choisis <strong className="font-semibold">Installer l&apos;application</strong> ou{" "}
              <strong className="font-semibold">Ajouter à l&apos;écran d&apos;accueil</strong>
            </>
          ),
        },
      ];

  return (
    <ol className="flex flex-col gap-2.5">
      {/* Two gestures, the first is never the add icon: the pair is unique. */}
      {steps.map((step) => (
        <li key={step.Icon === SquarePlusIcon ? "add" : "open"} className="flex items-center gap-3 text-sm">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
            <step.Icon className="size-4.5" aria-hidden />
          </span>
          <span className="min-w-0">{step.text}</span>
        </li>
      ))}
    </ol>
  );
}
