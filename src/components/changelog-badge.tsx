"use client";

import { Show } from "@clerk/nextjs";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/** The newest entry's file name — already the sort key, so comparing strings is
 *  the whole "is there something new" test. Someone who skipped three releases
 *  gets one button, not a counter. */
const KEY = "fitcrew:changelog-seen";

/** `storage` only fires in OTHER tabs, and this component never unmounts —
 *  cacheComponents keeps routes under <Activity>, hidden rather than destroyed.
 *  So the marker below dispatches the event itself and the badge hears it. */
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

const read = () => localStorage.getItem(KEY);

// `undefined` = "we haven't looked yet" (server render and first paint), which is
// not the same as `null` = "never seen anything". Reading localStorage during the
// first render would be a hydration mismatch; showing the badge to everyone until
// the effect runs would flash it at people who are up to date.
const unknown = () => undefined;

/**
 * The "there's something new" signal, rendered from the layout (only a server
 * component can read the markdown files) but shown on the home page only — the
 * footer link on `/` stays the permanent entry point.
 */
export function ChangelogBadge({ latest }: { latest: string | null }) {
  if (!latest) return null;

  // The `Show` wraps the hooks, exactly like SignedInNav: signed out it renders
  // nothing, which is both what we want (/changelog is behind Clerk, so the link
  // would be a trip to /sign-in) and what keeps every route prerenderable —
  // `usePathname` called unconditionally from the root layout fails the build
  // with CLIENT_HOOK_DYNAMIC on the dynamic routes.
  return (
    <Show when="signed-in">
      <Badge latest={latest} />
    </Show>
  );
}

function Badge({ latest }: { latest: string }) {
  const seen = useSyncExternalStore(subscribe, read, unknown);
  const pathname = usePathname();

  if (pathname !== "/" || seen === undefined || seen === latest) return null;

  return (
    // Lifted clear of the tab bar, like the toasts.
    <Button
      asChild
      variant="secondary"
      className="fixed right-4 bottom-[calc(var(--tab-bar)+1rem)] z-40 h-11 rounded-full px-4 shadow-lg"
    >
      <Link href="/changelog">
        <SparklesIcon aria-hidden />
        Du nouveau
      </Link>
    </Button>
  );
}

/** Rendered by /changelog: arriving on the page is what marks it read. */
export function MarkChangelogSeen({ latest }: { latest: string | null }) {
  useEffect(() => {
    if (!latest || localStorage.getItem(KEY) === latest) return;
    localStorage.setItem(KEY, latest);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  }, [latest]);

  return null;
}
