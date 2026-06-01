const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DB_FILE = path.join(ROOT, "data", "db.json");
const MAPPINGS_FILE = path.join(ROOT, "data", "export-mappings.json");
const OUTPUT_FILE = path.join(ROOT, "outputs", `shopify-full-template-variations-fast-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const TEMPLATE_ID = "bfdc1242-7a78-4a22-8d81-b3f335636c9e";

const UOM_DEFINITIONS = {
  EA: "Each",
  PL: "Pallet",
  CS: "Case",
  BD: "Bundle",
  RL: "Roll",
  SK: "Skid",
  BX: "Box",
  PK: "Pack",
  KT: "Kit",
  CT: "Carton",
  BL: "Bale",
  RM: "Ream",
  FT: "Foot",
  DR: "Drum",
  PR: "Pair",
  BG: "Bag",
  ST: "Set",
  CL: "Coil",
  CX: "Carton",
  GL: "Gallon",
  LB: "Pound",
  SO: "Spool",
  CA: "Can",
  DS: "Dispenser",
  TU: "Tube",
  YD: "Yard",
  TB: "Tub"
};

function csv(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
}

function shopifyTitle(item = {}) {
  return [item.brand, item.mfrPartNumber, item.marketplaceTitle || item.title || item.sku]
    .map((part) => stripHtml(part).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function productNumber(item = {}, keys = []) {
  const containers = [
    item,
    item.productManagerFields || {},
    item.productManagerFields?.original || {},
    item.original || {}
  ];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const key of keys) {
      const parsed = number(container[key], 0);
      if (parsed > 0) return parsed;
    }
  }
  return 0;
}

function money(value) {
  const parsed = number(value, 0);
  return parsed > 0 ? parsed.toFixed(2) : "";
}

function booleanValue(value) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "active", "in stock"].includes(text)) return "TRUE";
  if (["false", "0", "no", "n", "inactive", "out of stock"].includes(text)) return "FALSE";
  return "";
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function htmlDescription(item) {
  const text = String(item.longDescription || item.description || item.vendorDescription || item.shortDescription || "").trim();
  if (!text) return "";
  return /<\/?[a-z][\s\S]*>/i.test(text) ? text : `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
}

function imageSrc(item) {
  if (item.defaultImage) return item.defaultImage;
  if (Array.isArray(item.images) && item.images[0]) return item.images[0];
  if (item.originalImage) return item.originalImage;
  return "";
}

function uomInfo(item) {
  const qty = Math.max(1, Math.floor(number(item.uomQty ?? item.uom_qty ?? item.minQuantity ?? item.quantityIncrements, 1)));
  const code = String(item.uom || item.unitOfMeasure || item.unit_of_measure || "EA").trim().toUpperCase() || "EA";
  const name = UOM_DEFINITIONS[code] || code || "Each";
  return {
    code,
    name,
    qty,
    isMultiUnit: qty > 1,
    display: qty > 1 ? (code === "EA" ? `Pack of ${qty}` : `${name} of ${qty}`) : name
  };
}

function availableQty(item) {
  return Math.max(0, number(item.qty ?? item.stockQty, 0) - number(item.reserved, 0));
}

function unitCost(item) {
  return number(item.sourceCost ?? item.cost ?? item.fobPrice, 0);
}

function sellUnitCost(item) {
  const uom = uomInfo(item);
  return unitCost(item) * uom.qty;
}

function roundedPrice(value) {
  const parsed = number(value, 0);
  return parsed > 0 ? Math.max(0.99, Math.ceil(parsed) - 0.01) : "";
}

