import { withPostHogConfig } from "@posthog/nextjs-config";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * The version every Sentry event and session is tagged with, fixed once at
 * build time so the tag names the bundle that produced it rather than whenever
 * the row happens to be read. Without it Rustrak's releases tab stays empty:
 * `Sentry.init` reaches the SDK with no release, so nothing carries one.
 *
 * `SENTRY_RELEASE` wins because it is the one the SDK reads on its own and the
 * escape hatch a non-Vercel CI sets explicitly. On Vercel the commit SHA is
 * already in the environment, and locally neither exists, so fall back to git —
 * `try/catch` because a build without git (or outside a repo) must still work,
 * just untagged.
 */
function resolveRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const release = resolveRelease();

const nextConfig: NextConfig = {
  // Inlined into BOTH the server and the browser bundle (unlike a bare
  // NEXT_PUBLIC_ var, which only comes from the environment), so the two
  // `Sentry.init` calls — src/instrumentation.ts and
  // src/instrumentation-client.ts — tag every event and session with the same
  // release.
  env: { NEXT_PUBLIC_SENTRY_RELEASE: release },
  reactCompiler: true,
  // Every <Link> now prefetches one App Shell per route, shared across the two
  // navs (TabBar and NavRail both render all seven links), instead of a full
  // prefetch per link. Measured on the signed-in home page against a prod build:
  // 34.6 KB transferred / 110 KB decoded → 15.2 KB / 36 KB.
  //
  // partialPrefetching requires cacheComponents, which is the part with teeth: a
  // server component that reads cookies()/headers() or a bare `new Date()` now
  // has to sit inside <Suspense> or await io(). Nothing in this app does today —
  // auth lives in proxy.ts and every page's data comes from Convex on the
  // client — but that's the rule any new server component has to follow.
  cacheComponents: true,
  partialPrefetching: true,
  // PostHog is proxied through our own origin so ad blockers don't eat the
  // events. EU region: this app stores body weight and body composition.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
  // PostHog's ingestion endpoints care about the trailing slash and Next would
  // otherwise redirect them.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        // The service worker must never be served stale, or a bad release stays
        // installed on phones. Every other asset is fine on Next's defaults.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

/**
 * Uploads browser source maps so a prod exception arrives as real frames instead
 * of `chunks/2fsbruq_q0h04.js` — which was all we had to go on for the /coach
 * crash, leaving grep-by-error-message as the only way to find the line.
 *
 * Runs inside `next build` (Turbopack's `runAfterProductionCompile` hook), so it
 * lands before `serwist build` and `productionBrowserSourceMaps` is switched on
 * by the wrapper itself — neither needs setting here.
 *
 * `enabled` follows the same rule as `instrumentation-client.ts`: no key, no
 * upload, so a local `bun run build` stays quiet instead of failing on auth.
 * `deleteAfterUpload` is what keeps the maps off the CDN — without it the whole
 * unminified source ships publicly.
 */
export default withPostHogConfig(nextConfig, {
  // Typed as required, but only read when `enabled` — which is false without it.
  personalApiKey: process.env.POSTHOG_API_KEY ?? "",
  projectId: process.env.POSTHOG_PROJECT_ID,
  // NOT the `/ingest` proxy above: that only fronts ingestion. Uploads go to the
  // real EU API host, and the default is US.
  host: "https://eu.posthog.com",
  sourcemaps: {
    enabled: !!process.env.POSTHOG_API_KEY,
    releaseName: "fitcrew",
    releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA,
    deleteAfterUpload: true,
  },
});
