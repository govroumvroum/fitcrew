/**
 * Mints a Clerk Agent Task URL so an agent can reach a signed-in localhost page
 * with no human clicking "Continuer avec Google".
 *
 * Run: `bun run agent-login` (see package.json). Self-check: `bun scripts/agent-login.check.ts`.
 *
 * Two rules govern everything below:
 *  - The secret key never leaves the environment. It is never printed, not even
 *    a prefix of it. Diagnostics say "the key is not a dev key", never which key.
 *  - The minted URL is a live credential. It goes to stdout once, alone, and is
 *    never written to a file. Everything else — errors, progress — goes to stderr.
 */
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createClerkClient } from "@clerk/backend";

/** How long the minted session lives. The default 1800s logged an agent out mid-screenshot-run. */
export const DEFAULT_SESSION_SECONDS = 2 * 60 * 60;

/** The agent-browser session the cookies land in when --browser is passed bare. */
export const DEFAULT_BROWSER_SESSION = "fitcrew";

/**
 * A cold `next dev` compiles the page on its first request, which takes well over
 * a second — a short probe timeout reported "no server" while the server was fine.
 * Closed ports still fail instantly; the timeout only bites on a live, busy server.
 */
export const PROBE_TIMEOUT_MS = 30_000;

/** Ceiling on the CDP cookie import, so a wedged browser fails loudly instead of hanging. */
export const CDP_TIMEOUT_MS = 10_000;

/** Ports probed when neither --port nor PORT says otherwise. `next dev` lands on 3001 when 3000 is taken. */
export const CANDIDATE_PORTS = [3000, 3001, 3002, 3003, 3004, 3005];

/**
 * The only gate that matters: a `sk_test_` key is a Clerk *development* instance.
 * Anything else — `sk_live_`, a truncated paste, an empty env — is refused, and the
 * message never quotes the value.
 */
export function assertDevSecretKey(key: string | undefined): string {
  if (!key) {
    throw new Error(
      "CLERK_SECRET_KEY is not set. It lives in .env.local, which bun loads automatically — " +
        "do not cat it, do not pass it on the command line.",
    );
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run: CLERK_SECRET_KEY is not a development key (expected an sk_test_ prefix). " +
        "Agent Tasks mint real sessions; minting one against the production instance is never allowed.",
    );
  }
  return key;
}

/**
 * A responding port is not necessarily *our* port — 3000 is exactly the port some
 * other project is holding. Next dev answers with `x-powered-by: Next.js`, and even
 * a redirect to Clerk's sign-in keeps that header. The body check is the fallback
 * for the rare handler that strips it.
 */
export function looksLikeNextServer(headers: Headers, body: string): boolean {
  const poweredBy = headers.get("x-powered-by") ?? "";
  if (poweredBy.toLowerCase().includes("next.js")) return true;
  for (const name of ["x-nextjs-cache", "x-nextjs-prerender", "x-nextjs-stale-time"]) {
    if (headers.has(name)) return true;
  }
  return body.includes("/_next/");
}

/** `--port 3001` / `--identifier a@b.c` / `--revoke at_xxx`, plus bare `--headless`-style flags. */
export function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i++;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

/** A port is a port: 1-65535, integers only. Anything else is a typo we refuse rather than probe. */
export function parsePort(value: string | true | undefined): number | undefined {
  if (value === undefined || value === true) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${JSON.stringify(value)}`);
  }
  return port;
}

/**
 * `redirectUrl` must belong to an instance domain or Clerk rejects the ticket when
 * it is consumed — silently enough to look like "the login just didn't work".
 * localhost is a dev-instance domain; the port is the part that has to be right.
 */
export function buildRedirectUrl(port: number): string {
  return new URL("/", `http://localhost:${port}`).toString();
}

async function probePort(port: number, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      redirect: "manual",
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    return looksLikeNextServer(res.headers, body);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Explicit port wins and is trusted without probing (the dev server may still be
 * booting). Otherwise probe the candidates in order and take the first Next dev
 * server that answers. Never falls back to a silent 3000.
 */
export async function resolvePort(
  explicit: number | undefined,
  probe: (port: number) => Promise<boolean> = (port) => probePort(port, PROBE_TIMEOUT_MS),
  candidates: readonly number[] = CANDIDATE_PORTS,
): Promise<number> {
  if (explicit !== undefined) return explicit;
  for (const port of candidates) {
    if (await probe(port)) return port;
  }
  throw new Error(
    `No Next dev server answered on ports ${candidates.join(", ")}. ` +
      "Start it with `bun run dev`, or pass --port <n> / PORT=<n> if it listens elsewhere.",
  );
}

// --- consuming the task without a browser -------------------------------------
//
// Chrome cannot consume the task URL itself: Clerk's handshake sets its localhost
// cookies with `SameSite=None` and no `Secure`, and Chrome silently drops such
// cookies on http://localhost (curl doesn't — it ignores SameSite). The result is
// a handshake loop that ends signed-out. So the script plays curl: it follows the
// redirect chain itself with a SameSite-blind cookie jar, then imports the
// resulting localhost cookies into the browser rewritten as SameSite=Lax.

export interface JarCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  expires?: number;
}

