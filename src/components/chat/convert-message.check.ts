/**
 * Self-check for the Convex → assistant-ui message mapping.
 * Run: `bun src/components/chat/convert-message.check.ts`
 *
 * Every case here broke something in a browser before it was written down: a
 * whole thread refusing to render, a card dereferencing an input that wasn't
 * there, a composer locked after a question. Each goes through
 * `fromThreadMessageLike` — what `useExternalStoreRuntime` itself runs — so it
 * asserts on what the UI actually receives, not on our intermediate object.
 */
import assert from "node:assert/strict";
import { fromThreadMessageLike } from "@assistant-ui/react";
import type { UIMessage } from "@convex-dev/agent/react";
import {
  agentStatus,
  convertMessage,
  ECHO_KEY,
  separateSummaries,
  settled,
  threadIsRunning,
  toolPartFromCall,
} from "@/components/chat/convert-message";
import type { ToolPart } from "@/components/chat/tool-part";

const FALLBACK = { type: "complete", reason: "unknown" } as const;
const toThread = (m: UIMessage) =>
  fromThreadMessageLike(convertMessage(m), "fallback-id", FALLBACK);

function message(overrides: Partial<UIMessage> & Pick<UIMessage, "parts">): UIMessage {
  return {
    id: "m1",
    key: "thread-1-5-0",
    order: 5,
    stepOrder: 0,
    role: "assistant",
    status: "success",
    text: "",
    _creationTime: 1_700_000_000_000,
    ...overrides,
  } as UIMessage;
}

// --- Unknown part types are dropped, not handed over. assistant-ui throws on
// `step-start` (one message like that and the whole thread fails to render), and
// takes an AI SDK `file` part without complaint while rendering it wrong.
{
  const raw = message({
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "je réfléchis", state: "done" },
      { type: "text", text: "Bonjour" },
      { type: "source-url", sourceId: "s1", url: "https://example.com" },
      { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
      {
        type: "dynamic-tool",
        toolName: "x",
        toolCallId: "d1",
        state: "input-streaming",
        input: {},
      },
    ] as UIMessage["parts"],
  });
  // Unfiltered, assistant-ui refuses the message outright.
  assert.throws(() =>
    fromThreadMessageLike(
      { role: "assistant", content: [{ type: "step-start" } as never] },
      "x",
      FALLBACK,
    ),
  );
  const out = toThread(raw);
  assert.deepEqual(
    out.content.map((p) => p.type),
    ["reasoning", "text"],
    "only text, reasoning and tool-* parts survive",
  );
}

// --- Reasoning is kept: the model thinks 10–30 s between two tool calls, and a
// tool line followed by that much silence read as the app having hung. Its
// streaming state rides along, because assistant-ui's own guess (the last part
// of a running message is running) kept a finished block shimmering through the
// gap before the next step.
{
  const raw = message({
    status: "streaming",
    parts: [
      { type: "reasoning", text: "je relis le plan", state: "done" },
      { type: "text", text: "Je regarde.", state: "done" },
      { type: "reasoning", text: "puis la journée", state: "streaming" },
    ] as UIMessage["parts"],
  });
  const out = toThread(raw);
  assert.deepEqual(
    out.content.map((p) => [p.type, (p as { status?: { type: string } }).status?.type]),
    [
      ["reasoning", "complete"],
      ["text", "complete"],
      ["reasoning", "running"],
    ],
    "a part's own streaming state becomes its status",
  );
  assert.equal((out.content[0] as { text: string }).text, "je relis le plan");
}

// The agent leaves a part at `streaming` until its whole step is saved, tool call
// included. Believed, the reasoning kept spinning « réfléchit… » above the tool
// that followed it for 37 s. Only the very last part may be running.
{
  const out = toThread(
    message({
      status: "streaming",
      parts: [
        { type: "reasoning", text: "je prépare la semaine", state: "streaming" },
        { type: "text", text: "C'est parti.", state: "streaming" },
        {
          type: "tool-generate_meal_plan",
          toolCallId: "c9",
          state: "input-available",
          input: { days: [] },
        },
      ] as UIMessage["parts"],
    }),
  );
  assert.deepEqual(
    out.content.map((p) => [p.type, (p as { status?: { type: string } }).status?.type]),
    [
      ["reasoning", "complete"],
      ["text", "complete"],
      ["tool-call", undefined],
    ],
    "a part with something after it is done, whatever its state says",
  );
}

