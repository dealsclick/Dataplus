const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cloneCatalogProduct } = require("../server");

const source = {
  id: "product-source",
  sku: "SOURCE-100",
  title: "Source product",
  marketplaceTitle: "Marketplace source title",
  brand: "Example Brand",
  manufacturer: "Example Manufacturer",
  mfrPartNumber: "MPN-100",
  barcode: "012345678905",
  category: "Tools",
  mainCategory: "Tools",
  categoryVerified: true,
  shortDescription: "Short content",
  longDescription: "Long content",
  bulletPoints: ["One", "Two"],
  tags: ["source"],
  images: ["/source.jpg"],
  defaultImage: "/source.jpg",
  itemLength: 12,
  packageWeight: 4,
  hazardous: true,
  supplier: "Supplier A",
  supplierCode: "SUP-A",
  vendorSku: "VENDOR-100",
  qty: 19,
  stockQty: 21,
  reserved: 3,
  cost: 14.25,
  sourceCost: 14.25,
  websitePrice: 29.99,
  price: 29.99,
  listPrice: 35,
  warehouseStock: [{ warehouseId: "wh-1", qty: 19 }],
  aliases: [{ aliasSku: "SOURCE-ALIAS" }],
  shadowSkus: [{ shadowSku: "SOURCE-3PK" }],
  vendorOffers: [{ vendorSku: "VENDOR-100", cost: 14.25 }],
  identifiers: [{ type: "barcode", value: "012345678905" }],
  shopifyId: "gid://shopify/Product/1",
  shopifyVariantId: "gid://shopify/ProductVariant/2",
  ebayId: "ebay-1",
  ebayListing: { listingId: "listing-1" },
  temuId: "temu-1",
  channelSellingStatus: { ebay: { status: "active" } },
  active: true,
  status: "Active",
};

const clone = cloneCatalogProduct(source, { newSku: "CLONE-100", title: "Clone product" }, "Catalog User");
assert.notEqual(clone.id, source.id);
assert.equal(clone.sku, "CLONE-100");
assert.equal(clone.title, "Clone product");
assert.equal(clone.active, false);
assert.equal(clone.status, "Draft");
assert.equal(clone.catalogAttentionRequired, true);
assert.equal(clone.cloneSourceSku, "SOURCE-100");
assert.equal(clone.createdBy, "Catalog User");
assert.equal(clone.shortDescription, source.shortDescription);
assert.deepEqual(clone.images, source.images);
assert.equal(clone.itemLength, source.itemLength);
assert.equal(clone.barcode, "");
assert.equal(clone.mfrPartNumber, "");
assert.equal(clone.qty, 0);
assert.equal(clone.stockQty, 0);
assert.equal(clone.reserved, 0);
assert.equal(clone.cost, 0);
assert.equal(clone.price, 0);
assert.equal(clone.websitePrice, 0);
assert.equal(clone.supplier, "");
assert.equal(clone.vendorSku, "");
assert.deepEqual(clone.warehouseStock, []);
assert.deepEqual(clone.aliases, []);
assert.deepEqual(clone.shadowSkus, []);
assert.deepEqual(clone.vendorOffers, []);
assert.deepEqual(clone.identifiers, []);
assert.deepEqual(clone.channelSellingStatus, {});
assert.equal(clone.shopifyId, undefined);
assert.equal(clone.ebayListing, undefined);
assert.equal(clone.temuId, undefined);
assert.deepEqual(source.images, ["/source.jpg"]);

const identifierClone = cloneCatalogProduct(source, { newSku: "CLONE-IDENTIFIERS", copyIdentifiers: true }, "Catalog User");
assert.equal(identifierClone.barcode, source.barcode);
assert.equal(identifierClone.mfrPartNumber, source.mfrPartNumber);

const supplierClone = cloneCatalogProduct(source, {
  newSku: "CLONE-SUPPLIER",
  supplier: { id: "supplier-2", name: "Supplier B", code: "SUP-B" },
}, "Catalog User");
assert.equal(supplierClone.supplierId, "supplier-2");
assert.equal(supplierClone.supplier, "Supplier B");
assert.equal(supplierClone.vendor, "Supplier B");
assert.equal(supplierClone.supplierCode, "SUP-B");
assert.equal(supplierClone.vendorSku, "");
assert.equal(supplierClone.cost, 0);
assert.equal(supplierClone.qty, 0);
assert.deepEqual(supplierClone.vendorOffers, []);
assert.match(supplierClone.catalogAttentionReason, /Add the vendor SKU/);

const minimalClone = cloneCatalogProduct(source, {
  newSku: "CLONE-MINIMAL",
  copyContent: false,
  copyMedia: false,
  copyShipping: false,
}, "Catalog User");
assert.equal(minimalClone.shortDescription, undefined);
assert.equal(minimalClone.images, undefined);
assert.equal(minimalClone.itemLength, undefined);

assert.throws(() => cloneCatalogProduct(source, {}), /new SKU/i);
assert.throws(() => cloneCatalogProduct({}, { newSku: "CLONE" }), /source product/i);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const uiSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "product-workspaces.tsx"), "utf8");
assert.match(serverSource, /\/api\\\/inventory\\\/\[\^\/\]\+\\\/clone/);
assert.match(serverSource, /userCan\(authUser, "catalog\.products", "create"\)/);
assert.match(serverSource, /parts\[3\] === "clone-options"/);
assert.match(serverSource, /Choose an active supplier for the duplicate SKU/);
assert.match(serverSource, /insertOnly: true, includeOffers: false, includeVendors: false/);
assert.match(dbSource, /options\.includeOffers !== false/);
assert.match(dbSource, /options\.includeVendors !== false/);
assert.match(dbSource, /item\.supplierId \|\| item\.vendorId/);
assert.match(dbSource, /inserted: insertedIds\.size/);
assert.match(uiSource, /> Duplicate SKU</);
assert.match(uiSource, /No supplier yet/);
assert.match(uiSource, /supplierId: cloneDraft\.supplierId/);
assert.match(uiSource, /Independent product, not a shadow/);
assert.match(uiSource, /Always starts clean/);

console.log("Product clone: independent draft semantics, validated supplier selection, optional copy groups, API safeguards, and React controls passed.");
