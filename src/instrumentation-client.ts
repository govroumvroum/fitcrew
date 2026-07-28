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
