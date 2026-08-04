/** Self-check for rest-timer.tsx's drain seek. Run: `bun src/components/workout/rest-timer.check.ts` */
import assert from "node:assert/strict";
import { drainSeek } from "./rest-timer";

// A 60 s rest started at T, so `endAt` is T+60s and never moves again while it
// runs. `now` is only injectable here — the app calls drainSeek without it, which
// is what keeps a live clock from reaching a paused rest.
const T = 1_700_000_000_000;
const seek = (now: number, over: Partial<Parameters<typeof drainSeek>[0]> = {}) =>
  drainSeek({ total: 60, endAt: T + 60_000, pausedAt: 0, ...over }, now);

// --- nothing running ---------------------------------------------------------
// `endAt === 0` is the cleared bar: an empty track, not a seek.
assert.equal(seek(T, { endAt: 0 }), 0);

// --- running -----------------------------------------------------------------
assert.equal(seek(T), 0); // at the start, nothing drained
assert.equal(seek(T + 10_000), 10);
assert.equal(seek(T + 60_000), 60); // exactly empty

// Past the deadline, which happens on every rest: useRestOutro holds the bar
// 1.5 s past zero. Clamped to `total`, never a delay longer than the animation.
assert.equal(seek(T + 61_500), 60);
assert.equal(seek(T + 90_000), 60);

// --- paused ------------------------------------------------------------------
// The branch that regresses. Pause 10 s in, then leave /seance for 30 s.
// <Activity> re-creates the layout effect on re-show so the seek is recomputed
// against a live clock — but the rest didn't advance, so it must still read 10.
const pausedAt = T + 10_000;
assert.equal(seek(pausedAt, { pausedAt }), 10);
assert.equal(seek(pausedAt + 30_000, { pausedAt }), 10); // 40 if `now` wins over `pausedAt`
assert.equal(seek(pausedAt + 3_600_000, { pausedAt }), 10); // still 10 an hour later

// --- resume ------------------------------------------------------------------
// `toggle()` re-anchors: endAt = now + remaining, pausedAt back to 0. 50 s were
// left, so the bar picks up at 10 s drained and carries on from there.
const resumedAt = pausedAt + 30_000;
const resumed = { endAt: resumedAt + 50_000, pausedAt: 0 };
assert.equal(seek(resumedAt, resumed), 10);
assert.equal(seek(resumedAt + 5_000, resumed), 15);

console.log("rest-timer: ok");
