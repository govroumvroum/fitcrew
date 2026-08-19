/** Self-check for the pure parts of the search tool. Run: `bun convex/search.check.ts` */
import assert from "node:assert/strict";
import { fetchPage, htmlToText, normalizeResults, searchUrl } from "./search";

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

// --- lecture d'une page ----------------------------------------------------

const page = htmlToText(`
<html>
  <head>
    <title>Créatine &amp; dose</title>
    <style>body { color: red }</style>
  </head>
  <body>
    <script>window.tracker = "ne doit pas sortir";</script>
    <noscript>pas de js</noscript>
    <nav><a href="/">Accueil</a></nav>
    <header>Bandeau du site</header>
    <aside>Articles connexes</aside>
    <h1>Dose</h1>
    <p>3 &agrave; 5&nbsp;g par jour.</p>
    <p>Pas de phase de charge &#8212; c&#39;est inutile.</p>
    <svg><path d="M0 0 L1 1"/></svg>
    <footer>Mentions légales</footer>
  </body>
</html>`);

assert.equal(page.title, "Créatine & dose"); // titre extrait et entités décodées
assert.ok(!page.text.includes("tracker")); // <script> emporte son contenu
assert.ok(!page.text.includes("color: red")); // <style> aussi
assert.ok(!page.text.includes("pas de js")); // <noscript> aussi
assert.ok(!page.text.includes("M0 0")); // <svg> aussi
// Les repères de page : c'est ce qui mangeait le budget avant d'arriver à l'article.
assert.ok(!page.text.includes("Accueil")); // <nav>
assert.ok(!page.text.includes("Bandeau")); // <header>
assert.ok(!page.text.includes("connexes")); // <aside>
assert.ok(!page.text.includes("Mentions")); // <footer>
assert.ok(!page.text.includes("Créatine & dose")); // le <head> ne descend pas dans le texte
assert.ok(!page.text.includes("<")); // plus une seule balise
assert.equal(
  page.text,
  "Dose\n\n3 &agrave; 5 g par jour.\n\nPas de phase de charge — c'est inutile.",
);
// ^ les paragraphes survivent en retours à la ligne, `&nbsp;` `&#8212;` `&#39;` décodés.
// `&agrave;` reste telle quelle : hors du lot d'entités qui comptent, et une
// entité affichée brute vaut mieux qu'un mot avalé.
assert.ok(!page.text.includes("\n\n\n")); // les lignes vides en série sont écrasées

// Troncature : 20 000 caractères de texte utile ne partent pas entiers au modèle.
const long = htmlToText(`<p>${"x".repeat(20_000)}</p>`);
assert.equal(long.text.length, 8000);
assert.equal(long.title, "");

// HTML cassé ou vide : on rend ce qu'on peut, on ne jette pas.
assert.deepEqual(htmlToText(""), { title: "", text: "" });
assert.deepEqual(htmlToText("   \n  "), { title: "", text: "" });
assert.equal(htmlToText("<p>coupé au milieu <b>gras").text, "coupé au milieu gras");
assert.equal(htmlToText("<title>sans fermeture").title, "");
assert.equal(
  htmlToText("texte nu, sans la moindre balise").text,
  "texte nu, sans la moindre balise",
);

// Frontière de confiance : le garde-fou protocole passe avant le réseau, donc
// cet appel ne sort pas de la machine.
await assert.rejects(fetchPage("file:///etc/passwd"), /http\(s\)/);
await assert.rejects(fetchPage("pas une url"), /pas une URL valide/);

console.log("search url + normalisation + lecture de page ok");
