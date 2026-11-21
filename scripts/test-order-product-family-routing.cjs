const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postgres = require("../db");

const {
  familyProductsForWarehouse,
  importedOrderProductMatch,
  orderLineWithDiscoveredProductIdentity,
  orderLineTitleIdentityNeedsRepair,
  preserveSavedCatalogIdentityOnRefresh,
  orderIdentityPriority,
  outboundInventoryAvailableQuantity,
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

test("fulfillment routing uses indexed identity resolution before direct family hydration", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("async function fulfillmentProductFamilyForOrderedSku(");
  const end = source.indexOf("\nasync function fulfillmentProductForOrderedSku(", start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /readProductsForOrderSkus\([\s\S]+\{ fast: true \}\)/);
  assert.match(implementation, /readProductsByKeys\(familyKeys, \{ directProductIds: true,/);
});

test("RJ Schinner canonical supplier name inherits the RJS default priority", () => {
  const db = { vendors: [{ id: "rj-schinner", name: "RJ Schinner Company", purchaseOrderRules: {} }] };
  assert.equal(supplierSourcingPriority(db, { vendorId: "rj-schinner" }), 20);
});

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

test("TikTok title MPN resolves physical stock instead of a short channel SKU", () => {
  const warehouse = { id: "si2", name: "Staten Island 2", inventorySourceType: "physical" };
  const wrongShortSku = {
    id: "wrong-short-sku", sku: "BUS897507TRV", supplier: "True Value", mfrPartNumber: "4",
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 80, reserved: 0 }],
  };
  const physicalMpn = {
    id: "physical-mpn", sku: "BUS204218DIB", supplier: "Do It Best", mfrPartNumber: "48-22-7400",
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 6, reserved: 1 }],
  };
  const supplierOnlyMpn = {
    id: "supplier-mpn", sku: "BUS252246TRV", supplier: "True Value", mfrPartNumber: "48-22-7400",
    warehouseStock: [{ warehouseId: "datawarehouse", warehouseName: "DataWarehouse", inventorySourceType: "supplier_feed", qty: 100 }],
  };
  const line = { title: "Milwaukee 2-Piece Adjustable Wrench Set - 48-22-7400" };

  assert.equal(importedOrderProductMatch(wrongShortSku, "4", line), null);
  const selected = selectImportedOrderProduct({ vendors, warehouses: [warehouse] }, [wrongShortSku, supplierOnlyMpn, physicalMpn], "4", line);
  assert.equal(selected.product.id, "physical-mpn");
  assert.equal(selected.match.mode, "manufacturer-part-number");
});

test("TikTok title MPN can match a catalog SKU when the separate MPN field is empty", () => {
  const shortChannelSku = { id: "channel-4", sku: "4", title: "As seen", qty: 0 };
  const stockedManufacturerSku = {
    id: "mpn-as-sku",
    sku: "48-22-7400",
    title: "6 in. and 10 in. Adjustable Wrench",
    mfrPartNumber: "",
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 2, reserved: 0 }],
  };
  const line = { title: "Milwaukee Adjustable Wrench Set - 48-22-7400" };

  const selected = selectImportedOrderProduct({}, [shortChannelSku, stockedManufacturerSku], "4", line);
  assert.equal(selected.product.id, "mpn-as-sku");
  assert.equal(selected.match.mode, "manufacturer-part-number");
});

test("supplier SKU lookup inherits UPC and MPN before choosing physical family stock", () => {
  const trueValueSeed = {
    id: "true-value-seed",
    sku: "BUS252246TRV",
    supplier: "True Value",
    barcode: "045242358823",
    mfrPartNumber: "48-22-7400",
    warehouseStock: [],
  };
  const physicalSibling = {
    id: "physical-sibling",
    sku: "48-22-7400",
    supplier: "Do It Best",
    barcode: "045242358823",
    mfrPartNumber: "48-22-7400",
    warehouseStock: [{ warehouseId: "si2", warehouseName: "Staten Island 2", qty: 3, reserved: 0 }],
  };
  const importedLine = { title: "Milwaukee Adjustable Wrench Set" };
  const discoveredLine = orderLineWithDiscoveredProductIdentity(importedLine, trueValueSeed);

  assert.equal(discoveredLine.upc, "045242358823");
  assert.equal(discoveredLine.mfrPartNumber, "48-22-7400");
  const selected = selectImportedOrderProduct({}, [trueValueSeed, physicalSibling], "BUS252246TRV", discoveredLine);
  assert.equal(selected.product.id, "physical-sibling");
  assert.equal(selected.match.mode, "upc");
});

test("TikTok refresh repairs a channel SKU that overwrote its saved MPN catalog mapping", () => {
  assert.equal(orderLineTitleIdentityNeedsRepair({
    sku: "4",
    mappedFromSku: "48-22-2921",
    title: "Milwaukee 6-in-1 Impact Multi-Nut Driver - 48-22-2921",
    catalogIdentityMatch: {
      mode: "manufacturer-part-number",
      importedSku: "48-22-2921",
      catalogSku: "BUS403964DIB",
    },
  }), true);

  assert.equal(orderLineTitleIdentityNeedsRepair({
    sku: "BUS495-48-22-2921ESB",
    mappedFromSku: "48-22-2921",
    title: "Milwaukee 6-in-1 Impact Multi-Nut Driver - 48-22-2921",
    catalogIdentityMatch: {
      mode: "manufacturer-part-number",
      importedSku: "48-22-2921",
      catalogSku: "BUS495-48-22-2921ESB",
    },
  }), false);
});

test("TikTok refresh preserves a resolved SKU when the refreshed title has no MPN", () => {
  const order = {
    items: [{
      sku: "4",
      title: "Random live product #1",
      catalogIdentityMatch: {
        mode: "manufacturer-part-number",
        importedSku: "48-22-2921",
        catalogSku: "BUS495-48-22-2921ESB",
      },
    }],
  };
  preserveSavedCatalogIdentityOnRefresh(order);
  assert.equal(order.items[0].sku, "BUS495-48-22-2921ESB");
  assert.equal(order.items[0].marketplaceSku, "4");
});

test("supplier priority is used when no MPN match has physical stock", () => {
  const trueValue = { id: "tv", sku: "TV-7400", supplier: "True Value", mfrPartNumber: "48-22-7400", qty: 0 };
  const rjs = { id: "rjs", sku: "RJS-7400", supplier: "RJS", mfrPartNumber: "48-22-7400", qty: 100 };
  const line = { title: "Milwaukee wrench - 48-22-7400" };
  const selected = selectImportedOrderProduct({ vendors }, [rjs, trueValue], "4", line);
  assert.equal(selected.product.id, "tv");
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

  assert.equal(outboundInventoryAvailableQuantity(product.warehouseStock[0], true), 1);
  assert.equal(outboundInventoryAvailableQuantity(product.warehouseStock[0], false), 0);

  const originalSimilarity = postgres.readProductSimilarityGroup;
  const originalReadProducts = postgres.readProductsByKeys;
  postgres.readProductSimilarityGroup = async () => ({
    productId: product.id,
    sku: product.sku,
    members: [{ productId: product.id, sku: product.sku, isCurrent: true, matchTypes: ["current"] }],
  });
  postgres.readProductsByKeys = async (_keys, options) => {
    assert.equal(options.directProductIds, true);
    return [structuredClone(product)];
  };
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