// Summaries streamed as one part come glued: each title gets its break back,
// and a bold word inside a sentence is left alone.
{
  assert.equal(
    separateSummaries("700 kcal par repas en moyenne.**Ajuster le plan**\n\nJe regarde."),
    "700 kcal par repas en moyenne.\n\n**Ajuster le plan**\n\nJe regarde.",
  );
  assert.equal(separateSummaries("Fini.**Titre en cours**"), "Fini.\n\n**Titre en cours**");
  assert.equal(separateSummaries("Un **très** bon plan."), "Un **très** bon plan.");
  const out = toThread(
    message({
      parts: [
        { type: "reasoning", text: "Fin.**Suite**\nDétail", state: "done" },
      ] as UIMessage["parts"],
    }),
  );
  assert.equal((out.content[0] as { text: string }).text, "Fin.\n\n**Suite**\nDétail");
}

// No state (an older saved row): no status, so assistant-ui keeps its own guess.
{
  const out = toThread(
    message({ parts: [{ type: "reasoning", text: "hmm" }] as UIMessage["parts"] }),
  );
  assert.equal((out.content[0] as { status?: unknown }).status, undefined);
}

// An empty reasoning block (the provider's encrypted-only kind) is dropped by
// assistant-ui itself, so it can't draw an empty « Réflexion » line.
{
  const out = toThread(
    message({
      parts: [
        { type: "reasoning", text: "", state: "done" },
        { type: "text", text: "Salut" },
      ] as UIMessage["parts"],
    }),
  );
  assert.deepEqual(out.content.map((p) => p.type), ["text"]);
}

// A user message never carries reasoning into the bubble.
{
  const out = toThread(
    message({
      role: "user",
      parts: [
        { type: "reasoning", text: "x", state: "done" },
        { type: "text", text: "Salut" },
      ] as UIMessage["parts"],
    }),
  );
  assert.deepEqual(out.content.map((p) => p.type), ["text"]);
}

