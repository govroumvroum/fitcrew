/** Self-check for the pure parts of the search tool. Run: `bun convex/search.check.ts` */
import assert from "node:assert/strict";
import { normalizeResults, searchUrl } from "./search";

// Trailing slash is the whole point: `bunx convex env set` will get one sooner or later.
assert.equal(
  searchUrl("https://searx.example.com", "créatine"),
  "https://searx.example.com/search?q=cr%C3%A9atine&format=json&language=fr&safesearch=1&categories=general",
);
assert.equal(
  searchUrl("https://searx.example.com/", "créatine"),
  searchUrl("https://searx.example.com", "créatine"),
);
assert.equal(
  searchUrl("https://searx.example.com///", "créatine"),
  searchUrl("https://searx.example.com", "créatine"),
);

const payload = {
  query: "créatine",
  results: Array.from({ length: 8 }, (_, i) => ({
    title: `Résultat ${i}`,
    url: `https://example.com/${i}`,
    content: "x".repeat(500),
    engine: "duckduckgo",
    score: 1.5,
    thumbnail: "https://example.com/thumb.png",
  })),
};

const hits = normalizeResults(payload);
assert.equal(hits.length, 5); // capped
assert.equal(hits[0].snippet.length, 300); // truncated
assert.deepEqual(Object.keys(hits[0]), ["title", "url", "snippet"]); // nothing else reaches the model

// Missing / malformed payloads return nothing rather than throwing mid-turn.
assert.deepEqual(normalizeResults({}), []);
assert.deepEqual(normalizeResults(null), []);
assert.deepEqual(normalizeResults({ results: "nope" }), []);
assert.deepEqual(normalizeResults({ results: [{ url: "https://example.com" }] }), []);
assert.deepEqual(normalizeResults({ results: [{ title: "T", url: "https://e.com" }] }), [
  { title: "T", url: "https://e.com", snippet: "" },
]);

console.log("search url + normalisation ok");
