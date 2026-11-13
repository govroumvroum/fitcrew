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

/**
 * A tool that THREW comes back from the agent as a success whose output is the
 * error message.
 *
 * The AI SDK stores a thrown tool as a `tool-result` with `output: { type:
 * "error-text", value }` and no `isError` flag, and `@convex-dev/agent`'s
 * `toUIMessages` unwraps that to `state: "output-available"` with the message as
 * a bare string. No tool of ours returns a string — they all return objects,
 * errors included (`{ error }`, see `toolErrored`) — so a string output can only
 * be a throw. Left as a success, `ask_choices` read `choicesId` off that string,
 * got `undefined`, and `choices:status` rejected the call on every load of /chef.
 */
export function settled<T extends ToolPart>(tool: T): T {
  if (tool.state !== "output-available" || typeof tool.output !== "string") return tool;
  return { ...tool, state: "output-error", output: undefined, errorText: tool.output } as T;
}

/** The slice of assistant-ui's `ToolCallMessagePartProps` that `toolPartFromCall` reads. */
export type ToolCall = {
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  status: { type: string };
};

/**
 * A tool part rebuilt from assistant-ui's own view of the call, for when the
 * stream's part didn't ride along in `artifact`.
 *
 * It used to claim `output-available` whatever the call's status, so a call
 * still running reached a card with `output: undefined`. The state follows the
 * result instead: no result is no output, whatever the status says.
 */
export function toolPartFromCall(call: ToolCall): ToolPart {
  const base = { type: `tool-${call.toolName}`, input: call.args };
  if (call.isError || call.status.type === "incomplete") {
    return { ...base, state: "output-error", output: call.result };
  }
  if (call.result !== undefined) return { ...base, state: "output-available", output: call.result };
  return { ...base, state: "input-available" };
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
      const tool = settled(part as ToolPart & { toolCallId: string });
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
