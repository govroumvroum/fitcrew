"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { TrophyIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InstallHelp } from "@/components/onboarding/install-help";
import { Button } from "@/components/ui/button";
import { useInstall } from "@/lib/install";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

type Step = "intro" | "install" | "coach";

/**
 * The first launch, for a new account only (#127). Three short screens: what
 * FitCrew is, putting it on the home screen, then straight into the Coach — whose
 * own questionnaire is the real onboarding. This screen never asks a question:
 * the Coach owns the profile.
 *
 * It covers the tab bar on purpose: six tabs are exactly the « no starting
 * point » this replaces. « Passer » is always one tap away, and either way out
 * stamps `welcomedAt` on the server, so it never comes back — not after a
 * reload, not inside the iOS home-screen app, whose storage is its own.
 *
 * Shown or not is decided by the query, never by local state: the home route
 * stays mounted under <Activity>, and a stale `useState` would resurrect it.
 */
export function Welcome() {
  const { user } = useUser();
  const install = useInstall();
  const finish = useMutation(api.welcome.finish);
  const router = useRouter();
  // By key, not index: the install step is decided when you leave the intro,
  // and an `appinstalled` mid-flow must not shift you onto another screen.
  const [step, setStep] = useState<Step>("intro");
  const [withInstall, setWithInstall] = useState(true);

  const steps: Step[] = withInstall ? ["intro", "install", "coach"] : ["intro", "coach"];

  // Covering the tab bar isn't hiding it: everything else on the page stays
  // focusable and read aloud underneath. So the welcome renders straight into
  // <body> and makes its siblings inert while it's up — the tab bar, the home
  // header, the « Du nouveau » badge. Only what it set is restored: the cleanup
  // also runs when <Activity> hides the route.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const self = root.current;
    if (!self) return;
    const others = [...document.body.children].filter(
      (element) => element !== self && !element.hasAttribute("inert"),
    );
    for (const element of others) element.setAttribute("inert", "");
    return () => {
      for (const element of others) element.removeAttribute("inert");
    };
  }, []);
  const firstName = user?.firstName?.trim();

  const leave = () => void finish();
  const next = () => {
    if (step === "intro") {
      // Already running as the app (or a browser that can't tell yet): no point
      // explaining how to install it.
      const skipInstall = install === null || install.installed || install.unsupported;
      setWithInstall(!skipInstall);
      setStep(skipInstall ? "coach" : "install");
    } else setStep("coach");
  };

  return createPortal(
    // A page, not a dialog: it replaces the home screen, nothing sits behind it
    // to go back to. Fixed and z-50 so it covers the tab bar; inert (above) so
    // nothing under it can be reached either.
    <section
      ref={root}
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background pt-[var(--safe-top)]"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <header className="flex h-14 items-center justify-between">
          <ol className="flex items-center gap-1.5" aria-label="Progression">
            {steps.map((key) => (
              <li
                key={key}
                aria-current={key === step ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
                  key === step ? "w-6 bg-foreground" : "w-1.5 bg-secondary",
                )}
              />
            ))}
          </ol>
          <Button variant="ghost" className="-mr-3 h-11 px-3 text-muted-foreground" onClick={leave}>
            Passer
          </Button>
        </header>

        {/* Keyed by step: each screen enters on its own, its blocks staggered. */}
        <div key={step} className="flex flex-1 flex-col">
          {step === "intro" ? (
            <Intro firstName={firstName} />
          ) : step === "install" ? (
            <Install />
          ) : (
            <Coach />
          )}

          <div className="mt-8 flex flex-col gap-2">
            {step === "coach" ? (
              <Button
                size="lg"
                className="h-14 w-full rounded-lg text-base active:scale-[0.96]"
                onClick={() => {
                  leave();
                  router.push("/coach");
                }}
              >
                Commence par parler au Coach
              </Button>
            ) : step === "install" && install?.canPrompt && !install.installed ? (
              // The install button above is the red one; this is the way round it.
              <Button variant="ghost" className="h-14 w-full text-base" onClick={next}>
                Plus tard
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-14 w-full rounded-lg text-base active:scale-[0.96]"
                onClick={next}
              >
                Suivant
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>,
    document.body,
  );
}

