/**
 * Self-check: every tool an agent can call has its own line in the chat.
 * Run: `bun src/components/chat/tool-labels.check.ts`
 *
 * A tool with no entry in `toolLabels` still renders — through `FALLBACK`, whose
 * copy can't say what was done. The Chef's three reads sat there unnoticed: the
 * user saw a vague line, then 20 s of the model thinking, and took the app for
 * hung. `tool-gallery.check.ts` can't catch it: it starts FROM `toolLabels`, so a
 * tool missing there is missing from its view too. This starts from the backend.
 *
 * The tool sets come from the real `chefTools` / `coachTools`, called with any
 * date: building them only wraps definitions, nothing runs.
 */
import assert from "node:assert/strict";
import type { AgentConfig } from "@/components/chat/agent-chat";
import { CHEF } from "@/components/chat/chef-chat";
import { COACH } from "@/components/chat/coach-chat";
import { chefTools } from "../../../convex/chef";
import { coachTools } from "../../../convex/coach";

function check(name: string, config: AgentConfig, backend: string[]) {
  assert.ok(backend.length > 0, `${name}: aucun outil côté backend`);
  const labelled = Object.keys(config.toolLabels);

  const unlabelled = backend.filter((tool) => !labelled.includes(`tool-${tool}`));
  assert.deepEqual(
    unlabelled,
    [],
    `${name}: outils sans libellé (ils tombent sur FALLBACK) — ${unlabelled.join(", ")}`,
  );

  // The other way: a label left behind by a renamed tool registers a tool UI
  // for a name nothing calls, and the renamed one silently loses its line.
  const orphans = labelled.filter((type) => !backend.includes(type.slice("tool-".length)));
  assert.deepEqual(orphans, [], `${name}: libellés sans outil — ${orphans.join(", ")}`);
}

check("Chef", CHEF, Object.keys(chefTools("2026-01-05")));
check("Coach", COACH, Object.keys(coachTools("2026-01-05")));

console.log("tool labels ok");
