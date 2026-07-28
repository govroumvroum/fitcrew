"use client";

import { useSyncExternalStore } from "react";

/**
 * Dates have two jobs here and they need different formats.
 *
 * STORAGE / QUERY KEY — `YYYY-MM-DD`. Every `date` field in the schema is this,
 * and Convex's `by_user_and_date` indexes sort lexicographically, so the format
 * has to be big-endian or range queries break. Built from the local getters:
 * `toISOString()` is UTC (an evening session in Bordeaux would land on
 * tomorrow), and `toLocaleDateString("sv-SE")` only works because Swedish
 * formatting happens to be ISO-8601 — a coincidence, not a contract.
 *
 * DISPLAY — `fr-FR` via Intl, because the humans reading it are French.
 */
const pad = (n: number) => String(n).padStart(2, "0");

export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parsed as UTC midnight on purpose: a date-only value has no timezone, and
 *  UTC arithmetic on it can't be shifted by DST. */
const parse = (date: string) => new Date(`${date}T00:00:00Z`);

const day = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const full = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "28/07" — for axis ticks and dense lists. */
export const formatDay = (date: string) => day.format(parse(date));

/** "mardi 28 juillet" — for headings. */
export const formatFull = (date: string) => full.format(parse(date));

// The date doesn't change while mounted, so there's nothing to subscribe to.
// ponytail: won't roll over at midnight mid-session. Subscribe to a timer if
// someone actually trains through midnight.
const subscribe = () => () => {};

/**
 * The user's local date as a storage key, or `null` on the server and first
 * paint. Passed straight to Convex queries — they must never read the clock.
 */
export function useLocalDate(): string | null {
  return useSyncExternalStore(subscribe, localDate, () => null);
}
