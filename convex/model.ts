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
