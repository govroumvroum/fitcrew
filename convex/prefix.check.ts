/**
 * Self-check for the cached PREFIX of both agents. Run: `bun convex/prefix.check.ts`
 *
 * The provider caches a prefix and matches it byte for byte, so anything that
 * changes between two turns of the same day costs the whole prompt. The prefix is
 * NOT just the system message: tool definitions (name + description, in order)
 * travel with it, which is what #75 had to fix. So both are checked here.
 *
 * The date is the one value allowed to move — and only on the lines that carry it,
 * at the very end of each system prompt. Never in a tool description.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { chefTools, systemPrompt as chefSystemPrompt } from "./chef";
import { coachTools, systemPrompt as coachSystemPrompt } from "./coach";
import type { Doc } from "./_generated/dataModel";

// Minimal rows, cast like the other checks do: only the fields the prompts read.
const user = {
  name: "Basile",
  tone: "direct",
  onboarding: {
    experience: "intermédiaire",
    goals: ["force", "perte de gras"],
    sport: "boxe",
    limitations: "épaule droite",
    daysPerWeek: 4,
    sessionMinutes: 60,
    equipment: ["barre", "haltères"],
  },
} as unknown as Doc<"users">;

// The `else` branch of both prompts: no profile yet, so onboarding questions.
const blankUser = { name: "Basile" } as unknown as Doc<"users">;

const profile = {
  goal: "perte",
  age: 34,
  sex: "h",
  heightCm: 180,
  weightKg: 78,
  activityLevel: "modéré",
  diet: "aucun",
  allergies: ["arachide"],
  excluded: ["coriandre"],
  mealsPerDay: 3,
  people: 2,
  budget: "moyen",
  cookMinutes: 30,
  targets: { calories: 2300, protein: 160, carbs: 240, fat: 70 },
} as unknown as Doc<"nutritionProfiles">;

const profileWithLevels = {
  ...profile,
  targetsByLevel: {
    off: { calories: 2000, protein: 160, carbs: 165, fat: 70 },
    leger: { calories: 2240, protein: 160, carbs: 225, fat: 70 },
    dur: { calories: 2480, protein: 160, carbs: 285, fat: 70 },
  },
} as unknown as Doc<"nutritionProfiles">;

// A semaine type: Monday dur, Tuesday nothing (off).
const week = [
  {
    weekday: 0,
    kind: "muscu",
    lineageId: "prog_muscu",
    level: "dur" as const,
    time: "18:30",
    program: { name: "Full body", status: "active" as const },
  },
  { weekday: 3, kind: "boxe", level: "leger" as const, program: null },
];

/**
 * Every tool as the provider actually receives it: name, description AND input
 * schema. The schema counts — a `${today}` in a `.describe()` or a default would
 * move the prefix daily while name and description stayed identical.
 */
const toolDefs = (tools: Record<string, { description?: string; inputSchema?: unknown }>) =>
  Object.entries(tools)
    .map(
      ([name, t]) =>
        `${name}\n${t.description ?? ""}\n${JSON.stringify(z.toJSONSchema(t.inputSchema as z.ZodType, { io: "input" }))}`,
    )
    .join("\n---\n");

// Two dates in different ISO weeks, so the Chef's derived monday/sunday move too.
const D1 = "2026-08-13";
const D2 = "2026-09-02";
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

const agents = [
  {
    label: "coach",
    system: (today: string) => coachSystemPrompt(user, today),
    blank: (today: string) => coachSystemPrompt(blankUser, today),
    tools: coachTools,
  },
  {
    label: "chef",
    system: (today: string) => chefSystemPrompt(user, profile, today, week),
    blank: (today: string) => chefSystemPrompt(blankUser, null, today),
    tools: chefTools,
  },
  {
    label: "coach + semaine type",
    system: (today: string) => coachSystemPrompt(user, today, week),
    blank: (today: string) => coachSystemPrompt(blankUser, today),
    tools: coachTools,
  },
];

