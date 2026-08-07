/** Self-check for convex/workouts.ts. Run: `bun convex/workouts.check.ts` */
import assert from "node:assert/strict";
import { sessionOf } from "./workouts";

const row = (id: string, programId?: string, endedAt?: number) => ({ id, programId, endedAt });

assert.equal(sessionOf([]), null);

// The running séance wins over one already finished today (muscu puis boxe).
const running = row("b", "p2");
assert.equal(sessionOf([running, row("a", "p1", 10)]), running);

// Nothing running: the last one finished today, so the récap survives a reload.
const finished = row("a", "p1", 10);
assert.equal(sessionOf([finished]), finished);

// The one that wedged /seance: a retroactive log or a screenshot import has no
// program and no `endedAt`, and nothing ever finishes it. It must not count as
// the séance in progress — the picker has to render instead.
assert.equal(sessionOf([row("import")]), null);
// …and it must not hide a real séance either, whatever the order.
assert.equal(sessionOf([row("import"), running]), running);
assert.equal(sessionOf([row("import"), finished]), finished);

console.log("convex/workouts.ts ok");
