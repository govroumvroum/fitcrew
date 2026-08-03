/** Self-check for the Open Food Facts boundary. Run: `bun convex/foodFacts.check.ts` */
import assert from "node:assert/strict";
import { barcodeUrl, isBarcode, normalizeProduct, searchUrl } from "./foodFacts";

// The point of the module: a real product row becomes per-100 g numbers we can
// add to a daily total. Shape copied from a live `search.openfoodfacts.org` hit —
// note `brands` as an array and the API's false 16-decimal precision.
assert.deepEqual(
  normalizeProduct({
    code: "3033490004743",
    product_name: "Skyr nature",
    brands: ["Carrefour sensation"],
    serving_size: "140 g",
    nutriments: {
      "energy-kcal_100g": 52.857142857142854,
      proteins_100g: 8.899999618530273,
      carbohydrates_100g: 3.9,
      fat_100g: 0.2,
    },
  }),
  {
    code: "3033490004743",
    name: "Skyr nature",
    brand: "Carrefour sensation",
    servingSize: "140 g",
    per100g: { calories: 52.9, protein: 8.9, carbs: 3.9, fat: 0.2 },
  },
);

// The product API serialises `brands` as a comma-separated string instead. Same
// database, two shapes — only the first brand is kept either way.
assert.equal(
  normalizeProduct({
    code: "1",
    product_name: "Yaourt",
    brands: "Danone, Danone France",
    nutriments: { "energy-kcal_100g": 60 },
  })?.brand,
  "Danone",
);

// A pack that prints kcal but no macros is common: 0 next to visible calories is
// honest, refusing the whole product is not.
assert.deepEqual(
  normalizeProduct({ code: "2", product_name: "Truc", nutriments: { "energy-kcal_100g": 100 } })
    ?.per100g,
  { calories: 100, protein: 0, carbs: 0, fat: 0 },
);

// No energy = nothing to add to a total, so the row is dropped rather than shown
// as a measured zero.
assert.equal(normalizeProduct({ code: "3", product_name: "Vide", nutriments: {} }), null);
// Same for a product with no name, and for a missing product (unknown barcode).
assert.equal(normalizeProduct({ code: "4", nutriments: { "energy-kcal_100g": 10 } }), null);
assert.equal(normalizeProduct(undefined), null);

// Crowdsourced typos: 900 g of protein per 100 g, or negative energy. The absurd
// field is dropped (protein -> 0), an absurd energy drops the product.
assert.equal(
  normalizeProduct({
    code: "5",
    product_name: "Typo",
    nutriments: { "energy-kcal_100g": 200, proteins_100g: 900 },
  })?.per100g.protein,
  0,
);
assert.equal(
  normalizeProduct({ code: "6", product_name: "Typo", nutriments: { "energy-kcal_100g": -5 } }),
  null,
);

// Search hits the endpoint that actually filters, in French, and asks only for
// the fields we read. `/cgi/search.pl` answers 503 and `/api/v2/search` ignores
// the query — regressing to either would silently return the whole database.
const url = searchUrl("skyr nature");
assert.ok(url.startsWith("https://search.openfoodfacts.org/search?"));
assert.ok(url.includes("q=skyr+nature"));
assert.ok(url.includes("lc=fr"));
assert.ok(!url.includes("nutrition_grade")); // no field we never display

// A barcode is digits only: a product name reaching the barcode path would 404.
assert.ok(isBarcode("3033490004743"));
assert.ok(isBarcode(" 20221126 "));
assert.ok(!isBarcode("skyr"));
assert.ok(!isBarcode("303349000474X"));
assert.ok(!isBarcode("1234567")); // 7 digits is below EAN-8
assert.ok(
  barcodeUrl("3033490004743").endsWith(
    "product/3033490004743?fields=" + "code,product_name,brands,serving_size,nutriments",
  ),
);

console.log("open food facts boundary ok");
