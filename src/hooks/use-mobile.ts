import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

// shadcn ships this as useState + useEffect, which React Compiler rejects here.
// A media query is an external store, so subscribe to it instead of mirroring it
// into state. `false` on the server: desktop layout, no hydration mismatch.
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