function variants(item, settings) {
  const uom = uomInfo(item);
  const markup = number(settings?.priceMarkupPercent, 0);
  const basePackPrice = number(item.shopifyPrice ?? item.websitePrice ?? item.price, 0) || roundedPrice(sellUnitCost(item) * (1 + markup / 100));
  const variantBaseSku = String(item.vendorSku || item.mfrPartNumber || item.sku || "").trim();
  const rows = [{
    key: "sell-unit",
    sku: uom.isMultiUnit ? `${variantBaseSku}-${uom.qty}PC` : variantBaseSku,
    optionName: uom.isMultiUnit ? "Purchase Unit" : "Title",
    optionValue: uom.isMultiUnit ? uom.display : "Default Title",
    uom: uom.code,
    uomName: uom.name,
    uomQty: uom.qty,
    quantity: availableQty(item),
    cost: sellUnitCost(item),
    price: basePackPrice
  }];
  if (uom.isMultiUnit) {
    const eachPrice = roundedPrice(unitCost(item) * (1 + (markup + 25) / 100));
    rows.push({
      key: "each",
      sku: variantBaseSku,
      optionName: "Purchase Unit",
      optionValue: "Each",
      uom: "EA",
      uomName: "Each",
      uomQty: 1,
      quantity: availableQty(item),
      cost: unitCost(item),
      price: eachPrice
    });
  }
  return rows;
}

function buildCategoryMaps(settings) {
  const byName = new Map();
  for (const row of settings || []) {
    const key = String(row.name || "").trim().toLowerCase();
    if (key) byName.set(key, row.mappings?.shopify || {});
  }
  return byName;
}

function categoryMapping(item, categoryByName) {
  const keys = [item.category, item.mainCategory, item.sourceCategory, item.vendorCategory].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  for (const key of keys) {
    if (categoryByName.has(key)) return categoryByName.get(key);
  }
  return {};
}

function dimension(item, keys) {
  const parsed = productNumber(item, keys);
  return parsed > 0 ? `{"value":${jsonNumber(parsed)},"unit":"INCHES"}` : "";
}

function jsonNumber(value, decimals = 3) {
  const parsed = number(value, 0);
  if (!(parsed > 0)) return "";
  const cleaned = Number(parsed.toFixed(decimals));
  return Number.isInteger(cleaned) ? `${cleaned}.0` : String(cleaned);
}

function weight(item, keys, unit = "POUNDS") {
  const parsed = productNumber(item, keys);
  return parsed > 0 ? `{"value":${jsonNumber(parsed)},"unit":"${unit}"}` : "";
}

