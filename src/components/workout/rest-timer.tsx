"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  start: (seconds: number) => void;
  toggle: () => void;
  stop: () => void;
};

/**
 * Countdown driven by requestAnimationFrame against a wall-clock deadline, so
 * it can't drift and doesn't need a setInterval that the browser throttles.
 * ponytail: rAF stops while the tab is hidden, so the display freezes — but
 * the deadline is a timestamp, so it's correct again the moment you look.
 */
export function useRestTimer(): Timer {
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [endAt, setEndAt] = useState(0);

  // The effect owns the rAF loop: starting is `setRunning(true)`, and cancelling
  // on pause or unmount is just the cleanup. No frame ref, no manual cancels
  // scattered through the callbacks, and no function that references itself.
  // No useCallback either — React Compiler memoizes these for us.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const step = () => {
      const left = Math.max(0, endAt - Date.now());
      setRemaining(Math.ceil(left / 1000));
      if (left > 0) {
        frame = requestAnimationFrame(step);
      } else {
        setRunning(false);
        navigator.vibrate?.([120, 80, 120]);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [running, endAt]);

  function start(seconds: number) {
    setEndAt(Date.now() + seconds * 1000);
    setTotal(seconds);
    setRemaining(seconds);
    setRunning(true);
  }

  function toggle() {
    if (running) {
      setRunning(false);
    } else if (remaining > 0) {
      // Re-anchor the deadline: the clock kept moving while we were paused.
      setEndAt(Date.now() + remaining * 1000);
      setRunning(true);
    }
  }

  function stop() {
    setRunning(false);
    setRemaining(0);
    // Clears the bar: `endAt === 0` is what tells it to render an empty track
    // rather than a frozen animation.
    setEndAt(0);
  }

  return { remaining, total, running, endAt, start, toggle, stop };
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
 * unreadable — but those re-renders leave this animation completely alone,
 * because `elapsed` is frozen at mount and every style string stays identical.
 */
function DrainBar({ total, endAt, running }: { total: number; endAt: number; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // Seeking the animation from an effect rather than an inline style, because the
  // seek has to happen on mount AND every time Cache Components' <Activity>
  // re-shows this route: display:none cancels a CSS animation outright, and
  // re-display restarts it from animation-delay. A delay frozen at mount would
  // rewind the bar to wherever it was when you left /seance while the digits
  // above — anchored to the wall-clock deadline — stayed correct.
  //
  // Still not computed during render: an effect keyed on the deadline runs on
  // mount and on re-show only, never on the 1Hz digit tick, so the stutter the
  // frozen seek was avoiding stays avoided.
  //
  // useLayoutEffect, not useEffect: the `animation` shorthand in the style below
  // resets delay to 0, so seeking after paint would flash the bar full for a
  // frame every time a resume remounts it mid-drain.
  useLayoutEffect(() => {
    if (!ref.current || endAt === 0) return;
    const elapsed = Math.max(0, total - (endAt - Date.now()) / 1000);
    ref.current.style.animationDelay = `-${elapsed}s`;
  }, [total, endAt]);

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

export function RestTimerBar({ timer, className }: { timer: Timer; className?: string }) {
  const { remaining, total, running, endAt, toggle, stop } = timer;
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
            (a per-second count is noise) and the buzz is silent to a reader. */}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {remaining === 0 ? "Repos terminé, go" : "Repos"}
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
            aria-label={running ? "Mettre le repos en pause" : "Reprendre le repos"}
          >
            <ToggleIcon running={running} />
          </Button>
          <Button
            variant="outline"
            className="size-12 active:scale-[0.96]"
            onClick={stop}
            aria-label="Passer le repos"
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {/* key: a new deadline is a new animation. Start and resume remount this,
          a 1Hz digit tick does not. */}
      <DrainBar key={endAt} total={total} endAt={endAt} running={running} />
    </div>
  );
}
