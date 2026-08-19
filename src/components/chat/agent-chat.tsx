"use client";

import { useSmoothText, useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import type { ChatStatus } from "ai";
import { useAction, useMutation } from "convex/react";
import { ChevronDownIcon, ImagePlusIcon, WrenchIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useAgentThread, type AgentApi } from "@/components/chat/agent-thread";
import { ToolLine, type ToolIcon } from "@/components/chat/tool-cards";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useLocalDate } from "@/lib/dates";

/**
 * The chat shell both agents run on: threading, the greeting, the local echo, the
 * attachment upload and the streaming status derivation. /coach and /chef differ
 * only in which Convex functions they call, what the header says, and which cards
 * their tools render — everything else was identical, and duplicating it was the
 * fastest way to fix a bug in one place and not the other.
 */

/**
 * One tool part off the message stream. `input` and `output` are `unknown`
 * because that is the truth: an agent's `renderTool` casts them to its own tool's
 * shape, and the guard in `AgentMessage` is what makes that cast safe enough.
 */
export type ToolPart = { type: string; state: string; input?: unknown; output?: unknown };

/**
 * A tool that RETURNS its error instead of throwing — `search_web`, `fetch_url`
 * and `lookup_food` do, so a dead page can't abort the turn — never reaches
 * `output-error`. Without this the row read "Page lue" in success green over a
 * 429. Exported because the `/demo` gallery mirrors this branch by hand, and a
 * duplicated predicate is how the two drifted apart in the first place.
 */
