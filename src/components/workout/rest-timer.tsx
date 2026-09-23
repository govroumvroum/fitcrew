"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const REST_OPTIONS = [30, 60, 90, 120, 180];

type Timer = {
  remaining: number;
  total: number;
  running: boolean;
  /**
   * Wall-clock deadline, epoch ms; 0 when nothing is running. State rather than
   * a ref because the bar keys its CSS animation on it: it changes exactly once
   * per run segment (start, or resume after a pause), which is precisely when
   * the animation needs to be re-seeked and never in between.
   */
  endAt: number;
  /**
   * When the current pause began, epoch ms; 0 while running. `endAt` stops being
   * the truth the moment you pause — the wall clock keeps moving and the deadline
   * doesn't — so the bar needs this to work out how far it had drained. Like
   * `endAt` it changes only at a pause or resume, never on the 1Hz tick, which is
   * what keeps it out of the bar's re-seek dependencies.
   */
  pausedAt: number;
  start: (seconds: number) => void;
  toggle: () => void;
  stop: () => void;
};

// ── Sound ───────────────────────────────────────────────────────────────────

/** The cues, in seconds left: a short tick at 3, 2 and 1, the long one at 0. */
export const CUES = [3, 2, 1, 0] as const;

/**
 * The cues one run segment still owes, each with how far off it is, in ms.
 *
 * `sounded` is the lowest cue this rest has already played (Infinity: none yet).
 * It's what keeps a cue from sounding twice across segments: `toggle()`
 * re-anchors the deadline on the *whole* seconds left, so a pause at 2.5 s
 * resumes on a fresh 3 s — and without it the "3" would tick again. Cues whose
 * moment is already behind us are dropped, not played late: a tick that lands
 * a second off the digits is worse than none.
 *
 * Pure and clock-injected for `rest-timer.check.ts`.
 */
export function pendingCues(endAt: number, now: number, sounded = Infinity) {
  return CUES.filter((cue) => cue < sounded)
    .map((cue) => ({ cue, in: endAt - cue * 1000 - now }))
    .filter((pending) => pending.in >= 0);
}

/** `sounded`, advanced past every cue whose moment has come by `now`. */
export function soundedBy(endAt: number, now: number, sounded = Infinity) {
  return Math.min(sounded, ...CUES.filter((cue) => endAt - cue * 1000 <= now));
}

/**
 * One context for the whole app, created lazily. iOS only lets a context make a
 * sound if it was created or resumed inside a user gesture, and a rest starts on
 * a tap — so `start()` and `toggle()` call this synchronously, from the handler,
 * before anything is scheduled. Created later, from the effect, the first beep
 * of every séance would be silent on the iOS PWA, which is the phone this is for.
 */
let audio: AudioContext | null = null;

function unlockAudio() {
  if (typeof AudioContext === "undefined") return;
  audio ??= new AudioContext();
  if (audio.state !== "running") audio.resume().catch(() => {});
}

/**
 * One cue, synthesized: a triangle with a click-free envelope. The ticks are
 * short and mid-pitched; zero is higher, louder and longer, so "go" reads
 * without looking. No file to ship, preload or cache offline.
 */
