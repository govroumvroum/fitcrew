import posthog from "posthog-js";

// Runs before React hydrates, which is the point: an exception thrown during
// hydration is exactly the one we'd otherwise never see.
//
// The key is absent in local dev unless you put it in .env.local — no key means
// no init, rather than a console full of failed requests.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // Same-origin path, rewritten in next.config.ts. Calling the PostHog host
    // directly is blocked by uBlock and Safari, which loses data silently.
    api_host: "/ingest",
    // Needed because api_host is a proxy: the UI links have to point at the
    // real dashboard, not at fitcrew.
    ui_host: "https://eu.posthog.com",
    // 2026-05-30 turns on `capture_pageview: 'history_change'`, so App Router
    // navigations are tracked without a usePathname effect.
    defaults: "2026-05-30",
    // NOT covered by `defaults` — error tracking is opt-in.
    capture_exceptions: true,
    session_recording: {
      // Every weight, rep count and body-fat field in the app. Default is
      // already true; stated explicitly so nobody "simplifies" it away.
      maskAllInputs: true,
      // Rendered text is NOT masked by default, and that's where the sensitive
      // data actually is — the coach's replies and the progression numbers are
      // text nodes, not inputs.
      //
      // Deliberately NOT PostHog's built-in `ph-no-capture`: that one is a
      // *block* class (it sits next to `rr-block` in the recorder), so the
      // element becomes a grey placeholder and we'd lose the layout we want to
      // watch. Masking keeps the boxes and charts, and replaces the digits.
      maskTextSelector: ".ph-mask, .ph-mask *",
    },
  });
}

// The service worker is built by the Serwist CLI after `next build`, so it only
// exists in production output. Registering here rather than from a component
// keeps it out of the React tree and off the hydration path.
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      // Private browsing and locked-down enterprise profiles refuse SW registration.
      .catch(() => {});
  });
}
