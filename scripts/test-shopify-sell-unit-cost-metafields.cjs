const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../server"), "utf8");
const start = source.indexOf("function shopifyVariantCreateMetafields(");
const end = source.indexOf("\nfunction shopifyExistingVariantMatch(", start);
const shopifyVariantCreateMetafields = vm.runInNewContext(
  `${source.slice(start, end)}\nshopifyVariantCreateMetafields`,
  {
    sourceTextValue: (value = "") => String(value ?? "").trim(),
    shopifyMoneyMetafieldValue: (value) => Number(value) > 0
      ? JSON.stringify({ amount: Number(value).toFixed(2), currency_code: "USD" })
      : ""
  }
);

test("direct Shopify variant creation sends UOM and Money cost metafields", () => {
  const metafields = shopifyVariantCreateMetafields({
    optionValue: "Case of 4",
    uom: "CA",
    uomQty: 4,
    unitCost: 12.5
  });

  assert.deepEqual(JSON.parse(JSON.stringify(metafields)), [
    { namespace: "custom", key: "purchase_unit", type: "single_line_text_field", value: "Case of 4" },
    { namespace: "custom", key: "uom", type: "single_line_text_field", value: "CA" },
    { namespace: "custom", key: "uom_qty", type: "number_integer", value: "4" },
    { namespace: "custom", key: "sell_unit_cost", type: "money", value: '{"amount":"12.50","currency_code":"USD"}' }
  ]);
});

test("blank optional values are omitted and quantity remains valid", () => {
  const metafields = shopifyVariantCreateMetafields({ uomQty: 0, unitCost: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(metafields)), [
    { namespace: "custom", key: "uom_qty", type: "number_integer", value: "1" }
  ]);
});
