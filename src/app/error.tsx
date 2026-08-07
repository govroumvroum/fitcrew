"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * The app's only error boundary — at the root, so it catches every route below
 * it. Before this file, a throw anywhere in the tree was a white screen.
 *
 * The button reloads rather than calling Next's `retry()`. `retry()` re-renders
 * the SAME bundle, which is useless for the error that actually put this page
 * here: a tab left open across a deploy keeps running the old JS and calls a
 * Convex function the new backend no longer has (see the SW reload in
 * src/instrumentation-client.ts). Only a reload fetches the new bundle.
 * Nothing is lost either way — the séance lives in Convex, not in this tab.
 */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // PostHog's `capture_exceptions` only sees UNCAUGHT errors, and React just
    // caught this one. Without this line the boundary would hide every crash.
    posthog.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-display text-2xl font-bold">Ça a cassé</h1>
      <p className="text-muted-foreground text-sm">
        Une erreur inattendue. Recharge la page — c&apos;est ce qui répare le cas le plus courant,
        une version de l&apos;app restée ouverte trop longtemps. Rien de ce que tu as enregistré
        n&apos;est perdu.
      </p>
      <Button className="mt-2" onClick={() => window.location.reload()}>
        Recharger
      </Button>
    </main>
  );
}
