import * as Sentry from "@sentry/nextjs";

// One init per runtime: `register` runs once when a Node server instance starts
// and once for the edge one, so a single call covers both. `@sentry/nextjs`
// resolves its own node/edge build from the package exports, which is what makes
// the edge runtime behind Clerk's proxy (src/proxy.ts) safe to share this file
// rather than the two byte-identical config files the Sentry wizard generates.
//
// Gated on the DSN the same way as the client (src/instrumentation-client.ts):
// no DSN, no init, so local dev stays quiet instead of failing every request.
export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) Sentry.init({ dsn });
}

// Next calls this for a throw in a Server Component, route handler, server
// action or the Clerk proxy — the proxy one is the edge error, and it is a
// no-op until `register` above has run.
export const onRequestError = Sentry.captureRequestError;
