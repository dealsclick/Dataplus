const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("../db");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const TAXONOMY_FILE = path.join(ROOT, "data", "channel-taxonomies", "shopify", "taxonomy-index.json");
const OUT_DIR = path.join(ROOT, "outputs", "category-sync");
const SUPPLIER = "Essendant";

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function sourceText(value) {
  return String(value || "").trim();
}

function formatTitlePart(part = "") {
  const keepUpper = new Set(["AV", "CD", "DVD", "HVAC", "ID", "LED", "PPE", "USB"]);
  return sourceText(part)
    .toLowerCase()
    .replace(/\b[a-z0-9]+\b/g, (word) => keepUpper.has(word.toUpperCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
}

function formatCategoryName(value = "") {
  return sourceText(value)
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ")
    .split(">")
    .map((part) => formatTitlePart(part))
    .filter(Boolean)
    .join(" > ");
}

function normalizedKey(value = "") {
  return formatCategoryName(value).toLowerCase();
}

function mappingKey(supplier, vendorCategory) {
  const supplierKey = sourceText(supplier).toLowerCase();
  const categoryKey = normalizedKey(vendorCategory);
  return supplierKey && categoryKey ? `${supplierKey}::${categoryKey}` : "";
}

function categoryIdForName(name = "") {
  return `main-${crypto.createHash("sha1").update(normalizedKey(name)).digest("hex").slice(0, 16)}`;
}

function smartCollectionHandle(productType = "") {
  return sourceText(productType)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase()
    .slice(0, 240);
}

function categoryTypeValue(value = "") {
  const parts = formatCategoryName(value).split(">").map((part) => part.trim()).filter(Boolean);
  return parts.slice(-2).join(" > ") || parts[0] || "";
}

function normalizeChannelMapping(mapping = {}) {
  return {
    categoryId: mapping.categoryId || "",
    categoryPath: mapping.categoryPath || "",
    categoryHandle: mapping.categoryHandle || "",
    collectionHandle: mapping.collectionHandle || "",
    taxonomyVersion: mapping.taxonomyVersion || "",
    googleCategory: mapping.googleCategory || null,
    attributes: Array.isArray(mapping.attributes) ? mapping.attributes : [],
    attributeMappings: Array.isArray(mapping.attributeMappings) ? mapping.attributeMappings : [],
    status: mapping.status || (mapping.categoryId || mapping.categoryPath || mapping.googleCategory ? "mapped" : "missing"),
    notes: mapping.notes || ""
  };
}

function normalizeCategorySetting(row = {}) {
  const name = formatCategoryName(row.name || row.category || "");
  const productType = categoryTypeValue(row.smartCollection?.productType || name);
  const id = row.id || row.categoryId || categoryIdForName(name);
  const now = new Date().toISOString();
  return {
    id,
    categoryId: row.categoryId || id,
    name,
    scope: "main",
    status: row.status || "mapped",
    owner: row.owner || "",
    notes: row.notes || "",
    mappings: {
      shopify: normalizeChannelMapping(row.mappings?.shopify),
      temu: normalizeChannelMapping(row.mappings?.temu),
      tiktok: normalizeChannelMapping(row.mappings?.tiktok),
      ebay: normalizeChannelMapping(row.mappings?.ebay),
      whatnot: normalizeChannelMapping(row.mappings?.whatnot)
    },
    smartCollection: {
      enabled: row.smartCollection?.enabled !== false,
      productType,
      handle: row.smartCollection?.handle || smartCollectionHandle(productType),
      title: row.smartCollection?.title || productType.split(">").pop().trim(),
      bodyHtml: row.smartCollection?.bodyHtml || "",
      sortOrder: row.smartCollection?.sortOrder || "Best Selling",
      templateSuffix: row.smartCollection?.templateSuffix || "",
      published: row.smartCollection?.published === undefined ? true : Boolean(row.smartCollection.published),
      publishedScope: row.smartCollection?.publishedScope || "global",
      mustMatch: row.smartCollection?.mustMatch || "all conditions",
      ruleProductColumn: row.smartCollection?.ruleProductColumn || "Type",
      ruleRelation: row.smartCollection?.ruleRelation || "Equals",
      imageSrc: row.smartCollection?.imageSrc || "",
      imageAltText: row.smartCollection?.imageAltText || productType.split(">").pop().trim(),
      titleTag: row.smartCollection?.titleTag || `${productType.split(">").pop().trim()} on Sale`,
      descriptionTag: row.smartCollection?.descriptionTag || ""
    },
    defaults: row.defaults || {},
    requiredAttributes: Array.isArray(row.requiredAttributes) ? row.requiredAttributes : [],
    createdBy: row.createdBy || "System - Category Prefill",
    updatedBy: "System - Category Prefill",
    createdSource: row.createdSource || "system:essendant-prefill",
    createdAt: row.createdAt || now,
    updatedAt: now
  };
}

function taxonomyRows() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_FILE, "utf8"));
  return {
    version: taxonomy.version || "",
    rows: (taxonomy.categories || []).map((category) => ({
      ...category,
      haystack: sourceText(`${category.fullName || ""} ${category.name || ""} ${category.googleCategory?.fullName || ""} ${category.googleCategory?.breadcrumb || ""}`).toLowerCase()
    }))
  };
}

