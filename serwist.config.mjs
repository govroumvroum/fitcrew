import { generateGlobPatterns, serwist } from "@serwist/next/config";

// Configurator mode: `@serwist/next`'s webpack plugin can't run under Turbopack,
// which Next 16 uses by default. So the service worker is built by the Serwist
// CLI right after `next build` (see the `build` script in package.json).
// https://serwist.pages.dev/docs/next/config
export default await serwist({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",

  // /seance, /coach and /progres are behind Clerk (see src/proxy.ts). Precaching
  // them from a signed-out browser would store the sign-in redirect as the app
  // shell, so instead only the always-public offline page is precached and pages
  // land in the cache as you visit them (defaultCache is NetworkFirst on
  // navigations). Anything never visited hits the /~offline fallback.
  precachePrerendered: false,
  // ponytail: distDir hardcoded because generateGlobPatterns needs it before
  // Next's config is resolved. Pass serwist.withNextConfig if distDir ever moves.
  globPatterns: [...generateGlobPatterns(".next/"), ".next/server/app/~offline.html"],
  // Install icons are fetched by the OS, not by the page — half a megabyte we
  // don't want in the precache.
  globIgnores: ["public/icon-*.png", "public/apple-touch-icon.png"],

  esbuildOptions: {
    // @serwist/next/worker's `defaultCache` branches on this and the CLI does
    // not define it, so an undefined `process` would blow up the worker.
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    // ponytail: no source map in production; flip on if you ever need to debug
    // a minified SW from a phone.
    sourcemap: false,
  },
});
