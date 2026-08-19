"use client";

import {
  ArrowLeftRightIcon,
  CheckIcon,
  ClipboardListIcon,
  DumbbellIcon,
  ImageIcon,
  InfoIcon,
  LinkIcon,
  NotebookPenIcon,
  SearchIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import Image from "next/image";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Entry } from "../../../convex/screenshots";
import { AgentChat, type AgentConfig } from "@/components/chat/agent-chat";
import { ChoicesCard } from "@/components/chat/choices-card";
import {
  LoggedCard,
  ProfileCard,
  ProgramCard,
  SourcesCard,
  SwapCard,
  type LoggedInput,
  type ProfileInput,
  type ProgramInput,
  type SearchOutput,
  type SwapInput,
} from "@/components/chat/tool-cards";
import { ExtractedReview } from "@/components/import/extracted-review";

/**
 * The Coach, as a configuration of the shared chat shell. Everything structural —
 * threading, greeting, echo, uploads, streaming status — lives in `agent-chat.tsx`;
 * what's left here is the Coach's identity and its tool cards.
 */
export const COACH: AgentConfig = {
  api: api.coach,
  name: "Coach",
  // The source PNG has no alpha, so the white field becomes the coin — hence ring
  // rather than a border.
  coin: (
    <Image
      src="/coach.png"
      alt=""
      width={28}
      height={28}
      className="rounded-full ring-1 ring-white/10"
      priority
    />
  ),
  placeholder: "Écris au coach…",
  attach: { label: "Joindre une capture d'écran", prompt: "Regarde cette capture." },
  thinking: "Le coach réfléchit…",
  unreachable: "Le coach ne répond pas.",
  sidebarEmpty: "Pas encore de conversation. Écris au coach, elle apparaîtra ici.",
  // The screenshot review, the sources list and the chips read the output rather
  // than the input — the chips because their id is in it, and their input streams
  // in piece by piece, which the guard would read as "not landed yet".
  outputOnly: ["tool-extract_screenshot", "tool-search_web", "tool-fetch_url", "tool-ask_choices"],
  toolLabels: {
    "tool-ask_choices": {
      icon: ClipboardListIcon,
      pending: "Je prépare mes questions…",
      running: "Je te pose mes questions…",
      done: "Questions du coach",
      failed: "Les questions n'ont pas pu s'afficher.",
    },
    "tool-save_onboarding": {
      icon: CheckIcon,
      pending: "Je récapitule…",
      running: "J'enregistre ton profil…",
      done: "Profil enregistré",
    },
    "tool-generate_program": {
      icon: DumbbellIcon,
      pending: "Je réfléchis à ton programme…",
      running: "J'écris ton nouveau programme…",
      done: "Nouveau programme écrit",
      failed: "Le programme n'a pas pu être enregistré.",
    },
    "tool-swap_exercise": {
      icon: ArrowLeftRightIcon,
      pending: "Je cherche un remplaçant…",
      running: "Je change l'exercice…",
      done: "Exercice remplacé",
      failed: "L'exercice n'a pas pu être remplacé.",
    },
    "tool-explain_exercise": {
      icon: InfoIcon,
      pending: "Je regarde ton historique…",
      done: "J'ai regardé ton historique",
    },
    "tool-extract_screenshot": {
      icon: ImageIcon,
      pending: "J'ouvre ta capture…",
      running: "Je lis ta capture…",
      done: "Capture lue",
      failed: "Je n'ai pas réussi à lire cette capture.",
    },
    "tool-log_workout": {
      icon: NotebookPenIcon,
      pending: "Je note ta séance…",
      running: "J'enregistre ta séance…",
      done: "Séance enregistrée",
      failed: "La séance n'a pas pu être enregistrée.",
    },
    "tool-search_web": {
      icon: SearchIcon,
      pending: "Je prépare ma recherche…",
      running: "Je cherche sur le web…",
      done: "Recherche web",
      failed: "La recherche n'a rien donné.",
    },
    "tool-fetch_url": {
      icon: LinkIcon,
      pending: "J'ouvre la page…",
      running: "Je lis la page…",
      done: "Page lue",
      failed: "La page n'a pas pu être ouverte.",
    },
    // The Chef's own icon, not a generic arrow: the row says WHO was asked.
    "tool-ask_chef": {
      icon: UtensilsCrossedIcon,
      pending: "Je demande au Chef…",
      done: "Demande au Chef",
      failed: "Le Chef n'a pas répondu.",
    },
  },
  // The screenshot review, because nothing lands in the profile until the user
  // confirms inside it; and the chips, because chips nobody can see are chips
  // nobody taps. Neither may open behind a click.
  needsValidation: ["tool-extract_screenshot", "tool-ask_choices"],
  renderTool: (tool, isNew) => {
    // Cards read the tool's input, which carries the whole program/profile; the
    // output only holds the resulting version number.
    const { input, output } = tool;

    switch (tool.type) {
      // The screenshot review is the one tool result the user must act on:
      // nothing lands in their profile until they confirm inside it.
      // Empty extractions go through the card too: it already has the copy for
      // "I couldn't read this" AND a discard button, which a bare sentence
      // didn't — so the row and its uploaded file used to leak.
      case "tool-extract_screenshot": {
        const done = output as { screenshotId: Id<"screenshots">; entries: Entry[] };
        return <ExtractedReview screenshotId={done.screenshotId} entries={done.entries} />;
      }
      // The tappable answers. Their state lives in Convex, so the card only needs
      // the id — everything else comes from `api.choices.status`. `send` is passed
      // because the card is shared with the Chef and the echo has to land in THIS
      // agent's thread.
      case "tool-ask_choices":
        return (
          <ChoicesCard
            choicesId={(output as { choicesId: Id<"choices"> }).choicesId}
            send={api.coach.send}
          />
        );
      case "tool-generate_program":
        return (
          <ProgramCard
            input={input as ProgramInput}
            version={(output as { version?: number })?.version}
            isNew={isNew}
          />
        );
      case "tool-save_onboarding":
        return <ProfileCard input={input as ProfileInput} isNew={isNew} />;
      case "tool-swap_exercise": {
        const done = output as { version?: number; dayName?: string };
        return (
          <SwapCard
            input={input as SwapInput}
            dayName={done?.dayName}
            version={done?.version}
            isNew={isNew}
          />
        );
      }
      // The one card that reads the output: the links are the result.
      case "tool-search_web":
        return <SourcesCard output={output as SearchOutput} isNew={isNew} />;
      // Une page lue est une source d'une seule ligne : la même carte, avec un
      // seul résultat, plutôt qu'un composant de plus.
      case "tool-fetch_url": {
        const done = output as { url?: string; title?: string; error?: string };
        if (!done?.url || done.error) return null;
        const label = done.title || done.url;
        return (
          <SourcesCard
            output={{
              query: new URL(done.url).hostname.replace(/^www\./, ""),
              results: [{ title: label, url: done.url, snippet: "" }],
            }}
            isNew={isNew}
          />
        );
      }
      case "tool-log_workout":
        return (
          <LoggedCard
            input={input as LoggedInput}
            sets={(output as { sets?: number })?.sets}
            isNew={isNew}
          />
        );
      // Same card as the Chef's side of the consult, on purpose: a collaboration
      // the user can only see in one direction doesn't read as a collaboration.
      // No card: a consult's answer is already in the prose, rewritten by the
      // agent that asked. Returning null makes the shell render the one-line
      // marker from `toolLabels` — returning a line here would get wrapped in a
      // disclosure whose summary is that same line.
      case "tool-ask_chef":
        return null;
      default:
        // explain_exercise returns raw history for the model to narrate — the
        // prose above is the result, a card would just repeat it.
        return null;
    }
  },
};

export function CoachChat() {
  return <AgentChat agent={COACH} />;
}