/** Staggered entrance for one block of a screen. Modest: 8px and 300ms. */
const enter = (index: number, className?: string) => ({
  className: cn(
    "animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none",
    className,
  ),
  style: { animationDelay: `${index * 70}ms`, animationFillMode: "both" as const },
});

const coin = "size-11 shrink-0 rounded-full ring-1 ring-white/10";

function Intro({ firstName }: { firstName?: string }) {
  const rows = [
    {
      art: <Image src="/coach.png" alt="" width={44} height={44} className={coin} />,
      title: "Le Coach t'écrit ton programme",
      text: "Il te pose quelques questions, puis il l'ajuste au fil de tes séances.",
    },
    {
      art: <Image src="/chef.png" alt="" width={44} height={44} className={coin} />,
      title: "Le Chef s'occupe de tes repas",
      text: "Si tu veux : menus de la semaine, recettes, liste de courses.",
    },
    {
      art: (
        <span className={cn(coin, "grid place-items-center bg-secondary")}>
          <TrophyIcon className="size-5 text-accent-text" aria-hidden />
        </span>
      ),
      title: "La crew te suit",
      text: "Classement, records et défis de la semaine, entre potes.",
    },
  ];

  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <div {...enter(0)}>
        <p className="eyebrow">Bienvenue</p>
        <h2
          id="welcome-title"
          className="mt-2 font-display text-[clamp(2.25rem,11vw,3rem)] leading-[0.95] font-extrabold uppercase"
        >
          {firstName ? `Salut ${firstName},` : "Salut,"}
          <br />
          bienvenue dans la crew.
        </h2>
      </div>
      <ul className="flex flex-col gap-5">
        {rows.map((row, index) => (
          <li key={row.title} {...enter(index + 1, "flex items-start gap-3.5")}>
            {row.art}
            <div className="min-w-0 pt-0.5">
              <p className="font-heading text-lg leading-tight font-bold">{row.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{row.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Install() {
  const install = useInstall();

  return (
    <div className="flex flex-1 flex-col justify-center gap-7">
      <div {...enter(0)}>
        <p className="eyebrow">Sur ton téléphone</p>
        <h2
          id="welcome-title"
          className="mt-2 font-display text-[clamp(2.25rem,11vw,3rem)] leading-[0.95] font-extrabold uppercase"
        >
          Garde-la sous le pouce.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Installée, FitCrew s&apos;ouvre en plein écran comme une vraie app, sans barre
          d&apos;adresse. Pratique entre deux séries.
        </p>
      </div>
      {install ? (
        // The gestures get a panel; a lone button doesn't need a box around it.
        <div
          {...enter(
            1,
            install.canPrompt && !install.installed ? undefined : "rounded-lg border bg-card/55 p-4",
          )}
        >
          <InstallHelp install={install} />
        </div>
      ) : null}
    </div>
  );
}

function Coach() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div {...enter(0)}>
        <Image
          src="/coach.png"
          alt=""
          width={64}
          height={64}
          className="size-16 rounded-full ring-1 ring-white/10"
        />
      </div>
      <div {...enter(1)}>
        <p className="eyebrow">Pour commencer</p>
        <h2
          id="welcome-title"
          className="mt-2 font-display text-[clamp(2.25rem,11vw,3rem)] leading-[0.95] font-extrabold uppercase"
        >
          Le Coach d&apos;abord.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Deux minutes de questions : ton objectif, tes jours dispo, ton matériel, tes pépins
          éventuels. Il t&apos;écrit ton programme dans la foulée.
        </p>
      </div>
      <p {...enter(2, "text-sm text-muted-foreground")}>
        Ensuite, l&apos;accueil te garde une liste de premiers pas, cochés au fur et à mesure.
      </p>
    </div>
  );
}
