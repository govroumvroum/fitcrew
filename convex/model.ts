import { createOpenRouter } from "@openrouter/ai-sdk-provider";

/**
 * Single swap point for the LLM. Verified on OpenRouter: structured outputs,
 * tool calling, and image input (the last one is what #5 needs).
 */
export const MODEL_ID = "openai/gpt-5.6-luna";

export function languageModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return createOpenRouter({ apiKey }).chat(MODEL_ID);
}

/**
 * How much of the thread each agent re-sends. Shared so the coach and the chef
 * cannot drift apart — they already had the same 20 with two copies of a comment
 * justifying it, and one of them was wrong.
 *
 * The whole conversation, because prompt caching makes appended history nearly
 * free: history grows at the END, so the prefix is stable and the added turns
 * bill at the cached rate. What that does NOT survive is a prefix that changes —
 * the system prompt is rebuilt from live state every call, so today it misses the
 * cache anyway. That's #72, and it is what makes this cheap rather than merely
 * correct.
 *
 * There is no "unlimited": this is a pagination `numItems`, so a number it is.
 * 1000 rows is far above any real thread (one per day, ~2 rows per exchange) and
 * keeps the read bounded like every other read in this codebase.
 *
 * ponytail: no `excludeToolMessages` here on purpose. It was worth considering
 * only because tool rows ate a 20-row budget; at 1000 there is nothing to save,
 * and dropping them would lose what a tool actually found — the vision analysis,
 * the web search — so the model would answer "what did you find?" with nothing.
 */
export const CONTEXT_OPTIONS = { recentMessages: 1000 } as const;
