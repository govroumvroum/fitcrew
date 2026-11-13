/**
 * The semaine type, pure (#118). No Convex server import, so the client can use
 * the labels and the level arithmetic without pulling the backend in — same
 * trick as `toolSchemas.ts`. The functions live in `convex/week.ts`.
 *
 * The template says WHICH weekdays he trains. It never says WHICH séance: the
 * programs keep their calendar-free rotation (`nextDayIndex`), and a planned day
 * he skips puts him behind on nothing.
 */

export type DayLevel = "off" | "leger" | "dur";

export type WeekEntry = {
  weekday: number; // 0 = lundi … 6 = dimanche
  kind: string;
  lineageId?: string;
  level: DayLevel;
  time?: string; // "matin" | "midi" | "soir" | "HH:MM"
};

export const DAY_LEVELS: DayLevel[] = ["off", "leger", "dur"];

const RANK: Record<DayLevel, number> = { off: 0, leger: 1, dur: 2 };

export const LEVEL_LABEL: Record<DayLevel, string> = {
  off: "Off",
  leger: "Léger",
  dur: "Dur",
};

/** Monday first, like every week key in the app (`weekStart`). */
export const WEEKDAYS = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** At most this many things planned on one day — the issue's « 0 à 3 entrées ». */
export const MAX_PER_DAY = 3;
export const MAX_KIND_CHARS = 40;

const DAY = 86_400_000;

/**
 * 0 = lundi … 6 = dimanche, from the user's LOCAL date key. Never from the
 * server clock: a séance at 23:30 in Bordeaux is already tomorrow in UTC. Same
 * UTC-midnight arithmetic as `weekStart`, so DST can't shift it.
 */
export function weekdayOf(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  return (new Date(time).getUTCDay() + 6) % 7;
}

