"use client";

import { AssistantRuntimeProvider, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Thread, type ThreadComponents } from "@/components/assistant-ui/thread";
import type { AgentApi } from "@/components/chat/agent-thread";
import { agentStatus } from "@/components/chat/convert-message";
import { StreamedText } from "@/components/chat/message-text";
import type { ToolIcon } from "@/components/chat/tool-cards";
import { agentTools, type ToolPart } from "@/components/chat/tool-part";
import { useAgentRuntime } from "@/components/chat/use-agent-runtime";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The chat shell both agents run on, over assistant-ui: the header, the thread,
 * and what only this app needs around it (paging, drop-anywhere, the upload
 * errors). /coach and /chef differ only in which Convex functions they call,
 * what the header says, and which cards their tools render — everything else
 * was identical, and duplicating it was the fastest way to fix a bug in one
 * place and not the other.
 *
 * The runtime is `useAgentRuntime`, the message mapping `convert-message.ts`,
 * the tool state machine `tool-part.tsx`.
 */

/**
 * What a tool says about itself while it works.
 *
 * `pending` is the model still writing the arguments — it hasn't committed to the
 * action yet, so the copy stays vague ("Je regarde ton menu…"). `running` is the
 * tool executing, where naming the action is safe ("J'écris ta semaine…").
 * `running` falls back to `pending` for tools too fast to be worth two strings.
 */
export type AgentToolLabel = {
  /** Shown in EVERY state of this tool, so the row keeps one identity. */
  icon: ToolIcon;
  pending: string;
  running?: string;
  /** The collapsed one-line summary, past tense. Also the whole output for a tool
   *  whose result is the agent's prose and which therefore has no card. */
  done: string;
  failed?: string;
};

export type AgentConfig = {
  api: AgentApi;
  /** Header title. */
  name: string;
  /** The 28 px coin left of the title — a photo for the Coach, an icon for the Chef. */
  coin: React.ReactNode;
  placeholder: string;
  /** Accessible name of the attach button, and the prompt used when the user
   *  sends images with no words — a "capture" for the Coach, a "photo" for the Chef. */
  attach: { label: string; prompt: string };
  /** "Le coach réfléchit…" — while the turn is in flight. */
  thinking: string;
  /** Toast when this agent's own functions fail. */
  unreachable: string;
  /** Sidebar copy when the user has no conversation yet. */
  sidebarEmpty: string;
  /**
   * Tool types whose card reads the OUTPUT rather than the input. `output-available`
   * does NOT guarantee the input came back with it — a streamed part reassembled
   * from deltas can land the output first — so every other card is hidden until
   * its input exists. Skipping that guard crashed /coach in prod on mobile.
   */
  outputOnly: readonly string[];
  /**
   * Copy shown while a tool runs, per tool type (`tool-<name>`). A missing entry
   * degrades to generic copy rather than to silence.
   */
  toolLabels: Record<string, AgentToolLabel>;
  /**
   * Tool types whose card the user must ACT on, so it is never collapsed. Hiding a
   * confirm button behind a click is how an unconfirmed analysis gets abandoned.
   */
  needsValidation: readonly string[];
  /** `isNew` is the message still streaming; see `Surface` in the card files.
   *  Returning null is meaningful: the shell then shows the tool's one-line
   *  marker, which is what the consult tools want. */
  renderTool: (tool: ToolPart, isNew: boolean) => React.ReactNode;
};

