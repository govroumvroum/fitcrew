/** Self-check for the two plan weeks (#126). Run: `bun convex/planWeeks.check.ts` */
import assert from "node:assert/strict";
import {
  datesOutsideWeek,
  defaultPlanWeek,
  isDateKey,
  mondayOf,
  nextWeekLine,
  planWeeks,
  weekOfDates,
} from "./planWeeks";
import { weekStart } from "./progress";
import { weekDates } from "./weekTemplate";

// --- The two Mondays ---------------------------------------------------------
// Friday 13 November 2026, the day Basile hit the bug.
assert.deepEqual(planWeeks("2026-11-13"), { current: "2026-11-09", next: "2026-11-16" });
// Monday is its own week's start, Sunday is still the week that began 6 days ago.
assert.deepEqual(planWeeks("2026-11-09"), { current: "2026-11-09", next: "2026-11-16" });
assert.deepEqual(planWeeks("2026-11-15"), { current: "2026-11-09", next: "2026-11-16" });
// And on Monday 16, last weekend's "next" IS the current week: same key, nothing
// to migrate — every reader keys on `weekStart(today)`, never on "latest plan".
assert.equal(planWeeks("2026-11-16").current, planWeeks("2026-11-15").next);

// Year change: the week of Monday 28 December runs into January…
assert.deepEqual(planWeeks("2026-12-31"), { current: "2026-12-28", next: "2027-01-04" });
assert.deepEqual(planWeeks("2027-01-03"), { current: "2026-12-28", next: "2027-01-04" });
assert.deepEqual(planWeeks("2026-12-27"), { current: "2026-12-21", next: "2026-12-28" });
// …and a February with 29 days doesn't throw the arithmetic off.
assert.deepEqual(planWeeks("2028-02-27"), { current: "2028-02-21", next: "2028-02-28" });
assert.deepEqual(planWeeks("2028-03-01"), { current: "2028-02-28", next: "2028-03-06" });
// DST in France (back to winter time on Sunday 25 October 2026, summer time on
// Sunday 29 March 2026): date keys, never a clock, so neither moves a boundary.
assert.deepEqual(planWeeks("2026-10-25"), { current: "2026-10-19", next: "2026-10-26" });
assert.deepEqual(planWeeks("2026-03-29"), { current: "2026-03-23", next: "2026-03-30" });

// `mondayOf` must never drift from the server's `weekStart`, which `savePlan`
// enforces. Every day of two years, both ways round a year change.
for (
  let d = Date.parse("2026-01-01T00:00:00Z");
  d < Date.parse("2028-01-01T00:00:00Z");
  d += 86_400_000
) {
  const date = new Date(d).toISOString().slice(0, 10);
  assert.equal(mondayOf(date), weekStart(date), `mondayOf/weekStart disagree on ${date}`);
}

// --- Europe/Paris: the week flips at PARIS midnight ---------------------------
// `today` is the phone's local date (`localDate()`); this is what it is in Paris
// for a given instant. Sunday 15 Nov, 23:30 UTC is already Monday 00:30 in Paris
// (UTC+1 in winter): the current week is the new one, though UTC says Sunday.
const parisDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
assert.equal(parisDate("2026-11-15T22:59:00Z"), "2026-11-15"); // dimanche 23h59 à Paris
assert.equal(planWeeks(parisDate("2026-11-15T22:59:00Z")).current, "2026-11-09");
assert.equal(parisDate("2026-11-15T23:30:00Z"), "2026-11-16"); // lundi 00h30 à Paris
assert.equal(planWeeks(parisDate("2026-11-15T23:30:00Z")).current, "2026-11-16");
// Summer time (UTC+2): Sunday 22:30 UTC is Monday 00:30 in Paris.
assert.equal(planWeeks(parisDate("2026-06-14T22:30:00Z")).current, "2026-06-15");
// New Year's Eve at 23:30 in Paris is still 2026, and still the week of the 28th.
assert.equal(planWeeks(parisDate("2026-12-31T22:30:00Z")).current, "2026-12-28");

