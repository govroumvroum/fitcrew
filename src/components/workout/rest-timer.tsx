"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const REST_OPTIONS = [30, 60, 90, 120, 180];

type Timer = {
  remaining: number;
  total: number;
  running: boolean;
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
  const endAt = useRef(0);

  // The effect owns the rAF loop: starting is `setRunning(true)`, and cancelling
  // on pause or unmount is just the cleanup. No frame ref, no manual cancels
  // scattered through the callbacks, and no function that references itself.
  // No useCallback either — React Compiler memoizes these for us.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const step = () => {
      const left = Math.max(0, endAt.current - Date.now());
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
  }, [running]);

  function start(seconds: number) {
    endAt.current = Date.now() + seconds * 1000;
    setTotal(seconds);
    setRemaining(seconds);
    setRunning(true);
  }

  function toggle() {
    if (running) {
      setRunning(false);
    } else if (remaining > 0) {
      // Re-anchor the deadline: the clock kept moving while we were paused.
      endAt.current = Date.now() + remaining * 1000;
      setRunning(true);
    }
  }

  function stop() {
    setRunning(false);
    setRemaining(0);
  }

  return { remaining, total, running, start, toggle, stop };
}

const SPRING = { type: "spring", duration: 0.3, bounce: 0 } as const;

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
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={reduce ? { duration: 0 } : SPRING}
        >
          {running ? <PauseIcon /> : <PlayIcon />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RestTimerBar({ timer }: { timer: Timer }) {
  const { remaining, total, running, toggle, stop } = timer;
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
      <Progress value={total ? (remaining / total) * 100 : 0} className="h-2" />
    </div>
  );
}