/** The seven date keys of the week starting on `monday`. */
export function weekDates(monday: string): string[] {
  const start = Date.parse(`${monday}T00:00:00Z`);
  return WEEKDAYS.map((_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}

export const highestLevel = (levels: DayLevel[]): DayLevel =>
  levels.reduce<DayLevel>((best, level) => (RANK[level] > RANK[best] ? level : best), "off");

export const entriesOn = <T extends { weekday: number }>(entries: T[], weekday: number): T[] =>
  entries.filter((entry) => entry.weekday === weekday);

/** A day's level is the highest of its entries; a day with none is `off`. */
export const levelOfWeekday = (entries: WeekEntry[], weekday: number): DayLevel =>
  highestLevel(entriesOn(entries, weekday).map((entry) => entry.level));

const MOMENTS = new Set(["matin", "midi", "soir"]);

/**
 * "Matin " → "matin", "18h30" / "18:30" / "18h" → "18:30" / "18:00". Empty is
 * "no time" (undefined). Anything else is `null`: refused, never guessed — the
 * Chef places carbs 1h30 before this, and an invented hour is worse than none.
 */
export function normalizeTime(raw: string | null | undefined): string | undefined | null {
  const text = raw?.trim().toLowerCase() ?? "";
  if (text === "") return undefined;
  if (MOMENTS.has(text)) return text;
  const match = /^(\d{1,2})\s*[h:]\s*(\d{2})?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "18:30" → "18h30", "18:00" → "18h", a moment as is. */
export function formatTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = String(Number(match[1]));
  return match[2] === "00" ? `${hours}h` : `${hours}h${match[2]}`;
}

/** "boxe 18h30" — one entry, the way the slab and the prompts say it. */
export const entryLabel = (entry: { kind: string; time?: string }) =>
  entry.time ? `${entry.kind} ${formatTime(entry.time)}` : entry.kind;

/**
 * Checks and cleans what a writer sent — the Coach's tool or the /programme
 * editor, which go through the same mutation. Returns the cleaned entries in
 * weekday order, or the reason they were refused. Program ownership is NOT
 * checked here: that needs the database (see `week.save`).
 */
export function cleanEntries(
  raw: { weekday: number; kind: string; lineageId?: string; level: DayLevel; time?: string }[],
): { entries: WeekEntry[] } | { error: string } {
  const entries: WeekEntry[] = [];
  for (const entry of raw) {
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6)
      return { error: `Jour de la semaine invalide (${entry.weekday}).` };
    const kind = entry.kind.trim().replace(/\s+/g, " ");
    if (kind === "") return { error: `Une séance du ${WEEKDAYS[entry.weekday]} n'a pas de nom.` };
    if (kind.length > MAX_KIND_CHARS)
      return { error: `« ${kind.slice(0, 20)}… » : nom trop long (${MAX_KIND_CHARS} max).` };
    const time = normalizeTime(entry.time);
    if (time === null)
      return {
        error: `Moment « ${entry.time} » pas compris pour ${kind} : matin, midi, soir ou une heure (18:30).`,
      };
    const lineageId = entry.lineageId?.trim();
    entries.push({
      weekday: entry.weekday,
      kind,
      level: entry.level,
      ...(lineageId ? { lineageId } : {}),
      ...(time ? { time } : {}),
    });
  }
  for (let weekday = 0; weekday < 7; weekday++) {
    if (entriesOn(entries, weekday).length > MAX_PER_DAY)
      return { error: `Le ${WEEKDAYS[weekday]} : ${MAX_PER_DAY} séances au plus.` };
  }
  // Stable sort: entries of one day keep the order they were written in.
  return { entries: entries.sort((a, b) => a.weekday - b.weekday) };
}

/**
 * The first entry naming a program that isn't one of `owned` — the lineages of
 * the AUTHENTICATED user, read by the caller. A lineageId the model (or a
 * crafted request) sends is not an authorisation: another user's program is
 * simply not in that set, and the write is refused.
 */
export const foreignEntry = (entries: WeekEntry[], owned: Set<string>) =>
  entries.find((entry) => entry.lineageId !== undefined && !owned.has(entry.lineageId));

const sameKind = (a: string, b: string) =>
  a
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim() ===
  b
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Something trained on the day: a séance of a program, or a cardio of some kind. */
export type DaySession = { lineageId?: string; kind?: string };

/**
 * The level a séance gives a day the template called `off`: the level the
 * template gives that same program (or that same kind of cardio) elsewhere in
 * the week, the highest if it appears several times, else `dur`. An entry the
 * template itself rates `off` doesn't count — he trained, so the day isn't off.
 */
export function levelForSessions(entries: WeekEntry[], sessions: DaySession[]): DayLevel {
  const levels = sessions.map((session) => {
    const same = entries.filter(
      (entry) =>
        entry.level !== "off" &&
        ((session.lineageId !== undefined && entry.lineageId === session.lineageId) ||
          (session.kind !== undefined && sameKind(entry.kind, session.kind))),
    );
    return same.length > 0 ? highestLevel(same.map((entry) => entry.level)) : "dur";
  });
  return highestLevel(levels);
}

export type LevelSource = "manual" | "session" | "template" | "none";

/**
 * Today's level, in the issue's order:
 *  0. no semaine type at all → NO level (`null`, source "none"). Decided with
 *     Basile: without a week, his flat target stays in force. That target is an
 *     average that already includes sport, so neither a séance nor the selector
 *     may turn the day into a level — training would count twice over the week;
 *  1. he set it by hand today → that;
 *  2. a séance was started or logged today while the template said `off` → a
 *     training day (`levelForSessions`);
 *  3. otherwise → what the template says.
 * `planned` is the template's entries for that weekday, whatever won.
 */
export function resolveDayLevel(input: {
  date: string;
  entries: WeekEntry[];
  override?: { date: string; level: DayLevel } | null;
  sessions: DaySession[];
}):
  | { level: DayLevel; source: Exclude<LevelSource, "none">; planned: WeekEntry[] }
  | { level: null; source: "none"; planned: WeekEntry[] } {
  if (input.entries.length === 0) return { level: null, source: "none", planned: [] };
  const weekday = weekdayOf(input.date);
  const planned = entriesOn(input.entries, weekday);
  if (input.override && input.override.date === input.date)
    return { level: input.override.level, source: "manual", planned };
  const fromTemplate = levelOfWeekday(input.entries, weekday);
  if (fromTemplate === "off" && input.sessions.length > 0)
    return { level: levelForSessions(input.entries, input.sessions), source: "session", planned };
  return { level: fromTemplate, source: "template", planned };
}

/**
 * The template written out for a prompt, one line per weekday. Rest days are
 * listed too: « rien de prévu » is information, a missing line is a question.
 * An archived program stays (he may still train that day) and says so.
 */
export function renderWeek(
  entries: (WeekEntry & { program?: { name: string; status: string } | null })[],
): string {
  return WEEKDAYS.map((name, weekday) => {
    const today = entriesOn(entries, weekday);
    if (today.length === 0) return `- ${name} : rien de prévu (off)`;
    const items = today.map((entry) => {
      const program = entry.program
        ? ` — programme « ${entry.program.name} »${entry.program.status !== "active" ? `, ${entry.program.status === "archived" ? "archivé" : "terminé"}` : ""}`
        : "";
      const time = entry.time ? `, ${formatTime(entry.time)}` : ", moment non précisé";
      return `${entry.kind} (${entry.level}${time})${program}`;
    });
    return `- ${name} : ${items.join(" + ")} → journée ${levelOfWeekday(entries, weekday)}`;
  }).join("\n");
}
