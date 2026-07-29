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

export default nextConfig;
