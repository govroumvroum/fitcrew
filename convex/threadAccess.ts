/**
 * Who may read a conversation's messages — shared by the Coach and the Chef, so
 * both `listMessages` answer a missing thread the same way.
 *
 * A thread that no longer exists reads as an empty, finished conversation instead
 * of throwing. The client keeps subscribing to a thread for a moment after it is
 * gone: deleting the open conversation clears `?thread=`, and while the daily
 * rollover reloads the chat still shows — and still queries — the thread it had
 * (on purpose, so a return to a route hidden under `<Activity>` doesn't flash
 * empty). A stale `?thread=` link does the same. `usePaginatedQuery` rethrows a
 * query error during render, so a throw here was the whole app's error page.
 *
 * Only "does not exist" is loosened. Someone else's thread still throws.
 */
import type { StreamArgs, SyncStreamsReturnValue, ThreadDoc, UIMessage } from "@convex-dev/agent";
import type { PaginationResult } from "convex/server";

/** `"missing"`: nothing to show. Throws for a thread that isn't the caller's. */
export function messagesAccess(
  thread: Pick<ThreadDoc, "userId"> | null,
  userId: string,
): "missing" | "owner" {
  if (!thread) return "missing";
  // Same message as `authorize`: someone else's thread doesn't exist for you.
  if (thread.userId !== userId) throw new Error("Conversation introuvable");
  return "owner";
}

/**
 * What `listUIMessages` + `syncStreams` return for a thread with nothing in it:
 * a done page, and — when streams were asked for — an empty list of the kind
 * asked for. `useDeltaStreams` reads `streams.messages` / `streams.deltas`
 * unguarded, so `streams` must follow `streamArgs` exactly as `syncStreams` does.
 */
export function emptyMessages(
  streamArgs: StreamArgs,
): PaginationResult<UIMessage> & { streams: SyncStreamsReturnValue } {
  const streams: SyncStreamsReturnValue = !streamArgs
    ? undefined
    : streamArgs.kind === "list"
      ? { kind: "list", messages: [] }
      : { kind: "deltas", deltas: [] };
  return { page: [], isDone: true, continueCursor: "", streams };
}

/**
 * `greet` for a thread that may already be gone. The client greets an empty
 * thread, and a deleted one reads as empty (above) — so right after deleting the
 * open conversation, or on a stale `?thread=`, it greets a thread that no longer
 * exists. It can't tell "empty" from "gone", so the answer is here: skip, return
 * `null`, no toast on a delete that worked.
 *
 * Someone else's thread still throws, before anything runs. `run` streams the
 * greeting and keeps its own `authorize`.
 */
export async function greetIfExists(
  thread: Pick<ThreadDoc, "userId"> | null,
  userId: string,
  run: () => Promise<void>,
): Promise<null> {
  if (messagesAccess(thread, userId) === "missing") return null;
  await run();
  return null;
}
