import type { ThreadMessageLike } from "@assistant-ui/react";
import type { UIMessage } from "@convex-dev/agent/react";
import type { ToolPart } from "@/components/chat/tool-part";

/**
 * The agent's message stream (`useUIMessages`) → assistant-ui's message shape.
 *
 * Pure on purpose: every trap below was found in a browser, and each one is
 * pinned by `convert-message.check.ts` instead of by a click-through.
 */

/** The id of the user's own message while it is echoed locally (see `withEcho`). */
export const ECHO_KEY = "__echo__";

/** The one row that isn't a real message: the composer's echo. */
export type EchoRow = { key: typeof ECHO_KEY; role: "user"; text: string };
export type Row = UIMessage | EchoRow;

type Content = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * The agent's own status, kept on the message so a renderer can tell a turn that
 * is streaming from one merely left `pending` (read back with `agentStatus`).
 */
type Custom = { agentStatus?: UIMessage["status"] };

export function agentStatus(metadata: { custom?: Record<string, unknown> }) {
  return (metadata.custom as Custom | undefined)?.agentStatus;
}

export function convertMessage(row: Row): ThreadMessageLike {
  if (row.key === ECHO_KEY) {
    return {
      id: ECHO_KEY,
      role: "user",
      content: [{ type: "text", text: row.text }],
      metadata: { isOptimistic: true },
    };
  }
  const message = row as UIMessage;

  // A whitelist, not a blacklist: assistant-ui THROWS on a part type it doesn't
  // know (`Unsupported assistant message part type: step-start`), and accepts a
  // `file` part in the AI SDK's shape without complaint while rendering it wrong.
  // Text and tool calls are all the chat has ever shown — reasoning, step
  // markers, sources and the user's uploaded images were already dropped.
  const content: Content[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (message.role === "assistant" && part.type.startsWith("tool-")) {
      const tool = part as ToolPart & { toolCallId: string };
      content.push({
        type: "tool-call",
        toolCallId: tool.toolCallId,
        toolName: tool.type.slice("tool-".length),
        // assistant-ui turns a missing `args` into `{}` — truthy — and calls the
        // call `complete` the moment a result exists, even when the output
        // landed before the input did. So neither can drive the input guard:
        // the untouched part rides along in `artifact`, and `ToolPartView` runs
        // our own state machine on it.
        args: (tool.input ?? undefined) as never,
        result: tool.state === "output-available" ? (tool.output ?? null) : undefined,
        isError: tool.state === "output-error" || undefined,
        artifact: tool,
      });
    }
  }

  return {
    // The stream's own key, stable across deltas. A generated id would remount
    // the message on every chunk.
    id: message.key,
    role: message.role,
    content,
    createdAt: new Date(message._creationTime),
    status:
      message.role !== "assistant"
        ? undefined
        : message.status === "streaming"
          ? { type: "running" }
          : message.status === "failed"
            ? { type: "incomplete", reason: "error" }
            : // `pending` included: a turn that ended on `ask_choices` stays
              // pending until the user answers, and it isn't running.
              { type: "complete", reason: "unknown" },
    metadata: { custom: { agentStatus: message.status } satisfies Custom },
  };
}

/**
 * Whether the thread counts as busy — assistant-ui disables sending while it is.
 *
 * Only a turn actually on its way counts: the user's message just sent (echoed
 * or saved, nothing after it yet), an empty thread waiting for its greeting, or
 * a reply streaming. A message left `pending` does NOT: after `ask_choices` the
 * agent's message stays pending until the user answers, and counting it locked
 * the composer, so a free-text answer could not be sent.
 */
export function threadIsRunning({
  threadId,
  loading,
  echo,
  last,
}: {
  threadId: string | undefined;
  /** First page still loading: an empty list says nothing about the thread yet. */
  loading: boolean;
  echo: string | null;
  last: UIMessage | undefined;
}) {
  // Before the thread is known — including the whole server render — running
  // would make assistant-ui render a placeholder reply with a random id, which
  // the client then renders with another: a hydration mismatch.
  if (!threadId || loading) return false;
  return echo !== null || last === undefined || last.role === "user" || last.status === "streaming";
}
