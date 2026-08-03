/**
 * Self-check for /demo's coverage. Run: `bun src/components/chat/tool-gallery.check.ts`
 *
 * The gallery is driven by the real agent configs, so a tool added to `chef.ts`
 * appears on the page by itself — but with no fixture behind it, which shows as a
 * quiet "pas de fixture" row that nobody reads. Nothing about `/demo` runs in CI,
 * so without this assertion the fixtures rot silently the moment a card changes
 * shape. Raised in review on #37.
 */
import assert from "node:assert/strict";
import type { AgentConfig } from "@/components/chat/agent-chat";
import { CHEF } from "@/components/chat/chef-chat";
import { COACH } from "@/components/chat/coach-chat";
import { CHEF_FIXTURES, COACH_FIXTURES } from "@/components/chat/tool-gallery";

type Fixtures = Record<string, { label: string }[]>;

function check(name: string, config: AgentConfig, fixtures: Fixtures) {
  const tools = Object.keys(config.toolLabels);
  assert.ok(tools.length > 0, `${name}: aucun tool déclaré`);

  // Every tool the agent can call has at least one completed-state fixture.
  const missing = tools.filter((t) => !fixtures[t]?.length);
  assert.deepEqual(missing, [], `${name}: outils sans fixture — ${missing.join(", ")}`);

  // And no fixture for a tool that no longer exists: a renamed tool would
  // otherwise leave a block that renders nothing and proves nothing.
  const orphans = Object.keys(fixtures).filter((t) => !(t in config.toolLabels));
  assert.deepEqual(orphans, [], `${name}: fixtures orphelines — ${orphans.join(", ")}`);

  // Labels are what the gallery prints per fixture, and an unlabelled row is
  // indistinguishable from its neighbour.
  for (const [tool, list] of Object.entries(fixtures)) {
    for (const f of list) {
      assert.ok(f.label.trim() !== "", `${name}: fixture sans label sur ${tool}`);
    }
  }

  // Copy shown in the thread, not just in the gallery: `done` is the collapsed
  // one-line summary, so an empty one leaves a blank disclosure.
  for (const [tool, label] of Object.entries(config.toolLabels)) {
    assert.ok(label.pending.trim() !== "", `${name}: ${tool} sans texte pending`);
    assert.ok(label.done.trim() !== "", `${name}: ${tool} sans texte done`);
    assert.ok(
      typeof label.icon === "function" || typeof label.icon === "object",
      `${name}: ${tool} sans icône`,
    );
  }

  // Anything that must stay open has to be a tool that exists.
  const unknown = config.needsValidation.filter((t) => !(t in config.toolLabels));
  assert.deepEqual(
    unknown,
    [],
    `${name}: needsValidation cite un tool inconnu — ${unknown.join(", ")}`,
  );

  // Same for `outputOnly`, which had the same hole. Note the failure direction:
  // a stale entry never matches, so nothing skips the input-existence guard in
  // `AgentMessage` — the tool it was MEANT to cover simply loses its bypass, and
  // its card silently fails to render on the turns where the output arrives
  // before the input. A card that vanishes intermittently, not a crash.
  const staleOutputOnly = config.outputOnly.filter((t) => !(t in config.toolLabels));
  assert.deepEqual(
    staleOutputOnly,
    [],
    `${name}: outputOnly cite un tool inconnu — ${staleOutputOnly.join(", ")}`,
  );
}

check("Coach", COACH, COACH_FIXTURES as Fixtures);
check("Chef", CHEF, CHEF_FIXTURES as Fixtures);

console.log("tool gallery coverage ok");
