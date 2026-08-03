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

/**
 * `formatFull` for a date we did NOT write: falls back to the raw string instead
 * of throwing.
 *
 * Every date in the schema comes from `localDate()` and is trustworthy, so
 * `formatFull` above is right to assume it. A date inside an LLM tool call is
 * not: `Intl.format` THROWS `RangeError: Invalid time value` on an unparseable
 * one, and a throw inside a card takes down the whole chat route — it failed a
 * production build before this existed.
 *
 * The shape test alone isn't enough, which was the actual bug: "2026-13-40"
 * matches `\d{4}-\d{2}-\d{2}` and still has no 13th month. So parse it, and
 * round-trip it back to a string — that rejects both a NaN date and any engine
 * lenient enough to roll "2026-02-31" over into March.
 */
export function formatLoose(date: string) {
  const parsed = parse(date);
  if (Number.isNaN(parsed.getTime())) return date;
  if (parsed.toISOString().slice(0, 10) !== date) return date;
  return full.format(parsed);
}

const short = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "lun. 27 juil." — history rows, where the weekday says more than the year. */
export const formatShort = (date: string) => short.format(parse(date));

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

/** Epoch ms of the user's local midnight. Stable all day, so it's a good query key. */
function localDayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Companion to useLocalDate for anything comparing against a stored timestamp. */
export function useLocalDayStart(): number | null {
  return useSyncExternalStore(subscribe, localDayStart, () => null);
}

const DAY = 86_400_000;

/**
 * `days` back from `today`, or the epoch for "tout" — the queries clamp that to
 * the first session. The range controls on /progres and /crew share it.
 */
export function fromDate(today: string, days: number | null) {
  if (days === null) return "1970-01-01";
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
}

/**
 * The Monday of `date`. Mirrors `weekStart` in convex/progress.ts — the défi
 * mutation rejects anything else — but importing that module would pull the
 * Convex server runtime into the browser bundle for four lines of UTC arithmetic.
 */
export function monday(date: string) {
  const time = Date.parse(`${date}T00:00:00Z`);
  const offset = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - offset * DAY).toISOString().slice(0, 10);
}