/** Parse one Set-Cookie line the way a jar does: attributes we need, nothing more. */
export function parseSetCookie(line: string, requestHost: string): JarCookie | null {
  const [pair, ...attrs] = line.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const cookie: JarCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: requestHost,
    path: "/",
    httpOnly: false,
  };
  for (const attr of attrs) {
    const [rawName, ...rest] = attr.split("=");
    const name = rawName.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (name === "domain" && value) cookie.domain = value.replace(/^\./, "");
    else if (name === "path" && value) cookie.path = value;
    else if (name === "httponly") cookie.httpOnly = true;
    else if (name === "max-age" && value !== "") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) cookie.expires = Date.now() / 1000 + seconds;
    } else if (name === "expires" && cookie.expires === undefined) {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) cookie.expires = t / 1000;
    }
  }
  return cookie;
}

/** Apply a Set-Cookie to the jar: expired means delete — the handshake uses that. */
export function jarApply(jar: Map<string, JarCookie>, cookie: JarCookie): void {
  const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
  if (cookie.expires !== undefined && cookie.expires <= Date.now() / 1000) jar.delete(key);
  else jar.set(key, cookie);
}

/** The Cookie header for a host: domain-suffix match, like every jar since Netscape. */
export function cookieHeaderFor(jar: Map<string, JarCookie>, host: string): string {
  const parts: string[] = [];
  for (const c of jar.values()) {
    if (host === c.domain || host.endsWith(`.${c.domain}`)) parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
}

/**
 * Follow the task URL's redirect chain (FAPI → localhost handshake → localhost),
 * carrying cookies like curl does. Returns the jar; the caller filters localhost.
 */
export async function consumeTaskUrl(
  taskUrl: string,
  maxRedirects = 10,
): Promise<Map<string, JarCookie>> {
  const jar = new Map<string, JarCookie>();
  let url = new URL(taskUrl);
  for (let i = 0; i <= maxRedirects; i++) {
    const cookieHeader = cookieHeaderFor(jar, url.hostname);
    const res = await fetch(url, {
      redirect: "manual",
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    for (const line of res.headers.getSetCookie()) {
      const cookie = parseSetCookie(line, url.hostname);
      if (cookie) jarApply(jar, cookie);
    }
    await res.body?.cancel();
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      if (res.status >= 400) {
        throw new Error(`Consuming the task URL failed: HTTP ${res.status} from ${url.hostname}`);
      }
      return jar;
    }
    url = new URL(location, url);
  }
  throw new Error("Consuming the task URL failed: too many redirects.");
}

/** Run agent-browser and return stdout. Never pass credentials through here. */
async function agentBrowser(sessionName: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(
      "agent-browser",
      ["--session-name", sessionName, ...args],
      { timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`agent-browser ${args[0]} failed: ${stderr.trim() || error.message}`));
        else resolve(stdout.trim());
      },
    );
  });
}

/**
 * Import the localhost cookies over CDP, rewritten to SameSite=Lax so Chrome
 * keeps them on http://localhost. Values travel over the local CDP socket only.
 */
async function importCookies(cdpUrl: string, cookies: JarCookie[]): Promise<void> {
  const ws = new WebSocket(cdpUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Could not connect to the browser's CDP socket."));
  });
  // A socket that errors or closes after onopen but before the id:1 reply would
  // otherwise leave this pending forever, hanging the script with no message.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve, reject) => {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } };
      if (msg.id !== 1) return;
      if (msg.error) reject(new Error(`Cookie import failed: ${msg.error.message}`));
      else resolve();
    };
    ws.onerror = () => reject(new Error("The browser's CDP socket errored during the cookie import."));
    ws.onclose = () => reject(new Error("The browser's CDP socket closed before the cookie import finished."));
    timer = setTimeout(
      () => reject(new Error("Timed out waiting for the browser to accept the imported cookies.")),
      CDP_TIMEOUT_MS,
    );
  });
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Storage.setCookies",
      params: {
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: "localhost",
          path: c.path,
          httpOnly: c.httpOnly,
          secure: false,
          sameSite: "Lax",
          ...(c.expires !== undefined ? { expires: Math.floor(c.expires) } : {}),
        })),
      },
    }),
  );
  try {
    await done;
  } finally {
    clearTimeout(timer);
    ws.close();
  }
}

