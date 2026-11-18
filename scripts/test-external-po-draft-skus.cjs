const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("../db");

const originalReadProductsByKeys = postgres.readProductsByKeys;
const originalUpsertProductsFromState = postgres.upsertProductsFromState;
const originalUpsertInventoryLevelsFromProducts = postgres.upsertInventoryLevelsFromProducts;

let savedProducts = [];
let inventoryProducts = [];
let lookupProducts = [];
postgres.readProductsByKeys = async (keys) => {
  const wanted = new Set((keys || []).map((key) => String(key || "").toLowerCase()));
  return lookupProducts.filter((product) => wanted.has(String(product.sku || "").toLowerCase()));
};
postgres.upsertProductsFromState = async (products, options) => {
  savedProducts = JSON.parse(JSON.stringify(products));
  assert.equal(options.insertOnly, true);
  return { products: products.length, inserted: products.length };
};
postgres.upsertInventoryLevelsFromProducts = async (products) => {
  inventoryProducts = JSON.parse(JSON.stringify(products));
  return { products: products.length };
};

const { createExternalPurchaseOrderDraftProducts } = require("../server");

(async () => {
  try {
    const preview = {
      document: { poNumber: "D188881" },
      vendor: { id: "vendor-cei", name: "CEI", code: "CEI" },
      items: [
        {
          line: 1,
          manufacturerPartNumber: "49-22-1216D",
          generatedSku: "BUS49221216DCEI",
          description: "16PC BIMETAL SAWZALL KIT",
          qty: 20,
          unitCost: 19.25,
          matchStatus: "unmatched",
          candidates: []
        },
        {
          line: 2,
          manufacturerPartNumber: "49-22-1129",
          sku: "BUY06241100",
          title: "12 Piece Reciprocating Blade Set",
          qty: 30,
          unitCost: 17.94,
          matchStatus: "matched"
        }
      ]
    };
    const result = await createExternalPurchaseOrderDraftProducts(preview, [{
      line: 1,
      manufacturerPartNumber: "49-22-1216D",
      sku: "BUS49221216DCEI",
      title: "16PC BIMETAL SAWZALL KIT"
    }], { actor: "Test Buyer", requestId: "request-123" });

    assert.equal(result.createdProducts.length, 1);
    assert.equal(savedProducts.length, 1);
    assert.equal(inventoryProducts.length, 1);
    assert.equal(savedProducts[0].sku, "BUS49221216DCEI");
    assert.equal(savedProducts[0].status, "Draft");
    assert.equal(savedProducts[0].supplier, "CEI");
    assert.equal(savedProducts[0].vendorSku, "49-22-1216D");
    assert.equal(savedProducts[0].mfrPartNumber, "49-22-1216D");
    assert.equal(savedProducts[0].cost, 19.25);
    assert.equal(savedProducts[0].qty, 0);
    assert.equal(savedProducts[0].catalogAttentionRequired, true);
    assert.equal(savedProducts[0].catalogAttentionStatus, "open");
    assert.equal(savedProducts[0].systemCreatedFromPurchaseOrder, true);
    assert.match(savedProducts[0].catalogAttentionReason, /CTech PO D188881/);
    assert.equal(result.items[0].sku, "BUS49221216DCEI");
    assert.equal(result.items[0].catalogProduct, true);
    assert.equal(result.items[0].resolutionStatus, "resolved");
    assert.equal(result.items[0].catalogProductCreatedBySystem, true);
    assert.equal(result.items[0].catalogAttentionRequired, true);
    assert.equal(result.items[1].sku, "BUY06241100");

    lookupProducts = [{
      id: "source-product",
      sku: "BUS48228441TRV",
      title: "PACKOUT Single Drawer Tool Box",
      marketplaceTitle: "Milwaukee PACKOUT Single Drawer Tool Box",
      shortDescription: "Stackable PACKOUT storage with one drawer.",
      images: ["/packout.jpg"],
      defaultImage: "/packout.jpg",
      barcode: "045242610755",
      mfrPartNumber: "48-22-8441",
      vendorSku: "1428441",
      supplier: "True Value",
      supplierCode: "TRV",
      cost: 109.95,
      active: true,
      status: "Active"
    }];
    const clonePreview = {
      document: { poNumber: "D188881" },
      vendor: { id: "vendor-cei", name: "CEI", code: "CEI" },
      items: [{
        line: 1,
        manufacturerPartNumber: "48-22-8441",
        generatedSku: "BUS48228441CEI",
        description: "PACKOUT SINGLE DRAWER TOOL BOX",
        qty: 2,
        unitCost: 127.92,
        matchStatus: "review",
        candidates: [{ sku: "BUS48228441TRV", supplier: "True Value", requiresSupplierClone: true }]
      }]
    };
    const cloneResult = await createExternalPurchaseOrderDraftProducts(clonePreview, [{
      line: 1,
      manufacturerPartNumber: "48-22-8441",
      sku: "BUS48228441CEI",
      title: "PACKOUT SINGLE DRAWER TOOL BOX",
      cloneFromSku: "BUS48228441TRV"
    }], { actor: "Test Buyer", requestId: "request-clone" });
    assert.equal(cloneResult.createdProducts.length, 1);
    assert.equal(savedProducts[0].sku, "BUS48228441CEI");
    assert.equal(savedProducts[0].active, false);
    assert.equal(savedProducts[0].status, "Draft");
    assert.equal(savedProducts[0].supplierId, "vendor-cei");
    assert.equal(savedProducts[0].supplier, "CEI");
    assert.equal(savedProducts[0].vendorSku, "48-22-8441");
    assert.equal(savedProducts[0].sourceSku, "48-22-8441");
    assert.equal(savedProducts[0].mfrPartNumber, "48-22-8441");
    assert.equal(savedProducts[0].barcode, "045242610755");
    assert.equal(savedProducts[0].shortDescription, "Stackable PACKOUT storage with one drawer.");
    assert.deepEqual(savedProducts[0].images, ["/packout.jpg"]);
    assert.equal(savedProducts[0].cost, 127.92);
    assert.equal(savedProducts[0].qty, 0);
    assert.equal(savedProducts[0].cloneSourceSku, "BUS48228441TRV");
    assert.equal(savedProducts[0].systemCreatedFromPurchaseOrder, true);
    assert.equal(cloneResult.items[0].sku, "BUS48228441CEI");
    assert.equal(cloneResult.items[0].catalogProductClonedFromSku, "BUS48228441TRV");
    assert.match(cloneResult.items[0].matchBasis, /supplier-specific draft cloned/);

    lookupProducts = [{ id: "wrong-supplier-product", sku: "BUS48228441CEI", supplier: "True Value", supplierCode: "TRV" }];
    const conflictPreview = JSON.parse(JSON.stringify(clonePreview));
    conflictPreview.items[0].matchStatus = "review";
    conflictPreview.items[0].sku = "";
    await assert.rejects(
      () => createExternalPurchaseOrderDraftProducts(conflictPreview, [{
        line: 1,
        manufacturerPartNumber: "48-22-8441",
        sku: "BUS48228441CEI",
        cloneFromSku: "BUS48228441TRV"
      }]),
      /already belongs to another supplier/
    );

    const invalidPreview = JSON.parse(JSON.stringify(preview));
    invalidPreview.items[0].matchStatus = "unmatched";
    await assert.rejects(
      () => createExternalPurchaseOrderDraftProducts(invalidPreview, [{ line: 1, manufacturerPartNumber: "WRONG", sku: "BADSKU" }]),
      /does not match external PO line/
    );

    const purchasingRoute = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "purchasing-route.tsx"), "utf8");
    const purchasingWorkspace = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "purchasing-workspaces.tsx"), "utf8");
    assert.match(purchasingRoute, /missingSkuSelections/);
    assert.match(purchasingRoute, /Create as draft catalog product/);
    assert.match(purchasingRoute, /Create draft SKU/);
    assert.match(purchasingRoute, /Clone .* for/);
    assert.match(purchasingRoute, /Copies product data from/);
    assert.match(purchasingWorkspace, /Draft SKU, review needed/);
    assert.match(purchasingWorkspace, /createdCatalogReviewLines/);
  } finally {
    postgres.readProductsByKeys = originalReadProductsByKeys;
    postgres.upsertProductsFromState = originalUpsertProductsFromState;
    postgres.upsertInventoryLevelsFromProducts = originalUpsertInventoryLevelsFromProducts;
  }
  console.log("external PO draft-SKU tests passed");
})().catch((error) => {
  postgres.readProductsByKeys = originalReadProductsByKeys;
  postgres.upsertProductsFromState = originalUpsertProductsFromState;
  postgres.upsertInventoryLevelsFromProducts = originalUpsertInventoryLevelsFromProducts;
  console.error(error);
  process.exit(1);
});
