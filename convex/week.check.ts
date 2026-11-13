/** Self-check for the semaine type (#118). Run: `bun convex/week.check.ts` */
import assert from "node:assert/strict";
import {
  type WeekEntry,
  cleanEntries,
  foreignEntry,
  formatTime,
  levelForSessions,
  levelOfWeekday,
  normalizeTime,
  renderWeek,
  resolveDayLevel,
  weekDates,
  weekdayOf,
} from "./weekTemplate";

// --- Weekday from a LOCAL date key ------------------------------------------
// 2026-11-09 is a Monday. Monday-first, like `weekStart`.
assert.equal(weekdayOf("2026-11-09"), 0);
assert.equal(weekdayOf("2026-11-13"), 4); // vendredi
assert.equal(weekdayOf("2026-11-15"), 6); // dimanche
// Across a DST change (France, 2026-03-29) and a year boundary: the date key
// decides, never a clock, so neither can shift it.
assert.equal(weekdayOf("2026-03-29"), 6);
assert.equal(weekdayOf("2026-03-30"), 0);
assert.equal(weekdayOf("2027-01-01"), 4);
assert.deepEqual(weekDates("2026-11-09"), [
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
]);

// --- Times -------------------------------------------------------------------
assert.equal(normalizeTime(" Soir "), "soir");
assert.equal(normalizeTime("18h30"), "18:30");
assert.equal(normalizeTime("18:30"), "18:30");
assert.equal(normalizeTime("7h"), "07:00");
assert.equal(normalizeTime(""), undefined);
assert.equal(normalizeTime(null), undefined);
assert.equal(normalizeTime("après le boulot"), null, "an unknown moment is refused, not guessed");
assert.equal(normalizeTime("25:00"), null);
assert.equal(formatTime("18:30"), "18h30");
assert.equal(formatTime("07:00"), "7h");
assert.equal(formatTime("matin"), "matin");

// --- A day's level: the highest of its entries, off without any ---------------
const week: WeekEntry[] = [
  { weekday: 0, kind: "muscu", lineageId: "prog_muscu", level: "dur", time: "18:30" },
  { weekday: 2, kind: "mobilité", level: "leger" },
  { weekday: 2, kind: "boxe", lineageId: "prog_boxe", level: "dur", time: "soir" },
  { weekday: 4, kind: "boxe", lineageId: "prog_boxe", level: "leger" },
  { weekday: 5, kind: "marche", level: "off" },
];
assert.equal(levelOfWeekday(week, 0), "dur");
assert.equal(levelOfWeekday(week, 2), "dur", "léger + dur on one day is a dur day");
assert.equal(levelOfWeekday(week, 4), "leger");
assert.equal(levelOfWeekday(week, 1), "off", "no entry is off");
assert.equal(levelOfWeekday(week, 5), "off");

// --- Today's level: manual > séance du jour > semaine type ---------------------
const MONDAY = "2026-11-09";
const TUESDAY = "2026-11-10"; // nothing planned
const FRIDAY = "2026-11-13"; // boxe léger

// 3. The template, when nothing else happened.
assert.deepEqual(
  pick(resolveDayLevel({ date: MONDAY, entries: week, sessions: [] })),
  { level: "dur", source: "template" },
);
assert.deepEqual(
  pick(resolveDayLevel({ date: TUESDAY, entries: week, sessions: [] })),
  { level: "off", source: "template" },
);
// No template at all: every day is off.
assert.deepEqual(
  pick(resolveDayLevel({ date: MONDAY, entries: [], sessions: [] })),
  { level: "off", source: "template" },
);