/** Poll until clerk-js has loaded and reports a user. Returns the email, or null. */
async function waitForSignedIn(sessionName: string, timeoutMs = 20_000): Promise<string | null> {
  const probe =
    "window.Clerk && window.Clerk.loaded ? (window.Clerk.user ? 'in:' + (window.Clerk.user.primaryEmailAddress && window.Clerk.user.primaryEmailAddress.emailAddress) : 'out') : 'loading'";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await agentBrowser(sessionName, ["eval", probe]);
    const match = result.match(/in:([^"'\s]+)/);
    if (match) return match[1];
    // Deliberately no short-circuit on 'out': clerk-js can report loaded with a
    // null user for a beat while it resolves the session from the imported
    // cookie. Bailing on the first probe would call a good import signed-out.
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const secretKey = assertDevSecretKey(process.env.CLERK_SECRET_KEY);
  const clerk = createClerkClient({ secretKey });

  const revoke = args.revoke;
  if (revoke) {
    if (revoke === true) throw new Error("--revoke needs an Agent Task id, e.g. --revoke at_xxx");
    await clerk.agentTasks.revoke(revoke);
    process.stderr.write(`Revoked Agent Task ${revoke}\n`);
    return;
  }

  const identifier =
    (typeof args.identifier === "string" ? args.identifier : undefined) ??
    process.env.AGENT_LOGIN_IDENTIFIER;
  if (!identifier) {
    throw new Error(
      "No user to sign in as. Set AGENT_LOGIN_IDENTIFIER to your own email on the Clerk dev instance, or pass --identifier <email>.",
    );
  }

  const explicitPort = parsePort(args.port) ?? parsePort(process.env.PORT);
  const port = await resolvePort(explicitPort);
  const redirectUrl = buildRedirectUrl(port);
  const sessionMaxDurationInSeconds = DEFAULT_SESSION_SECONDS;

  const task = await clerk.agentTasks.create({
    onBehalfOf: { identifier },
    permissions: "*",
    agentName: "fitcrew-agent",
    taskDescription: "Automated browser session for screenshots and QA on a local dev server.",
    redirectUrl,
    sessionMaxDurationInSeconds,
  });

  // stderr: safe to read, safe to paste. It says where the session lands and how to
  // revoke it, and deliberately says nothing about the credential.
  process.stderr.write(
    `Agent Task ${task.agentTaskId} → ${redirectUrl} (${sessionMaxDurationInSeconds}s)\n` +
      `Revoke when done: bun run agent-login -- --revoke ${task.agentTaskId}\n`,
  );

  if (!args.browser) {
    // stdout: the credential, alone, once.
    process.stdout.write(`${task.url}\n`);
    return;
  }

  // --browser: sign the agent-browser session in directly. The task URL never
  // leaves this process — Chrome can't consume it anyway (see consumeTaskUrl).
  const sessionName = typeof args.browser === "string" ? args.browser : DEFAULT_BROWSER_SESSION;
  const jar = await consumeTaskUrl(task.url);
  const localhostCookies = [...jar.values()].filter((c) => c.domain === "localhost");
  if (!localhostCookies.some((c) => c.name.startsWith("__session"))) {
    throw new Error(
      "The task URL was consumed but no __session cookie came back for localhost — " +
        "check that the redirect URL's port serves this app and the identifier matches a dev user.",
    );
  }
  process.stderr.write(`Ticket consumed; ${localhostCookies.length} localhost cookies to import.\n`);

  await agentBrowser(sessionName, ["open", "about:blank"]);
  // `agent-browser get cdp-url` already answers a ws:// URL; no rewriting needed.
  const cdpUrl = await agentBrowser(sessionName, ["get", "cdp-url"]);
  await importCookies(cdpUrl, localhostCookies);
  await agentBrowser(sessionName, ["open", redirectUrl]);

  const email = await waitForSignedIn(sessionName);
  if (!email) {
    throw new Error(
      `Cookies imported but the page still reports signed-out in session "${sessionName}".`,
    );
  }
  process.stderr.write(`Signed in as ${email} (agent-browser session "${sessionName}").\n`);

  // The ticket is spent; revoking the task is cleanup, and Clerk answers Bad
  // Request for an already-consumed task — that's fine, ignore it.
  await clerk.agentTasks.revoke(task.agentTaskId).catch(() => {});
}

// Only run when invoked directly — the self-check imports this file for its pure parts.
const entry = process.argv[1];
if (entry && resolvePath(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
