"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import "./globals.css";

/**
 * The last resort: `error.tsx` covers every route, but a throw in the ROOT
 * LAYOUT bypasses it, and that layout mounts ClerkProvider,
 * ConvexClientProvider and `<StoreUser />` — which calls `api.users.store`.
 * A stale bundle calling a Convex function that no longer exists would throw
 * exactly there, so leaving this gap open would leave a white screen for the
 * very bug the boundary exists to catch.
 *
 * This replaces the root layout, hence its own `<html>`/`<body>` and the
 * stylesheet import. Deliberately dependency-free otherwise: no providers, no
 * `Button`, no fonts. It's the page that has to render when app code is what
 * broke, so it borrows as little of it as possible. `dark` because the app is
 * dark-only (see layout.tsx) and globals.css defaults to light without it.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    posthog.captureException(error);
  }, [error]);

  return (
    <html lang="fr" className="dark h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-2xl font-bold">Ça a cassé</h1>
          <p className="text-muted-foreground text-sm">
            Une erreur inattendue. Recharge la page — c&apos;est ce qui répare le cas le plus
            courant, une version de l&apos;app restée ouverte trop longtemps. Rien de ce que tu as
            enregistré n&apos;est perdu.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground mt-2 rounded-md px-4 py-2 text-sm font-medium"
          >
            Recharger
          </button>
        </main>
      </body>
    </html>
  );
}