function tone(ctx: AudioContext, cue: number, at: number): AudioNode[] {
  const last = cue === 0;
  const length = last ? 0.45 : 0.08;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = last ? 1320 : 880;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(last ? 0.6 : 0.35, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
  return [osc, gain];
}

/**
 * Schedules a segment's cues on the audio clock, all at once, and returns what
 * cancels them. The audio clock, not setTimeout: a backgrounded tab throttles
 * timers to a second or worse, and a tick a second late is a tick on the wrong
 * digit. Scheduling waits on `resume()` so the offsets are measured from a clock
 * that's actually moving — a suspended context's `currentTime` is frozen.
 */
function scheduleCues(endAt: number, sounded: number): () => void {
  const ctx = audio;
  // Never unlocked (no tap has started a rest yet) or no Web Audio at all.
  if (!ctx) return () => {};
  let live = true;
  const nodes: AudioNode[] = [];
  ctx
    .resume()
    .then(() => {
      if (!live) return;
      for (const pending of pendingCues(endAt, Date.now(), sounded)) {
        nodes.push(...tone(ctx, pending.cue, ctx.currentTime + pending.in / 1000));
      }
    })
    .catch(() => {});
  // Disconnecting silences a cue whether it's still ahead or mid-sound, which is
  // what a skip needs: passer le repos must not beep.
  return () => {
    live = false;
    for (const node of nodes) node.disconnect();
  };
}

/**
 * Countdown driven by requestAnimationFrame against a wall-clock deadline, so
 * it can't drift and doesn't need a setInterval that the browser throttles.
 * ponytail: rAF stops while the tab is hidden, so the display freezes — but
 * the deadline is a timestamp, so it's correct again the moment you look.
 *
 * `onEnd` fires once, when a run reaches zero — never on a skip. The séance's
 * work timer validates its set there.
 */
export function useRestTimer(onEnd?: () => void): Timer {
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [endAt, setEndAt] = useState(0);
  const [pausedAt, setPausedAt] = useState(0);
  // The lowest cue this rest has sounded; see `pendingCues`. A ref, because it's
  // bookkeeping for the effect below and nothing renders it.
  const sounded = useRef(Infinity);
  // An effect event, so the caller's fresh closure every render doesn't become a
  // dep — a dep that changed at 1 Hz would restart the loop and reschedule the
  // cues on every digit.
  const ended = useEffectEvent(() => onEnd?.());

  // The effect owns the rAF loop: starting is `setRunning(true)`, and cancelling
  // on pause or unmount is just the cleanup. No frame ref, no manual cancels
  // scattered through the callbacks, and no function that references itself.
  // No useCallback either — React Compiler memoizes these for us.
  //
  // The cues hang off the same effect, not the display loop: its deps move only
  // at a start, pause or resume, so a re-render can't schedule a beep twice. And
  // its cleanup is what cancels them — on a pause, a skip, an unmount, and when
  // <Activity> hides the route: a hidden /seance has its effects torn down, so it
  // can't beep for a rest you walked away from, and re-showing it schedules only
  // what's still ahead.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const cancelCues = scheduleCues(endAt, sounded.current);
    const step = () => {
      const left = Math.max(0, endAt - Date.now());
      setRemaining(Math.ceil(left / 1000));
      if (left > 0) {
        frame = requestAnimationFrame(step);
      } else {
        setRunning(false);
        navigator.vibrate?.([120, 80, 120]);
        ended();
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // Except when the run is over: reaching zero is itself what runs this
      // cleanup, a few ms into the long beep — cancelling then cut "go" down to
      // a click. Past the deadline nothing's left to cancel but that one tone,
      // and it stops by itself.
      if (Date.now() < endAt) cancelCues();
      sounded.current = soundedBy(endAt, Date.now(), sounded.current);
    };
  }, [running, endAt]);

  function start(seconds: number) {
    unlockAudio();
    sounded.current = Infinity;
    setEndAt(Date.now() + seconds * 1000);
    setPausedAt(0);
    setTotal(seconds);
    setRemaining(seconds);
    setRunning(true);
  }

  function toggle() {
    if (running) {
      setPausedAt(Date.now());
      setRunning(false);
    } else if (remaining > 0) {
      // A tap too, so it gets to unlock: iOS may have suspended the context
      // while the rest sat paused.
      unlockAudio();
      // Re-anchor the deadline: the clock kept moving while we were paused.
      setEndAt(Date.now() + remaining * 1000);
      setPausedAt(0);
      setRunning(true);
    }
  }

  function stop() {
    setRunning(false);
    setRemaining(0);
    setPausedAt(0);
    // Clears the bar: `endAt === 0` is what tells it to render an empty track
    // rather than a frozen animation.
    setEndAt(0);
  }

  return { remaining, total, running, endAt, pausedAt, start, toggle, stop };
}

/**
 * End of rest had no visual cue at all, only a buzz: the bar's mount condition
 * goes false on the same frame `remaining` hits 0, so the "Repos terminé, go"
 * copy below never got a chance to render. Keeps it up 1.5 s past zero, then
 * lets the CSS fade play out before unmounting.
 *
 * Skipping the rest gets no tail: `stop()` zeroes `endAt`, and dismissing
 * something isn't an event you want to sit and watch.
 */
