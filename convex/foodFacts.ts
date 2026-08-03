/**
 * Nutrition facts from Open Food Facts — the structured source issue #31 asks
 * for, so a logged industrial product carries real per-100 g numbers instead of
 * the model's guess.
 *
 * No SDK (`openfoodfacts-js`) and no Convex `action` wrapper: this is two GET
 * requests, `fetch` works in the default runtime, and the Chef's tools already
 * run inside an action. Same call it as `convex/search.ts`.
 *
 * Two different hosts on purpose:
 * - text search goes to search-a-licious (`search.openfoodfacts.org`), because
 *   the legacy `/cgi/search.pl` answers 503 and `/api/v2/search` ignores
 *   `search_terms` outright (it returned the whole 4.6 M-product count);
 * - barcode lookup goes to the `fr.` product API, which is the documented and
 *   stable path for one known code.
 */

/** ponytail: 5 hits. A phone list nobody scrolls past five of. */
const MAX_RESULTS = 5;
const TIMEOUT_MS = 6000;

/** Open Food Facts asks every client to identify itself; anonymous callers get blocked. */
const USER_AGENT = "FitCrew/0.1 (https://fitcrew.vercel.app)";

/** Only what the Chef and the food log actually read. Every extra field is context we pay for. */
const FIELDS = "code,product_name,brands,serving_size,nutriments";

export type FoodFact = {
  code: string;
  name: string;
  brand?: string;
  /** As printed on the pack ("125 g", "1 pot"). Free text — never parsed. */
  servingSize?: string;
  /** Per 100 g / 100 ml, which is the only basis Open Food Facts fills reliably. */
  per100g: { calories: number; protein: number; carbs: number; fat: number };
};

// A crowdsourced database has typos, and a gram figure over 100 per 100 g is one
// by definition. Energy above 900 kcal/100 g beats pure fat, so that's a typo too.
const LIMITS = { calories: 900, protein: 100, carbs: 100, fat: 100 } as const;

function macro(raw: unknown, key: keyof typeof LIMITS): number | null {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > LIMITS[key]) return null;
  // One decimal: the pack prints "8,9 g" and rounding it to 9 loses nothing but
  // pretending to three decimals (what the API returns) is false precision.
  return Math.round(n * 10) / 10;
}

/**
 * One API product -> what we're willing to show, or null if it carries no usable
 * energy value. Exported for the self-check in `foodFacts.check.ts`.
 *
 * `brands` comes back as a string from the product API and as an array from
 * search-a-licious — same database, two serialisations, so both are handled here
 * rather than at each call site.
 */
export function normalizeProduct(raw: unknown): FoodFact | null {
  const p = raw as {
    code?: unknown;
    product_name?: unknown;
    brands?: unknown;
    serving_size?: unknown;
    nutriments?: Record<string, unknown>;
  } | null;
  if (!p) return null;

  const code = typeof p.code === "string" ? p.code : String(p.code ?? "");
  const name = typeof p.product_name === "string" ? p.product_name.trim() : "";
  if (!code || !name) return null;

  const n = p.nutriments ?? {};
  const calories = macro(n["energy-kcal_100g"], "calories");
  // Energy is the one field worth refusing on: without it there is nothing to
  // add to a daily total, and a product row of three zeros reads as a real
  // measurement rather than as missing data.
  if (calories === null) return null;

  const brand = Array.isArray(p.brands)
    ? p.brands.find((b): b is string => typeof b === "string" && b.trim() !== "")?.trim()
    : typeof p.brands === "string" && p.brands.trim() !== ""
      ? p.brands.split(",")[0].trim()
      : undefined;

  const servingSize =
    typeof p.serving_size === "string" && p.serving_size.trim() !== ""
      ? p.serving_size.trim().slice(0, 40)
      : undefined;

  return {
    code,
    name: name.slice(0, 120),
    ...(brand ? { brand } : {}),
    ...(servingSize ? { servingSize } : {}),
    per100g: {
      calories,
      // Missing macros fall back to 0, unlike energy above: a pack that lists
      // kcal but not protein is common, and 0 with the calories visible is
      // honest enough for a log line the user can correct.
      protein: macro(n.proteins_100g, "protein") ?? 0,
      carbs: macro(n.carbohydrates_100g, "carbs") ?? 0,
      fat: macro(n.fat_100g, "fat") ?? 0,
    },
  };
}

/** Exported for the self-check. */
export function searchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    lc: "fr",
    page_size: String(MAX_RESULTS),
    fields: FIELDS,
  });
  return `https://search.openfoodfacts.org/search?${params}`;
}

/** Exported for the self-check. A barcode is digits only — anything else is not one. */
export function barcodeUrl(code: string) {
  return `https://fr.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=${FIELDS}`;
}

export function isBarcode(code: string) {
  return /^\d{8,14}$/.test(code.trim());
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    // A public API having a bad day must not hang the Chef's turn.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Open Food Facts a répondu ${res.status}`);
  return await res.json();
}

/** Free-text product search, most relevant first. Empty array is a valid answer. */
export async function searchFood(query: string): Promise<FoodFact[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const payload = (await getJson(searchUrl(trimmed))) as { hits?: unknown };
  if (!Array.isArray(payload.hits)) return [];
  return payload.hits.map(normalizeProduct).filter((p): p is FoodFact => p !== null);
}

/** One product by barcode — what a label photo gives us. `null` means unknown code. */
export async function foodByBarcode(code: string): Promise<FoodFact | null> {
  if (!isBarcode(code)) return null;
  const payload = (await getJson(barcodeUrl(code.trim()))) as { product?: unknown };
  return normalizeProduct(payload.product);
}
