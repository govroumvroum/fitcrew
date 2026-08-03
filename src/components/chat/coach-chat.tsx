"use client";

import Image from "next/image";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Entry } from "../../../convex/screenshots";
import { AgentChat, type AgentConfig } from "@/components/chat/agent-chat";
import {
  ConsultLine,
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
  // The screenshot review and the sources list are the two cards that read the
  // output rather than the input.
  outputOnly: ["tool-extract_screenshot", "tool-search_web"],
  toolLabels: {
    "tool-save_onboarding": { pending: "Je récapitule…", running: "J'enregistre ton profil…" },
    "tool-generate_program": {
      pending: "Je réfléchis à ton programme…",
      running: "J'écris ton programme…",
      failed: "Le programme n'a pas pu être enregistré.",
    },
    "tool-swap_exercise": {
      pending: "Je cherche un remplaçant…",
      running: "Je change l'exercice…",
      failed: "L'exercice n'a pas pu être remplacé.",
    },
    "tool-explain_exercise": { pending: "Je regarde ton historique…" },
    "tool-extract_screenshot": {
      pending: "J'ouvre ta capture…",
      running: "Je lis ta capture…",
      failed: "Je n'ai pas réussi à lire cette capture.",
    },
    "tool-log_workout": {
      pending: "Je note ta séance…",
      running: "J'enregistre ta séance…",
      failed: "La séance n'a pas pu être enregistrée.",
    },
    "tool-search_web": {
      pending: "Je prépare ma recherche…",
      running: "Je cherche sur le web…",
      failed: "La recherche n'a rien donné.",
    },
    "tool-ask_chef": { pending: "Je demande au Chef…", failed: "Le Chef n'a pas répondu." },
  },
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
      case "tool-ask_chef":
        return <ConsultLine label="Demande au Chef" isNew={isNew} />;
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
