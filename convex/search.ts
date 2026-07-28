/**
 * Web search through Basile's self-hosted SearXNG.
 *
 * No Convex `action` wrapper: `fetch` works in the default runtime, and the
 * coach's tool already runs inside an action.
 */

/** ponytail: 5 results / 300 chars each. Raise both if the coach's answers come out thin. */
const MAX_RESULTS = 5;
const MAX_SNIPPET = 300;

const TIMEOUT_MS = 8000;

export type SearchHit = { title: string; url: string; snippet: string };

/** Exported for the self-check: env read + trailing-slash normalisation. */
export function searchUrl(base: string, query: string) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    language: "fr",
    safesearch: "1",
    categories: "general",
  });
  return `${base.replace(/\/+$/, "")}/search?${params}`;
}

/** Exported for the self-check. Everything but title/url/snippet is context we pay for and never read. */
export function normalizeResults(payload: unknown): SearchHit[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is { title: string; url: string; content?: unknown } => {
      const hit = r as { title?: unknown; url?: unknown };
      return typeof hit?.title === "string" && typeof hit?.url === "string";
    })
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: typeof r.content === "string" ? r.content.slice(0, MAX_SNIPPET) : "",
    }));
}

export async function searchWeb(query: string): Promise<SearchHit[]> {
  const base = process.env.SEARXNG_URL;
  if (!base) throw new Error("SEARXNG_URL is not set");
  const token = process.env.SEARXNG_TOKEN;

  const res = await fetch(searchUrl(base, query), {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // A self-hosted box that hangs must not hang the coach's turn.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // SearXNG serves JSON only if `search.formats: [json]` is in settings.yml, and
  // its rate limiter blocks non-browser clients by default — so the first
  // failure is almost always a 403 or an HTML page, and it's configuration, not
  // code. Say that instead of letting JSON.parse throw something unreadable.
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("json")) {
    throw new Error(
      `SearXNG a répondu ${res.status} (${contentType || "sans content-type"}). ` +
        `Vérifie que \`search.formats\` inclut \`json\` dans settings.yml et que le limiteur ` +
        `de requêtes (\`server.limiter\`) est désactivé pour ce client.`,
    );
  }

  return normalizeResults(await res.json());
}
