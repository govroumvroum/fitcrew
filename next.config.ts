import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
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
