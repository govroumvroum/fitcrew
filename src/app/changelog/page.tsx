import type { Metadata } from "next";
import { Streamdown } from "streamdown";
import { readEntries } from "@/lib/changelog";

export const metadata: Metadata = { title: "Nouveautés — FitCrew" };

// Dates come from the file names, so this formats a fixed string — no `new Date()`
// without an argument, nothing that reads the current time. `cacheComponents` is on.
const formatDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// Static: the entries are markdown files read at build time. No Convex, no Clerk.
export default function ChangelogPage() {
  const entries = readEntries();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-4 pb-[var(--tab-bar)]">
      <h1 className="font-display text-2xl font-bold">Nouveautés</h1>
      <p className="text-muted-foreground mt-1 text-sm">Ce qui a bougé dans FitCrew.</p>

      {entries.length === 0 ? (
        <p className="text-muted-foreground mt-8 text-sm">Rien à signaler pour l&apos;instant.</p>
      ) : (
        <ol className="mt-8 flex flex-col gap-8">
          {entries.map((entry) => (
            <li key={entry.name} className="flex flex-col gap-2">
              <time className="eyebrow" dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
              <h2 className="text-lg font-semibold">{entry.title}</h2>
              <div className="text-muted-foreground flex flex-col gap-2 text-sm">
                <Streamdown>{entry.body}</Streamdown>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