// --- The default when he doesn't say which week --------------------------------
// Friday, Saturday, Sunday: the next one. Monday to Thursday: ask.
const fromMonday = weekDates("2026-11-09").map(defaultPlanWeek);
assert.deepEqual(fromMonday, ["ask", "ask", "ask", "ask", "next", "next", "next"]);
assert.equal(defaultPlanWeek("2027-01-01"), "next", "a Friday across a year change");
assert.equal(defaultPlanWeek("2026-12-28"), "ask");

// --- Which week a plan's dates belong to ----------------------------------------
const SAT = "2026-11-14";
assert.deepEqual(weekOfDates(SAT, weekDates("2026-11-16")), {
  week: "next",
  weekStart: "2026-11-16",
});
assert.deepEqual(weekOfDates(SAT, ["2026-11-14", "2026-11-15"]), {
  week: "current",
  weekStart: "2026-11-09",
});
// A partial week is a week: Monday alone, or Wednesday to Sunday.
assert.deepEqual(weekOfDates(SAT, ["2026-11-18"]), { week: "next", weekStart: "2026-11-16" });
// Across a year change, from the weekend before.
assert.deepEqual(weekOfDates("2026-12-26", ["2026-12-31", "2027-01-01", "2027-01-03"]), {
  week: "next",
  weekStart: "2026-12-28",
});

const refused = (r: ReturnType<typeof weekOfDates>) => ("error" in r ? r.error : null);
// Straddling two weeks: refused, and the message names both Mondays to use.
assert.match(
  refused(weekOfDates(SAT, ["2026-11-15", "2026-11-16"])) ?? "",
  /2 semaines différentes.*lundi 2026-11-09.*lundi 2026-11-16/,
);
// Two weeks out, or last week: refused.
assert.match(refused(weekOfDates(SAT, ["2026-11-23"])) ?? "", /semaine du lundi 2026-11-23/);
assert.ok(refused(weekOfDates(SAT, ["2026-11-06"])));
// Garbage dates: refused, never filed under some Monday.
for (const bad of ["2026-13-01", "2026-02-31", "16/11/2026", "", "lundi"]) {
  assert.ok(refused(weekOfDates(SAT, [bad])), `« ${bad} » accepted`);
  assert.equal(isDateKey(bad), false);
}
assert.ok(refused(weekOfDates(SAT, [])));
// On Monday the week that was "next" is now "current", and the week after is "next".
assert.deepEqual(weekOfDates("2026-11-16", ["2026-11-17"]), {
  week: "current",
  weekStart: "2026-11-16",
});
assert.deepEqual(weekOfDates("2026-11-16", ["2026-11-23"]), {
  week: "next",
  weekStart: "2026-11-23",
});

// --- savePlan's own guard ------------------------------------------------------
assert.deepEqual(datesOutsideWeek("2026-11-16", weekDates("2026-11-16")), []);
assert.deepEqual(datesOutsideWeek("2026-11-16", ["2026-11-15", "2026-11-16", "x"]), [
  "2026-11-15",
  "x",
]);

// --- The prompt line -------------------------------------------------------------
const friday = nextWeekLine("2026-11-13");
assert.match(friday, /lundi 2026-11-16, mardi 2026-11-17, .*dimanche 2026-11-22\./);
assert.match(friday, /c'est la semaine PROCHAINE \(lundi 2026-11-16\)/);
assert.doesNotMatch(nextWeekLine("2026-11-12"), /PROCHAINE/);
assert.match(
  nextWeekLine("2026-11-12"),
  /demande-lui : celle-ci ou celle qui commence lundi 2026-11-16/,
);
assert.equal(friday.split("\n").length, 1, "one line: prefix.check only lets the last three move");

console.log("plan weeks ok");
