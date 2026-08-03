"use client";

import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import type { ChatStatus } from "ai";
import { useAction, useMutation } from "convex/react";
import { ImagePlusIcon, TriangleAlertIcon } from "lucide-react";
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
 * What a tool says about itself while it works.
 *
 * `pending` is the model still writing the arguments — it hasn't committed to the
 * action yet, so the copy stays vague ("Je regarde ton menu…"). `running` is the
 * tool executing, where naming the action is safe ("J'écris ta semaine…").
 * `running` falls back to `pending` for tools too fast to be worth two strings.
 */
export type AgentToolLabel = { pending: string; running?: string; failed?: string };

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
  /** `isNew` is the message still streaming; see `Surface` in the card files. */
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
  // message shows up at the end of the thread.
  // ponytail: sending the exact same text twice in a row hides the second echo.
  // The spinner still shows, and the real message lands a moment later.
  const lastUser = results.findLast((m) => m.role === "user");
  const echo = pending !== null && lastUser?.text !== pending ? pending : null;

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
 * A tool in flight. Deliberately a line and not a card: it is replaced by the real
 * card the moment the output lands, and a card swapping for another card makes the
 * thread jump.
 *
 * Shimmer rather than a spinner — shadcn's `shimmer` utility, already imported via
 * `shadcn/tailwind.css` in globals.css, and it turns itself off under
 * prefers-reduced-motion. The text IS the affordance, so animating the text beats
 * parking a spinner next to it.
 *
 * The two states get different copy because they are different waits: while the
 * arguments stream in, the model is still deciding WHAT to do, and nothing is
 * running yet; once they're complete, the tool itself is executing. Conflating
 * them made `generate_meal_plan` claim it was writing the week before it had
 * decided to.
 *
 * An unlabelled tool falls back to generic copy rather than rendering nothing — a
 * tool added to the backend and forgotten here must still show something is up.
 */
function ToolRunning({ label, pending }: { label?: AgentToolLabel; pending: boolean }) {
  const text = pending
    ? (label?.pending ?? "Un instant…")
    : (label?.running ?? label?.pending ?? "Un instant…");
  return <p className="shimmer text-[11px] text-muted-foreground">{text}</p>;
}

/** A tool that threw. The agent usually explains it in prose too, but a silent
 *  failure left the user staring at a turn where nothing visibly happened. */
function ToolFailed({ label }: { label?: AgentToolLabel }) {
  return (
    <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      {label?.failed ?? "Une action n'a pas marché."}
    </p>
  );
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
              <MessageResponse key={i} isAnimating={streaming}>
                {part.text}
              </MessageResponse>
            );
          }
          if (!part.type.startsWith("tool-")) return null;
          const tool = part as ToolPart;

          // A tool has five states worth showing and we used to render only the
          // last one, so a 90-second `generate_meal_plan` looked like the app had
          // hung, and a tool that THREW left no trace in the thread at all.
          switch (tool.state) {
            case "input-streaming":
              return <ToolRunning key={i} label={agent.toolLabels[tool.type]} pending />;
            case "input-available":
              return <ToolRunning key={i} label={agent.toolLabels[tool.type]} pending={false} />;
            case "output-error":
              return <ToolFailed key={i} label={agent.toolLabels[tool.type]} />;
            case "output-available":
              break;
            // approval-* / output-denied: no tool here asks for approval, so these
            // never occur. Rendering nothing beats inventing copy for them.
            default:
              return null;
          }

          // See `outputOnly`: an input that hasn't landed yet would be
          // dereferenced through a cast that lies about it.
          if (!tool.input && !agent.outputOnly.includes(tool.type)) return null;
          // Fragment only to carry the key: the cards are block-level already, so
          // this generates no box of its own.
          return <Fragment key={i}>{agent.renderTool(tool, streaming)}</Fragment>;
        })}
      </MessageContent>
    </Message>
  );
}