export function useRestOutro({ remaining, endAt }: Timer) {
  const over = remaining === 0 && endAt !== 0;
  // The deadline whose tail has already played, rather than a shown/hidden flag:
  // a flag would need a setState in the effect body on the way in, which is the
  // cascading render the compiler rejects.
  const [played, setPlayed] = useState(0);

  useEffect(() => {
    if (!over) return;
    // 1500 hold, then the 140ms fade the caller runs on an animation-delay.
    const timeout = setTimeout(() => setPlayed(endAt), 1640);
    return () => clearTimeout(timeout);
  }, [over, endAt]);

  const tail = over && played !== endAt;
  return { show: remaining > 0 || tail, tail };
}

// A glyph that swaps under the user's thumb has ~100-160ms before the control
// stops feeling connected to the tap. No blur: filter animation isn't
// compositor-cheap, and at this size it bought nothing.
const SPRING = { type: "spring", duration: 0.16, bounce: 0 } as const;

/**
 * The draining bar, mounted once per run segment because the parent keys it on
 * `endAt`. The whole rest duration is one CSS animation handed to the
 * compositor; the negative delay seeks it to wherever the countdown already is,
 * so a resume picks up mid-drain. Pausing is `animation-play-state`, which
 * freezes it in place without React touching the DOM.
 *
 * The digits above still re-render at 1Hz — a smoothly counting number is
 * unreadable — but those re-renders leave this animation completely alone: the
 * seek lives in a layout effect whose deps only move at a start, pause or resume.
 */