export const toolErrored = (tool: ToolPart) =>
  Boolean((tool.output as { error?: string } | null)?.error);

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
  const { threadId, rollover } = useAgentThread(agent.api);
  const today = useLocalDate();

  const newThread = useMutation(agent.api.newThread);
  const send = useAction(agent.api.send);
  const greet = useAction(agent.api.greet);
  // Shared by both agents on purpose: one upload endpoint, one storage bucket —
  // the id travels out of band and the tools decide what the photo is for.
  const generateUploadUrl = useMutation(api.screenshots.generateUploadUrl);

  const { results, status, loadMore } = useUIMessages(
    agent.api.listMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 30, stream: true },
  );

  // The user's own message only exists once the action has saved it, so it's
  // echoed locally until it comes back over the subscription.
  const [pending, setPending] = useState<string | null>(null);
  // Holds the thread already greeted, not a boolean: switching conversations must
  // let an empty one be greeted too.
  const greeted = useRef<string | null>(null);

  // A brand-new user has no thread yet: the first session starts here.
  useEffect(() => {
    if (rollover && rollover.threadId === null) {
      void newThread().catch(() => toast.error(agent.unreachable));
    }
  }, [rollover, newThread, agent.unreachable]);

  // Empty thread → the agent speaks first (its priming turn is filtered out of
  // `listMessages`, so an already-greeted thread still shows the reply here).
  useEffect(() => {
    if (!threadId || !today || greeted.current === threadId) return;
    if (status !== "Exhausted" || results.length > 0) return;
    greeted.current = threadId;
    void greet({ threadId, today }).catch(() => toast.error(agent.unreachable));
  }, [threadId, today, status, results.length, greet, agent.unreachable]);

  // Derived, not cleared in an effect: the echo disappears the moment the real
  // message shows up in the thread.
  // Anywhere in the thread, not merely at its end: a card can write a user-role
  // message of its own (`choices-card.tsx`), which takes the last place and would
  // make this message look like it never landed — the composer's echo would come
  // back for good, spinner included.
  // ponytail: sending the exact same text twice in a row hides the second echo.
  // The spinner still shows, and the real message lands a moment later.
  const landed = results.some((m) => m.role === "user" && m.text === pending);
  const echo = pending !== null && !landed ? pending : null;

  /** Uploads to Convex storage; the id travels out of band, never in the prompt. */
  async function upload(file: { url: string; mediaType?: string }) {
    const blob = await fetch(file.url).then((res) => res.blob());
    const url = await generateUploadUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.mediaType ?? blob.type },
      body: blob,
    });
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  }

  async function submit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (!threadId || !today || (!text && message.files.length === 0)) return;

    const prompt = text || agent.attach.prompt;
    setPending(prompt);
    try {
      const storageIds = await Promise.all(message.files.map(upload));
      // Not awaited: the reply arrives over the listMessages subscription.
      void send({ threadId, prompt, today, storageIds }).catch((error: Error) => {
        setPending(null);
        toast.error(error.message);
      });
    } catch {
      setPending(null);
      toast.error("L'import a échoué.");
      throw new Error("upload failed"); // keeps the composer's content for a retry
    }
  }

  const last = results.at(-1);
  const chatStatus: ChatStatus =
    // Nothing in the thread means the greeting is on its way: `listMessages`
    // hides the priming turn, so there is no user message to wait behind.
    echo !== null || last === undefined || last.role === "user"
      ? "submitted"
      : last?.status === "streaming" || last?.status === "pending"
        ? "streaming"
        : "ready";

  return (
    <>
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

      <Conversation>
        {/* ph-mask: what the user tells the agent — their body, their food, their
            training — and what it answers, stays out of session replay. */}
        <ConversationContent className="ph-mask gap-4">
          {!threadId ? (
            <>
              <Skeleton className="h-16 w-4/5" />
              <Skeleton className="h-10 w-3/5" />
            </>
          ) : (
            <>
              {status === "CanLoadMore" && (
                <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
                  Voir les messages plus anciens
                </Button>
              )}
              {results.map((message) => (
                <AgentMessage key={message.key} message={message} agent={agent} />
              ))}
              {echo && (
                <Message from="user">
                  <MessageContent>{echo}</MessageContent>
                </Message>
              )}
              {chatStatus === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> {agent.thinking}
                </div>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* No safe-area pad here anymore: the shell stops at the tab bar, which
          carries the inset itself. */}
      <div className="p-2">
        {/*
          No PromptInputBody: it renders `display: contents`, and InputGroup only
          switches to a column via `has-[>[data-align=block-end]]` — a
          direct-child selector. `contents` changes box generation, not selector
          matching, so the wrapper stayed the real child, the selector never
          matched, and everything collapsed onto one 32px row.
        */}
        <PromptInput
          accept="image/*"
          multiple
          maxFiles={4}
          // 10 MB: a phone screenshot is 1-3 MB, a photo can be bigger.
          maxFileSize={10 * 1024 * 1024}
          // Drop anywhere on the page, not just on the composer — the composer
          // is a small target and the thing you're dragging covers it.
          globalDrop
          onError={(error) =>
            toast.error(
              error.code === "max_files"
                ? "4 images maximum."
                : error.code === "max_file_size"
                  ? "Image trop lourde (10 Mo max)."
                  : "Images uniquement.",
            )
          }
          onSubmit={submit}
        >
          {/* Paste needs no handler here: PromptInputTextarea already has its own
              onPaste that attaches clipboard files. */}
          <PendingAttachments />
          <PromptInputTextarea
            placeholder={agent.placeholder}
            className="text-base sm:text-sm"
            disabled={!threadId}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <AttachButton label={agent.attach.label} />
            </PromptInputTools>
            <PromptInputSubmit status={chatStatus} disabled={!threadId} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

/** Their attachment context, our one-tap button — a dropdown for a single action is noise. */
function AttachButton({ label }: { label: string }) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton aria-label={label} onClick={attachments.openFileDialog}>
      <ImagePlusIcon />
    </PromptInputButton>
  );
}

function PendingAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <Attachments variant="inline" className="px-3 pt-3">
      {attachments.files.map((file) => (
        <Attachment key={file.id} data={file} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

/**
 * Copy for a tool with no entry in `toolLabels`. A tool added to the backend and
 * forgotten here still shows something rather than nothing.
 */
export const FALLBACK: AgentToolLabel = {
  icon: WrenchIcon,
  pending: "Un instant…",
  done: "C'est fait.",
  failed: "Une action n'a pas marché.",
};

/**
 * A finished tool, collapsed to its one-line summary and opened on click.
 *
 * A completed card is a receipt: useful to check, not useful to re-read every
 * time you scroll past it. Seven of them expanded down a phone thread buried the
 * agent's actual words, which are the part you came for. So the line is the
 * default and the card is on demand.
 *
 * Native `<details>` — no state hook, and it survives re-render and thread paging
 * for free, which a `useState` here would not. Same trick as the day disclosures
 * inside `ProgramCard`.
 *
 * Cards that need the user to DO something are never collapsed: see
 * `needsValidation`. Hiding a confirm button behind a click is how an unconfirmed
 * analysis gets silently abandoned.
 */
function ToolDisclosure({ label, children }: { label: AgentToolLabel; children: React.ReactNode }) {
  return (
    <details className="group w-full">
      {/* The summary carries the same green as a card-less completed line, so
          "it worked" looks the same whether or not there is a card behind it. */}
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11px] text-success-text marker:hidden hover:brightness-110">
        <label.icon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{label.done}</span>
        <ChevronDownIcon className="chevron size-3.5 shrink-0" aria-hidden />
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/**
 * Deltas land in bursts (word chunks, throttled to 250 ms server-side), which
 * reads as stuttering. `useSmoothText` paces them out at a measured chars/sec
 * instead, so the text flows.
 */
function StreamedText({ text, streaming }: { text: string; streaming: boolean }) {
  // Only at mount: a message already finished when it renders shows in full.
  const [visible] = useSmoothText(text, { startStreaming: streaming });
  return <MessageResponse isAnimating={streaming}>{visible}</MessageResponse>;
}

function AgentMessage({ message, agent }: { message: UIMessage; agent: AgentConfig }) {
  const streaming = message.status === "streaming";

  return (
    <Message from={message.role}>
      {/* Assistant content goes full width: the review cards live in it. */}
      <MessageContent className={message.role === "user" ? undefined : "w-full"}>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return message.role === "user" ? (
              <span key={i}>{part.text}</span>
            ) : (
              <StreamedText key={i} text={part.text} streaming={streaming} />
            );
          }
          if (!part.type.startsWith("tool-")) return null;
          const tool = part as ToolPart;
          const label = agent.toolLabels[tool.type] ?? FALLBACK;

          // A tool has five states worth showing and we used to render only the
          // last one, so a 90-second `generate_meal_plan` looked like the app had
          // hung, and a tool that THREW left no trace in the thread at all.
          //
          // Every state leads with the SAME icon — the tool's own — so the row
          // keeps its identity while it progresses. It used to change icon per
          // state, which read as three unrelated rows.
          switch (tool.state) {
            case "input-streaming":
              // The model is still writing the arguments: it hasn't committed to
              // the action, so the copy stays vague.
              return <ToolLine key={i} Icon={label.icon} text={label.pending} shimmer />;
            case "input-available":
              // Arguments complete, the tool itself is executing: safe to name it.
              return (
                <ToolLine key={i} Icon={label.icon} text={label.running ?? label.pending} shimmer />
              );
            // `tone="failed"` is what puts the line in red AND adds the warning
            // triangle beside the tool's icon — without it a failure rendered
            // grey and indistinguishable from an in-flight row.
            case "output-error":
              return (
                <ToolLine
                  key={i}
                  Icon={label.icon}
                  text={label.failed ?? FALLBACK.failed!}
                  tone="failed"
                />
              );
            case "output-available":
              // See `toolErrored`: an error in the output, not a thrown one.
              if (toolErrored(tool))
                return (
                  <ToolLine
                    key={i}
                    Icon={label.icon}
                    text={label.failed ?? FALLBACK.failed!}
                    tone="failed"
                  />
                );
              break;
            // approval-* / output-denied: no tool here asks for approval, so these
            // never occur. Rendering nothing beats inventing copy for them.
            default:
              return null;
          }

          // See `outputOnly`: an input that hasn't landed yet would be
          // dereferenced through a cast that lies about it.
          if (!tool.input && !agent.outputOnly.includes(tool.type)) return null;

          const card = agent.renderTool(tool, streaming);
          // No card for this tool (its result is the prose above). The line still
          // says it ran — that's cheaper than the user wondering.
          if (!card) return <ToolLine key={i} Icon={label.icon} text={label.done} tone="done" />;
          // A card the user must act on stays open; everything else collapses.
          if (agent.needsValidation.includes(tool.type)) {
            return <Fragment key={i}>{card}</Fragment>;
          }
          return (
            <ToolDisclosure key={i} label={label}>
              {card}
            </ToolDisclosure>
          );
        })}
      </MessageContent>
    </Message>
  );
}