// #118: TODAY'S level must never reach the cached prefix — it moves when a séance
// starts or the user taps the selector. Monday is a dur day and Tuesday an off
// day in this template: from one to the other, only the DATES lines at the very
// end may change. The level, its targets, its "why" all live in `read_today`.
{
  const monday = "2026-11-09";
  const tuesday = "2026-11-10";
  for (const [label, build] of [
    ["chef", (d: string) => chefSystemPrompt(user, profileWithLevels, d, week)],
    ["coach", (d: string) => coachSystemPrompt(user, d, week)],
  ] as const) {
    const [a, b] = [build(monday).split("\n"), build(tuesday).split("\n")];
    const first = a.findIndex((line, i) => line !== b[i]);
    assert.ok(first > a.length - 4, `${label}: today's level leaked above the DATES section`);
    for (const line of a.filter((line, i) => line !== b[i]))
      assert.match(line, ISO_DATE, `${label}: a line that moved with the day carries no date`);
  }
  // And the three targets ARE in the prefix — they change only with the profile.
  const chef = chefSystemPrompt(user, profileWithLevels, monday, week);
  assert.match(chef, /Jour off \(pas d'entraînement\) : 2000 kcal/);
  assert.match(chef, /Jour dur : 2480 kcal/);
  assert.match(chef, /lundi : muscu \(dur, 18h30\)/);
}

for (const a of agents) {
  for (const [branch, build] of [
    ["profil présent", a.system],
    ["profil absent", a.blank],
  ] as const) {
    // (1) Same date twice: byte-identical, system AND tool definitions.
    assert.equal(build(D1), build(D1), `${a.label} (${branch}): system not stable within a day`);
    assert.equal(
      toolDefs(a.tools(D1)),
      toolDefs(a.tools(D1)),
      `${a.label}: tool definitions not stable within a day`,
    );

    // (2) Two dates: only the date lines of the system prompt may move.
    const [l1, l2] = [build(D1).split("\n"), build(D2).split("\n")];
    assert.equal(
      l1.length,
      l2.length,
      `${a.label} (${branch}): the prompt changed shape, not just its date`,
    );
    const differing = l1.filter((line, i) => line !== l2[i]);
    assert.ok(differing.length > 0, `${a.label} (${branch}): the date isn't in the prompt at all`);
    for (const line of differing) {
      assert.match(
        line,
        ISO_DATE,
        `${a.label} (${branch}): a line without a date changes from one day to the next`,
      );
    }
    // The date belongs at the very END: everything before it must be cacheable.
    const firstDiff = l1.findIndex((line, i) => line !== l2[i]);
    assert.ok(
      firstDiff > l1.length - 4,
      `${a.label} (${branch}): the date sits ${l1.length - firstDiff} lines from the end — move it back down`,
    );
  }

  // (3) Tool definitions must not move AT ALL: a date-stamped description
  // invalidates the cache every midnight just like a date-stamped prompt.
  // Named per tool first: it says WHICH one, where the whole-prefix compare below
  // can only dump two walls of text.
  for (const [name, t] of Object.entries(a.tools(D1))) {
    // Without this, a renamed field would make every assertion below pass on "".
    assert.ok(t.description, `${a.label}: tool \`${name}\` has no readable description`);
    assert.doesNotMatch(
      t.description ?? "",
      ISO_DATE,
      `${a.label}: tool \`${name}\` has a date in its description`,
    );
    assert.doesNotMatch(
      JSON.stringify(z.toJSONSchema(t.inputSchema as z.ZodType, { io: "input" })),
      ISO_DATE,
      `${a.label}: tool \`${name}\` has a date baked into its input schema`,
    );
  }
  assert.equal(
    toolDefs(a.tools(D1)),
    toolDefs(a.tools(D2)),
    `${a.label}: a tool definition depends on the date`,
  );
}

console.log("coach + chef cached prefix ok");
