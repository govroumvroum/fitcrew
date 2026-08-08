/** Self-check for the pure parts of agent-login.ts. Run: `bun scripts/agent-login.check.ts` */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import {
  assertDevSecretKey,
  buildRedirectUrl,
  CANDIDATE_PORTS,
  cookieHeaderFor,
  DEFAULT_BROWSER_SESSION,
  DEFAULT_SESSION_SECONDS,
  importCookies,
  jarApply,
  type JarCookie,
  looksLikeNextServer,
  parseArgs,
  parsePort,
  parseSetCookie,
  PROBE_TIMEOUT_MS,
  resolvePort,
} from "./agent-login";

// --- the guard that is the point of the script -------------------------------
// A live key must never mint a session, whatever it looks like.
for (const bad of [
  undefined,
  "",
  "sk_live_deadbeef",
  "sk_deadbeef",
  "pk_test_deadbeef",
  " sk_test_deadbeef", // a stray space from a copy-paste is not a dev key either
  "SK_TEST_DEADBEEF", // the prefix is lowercase; a shouted one is not a Clerk key
]) {
  assert.throws(() => assertDevSecretKey(bad), /not set|Refusing to run/);
}
assert.equal(assertDevSecretKey("sk_test_deadbeef"), "sk_test_deadbeef");

// And the refusal must not leak the value it refused: the message quotes nothing.
try {
  assertDevSecretKey("sk_live_supersecretvalue");
  assert.fail("expected a refusal");
} catch (error) {
  const message = (error as Error).message;
  assert.ok(!message.includes("supersecret"));
  assert.ok(!message.includes("sk_live_supersecret"));
}

// --- port detection ----------------------------------------------------------
// The dev server came up on 3001 during #47 because another project held 3000.
// A responding 3000 that is *not* Next must not win.
const nextHeaders = new Headers({ "x-powered-by": "Next.js" });
assert.ok(looksLikeNextServer(nextHeaders, ""));
assert.ok(looksLikeNextServer(new Headers({ "x-nextjs-cache": "HIT" }), ""));
assert.ok(looksLikeNextServer(new Headers(), '<script src="/_next/static/chunk.js">'));
assert.ok(!looksLikeNextServer(new Headers({ "x-powered-by": "Express" }), "hello"));
assert.ok(!looksLikeNextServer(new Headers(), "<html>some other app</html>"));

const onlyOn = (open: number) => async (port: number) => port === open;
assert.equal(await resolvePort(undefined, onlyOn(3001)), 3001);
assert.equal(await resolvePort(undefined, onlyOn(3000)), 3000);
// An explicit port is trusted without probing — the server may still be booting.
assert.equal(await resolvePort(4321, async () => false), 4321);
// Nothing listening is an error, never a silent fallback to 3000.
await assert.rejects(resolvePort(undefined, async () => false), /No Next dev server answered/);
assert.equal(CANDIDATE_PORTS[0], 3000);

assert.equal(parsePort("3001"), 3001);
assert.equal(parsePort(undefined), undefined);
assert.equal(parsePort(true), undefined);
for (const bad of ["0", "-1", "70000", "3001x", ""]) {
  assert.throws(() => parsePort(bad), /Invalid port/);
}

// --- redirect URL ------------------------------------------------------------
// Must land on an instance domain, with the port that is actually serving.
assert.equal(buildRedirectUrl(3001), "http://localhost:3001/");
assert.equal(buildRedirectUrl(3000), "http://localhost:3000/");

// --- flags -------------------------------------------------------------------
assert.deepEqual(parseArgs(["--port", "3001", "--identifier", "a@b.c"]), {
  port: "3001",
  identifier: "a@b.c",
});
assert.deepEqual(parseArgs(["--port=3001"]), { port: "3001" });
assert.deepEqual(parseArgs(["--revoke", "at_abc"]), { revoke: "at_abc" });
assert.deepEqual(parseArgs(["--revoke"]), { revoke: true }); // caught later with a usage error
assert.deepEqual(parseArgs([]), {});

// A cold `next dev` compiles its first page slower than 1500ms; the probe must
// outwait that instead of reporting "no server" while the server is compiling.
assert.ok(PROBE_TIMEOUT_MS >= 15_000);

// --browser bare uses the shared session name; --browser <name> overrides it.
assert.deepEqual(parseArgs(["--browser"]), { browser: true });
assert.deepEqual(parseArgs(["--browser", "qa"]), { browser: "qa" });
assert.equal(DEFAULT_BROWSER_SESSION, "fitcrew");

// --- the SameSite-blind cookie jar --------------------------------------------
// Chrome drops Clerk's `SameSite=None` (no Secure) handshake cookies on
// http://localhost; the jar must keep them, like curl does.
const jar = new Map<string, JarCookie>();
const session = parseSetCookie(
  "__session_abc=eyJx; Path=/; Expires=Sun, 08 Aug 2027 12:00:00 GMT; SameSite=None",
  "localhost",
);
assert.ok(session);
assert.equal(session.name, "__session_abc");
assert.equal(session.domain, "localhost");
assert.equal(session.httpOnly, false);
jarApply(jar, session);

// Domain attribute strips the leading dot; HttpOnly and Max-Age are honored.
const refresh = parseSetCookie(
  "__refresh_abc=tok; Path=/; Domain=.localhost; HttpOnly; Max-Age=600; SameSite=None",
  "localhost",
);
assert.ok(refresh);
assert.equal(refresh.domain, "localhost");
assert.equal(refresh.httpOnly, true);
assert.ok(refresh.expires && refresh.expires > Date.now() / 1000 + 500);
jarApply(jar, refresh);

// FAPI cookies stay on the FAPI domain and never leak into a localhost header.
const fapi = parseSetCookie("__clerk_db_jwt=x; Path=/", "example.clerk.accounts.dev");
assert.ok(fapi);
jarApply(jar, fapi);

assert.equal(cookieHeaderFor(jar, "localhost"), "__session_abc=eyJx; __refresh_abc=tok");
assert.equal(cookieHeaderFor(jar, "example.clerk.accounts.dev"), "__clerk_db_jwt=x");

// The handshake deletes cookies by setting them expired — the jar must forget them.
const deletion = parseSetCookie(
  "__session_abc=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  "localhost",
);
assert.ok(deletion);
jarApply(jar, deletion);
assert.equal(cookieHeaderFor(jar, "localhost"), "__refresh_abc=tok");

// Garbage lines are ignored, not thrown on.
assert.equal(parseSetCookie("no-equals-sign", "localhost"), null);

// --- session length ----------------------------------------------------------
// Clerk defaults to 1800s, which expired mid-run in #47.
assert.ok(DEFAULT_SESSION_SECONDS > 1800);
assert.equal(DEFAULT_SESSION_SECONDS, 7200);

// --- the CDP import must never hang -----------------------------------------
// A wedged browser still accepts the TCP connection (kernel accept queue) while
// the WebSocket upgrade never completes: no onopen, no onerror, nothing to
// settle on. Both phases share one ceiling, so this must fail, not freeze.
{
  const wedged = createServer(() => {}); // accepts, then never speaks
  await new Promise<void>((ready) => wedged.listen(0, "127.0.0.1", ready));
  const { port } = wedged.address() as AddressInfo;
  const started = Date.now();
  await assert.rejects(
    importCookies(`ws://127.0.0.1:${port}/devtools/page/wedged`, [], 300),
    /Timed out talking to the browser's CDP socket|Could not connect/,
  );
  assert.ok(Date.now() - started < 5000, "the wedged-socket import should fail fast, not hang");
  wedged.close();
}

console.log("agent-login: ok");
