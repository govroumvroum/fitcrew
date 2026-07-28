"use client";

import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import type { ChatStatus } from "ai";
import { useAction, useMutation, useQuery } from "convex/react";
import { ImagePlusIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
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
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { ExtractedReview } from "@/components/import/extracted-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useLocalDate } from "@/lib/dates";

/** What the user sees happened, per tool. Anything unlisted stays silent. */
const TOOL_LABEL: Record<string, string> = {
  "tool-save_onboarding": "Profil enregistré",
  "tool-generate_program": "Programme enregistré",
  "tool-swap_exercise": "Exercice remplacé",
  "tool-log_workout": "Séance enregistrée",
};

export function CoachChat() {
  // undefined while loading OR while the profile row is still being created.
  const coachThread = useQuery(api.coach.thread);
  const threadId = coachThread?.threadId ?? undefined;
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
  const greeted = useRef(false);

  // A brand-new user has no thread yet: the coach's first session starts here.
  useEffect(() => {
    if (coachThread && coachThread.threadId === null) {
      void newThread().catch(() => toast.error("Le coach ne répond pas."));
    }
  }, [coachThread, newThread]);

  // Empty thread → the coach speaks first (no user message is saved for this).
  useEffect(() => {
    if (!threadId || !today || greeted.current) return;
    if (status !== "Exhausted" || results.length > 0) return;
    greeted.current = true;
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
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Retour</Link>
        </Button>
        <span className="font-heading text-base font-semibold tracking-tight">Coach</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Nouvelle conversation"
          onClick={() => {
            greeted.current = false;
            void newThread();
          }}
        >
          <RotateCcwIcon />
        </Button>
      </header>

      <Conversation>
        <ConversationContent className="gap-4">
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

      <div className="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <PromptInput accept="image/*" maxFiles={4} onSubmit={submit}>
          <PromptInputBody>
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
          </PromptInputBody>
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
            return output.entries.length > 0 ? (
              <ExtractedReview
                key={i}
                screenshotId={output.screenshotId}
                entries={output.entries}
              />
            ) : (
              <span key={i}>Je n&apos;ai rien réussi à lire sur cette capture.</span>
            );
          }

          const label = TOOL_LABEL[tool.type];
          if (!label || tool.state !== "output-available") return null;
          return (
            <Badge key={i} variant="secondary" className="self-start">
              {label}
            </Badge>
          );
        })}
      </MessageContent>
    </Message>
  );
}
