const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  addVeeqoCustomsFields,
  normalizeCountryOfManufacture,
  normalizeVeeqoAddressCountry,
  productCountryOfOrigin
} = require("../lib/veeqo-customs");

assert.equal(normalizeVeeqoAddressCountry("PR"), "US");
assert.equal(normalizeVeeqoAddressCountry("Puerto Rico"), "US");
assert.equal(normalizeCountryOfManufacture("United States"), "US");
assert.equal(normalizeCountryOfManufacture("China"), "CN");
assert.equal(normalizeCountryOfManufacture("not a country"), "");

assert.equal(productCountryOfOrigin({ countryOfOrigin: "US" }), "US");
assert.equal(productCountryOfOrigin({ original: { country_of_origin: "China" } }), "CN");
assert.equal(productCountryOfOrigin({ productManagerFields: { country_of_origin: { value: "US" } } }), "US");

assert.deepEqual(
  addVeeqoCustomsFields(
    { sku: "BUS211847TRV", title: "3-in-One 101456 3 In One 3OZ Motor Oil", quantity: 1 },
    { countryOfOrigin: "US", hs_tariff_number: "2710.19" }
  ),
  {
    sku: "BUS211847TRV",
    title: "3-in-One 101456 3 In One 3OZ Motor Oil",
    quantity: 1,
    description: "3-in-One 101456 3 In One 3OZ Motor Oil".slice(0, 40),
    country_of_manufacture: "US",
    tariff_code: "2710.19"
  }
);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.match(
  serverSource,
  /readProductsByKeys\(missingSkus, \{ includeMarketplaceIds: false, includeSourceEnrichment: true \}\)/,
  "manual and automatic Veeqo rate requests must hydrate source enrichment fields"
);
assert.match(
  serverSource,
  /readProductsByKeys\(lines\.map\(\(line\) => line\.sku\)\.filter\(Boolean\), \{ includeMarketplaceIds: false, includeSourceEnrichment: true \}\)/,
  "fulfillment batch rate and purchase requests must hydrate source enrichment fields"
);

console.log("Veeqo customs tests passed.");
