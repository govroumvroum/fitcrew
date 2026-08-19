/**
 * Web search through Basile's self-hosted SearXNG.
 *
 * No Convex `action` wrapper: `fetch` works in the default runtime, and the
 * coach's tool already runs inside an action.
 */

/** ponytail: 5 results / 300 chars each. Raise both if the coach's answers come out thin. */
const MAX_RESULTS = 5;
const MAX_SNIPPET = 300;

/** ponytail: 8000 chars of page envoyés au modèle. À monter si ses réponses sortent maigres. */
const MAX_PAGE_CHARS = 8000;
/** Garde-fou mémoire : on ne passe jamais 5 Mo de HTML à une regex. */
const MAX_RAW_CHARS = 400_000;

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

// ---------------------------------------------------------------------------
// Lecture d'une page
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Les seules entités qui reviennent vraiment dans du texte d'article. */
const decodeEntities = (s: string) =>
  s
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/**
 * Exported for the self-check.
 *
 * ponytail: c'est un strip de balises à la regex, pas un parse DOM. Les repères
 * de page balisés en HTML5 sautent, mais un menu en <div class="sidebar"> passe
 * avec le reste. Si ça devient gênant, l'étape d'après est readability sur un
 * vrai DOM, pas une regex de plus.
 */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const text = decodeEntities(
    html
      // Contenu compris : un <script> vidé de ses balises, c'est du JS dans le texte.
      // Les repères de page partent avec : mesuré sur 5 pages, le corps de
      // l'article commence 3 à 13 fois plus tôt sans eux (mayoclinic : char
      // 3312 → 244), et rien ne se perd — un site qui balise son menu en
      // <div class="nav"> passe simplement au travers.
      .replace(
        /<(script|style|noscript|svg|head|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      )
      // Les fins de bloc deviennent des retours à la ligne, sinon tout l'article
      // arrive au modèle en un seul paragraphe.
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text: text.slice(0, MAX_PAGE_CHARS) };
}

/**
 * Un vrai Chrome, en-têtes comprises.
 *
 * Un User-Agent inconnu se fait jeter par la moitié des sites de santé : mesuré
 * sur 7 pages, examine.com répond 429 et mayoclinic.org 403. Le seul UA suffit
 * pour examine ; mayoclinic ne cède qu'avec les `Sec-Fetch-*` et `Sec-Ch-Ua`,
 * d'où le jeu complet plutôt qu'une ligne. Ce qui est derrière un challenge
 * Cloudflare (nsca.com) reste fermé de toute façon — le coach le dira.
 *
 * ponytail: à figer de temps en temps sur une version de Chrome récente ; un UA
 * qui vieillit finit par se faire filtrer comme un bot.
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "Sec-Ch-Ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/** Ouvre un lien et en renvoie le texte. Même conventions que `searchWeb`. */
export async function fetchPage(
  url: string,
): Promise<{ url: string; title: string; text: string }> {
  // L'URL vient du modèle : c'est une frontière de confiance. `file:`, `data:`
  // et compagnie s'arrêtent ici, avant tout appel réseau.
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`« ${url} » n'est pas une URL valide.`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Je ne sais ouvrir que des liens http(s), pas du « ${protocol} ».`);
  }

  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: "follow",
    // Une page qui ne répond pas ne doit pas figer le tour du coach.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `La page a répondu ${res.status}. Elle est peut-être hors ligne, ou elle bloque les robots.`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("html");
  if (!isHtml && !contentType.includes("text/plain") && !contentType.includes("json")) {
    throw new Error(
      `Cette page est du ${contentType || "contenu sans content-type"} : je ne sais lire que du texte.`,
    );
  }

  const raw = (await res.text()).slice(0, MAX_RAW_CHARS);
  if (!isHtml) return { url, title: "", text: raw.trim().slice(0, MAX_PAGE_CHARS) };
  return { url, ...htmlToText(raw) };
}
