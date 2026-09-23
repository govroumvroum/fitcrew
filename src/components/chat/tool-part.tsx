"use client";

import {
  makeAssistantToolUI,
  useAuiState,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { AgentConfig, AgentToolLabel } from "@/components/chat/agent-chat";
import { agentStatus } from "@/components/chat/convert-message";
import { ToolLine } from "@/components/chat/tool-cards";

/**
 * What a tool draws in the chat, in one place: the state machine, and its
 * registration with assistant-ui.
 *
 * `ToolPartView` is pure — a part in, a node out — so the `/demo` gallery renders
 * through it too. The gallery used to carry its own copy of this logic, and the
 * two drifted apart (see `toolErrored`).
 */

/**
 * One tool part off the message stream. `input` and `output` are `unknown`
 * because that is the truth: an agent's `renderTool` casts them to its own tool's
 * shape, and the guard in `ToolPartView` is what makes that cast safe enough.
 */
export type ToolPart = { type: string; state: string; input?: unknown; output?: unknown };

/**
 * A tool that RETURNS its error instead of throwing — `search_web`, `fetch_url`
 * and `lookup_food` do, so a dead page can't abort the turn — never reaches
 * `output-error`. Without this the row read "Page lue" in success green over a
 * 429.
 */
const toolErrored = (tool: ToolPart) =>
  Boolean((tool.output as { error?: string } | null)?.error);

/**
 * Copy for a tool with no entry in `toolLabels`. A tool added to the backend and
 * forgotten here still shows something rather than nothing.
 */
const FALLBACK: AgentToolLabel = {
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
function ToolDisclosure({ label, children }: { label: AgentToolLabel; children: ReactNode }) {
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

const Passthrough = ({ children }: { children: ReactNode }) => children;

/**
 * Every state a tool part can be in, drawn.
 *
 * A tool has five states worth showing and we used to render only the last one,
 * so a 90-second `generate_meal_plan` looked like the app had hung, and a tool
 * that THREW left no trace in the thread at all.
 *
 * Every state leads with the SAME icon — the tool's own — so the row keeps its
 * identity while it progresses. It used to change icon per state, which read as
 * three unrelated rows.
 */
export function ToolPartView({
  tool,
  config,
  isNew,
  Boundary = Passthrough,
  inputMissing = null,
}: {
  tool: ToolPart;
  config: AgentConfig;
  /** The message is still streaming; see `Surface` in the card files. */
  isNew: boolean;
  /** Wraps the card itself — /demo catches the fake-id cards that throw. */
  Boundary?: ComponentType<{ children: ReactNode }>;
  /** What to show when the input guard hides a card. The thread shows nothing;
   *  /demo says why. */
  inputMissing?: ReactNode;
}) {
  const label = config.toolLabels[tool.type] ?? FALLBACK;
  const failed = (
    <ToolLine Icon={label.icon} text={label.failed ?? FALLBACK.failed!} tone="failed" />
  );

  switch (tool.state) {
    case "input-streaming":
      // The model is still writing the arguments: it hasn't committed to the
      // action, so the copy stays vague.
      return <ToolLine Icon={label.icon} text={label.pending} shimmer />;
    case "input-available":
      // Arguments complete, the tool itself is executing: safe to name it.
      return <ToolLine Icon={label.icon} text={label.running ?? label.pending} shimmer />;
    // `tone="failed"` is what puts the line in red AND adds the warning triangle
    // beside the tool's icon — without it a failure rendered grey and
    // indistinguishable from an in-flight row.
    case "output-error":
      return failed;
    case "output-available":
      // See `toolErrored`: an error in the output, not a thrown one.
      if (toolErrored(tool)) return failed;
      break;
    // approval-* / output-denied: no tool here asks for approval, so these never
    // occur. Rendering nothing beats inventing copy for them.
    default:
      return null;
  }

  // `output-available` does NOT guarantee the input came back with it — a part
  // reassembled from deltas can land the output first — so a card that reads its
  // input stays hidden until the input exists (see `outputOnly`). Skipping this
  // guard crashed /coach in prod on mobile.
  if (!tool.input && !config.outputOnly.includes(tool.type)) return inputMissing;

  const card = config.renderTool(tool, isNew);
  // No card for this tool (its result is the prose above). The line still says it
  // ran — that's cheaper than the user wondering.
  if (!card) return <ToolLine Icon={label.icon} text={label.done} tone="done" />;
  // A card the user must act on stays open; everything else collapses.
  if (config.needsValidation.includes(tool.type)) return <Boundary>{card}</Boundary>;
  return (
    <ToolDisclosure label={label}>
      <Boundary>{card}</Boundary>
    </ToolDisclosure>
  );
}

type ToolCallProps = ToolCallMessagePartProps<unknown, unknown>;

/**
 * The part as the stream delivered it. `convertMessage` carries it in
 * `artifact` because assistant-ui's own view of it (`args`, `status`) papers over
 * exactly the case the input guard exists for.
 */
function toolPartOf(props: ToolCallProps): ToolPart {
  return (
    (props.artifact as ToolPart | undefined) ?? {
      type: `tool-${props.toolName}`,
      state: "output-available",
      input: props.args,
      output: props.result,
    }
  );
}

/** Only a streaming turn animates its cards in — not one merely left `pending`. */
const useIsNew = () => useAuiState((s) => agentStatus(s.message.metadata) === "streaming");

/**
 * assistant-ui's registry, fed from the agent config: one `makeAssistantToolUI`
 * per tool name in `toolLabels`, all drawing through `ToolPartView`.
 *
 * `display: "standalone"` on each: without it `<Thread>` folds consecutive tool
 * calls into one collapsed group, and a ChoicesCard the user has to find behind a
 * disclosure is a question that goes unanswered.
 *
 * Built once per config and cached, never per render: a new tool UI component on
 * every render re-registers it, which remounts every card in the thread.
 */
type AgentTools = { ToolUIs: ComponentType; Fallback: ComponentType<ToolCallProps> };
const cache = new WeakMap<AgentConfig, AgentTools>();

export function agentTools(config: AgentConfig): AgentTools {
  const hit = cache.get(config);
  if (hit) return hit;

  // A tool with no label still renders, with the FALLBACK copy — same promise
  // as before assistant-ui: a tool added to the backend and forgotten here shows
  // up as a line, not as nothing.
  function Fallback(props: ToolCallProps) {
    return <ToolPartView tool={toolPartOf(props)} config={config} isNew={useIsNew()} />;
  }

  const registrations = Object.keys(config.toolLabels).map((type) =>
    makeAssistantToolUI<unknown, unknown>({
      toolName: type.slice("tool-".length),
      display: "standalone",
      render: Fallback,
    }),
  );

  /** Renders no DOM: a tool UI only registers its renderer while mounted. */
  function ToolUIs() {
    return registrations.map((Registration, i) => <Registration key={i} />);
  }

  const tools = { ToolUIs, Fallback };
  cache.set(config, tools);
  return tools;
}