function valueFor(column, field, item, variant, rowNumber, categoryByName) {
  const mapping = categoryMapping(item, categoryByName);
  const topRow = rowNumber === 1;
  const isProductMetafield = /^Metafield:/i.test(column);
  if (isProductMetafield && !topRow) return "";
  if (/^ID$/i.test(column)) return item.shopifyId || "";
  if (/^Handle$/i.test(column)) return item.shopifyHandle || slug(item.marketplaceTitle || item.title || item.sku);
  if (/^Command$/i.test(column)) return "MERGE";
  if (/^Title$/i.test(column)) return item.marketplaceTitle || item.title || item.sku || "";
  if (/^Body HTML$/i.test(column)) return htmlDescription(item);
  if (/^Vendor$/i.test(column)) return item.vendor || item.supplier || "";
  if (/^Type$/i.test(column)) return item.shopifyProductType || item.productType || item.category || "";
  if (/^Tags$/i.test(column)) return Array.isArray(item.tags) ? item.tags.join(", ") : String(item.tags || "");
  if (/^Status$/i.test(column)) return item.shopifyStatus || item.status || "Draft";
  if (/^Published$/i.test(column)) return item.shopifyPublished === false ? "FALSE" : "TRUE";
  if (/^Published Scope$/i.test(column)) return "global";
  if (/^Gift Card$/i.test(column)) return "FALSE";
  if (/^Total Inventory Qty$/i.test(column)) return availableQty(item);
  if (/^Row #$/i.test(column)) return rowNumber;
  if (/^Top Row$/i.test(column)) return topRow ? "TRUE" : "FALSE";
  if (/^Category: ID$/i.test(column)) return mapping.categoryId || "";
  if (/^Category: Name$/i.test(column)) return mapping.categoryPath || "";
  if (/^Category$/i.test(column)) return mapping.googleCategory?.breadcrumb || mapping.googleCategory?.fullName || mapping.categoryPath || "";
  if (/^Image Src$/i.test(column) || /^Variant Image$/i.test(column)) return imageSrc(item);
  if (/^Image Command$/i.test(column)) return imageSrc(item) ? "MERGE" : "";
  if (/^Image Position$/i.test(column)) return imageSrc(item) ? 1 : "";
  if (/^Image Alt Text$/i.test(column)) return shopifyTitle(item);
  if (/^Variant Command$/i.test(column)) return "MERGE";
  if (/^Option1 Name$/i.test(column)) return variant.optionName;
  if (/^Option1 Value$/i.test(column)) return variant.optionValue;
  if (/^Variant Position$/i.test(column)) return rowNumber;
  if (/^Variant SKU$/i.test(column)) return variant.sku || "";
  if (/^Variant Barcode$/i.test(column)) return uomInfo(item).isMultiUnit ? (variant.key === "each" ? item.barcode || item.upc || "" : "") : item.barcode || item.upc || "";
  if (/^Variant Price$/i.test(column)) return money(variant.price);
  if (/^Variant Compare At Price$/i.test(column)) return money(number(variant.price, 0) * 1.2);
  if (/^Variant Taxable$/i.test(column)) return "TRUE";
  if (/^Variant Inventory Tracker$/i.test(column)) return "shopify";
  if (/^Variant Inventory Policy$/i.test(column)) return "deny";
  if (/^Variant Fulfillment Service$/i.test(column)) return "manual";
  if (/^Variant Requires Shipping$/i.test(column)) return "TRUE";
  if (/^Variant Shipping Profile$/i.test(column)) return "General profile";
  if (/^Variant Inventory Qty$/i.test(column)) return variant.quantity;
  if (/^Variant Cost$/i.test(column)) return money(variant.cost);
  if (/^Variant HS Code$/i.test(column)) return item.unspsc || "";
  if (/^Variant Country of Origin$/i.test(column)) return item.countryOfOrigin || "";
  if (/^Inventory Available:/i.test(column) || /^Inventory On Hand:/i.test(column)) return /single\s+music/i.test(column) ? 0 : availableQty(item);
  if (/^Inventory Committed:/i.test(column) || /^Inventory Reserved:/i.test(column)) return /single\s+music/i.test(column) ? 0 : number(item.reserved, 0);
  if (/^Inventory Incoming:/i.test(column)) return "";
  if (/^Variant Metafield:\s*custom\.purchase_unit/i.test(column)) return variant.optionValue;
  if (/^Variant Metafield:\s*custom\.uom\s/i.test(column)) return variant.uom;
  if (/^Variant Metafield:\s*custom\.uom_qty/i.test(column)) return variant.uomQty;
  if (/^Metafield:\s*custom\.brand/i.test(column)) return item.brand || "";
  if (/^Metafield:\s*custom\.vendor_sku/i.test(column)) return item.vendorSku || "";
  if (/^Metafield:\s*custom\.supplier\s/i.test(column)) return item.supplier || "";
  if (/^Metafield:\s*custom\.supplier_code/i.test(column)) return item.supplierCode || "";
  if (/^Metafield:\s*custom\.source_category/i.test(column)) return item.sourceCategory || item.category || "";
  if (/^Metafield:\s*custom\.google_taxonomy_id/i.test(column)) return mapping.googleCategory?.id || "";
  if (/^Metafield:\s*custom\.manufacturer/i.test(column)) return item.manufacturer || "";
  if (/^Metafield:\s*custom\.mfr_part_number/i.test(column)) return item.mfrPartNumber || "";
  if (/^Metafield:\s*custom\.unspsc/i.test(column)) return item.unspsc || "";
  if (/^Metafield:\s*custom\.source_active/i.test(column)) return booleanValue(item.active ?? item.status);
  if (/^Metafield:\s*custom\.short_description/i.test(column)) return item.shortDescription || "";
  if (/^Metafield:\s*custom\.list_price/i.test(column)) return money(item.msrp || item.listPrice);
  if (/^Metafield:\s*custom\.uom\s/i.test(column)) return uomInfo(item).code;
  if (/^Metafield:\s*custom\.uom_qty/i.test(column)) return uomInfo(item).qty;
  if (/^Metafield:\s*custom\.item_height/i.test(column)) return dimension(item, ["itemHeight", "item_height", "heightIn", "height_in"]);
  if (/^Metafield:\s*custom\.item_length/i.test(column)) return dimension(item, ["itemLength", "item_length", "lengthIn", "length_in"]);
  if (/^Metafield:\s*custom\.item_width/i.test(column)) return dimension(item, ["itemWidth", "item_width", "widthIn", "width_in"]);
  if (/^Metafield:\s*custom\.item_weight/i.test(column)) return weight(item, ["itemWeight", "item_weight", "weightOz", "weight_oz", "weightLb", "weight_lbs"], "OUNCES");
  if (/^Metafield:\s*custom\.package_height/i.test(column)) return dimension(item, ["packageHeight", "package_height"]);
  if (/^Metafield:\s*custom\.package_length/i.test(column)) return dimension(item, ["packageLength", "package_length"]);
  if (/^Metafield:\s*custom\.package_width/i.test(column)) return dimension(item, ["packageWidth", "package_width"]);
  if (/^Metafield:\s*custom\.package_weight/i.test(column)) return weight(item, ["packageWeight", "package_weight"], "POUNDS");
  if (/^Metafield:\s*custom\.stock_status/i.test(column)) return booleanValue(item.stockStatus);
  if (/^Metafield:\s*custom\.stock_qty/i.test(column)) return number(item.stockQty ?? item.qty, 0);
  if (/^Metafield:\s*custom\.hazardous/i.test(column)) return booleanValue(item.hazardous);
  if (/^Metafield:\s*custom\.sds_url/i.test(column)) return item.sdsUrl || "";
  if (/^Metafield:\s*custom\.original_sds_url/i.test(column)) return item.originalSdsUrl || "";
  if (/^Metafield:\s*custom\.country_of_origin/i.test(column)) return item.countryOfOrigin || "";
  if (/^Variant Metafield:.*mpn/i.test(column)) return item.mfrPartNumber || "";
  if (/^Variant Metafield:.*condition/i.test(column)) return "new";
  if (/^Metafield: mm-google-shopping.condition/i.test(column)) return item.condition || "new";
  if (field && Object.prototype.hasOwnProperty.call(item, field)) return item[field] ?? "";
  return "";
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  console.log("Reading database...");
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
  const template = mappings.find((row) => row.id === TEMPLATE_ID);
  if (!template) throw new Error(`Missing export template ${TEMPLATE_ID}`);
  const columns = template.mappings || [];
  const categoryByName = buildCategoryMaps(db.categorySettings || []);
  const shopifySettings = (db.connections || []).find((row) => /shopify/i.test(row.name || ""))?.settings || {};
  const stream = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8" });
  stream.write(columns.map((mapping) => csv(mapping.externalColumn)).join(",") + "\n");
  let productCount = 0;
  let rowCount = 0;
  for (const item of db.inventory || []) {
    if (!item?.sku) continue;
    productCount += 1;
    const itemVariants = variants(item, shopifySettings);
    for (let index = 0; index < itemVariants.length; index += 1) {
      const variant = itemVariants[index];
      const rowNumber = index + 1;
      const row = columns.map((mapping) => {
        const value = valueFor(mapping.externalColumn, mapping.productField, item, variant, rowNumber, categoryByName);
        return csv(value === "" || value === undefined || value === null ? mapping.defaultValue || "" : value);
      });
      if (!stream.write(row.join(",") + "\n")) {
        await new Promise((resolve) => stream.once("drain", resolve));
      }
      rowCount += 1;
    }
    if (productCount % 5000 === 0) {
      const elapsed = (Date.now() - started) / 1000;
      console.log(`${productCount.toLocaleString()} products / ${rowCount.toLocaleString()} rows in ${elapsed.toFixed(1)}s`);
    }
  }
  await new Promise((resolve) => stream.end(resolve));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const sizeMb = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(JSON.stringify({ output: OUTPUT_FILE, products: productCount, rows: rowCount, seconds, sizeMb }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