function findTaxonomyMapping(taxonomy, search = "") {
  const query = sourceText(search).toLowerCase();
  if (!query) return null;
  const ranked = taxonomy.rows
    .map((category) => {
      const fullName = sourceText(category.fullName);
      const googlePath = sourceText(category.googleCategory?.breadcrumb || category.googleCategory?.fullName);
      const lower = fullName.toLowerCase();
      const googleLower = googlePath.toLowerCase();
      let score = 0;
      if (lower === query || googleLower === query) score += 500;
      else if (lower.includes(query) || googleLower.includes(query)) score += 250;
      else return null;
      score += Math.min(20, Number(category.level || 0) * 2);
      return { category, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || sourceText(a.category.fullName).length - sourceText(b.category.fullName).length);
  const best = ranked[0]?.category;
  if (!best) return null;
  return {
    categoryId: best.id || "",
    categoryPath: best.fullName || best.name || "",
    categoryHandle: best.handle || "",
    taxonomyVersion: taxonomy.version || "",
    googleCategory: best.googleCategory || {
      id: "",
      fullName: best.fullName || best.name || "",
      breadcrumb: best.fullName || best.name || "",
      taxonomy: "google"
    },
    status: "mapped",
    notes: `Google taxonomy fallback selected by Essendant category prefill using "${search}".`
  };
}

function buildBranchChecker(mainCategories = []) {
  const normalized = new Set(mainCategories.map((name) => normalizedKey(name)));
  return {
    hasExact: (name) => normalized.has(normalizedKey(name)),
    hasBranch: (prefix) => {
      const key = normalizedKey(prefix);
      return normalized.has(key) || [...normalized].some((name) => name.startsWith(`${key} > `));
    }
  };
}

const leafMap = new Map(Object.entries({
  "ink & toner": ["Technology & Electronics > Printers > Ink & Toner", "Electronics > Print, Copy, Scan & Fax > Printer, Copier & Fax Machine Accessories > Printer Consumables > Toner & Inkjet Cartridges"],
  "printing consumables": ["Technology & Electronics > Printers > Printer Consumables", "Electronics > Print, Copy, Scan & Fax > Printer, Copier & Fax Machine Accessories > Printer Consumables"],
  "label machine supplies": ["Office & School Supplies > Office Supplies > Label Makers", "Office Supplies > Office Instruments > Label Makers"],
  "ribbons & thermal supplies": ["Technology & Electronics > Printers > Printer Ribbons & Thermal Supplies", "Electronics > Print, Copy, Scan & Fax > Printer, Copier & Fax Machine Accessories > Printer Consumables"],
  "printing & scanning devices": ["Technology & Electronics > Printers & Scanners", "Electronics > Print, Copy, Scan & Fax"],
  "consumer electronics": ["Technology & Electronics > Consumer Electronics", "Electronics"],
  "networking": ["Technology & Electronics > AV & Data Networking > Data & Communication Networking", "Electronics > Networking"],
  "data storage": ["Technology & Electronics > Computer Equipment > Data Storage", "Electronics > Computers > Computer Components > Storage Devices"],
  "power": ["Technology & Electronics > Power & Charging", "Electronics > Electronics Accessories > Power"],
  "tablets, notebooks & pcs": ["Technology & Electronics > Computer Equipment > Tablets, Notebooks & PCs", "Electronics > Computers"],
  "input devices": ["Technology & Electronics > Computer Equipment > Input Devices", "Electronics > Computers > Computer Accessories > Input Devices"],
  "computer accessories": ["Technology & Electronics > Computer Equipment > Computer Accessories", "Electronics > Computers > Computer Accessories"],
  "other computer accessories": ["Technology & Electronics > Computer Equipment > Computer Accessories", "Electronics > Computers > Computer Accessories"],
  "business cases": ["Technology & Electronics > Computer Equipment > Laptop & Tablet Cases", "Electronics > Computers > Computer Accessories > Laptop Bags"],
  "computer ergonomics": ["Technology & Electronics > Computer Equipment > Computer Ergonomics", "Office Supplies > Workspace Organizers"],
  "mobile charging": ["Technology & Electronics > Cell Phones > Chargers & Cables", "Electronics > Electronics Accessories > Chargers"],
  "tablet & cell phone accessories": ["Technology & Electronics > Cell Phones > Accessories", "Electronics > Communications > Telephony > Mobile Phone Accessories"],
  "computer cleaning supplies": ["Technology & Electronics > Computer Equipment > Computer Cleaning Supplies", "Electronics > Electronics Cleaners"],
  "computer speakers": ["Technology & Electronics > Audio > Computer Speakers", "Electronics > Audio > Audio Components > Speakers"],
  "media storage": ["Technology & Electronics > Computer Equipment > Media Storage", "Electronics > Electronics Accessories > Media Storage"],
  "office electronics": ["Technology & Electronics > Office Electronics", "Electronics > Office Electronics"],
  "business electronics": ["Technology & Electronics > Office Electronics", "Electronics > Office Electronics"],
  "warranties & software": ["Technology & Electronics > Software & Warranties", "Software"],

  "writing instruments": ["Office & School Supplies > Office Supplies > Writing Instruments", "Office Supplies > Office Instruments > Writing & Drawing Instruments"],
  "filing & accessories": ["Office & School Supplies > Office Supplies > Filing & Organization", "Office Supplies > Filing & Organization"],
  "paper products": ["Office & School Supplies > Office Supplies > Paper Products", "Office Supplies > General Office Supplies > Paper Products"],
  "general office": ["Office & School Supplies > Office Supplies > General Office Supplies", "Office Supplies > General Office Supplies"],
  "school & art supplies": ["Housewares > School & Office Supplies > School & Art Supplies", "Office Supplies > Office Instruments"],
  "packaging, shipping & mailing": ["Housewares > School & Office Supplies > Mailing Supplies", "Office Supplies > Shipping Supplies"],
  "boards & easels": ["Housewares > School & Office Supplies > Bulletin & Dry Erase Boards", "Office Supplies > Presentation Supplies > Display Boards"],
  "dated goods": ["Office & School Supplies > Office Supplies > Calendars & Planners", "Office Supplies > Calendars, Organizers & Planners"],
  "teaching & education": ["Office & School Supplies > Office Supplies > Teaching & Education", "Office Supplies > Educational Supplies"],
  "binders": ["Office & School Supplies > Office Supplies > Folders, Binders, & Indexes", "Office Supplies > Filing & Organization > Binding Supplies > Binders"],
  "labels & badges": ["Housewares > School & Office Supplies > Labels", "Office Supplies > General Office Supplies > Labels & Tags"],
  "indexes & sheet protectors": ["Office & School Supplies > Office Supplies > Indexes & Sheet Protectors", "Office Supplies > Filing & Organization > Binding Supplies > Binder Accessories > Sheet Protectors"],
  "desk accessories": ["Office & School Supplies > Office Supplies > Desk Accessories", "Office Supplies > Desk Pads & Blotters"],
  "glues & adhesives": ["Office & School Supplies > Office Supplies > Adhesives & Glue", "Office Supplies > General Office Supplies > Glue"],
  "cut sheet paper, premium": ["Office & School Supplies > Office Supplies > Copy & Printer Paper", "Office Supplies > General Office Supplies > Paper Products > Printer & Copier Paper"],
  "cut sheet paper, commodity": ["Office & School Supplies > Office Supplies > Copy & Printer Paper", "Office Supplies > General Office Supplies > Paper Products > Printer & Copier Paper"],
  "business forms & record keeping": ["Office & School Supplies > Office Supplies > Business Forms & Record Keeping", "Office Supplies > Filing & Organization"],
  "sticky notes & flags": ["Housewares > School & Office Supplies > Sticky/Post-It Notes", "Office Supplies > General Office Supplies > Sticky Notes"],
  "stapling & punches": ["Housewares > School & Office Supplies > Staplers & Sharpeners", "Office Supplies > Office Instruments > Staplers"],
  "binding & lamination": ["Office & School Supplies > Office Supplies > Binding & Lamination", "Office Supplies > Filing & Organization > Binding Supplies"],
  "report covers": ["Office & School Supplies > Office Supplies > Report Covers", "Office Supplies > Filing & Organization > Report Covers"],
  "scissors & trimmers": ["Office & School Supplies > Office Supplies > Scissors & Trimmers", "Office Supplies > Office Instruments > Scissors"],
  "clips & rubber bands": ["Office & School Supplies > Office Supplies > Clips & Rubber Bands", "Office Supplies > General Office Supplies > Paper Clips & Clamps"],
  "cards & card storage": ["Office & School Supplies > Office Supplies > Cards & Card Storage", "Office Supplies > Filing & Organization"],
  "record storage": ["Office & School Supplies > Office Supplies > Record Storage", "Office Supplies > Filing & Organization > File Boxes"],
  "cash handling": ["Office & School Supplies > Office Supplies > Cash Handling", "Business & Industrial > Retail > Money Handling"],
  "drafting supplies": ["Office & School Supplies > Office Supplies > Drafting Supplies", "Office Supplies > Office Instruments > Drafting Supplies"],
  "tape": ["Hardware, Building Materials, & Fasteners > Adhesives > Tape", "Hardware > Adhesives, Coatings & Sealants > Tape"],
  "batteries & chargers": ["Lighting & Electrical > Batteries > Batteries & Chargers", "Electronics > Electronics Accessories > Batteries"],
  "shredders": ["Office & School Supplies > Office Supplies > Shredders", "Office Supplies > Office Equipment > Paper Shredders"],
  "literature files": ["Office & School Supplies > Office Supplies > Literature Files", "Office Supplies > Filing & Organization"],
  "office supplies (nl)": ["", ""],

  "personal protection equipment": ["Safety & Security > Personal Protective Equipment (PPE)", "Business & Industrial > Work Safety Protective Gear"],
  "traffic & pedestrian safety": ["Safety & Security > Facility Safety > Traffic & Parking Lot Safety", "Business & Industrial > Construction > Traffic Cones & Barrels"],
  "first aid": ["Safety & Security > First Aid", "Health & Beauty > Health Care > First Aid"],
  "fire, gas & water safety": ["Safety & Security > Facility Safety > Fire, Gas & Water Safety", "Home & Garden > Household Safety"],
  "safety lighting": ["Safety & Security > Safety Lighting", "Business & Industrial > Work Safety Protective Gear"],
  "security": ["Safety & Security > Security", "Home & Garden > Household Safety > Security"],
  "spill control": ["Safety & Security > Spill Control", "Business & Industrial > Work Safety Protective Gear"],

  "table top, disposable": ["Food Service & Hospitality > Food Service > Disposable Tableware", "Home & Garden > Kitchen & Dining > Disposable Tableware"],
  "food preparation": ["Food Service & Hospitality > Food Preparation", "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils"],
  "carry-out": ["Food Service & Hospitality > Food Service > Takeout Containers", "Home & Garden > Kitchen & Dining > Food Storage"],
  "catering": ["Food Service & Hospitality > Food Service > Catering Supplies", "Business & Industrial > Food Service"],
  "beverages": ["Housewares > Beverages & Snacks > Beverages", "Food, Beverages & Tobacco > Beverages"],
  "food products": ["Food Service & Hospitality > Food, Snacks, Beverages & Vending Machines > Food Products", "Food, Beverages & Tobacco > Food Items"],
  "beverage supplies": ["Food Service & Hospitality > Food Service > Beverage Supplies", "Home & Garden > Kitchen & Dining > Drinkware"],
  "kitchen supplies": ["Food Service & Hospitality > Food Preparation > Kitchen Supplies", "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils"],
  "equipment & appliances": ["Food Service & Hospitality > Food Service Equipment & Appliances", "Business & Industrial > Food Service"],
  "food & beverage service": ["Food Service & Hospitality > Food Service > Tableware, Bar, & Buffet", "Home & Garden > Kitchen & Dining"],
  "table top, reusable": ["Food Service & Hospitality > Food Service > Reusable Tableware", "Home & Garden > Kitchen & Dining > Tableware"],
  "kitchen furniture": ["Food Service & Hospitality > Kitchen Furniture", "Furniture > Kitchen & Dining Room Furniture"],
  "disposables & dispensers": ["Food Service & Hospitality > Food Service > Disposables & Dispensers", "Business & Industrial > Food Service"],

  "personal care": ["Cleaning, Janitorial, & Maintenance > Restroom & Kitchen > Personal Care & Hygiene", "Health & Beauty > Personal Care"],
  "health": ["Cleaning, Janitorial, & Maintenance > Restroom & Kitchen > Health & Hygiene", "Health & Beauty > Health Care"],
  "medical": ["Cleaning, Janitorial, & Maintenance > Restroom & Kitchen > Medical Supplies", "Health & Beauty > Health Care"],
  "cleaning chemicals": ["Cleaning, Janitorial, & Maintenance > Cleaning Chemicals", "Home & Garden > Household Supplies > Household Cleaning Supplies"],
  "odor control": ["Cleaning, Janitorial, & Maintenance > Cleaning Chemicals > Odor Control", "Home & Garden > Household Supplies > Household Cleaning Supplies > Odor Removers"],
  "floor care": ["Cleaning, Janitorial, & Maintenance > Vacuums and Floor Care Machines > Floor Care", "Home & Garden > Household Appliances > Floor & Steam Cleaners"],
  "towel/tissue": ["Cleaning, Janitorial, & Maintenance > Paper Goods > Tissues & Paper Towels", "Home & Garden > Household Supplies > Household Paper Products"],
  "cleaning equipment": ["Cleaning, Janitorial, & Maintenance > Cleaning Equipment", "Home & Garden > Household Supplies > Cleaning Tools"],
  "waste receptacles": ["Cleaning, Janitorial, & Maintenance > Trash & Recycling > Trash Receptacles", "Home & Garden > Household Supplies > Trash Cans & Wastebaskets"],
  "trash receptacles": ["Cleaning, Janitorial, & Maintenance > Trash & Recycling > Trash Receptacles", "Home & Garden > Household Supplies > Trash Cans & Wastebaskets"],
  "can liners/bags": ["Cleaning, Janitorial, & Maintenance > Trash & Recycling > Trash Bags", "Home & Garden > Household Supplies > Trash Bags"],
  "washroom fixtures & supplies": ["Cleaning, Janitorial, & Maintenance > Restroom & Kitchen > Restroom Equipment & Supplies", "Home & Garden > Household Supplies"],
  "material handling": ["Warehouse, Storage, & Material Handling > Material Handling", "Business & Industrial > Material Handling"],
  "hvac": ["Plumbing, Heating & Ventilation > HVAC Parts & Accessories", "Hardware > Heating, Ventilation & Air Conditioning"],
  "maintenance equipment": ["Cleaning, Janitorial, & Maintenance > Facilities Maintenance > Maintenance Equipment", "Business & Industrial > Janitorial Carts & Caddies"],
  "adhesives & lubricants": ["Hardware, Building Materials, & Fasteners > Adhesives & Lubricants", "Hardware > Adhesives, Coatings & Sealants"],
  "insect & weed control": ["Cleaning, Janitorial, & Maintenance > Facilities Maintenance > Pest & Weed Control", "Home & Garden > Lawn & Garden > Weed Control"],
  "storage": ["Cleaning, Janitorial, & Maintenance > Facilities Maintenance > Storage", "Home & Garden > Storage & Organization"],
  "floor machine supplies & accessories": ["Cleaning, Janitorial, & Maintenance > Vacuums & Floor Care Machines > Floor Machine Supplies & Accessories", "Home & Garden > Household Appliance Accessories"],
  "cleaners & detergents": ["Cleaning, Janitorial, & Maintenance > Cleaning Chemicals > Cleaners & Detergents", "Home & Garden > Household Supplies > Household Cleaning Supplies"],
  "floor cleaners": ["Cleaning, Janitorial, & Maintenance > Cleaning Chemicals > Floor Cleaners", "Home & Garden > Household Supplies > Household Cleaning Supplies"],
  "paper dispenser": ["Cleaning, Janitorial, & Maintenance > Restroom Supplies > Paper Dispensers", "Home & Garden > Household Supplies > Household Paper Product Dispensers"],

  "seating": ["Furniture > Seating", "Furniture > Chairs"],
  "tables": ["Furniture > Tables", "Furniture > Tables"],
  "desks & workstations": ["Furniture > Office Furniture > Desks & Workstations", "Furniture > Office Furniture > Desks"],
  "storage & shelving": ["Furniture > Storage & Shelving", "Furniture > Shelving"],
  "furniture accessories": ["Furniture > Furniture Accessories", "Furniture > Furniture Accessories"],
  "file cabinets": ["Furniture > Files > File Cabinets", "Furniture > Cabinets & Storage > File Cabinets"],
  "file cabinets, specialty": ["Furniture > Files > Specialty File Cabinets", "Furniture > Cabinets & Storage > File Cabinets"],
  "file cabinet accessories": ["Furniture > Files > File Cabinet Accessories", "Furniture > Cabinets & Storage > File Cabinets"],
  "chair mats": ["Furniture > Furniture Accessories > Chair Mats", "Furniture > Furniture Accessories"],
  "credenzas & hutches": ["Furniture > Office Furniture > Credenzas & Hutches", "Furniture > Office Furniture"],
  "panels & accessories": ["Furniture > Office Furniture > Panels & Accessories", "Furniture > Office Furniture"],
  "presentation equipment": ["Furniture > Office Decor > Presentation Equipment", "Office Supplies > Presentation Supplies"],

  "tools & hardware": ["Tools & Test Equipment > Hand Tools > Tools & Hardware", "Hardware > Tools"],
  "industrial paint": ["Paint > Industrial Paint", "Hardware > Paint & Coatings"],
  "plumbing": ["Pumps & Plumbing > Plumbing", "Hardware > Plumbing"],
  "machinery": ["Tools & Test Equipment > Machinery", "Hardware > Tools"],
  "electrical supplies": ["Electrical > Electrical Supplies", "Hardware > Electrical Supplies"]
}));

function lookupLeafRule(vendorCategory = "") {
  const parts = formatCategoryName(vendorCategory).split(">").map((part) => part.trim()).filter(Boolean);
  const leaf = (parts.at(-1) || "").toLowerCase();
  return leafMap.get(leaf) || null;
}

function resolveMainCategory(vendorCategory, branchChecker) {
  const clean = formatCategoryName(vendorCategory);
  if (!clean || clean === "Uncategorized" || /^>/.test(sourceText(vendorCategory)) || clean === "> >") {
    return { mainCategory: "", confidence: 0, source: "skipped-invalid", reason: "Blank or uncategorized vendor category." };
  }
  if (branchChecker.hasExact(clean)) {
    return { mainCategory: clean, confidence: 100, source: "true-value-exact", reason: "Exact main category already exists." };
  }
  const rule = lookupLeafRule(clean);
  if (!rule || !rule[0]) {
    return { mainCategory: "", confidence: 0, source: "skipped-no-rule", reason: "No conservative True Value branch rule." };
  }
  const [target, googleSearch] = rule;
  const top = target.split(">").map((part) => part.trim()).filter(Boolean)[0] || "";
  if (!branchChecker.hasBranch(top)) {
    return { mainCategory: "", confidence: 0, source: "skipped-missing-branch", reason: `True Value branch "${top}" was not found.` };
  }
  return {
    mainCategory: formatCategoryName(target),
    googleSearch,
    confidence: 92,
    source: branchChecker.hasExact(target) ? "true-value-existing-related" : "true-value-branch-created",
    reason: branchChecker.hasExact(target) ? "Related main category already exists." : "Created under an existing True Value branch."
  };
}

async function main() {
  loadEnv();
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const dryRun = process.argv.includes("--dry-run");
  const taxonomy = taxonomyRows();
  const mainRows = await postgres.listCategoryProductStats();
  const mainCategories = mainRows.map((row) => row.name || row.category || "").filter(Boolean);
  const branchChecker = buildBranchChecker(mainCategories);
  const [existingMappings, existingSettings, sourceRows] = await Promise.all([
    postgres.readStateField("vendorCategoryMappings").catch(() => ({})),
    postgres.readStateField("categorySettings").catch(() => []),
    postgres.listVendorCategoryMappingSources({ supplier: SUPPLIER, limit: 1000 })
  ]);
  const mappings = existingMappings && typeof existingMappings === "object" ? { ...existingMappings } : {};
  const settingsByName = new Map((Array.isArray(existingSettings) ? existingSettings : []).map((row) => [normalizedKey(row.name || row.category), normalizeCategorySetting(row)]));
  const now = new Date().toISOString();
  const report = {
    dryRun,
    supplier: SUPPLIER,
    sourceCategories: sourceRows.length,
    existingMainCategories: mainCategories.length,
    mapped: [],
    createdCategories: [],
    updatedExistingMappings: [],
    skipped: [],
    productsUpdated: 0
  };

  for (const row of sourceRows) {
    const vendorCategory = formatCategoryName(row.vendorCategory);
    const key = mappingKey(SUPPLIER, vendorCategory);
    const previous = mappings[key];
    if (previous?.mainCategory) continue;
    const resolved = resolveMainCategory(row.vendorCategory, branchChecker);
    if (!resolved.mainCategory) {
      report.skipped.push({ vendorCategory, matchCount: row.matchCount, sampleSku: row.sampleSku, reason: resolved.reason, source: resolved.source });
      continue;
    }
    const mainCategory = resolved.mainCategory;
    const googleMapping = findTaxonomyMapping(taxonomy, resolved.googleSearch || mainCategory);
    const categoryKey = normalizedKey(mainCategory);
    const existingSetting = settingsByName.get(categoryKey);
    const setting = normalizeCategorySetting(existingSetting || {
      name: mainCategory,
      status: resolved.source === "true-value-branch-created" ? "needs_review" : "mapped",
      notes: `${resolved.reason} Essendant vendor category: ${vendorCategory}.`,
      createdSource: resolved.source,
      createdBy: "System - Category Prefill"
    });
    if (googleMapping && (!setting.mappings.shopify.categoryId || /prefill|fallback|auto/i.test(setting.mappings.shopify.notes || ""))) {
      setting.mappings.shopify = normalizeChannelMapping(googleMapping);
    }
    setting.updatedAt = now;
    settingsByName.set(categoryKey, setting);

    mappings[key] = {
      ...(previous || {}),
      supplier: SUPPLIER,
      vendorCategory,
      mainCategory,
      categoryVerified: true,
      source: resolved.source,
      sampleSku: previous?.sampleSku || row.sampleSku || "",
      matchCount: Number(row.matchCount || previous?.matchCount || 0),
      conflictCount: Number(previous?.conflictCount || 0),
      confidence: resolved.confidence,
      notes: resolved.reason,
      updatedAt: now,
      createdAt: previous?.createdAt || now
    };
    if (existingSetting) report.updatedExistingMappings.push({ vendorCategory, mainCategory, matchCount: row.matchCount, source: resolved.source });
    else report.createdCategories.push({ mainCategory, fromVendorCategory: vendorCategory, googleCategory: googleMapping?.googleCategory?.breadcrumb || googleMapping?.categoryPath || "", source: resolved.source });
    report.mapped.push({ vendorCategory, mainCategory, matchCount: row.matchCount, sampleSku: row.sampleSku, source: resolved.source, googleCategory: googleMapping?.googleCategory?.breadcrumb || googleMapping?.categoryPath || "" });
  }

  const nextSettings = [...settingsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `essendant-category-prefill-${new Date().toISOString().replace(/[:.]/g, "-")}${dryRun ? "-dry-run" : ""}.json`);
  if (!dryRun) {
    await postgres.writeStateDocuments({ vendorCategoryMappings: mappings, categorySettings: nextSettings });
    await postgres.upsertCategoryChannelMappingsFromState(nextSettings);
    for (const mapped of report.mapped) {
      const result = await postgres.applyVendorCategoryMainMapping({ supplier: SUPPLIER, vendorCategory: mapped.vendorCategory, mainCategory: mapped.mainCategory });
      report.productsUpdated += Number(result?.updatedProducts || 0);
    }
  }
  fs.writeFileSync(out, JSON.stringify({ ...report, totalMappings: Object.keys(mappings).length, totalCategorySettings: nextSettings.length }, null, 2));
  console.log(JSON.stringify({
    dryRun,
    output: out,
    sourceCategories: report.sourceCategories,
    mapped: report.mapped.length,
    skipped: report.skipped.length,
    createdCategories: report.createdCategories.length,
    productsUpdated: report.productsUpdated,
    totalMappings: Object.keys(mappings).length,
    totalCategorySettings: nextSettings.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