// A user message's uploaded image (`file`) is dropped too: the bubble never
// showed it, and a `file` part on a user message is exactly the wrong-format case.
{
  const out = toThread(
    message({
      role: "user",
      parts: [
        { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
        { type: "text", text: "Regarde" },
      ] as UIMessage["parts"],
    }),
  );
  assert.deepEqual(
    out.content.map((p) => p.type),
    ["text"],
  );
}

// --- Output before input. A part reassembled from deltas can land with its
// output and no input yet. assistant-ui fills the missing args with `{}` (truthy)
// and reports `complete`, so an input guard reading its view would pass and the
// card would dereference `undefined`. The untouched part must ride along.
{
  const tool = {
    type: "tool-generate_program",
    toolCallId: "c1",
    state: "output-available",
    input: undefined,
    output: { version: 3 },
  };
  const out = toThread(message({ status: "streaming", parts: [tool] as UIMessage["parts"] }));
  const part = out.content[0] as {
    type: string;
    toolName: string;
    args: unknown;
    result: unknown;
    artifact: typeof tool;
  };
  assert.equal(part.type, "tool-call");
  assert.equal(part.toolName, "generate_program");
  // What assistant-ui makes of it: why its view can't drive the guard.
  assert.ok(part.args, "a missing input comes back truthy");
  assert.deepEqual(Object.keys(part.args as object), []);
  assert.deepEqual(part.result, { version: 3 });
  // What `ToolPartView` reads instead: the part as it came.
  assert.equal(part.artifact, tool);
  assert.equal(part.artifact.input, undefined);
  assert.equal(part.artifact.state, "output-available");
}

// A tool that threw carries no result, and is flagged as an error.
{
  const out = toThread(
    message({
      parts: [
        {
          type: "tool-search_web",
          toolCallId: "c2",
          state: "output-error",
          input: { query: "q" },
          errorText: "429",
        },
      ] as UIMessage["parts"],
    }),
  );
  const part = out.content[0] as { result: unknown; isError?: boolean };
  assert.equal(part.result, undefined);
  assert.equal(part.isError, true);
}

// --- A tool that threw, as STORED. The AI SDK saves a throw as a result whose
// output is `{ type: "error-text", value }`, without `isError`, and the agent's
// `toUIMessages` unwraps it to `output-available` with the message as a string.
// Left as a success, ask_choices read `choicesId` off the string and sent
// `choices:status` an empty argument object on every load of /chef.
{
  const out = toThread(
    message({
      parts: [
        {
          type: "tool-ask_choices",
          toolCallId: "c3",
          state: "output-available",
          input: { questions: [] },
          output: "ask_choices appelé hors conversation",
        },
      ] as UIMessage["parts"],
    }),
  );
  const part = out.content[0] as {
    result: unknown;
    isError?: boolean;
    artifact: ToolPart & { errorText?: string };
  };
  assert.equal(part.artifact.state, "output-error");
  assert.equal(part.artifact.output, undefined);
  assert.equal(part.artifact.errorText, "ask_choices appelé hors conversation");
  assert.equal(part.result, undefined);
  assert.equal(part.isError, true);
  // An object output, the only kind our tools return, is left alone.
  const ok = { type: "tool-ask_choices", state: "output-available", output: { choicesId: "x" } };
  assert.equal(settled(ok), ok);
}

// --- A part rebuilt from assistant-ui's view (no `artifact`). It used to claim
// `output-available` while the tool was still running, handing the card an
// undefined output.
{
  const call = { toolName: "ask_choices", args: { questions: [] } };
  assert.deepEqual(toolPartFromCall({ ...call, status: { type: "running" } }), {
    type: "tool-ask_choices",
    state: "input-available",
    input: call.args,
  });
  assert.equal(
    toolPartFromCall({ ...call, status: { type: "requires-action" } }).state,
    "input-available",
  );
  assert.deepEqual(
    toolPartFromCall({ ...call, result: { choicesId: "x" }, status: { type: "complete" } }),
    {
      type: "tool-ask_choices",
      state: "output-available",
      input: call.args,
      output: { choicesId: "x" },
    },
  );
  assert.equal(
    toolPartFromCall({ ...call, result: "boom", isError: true, status: { type: "complete" } })
      .state,
    "output-error",
  );
  assert.equal(
    toolPartFromCall({ ...call, status: { type: "incomplete" } }).state,
    "output-error",
  );
}

// --- Stable ids: the stream's key, whatever the content. A generated id would
// remount the message — and restart its text animation — on every delta.
{
  const a = toThread(message({ status: "streaming", parts: [{ type: "text", text: "Bon" }] }));
  const b = toThread(
    message({ status: "streaming", parts: [{ type: "text", text: "Bonjour à toi" }] }),
  );
  assert.equal(a.id, "thread-1-5-0");
  assert.equal(b.id, a.id);
  const echo = fromThreadMessageLike(
    convertMessage({ key: ECHO_KEY, role: "user", text: "Salut" }),
    "fallback-id",
    FALLBACK,
  );
  assert.equal(echo.id, ECHO_KEY);
  assert.equal(echo.metadata.isOptimistic, true);
}

// --- Status. Only `streaming` is running; `pending` (a turn that ended on
// `ask_choices`, waiting for the answer) is not — and keeps its own status where
// a renderer can tell it apart.
{
  const status = (s: UIMessage["status"]) =>
    toThread(message({ status: s, parts: [{ type: "text", text: "x" }] }));
  assert.equal(status("streaming").status?.type, "running");
  assert.equal(status("pending").status?.type, "complete");
  assert.equal(status("success").status?.type, "complete");
  assert.equal(status("failed").status?.type, "incomplete");
  assert.equal(agentStatus(status("pending").metadata), "pending");
}

// --- The thread's `isRunning`, which is what disables sending.
{
  const assistant = (s: UIMessage["status"]) =>
    message({ status: s, parts: [{ type: "text", text: "x" }] });
  const base = { threadId: "t1", loading: false, echo: null };

  // After `ask_choices` the agent's message stays pending: the user must still
  // be able to type a free answer.
  assert.equal(threadIsRunning({ ...base, last: assistant("pending") }), false);
  assert.equal(threadIsRunning({ ...base, last: assistant("success") }), false);
  assert.equal(threadIsRunning({ ...base, last: assistant("failed") }), false);
  assert.equal(threadIsRunning({ ...base, last: assistant("streaming") }), true);
  // Submitted: our echo, or the user's message saved with nothing after it
  // (a ChoicesCard writes one itself), or an empty thread awaiting its greeting.
  assert.equal(threadIsRunning({ ...base, echo: "Salut", last: assistant("success") }), true);
  assert.equal(
    threadIsRunning({
      ...base,
      last: message({ role: "user", parts: [{ type: "text", text: "3" }] }),
    }),
    true,
  );
  assert.equal(threadIsRunning({ ...base, last: undefined }), true);
  // Never before the thread is known — the server render included, where it
  // would emit a placeholder reply with a random id and fail hydration — nor
  // while its first page loads, when an empty list means nothing yet.
  assert.equal(threadIsRunning({ ...base, threadId: undefined, last: undefined }), false);
  assert.equal(threadIsRunning({ ...base, loading: true, last: undefined }), false);
}

console.log("convertMessage ok");