function DrainBar({
  total,
  endAt,
  pausedAt,
  running,
}: {
  total: number;
  endAt: number;
  pausedAt: number;
  running: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seeking the animation from an effect rather than an inline style, because the
  // seek has to happen on mount AND every time Cache Components' <Activity>
  // re-shows this route: display:none cancels a CSS animation outright, and
  // re-display restarts it from animation-delay. A delay frozen at mount would
  // rewind the bar to wherever it was when you left /seance while the digits
  // above — anchored to the wall-clock deadline — stayed correct.
  //
  // `pausedAt || Date.now()` is the "now" the seek is measured against: while
  // running that's the live clock, but a paused rest has to be measured against
  // the moment it stopped, or a re-show after a pause seeks the bar to where the
  // rest *would* have got to, under digits that correctly haven't moved.
  //
  // Still not computed during render: every dep changes only at a start, pause or
  // resume, so this runs on mount and on re-show and never on the 1Hz digit tick,
  // which is what keeps the stutter the frozen seek was avoiding avoided.
  //
  // useLayoutEffect, not useEffect: the `animation` shorthand in the style below
  // resets delay to 0, so seeking after paint would flash the bar full for a
  // frame every time a resume remounts it mid-drain.
  useLayoutEffect(() => {
    if (!ref.current || endAt === 0) return;
    ref.current.style.animationDelay = `-${drainSeek({ total, endAt, pausedAt })}s`;
  }, [total, endAt, pausedAt]);

  return (
    <div
      // Decorative on purpose, where Radix's Progress carried progressbar
      // semantics: the countdown digits right above are the accessible
      // representation of this exact value, so a progressbar here would only
      // announce the same number twice.
      aria-hidden="true"
      className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {endAt !== 0 && (
        <div
          ref={ref}
          // accent-text, not primary: the dock's commit button is the screen's
          // one saturated red, and it sits directly under this bar.
          className="size-full bg-accent-text"
          // animationDelay is deliberately absent here — the effect above owns it.
          style={{
            animation: `rest-drain ${total}s linear forwards`,
            animationPlayState: running ? "running" : "paused",
          }}
        />
      )}
    </div>
  );
}

/**
 * How many seconds of `total` the bar has already drained, i.e. where to seek its
 * animation.
 *
 * This owns the running-vs-paused decision rather than taking a "now" from the
 * caller, and that's the whole point of the shape: the bug this function exists
 * to prevent was never in the arithmetic, it was a call site handing a live clock
 * to a paused rest. With the choice in here there's no argument left to get
 * wrong, and `rest-timer.check.ts` exercises the branch that actually regresses.
 *
 * `now` stays injectable only so the check can pin a fixed clock; nothing in the
 * app passes it.
 */
export function drainSeek(
  { total, endAt, pausedAt }: Pick<Timer, "total" | "endAt" | "pausedAt">,
  now = Date.now(),
) {
  if (endAt === 0) return 0;
  // Clamped at both ends. The floor stops a seek from rewinding into the drain;
  // the ceiling matters because `useRestOutro` keeps the bar mounted 1.5 s past
  // zero, so a re-show during that tail would otherwise ask for a delay longer
  // than the animation itself.
  return Math.min(total, Math.max(0, total - (endAt - (pausedAt || now)) / 1000));
}

/**
 * The pause/reprendre glyph, animated in both directions. `initial={false}` so
 * the bar mounting mid-séance doesn't play a swap that never happened.
 */
function ToggleIcon({ running }: { running: boolean }) {
  const reduce = useReducedMotion();

  return (
    <span className="relative grid size-4 place-items-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={running ? "pause" : "play"}
          className="absolute grid place-items-center"
          // 0.9, not 0.25: nothing in the real world appears out of nothing.
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={reduce ? { duration: 0 } : SPRING}
        >
          {running ? <PauseIcon /> : <PlayIcon />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** What the bar's controls are called, per kind of countdown. */
const WORDING = {
  rest: {
    label: "Repos",
    over: "Repos terminé, go",
    pause: "Mettre le repos en pause",
    resume: "Reprendre le repos",
    skip: "Passer le repos",
  },
  work: {
    label: "Travail",
    // Barely seen: the set validates on the same frame and the rest bar takes
    // over. It's here so a reader never hears "Repos terminé" at the end of work.
    over: "Série terminée",
    pause: "Mettre le travail en pause",
    resume: "Reprendre le travail",
    skip: "Arrêter la série",
  },
};

/**
 * `label` names the rest that's running — a circuit's rest between two tours is a
 * different thing from the rest between two of its exercises, and they're
 * routinely different durations. Defaults to plain "Repos", which is every
 * classic séance.
 *
 * `kind="work"` is the same bar running a timed set (corde à sauter, gainage):
 * same deadline, same drain, same cues, only the words change.
 */
export function RestTimerBar({
  timer,
  className,
  label,
  kind = "rest",
}: {
  timer: Timer;
  className?: string;
  label?: string;
  kind?: "rest" | "work";
}) {
  const words = WORDING[kind];
  const { remaining, total, running, endAt, pausedAt, toggle, stop } = timer;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-3">
        {/* Body face, not the display face: Big Shoulders has no tabular figures,
            so a clock ticking through a "1" would shove the pause/skip buttons
            sideways under a thumb once a second. */}
        <span className="text-3xl font-semibold tabular-nums" aria-live="off">
          {minutes}:{String(seconds).padStart(2, "0")}
        </span>
        {/* The only announcement of rest ending: the digits are aria-live="off"
            (a per-second count is noise), the buzz is silent to a reader, and
            the beeps are a tone with no words — they say "now", not "what". */}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {remaining === 0 ? words.over : (label ?? words.label)}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            className="size-12 active:scale-[0.96]"
            // The bar now outlives the countdown by 1.5 s, and `toggle` is a
            // no-op at zero: a live-looking button that does nothing is worse
            // than a dimmed one.
            disabled={remaining === 0}
            onClick={toggle}
            aria-label={running ? words.pause : words.resume}
          >
            <ToggleIcon running={running} />
          </Button>
          <Button
            variant="outline"
            className="size-12 active:scale-[0.96]"
            onClick={stop}
            aria-label={words.skip}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {/* key: a new deadline is a new animation. Start and resume remount this,
          a 1Hz digit tick does not. */}
      <DrainBar key={endAt} total={total} endAt={endAt} pausedAt={pausedAt} running={running} />
    </div>
  );
}