// 2. A séance on an off day makes it a training day — at the level the template
// gives that program elsewhere in the week (boxe: dur on Wednesday, léger on
// Friday → the highest, dur)…
assert.deepEqual(
  pick(resolveDayLevel({ date: TUESDAY, entries: week, sessions: [{ lineageId: "prog_boxe" }] })),
  { level: "dur", source: "session" },
);
// …matched on the cardio's kind when there's no program, accents and case aside…
assert.equal(levelForSessions(week, [{ kind: "Mobilite" }]), "leger");
// …and dur when the template doesn't know it.
assert.equal(levelForSessions(week, [{}]), "dur");
assert.equal(levelForSessions(week, [{ kind: "natation" }]), "dur");
// An entry the template itself rates off doesn't make a séance "off".
assert.equal(levelForSessions(week, [{ kind: "marche" }]), "dur");
assert.equal(levelForSessions([], [{ lineageId: "prog_muscu" }]), "dur");
// A séance on a day that was ALREADY planned doesn't change it: the template
// already said what kind of day it is.
assert.deepEqual(
  pick(resolveDayLevel({ date: FRIDAY, entries: week, sessions: [{ lineageId: "prog_boxe" }] })),
  { level: "leger", source: "template" },
);

// 1. A manual choice wins over everything — but only on its own date.
assert.deepEqual(
  pick(
    resolveDayLevel({
      date: TUESDAY,
      entries: week,
      override: { date: TUESDAY, level: "leger" },
      sessions: [{ lineageId: "prog_boxe" }],
    }),
  ),
  { level: "leger", source: "manual" },
);
assert.deepEqual(
  pick(
    resolveDayLevel({
      date: MONDAY,
      entries: week,
      override: { date: TUESDAY, level: "off" },
      sessions: [],
    }),
  ),
  { level: "dur", source: "template" },
  "yesterday's manual choice doesn't leak into today",
);
// `planned` is the weekday's entries whatever won.
assert.equal(
  resolveDayLevel({ date: "2026-11-11", entries: week, sessions: [] }).planned.length,
  2,
);

// --- Cleaning what a writer sends --------------------------------------------
const ok = cleanEntries([
  { weekday: 4, kind: "  boxe   club ", level: "dur", time: "18h30" },
  { weekday: 0, kind: "muscu", lineageId: " prog_muscu ", level: "dur", time: "" },
]);
assert.ok("entries" in ok);
assert.deepEqual(ok.entries, [
  { weekday: 0, kind: "muscu", lineageId: "prog_muscu", level: "dur" },
  { weekday: 4, kind: "boxe club", level: "dur", time: "18:30" },
]);
assert.ok("error" in cleanEntries([{ weekday: 7, kind: "boxe", level: "dur" }]));
assert.ok("error" in cleanEntries([{ weekday: 1.5, kind: "boxe", level: "dur" }]));
assert.ok("error" in cleanEntries([{ weekday: 1, kind: "  ", level: "dur" }]));
assert.ok("error" in cleanEntries([{ weekday: 1, kind: "boxe", level: "dur", time: "tôt" }]));
assert.ok(
  "error" in
    cleanEntries(
      ["a", "b", "c", "d"].map((kind) => ({ weekday: 3, kind, level: "leger" as const })),
    ),
  "4 entries on one day is refused",
);
assert.ok("entries" in cleanEntries([]), "an empty week is a valid week");

// --- Isolation: only the user's own lineages pass ------------------------------
const mine = new Set(["prog_muscu", "prog_boxe"]);
assert.equal(foreignEntry(week, mine), undefined);
assert.equal(
  foreignEntry([...week, { weekday: 1, kind: "vol", lineageId: "prog_someone_else", level: "dur" }], mine)
    ?.lineageId,
  "prog_someone_else",
  "another user's lineageId is refused",
);
assert.equal(foreignEntry(week, new Set()), week[0], "no programs: every lineage is foreign");

// --- The prompt rendering ----------------------------------------------------
const rendered = renderWeek([
  {
    ...week[0],
    program: { name: "Full body", status: "active" },
  },
  { ...week[3], program: { name: "Boxe", status: "archived" } },
]);
assert.equal(rendered.split("\n").length, 7, "one line per weekday, rest days included");
assert.match(rendered, /lundi : muscu \(dur, 18h30\) — programme « Full body » → journée dur/);
assert.match(rendered, /vendredi : boxe \(leger, moment non précisé\) — programme « Boxe », archivé/);
assert.match(rendered, /mardi : rien de prévu \(off\)/);

console.log("semaine type ok");

function pick(r: { level: string; source: string }) {
  return { level: r.level, source: r.source };
}
