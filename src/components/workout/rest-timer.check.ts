/** Self-check for rest-timer.tsx's drain seek and cues. Run: `bun src/components/workout/rest-timer.check.ts` */
import assert from "node:assert/strict";
import {
  closeSegment,
  drainSeek,
  NEW_LEDGER,
  openSegment,
  pendingCues,
  restartLedger,
  soundedBy,
  type CueLedger,
} from "./rest-timer";

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

// --- cues --------------------------------------------------------------------
// Same 60 s rest. The cues are due at 57, 58, 59 and 60 s in: three ticks, then
// the long one at zero. Nothing at the start.
const end = T + 60_000;
const due = (now: number, sounded?: number) =>
  pendingCues(end, now, sounded).map(({ cue, in: ms }) => `${cue}@${ms}`);

assert.deepEqual(due(T), ["3@57000", "2@58000", "1@59000", "0@60000"]);

// Each cue is played at most once per rest, which is what `sounded` carries from
// one run segment to the next. Walk a whole rest, re-scheduling as if the effect
// re-ran at every instant (a re-show under <Activity>, a pause, a resume) and
// folding what's sounded each time: every cue comes out exactly once.
const heard: number[] = [];
let sounded = Infinity;
for (let now = T; now <= end + 2_000; now += 250) {
  for (const { cue, in: ms } of pendingCues(end, now, sounded)) if (ms === 0) heard.push(cue);
  sounded = soundedBy(end, now, sounded);
}
assert.deepEqual(heard, [3, 2, 1, 0]);

// Pause at 2.5 s left: the "3" has sounded. `toggle()` re-anchors on the WHOLE
// seconds left, so the rest resumes on a fresh 3 s — and the 3 must not tick
// again. This is the double beep `sounded` exists to prevent.
const pausedAt2 = end - 2_500;
const afterPause = soundedBy(end, pausedAt2);
assert.equal(afterPause, 3);
const resumeAt = pausedAt2 + 20_000;
assert.deepEqual(
  pendingCues(resumeAt + 3_000, resumeAt, afterPause).map(({ cue, in: ms }) => `${cue}@${ms}`),
  ["2@1000", "1@2000", "0@3000"],
);
// Without it, that's exactly the bug:
assert.equal(pendingCues(resumeAt + 3_000, resumeAt)[0].cue, 3);

// Cues already behind us are dropped, never played late: re-showing /seance with
// 1.5 s left schedules the 1 and the 0, not the 3 and the 2 it missed.
assert.deepEqual(due(end - 1_500), ["1@500", "0@1500"]);
// Past the deadline — re-shown after the rest ended — nothing at all.
assert.deepEqual(due(end + 10_000), []);
// Everything sounded → nothing left, whatever the clock says.
assert.deepEqual(due(T, 0), []);

// A rest shorter than the countdown only plays what fits.
assert.deepEqual(
  pendingCues(T + 2_000, T).map(({ cue }) => cue),
  [2, 1, 0],
);

// `soundedBy` never walks backwards: a cue that has sounded stays sounded.
assert.equal(soundedBy(end, T, 1), 1);
assert.equal(soundedBy(end, end), 0);
assert.equal(soundedBy(end, T), Infinity);

// --- restart mid-rest ---------------------------------------------------------
// Validating a set during the previous rest's last seconds calls `start()` while
// it still runs. React's order is: `start()` (the handler), re-render, the OLD
// segment's cleanup, the new segment's body. Replayed on the ledger, the new
// rest must still owe all four cues, whatever the old one had sounded.
const restart = (leftOnOld: number) => {
  const oldEnd = T + 60_000;
  const now = oldEnd - leftOnOld;
  let ledger: CueLedger = openSegment(NEW_LEDGER); // old rest's body
  ledger = restartLedger(ledger); // start(60) in the tap
  ledger = closeSegment(ledger, oldEnd, now); // old cleanup, runs after it
  ledger = openSegment(ledger); // new body
  return pendingCues(now + 60_000, now, ledger.sounded).map(({ cue }) => cue);
};
assert.deepEqual(restart(2_500), [3, 2, 1, 0]); // was [2, 1, 0]
assert.deepEqual(restart(1_500), [3, 2, 1, 0]); // was [0]
assert.deepEqual(restart(10_000), [3, 2, 1, 0]);

// …while a pause/resume inside ONE rest keeps what it sounded: no restart
// pending, so the cleanup's fold is exactly what the next body reads.
let paused: CueLedger = openSegment(restartLedger(NEW_LEDGER));
paused = closeSegment(paused, end, end - 2_500);
paused = openSegment(paused);
assert.equal(paused.sounded, 3);

console.log("rest-timer: ok");
