/** Self-check for rest-timer.tsx's drain seek. Run: `bun src/components/workout/rest-timer.check.ts` */
import assert from "node:assert/strict";
import { drainSeek } from "./rest-timer";

// A rest is 60 s and started at T. `endAt` is T+60s and never moves again while
// the rest runs, so the bar's seek is just "how long since T".
const T = 1_700_000_000_000;
const seek = (over: Partial<Parameters<typeof drainSeek>[0]>) =>
  drainSeek({ total: 60, endAt: T + 60_000, pausedAt: 0, now: T, ...over });

// --- nothing running ---------------------------------------------------------
// `endAt === 0` is the cleared bar; an empty track, not a seek.
assert.equal(drainSeek({ total: 60, endAt: 0, pausedAt: 0, now: T }), 0);

// --- running -----------------------------------------------------------------
assert.equal(seek({}), 0); // at the start, nothing drained
assert.equal(seek({ now: T + 10_000 }), 10);
assert.equal(seek({ now: T + 60_000 }), 60); // exactly empty
// Past the deadline — which happens on every rest, because useRestOutro holds the
// bar 1.5 s past zero. Clamped to `total`, never a delay longer than the animation.
assert.equal(seek({ now: T + 61_500 }), 60);
assert.equal(seek({ now: T + 90_000 }), 60);

// --- paused ------------------------------------------------------------------
// The case that was wrong. Pause 10 s in, then leave /seance for 30 s. <Activity>
// re-creates the layout effect on re-show, so the seek is recomputed with a live
// clock — but the rest didn't advance, so it must still read 10 s drained.
const pausedAt = T + 10_000;
assert.equal(seek({ pausedAt, now: pausedAt }), 10);
assert.equal(seek({ pausedAt, now: pausedAt + 30_000 }), 10); // was 40 before the fix
assert.equal(seek({ pausedAt, now: pausedAt + 3_600_000 }), 10); // still 10 an hour later

// --- resume ------------------------------------------------------------------
// `toggle()` re-anchors: endAt = now + remaining, pausedAt back to 0. 50 s were
// left, so the bar picks up at 10 s drained and carries on from there.
const resumedAt = pausedAt + 30_000;
const resumed = { endAt: resumedAt + 50_000, pausedAt: 0 };
assert.equal(seek({ ...resumed, now: resumedAt }), 10);
assert.equal(seek({ ...resumed, now: resumedAt + 5_000 }), 15);

console.log("rest-timer: ok");
