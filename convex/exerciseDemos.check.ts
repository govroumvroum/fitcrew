/** Self-check for the slug logic. Run: `bun convex/exerciseDemos.check.ts` */
import assert from "node:assert/strict";
import { candidateSlugs, slugify } from "./exerciseDemos";

// Accents are the whole point: the coach types them, the dataset never does.
assert.equal(slugify("Développé couché"), "developpecouche");
assert.equal(slugify("developpe couche"), "developpecouche");
assert.equal(slugify("DEVELOPPÉ-COUCHÉ"), "developpecouche");
assert.equal(slugify("Élévations latérales"), "elevationslaterales");
assert.equal(slugify("Tractions (pronation)"), "tractionspronation");

// Punctuation and spacing collapse, so the API's own names round-trip.
assert.equal(slugify("assisted hanging knee raise"), "assistedhangingkneeraise");
assert.equal(slugify("  Curl   marteau  "), "curlmarteau");
assert.equal(slugify("45° back extension"), "45backextension");

// Nothing left after stripping → empty, which matches no index row. Fine.
assert.equal(slugify("—"), "");

// Plurals: one rule, tried second, so "burpees" can still find "burpee".
assert.deepEqual(candidateSlugs("Burpees"), ["burpees", "burpee"]);
assert.deepEqual(candidateSlugs("Squat"), ["squat"]);
assert.deepEqual(candidateSlugs("Dips"), ["dips", "dip"]);

console.log("exerciseDemos slugs ok");
