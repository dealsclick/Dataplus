const assert = require("node:assert/strict");
const test = require("node:test");
const postgres = require("../db");

const {
  familyProductsForWarehouse,
  importedOrderProductMatch,
  orderIdentityPriority,
  outboundInventoryProductForWarehouse,
  routingSupplierOffersForFamily,
  selectImportedOrderProduct,
  supplierSourcingPriority,
} = require("../server");

const vendors = [
  { id: "true-value", name: "True Value", purchaseOrderRules: { sourcingPriority: 1 } },
  { id: "rjs", name: "RJS", purchaseOrderRules: { sourcingPriority: 2 } },
  { id: "do-it-best", name: "Do It Best", purchaseOrderRules: { sourcingPriority: 3 } },
];

test("manufacturer SKU resolves to a managed supplier SKU instead of an order-created draft", () => {
  const importedSku = "48-32-4013";
  const draft = {
    id: "draft-product",
    sku: importedSku,
    supplier: "Unknown supplier",
    systemCreatedFromOrderImport: true,
    catalogAttentionRequired: true,
  };
  const trueValue = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    mfrPartNumber: "48-32-4013",
    active: true,
  };
  const rjs = {
    id: "rjs-product",
    sku: "BUS48324013RJS",
    supplier: "RJS",
    mfrPartNumber: "48324013",
    active: true,
  };

  assert.equal(importedOrderProductMatch(trueValue, importedSku).mode, "manufacturer-part-number");
  const selected = selectImportedOrderProduct({ vendors }, [draft, rjs, trueValue], importedSku);
  assert.equal(selected.product.id, "tv-product");
  assert.equal(selected.match.mode, "manufacturer-part-number");
});

test("an explicit order UPC wins over a literal supplier SKU", () => {
  const supplierSku = {
    id: "supplier-product",
    sku: "SUPPLIER-123",
    supplier: "RJS",
    barcode: "000111222333",
    active: true,
  };
  const upcMatch = {
    id: "upc-product",
    sku: "BUS-UPC-MATCH",
    supplier: "True Value",
    barcode: "0045242000001",
    active: true,
  };

  const selected = selectImportedOrderProduct({ vendors }, [supplierSku, upcMatch], "SUPPLIER-123", { upc: "0045242000001" });
  assert.equal(selected.product.id, "upc-product");
  assert.equal(selected.match.mode, "upc");
  assert.equal(orderIdentityPriority(selected.match), 1);
});

test("an order line can resolve by UPC when the channel omitted its SKU", () => {
  const upcMatch = {
    id: "upc-product",
    sku: "BUS-UPC-MATCH",
    supplier: "True Value",
    barcode: "0045242000001",
    active: true,
  };

  const selected = selectImportedOrderProduct({ vendors }, [upcMatch], "", { upc: "0045242000001" });
  assert.equal(selected.product.id, "upc-product");
  assert.equal(selected.match.mode, "upc");
});

test("physical family allocation skips an empty preferred supplier and uses stocked related inventory", () => {
  const warehouse = { id: "si2", name: "Staten Island 2" };
  const trueValue = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    cost: 20,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 0, reserved: 0 }],
  };
  const rjs = {
    id: "rjs-product",
    sku: "BUS48324013RJS",
    supplier: "RJS",
    cost: 22,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 4, reserved: 1 }],
  };

  const ranked = familyProductsForWarehouse({ vendors }, [trueValue, rjs], warehouse, {});
  assert.equal(ranked[0].product.id, "rjs-product");
  assert.equal(ranked[0].available, 3);
  assert.equal(supplierSourcingPriority({ vendors }, ranked[0].product), 2);
});

test("supplier priority wins before cost when related suppliers are both in stock", () => {
  const warehouse = { id: "si2", name: "Staten Island 2" };
  const trueValue = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    cost: 30,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 2, reserved: 0 }],
  };
  const rjs = {
    id: "rjs-product",
    sku: "BUS48324013RJS",
    supplier: "RJS",
    cost: 20,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 2, reserved: 0 }],
  };

  const ranked = familyProductsForWarehouse({ vendors }, [rjs, trueValue], warehouse, {});
  assert.equal(ranked[0].product.id, "tv-product");
  assert.equal(ranked[0].priority, 1);
});

test("UPC-related physical stock wins before MFR-related stock and supplier priority", () => {
  const warehouse = { id: "si2", name: "Staten Island 2" };
  const trueValue = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    cost: 30,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 2, reserved: 0 }],
  };
  const rjs = {
    id: "rjs-product",
    sku: "BUS48324013RJS",
    supplier: "RJS",
    cost: 20,
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 2, reserved: 0 }],
  };
  const identityMatches = new Map([
    ["tv-product", { mode: "manufacturer-part-number", priority: 2 }],
    ["rjs-product", { mode: "upc", priority: 1 }],
  ]);

  const ranked = familyProductsForWarehouse({ vendors }, [trueValue, rjs], warehouse, {}, identityMatches);
  assert.equal(ranked[0].product.id, "rjs-product");
  assert.equal(ranked[0].identityPriority, 1);
});

test("supplier routing keeps identifier confidence ahead of configured supplier priority", () => {
  const trueValue = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    vendorSku: "142423",
    cost: 20,
    qty: 10,
  };
  const rjs = {
    id: "rjs-product",
    sku: "BUS48324013RJS",
    supplier: "RJS",
    vendorSku: "48324013",
    cost: 22,
    qty: 10,
  };
  const identityMatches = new Map([
    ["tv-product", { mode: "manufacturer-part-number", priority: 2 }],
    ["rjs-product", { mode: "upc", priority: 1 }],
  ]);

  const offers = routingSupplierOffersForFamily({ vendors }, [trueValue, rjs], { sku: "48-32-4013" }, identityMatches);
  assert.equal(offers[0].vendorName, "RJS");
  assert.equal(offers[0].identityMatchMode, "upc");
});

test("outbound can consume stock reserved for the same order line", async () => {
  const warehouse = { id: "si2", name: "Staten Island 2" };
  const product = {
    id: "tv-product",
    sku: "BUS142423TRV",
    supplier: "True Value",
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 1, reserved: 1 }],
  };
  const order = {
    fulfillmentRoutes: [{ type: "warehouse", status: "allocated", lineIndex: 0, warehouseId: "si2", productId: "tv-product" }],
  };

  const originalSimilarity = postgres.readProductSimilarityGroup;
  const originalReadProducts = postgres.readProductsByKeys;
  postgres.readProductSimilarityGroup = async () => ({
    productId: product.id,
    sku: product.sku,
    members: [{ productId: product.id, sku: product.sku, isCurrent: true, matchTypes: ["current"] }],
  });
  postgres.readProductsByKeys = async () => [structuredClone(product)];
  try {
    const result = await outboundInventoryProductForWarehouse({ vendors }, product, warehouse, { order, target: { lineIndex: 0 } });
    assert.equal(result.selected.product.id, product.id);
    assert.equal(result.selected.available, 1);
    assert.equal(result.selected.consumesReservation, true);
  } finally {
    postgres.readProductSimilarityGroup = originalSimilarity;
    postgres.readProductsByKeys = originalReadProducts;
  }
});
