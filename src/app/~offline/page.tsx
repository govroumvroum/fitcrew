import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hors ligne — FitCrew" };

// Served by the service worker when a navigation fails and the page isn't cached.
// Deliberately static: no Convex, no Clerk, nothing that needs the network.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-display text-2xl font-bold">Hors ligne</h1>
      <p className="text-muted-foreground text-sm">
        Cette page n&apos;est pas encore disponible hors ligne. Reconnecte-toi au réseau puis
        réessaie — rien de ce que tu as déjà enregistré n&apos;est perdu.
      </p>
    </main>
  );
}
