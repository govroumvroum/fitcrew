"use client";

import { useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { useAction, useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AgentConfig } from "@/components/chat/agent-chat";
import { useAgentThread } from "@/components/chat/agent-thread";
import {
  convertMessage,
  ECHO_KEY,
  threadIsRunning,
  type EchoRow,
  type Row,
} from "@/components/chat/convert-message";
import { ImageAttachments } from "@/components/chat/image-attachments";
import { useLocalDate } from "@/lib/dates";

/**
 * assistant-ui's runtime, driven by the agent's Convex functions — the same for
 * the Coach and the Chef, since they expose the same `AgentApi`.
 *
 * The backend didn't move: messages are still the `listMessages` stream and a
 * send is still the `send` action. assistant-ui is handed that list
 * (`useExternalStoreRuntime`) and never owns a message itself; replies arrive
 * over the subscription.
 */
export function useAgentRuntime(agent: AgentConfig) {
  const thread = useAgentThread(agent.api);
  const { rollover } = thread;
  // Same return trip, one level up: the rollover query resubscribes too, and the
  // thread id reads `undefined` until it answers — skeleton, empty list, and the
  // messages query not even started. While it is merely reloading, the thread we
  // were showing is still the right one.
  const [lastThreadId, setLastThreadId] = useState<string>();
  if (thread.threadId && thread.threadId !== lastThreadId) setLastThreadId(thread.threadId);
  const threadId = thread.threadId ?? (rollover === undefined ? lastThreadId : undefined);
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

  // Coming back to the chat after a client navigation, the route was hidden
  // under <Activity>, not unmounted — but its subscription was dropped, and the
  // query passes through ~300 ms of `LoadingFirstPage` with nothing in it. The
  // thread would flash empty behind a "réfléchit…" bubble. Keep what we had
  // until the first page comes back.
  //
  // Compared by a signature, not by identity: `results` is a fresh array on
  // every render, and a state update keyed on it would loop forever.
  const last = results.at(-1);
  const signature = `${threadId}|${results.length}|${last?.key}|${last?.status}|${last?.text.length}`;
  const [kept, setKept] = useState<{ signature: string; threadId?: string; results: UIMessage[] }>({
    signature: "",
    results: [],
  });
  const loading = status === "LoadingFirstPage";
  if (!loading && results.length > 0 && kept.signature !== signature) {
    setKept({ signature, threadId, results });
  }
  // Not only when the list is empty: mid-stream, the stream subscription comes
  // back before the page does, and the list reads as just the turn in flight.
  const shown = loading && kept.threadId === threadId ? kept.results : results;

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
  // make this message look like it never landed — the echo would come back for
  // good, spinner included.
  // ponytail: sending the exact same text twice in a row hides the second echo.
  // The spinner still shows, and the real message lands a moment later.
  const landed = shown.some((m) => m.role === "user" && m.text === pending);
  const echo = pending !== null && !landed ? pending : null;

  // One object per echo text: assistant-ui caches each converted message by the
  // identity of the row it came from.
  const echoRow = useMemo<EchoRow | null>(
    () => (echo === null ? null : { key: ECHO_KEY, role: "user", text: echo }),
    [echo],
  );
  const messages = useMemo<Row[]>(() => (echoRow ? [...shown, echoRow] : shown), [shown, echoRow]);

  const isRunning = threadIsRunning({ threadId, loading, echo, last: shown.at(-1) });

  /** Uploads to Convex storage; the id travels out of band, never in the prompt. */
  const [attachments] = useState(
    () =>
      new ImageAttachments(async (file) => {
        try {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!res.ok) throw new Error(`upload ${res.status}`);
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          return storageId;
        } catch (error) {
          // Rethrown: the composer then keeps the text and the images for a retry.
          toast.error("L'import a échoué.", { id: "upload-failed" });
          throw error;
        }
      }),
  );

  async function onNew(message: AppendMessage) {
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    const storageIds = (message.attachments ?? [])
      .map((a) => attachments.storageId(a.id))
      .filter((id): id is Id<"_storage"> => id !== undefined);
    if (!threadId || !today || (!text && storageIds.length === 0)) return;

    const prompt = text || agent.attach.prompt;
    setPending(prompt);
    // Not awaited: the reply arrives over the listMessages subscription.
    void send({ threadId, prompt, today, storageIds }).catch((error: Error) => {
      setPending(null);
      toast.error(error.message);
    });
  }

  const runtime = useExternalStoreRuntime<Row>({
    messages,
    convertMessage,
    isRunning,
    // No thread yet: nothing to send to.
    isDisabled: !threadId,
    onNew,
    adapters: { attachments },
  });

  return { runtime, threadId, status, loadMore };
}