export function AgentChat({ agent }: { agent: AgentConfig }) {
  const { runtime, threadId, status, loadMore } = useAgentRuntime(agent);
  const { ToolUIs, components } = chatParts(agent);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUIs />
      <DropAnywhere />
      <AttachmentErrors />
      <header className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 font-heading text-base font-semibold tracking-[-0.01em]">
          {/* Once in the header, not per message: a repeated avatar down a phone
              chat is noise. */}
          {agent.coin}
          {agent.name}
        </span>
        {/* "Nouvelle conversation" lives in the sidebar now — one button, one place. */}
        <SidebarTrigger className="size-11" aria-label="Conversations" />
      </header>

      <div className="min-h-0 flex-1">
        <Thread
          components={components}
          // ph-mask: what the user tells the agent — their body, their food, their
          // training — and what it answers, stays out of session replay.
          messagesClassName="ph-mask"
          composerPlaceholder={agent.placeholder}
          attachLabel={agent.attach.label}
          thinking={agent.thinking}
          aboveMessages={
            !threadId ? (
              <>
                <Skeleton className="h-16 w-4/5" />
                <Skeleton className="h-10 w-3/5" />
              </>
            ) : status === "CanLoadMore" ? (
              <LoadOlder onLoad={() => loadMore(30)} />
            ) : null
          }
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

/**
 * The tool registrations and the thread's slots, built once per agent. Both have
 * to be referentially stable: a new `components` object or a new tool UI
 * remounts every message in the thread.
 */
const parts = new WeakMap<
  AgentConfig,
  { ToolUIs: React.ComponentType; components: ThreadComponents }
>();
function chatParts(agent: AgentConfig) {
  let hit = parts.get(agent);
  if (!hit) {
    const { ToolUIs, Fallback } = agentTools(agent);
    hit = { ToolUIs, components: { Text: AgentText, ToolFallback: Fallback } };
    parts.set(agent, hit);
  }
  return hit;
}

function AgentText({ text }: { text: string }) {
  // The agent's own status rather than assistant-ui's: a turn left `pending`
  // isn't streaming, and must not replay its text as if it were.
  const streaming = useAuiState((s) => agentStatus(s.message.metadata) === "streaming");
  return <StreamedText text={text} streaming={streaming} />;
}

/**
 * « Voir les messages plus anciens », without the jump.
 *
 * The older page lands ABOVE what you were reading, so a scroll position kept in
 * pixels from the top shows you something else. It's kept from the bottom
 * instead: measured before the load, restored the moment the older messages are
 * in the DOM.
 *
 * Watched in the DOM rather than in a React effect: the page reaches the screen
 * through assistant-ui's store, a render later than this component learns about
 * it, so an effect here would restore against the old height.
 */
function LoadOlder({ onLoad }: { onLoad: () => void }) {
  const button = useRef<HTMLButtonElement>(null);

  function load() {
    const viewport = button.current?.closest<HTMLElement>("[data-slot=aui_thread-viewport]");
    const content = viewport?.firstElementChild;
    if (viewport && content) {
      const count = () => viewport.querySelectorAll("[data-role]").length;
      const before = count();
      const distance = viewport.scrollHeight - viewport.scrollTop;
      const observer = new ResizeObserver(() => {
        if (count() <= before) return;
        observer.disconnect();
        // `instant`: the viewport scrolls smoothly by default, and an animated
        // correction is a visible jump.
        viewport.scrollTo({ top: viewport.scrollHeight - distance, behavior: "instant" });
      });
      observer.observe(content);
      // A page that brings nothing new must not leave the observer behind.
      setTimeout(() => observer.disconnect(), 10_000);
    }
    onLoad();
  }

  return (
    <Button ref={button} variant="ghost" size="sm" onClick={load}>
      Voir les messages plus anciens
    </Button>
  );
}

/**
 * Drop an image anywhere on the page, not just on the composer — the composer is
 * a small target and the thing you're dragging covers it. The composer's own
 * dropzone handles a drop on itself (and marks the event handled).
 */
function DropAnywhere() {
  const aui = useAui();
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented || !hasFiles(e)) return;
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer?.files ?? [])) {
        // A refusal is reported by `AttachmentErrors`; nothing to add here.
        aui.composer.addAttachment(file).catch(() => {});
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [aui]);
  return null;
}

/** Why an image was refused, from the picker, a paste or a drop alike. */
function AttachmentErrors() {
  useAuiEvent("composer.attachmentAddError", ({ reason, message }) => {
    // The adapter's own refusals are already French sentences (see
    // `ImageAttachments`); the core's are English, and only ever a wrong type.
    toast.error(reason === "adapter-error" ? message : "Images uniquement.");
  });
  return null;
}
