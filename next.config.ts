import { withPostHogConfig } from "@posthog/nextjs-config";
import { withSentryConfig } from "@sentry/nextjs/config";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

/**
 * Whether anything will upload source maps this build — the gate for emitting
 * them at all. With no uploader there is no `deleteAfterUpload` either, so the
 * `.map` files would sit in `/_next/static` forever, unminified source and all.
 *
 * `.env.sentry-build-plugin` is the one credential that is not in `process.env`
 * yet: the Sentry plugin reads that file itself, later, at build time. So look
 * for a token inside it rather than treating the file's mere existence as one.
 */
function hasSourceMapUploader() {
  if (process.env.SENTRY_AUTH_TOKEN || process.env.POSTHOG_API_KEY) return true;
  try {
    return /^\s*SENTRY_AUTH_TOKEN\s*=\s*\S/m.test(readFileSync(".env.sentry-build-plugin", "utf8"));
  } catch {
    return false;
  }
}

const nextConfig: NextConfig = {
  // Inlined into BOTH the server and the browser bundle (unlike a bare
  // NEXT_PUBLIC_ var, which only comes from the environment), so the two
  // `Sentry.init` calls — src/instrumentation.ts and
  // src/instrumentation-client.ts — tag every event and session with the same
  // release.
  env: { NEXT_PUBLIC_SENTRY_RELEASE: release },
  // Emit the `.map` files the source-map uploaders read. Gated on a credential
  // so a build with nothing to upload stays quiet AND never serves unminified
  // source: with no uploader there is no `deleteAfterUpload` either, so the maps
  // would sit in `/_next/static` forever.
  productionBrowserSourceMaps: hasSourceMapUploader(),
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
 * Uploads browser source maps to Rustrak so a prod exception arrives as real
 * frames instead of `chunks/2fsbruq_q0h04.js` — which was all we had to go on for
 * the /coach crash, leaving grep-by-error-message as the only way to find the
 * line.
 *
 * The upload runs inside `next build`, after the Turbopack compile, through the
 * `runAfterProductionCompile` hook. It is the only thing that knows about
 * Rustrak's build side: the DSN routes events, `sentryUrl` routes maps, and
 * pointing one at Rustrak does not move the other.
 *
 * `authToken` is the whole gate — without it the plugin skips the upload and the
 * build still succeeds, so a local `bun run build` stays quiet. Rustrak ignores
 * `org` (any non-empty string clears sentry-cli's org check) but matches
 * `project` against its dashboard slug; a wrong one 404s at assembly without
 * failing the build.
 *
 * PostHog must stay the OUTERMOST wrapper — its `withCompilerConfig` chains onto
 * `runAfterProductionCompile` and warns if a plain-object wrapper drops it — so
 * Sentry's hook runs first. PostHog uploads the same maps afterwards and deletes
 * them, so Sentry has to leave them on disk while PostHog is on; when PostHog is
 * off, Sentry is the only deleter and has to clean up itself.
 */
export default withPostHogConfig(
  withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG ?? "rustrak",
    project: process.env.SENTRY_PROJECT ?? "fitcrew",
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // `sentryUrl`, not `url`: that is the bundler plugin's name. Defaulted so a
    // missing env var can never send the maps to sentry.io.
    sentryUrl: process.env.SENTRY_URL ?? "https://rustrack.bazlab.si",
    release: {
      // Name the uploaded bundle with the release the SDK already tags events
      // with (above) so Rustrak lines a map up with the error that produced it.
      // The plugin does not create, finalize or commit-associate the release:
      // events already carry it, and this is source maps, not release wiring.
      name: release,
      create: false,
      finalize: false,
      setCommits: false,
    },
    sourcemaps: {
      // PostHog's hook runs after this one and deletes the maps it uploads, so
      // Sentry must not delete first or PostHog finds nothing left.
      deleteSourcemapsAfterUpload: !process.env.POSTHOG_API_KEY,
    },
  }),
  {
    // Typed as required, but only read when `enabled` — which is false without it.
    personalApiKey: process.env.POSTHOG_API_KEY ?? "",
    projectId: process.env.POSTHOG_PROJECT_ID,
    // NOT the `/ingest` proxy above: that only fronts ingestion. Uploads go to the
    // real EU API host, and the default is US.
    host: "https://eu.posthog.com",
    sourcemaps: {
      enabled: !!process.env.POSTHOG_API_KEY,
      releaseName: "fitcrew",
      // The same deploy version Sentry tags events with, so a PostHog source map
      // and the exception it belongs to never disagree off Vercel.
      releaseVersion: release,
      deleteAfterUpload: true,
    },
  },
);
