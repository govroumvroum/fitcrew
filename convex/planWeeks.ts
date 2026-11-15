/**
 * Which week a meal plan is for (#126). Pure — no Convex server import, no
 * clock — so `planWeeks.check.ts` can hammer it with bun.
 *
 * The Chef works on TWO weeks: the current one and the next one. Never another:
 * a plan two weeks out is a plan nobody reads before it's stale, and a past one
 * is history. Every week is keyed by its Monday, like `mealPlans.weekStart`.
 *
 * `today` is the device's local date (`localDate()` on the client), so the week
 * flips at local midnight between Sunday and Monday — Europe/Paris for Basile —
 * not at UTC midnight. Nothing here reads a clock.
 */
import { WEEKDAYS, weekdayOf } from "./weekTemplate";

const DAY = 86_400_000;

export type PlanWeek = "current" | "next";

export const WEEK_LABEL: Record<PlanWeek, string> = {
  current: "semaine en cours",
  next: "semaine prochaine",
};

/**
 * A real `YYYY-MM-DD`, round-tripped: "2026-13-40" has the shape and no 13th
 * month, and some engines roll "2026-02-31" over into March.
 */
export function isDateKey(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === date;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Same as `weekStart` in progress.ts (asserted equal in the check), without its server imports. */
export const mondayOf = (date: string) => addDays(date, -weekdayOf(date));

/** The two Mondays the Chef may write under. */
export function planWeeks(today: string): Record<PlanWeek, string> {
  const current = mondayOf(today);
  return { current, next: addDays(current, 7) };
}

/**
 * What « le plan de la semaine » means when he doesn't say which. Friday to
 * Sunday the current week is mostly gone and the shopping is for Monday, so it's
 * the next one; earlier in the week it's genuinely ambiguous, so the Chef asks.
 */
export function defaultPlanWeek(today: string): "next" | "ask" {
  return weekdayOf(today) >= 4 ? "next" : "ask";
}

export type WeekResolution = { week: PlanWeek; weekStart: string } | { error: string };

/**
 * The week a set of dates belongs to: one of the two plan weeks, and the same
 * for every date. The model writes dates (copied from the DATES section); the
 * server derives the Monday — a model doing calendar arithmetic is a bug
 * factory, and a plan filed under the wrong Monday is invisible to every reader.
 *
 * Errors are sentences for the model: what's wrong and what to do instead.
 */
export function weekOfDates(today: string, dates: string[]): WeekResolution {
  if (dates.length === 0) return { error: "Aucune date." };
  const bad = dates.find((date) => !isDateKey(date));
  if (bad !== undefined) return { error: `« ${bad} » n'est pas une date AAAA-MM-JJ.` };

  const weeks = planWeeks(today);
  const mondays = new Set(dates.map(mondayOf));
  if (mondays.size > 1) {
    return {
      error: `Ces dates tombent dans ${mondays.size} semaines différentes (${[...mondays].map((m) => `lundi ${m}`).join(", ")}). Un plan couvre UNE semaine, du lundi au dimanche : la semaine en cours (lundi ${weeks.current}) ou la prochaine (lundi ${weeks.next}).`,
    };
  }
  const [monday] = mondays;
  if (monday === weeks.current) return { week: "current", weekStart: monday };
  if (monday === weeks.next) return { week: "next", weekStart: monday };
  return {
    error: `${dates[0]} est dans la semaine du lundi ${monday}. Tu ne peux écrire que dans la semaine en cours (lundi ${weeks.current}) ou la prochaine (lundi ${weeks.next}) : reprends les dates de la section DATES.`,
  };
}

/** The dates of a plan that fall outside its week — must be empty before a write. */
export const datesOutsideWeek = (weekStart: string, dates: string[]) =>
  dates.filter((date) => !isDateKey(date) || mondayOf(date) !== weekStart);

/**
 * The DATES lines of the Chef's prompt that name the next week and the default
 * rule. One line, and it carries dates: `prefix.check.ts` only lets lines with a
 * date move from one day to the next, and only the last three.
 */
export function nextWeekLine(today: string): string {
  const { next } = planWeeks(today);
  const days = WEEKDAYS.map((name, i) => `${name} ${addDays(next, i)}`).join(", ");
  const rule =
    defaultPlanWeek(today) === "next"
      ? `On est en fin de semaine : s'il parle de « sa semaine », de « son plan » ou de « ses courses » sans dire laquelle, c'est la semaine PROCHAINE (lundi ${next}), sauf s'il dit le contraire.`
      : `S'il demande un plan ou ses courses sans dire quelle semaine et que la conversation ne le dit pas, demande-lui : celle-ci ou celle qui commence lundi ${next} ?`;
  return `Jours de la semaine prochaine : ${days}. ${rule}`;
}
