/** Self-check for the changelog parsing. Run: `bun src/lib/changelog.check.ts` */
import assert from "node:assert/strict";
import { parseEntries, readEntries } from "./changelog";

// --- file name → date, first `# ` → title, the rest → body ------------------
const [entry] = parseEntries([
  { name: "2026-08-11-partage-programme.md", content: "# Partage\n\nTu peux partager.\n" },
]);
assert.equal(entry.date, "2026-08-11");
assert.equal(entry.title, "Partage");
assert.equal(entry.body, "Tu peux partager.");

// A `#` deeper in the body stays in the body: only the first level-1 is the title.
const [nested] = parseEntries([
  { name: "2026-01-02-x.md", content: "# Titre\n\n## Détail\n\ntexte" },
]);
assert.equal(nested.title, "Titre");
assert.equal(nested.body, "## Détail\n\ntexte");

// --- descending sort ---------------------------------------------------------
const dates = parseEntries(
  ["2026-01-02-a.md", "2026-08-11-b.md", "2025-12-31-c.md"].map((name) => ({
    name,
    content: "# t",
  })),
).map((e) => e.date);
assert.deepEqual(dates, ["2026-08-11", "2026-01-02", "2025-12-31"]);

// --- anything malformed is dropped, never rendered as a ghost entry ----------
assert.deepEqual(
  parseEntries([
    { name: "README.md", content: "# Nope" },
    { name: "2026-13-01-not-a-date.md", content: "# Nope" }, // month 13 → Invalid Date
    { name: "2026-02-31-not-a-date.md", content: "# Nope" }, // day 31 of Feb → would roll to Mar 3
    { name: "2026-04-31-not-a-date.md", content: "# Nope" }, // day 31 of a 30-day month
    { name: "2026-08-11.md", content: "# Nope" }, // no slug
    { name: "2026-08-11-notes.txt", content: "# Nope" },
    { name: "2026-08-11-no-title.md", content: "juste du corps" },
  ]),
  [],
);

// Empty directory builds fine.
assert.deepEqual(parseEntries([]), []);

// --- the real files on disk parse ------------------------------------------
assert.ok(readEntries().length > 0, "at least one changelog entry should exist");

console.log("changelog.check.ts ok");
