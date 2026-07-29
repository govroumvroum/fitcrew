"use client";

import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import type { ChatStatus } from "ai";
import { useAction, useMutation } from "convex/react";
import { ImagePlusIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Entry } from "../../../convex/screenshots";
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
import { ExtractedReview } from "@/components/import/extracted-review";
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
import { useCoachThread } from "@/components/chat/use-coach-thread";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useLocalDate } from "@/lib/dates";

export function CoachChat() {
  const { threadId, rollover } = useCoachThread();
  const today = useLocalDate();

  const newThread = useMutation(api.coach.newThread);
  const send = useAction(api.coach.send);
  const greet = useAction(api.coach.greet);
  const generateUploadUrl = useMutation(api.screenshots.generateUploadUrl);

  const { results, status, loadMore } = useUIMessages(
    api.coach.listMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 30, stream: true },
  );

  // The user's own message only exists once the action has saved it, so it's
  // echoed locally until it comes back over the subscription.
  const [pending, setPending] = useState<string | null>(null);
  // Holds the thread already greeted, not a boolean: switching conversations must
  // let an empty one be greeted too.
  const greeted = useRef<string | null>(null);

  // A brand-new user has no thread yet: the coach's first session starts here.
  useEffect(() => {
    if (rollover && rollover.threadId === null) {
      void newThread().catch(() => toast.error("Le coach ne répond pas."));
    }
  }, [rollover, newThread]);

  // Empty thread → the coach speaks first (no user message is saved for this).
  useEffect(() => {
    if (!threadId || !today || greeted.current === threadId) return;
    if (status !== "Exhausted" || results.length > 0) return;
    greeted.current = threadId;
    void greet({ threadId, today }).catch(() => toast.error("Le coach ne répond pas."));
  }, [threadId, today, status, results.length, greet]);

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

    const prompt = text || "Regarde cette capture.";
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
    echo !== null || last?.role === "user"
      ? "submitted"
      : last?.status === "streaming" || last?.status === "pending"
        ? "streaming"
        : "ready";

  return (
    <>
      <header className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
          {/* Once in the header, not per message: a repeated avatar down a phone
              chat is noise. The source PNG has no alpha, so the white field
              becomes the coin — hence ring rather than a border. */}
          <Image
            src="/coach.png"
            alt=""
            width={28}
            height={28}
            className="rounded-full ring-1 ring-white/10"
            priority
          />
          Coach
        </span>
        {/* "Nouvelle conversation" lives in the sidebar now — one button, one place. */}
        <SidebarTrigger className="size-11" aria-label="Conversations" />
      </header>

      <Conversation>
        {/* ph-mask: what the user tells the coach, and what it answers, stays
            out of session replay. */}
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
                <CoachMessage key={message.key} message={message} />
              ))}
              {echo && (
                <Message from="user">
                  <MessageContent>{echo}</MessageContent>
                </Message>
              )}
              {chatStatus === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Le coach réfléchit…
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
            placeholder="Écris au coach…"
            className="text-base sm:text-sm"
            disabled={!threadId}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <AttachButton />
            </PromptInputTools>
            <PromptInputSubmit status={chatStatus} disabled={!threadId} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

/** Their attachment context, our one-tap button — a dropdown for a single action is noise. */
function AttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label="Joindre une capture d'écran"
      onClick={attachments.openFileDialog}
    >
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

function CoachMessage({ message }: { message: UIMessage }) {
  const streaming = message.status === "streaming";

  return (
    <Message from={message.role}>
      {/* Assistant content goes full width: the screenshot review card lives in it. */}
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
          const tool = part as { type: string; state: string; output?: unknown };

          // The screenshot review is the one tool result the user must act on:
          // nothing lands in their profile until they confirm inside it.
          if (tool.type === "tool-extract_screenshot" && tool.state === "output-available") {
            const output = tool.output as { screenshotId: Id<"screenshots">; entries: Entry[] };
            // Empty extractions go through the card too: it already has the
            // copy for "I couldn't read this" AND a discard button, which a bare
            // sentence didn't — so the row and its uploaded file used to leak.
            return (
              <ExtractedReview
                key={i}
                screenshotId={output.screenshotId}
                entries={output.entries}
              />
            );
          }

          if (tool.state !== "output-available") return null;

          // Cards read the tool's input, which carries the whole program/profile;
          // the output only holds the resulting version number.
          const { input, output } = tool as { input?: unknown; output?: unknown };
          // `output-available` does not guarantee the input came back with it: a
          // streamed part reassembled from deltas can land the output first, and
          // every card below dereferences `input` through a cast that lies about
          // it. Crashed /coach in prod on mobile. search_web reads the output.
          if (!input && tool.type !== "tool-search_web") return null;
          switch (tool.type) {
            case "tool-generate_program":
              return (
                <ProgramCard
                  key={i}
                  input={input as ProgramInput}
                  version={(output as { version?: number })?.version}
                  isNew={streaming}
                />
              );
            case "tool-save_onboarding":
              return <ProfileCard key={i} input={input as ProfileInput} isNew={streaming} />;
            case "tool-swap_exercise": {
              const done = output as { version?: number; dayName?: string };
              return (
                <SwapCard
                  key={i}
                  input={input as SwapInput}
                  dayName={done?.dayName}
                  version={done?.version}
                  isNew={streaming}
                />
              );
            }
            // The one card that reads the output: the links are the result.
            case "tool-search_web":
              return <SourcesCard key={i} output={output as SearchOutput} isNew={streaming} />;
            case "tool-log_workout":
              return (
                <LoggedCard
                  key={i}
                  input={input as LoggedInput}
                  sets={(output as { sets?: number })?.sets}
                  isNew={streaming}
                />
              );
            default:
              // explain_exercise returns raw history for the model to narrate —
              // the prose above is the result, a card would just repeat it.
              return null;
          }
        })}
      </MessageContent>
    </Message>
  );
}
