/** Self-check for the usage aggregate. Run: `bun convex/aiUsage.check.ts` */
import assert from "node:assert/strict";
import { costUsdFrom, sumUsage } from "./aiUsage";

// The point of the whole issue: two calls by the same user on the same day add up.
assert.deepEqual(
  sumUsage([
    {
      inputTokens: 1200,
      outputTokens: 300,
      reasoningTokens: 100,
      cachedInputTokens: 1024,
      costUsd: 0.004,
    },
    {
      inputTokens: 800,
      outputTokens: 150,
      reasoningTokens: 50,
      cachedInputTokens: 768,
      costUsd: 0.002,
    },
  ]),
  {
    calls: 2,
    inputTokens: 2000,
    outputTokens: 450,
    reasoningTokens: 150,
    cachedInputTokens: 1792,
    costUsd: 0.006,
  },
);

// Optional fields are absent whenever the model or provider didn't report them.
assert.deepEqual(
  sumUsage([
    {
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
      costUsd: undefined,
    },
    {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 2,
      cachedInputTokens: 1,
      costUsd: undefined,
    },
  ]),
  {
    calls: 2,
    inputTokens: 11,
    outputTokens: 6,
    reasoningTokens: 2,
    cachedInputTokens: 1,
    costUsd: 0,
  },
);

// A user with no calls in the period is zero, not a crash.
assert.deepEqual(sumUsage([]), {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  costUsd: 0,
});

// Cost comes from OpenRouter or not at all — never guessed from a rate table.
assert.equal(costUsdFrom({ openrouter: { usage: { cost: 0.0123 } } }), 0.0123);
assert.equal(costUsdFrom({ openrouter: { usage: { promptTokens: 10 } } }), undefined);
assert.equal(costUsdFrom({ openrouter: {} }), undefined);
assert.equal(costUsdFrom({ anthropic: { usage: { cost: 1 } } }), undefined);
assert.equal(costUsdFrom(undefined), undefined);

console.log("aiUsage aggregate ok");
