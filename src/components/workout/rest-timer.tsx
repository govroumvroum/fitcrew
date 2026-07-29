"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
  // useState initialiser, not a plain expression: this must be read once per
  // mount. Recomputing it on every render would rewrite animation-delay and
  // re-seek the animation a second, which is the exact stutter we're removing.
  const [elapsed] = useState(() =>
    endAt === 0 ? 0 : Math.max(0, total - (endAt - Date.now()) / 1000),
  );

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
          className="size-full bg-primary"
          style={{
            animation: `rest-drain ${total}s linear forwards`,
            animationDelay: `-${elapsed}s`,
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
          initial={{ opacity: 0, scale: 0.25 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.25 }}
          transition={reduce ? { duration: 0 } : SPRING}
        >
          {running ? <PauseIcon /> : <PlayIcon />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RestTimerBar({ timer }: { timer: Timer }) {
  const { remaining, total, running, endAt, toggle, stop } = timer;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-display text-3xl tabular-nums" aria-live="off">
          {minutes}:{String(seconds).padStart(2, "0")}
        </span>
        <span className="text-sm text-muted-foreground">
          {remaining === 0 ? "Repos terminé, go" : "Repos"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            className="size-12 transition-transform active:scale-[0.96]"
            onClick={toggle}
            aria-label={running ? "Mettre le repos en pause" : "Reprendre le repos"}
          >
            <ToggleIcon running={running} />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            className="size-12 transition-transform active:scale-[0.96]"
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
