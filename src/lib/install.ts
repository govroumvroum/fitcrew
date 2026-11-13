"use client";

import { useSyncExternalStore } from "react";

/**
 * « Installer l'app » (#127): what the browser lets us know and do about adding
 * FitCrew to the home screen.
 *
 * `beforeinstallprompt` (Chrome, Edge, Samsung Internet; never Safari) fires
 * ONCE, early, and is lost if nobody is listening — so the listener is attached
 * when this module is evaluated, not when a component mounts. `store-user.tsx`,
 * which the root layout renders on every route, imports it for that side effect.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
// Set by `appinstalled`: the tab that installed is still a browser tab, so the
// display-mode check below stays false in it.
let installedHere = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keeps Chrome's own mini-infobar away: the card and the welcome offer the
    // button themselves, at a moment that makes sense.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedHere = true;
    emit();
  });
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  // iOS Safari predates the media query for home-screen apps.
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS asks for the desktop site and reports itself as a Mac.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export type InstallState = {
  /** Running as the installed app, or installed from this very tab. */
  installed: boolean;
  /** The browser handed us its prompt: one tap installs. */
  canPrompt: boolean;
  /** No prompt will ever come; the user does it from Safari's share sheet. */
  ios: boolean;
};

// Stable references: useSyncExternalStore compares snapshots with Object.is.
let snapshot: InstallState | null = null;
const read = (): InstallState => {
  const next = { installed: installedHere || isStandalone(), canPrompt: deferred !== null, ios: isIos() };
  if (
    !snapshot ||
    snapshot.installed !== next.installed ||
    snapshot.canPrompt !== next.canPrompt ||
    snapshot.ios !== next.ios
  ) {
    snapshot = next;
  }
  return snapshot;
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
  };
};

// `null` on the server and during hydration: "don't know yet" must not render
// as "not installed", or the install row would flash for people who have it.
const unknown = () => null;

export function useInstall(): InstallState | null {
  return useSyncExternalStore(subscribe, read, unknown);
}

/** Opens the browser's own install dialog. False when there is none to open. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // A prompt can be shown once; Chrome fires a fresh event later if it wants.
  deferred = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
