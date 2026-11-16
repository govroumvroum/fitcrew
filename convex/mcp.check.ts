/**
 * Self-check for the MCP server (#135): the tool surface agents see, and the
 * batch-tick logic behind `check_shopping_items`.
 * Run: `bun convex/mcp.check.ts`
 *
 * The HTTP surface (401, two-user isolation) is exercised live against the dev
 * deployment: `@convex-dev/mcp/test` relies on Vite's `import.meta.glob`, which
 * bun doesn't provide.
 */
import assert from "node:assert/strict";
import { mcp } from "./mcp";
import { checkKeys, parisDate } from "./weekPlanLogic";

// --- No risky setup -----------------------------------------------------------
// `lint()` flags a write tool without a scope, a tool without annotations, or a
// server with no scopes at all.
assert.deepEqual(mcp.lint(), []);

// --- Exactly the three tools, with their scopes and annotations --------------
const tools = mcp.options.tools;
assert.deepEqual(Object.keys(tools).sort(), [
  "check_shopping_items",
  "get_shopping_list",
  "get_week_plan",
]);
assert.equal(tools.get_week_plan.scope, "meals:read");
assert.equal(tools.get_shopping_list.scope, "meals:read");
assert.equal(tools.check_shopping_items.scope, "shopping:write");
assert.deepEqual(tools.get_week_plan.annotations, { readOnlyHint: true });
assert.deepEqual(tools.get_shopping_list.annotations, { readOnlyHint: true });
assert.deepEqual(tools.check_shopping_items.annotations, { idempotentHint: true });
// `returns` is the allowlist of fields that reach the agent.
for (const name of Object.keys(tools)) {
  assert.ok(tools[name].returns, `${name} declares returns`);
}
assert.deepEqual(Object.keys(mcp.options.scopes ?? {}).sort(), ["meals:read", "shopping:write"]);
assert.equal(mcp.options.deviceFlow, false, "no consent page in V1: no device flow");

// --- Europe/Paris today, server-side -----------------------------------------
// Sunday 15 Nov 2026, 23:30 UTC is Monday 00:30 in Paris: the week already
// flipped, though UTC still says Sunday.
assert.equal(parisDate(new Date("2026-11-15T22:59:00Z")), "2026-11-15");
assert.equal(parisDate(new Date("2026-11-15T23:30:00Z")), "2026-11-16");
// Summer time (UTC+2): Sunday 22:30 UTC is Monday 00:30 in Paris.
assert.equal(parisDate(new Date("2026-06-14T22:30:00Z")), "2026-06-15");

// --- A whole basket, one pass ------------------------------------------------
const list = ["poulet", "riz", "citron"];
assert.deepEqual(checkKeys([], list, ["poulet", "riz"], true), ["poulet", "riz"]);
assert.deepEqual(checkKeys(["poulet"], list, ["riz"], true), ["poulet", "riz"]);
assert.deepEqual(checkKeys(["poulet", "riz"], list, ["poulet"], false), ["riz"]);
assert.deepEqual(
  checkKeys(["poulet", "disparu"], list, ["riz"], true),
  ["poulet", "riz"],
  "an orphan tick is pruned on the next write",
);
// A key the model invented writes nothing.
assert.deepEqual(checkKeys(["poulet"], list, ["clé-inventée"], true), ["poulet"]);
assert.deepEqual(checkKeys([], list, ["clé-inventée"], false), []);
assert.deepEqual(checkKeys([], list, [], true), []);

console.log("mcp.check.ts: ok");
