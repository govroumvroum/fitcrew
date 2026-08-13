import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangelogEntry = {
  /** File name, kept as the sort key and the React key. */
  name: string;
  /** `YYYY-MM-DD`, straight from the file name — no frontmatter, no parsing of the body. */
  date: string;
  title: string;
  /** Markdown, first `# ` line removed. */
  body: string;
};

/** `YYYY-MM-DD-slug.md`. The date is the file name; that's the whole format. */
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-.+\.md$/;

export const CHANGELOG_DIR = join(process.cwd(), "src/content/changelog");

/**
 * Anything that doesn't match — a stray `README.md`, a half-written file with no
 * `# ` title — is dropped rather than rendered as an entry with an `Invalid Date`
 * or an empty heading. Sorted by file name descending, which is by date.
 */
export function parseEntries(files: { name: string; content: string }[]): ChangelogEntry[] {
  return files
    .flatMap(({ name, content }) => {
      const date = FILE_NAME.exec(name)?.[1];
      // `Date.parse` rejects what the regex can't: month 13, 31 February.
      if (!date || Number.isNaN(Date.parse(date))) return [];
      const lines = content.split("\n");
      const heading = lines.findIndex((line) => line.startsWith("# "));
      if (heading === -1) return [];
      return [
        {
          name,
          date,
          title: lines[heading].slice(2).trim(),
          body: [...lines.slice(0, heading), ...lines.slice(heading + 1)].join("\n").trim(),
        },
      ];
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Read at build time. Missing or empty directory → no entries, no crash. */
export function readEntries(dir = CHANGELOG_DIR): ChangelogEntry[] {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  return parseEntries(
    names.map((name) => ({ name, content: readFileSync(join(dir, name), "utf8") })),
  );
}
