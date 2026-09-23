"use client";

import { useSmoothText } from "@convex-dev/agent/react";
import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/**
 * The agent's prose, as Markdown. Streamdown rather than assistant-ui's
 * `MarkdownTextPrimitive`: it is block-aware while a message streams, and
 * `StreamedText` below paces it (#101) — swapping the renderer would regress both.
 *
 * No cjk/code/math/mermaid Streamdown plugins: a fitness coach writes bold, lists
 * and headings, never LaTeX or diagrams, and they pulled shiki + katex + mermaid
 * into the bundle. Re-add the one you need if that changes.
 */
const MessageResponse = memo(
  ({ className, ...props }: ComponentProps<typeof Streamdown>) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      {...props}
    />
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);
MessageResponse.displayName = "MessageResponse";

/**
 * Deltas land in bursts (word chunks, throttled to 250 ms server-side), which
 * reads as stuttering. `useSmoothText` paces them out at a measured chars/sec
 * instead, so the text flows.
 */
export function StreamedText({ text, streaming }: { text: string; streaming: boolean }) {
  // Only at mount: a message already finished when it renders shows in full.
  const [visible] = useSmoothText(text, { startStreaming: streaming });
  return <MessageResponse isAnimating={streaming}>{visible}</MessageResponse>;
}
