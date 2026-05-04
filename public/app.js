let state = null;
let selectedOrderId = null;
let selectedProductId = null;
let orderDetailVisible = false;
let selectedOrderIds = new Set();
let purchasingTab = "pos";
let catalogTab = "products";
let sourceCatalogPage = 1;
let sourceCatalogState = { items: [], totalMatches: 0, hasMore: false, manifest: null, query: "", loading: false };
let sourceCatalogRequestId = 0;
let sourceCatalogFacets = null;
let selectedSourceSuppliers = new Set();
let supplierMultiOpen = false;
let categoryState = { categories: [], total: 0, query: "", scope: "main", loading: false };
let categoryScope = "main";
let categoryRequestId = 0;
let selectedCategoryId = null;
let shopifyTaxonomyState = { categoryId: null, query: "", results: [], total: 0, version: "", loading: false };
let shopifyTaxonomyTimer = null;
let selectedExportMappingId = null;
let activeExportMappingPageId = null;
let activeImportSection = "products";
let mappingDraftDirty = false;
let productFieldOptions = null;
let pendingProductImport = { templateId: null, fileName: "", csv: "", preview: null, mode: "mapped" };
let selectedSourceSkus = new Set();
let selectedSourceAllFiltered = false;
let pendingSourceSkuImport = { fileName: "", csv: "", skus: [], result: null, running: false, error: "" };
let selectedProductIds = new Set();
let selectedProductAllFiltered = false;
let productAlternatesCache = {};
let selectedProductWorkspaceTab = "home";
let selectedProductGalleryImageById = {};
let pendingProductImageManager = { productId: null, images: [], defaultImage: "" };
let pendingProductBulletManager = { productId: null, bulletPoints: [] };
let productCatalogPage = 1;
let inventoryCatalogPage = 1;
const PRODUCT_CATALOG_PAGE_SIZE = 100;
let productFilterOptionsCache = { inventoryCount: -1, suppliers: [], stockStatuses: [], shopifyStatuses: [], brands: [], categories: [] };
let inventoryById = new Map();
let activeApiRequests = 0;
let selectedPoId = null;
let selectedVendorId = null;
let selectedCustomerId = null;
let selectedBrandId = null;
let selectedWarehouseId = null;
let warehouseBinModalWarehouseId = null;
let transferProductId = null;
let reserveOrderModalId = null;
let shadowModalProductId = null;
let selectedShadowId = null;
let selectedTemplateId = null;
let selectedChannelId = null;
let fulfillmentOrderId = null;
let receivingPoId = null;
let receiveAttachments = [];
let selectedReceiptRef = null;
let returnOrderId = null;
let selectedReturnWorkflowId = null;
let returnDraftAttachments = [];
let returnReceiveAttachments = [];
let returnWorkflowAttachments = [];
let pendingPoCreateOrderIds = [];
let duplicatePoTargetId = null;
let editingDraftId = null;
let selectedDraftId = null;
let editOrderModalId = null;
let refundOrderModalId = null;
let selectedReturnId = null;
let currentViewId = "dashboard";
let menuGroupsExpanded = localStorage.getItem("dataplus-menu-groups-expanded") === "true";
let themeMode = localStorage.getItem("dataplus-theme") || "light";
let jobsFilter = { query: "", section: "", status: "", direction: "" };
let selectedImportJobId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

// Icons are inline SVGs from the open-source Lucide icon set (ISC license).
const LUCIDE_ICONS = {
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "badge-check": '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.78 4.78 4 4 0 0 1-6.74 0 4 4 0 0 1-4.78-4.78 4 4 0 0 1 0-6.75Z"/><path d="m9 12 2 2 4-4"/>',
  "bar-chart-3": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  "boxes": '<path d="M2.97 12.92 12 17.5l9.03-4.58"/><path d="M2.97 17.92 12 22.5l9.03-4.58"/><path d="M12 2 2.97 6.58 12 11.16l9.03-4.58L12 2Z"/>',
  "clipboard-check": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  "clipboard-list": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
  "dollar-sign": '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
  "edit-3": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  "file-pen-line": '<path d="m18 5-2.4-2.4A2 2 0 0 0 14.2 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6 8 15l1 1 2.4-2.4"/><path d="m14 9 1 1"/>',
  "fingerprint": '<path d="M2 12c0-2.8 0-4.2.54-5.27A5 5 0 0 1 4.73 4.54C5.8 4 7.2 4 10 4h4c2.8 0 4.2 0 5.27.54a5 5 0 0 1 2.19 2.19C22 7.8 22 9.2 22 12"/><path d="M6 12a6 6 0 0 1 12 0v2"/><path d="M9 12a3 3 0 0 1 6 0v6"/><path d="M12 12v10"/>',
  "gauge": '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  "home": '<path d="m3 10 9-7 9 7"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/><path d="M9 21v-6h6v6"/>',
  "image": '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  "layout-template": '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>',
  "list-check": '<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/>',
  "moon": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  "package": '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "radio": '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2a6 6 0 0 1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  "ruler": '<path d="m16 2 6 6L8 22l-6-6Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
  "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "shopping-bag": '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  "shopping-cart": '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57L21.9 7H5.12"/>',
  "store": '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-6a3 3 0 0 0-6 0v6"/><path d="M2 7h20"/><path d="M2 7v3a2 2 0 1 0 4 0V7"/><path d="M6 7v3a2 2 0 1 0 4 0V7"/><path d="M10 7v3a2 2 0 1 0 4 0V7"/><path d="M14 7v3a2 2 0 1 0 4 0V7"/><path d="M18 7v3a2 2 0 1 0 4 0V7"/>',
  "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  "tags": '<path d="M9 5H2v7l8.29 8.29a2.83 2.83 0 0 0 4 0l3-3a2.83 2.83 0 0 0 0-4Z"/><path d="M6 9.01V9"/><path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L19 17"/>',
  "truck": '<path d="M10 17h4V5H2v12h3"/><path d="M14 17h1"/><path d="M19 17h3v-3.34a2 2 0 0 0-.34-1.11L19 9h-5"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M19 6l-1 14c-.1 1-1 2-2 2H8c-1 0-1.9-1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "warehouse": '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>'
};

function iconMarkup(name, className = "") {
  const paths = LUCIDE_ICONS[name];
  if (!paths) return "";
  const classes = ["app-icon", className].filter(Boolean).join(" ");
  return '<svg class="' + classes + '" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
}

function withIcon(name, label, className = "") {
  return iconMarkup(name, className) + '<span>' + html(label) + '</span>';
}

function sectionIconTitle(name, label) {
  return '<strong class="icon-title">' + iconMarkup(name) + '<span>' + html(label) + '</span></strong>';
}

function iconElement(name, className = "") {
  const template = document.createElement("template");
  template.innerHTML = iconMarkup(name, className).trim();
  return template.content.firstElementChild;
}

function hydrateStaticIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    if (element.dataset.iconHydrated === "true") return;
    const svg = iconElement(element.dataset.icon, element.dataset.iconClass || "");
    if (!svg) return;
    element.prepend(svg);
    element.dataset.iconHydrated = "true";
  });
}

async function api(path, options = {}) {
  activeApiRequests += 1;
  setSavingIndicator(true, options.method && options.method !== "GET" ? "Saving..." : "Loading...");
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!response.ok) throw new Error((await response.json()).error || "Request failed");
    return response.json();
  } finally {
    activeApiRequests = Math.max(0, activeApiRequests - 1);
    if (!activeApiRequests) setSavingIndicator(false);
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function dateLabel(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function simpleDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function fileSizeLabel(value) {
  const size = Number(value || 0);
  if (!size) return "0 B";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productImageUrls(item = {}) {
  const images = Array.isArray(item.images)
    ? item.images
    : String(item.images || "").split(/[\n|,]/);
  return [...new Set([
    item.defaultImage || item.default_image,
    ...images,
    item.originalImage || item.original_image
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

function productEditableImageUrls(item = {}) {
  const images = Array.isArray(item.images)
    ? item.images
    : String(item.images || "").split(/[\n|,]/);
  return [...new Set([
    item.defaultImage || item.default_image,
    ...images
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

function productBulletPoints(item = {}) {
  const bullets = Array.isArray(item.bulletPoints)
    ? item.bulletPoints
    : String(item.bulletPoints || item.bullet_points || "").split(/[\n|]/);
  return bullets.map((value) => String(value || "").trim()).filter(Boolean);
}

function renderProductBulletSection(item) {
  const bullets = productBulletPoints(item);
  const preview = bullets.slice(0, 5);
  return `
    <section class="product-bullets-panel">
      <div class="product-bullets-head">
        <div>
          ${sectionIconTitle("list-check", "Bullet points")}
          <span>${bullets.length || 0} bullet${bullets.length === 1 ? "" : "s"}</span>
        </div>
        <button class="button secondary compact-button" type="button" data-open-product-bullets="${item.id}">${bullets.length ? "Edit" : "Add"}</button>
      </div>
      ${preview.length ? `
        <ul class="product-bullet-preview">
          ${preview.map((bullet) => `<li>${html(bullet)}</li>`).join("")}
        </ul>
        ${bullets.length > preview.length ? `<p class="muted">+${bullets.length - preview.length} more bullet${bullets.length - preview.length === 1 ? "" : "s"}</p>` : ""}
      ` : `
        <p class="muted">No bullet points yet.</p>
      `}
    </section>
  `;
}

function calculateDimensionalWeight(item = {}) {
  const length = Number(item.packageLength || 0);
  const width = Number(item.packageWidth || 0);
  const height = Number(item.packageHeight || 0);
  if (!(length > 0 && width > 0 && height > 0)) return 0;
  return Math.round(((length * width * height) / 139) * 1000) / 1000;
}

function productDimensionInput(label, field, item) {
  return `
    <label>
      <span>${html(label)}</span>
      <input type="number" step="0.001" value="${html(item[field] ?? 0)}" data-product-field="${field}" data-product-dimension-field="${field}" data-product-id="${item.id}" />
    </label>
  `;
}

function renderProductDimensionsCard(item) {
  const dimensionalWeight = Number(item.dimensionalWeight ?? calculateDimensionalWeight(item) ?? 0);
  return `
    <section class="product-section-card product-section-orange">
      <div class="product-section-title">${sectionIconTitle("ruler", "Dimensions")}</div>
      <div class="dimension-editor">
        <div class="dimension-group">
          <div class="dimension-group-title"><strong>Item dimensions</strong><span>Length x Width x Height</span></div>
          <div class="dimension-triplet">
            ${productDimensionInput("Length", "itemLength", item)}
            ${productDimensionInput("Width", "itemWidth", item)}
            ${productDimensionInput("Height", "itemHeight", item)}
          </div>
        </div>
        <div class="dimension-group">
          <div class="dimension-group-title"><strong>Package dimensions</strong><span>Length x Width x Height</span></div>
          <div class="dimension-triplet">
            ${productDimensionInput("Length", "packageLength", item)}
            ${productDimensionInput("Width", "packageWidth", item)}
            ${productDimensionInput("Height", "packageHeight", item)}
          </div>
        </div>
        <div class="dimension-group">
          <div class="dimension-group-title"><strong>Weights</strong><span>Calculated from package dimensions</span></div>
          <div class="dimension-weight-grid">
            ${productDimensionInput("Item weight", "itemWeight", item)}
            ${productDimensionInput("Package weight", "packageWeight", item)}
            <label>
              <span>Dimensional weight</span>
              <input type="number" step="0.001" value="${html(dimensionalWeight)}" data-dimensional-weight-preview="${item.id}" readonly />
            </label>
          </div>
        </div>
      </div>
    </section>
  `;
}

function defaultReceivingWarehouse() {
  return (state.warehouses || []).find((warehouse) => warehouse.isDefaultReceiving && warehouse.status !== "inactive")
    || (state.warehouses || []).find((warehouse) => warehouse.status !== "inactive")
    || null;
}

function defaultReturnWarehouse() {
  return (state.warehouses || []).find((warehouse) => warehouse.isDefaultReturns && warehouse.status !== "inactive")
    || defaultReceivingWarehouse();
}

function defaultBinForWarehouse(warehouseId) {
  const warehouse = (state.warehouses || []).find((item) => item.id === warehouseId);
  return (warehouse?.bins || []).find((bin) => bin.isDefault && bin.active !== false)
    || (warehouse?.bins || []).find((bin) => bin.active !== false)
    || null;
}

function profitFor(order) {
  return Number(order.total || 0) - Number(order.productCost || 0) - Number(order.marketplaceFees || 0) - Number(order.shippingCost || 0) - Number(order.refundAmount || 0);
}

function marginPercent(profit, revenue) {
  const total = Number(revenue || 0);
  if (!total) return 0;
  return (Number(profit || 0) / total) * 100;
}

function refundDueFor(order = {}) {
  const linkedReturns = (state?.returns || []).filter((record) => {
    const status = String(record.status || "").toLowerCase();
    return (record.orderId === order.id || record.orderNumber === order.orderNumber) && ["resolved", "done"].includes(status);
  });
  const refundTarget = linkedReturns.reduce((sum, record) => sum + Math.max(0, Number(record.amount || 0) - Number(record.returnFee || 0)), 0);
  return Math.max(0, refundTarget - Number(order.refundAmount || 0));
}

function shortenTitle(value, max = 44) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function returnStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "requested") return "Pending receipt";
  if (value === "received") return "Ready to complete";
  if (["resolved", "done"].includes(value)) return "Completed";
  return String(status || "Requested");
}

function returnStatusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "requested") return "hold";
  if (value === "received") return "pending";
  if (["resolved", "done"].includes(value)) return "confirmed";
  return value || "draft";
}

function renderLineItemTable(items = [], options = {}) {
  const rows = items.map((item, index) => {
    const qty = Math.max(1, Number(item.qty || 1));
    const price = Number(item.price || 0);
    const cost = Number(item.cost ?? options.costForLine?.(item, index) ?? 0);
    const lineMargin = marginPercent(price - cost, price);
    return `
      <div class="line-item-grid-row">
        <span class="line-item-sku">${html(item.sku || "")}</span>
        <span class="line-item-title" title="${html(item.title || item.sku || "")}">${html(shortenTitle(item.title || item.sku || "", options.maxTitle || 44))}</span>
        <span>${money(price)}</span>
        <span>${money(cost)}</span>
        <span>${lineMargin.toFixed(1)}%</span>
        <span>${qty}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="line-item-grid">
      <div class="line-item-grid-head">
        <span>SKU</span>
        <span>Shortened Product Title</span>
        <span>Price</span>
        <span>Cost</span>
        <span>Profit %</span>
        <span>Qty</span>
      </div>
      ${rows || `<p class="muted">No line items yet.</p>`}
    </div>
  `;
}

function orderItems(order = {}) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return [{ sku: order.sku || "", title: order.title || order.sku || "", qty: Number(order.qty || 1), price: Number(order.total || 0), cost: Number(order.productCost || 0) }];
}

function orderItemRemainingQty(order = {}, line = {}, index = 0) {
  const fulfilled = Array.isArray(order.fulfillmentLines) ? order.fulfillmentLines : [];
  const match = fulfilled.find((entry) => String(entry.sku || "").toLowerCase() === String(line.sku || "").toLowerCase() && Number(entry.lineIndex ?? index) === index)
    || fulfilled.find((entry) => String(entry.sku || "").toLowerCase() === String(line.sku || "").toLowerCase());
  return Math.max(0, Number(line.qty || 0) - Number(match?.qtyFulfilled || 0));
}

function imageAttachmentsMarkup(attachments = [], emptyLabel = "No images attached.") {
  if (!attachments.length) return `<p class="muted">${html(emptyLabel)}</p>`;
  return `
    <div class="receive-attachments-gallery">
      ${attachments.map((file) => `
        <article class="receive-attachment-item image-attachment-item">
          ${file.dataUrl ? `<img src="${html(file.dataUrl)}" alt="${html(file.name || "Attachment")}" class="image-attachment-preview" />` : ""}
          <div>
            <strong>${html(file.name || "Attachment")}</strong>
            <small>${html(file.source || "Manual upload")} / ${fileSizeLabel(file.size)}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderReturnAttachmentList(targetSelector, attachments = [], removeAttr, emptyLabel) {
  const target = $(targetSelector);
  if (!target) return;
  target.innerHTML = attachments.length
    ? attachments.map((file, index) => `
      <div class="receive-attachment-item">
        <div>
          <strong>${html(file.name)}</strong>
          <small>${html(file.source || "File picker")} / ${fileSizeLabel(file.size)}</small>
        </div>
        <button type="button" class="text-button" ${removeAttr}="${index}">Remove</button>
      </div>
    `).join("")
    : `<p class="muted">${html(emptyLabel)}</p>`;
}

async function readImageAttachments(files = [], source = "File picker") {
  const results = [];
  for (const file of files) {
    if (!String(file.type || "").startsWith("image/")) continue;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read image."));
      reader.readAsDataURL(file);
    });
    results.push({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type,
      source,
      dataUrl
    });
  }
  return results;
}

function collectModalLineItems(containerSelector, qtyAttr) {
  return $$(`${containerSelector} [${qtyAttr}]`).map((input) => ({
    sku: String(input.dataset.sku || "").trim(),
    title: String(input.dataset.title || "").trim(),
    price: Number(input.dataset.price || 0),
    cost: Number(input.dataset.cost || 0),
    qty: Number(input.dataset.qty || 0),
    qtySelected: Number(input.value || 0),
    lineIndex: Number(input.dataset.lineIndex || 0)
  })).filter((line) => line.qtySelected > 0);
}

function refundItemsSummary(refund = {}) {
  const items = Array.isArray(refund.items) ? refund.items : [];
  if (!items.length) return "Order-level refund";
  return items.map((item) => `${item.sku}${Number(item.qty || 0) > 1 ? ` x${Number(item.qty || 0)}` : ""}`).join(", ");
}

function refundedQtyForLine(order = {}, line = {}, index = 0) {
  return (Array.isArray(order.refunds) ? order.refunds : []).reduce((sum, refund) => {
    const refundItems = Array.isArray(refund.items) ? refund.items : [];
    const match = refundItems.find((item) => Number(item.lineIndex ?? -1) === index && String(item.sku || "").toLowerCase() === String(line.sku || "").toLowerCase())
      || refundItems.find((item) => String(item.sku || "").toLowerCase() === String(line.sku || "").toLowerCase());
    return sum + Number(match?.qty || 0);
  }, 0);
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2600);
}

function setSavingIndicator(active, label = "Saving...") {
  const progress = $("#global-save-progress");
  const status = $("#global-save-status");
  if (!progress || !status) return;
  status.textContent = label;
  document.body.classList.toggle("is-saving", active);
  progress.setAttribute("aria-hidden", active ? "false" : "true");
}

function closeActionMenus() {
  document.querySelectorAll(".action-popover.open").forEach((menu) => menu.classList.remove("open"));
}

function productById(id) {
  return inventoryById.get(id) || null;
}

function setState(nextState) {
  state = nextState;
  inventoryById = new Map((state.inventory || []).map((item) => [item.id, item]));
  if (!selectedOrderId || !state.orders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = state.orders[0]?.id || null;
  }
  if (!selectedProductId || !inventoryById.has(selectedProductId)) {
    selectedProductId = state.inventory[0]?.id || null;
  }
  if (selectedShadowId && !state.inventory.some((item) => (item.shadowSkus || []).some((shadow) => shadow.id === selectedShadowId))) {
    selectedShadowId = null;
  }
  if (!selectedTemplateId || !(state.marketplaceTemplates || []).some((template) => template.id === selectedTemplateId)) {
    selectedTemplateId = state.marketplaceTemplates?.[0]?.id || null;
  }
  if (!selectedExportMappingId || !(state.exportMappings || []).some((template) => template.id === selectedExportMappingId)) {
    selectedExportMappingId = state.exportMappings?.[0]?.id || null;
  }
  if (!selectedChannelId || !(state.connections || []).some((channel) => channel.id === selectedChannelId)) {
    selectedChannelId = state.connections?.[0]?.id || null;
  }
  if (!selectedCustomerId || !(state.customers || []).some((customer) => customer.id === selectedCustomerId)) {
    selectedCustomerId = state.customers?.[0]?.id || null;
  }
  if (!selectedPoId || !(state.purchaseOrders || []).some((po) => po.id === selectedPoId)) {
    selectedPoId = state.purchaseOrders?.[0]?.id || null;
  }
  if (!selectedBrandId || !(state.brands || []).some((brand) => brand.id === selectedBrandId)) {
    selectedBrandId = state.brands?.[0]?.id || null;
  }
  if (!selectedWarehouseId || !(state.warehouses || []).some((warehouse) => warehouse.id === selectedWarehouseId)) {
    selectedWarehouseId = state.warehouses?.[0]?.id || null;
  }
  if (!selectedDraftId || !(state.orderDrafts || []).some((draft) => draft.id === selectedDraftId)) {
    selectedDraftId = state.orderDrafts?.[0]?.id || null;
  }
  render();
}

function showView(id) {
  currentViewId = id;
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach((button) => {
    const active = button.dataset.view === id || (button.dataset.view === "orders" && ["drafts", "returns", "order-full", "draft-full", "return-full"].includes(id));
    button.classList.toggle("active", active);
  });
  $$(".nav-child").forEach((button) => {
    const active =
      button.dataset.view === id ||
      (button.dataset.view === "drafts" && id === "draft-full") ||
      (button.dataset.view === "returns" && id === "return-full") ||
      (button.dataset.view === "orders" && id === "order-full") ||
      (id === "purchasing" && button.dataset.purchasingTabLink === purchasingTab) ||
      (id === "catalog" && button.dataset.catalogTabLink === catalogTab);
    button.classList.toggle("active", active);
  });
  $("#page-title").textContent = ({ dashboard: "Dashboard", orders: "Orders", drafts: "Drafts", "draft-full": "Draft Details", returns: "Returns", "return-full": "Return Details", "order-full": "Order Details", purchasing: "Purchasing", "po-full": "Purchase Order", "vendor-full": "Vendor Profile", "brand-full": "Brand Profile", "warehouse-full": "Warehouse Profile", catalog: "Catalog", jobs: "Jobs", "import-export": "Import / Export", "product-full": "Product Details", "shadow-full": "Shadow SKU Details", "template-full": "Template Preview", "inventory-full": "Inventory Details", "customer-full": "Customer Profile", customers: "Customers", inventory: "Inventory", reports: "Reports", connections: "Channels", "channel-full": "Channel Settings" })[id];
  if (id === "order-full") renderFullOrderPage();
  if (id === "drafts") renderDrafts();
  if (id === "draft-full") renderDraftOrderPage();
  if (id === "returns") renderReturnsManagement();
  if (id === "return-full") renderReturnProfilePage();
  if (id === "po-full") renderPurchaseOrderProfile();
  if (id === "vendor-full") renderVendorProfile();
  if (id === "brand-full") renderBrandProfile();
  if (id === "warehouse-full") renderWarehouseProfile();
  if (id === "import-export") renderImportExportMappings();
  if (id === "jobs") renderJobsPage();
  if (id === "product-full") renderProductContentPage();
  if (id === "shadow-full") renderShadowSkuPage();
  if (id === "template-full") renderTemplatePreviewPage();
  if (id === "inventory-full") renderInventoryProductPage();
  if (id === "channel-full") renderChannelProfile();
  if (id === "customer-full") renderCustomerProfile();
  renderTopbarActions();
}

function renderTopbarActions() {
  const target = $("#topbar-actions-slot");
  if (!target) return;
  const actions = [];
  if (currentViewId === "orders") {
    actions.push(`<button data-create-po-selected>Create PO from selected</button>`);
    actions.push(`<button data-toggle-order-detail-action>Show / hide preview</button>`);
  } else if (currentViewId === "returns") {
    actions.push(`<button data-view-jump="reports">Open return analytics</button>`);
  } else if (currentViewId === "return-full") {
    const record = (state.returns || []).find((row) => row.id === selectedReturnId);
    if (record) {
      const status = String(record.status || "").toLowerCase();
      if (status === "requested") {
        actions.push(`<button data-open-return-receive="${record.id}">Receive return</button>`);
      } else if (status === "received") {
        actions.push(`<button data-open-return-receive="${record.id}">Complete return</button>`);
      }
      actions.push(`<button data-view-jump="returns">Back to returns</button>`);
    }
  } else if (currentViewId === "drafts") {
    actions.push(`<button data-open-manual-order>Create manual order</button>`);
    actions.push(`<button data-view-jump="orders">Open active orders</button>`);
  } else if (currentViewId === "draft-full") {
    const draft = (state.orderDrafts || []).find((row) => row.id === selectedDraftId);
    if (draft) {
      actions.push(`<button data-edit-draft="${draft.id}">Edit draft</button>`);
      actions.push(`<button data-duplicate-draft="${draft.id}">Duplicate draft</button>`);
      actions.push(`<button data-convert-draft="${draft.id}">Convert to order</button>`);
      actions.push(`<a href="/api/order-drafts/${draft.id}/export/pdf" target="_blank" rel="noreferrer">Export as PDF</a>`);
    }
  } else if (currentViewId === "order-full") {
    const order = (state.orders || []).find((row) => row.id === selectedOrderId);
    if (order) {
      actions.push(`<button data-open-order-refund="${order.id}">Refund</button>`);
      actions.push(`<button data-duplicate-order="${order.id}">Duplicate to draft</button>`);
      actions.push(`<button data-create-po-order="${order.id}">Create PO</button>`);
      actions.push(`<button data-open-order-reserve="${order.id}">Reserve inventory</button>`);
      actions.push(`<button data-open-order-return="${order.id}">Create return</button>`);
      actions.push(`<button data-order-action="approve" data-order-id="${order.id}">Approve order</button>`);
      actions.push(`<button data-order-action="hold" data-order-id="${order.id}">Put on hold</button>`);
      actions.push(`<button data-order-action="cancel" data-order-id="${order.id}">Cancel order</button>`);
    }
  } else if (currentViewId === "purchasing") {
    actions.push(`<button data-view-jump="orders">Create from orders</button>`);
    actions.push(`<button data-create-vendor>New vendor</button>`);
    actions.push(`<button data-create-brand>New brand</button>`);
    actions.push(`<button data-create-warehouse>New warehouse</button>`);
  } else if (currentViewId === "po-full") {
    const po = (state.purchaseOrders || []).find((row) => row.id === selectedPoId);
    if (po) {
      actions.push(`<button data-po-action="${po.id}" data-po-workflow="approve">Approve PO</button>`);
      actions.push(`<button data-open-po-receive="${po.id}">Receive inventory</button>`);
      actions.push(`<button data-po-submit="${po.id}" data-submit-method="preferred">Send to vendor</button>`);
      actions.push(`<button data-po-return="${po.id}">Create vendor return</button>`);
    }
  } else if (currentViewId === "vendor-full") {
    actions.push(`<button data-view-jump="orders">Create from orders</button>`);
    actions.push(`<button data-create-vendor>New vendor</button>`);
  } else if (currentViewId === "brand-full") {
    const brand = (state.brands || []).find((row) => row.id === selectedBrandId);
    if (brand) {
      actions.push(`<button data-brand-action="enable" data-brand-id="${brand.id}">Enable brand</button>`);
      actions.push(`<button data-brand-action="disable" data-brand-id="${brand.id}">Disable brand</button>`);
      actions.push(`<button data-brand-action="void" data-brand-id="${brand.id}">Void brand</button>`);
    }
  } else if (currentViewId === "warehouse-full") {
    const warehouse = (state.warehouses || []).find((row) => row.id === selectedWarehouseId);
    if (warehouse) {
      actions.push(`<button data-create-warehouse>New warehouse</button>`);
      actions.push(`<button data-open-warehouse-bin="${warehouse.id}">Add location</button>`);
      actions.push(`<button data-warehouse-status="${warehouse.id}" data-warehouse-status-value="active">Set active</button>`);
      actions.push(`<button data-warehouse-status="${warehouse.id}" data-warehouse-status-value="inactive">Set inactive</button>`);
    }
  } else if (currentViewId === "catalog") {
    actions.push(catalogTab === "inventory"
      ? `<a href="/api/export/inventory">Download inventory CSV</a>`
      : `<button data-view="catalog" data-catalog-tab-link="inventory">Open inventory</button>`);
    actions.push(`<button data-view="catalog" data-catalog-tab-link="products">Open products</button>`);
    actions.push(`<button data-view="catalog" data-catalog-tab-link="readiness">Open readiness</button>`);
  } else if (currentViewId === "jobs") {
    actions.push(`<button data-refresh-import-jobs>Refresh jobs</button>`);
    actions.push(`<button data-view-jump="import-export">Open import center</button>`);
  } else if (currentViewId === "product-full") {
    const item = productById(selectedProductId);
    if (item) {
      actions.push(`<button data-create-shadow="${item.id}">Create shadow SKU</button>`);
      actions.push(`<button data-bulk-create-shadows="${item.id}">Create all marketplace shadows</button>`);
      actions.push(`<button data-select-product="${item.id}" data-product-target="inventory-full">View inventory details</button>`);
    }
  } else if (currentViewId === "inventory-full") {
    const item = productById(selectedProductId);
    if (item) {
      actions.push(`<button data-select-product="${item.id}" data-product-target="product-full">Edit product content</button>`);
      actions.push(`<button data-open-inventory-transfer="${item.id}">Transfer stock</button>`);
      actions.push(`<a href="/api/export/inventory">Download inventory CSV</a>`);
    }
  } else if (currentViewId === "shadow-full") {
    const { product, shadow } = findShadowSelection();
    if (product && shadow) {
      actions.push(`<button data-select-product="${product.id}" data-product-target="product-full">Open parent product</button>`);
      actions.push(`<button data-select-product="${product.id}" data-product-target="inventory-full">Open inventory</button>`);
      actions.push(`<button data-shadow-sync="${shadow.id}" data-product-id="${product.id}">Sync to marketplace</button>`);
    }
  } else if (currentViewId === "template-full") {
    const template = (state.marketplaceTemplates || []).find((row) => row.id === selectedTemplateId);
    if (template) {
      actions.push(`<button data-template-action="duplicate" data-template-id="${template.id}">Duplicate template</button>`);
      actions.push(`<button data-template-action="reset" data-template-id="${template.id}">Reset to default</button>`);
    }
  } else if (currentViewId === "customers" || currentViewId === "customer-full") {
    actions.push(`<button data-create-customer>New customer</button>`);
    actions.push(`<button data-view-jump="orders">Open orders</button>`);
  } else if (currentViewId === "connections" || currentViewId === "channel-full") {
    actions.push(`<button id="topbar-sync-trigger" data-topbar-sync>Sync enabled channels</button>`);
    actions.push(`<button data-view-jump="connections">Open channels</button>`);
  } else if (currentViewId === "reports") {
    actions.push(`<button data-view-jump="orders">Open orders</button>`);
    actions.push(`<a href="/api/export/inventory">Download inventory CSV</a>`);
  } else {
    actions.push(`<button data-view-jump="orders">Open orders</button>`);
    actions.push(`<button data-view-jump="purchasing">Open purchasing</button>`);
    actions.push(`<button data-view-jump="catalog">Open catalog</button>`);
  }
  target.innerHTML = `
    <div class="action-menu topbar-action-menu">
      <button class="button" data-action-menu="topbar-actions">${withIcon("more-horizontal", "Actions")}</button>
      <div class="action-popover" data-menu-for="topbar-actions">
        ${actions.join("")}
      </div>
    </div>
  `;
}

function applyMenuGroupState() {
  $$(".nav-group").forEach((group) => group.classList.toggle("open", menuGroupsExpanded));
  const button = $("#menu-expand-toggle");
  if (button) {
    button.textContent = menuGroupsExpanded ? "Hide" : "Show";
    button.setAttribute("aria-label", menuGroupsExpanded ? "Collapse all menu groups" : "Expand all menu groups");
    button.title = menuGroupsExpanded ? "Collapse all menu groups" : "Expand all menu groups";
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = themeMode;
  const button = $("#theme-toggle");
  if (button) {
    const label = themeMode === "dark" ? "Light mode" : "Dark mode";
    button.innerHTML = withIcon(themeMode === "dark" ? "sun" : "moon", label);
    button.dataset.iconHydrated = "true";
    button.setAttribute("aria-label", `Switch to ${themeMode === "dark" ? "light" : "dark"} mode`);
  }
}

function renderMetrics() {
  $("#metric-open-orders").textContent = state.summary.openOrders;
  $("#metric-inventory").textContent = state.summary.inventoryCount;
  $("#metric-low-stock").textContent = state.summary.lowStock;
  $("#metric-reserved").textContent = state.summary.reserved;
  $("#metric-sales").textContent = money(state.summary.sales);
  $("#metric-customers").textContent = state.summary.customerCount || 0;
}

function renderDashboardOrders() {
  const openOrders = state.orders.filter((order) => order.status !== "confirmed").slice(0, 5);
  $("#dashboard-orders").innerHTML = openOrders.length
    ? openOrders.map((order) => `
      <div class="compact-row">
        <div>
          <strong>${order.orderNumber}</strong>
          <small>${order.source} / ${order.buyer} / ${order.sku}</small>
        </div>
        <button class="button secondary" data-confirm-order="${order.id}">Confirm</button>
      </div>
    `).join("")
    : `<p class="muted">No open orders right now.</p>`;
}

function renderSyncLog() {
  $("#sync-log").innerHTML = state.syncRuns.slice(0, 6).map((run) => `
    <div class="compact-row">
      <div>
        <strong>${run.source} ${run.type}</strong>
        <small>${run.message}</small>
      </div>
      <small>${dateLabel(run.createdAt)}</small>
    </div>
  `).join("");
}

function filteredOrders() {
  const query = $("#order-search").value.trim().toLowerCase();
  const status = $("#order-status").value;
  return state.orders.filter((order) => {
    const matchesStatus = status === "all" || order.status === status;
    const haystack = `${order.orderNumber} ${order.internalOrderNumber} ${order.marketplaceOrderNumber} ${order.marketplaceOrderId} ${order.source} ${order.buyer} ${order.customerNumber} ${order.sku} ${order.title}`.toLowerCase();
    return matchesStatus && haystack.includes(query);
  });
}

function renderOrders() {
  const orders = filteredOrders();
  if (!orders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = orders[0]?.id || state.orders[0]?.id || null;
  }

  renderOrderStats();
  document.querySelector(".orders-workspace")?.classList.toggle("detail-open", orderDetailVisible);
  $("#orders-list").innerHTML = orders.length
    ? `
      <div class="orders-table-wrap">
        <table class="orders-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all orders" /></th>
              <th>Orders</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Delivery</th>
              <th>Items</th>
              <th>Total</th>
              <th>Margin %</th>
              <th>Payment</th>
              <th>Supply</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((order) => {
              const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0) || order.qty || 1;
              const channel = channelForOrder(order);
              const supply = orderSupplyState(order);
              const orderMargin = marginPercent(profitFor(order), order.total);
              const refundDue = refundDueFor(order);
              return `
                <tr class="${order.id === selectedOrderId ? "selected" : ""} ${supply.rowClass}" data-select-order="${order.id}">
                  <td><input type="checkbox" ${selectedOrderIds.has(order.id) ? "checked" : ""} aria-label="Select ${order.orderNumber}" data-order-check="${order.id}" /></td>
                  <td>
                    <span class="order-source-badge">${channelLogoMarkup(channel, order.source)}<span>${html(order.source || "")}</span></span>
                    <button class="order-link" data-select-order="${order.id}" data-open-detail>${order.orderNumber}</button>
                    <small>${order.source} ref ${order.marketplaceOrderNumber || order.marketplaceOrderId || "n/a"}</small>
                  </td>
                  <td>${simpleDate(order.createdAt)}</td>
                  <td>
                    <span class="customer-chip">${initials(order.buyer)}</span>
                    ${order.buyer}
                  </td>
                  <td>${order.shipBy || "N/A"}</td>
                  <td>${itemCount} item${Number(itemCount) === 1 ? "" : "s"}</td>
                  <td>${money(order.total)}</td>
                  <td>${orderMargin.toFixed(1)}%</td>
                  <td><span class="status ${refundDue > 0 ? "canceled" : order.status}">${refundDue > 0 ? `Refund due ${money(refundDue)}` : labelStatus(order.status)}</span></td>
                  <td>${supply.label ? `<button class="status supply-${supply.tone} supply-pill" ${supply.poId ? `data-select-po="${supply.poId}"` : ""}>${html(supply.label)}</button><small>${html(supply.detail || "")}</small>` : ""}</td>
                  <td>
                    <div class="action-menu">
                      <button class="icon-button" data-action-menu="${order.id}" aria-label="Open order actions">...</button>
                      <div class="action-popover" data-menu-for="${order.id}">
                        <button data-order-action="approve" data-order-id="${order.id}">Approve order</button>
                        <button data-order-action="hold" data-order-id="${order.id}">Put on hold</button>
                        <button data-order-action="cancel" data-order-id="${order.id}">Cancel order</button>
                        <button data-duplicate-order="${order.id}">Duplicate to draft</button>
                        <button data-create-po-order="${order.id}">Create PO</button>
                        <button data-open-order-return="${order.id}">Create return</button>
                        <button data-select-order="${order.id}" data-open-detail>View details</button>
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No orders match this filter.</div>`;

  renderOrderDetail();
  renderBulkOrderBar();
}

function renderDrafts() {
  const query = $("#draft-search")?.value.trim().toLowerCase() || "";
  const drafts = (state.orderDrafts || []).filter((draft) => {
    const haystack = `${draft.draftNumber || ""} ${draft.buyer || ""} ${draft.note || ""} ${draft.marketplaceOrderNumber || ""}`.toLowerCase();
    return haystack.includes(query);
  });
  $("#drafts-list").innerHTML = drafts.length
    ? `
      <div class="orders-table-wrap">
        <table class="orders-table">
          <thead><tr><th>Draft</th><th>Customer</th><th>Channel</th><th>Items</th><th>Total</th><th>Margin %</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            ${drafts.map((draft) => {
              const draftCost = (draft.items || []).reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.qty || 0), 0);
              const draftProfit = Number(draft.total || 0) - draftCost;
              const draftMargin = marginPercent(draftProfit, draft.total);
              const matchedCustomer = findCustomerForContact(draft);
              const historyCount = ordersForCustomerHistory(matchedCustomer).length;
              return `
              <tr>
                <td><button class="order-link" data-select-draft="${draft.id}" data-open-draft-detail><strong>${html(draft.draftNumber || "Draft")}</strong></button><small>${html(draft.marketplaceOrderNumber || draft.note || "")}</small></td>
                <td>${matchedCustomer ? `<button class="order-link customer-name-link" data-select-customer="${matchedCustomer.id}">${html(draft.buyer || matchedCustomer.name || "Unknown")}</button><small>${historyCount} previous order${historyCount === 1 ? "" : "s"}</small>` : html(draft.buyer || "Unknown")}</td>
                <td>${html(draft.source || "Manual")}</td>
                <td>${(draft.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0)} item${(draft.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0) === 1 ? "" : "s"}</td>
                <td>${money(draft.total || 0)}</td>
                <td>${draftMargin.toFixed(1)}%</td>
                <td><span class="status draft">${html(draft.status || "draft")}</span></td>
                <td>${simpleDate(draft.updatedAt || draft.createdAt)}</td>
                <td>
                  <div class="action-menu">
                    <button class="icon-button" data-action-menu="draft-${draft.id}" aria-label="Open draft actions">...</button>
                    <div class="action-popover" data-menu-for="draft-${draft.id}">
                      <button data-edit-draft="${draft.id}">Continue editing</button>
                      <button data-duplicate-draft="${draft.id}">Duplicate draft</button>
                      <button data-select-draft="${draft.id}" data-open-draft-detail>View details</button>
                      <button data-convert-draft="${draft.id}">Create live order</button>
                    </div>
                  </div>
                </td>
              </tr>
            `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No order drafts yet. This section will hold manual drafts, imported draft orders, and exception work before confirmation.<div style="margin-top:12px;"><button class="button" data-open-manual-order>Create manual order</button></div></div>`;
}

function renderReturnsManagement() {
  const query = $("#return-search")?.value.trim().toLowerCase() || "";
  const returns = [...(state.returns || [])]
    .filter((item) => {
      const haystack = `${item.returnNumber || ""} ${item.orderNumber || ""} ${item.source || ""} ${item.warehouseName || ""} ${item.reason || ""} ${item.status || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  $("#returns-management-list").innerHTML = returns.length
    ? `
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead><tr><th>Return</th><th>Order</th><th>Channel</th><th>Warehouse</th><th>Status</th><th>Condition</th><th>Disposition</th><th>Reason</th><th>Amount</th><th>Date</th></tr></thead>
          <tbody>
            ${returns.map((item) => {
              const order = (state.orders || []).find((row) => row.orderNumber === item.orderNumber);
              return `
                <tr>
                  <td><button class="order-link" data-select-return="${item.id}"><strong>${html(item.returnNumber || "Pending number")}</strong></button></td>
                  <td>${order ? `<button class="order-link" data-select-order="${order.id}" data-open-detail>${html(item.orderNumber || "")}</button>` : html(item.orderNumber || "")}</td>
                  <td>${html(item.source || "")}</td>
                  <td>${html(item.warehouseName || "Not assigned")}</td>
                  <td><span class="status ${returnStatusTone(item.status)}">${html(returnStatusLabel(item.status))}</span></td>
                  <td>${html(item.condition || "Unknown")}</td>
                  <td>${html(item.disposition || "Pending")}</td>
                  <td>${html(item.reason || "")}</td>
                  <td>${money(item.amount || 0)}</td>
                  <td>${simpleDate(item.createdAt)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No returns match this filter.</div>`;
}

function renderReturnProfilePage() {
  const record = (state.returns || []).find((row) => row.id === selectedReturnId) || state.returns?.[0];
  const target = $("#return-profile-page");
  if (!record) {
    target.innerHTML = `<div class="empty-state">Select a return first.</div>`;
    return;
  }
  const order = (state.orders || []).find((row) => row.id === record.orderId || row.orderNumber === record.orderNumber);
  const items = Array.isArray(record.items) && record.items.length
    ? record.items.map((item) => ({ ...item, qty: Number(item.qty || item.qtyReturned || 0) || 1 }))
    : [{ sku: record.sku || "", title: record.title || record.sku || "Returned item", qty: Number(record.qty || 1), price: 0, cost: 0 }];
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const receiveImages = attachments.filter((file) => file.stage === "received");
  const workflowImages = attachments.filter((file) => file.stage === "workflow");
  const requestImages = attachments.filter((file) => !file.stage || file.stage === "requested");
  const refundDue = Math.max(0, Number(record.amount || 0) - Number(record.returnFee || 0));
  target.innerHTML = `
    <div class="full-order shopify-order">
      <div class="shopify-order-head">
        <div>
          <button class="text-button" data-view-jump="returns">Back to returns</button>
          <div class="shopify-title-row">
            <h2>${html(record.returnNumber || "Return")}</h2>
            <span class="status ${returnStatusTone(record.status)}">${html(returnStatusLabel(record.status))}</span>
            <span class="status draft">${html(record.source || "Manual")}</span>
          </div>
          <p class="muted">${simpleDate(record.createdAt)} / ${html(record.orderNumber || "No order linked")}</p>
        </div>
        <div class="shopify-header-actions"></div>
      </div>

      <div class="shopify-order-grid">
        <div class="shopify-main-column">
          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Return summary</h3>
            </div>
            <div class="order-total-table">
              <div><span>Status</span><span>Current step</span><strong>${html(record.status || "requested")}</strong></div>
              <div><span>Condition</span><span>Customer return state</span><strong>${html(record.condition || "Unknown")}</strong></div>
              <div><span>Disposition</span><span>Resolution</span><strong>${html(record.disposition || "Pending")}</strong></div>
              <div><span>Amount</span><span>Return amount</span><strong>${money(record.amount || 0)}</strong></div>
              <div><span>Return fee</span><span>Fee withheld</span><strong>${money(record.returnFee || 0)}</strong></div>
              <div><span>Refund due</span><span>Customer refund</span><strong>${money(refundDue)}</strong></div>
            </div>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Receiving</h3>
            </div>
            <div class="order-total-table">
              <div><span>Received date</span><span></span><strong>${html(record.receivedAt || "Not received")}</strong></div>
              <div><span>Received by</span><span></span><strong>${html(record.receivedBy || "Not set")}</strong></div>
              <div><span>Warehouse</span><span></span><strong>${html(record.warehouseName || "Not assigned")}</strong></div>
              <div><span>Bin</span><span></span><strong>${html(record.binLocation || "Not set")}</strong></div>
            </div>
            ${imageAttachmentsMarkup(receiveImages, "No receiving images yet.")}
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Returned items</h3>
            </div>
            ${renderLineItemTable(items, { maxTitle: 38 })}
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Inspection and resolution</h3>
            </div>
            <div class="order-total-table">
              <div><span>Inspection status</span><span></span><strong>${html(record.inspectionStatus || "Not started")}</strong></div>
              <div><span>Inspection condition</span><span></span><strong>${html(record.inspectionCondition || "Not set")}</strong></div>
              <div><span>Resolution notes</span><span></span><strong>${html(record.resolutionNotes || "None")}</strong></div>
              <div><span>Restocked</span><span></span><strong>${html(record.restockedAt ? simpleDate(record.restockedAt) : "No")}</strong></div>
            </div>
            ${imageAttachmentsMarkup(workflowImages, "No inspection images yet.")}
            ${["resolved", "done"].includes(String(record.status || "").toLowerCase()) ? `<div class="shopify-card-actions"><span class="status confirmed">Return completed</span></div>` : ""}
          </section>
        </div>

        <aside class="shopify-side-column">
          <section class="shopify-card">
            <h3>Order</h3>
            <p>${order ? `<button class="order-link" data-select-order="${order.id}" data-open-detail>${html(order.orderNumber)}</button>` : html(record.orderNumber || "No order linked")}</p>
            <p>${html(record.reason || "No reason provided")}</p>
          </section>

          <section class="shopify-card">
            <h3>Return details</h3>
            <dl class="order-detail-list">
              <dt>Items</dt><dd>${items.length}</dd>
              <dt>Total qty</dt><dd>${html(record.qty || items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1)}</dd>
              <dt>Created by</dt><dd>${html(record.createdBy || "System")}</dd>
              <dt>Resolved by</dt><dd>${html(record.resolvedBy || "Not resolved")}</dd>
              <dt>Resolved at</dt><dd>${html(record.resolvedAt ? simpleDate(record.resolvedAt) : "Not resolved")}</dd>
            </dl>
          </section>

          <section class="shopify-card">
            <h3>Notes</h3>
            <p>${html(record.note || "No receiving notes")}</p>
            <h4>Inspection notes</h4>
            <p>${html(record.inspectionNotes || "No inspection notes")}</p>
            <h4>Requested images</h4>
            ${imageAttachmentsMarkup(requestImages, "No request images attached.")}
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderBulkOrderBar() {
  const bar = $("#bulk-order-bar");
  if (!bar) return;
  const count = selectedOrderIds.size;
  $("#bulk-order-count").textContent = count;
  bar.classList.toggle("show", count > 0);
}

function draftLineTemplate(line = {}) {
  const subtotal = Number(line.qty || 0) * Number(line.price || 0);
  return `
    <div class="manual-order-line" data-draft-line-row="${html(line.id)}">
      <label>SKU
        <input list="manual-order-sku-options" value="${html(line.sku || "")}" data-draft-line-field="sku" data-line-id="${html(line.id)}" placeholder="Type or pick SKU" />
      </label>
      <label>Title
        <input value="${html(line.title || "")}" data-draft-line-field="title" data-line-id="${html(line.id)}" placeholder="Product title" readonly />
      </label>
      <label>Qty
        <input type="number" min="1" value="${html(line.qty || 1)}" data-draft-line-field="qty" data-line-id="${html(line.id)}" />
      </label>
      <label>Price
        <input type="number" min="0" step="0.01" value="${html(line.price ?? 0)}" data-draft-line-field="price" data-line-id="${html(line.id)}" />
      </label>
      <label>Cost
        <input type="number" min="0" step="0.01" value="${html(line.cost ?? 0)}" data-draft-line-field="cost" data-line-id="${html(line.id)}" readonly />
      </label>
      <div class="manual-order-line-meta">
        <small class="manual-order-line-subtotal">Line total ${money(subtotal)}</small>
        <button type="button" class="button secondary" data-remove-draft-line="${html(line.id)}">Remove</button>
      </div>
    </div>
  `;
}

function getManualOrderDraftState() {
  return Array.from($$("[data-draft-line-row]")).map((row) => {
    const id = row.dataset.draftLineRow;
    return {
      id,
      sku: row.querySelector(`[data-draft-line-field="sku"][data-line-id="${id}"]`)?.value.trim() || "",
      title: row.querySelector(`[data-draft-line-field="title"][data-line-id="${id}"]`)?.value.trim() || "",
      qty: Number(row.querySelector(`[data-draft-line-field="qty"][data-line-id="${id}"]`)?.value || 1),
      price: Number(row.querySelector(`[data-draft-line-field="price"][data-line-id="${id}"]`)?.value || 0),
      cost: Number(row.querySelector(`[data-draft-line-field="cost"][data-line-id="${id}"]`)?.value || 0)
    };
  }).filter((line) => line.sku || line.title);
}

function renderManualOrderLines(lines = []) {
  const target = $("#manual-order-lines");
  if (!target) return;
  const safeLines = lines.length ? lines : [{ id: crypto.randomUUID(), sku: "", title: "", qty: 1, price: 0, cost: 0 }];
  target.innerHTML = `
    <datalist id="manual-order-sku-options">
      ${(state.inventory || []).map((item) => `<option value="${html(item.sku)}">${html(item.title)}</option>`).join("")}
    </datalist>
    ${safeLines.map((line) => draftLineTemplate(line)).join("")}
  `;
  refreshManualOrderTotals();
}

function refreshManualOrderTotals() {
  const lines = getManualOrderDraftState();
  const totalQty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.price || 0), 0);
  $("#manual-order-total-qty").textContent = totalQty;
  $("#manual-order-total-amount").textContent = money(totalAmount);
}

function openManualOrderModal(draftId = null) {
  editingDraftId = draftId;
  const draft = draftId ? (state.orderDrafts || []).find((row) => row.id === draftId) : null;
  $("#manual-order-modal-title").textContent = draft ? `Edit ${draft.draftNumber}` : "Create draft order";
  $("#manual-order-id").value = draft?.id || "";
  $("#manual-order-buyer").value = draft?.buyer || "";
  $("#manual-order-source").value = draft?.source || "Manual";
  $("#manual-order-email").value = draft?.buyerEmail || "";
  $("#manual-order-phone").value = draft?.phone || "";
  $("#manual-order-reference").value = draft?.marketplaceOrderNumber || "";
  $("#manual-order-note").value = draft?.note || "";
  $("#manual-order-ship-name").value = draft?.shippingAddress?.name || draft?.buyer || "";
  $("#manual-order-ship-line1").value = draft?.shippingAddress?.line1 || "";
  $("#manual-order-ship-line2").value = draft?.shippingAddress?.line2 || "";
  $("#manual-order-ship-city").value = draft?.shippingAddress?.city || "";
  $("#manual-order-ship-state").value = draft?.shippingAddress?.state || "";
  $("#manual-order-ship-postal").value = draft?.shippingAddress?.postalCode || "";
  $("#manual-order-ship-country").value = draft?.shippingAddress?.country || "US";
  renderManualOrderLines((draft?.items || []).map((item) => ({ ...item })));
  $("#manual-order-modal").classList.add("show");
  $("#manual-order-buyer").focus();
}

function closeManualOrderModal() {
  editingDraftId = null;
  $("#manual-order-form")?.reset();
  $("#manual-order-modal").classList.remove("show");
  renderManualOrderLines([]);
}

function openOrderRefundModal(orderId) {
  const order = (state.orders || []).find((row) => row.id === orderId);
  if (!order) return;
  const items = orderItems(order);
  refundOrderModalId = orderId;
  $("#order-refund-id").value = order.id;
  $("#order-refund-lines").innerHTML = items.map((item, index) => {
    const refundableQty = Math.max(0, Number(item.qty || 0) - refundedQtyForLine(order, item, index));
    const unitPrice = Number(item.price || 0);
    return `
      <div class="refund-line-row">
        <label class="refund-line-select">
          <input type="checkbox" data-refund-line-select="${index}" ${refundableQty > 0 ? "" : "disabled"} />
          <span>Refund</span>
        </label>
        <label class="refund-line-field">SKU<input value="${html(item.sku || "")}" readonly /></label>
        <label class="refund-line-field refund-line-title">Title<input value="${html(item.title || item.sku || "")}" readonly /></label>
        <label class="refund-line-field">Unit price<input value="${money(unitPrice)}" readonly /></label>
        <label class="refund-line-field">Refund qty
          <input
            type="number"
            min="0"
            max="${refundableQty}"
            step="1"
            value="0"
            data-refund-line-qty="${index}"
            data-sku="${html(item.sku || "")}"
            data-title="${html(item.title || item.sku || "")}"
            data-price="${unitPrice}"
            data-line-index="${index}"
            ${refundableQty > 0 ? "" : "disabled"}
          />
        </label>
        <label class="refund-line-field">Available<input value="${refundableQty}" readonly /></label>
      </div>
    `;
  }).join("");
  $("#order-refund-amount").value = "0.00";
  $("#order-refund-date").value = new Date().toISOString().slice(0, 10);
  $("#order-refund-method").value = "marketplace";
  $("#order-refund-reference").value = "";
  $("#order-refund-reason").value = refundDueFor(order) > 0 ? "Return completed" : "Order refund";
  $("#order-refund-notes").value = "";
  refreshOrderRefundTotals();
  $("#order-refund-modal")?.classList.add("show");
  $("#order-refund-modal")?.setAttribute("aria-hidden", "false");
}

function closeOrderRefundModal() {
  refundOrderModalId = null;
  $("#order-refund-form")?.reset();
  $("#order-refund-modal")?.classList.remove("show");
  $("#order-refund-modal")?.setAttribute("aria-hidden", "true");
}

function refreshOrderRefundTotals() {
  const selectedLines = $$("[data-refund-line-qty]").map((input) => ({
    qty: Number(input.value || 0),
    price: Number(input.dataset.price || 0)
  })).filter((line) => line.qty > 0);
  const total = selectedLines.reduce((sum, line) => sum + (line.qty * line.price), 0);
  $("#order-refund-amount").value = total.toFixed(2);
}

function openOrderEditModal(orderId) {
  const order = (state.orders || []).find((row) => row.id === orderId);
  if (!order) return;
  editOrderModalId = orderId;
  $("#order-edit-id").value = order.id;
  $("#order-edit-buyer").value = order.buyer || "";
  $("#order-edit-source").value = order.source || "";
  $("#order-edit-email").value = order.buyerEmail || "";
  $("#order-edit-phone").value = order.phone || "";
  $("#order-edit-marketplace-number").value = order.marketplaceOrderNumber || order.marketplaceOrderId || "";
  $("#order-edit-ship-by").value = order.shipBy && /^\d{4}-\d{2}-\d{2}$/.test(order.shipBy) ? order.shipBy : "";
  $("#order-edit-notes").value = order.notes || "";
  $("#order-edit-modal").classList.add("show");
  $("#order-edit-buyer")?.focus();
}

function closeOrderEditModal() {
  editOrderModalId = null;
  $("#order-edit-form")?.reset();
  $("#order-edit-modal").classList.remove("show");
}

function openReturnWorkflowModal(returnId) {
  const record = (state.returns || []).find((row) => row.id === returnId);
  if (!record) return;
  selectedReturnWorkflowId = returnId;
  returnWorkflowAttachments = (record.attachments || []).filter((file) => file.stage === "workflow");
  $("#return-workflow-id").value = record.id;
  $("#return-workflow-status").value = record.status || "requested";
  $("#return-workflow-condition").value = record.condition || "Unknown";
  $("#return-workflow-received-at").value = record.receivedAt || "";
  $("#return-workflow-bin").value = record.binLocation || "";
  $("#return-workflow-inspection-status").value = record.inspectionStatus || "";
  $("#return-workflow-inspection-condition").value = record.inspectionCondition || "";
  $("#return-workflow-disposition").value = record.disposition || "";
  $("#return-workflow-received-by").value = record.receivedBy || "";
  $("#return-workflow-inspection-notes").value = record.inspectionNotes || "";
  $("#return-workflow-resolution-notes").value = record.resolutionNotes || "";
  renderReturnAttachmentList("#return-workflow-attachments", returnWorkflowAttachments, "data-remove-return-workflow-attachment", "No inspection images added.");
  $("#return-workflow-modal").classList.add("show");
}

function closeReturnWorkflowModal() {
  selectedReturnWorkflowId = null;
  returnWorkflowAttachments = [];
  $("#return-workflow-form")?.reset();
  $("#return-workflow-modal").classList.remove("show");
}

function openReturnReceiveModal(returnId) {
  const record = (state.returns || []).find((row) => row.id === returnId);
  if (!record) return;
  selectedReturnId = returnId;
  $("#return-receive-modal h2").textContent = String(record.status || "").toLowerCase() === "received" ? "Complete return" : "Receive return";
  returnReceiveAttachments = (record.attachments || []).filter((file) => file.stage === "received");
  $("#return-receive-id").value = record.id;
  $("#return-receive-date").value = record.receivedAt || new Date().toISOString().slice(0, 10);
  $("#return-receive-by").value = record.receivedBy || "";
  $("#return-receive-bin").value = record.binLocation || "";
  $("#return-receive-condition").value = record.condition || "Unknown";
  $("#return-receive-inspection-status").value = record.inspectionStatus || "passed";
  $("#return-receive-inspection-condition").value = record.inspectionCondition || "sellable";
  $("#return-receive-disposition").value = record.disposition || "restock";
  $("#return-receive-fee").value = Number(record.returnFee || 0).toFixed(2);
  $("#return-receive-inspection-notes").value = record.inspectionNotes || "";
  $("#return-receive-resolution-notes").value = record.resolutionNotes || "";
  $("#return-receive-notes").value = record.note || "";
  renderReturnAttachmentList("#return-receive-attachments", returnReceiveAttachments, "data-remove-return-receive-attachment", "No return images added.");
  $("#return-receive-modal").classList.add("show");
}

function closeReturnReceiveModal() {
  returnReceiveAttachments = [];
  $("#return-receive-form")?.reset();
  $("#return-receive-modal").classList.remove("show");
}

function addManualOrderLine(prefill = {}) {
  const lines = getManualOrderDraftState();
  lines.push({ id: crypto.randomUUID(), sku: "", title: "", qty: 1, price: 0, cost: 0, ...prefill });
  renderManualOrderLines(lines);
}

function removeManualOrderLine(lineId) {
  const lines = getManualOrderDraftState().filter((line) => line.id !== lineId);
  renderManualOrderLines(lines);
}

async function submitManualOrder(form) {
  const wasEditing = Boolean(editingDraftId);
  const buyer = $("#manual-order-buyer")?.value.trim() || "";
  const source = $("#manual-order-source")?.value.trim() || "Manual";
  const buyerEmail = $("#manual-order-email")?.value.trim() || "";
  const phone = $("#manual-order-phone")?.value.trim() || "";
  const marketplaceOrderNumber = $("#manual-order-reference")?.value.trim() || "";
  const note = $("#manual-order-note")?.value.trim() || "";
  const items = getManualOrderDraftState();
  if (!buyer) {
    toast("Customer name is required.");
    return;
  }
  if (!items.length) {
    toast("Add at least one line item.");
    return;
  }
  const shippingAddress = {
    name: $("#manual-order-ship-name")?.value.trim() || buyer,
    line1: $("#manual-order-ship-line1")?.value.trim() || "",
    line2: $("#manual-order-ship-line2")?.value.trim() || "",
    city: $("#manual-order-ship-city")?.value.trim() || "",
    state: $("#manual-order-ship-state")?.value.trim() || "",
    postalCode: $("#manual-order-ship-postal")?.value.trim() || "",
    country: $("#manual-order-ship-country")?.value.trim() || "US"
  };
  const body = {
    buyer,
    source,
    buyerEmail,
    phone,
    marketplaceOrderNumber,
    note,
    shippingAddress,
    billingAddress: shippingAddress,
    items
  };
  const endpoint = editingDraftId ? `/api/order-drafts/${editingDraftId}` : "/api/order-drafts";
  const method = editingDraftId ? "PATCH" : "POST";
  const result = await api(endpoint, { method, body: JSON.stringify(body) });
  setState(result.state);
  closeManualOrderModal();
  showView("drafts");
  toast(wasEditing ? "Draft updated." : "Draft created.");
}

async function submitOrderEdit(form) {
  const formData = new FormData(form);
  const orderId = String(formData.get("orderId") || editOrderModalId || "");
  const payload = {
    buyer: String(formData.get("buyer") || "").trim(),
    source: String(formData.get("source") || "").trim(),
    buyerEmail: String(formData.get("buyerEmail") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    marketplaceOrderNumber: String(formData.get("marketplaceOrderNumber") || "").trim(),
    shipBy: String(formData.get("shipBy") || "").trim(),
    notes: String(formData.get("notes") || "").trim()
  };
  if (!orderId) throw new Error("Order not found.");
  if (!payload.buyer) throw new Error("Customer name is required.");
  const result = await api(`/api/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  selectedOrderId = orderId;
  closeOrderEditModal();
  setState(result.state);
  toast("Order updated.");
}

async function submitOrderRefund(form) {
  const formData = new FormData(form);
  const orderId = String(formData.get("orderId") || refundOrderModalId || "");
  if (!orderId) throw new Error("Order not found.");
  const items = $$("[data-refund-line-qty]").map((input) => ({
    sku: String(input.dataset.sku || "").trim(),
    title: String(input.dataset.title || "").trim(),
    price: Number(input.dataset.price || 0),
    qty: Number(input.value || 0),
    lineIndex: Number(input.dataset.lineIndex || 0)
  })).filter((line) => line.qty > 0);
  const payload = {
    amount: Number(formData.get("amount") || 0),
    refundedAt: String(formData.get("refundedAt") || "").trim(),
    method: String(formData.get("method") || "").trim(),
    reference: String(formData.get("reference") || "").trim(),
    reason: String(formData.get("reason") || "").trim(),
    note: String(formData.get("note") || "").trim(),
    items
  };
  if (!items.length) throw new Error("Select at least one line item to refund.");
  if (!(payload.amount > 0)) throw new Error("Refund amount must be greater than zero.");
  if (!payload.refundedAt) throw new Error("Refund date is required.");
  const result = await api(`/api/orders/${orderId}/refunds`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedOrderId = orderId;
  closeOrderRefundModal();
  setState(result.state);
  if (currentViewId === "order-full") renderFullOrderPage();
  toast("Refund saved.");
}

async function submitReturnWorkflow(form) {
  const formData = new FormData(form);
  const returnId = String(formData.get("returnId") || selectedReturnWorkflowId || "");
  if (!returnId) throw new Error("Return not found.");
  const payload = {
    status: String(formData.get("status") || ""),
    condition: String(formData.get("condition") || ""),
    receivedAt: String(formData.get("receivedAt") || ""),
    binLocation: String(formData.get("binLocation") || ""),
    inspectionStatus: String(formData.get("inspectionStatus") || ""),
    inspectionCondition: String(formData.get("inspectionCondition") || ""),
    disposition: String(formData.get("disposition") || ""),
    receivedBy: String(formData.get("receivedBy") || "").trim(),
    inspectionNotes: String(formData.get("inspectionNotes") || "").trim(),
    resolutionNotes: String(formData.get("resolutionNotes") || "").trim(),
    attachments: returnWorkflowAttachments.map((file) => ({ ...file, stage: "workflow" }))
  };
  const result = await api(`/api/returns/${returnId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  closeReturnWorkflowModal();
  setState(result.state);
  toast("Return workflow updated.");
}

async function submitReturnReceive(form) {
  const formData = new FormData(form);
  const returnId = String(formData.get("returnId") || selectedReturnId || "");
  if (!returnId) throw new Error("Return not found.");
  const payload = {
    status: "done",
    receivedAt: String(formData.get("receivedAt") || ""),
    receivedBy: String(formData.get("receivedBy") || "").trim(),
    binLocation: String(formData.get("binLocation") || "").trim(),
    condition: String(formData.get("condition") || "Unknown"),
    inspectionStatus: String(formData.get("inspectionStatus") || "passed"),
    inspectionCondition: String(formData.get("inspectionCondition") || "sellable"),
    disposition: String(formData.get("disposition") || "restock"),
    returnFee: Number(formData.get("returnFee") || 0),
    inspectionNotes: String(formData.get("inspectionNotes") || "").trim(),
    resolutionNotes: String(formData.get("resolutionNotes") || "").trim(),
    note: String(formData.get("note") || "").trim(),
    attachments: returnReceiveAttachments.map((file) => ({ ...file, stage: "received" }))
  };
  const result = await api(`/api/returns/${returnId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  selectedReturnId = returnId;
  closeReturnReceiveModal();
  setState(result.state);
  showView("return-full");
  renderReturnProfilePage();
  renderTopbarActions();
  toast("Return completed.");
}

async function convertDraftToOrder(draftId) {
  const result = await api(`/api/order-drafts/${draftId}/convert`, { method: "POST", body: JSON.stringify({ user: "Luis" }) });
  setState(result.state);
  selectedOrderId = result.order.id;
  showView("order-full");
  toast(`${result.order.orderNumber} created from draft.`);
}

function renderDraftOrderPage() {
  const draft = (state.orderDrafts || []).find((row) => row.id === selectedDraftId) || state.orderDrafts?.[0];
  const target = $("#full-draft-page");
  if (!draft) {
    target.innerHTML = `<div class="empty-state">Select a draft first.</div>`;
    return;
  }
  const address = draft.shippingAddress || {};
  const items = draft.items || [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const totalCost = items.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.qty || 0), 0);
  const estProfit = subtotal - totalCost;
  const draftMargin = marginPercent(estProfit, subtotal);
  const matchedCustomer = findCustomerForContact(draft);
  const priorOrders = ordersForCustomerHistory(matchedCustomer);
  const revisions = (state.orderDrafts || [])
    .filter((row) => row.quoteGroupId && row.quoteGroupId === draft.quoteGroupId)
    .sort((a, b) => Number(b.revisionNumber || 1) - Number(a.revisionNumber || 1));
  const latestRevision = Math.max(...revisions.map((row) => Number(row.revisionNumber || 1)));
  target.innerHTML = `
    <div class="full-order shopify-order">
      <div class="shopify-order-head">
        <div>
          <button class="text-button" data-view-jump="drafts">Back to drafts</button>
          <div class="shopify-title-row">
            <h2>${html(draft.draftNumber)}</h2>
            <span class="status draft">Draft</span>
            <span class="status ready">${html(draft.source || "Manual")}</span>
            <span class="status confirmed">Rev ${Number(draft.revisionNumber || 1)}</span>
          </div>
          <p class="muted">${simpleDate(draft.updatedAt || draft.createdAt)} / ${html(draft.marketplaceOrderNumber || "No external reference")}</p>
        </div>
        <div class="shopify-header-actions"></div>
      </div>

      <div class="shopify-order-grid">
        <div class="shopify-main-column">
          <section class="shopify-card">
            <div class="shopify-card-head">
              <span class="status draft">Draft order</span>
              <span class="status ${items.length ? "confirmed" : "hold"}">${items.length} line${items.length === 1 ? "" : "s"}</span>
            </div>
            ${renderLineItemTable(items, { maxTitle: 42 })}
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <span class="status draft">Draft totals</span>
            </div>
            <div class="order-total-table">
              <div><span>Subtotal</span><span>${items.length} item${items.length === 1 ? "" : "s"}</span><strong>${money(subtotal)}</strong></div>
              <div><span>Estimated cost</span><span>COGS</span><strong>${money(totalCost)}</strong></div>
              <div><span>Margin</span><span>Profit percentage</span><strong>${draftMargin.toFixed(1)}%</strong></div>
              <div class="paid-row"><span>Estimated profit</span><span></span><strong>${money(estProfit)}</strong></div>
            </div>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Draft notes</h3>
            </div>
            <p>${html(draft.note || "No notes yet.")}</p>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Quote revisions</h3>
            </div>
            <div class="mini-history">
              ${revisions.map((revision) => `
                <button ${revision.id === draft.id ? "disabled" : `data-select-draft="${revision.id}" data-open-draft-detail`}>
                  <strong>${html(revision.draftNumber)} / Rev ${Number(revision.revisionNumber || 1)}</strong>
                  <span>${Number(revision.revisionNumber || 1) === latestRevision ? "Latest revision" : "Superseded revision"} / ${simpleDate(revision.updatedAt || revision.createdAt)}</span>
                </button>
              `).join("")}
            </div>
          </section>
        </div>

        <aside class="shopify-side-column">
          <section class="shopify-card">
            <h3>Customer</h3>
            <p><strong>${matchedCustomer ? `<button class="order-link" data-select-customer="${matchedCustomer.id}">${html(draft.buyer || matchedCustomer.name || "Unknown customer")}</button>` : html(draft.buyer || "Unknown customer")}</strong></p>
            <p class="muted">${matchedCustomer ? `${priorOrders.length} previous order${priorOrders.length === 1 ? "" : "s"}` : "No previous order history yet"}</p>
            <p>${html(draft.buyerEmail || "No email")}</p>
            <p>${html(draft.phone || "No phone number")}</p>
          </section>

          <section class="shopify-card">
            <h3>Shipping address</h3>
            <p>${html(address.name || draft.buyer || "")}</p>
            <p>${html(address.line1 || "")}${address.line2 ? `, ${html(address.line2)}` : ""}</p>
            <p>${html([address.city, address.state, address.postalCode].filter(Boolean).join(", "))}</p>
            <p>${html(address.country || "")}</p>
          </section>

          <section class="shopify-card">
            <h3>Draft details</h3>
            <dl class="order-detail-list">
              <dt>Draft number</dt><dd>${html(draft.draftNumber)}</dd>
              <dt>Revision</dt><dd>${Number(draft.revisionNumber || 1)}</dd>
              <dt>Channel</dt><dd>${html(draft.source || "Manual")}</dd>
              <dt>Quote group</dt><dd>${html((draft.quoteGroupId || "").slice(0, 8) || "N/A")}</dd>
              <dt>External reference</dt><dd>${html(draft.marketplaceOrderNumber || "N/A")}</dd>
              <dt>Created</dt><dd>${html(simpleDate(draft.createdAt))}</dd>
              <dt>Updated</dt><dd>${html(simpleDate(draft.updatedAt || draft.createdAt))}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderOrderStats() {
  const orders = state.orders || [];
  $("#orders-stat-total").textContent = orders.length;
  $("#orders-stat-approved").textContent = orders.filter((order) => ["approved", "confirmed"].includes(order.status)).length;
  $("#orders-stat-pending").textContent = orders.filter((order) => ["new", "ready", "hold"].includes(order.status)).length;
  $("#orders-stat-exceptions").textContent = orders.filter((order) => ["canceled", "returned"].includes(order.status)).length + (state.returns || []).length;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function labelStatus(status) {
  return ({
    hold: "On hold",
    approved: "Approved",
    canceled: "Canceled",
    confirmed: "Success",
    ready: "Pending",
    new: "Pending",
    partial_fulfilled: "Partially fulfilled",
    fulfilled: "Fulfilled"
  })[status] || status;
}

function channelForOrder(order) {
  return (state.connections || []).find((connection) => String(connection.name || "").toLowerCase() === String(order.source || "").toLowerCase());
}

function channelLogoMarkup(channel, label) {
  const image = channel?.logoDataUrl || channel?.logoUrl;
  return image
    ? `<img class="channel-logo" src="${html(image)}" alt="${html(label)}" />`
    : `<span class="channel-logo-placeholder">${html(String(label || "?").slice(0, 1).toUpperCase())}</span>`;
}

function normalizePhoneMatch(value) {
  return String(value || "").replace(/\D/g, "");
}

function findCustomerForContact({ buyer = "", buyerEmail = "", phone = "" } = {}) {
  const emailKey = String(buyerEmail || "").trim().toLowerCase();
  const phoneKey = normalizePhoneMatch(phone);
  const buyerKey = String(buyer || "").trim().toLowerCase();
  return (state.customers || []).find((customer) => {
    const customerEmail = String(customer.email || "").trim().toLowerCase();
    const customerPhone = normalizePhoneMatch(customer.phone);
    const customerName = String(customer.name || "").trim().toLowerCase();
    if (emailKey && customerEmail && customerEmail === emailKey) return true;
    if (phoneKey && customerPhone && customerPhone === phoneKey) return true;
    return Boolean(buyerKey && customerName === buyerKey);
  }) || null;
}

function ordersForCustomerHistory(customer) {
  if (!customer) return [];
  return (state.orders || []).filter((order) => order.customerId === customer.id);
}

function draftsForCustomerHistory(customer) {
  if (!customer) return [];
  return (state.orderDrafts || []).filter((draft) => {
    const matched = findCustomerForContact(draft);
    return matched?.id === customer.id;
  });
}

function returnsForCustomerHistory(customer) {
  if (!customer) return [];
  const orderIds = new Set(ordersForCustomerHistory(customer).map((order) => order.id));
  return (state.returns || []).filter((record) => orderIds.has(record.orderId));
}

async function duplicateDraftAsNewDraft(draftId) {
  const draft = (state.orderDrafts || []).find((row) => row.id === draftId);
  if (!draft) throw new Error("Draft not found.");
  const result = await api(`/api/order-drafts/${draftId}/duplicate`, { method: "POST" });
  setState(result.state);
  selectedDraftId = result.draft.id;
  showView("draft-full");
  toast(`${result.draft.draftNumber} created from ${draft.draftNumber}.`);
}

async function duplicateOrderAsDraft(orderId) {
  const order = (state.orders || []).find((row) => row.id === orderId);
  if (!order) throw new Error("Order not found.");
  const result = await api(`/api/orders/${orderId}/duplicate-draft`, { method: "POST" });
  setState(result.state);
  selectedDraftId = result.draft.id;
  showView("draft-full");
  toast(`${result.draft.draftNumber} created from ${order.orderNumber}.`);
}

function availableStockForOrder(order) {
  const items = order.items?.length ? order.items : [{ sku: order.sku, qty: order.qty || 1 }];
  return items.every((line) => {
    const item = (state.inventory || []).find((row) => row.sku === line.sku);
    const available = Number(item?.qty || 0) - Number(item?.reserved || 0);
    return available >= Number(line.qty || 0);
  });
}

function openLinkedPoForOrder(order) {
  const poIds = Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds : [];
  const po = (state.purchaseOrders || []).find((row) => poIds.includes(row.id) && !["closed", "canceled"].includes(String(row.status || "").toLowerCase()))
    || (state.purchaseOrders || []).find((row) => poIds.includes(row.id));
  return po || null;
}

function orderSupplyState(order) {
  const po = openLinkedPoForOrder(order);
  const hasAvailableStock = availableStockForOrder(order);
  if (po && (po.status === "received" || po.status === "partially_received") && hasAvailableStock) {
    return { tone: "stock", label: "In stock", detail: po.poNumber, rowClass: "supply-stock" };
  }
  if (po && !["closed", "canceled"].includes(String(po.status || "").toLowerCase())) {
    return { tone: "po", label: "Has PO", detail: po.poNumber, rowClass: "supply-po", poId: po.id };
  }
  if (hasAvailableStock) {
    return { tone: "stock", label: "Stock", detail: "On hand", rowClass: "supply-stock" };
  }
  return { tone: "new", label: "", detail: "", rowClass: "" };
}

function renderOrderDetail() {
  const order = state.orders.find((row) => row.id === selectedOrderId);
  const detail = $("#order-detail");
  if (!order) {
    detail.innerHTML = `<div class="empty-state">Select an order to see details.</div>`;
    return;
  }

  const address = order.address || {};
  const items = order.items?.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty, price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1)) }];
  const costTotal = Number(order.productCost || 0) + Number(order.marketplaceFees || 0) + Number(order.shippingCost || 0) + Number(order.refundAmount || 0);
  const orderProfit = profitFor(order);
  const margin = Number(order.total || 0) ? (orderProfit / Number(order.total || 0)) * 100 : 0;
  const customer = (state.customers || []).find((item) => item.id === order.customerId);
  const customerOrders = state.orders.filter((item) => item.customerId === order.customerId);

  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${order.source}</p>
        <h2>${order.orderNumber}</h2>
        <p class="muted">Marketplace ref: ${order.marketplaceOrderNumber || order.marketplaceOrderId || "Not mapped"}</p>
        <span class="status ${order.status}">${order.status}</span>
      </div>
      ${order.status === "confirmed" ? `<span class="muted">Confirmed</span>` : `<button class="button" data-confirm-order="${order.id}">Confirm order</button>`}
    </div>

    <div class="detail-grid">
      <section>
        <h3>Buyer</h3>
        <p><strong>${order.buyer}</strong></p>
        <p>${order.customerNumber || "No customer profile"}${customer?.repeatCustomer ? " / Repeat customer" : ""}</p>
        <p>${order.buyerEmail || "No email"}</p>
        <p>${order.phone || "No phone"}</p>
      </section>
      <section>
        <h3>Ship To</h3>
        <p><strong>${address.name || order.buyer}</strong></p>
        <p>${address.line1 || ""}${address.line2 ? `, ${address.line2}` : ""}</p>
        <p>${[address.city, address.state, address.postalCode].filter(Boolean).join(", ")}</p>
      </section>
      <section>
        <h3>Marketplace</h3>
        <p>Internal: ${order.internalOrderNumber || order.orderNumber}</p>
        <p>Reference: ${order.marketplaceOrderNumber || order.marketplaceOrderId || "Not mapped"}</p>
        <p>Ship by: ${order.shipBy}</p>
        <p>${order.shippingService}</p>
      </section>
      <section>
        <h3>Profit</h3>
        <p>Sales: ${money(order.total)}</p>
        <p>Costs: ${money(costTotal)}</p>
        <p><strong>${money(orderProfit)} / ${margin.toFixed(1)}%</strong></p>
      </section>
    </div>

    <section class="detail-section">
      <h3>Profit and Loss</h3>
      <div class="money-editor">
        <label>Gross sales<input type="number" step="0.01" value="${order.total}" data-order-money="total" data-order-id="${order.id}" /></label>
        <label>Product cost<input type="number" step="0.01" value="${order.productCost || 0}" data-order-money="productCost" data-order-id="${order.id}" /></label>
        <label>Marketplace fees<input type="number" step="0.01" value="${order.marketplaceFees || 0}" data-order-money="marketplaceFees" data-order-id="${order.id}" /></label>
        <label>Shipping cost<input type="number" step="0.01" value="${order.shippingCost || 0}" data-order-money="shippingCost" data-order-id="${order.id}" /></label>
        <label>Refunds<input type="number" step="0.01" value="${order.refundAmount || 0}" data-order-money="refundAmount" data-order-id="${order.id}" /></label>
      </div>
      <div class="pnl-strip">
        <span><small>Net profit</small><strong>${money(orderProfit)}</strong></span>
        <span><small>Margin</small><strong>${margin.toFixed(1)}%</strong></span>
        <span><small>Break-even</small><strong>${money(costTotal)}</strong></span>
      </div>
    </section>

    <section class="detail-section">
      <h3>Customer Profile</h3>
      <div class="pnl-strip">
        <span><small>Customer</small><strong>${customer?.customerNumber || "None"}</strong></span>
        <span><small>Orders</small><strong>${customerOrders.length}</strong></span>
        <span><small>Lifetime value</small><strong>${money(customer?.lifetimeValue || 0)}</strong></span>
      </div>
      <div class="mini-history">
        ${customerOrders.slice(0, 5).map((item) => `
          <button data-select-order="${item.id}">
            <strong>${item.orderNumber}</strong>
            <span>${item.source} / ${money(item.total)} / ${simpleDate(item.createdAt)}</span>
          </button>
        `).join("") || `<p class="muted">No history yet.</p>`}
      </div>
    </section>

    <section class="detail-section">
      <h3>Items</h3>
      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Qty</th><th>Price</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${item.sku}</strong></td>
              <td>${item.title}</td>
              <td>${item.qty}</td>
              <td>${money(item.price)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>

    <section class="detail-section">
      <h3>Shipping and Notes</h3>
      <p>Tracking: ${order.trackingNumber || "Not available yet"}</p>
      <p>${order.notes || "No notes."}</p>
    </section>
  `;
}

function renderFullOrderPage() {
  const order = state.orders.find((row) => row.id === selectedOrderId) || state.orders[0];
  const target = $("#full-order-page");
  if (!order) {
    target.innerHTML = `<div class="empty-state">Select an order first.</div>`;
    return;
  }

  const address = order.address || {};
  const items = order.items?.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty, price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1)) }];
  const customer = (state.customers || []).find((item) => item.id === order.customerId);
  const costTotal = Number(order.productCost || 0) + Number(order.marketplaceFees || 0) + Number(order.shippingCost || 0) + Number(order.refundAmount || 0);
  const orderProfit = profitFor(order);
  const orderMargin = marginPercent(orderProfit, order.total);
  const timeline = order.timeline || [];
  const customerOrders = customer ? state.orders.filter((item) => item.customerId === customer.id) : [];
  const linkedReturns = (state.returns || [])
    .filter((record) => record.orderId === order.id || record.orderNumber === order.orderNumber)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const refundDue = refundDueFor(order);
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shippingCharge = Number(order.shippingPaid ?? order.external?.shippingPaid ?? Math.max(0, Number(order.total || 0) - subtotal));
  const totalUnits = Math.max(1, items.reduce((sum, line) => sum + Number(line.qty || 0), 0));
  const marketplaceDetails = order.source === "eBay" && order.external ? `
    <section class="shopify-card">
      <div class="shopify-card-head">
        <h3>eBay details</h3>
      </div>
      <div class="order-total-table">
        <div><span>Seller net</span><span>totalDueSeller</span><strong>${money(order.external.totalDueSeller || 0)}</strong></div>
        <div><span>Buyer shipping</span><span>deliveryCost</span><strong>${money(order.shippingPaid ?? order.external.shippingPaid ?? 0)}</strong></div>
        <div><span>Fee basis</span><span>totalFeeBasisAmount</span><strong>${money(order.external.totalFeeBasisAmount || 0)}</strong></div>
        <div><span>Payment status</span><span>${html(order.external.orderPaymentStatus || "N/A")}</span><strong>${html(order.external.orderFulfillmentStatus || "N/A")}</strong></div>
      </div>
    </section>
  ` : "";

  target.innerHTML = `
    <div class="full-order shopify-order">
      <div class="shopify-order-head">
        <div>
          <button class="text-button" data-view-jump="orders">Back to orders</button>
          <div class="shopify-title-row">
            <h2>${html(order.orderNumber)}</h2>
            <span class="status confirmed">Paid</span>
            <span class="status ${order.status}">${labelStatus(order.status)}</span>
            ${refundDue > 0 ? `<span class="status canceled">Refund due ${money(refundDue)}</span>` : ""}
          </div>
          <p class="muted">${simpleDate(order.createdAt)} from ${html(order.source || "Marketplace")} ${order.marketplaceOrderNumber ? `/ ${html(order.marketplaceOrderNumber)}` : ""}</p>
        </div>
        <div class="shopify-header-actions">
          <button class="button secondary" data-open-order-refund="${order.id}">Refund</button>
          <button class="button secondary" data-open-order-edit="${order.id}">Edit</button>
          <button class="button secondary">Print</button>
          <button class="button secondary" data-open-order-return="${order.id}">Return</button>
        </div>
      </div>

      <div class="shopify-order-grid">
        <div class="shopify-main-column">
          <section class="shopify-card">
            <div class="shopify-card-head">
              <span class="status ${order.status}">${labelStatus(order.status)}</span>
              <span class="status draft">${html(order.warehouse || "SI warehouse")}</span>
              <button class="icon-button" aria-label="More fulfillment actions">...</button>
            </div>
            <div class="fulfillment-box">
              <p><strong>${html(order.carrierName || order.shippingCarrier || order.shippingService || "USPS Ground Advantage")}</strong></p>
              <p>Fulfill by ${html(order.shipBy || "N/A")}</p>
              ${order.trackingNumber ? `<p>Tracking: ${order.trackingUrl ? `<a href="${html(order.trackingUrl)}" target="_blank" rel="noreferrer">${html(order.trackingNumber)}</a>` : html(order.trackingNumber)}</p>` : ""}
              ${order.shipDate ? `<p>Ship date: ${html(order.shipDate)}</p>` : ""}
            </div>
            ${renderLineItemTable(items, {
              maxTitle: 42,
              costForLine: (item) => {
                const inventoryItem = (state.inventory || []).find((row) => row.sku === item.sku);
                if (inventoryItem && Number.isFinite(Number(inventoryItem.cost))) return Number(inventoryItem.cost);
                return Number(order.productCost || 0) / totalUnits;
              }
            })}
            <div class="shopify-card-actions">
              <button class="button secondary" data-open-fulfillment="${order.id}">Mark as fulfilled</button>
              <button class="button secondary" data-open-order-return="${order.id}">Create return</button>
            </div>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <span class="status confirmed">Paid</span>
            </div>
            <div class="order-total-table">
              <div><span>Subtotal</span><span>${items.length} item${items.length === 1 ? "" : "s"}</span><strong>${money(subtotal)}</strong></div>
              <div><span>Shipping</span><span>${html(order.shippingService || "Marketplace shipping")}</span><strong>${money(shippingCharge)}</strong></div>
              <div><span>Marketplace fees</span><span>${html(order.source || "Channel")}</span><strong>${money(order.marketplaceFees)}</strong></div>
              <div><span>Total</span><span></span><strong>${money(order.total)}</strong></div>
              <div><span>Refunded</span><span>Already processed</span><strong>${money(order.refundAmount || 0)}</strong></div>
              <div class="paid-row"><span>${refundDue > 0 ? "Refund due" : "Paid"}</span><span></span><strong>${refundDue > 0 ? money(refundDue) : money(order.total)}</strong></div>
            </div>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Profit and loss</h3>
            </div>
            <div class="order-total-table">
              <div><span>Revenue</span><span>Order total</span><strong>${money(order.total)}</strong></div>
              <div><span>Product cost</span><span>COGS</span><strong>${money(order.productCost)}</strong></div>
              <div><span>Shipping cost</span><span>Carrier / label</span><strong>${money(order.shippingCost)}</strong></div>
              <div><span>Fees/refunds</span><span>Marketplace</span><strong>${money(Number(order.marketplaceFees || 0) + Number(order.refundAmount || 0))}</strong></div>
              <div><span>Margin</span><span>Profit percentage</span><strong>${orderMargin.toFixed(1)}%</strong></div>
              <div class="paid-row"><span>Estimated profit</span><span></span><strong>${money(orderProfit)}</strong></div>
            </div>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Metafields</h3>
              <button class="text-button">View all</button>
            </div>
            <label>shipping_cost<input value="${money(order.shippingCost)}" readonly /></label>
          </section>

          ${marketplaceDetails}

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Returns</h3>
              <button class="button secondary compact-button" data-open-order-return="${order.id}">Create return</button>
            </div>
            ${linkedReturns.length ? `
              <div class="table-wrap compact-table">
                <table>
                  <thead><tr><th>Return</th><th>Status</th><th>Qty</th><th>Amount</th><th>Warehouse</th><th>Date</th></tr></thead>
                  <tbody>
                    ${linkedReturns.map((record) => `
                      <tr>
                        <td>
                          <button class="order-link" data-select-return="${record.id}">${html(record.returnNumber || "Pending")}</button>
                          <small>${html(record.reason || "No reason provided")}</small>
                        </td>
                        <td><span class="status ${returnStatusTone(record.status)}">${html(returnStatusLabel(record.status))}</span></td>
                        <td>${Number(record.qty || 0)}</td>
                        <td>${money(record.amount || 0)}</td>
                        <td>${html(record.warehouseName || "Not assigned")}</td>
                        <td>${simpleDate(record.createdAt)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
              ${refundDue > 0 ? `<div class="shopify-card-actions"><span class="status canceled">Refund due ${money(refundDue)}</span></div>` : ""}
            ` : `<p class="muted">No returns have been created for this order yet.</p>`}
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Refunds</h3>
              <button class="button secondary compact-button" data-open-order-refund="${order.id}">Record refund</button>
            </div>
            ${(order.refunds || []).length ? `
              <div class="table-wrap compact-table">
                <table>
                  <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Items</th><th>Reference</th></tr></thead>
                  <tbody>
                    ${(order.refunds || []).map((refund) => `
                      <tr>
                        <td>${simpleDate(refund.refundedAt || refund.createdAt)}</td>
                        <td>${money(refund.amount || 0)}</td>
                        <td>${html(refund.method || "Manual")}</td>
                        <td>${html(refundItemsSummary(refund))}</td>
                        <td>${html(refund.reference || "N/A")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<p class="muted">No refunds recorded yet.</p>`}
          </section>

          <section class="timeline-card shopify-timeline">
            <h3>Timeline</h3>
            <div class="timeline-comment">
              <span class="comment-avatar">D+</span>
              <textarea id="order-note-input" rows="2" placeholder="Leave a comment..."></textarea>
              <button class="button secondary" data-add-order-note="${order.id}">Post</button>
            </div>
            <div class="timeline">
              ${timeline.map((event) => `
                <article class="timeline-event ${event.type}">
                  <span class="timeline-dot"></span>
                  <div>
                    <strong>${html(event.title)}</strong>
                    <p>${html(event.message || "")}</p>
                    <small>${html(event.user || "System")} / ${dateLabel(event.createdAt)}</small>
                  </div>
                </article>
              `).join("") || `<p class="muted">No events yet.</p>`}
            </div>
          </section>
        </div>

        <aside class="shopify-side-column">
          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Notes</h3>
              <button class="icon-button" data-open-order-edit="${order.id}" aria-label="Edit notes">Edit</button>
            </div>
            <p>${html(order.notes || "No notes from customer")}</p>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Additional details</h3>
              <button class="icon-button" data-open-order-edit="${order.id}" aria-label="Edit additional details">Edit</button>
            </div>
            <dl class="order-detail-list">
              <dt>Marketplace record number</dt><dd>${html(order.marketplaceOrderNumber || order.marketplaceOrderId || "N/A")}</dd>
              <dt>Internal order number</dt><dd>${html(order.internalOrderNumber || order.orderNumber)}</dd>
              <dt>Ship by</dt><dd>${html(order.shipBy || "N/A")}</dd>
              <dt>Channel account</dt><dd>${html(order.source || "N/A")}</dd>
              <dt>Reserved from</dt><dd>${html(order.reservationWarehouseName || "Not reserved")}</dd>
              <dt>Ship from</dt><dd>${html(order.fulfillmentWarehouseName || "Not assigned")}</dd>
              <dt>Return warehouse</dt><dd>${html(order.returnWarehouseName || "Not assigned")}</dd>
            </dl>
          </section>

          <section class="shopify-card">
            <h3>Channel Information</h3>
            <dl class="order-detail-list">
              <dt>Channel</dt><dd>${html(order.source || "N/A")}</dd>
              <dt>Order ID</dt><dd>${html(order.marketplaceOrderId || order.marketplaceOrderNumber || "N/A")}</dd>
            </dl>
          </section>

          <section class="shopify-card">
            <div class="shopify-card-head">
              <h3>Customer</h3>
              <button class="icon-button" aria-label="Customer actions">...</button>
            </div>
            <p><strong>${customer ? `<button class="order-link" data-select-customer="${customer.id}">${html(customer.name)}</button>` : html(order.buyer)}</strong></p>
            <p class="muted">${customerOrders.length || 1} order${(customerOrders.length || 1) === 1 ? "" : "s"}</p>
            <h4>Contact information</h4>
            <p>${html(order.buyerEmail || customer?.email || "No email")}</p>
            <p>${html(order.phone || customer?.phone || "No phone number")}</p>
            <h4>Shipping address</h4>
            <p>${html(address.name || order.buyer)}</p>
            <p>${html(address.line1 || "")}${address.line2 ? `, ${html(address.line2)}` : ""}</p>
            <p>${html([address.city, address.state, address.postalCode].filter(Boolean).join(", "))}</p>
            <p>${html(address.country || "")}</p>
          </section>
        </aside>
              </div>
    </div>
  `;
}

function orderLinksForPo(po) {
  const ids = Array.isArray(po.orderIds) ? po.orderIds : [];
  const numbers = Array.isArray(po.orderNumbers) ? po.orderNumbers : [];
  const rows = numbers.length ? numbers : ids.map((id) => state.orders.find((order) => order.id === id)?.orderNumber).filter(Boolean);
  return rows.map((number, index) => {
    const order = state.orders.find((item) => item.id === ids[index] || item.orderNumber === number);
    return order
      ? `<button class="order-link inline-link" data-select-order="${order.id}" data-open-detail>${html(order.orderNumber)}</button>`
      : `<span>${html(number)}</span>`;
  }).join(", ");
}

function poSubmissionConfigured(settings = {}, method = "email") {
  if (method === "api") return Boolean(settings.apiEnabled && settings.apiBaseUrl);
  if (method === "ftp") return Boolean(settings.ftpEnabled && settings.ftpHost);
  if (method === "email") return Boolean(settings.emailEnabled !== false && settings.emailTo);
  return false;
}

function poMenuButton(label, attrs, enabled = true) {
  return `<button ${attrs} ${enabled ? "" : "disabled"}>${label}</button>`;
}

function vendorsForPo(po) {
  const order = state.orders.find((item) => (po.orderIds || []).includes(item.id));
  const sku = order?.items?.[0]?.sku || order?.sku;
  const product = state.inventory.find((item) => item.sku === sku);
  const brand = state.brands?.find((item) => item.name === (order?.brand || product?.brand));
  const mapped = (brand?.vendorIds || []).map((id) => state.vendors.find((vendor) => vendor.id === id)).filter(Boolean);
  return mapped.length ? mapped : state.vendors || [];
}

function renderPurchaseOrders() {
  const query = $("#po-search").value.trim().toLowerCase();
  document.querySelectorAll("[data-purchasing-tab]").forEach((button) => button.classList.toggle("active", button.dataset.purchasingTab === purchasingTab));
  $("#po-list").style.display = purchasingTab === "pos" ? "grid" : "none";
  $("#vendor-list").style.display = purchasingTab === "vendors" ? "block" : "none";
  $("#brand-list").style.display = purchasingTab === "brands" ? "block" : "none";
  $("#warehouse-list").style.display = purchasingTab === "warehouses" ? "block" : "none";
  if (purchasingTab === "vendors") {
    renderVendors(query);
    return;
  }
  if (purchasingTab === "brands") {
    renderBrands(query);
    return;
  }
  if (purchasingTab === "warehouses") {
    renderWarehouses(query);
    return;
  }
  const purchaseOrders = (state.purchaseOrders || []).filter((po) => {
    const haystack = `${po.poNumber} ${po.supplier} ${(po.orderNumbers || []).join(" ")} ${po.status}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#po-list").innerHTML = purchaseOrders.length
    ? `
      <div class="po-dashboard">
        <article class="stat-card"><span>Total POs</span><strong>${state.purchaseOrders?.length || 0}</strong><small>All purchasing</small></article>
        <article class="stat-card"><span>Open POs</span><strong>${state.summary.openPurchaseOrders || 0}</strong><small>Draft or active</small></article>
        <article class="stat-card"><span>Vendors</span><strong>${state.vendors?.length || 0}</strong><small>Supplier profiles</small></article>
        <article class="stat-card"><span>Est. Spend</span><strong>${money((state.purchaseOrders || []).reduce((sum, po) => sum + Number(po.estimatedCost || 0), 0))}</strong><small>Current POs</small></article>
      </div>
      <div class="po-table-wrap">
        <table class="po-table">
          <thead>
            <tr><th>PO</th><th>Status</th><th>Supplier</th><th>Warehouse</th><th>Orders</th><th>Units</th><th>Est. Cost</th><th>Created</th></tr>
          </thead>
          <tbody>
            ${purchaseOrders.map((po) => `
              <tr>
                <td><button class="order-link po-link" data-select-po="${po.id}">${html(po.poNumber)}</button><small>${html(po.source)}</small></td>
                <td><span class="status ${po.status}">${po.status}</span></td>
                <td>${html(po.supplier)}</td>
                <td>${html(po.warehouseName || "Unassigned")}</td>
                <td class="inline-links">${orderLinksForPo(po)}</td>
                <td>${po.totalUnits}</td>
                <td>${money(po.estimatedCost)}</td>
                <td>${simpleDate(po.createdAt)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No purchase orders yet.</div>`;
}

function renderWarehouses(query = "") {
  const warehouses = (state.warehouses || []).filter((warehouse) => {
    const haystack = `${warehouse.code} ${warehouse.name} ${warehouse.status} ${warehouse.warehouseType} ${warehouse.contactName} ${warehouse.managerName} ${warehouse.phone} ${warehouse.email} ${warehouse.addressLine} ${warehouse.city} ${warehouse.state} ${warehouse.notes}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#warehouse-list").innerHTML = warehouses.length
    ? `
      <div class="vendor-table-wrap">
        <table class="vendor-table">
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Code</th>
              <th>Type</th>
              <th>Status</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Open POs</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${warehouses.map((warehouse) => `
              <tr>
                <td><button class="order-link vendor-name-link" data-select-warehouse="${warehouse.id}">${html(warehouse.name)}</button></td>
                <td>${html(warehouse.code || "")}</td>
                <td>${html(warehouse.warehouseType || "Warehouse")}</td>
                <td><span class="status ${warehouse.status === "active" ? "paid" : "canceled"}">${html(warehouse.status)}</span></td>
                <td>${html(warehouse.contactName || warehouse.managerName || "No contact")}<small>${html(warehouse.phone || warehouse.email || "")}</small></td>
                <td>${html([warehouse.city, warehouse.state].filter(Boolean).join(", ") || warehouse.addressLine1 || "Not set")}</td>
                <td>${(state.purchaseOrders || []).filter((po) => po.warehouseId === warehouse.id && !["closed", "canceled"].includes(String(po.status || "").toLowerCase())).length}</td>
                <td>${html(warehouse.notes || "No notes")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No warehouses match this search.</div>`;
}

function renderWarehouseProfile() {
  const warehouse = (state.warehouses || []).find((item) => item.id === selectedWarehouseId);
  const target = $("#warehouse-profile-page");
  if (!warehouse) {
    target.innerHTML = `<div class="empty-state">No warehouse selected.</div>`;
    return;
  }

  const linkedPos = (state.purchaseOrders || []).filter((po) => po.warehouseId === warehouse.id);
  const receipts = linkedPos.flatMap((po) => (po.receipts || []).map((receipt) => ({ ...receipt, poNumber: po.poNumber }))).sort((a, b) => new Date(b.receivedAt || b.createdAt || 0) - new Date(a.receivedAt || a.createdAt || 0));
  const relatedReturns = (state.returns || []).filter((item) => item.warehouseId === warehouse.id).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const openPos = linkedPos.filter((po) => !["closed", "canceled"].includes(String(po.status || "").toLowerCase()));
  const totalUnitsReceived = receipts.reduce((sum, receipt) => sum + Number(receipt.totalUnits || 0), 0);
  const bins = Array.isArray(warehouse.bins) ? warehouse.bins : [];
  const defaultBin = bins.find((bin) => bin.isDefault);

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="purchasing">Back to purchasing</button>
        <div>
          <p class="eyebrow">${html(warehouse.code || "Warehouse")}</p>
          <h2>${html(warehouse.name)}</h2>
          <p class="muted">${html(warehouse.warehouseType || "Warehouse")} / ${html(warehouse.status || "active")}</p>
        </div>
        <div class="profit-pill">
          <small>Open purchase orders</small>
          <strong>${openPos.length}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Warehouse summary</h3>
          <div class="summary-grid">
            <span><small>Status</small><strong>${html(warehouse.status || "active")}</strong></span>
            <span><small>Type</small><strong>${html(warehouse.warehouseType || "Warehouse")}</strong></span>
            <span><small>Timezone</small><strong>${html(warehouse.timezone || "America/New_York")}</strong></span>
            <span><small>Carrier cutoff</small><strong>${html(warehouse.carrierCutoffTime || "Not set")}</strong></span>
            <span><small>Contact</small><strong>${html(warehouse.contactName || "No contact")}</strong></span>
            <span><small>Manager</small><strong>${html(warehouse.managerName || "No manager")}</strong></span>
            <span><small>Receipts</small><strong>${receipts.length}</strong></span>
            <span><small>Units received</small><strong>${totalUnitsReceived}</strong></span>
            <span><small>Default receiving</small><strong>${warehouse.isDefaultReceiving ? "Yes" : "No"}</strong></span>
            <span><small>Default returns</small><strong>${warehouse.isDefaultReturns ? "Yes" : "No"}</strong></span>
          </div>
        </section>

        <section class="full-card">
          <h3>Address</h3>
          <div class="edit-stack">
            <label>Address line 1<input value="${html(warehouse.addressLine1 || "")}" data-warehouse-field="addressLine1" data-warehouse-id="${warehouse.id}" /></label>
            <label>Address line 2<input value="${html(warehouse.addressLine2 || "")}" data-warehouse-field="addressLine2" data-warehouse-id="${warehouse.id}" /></label>
            <label>City<input value="${html(warehouse.city || "")}" data-warehouse-field="city" data-warehouse-id="${warehouse.id}" /></label>
            <label>State<input value="${html(warehouse.state || "")}" data-warehouse-field="state" data-warehouse-id="${warehouse.id}" /></label>
            <label>Postal code<input value="${html(warehouse.postalCode || "")}" data-warehouse-field="postalCode" data-warehouse-id="${warehouse.id}" /></label>
            <label>Country<input value="${html(warehouse.country || "US")}" data-warehouse-field="country" data-warehouse-id="${warehouse.id}" /></label>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Warehouse profile</h3>
          <div class="edit-stack">
            <label>Warehouse name<input value="${html(warehouse.name || "")}" data-warehouse-field="name" data-warehouse-id="${warehouse.id}" /></label>
            <label>Warehouse code<input value="${html(warehouse.code || "")}" data-warehouse-field="code" data-warehouse-id="${warehouse.id}" /></label>
            <label>Warehouse type
              <select data-warehouse-field="warehouseType" data-warehouse-id="${warehouse.id}">
                ${["Warehouse", "Distribution Center", "3PL", "Retail Store", "Returns Center", "Overflow Storage"].map((value) => `<option value="${value}" ${warehouse.warehouseType === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>Status
              <select data-warehouse-field="status" data-warehouse-id="${warehouse.id}">
                ${["active", "inactive"].map((value) => `<option value="${value}" ${warehouse.status === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>Primary contact<input value="${html(warehouse.contactName || "")}" data-warehouse-field="contactName" data-warehouse-id="${warehouse.id}" /></label>
            <label>Warehouse manager<input value="${html(warehouse.managerName || "")}" data-warehouse-field="managerName" data-warehouse-id="${warehouse.id}" /></label>
            <label>Phone<input value="${html(warehouse.phone || "")}" data-warehouse-field="phone" data-warehouse-id="${warehouse.id}" /></label>
            <label>Email<input value="${html(warehouse.email || "")}" data-warehouse-field="email" data-warehouse-id="${warehouse.id}" /></label>
            <label>Timezone<input value="${html(warehouse.timezone || "")}" data-warehouse-field="timezone" data-warehouse-id="${warehouse.id}" /></label>
            <label>Operating hours<input value="${html(warehouse.operatingHours || "")}" data-warehouse-field="operatingHours" data-warehouse-id="${warehouse.id}" /></label>
            <label>Carrier cutoff time<input value="${html(warehouse.carrierCutoffTime || "")}" data-warehouse-field="carrierCutoffTime" data-warehouse-id="${warehouse.id}" /></label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="isDefaultReceiving" data-warehouse-id="${warehouse.id}" ${warehouse.isDefaultReceiving ? "checked" : ""} /> Default warehouse for PO receiving</label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="isDefaultReturns" data-warehouse-id="${warehouse.id}" ${warehouse.isDefaultReturns ? "checked" : ""} /> Default warehouse for order returns</label>
            <label class="span-2">Receiving instructions<textarea rows="3" data-warehouse-field="receivingInstructions" data-warehouse-id="${warehouse.id}">${html(warehouse.receivingInstructions || "")}</textarea></label>
            <label class="span-2">Notes<textarea rows="3" data-warehouse-field="notes" data-warehouse-id="${warehouse.id}">${html(warehouse.notes || "")}</textarea></label>
          </div>
        </section>

        <section class="full-card">
          <h3>Receiving rules</h3>
          <div class="edit-stack">
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="requireAppointment" data-warehouse-id="${warehouse.id}" ${warehouse.requireAppointment ? "checked" : ""} /> Appointment required for inbound freight</label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="allowBlindReceipts" data-warehouse-id="${warehouse.id}" ${warehouse.allowBlindReceipts ? "checked" : ""} /> Allow blind receipts without PO references</label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="requireSerialScan" data-warehouse-id="${warehouse.id}" ${warehouse.requireSerialScan ? "checked" : ""} /> Require serial capture during receiving</label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="requirePhotoForDamage" data-warehouse-id="${warehouse.id}" ${warehouse.requirePhotoForDamage ? "checked" : ""} /> Require damage photo/documentation</label>
            <label class="checkbox-row"><input type="checkbox" data-warehouse-field="autoRouteReturns" data-warehouse-id="${warehouse.id}" ${warehouse.autoRouteReturns ? "checked" : ""} /> Auto-route order returns here when selected as default</label>
          </div>
        </section>

        <section class="full-card">
          <div class="panel-head">
            <h3>Bins and locations</h3>
            <button class="text-button" data-open-warehouse-bin="${warehouse.id}">Add location</button>
          </div>
          ${bins.length ? `
            <div class="table-wrap compact-table">
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Default</th><th>Active</th><th>Notes</th></tr></thead>
                <tbody>
                  ${bins.map((bin) => `
                    <tr>
                      <td><input value="${html(bin.code || "")}" data-warehouse-bin-field="code" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}" /></td>
                      <td><input value="${html(bin.name || "")}" data-warehouse-bin-field="name" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}" /></td>
                      <td>
                        <select data-warehouse-bin-field="type" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}">
                          ${["Receiving", "Storage", "Returns", "Quarantine", "Picking"].map((value) => `<option value="${value}" ${bin.type === value ? "selected" : ""}>${value}</option>`).join("")}
                        </select>
                      </td>
                      <td><input type="checkbox" data-warehouse-bin-field="isDefault" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}" ${bin.isDefault ? "checked" : ""} /></td>
                      <td><input type="checkbox" data-warehouse-bin-field="active" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}" ${bin.active !== false ? "checked" : ""} /></td>
                      <td><input value="${html(bin.notes || "")}" data-warehouse-bin-field="notes" data-warehouse-id="${warehouse.id}" data-bin-id="${bin.id}" /></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state">No bins or locations added yet.</div>`}
          <p class="muted">Default location: ${html(defaultBin?.code || "Not set")}</p>
        </section>

        <section class="full-card span-2">
          <h3>Purchase order activity</h3>
          ${linkedPos.length ? `
            <div class="table-wrap compact-table">
              <table>
                <thead><tr><th>PO</th><th>Status</th><th>Vendor</th><th>Units</th><th>Created</th></tr></thead>
                <tbody>
                  ${linkedPos.slice(0, 8).map((po) => `
                    <tr>
                      <td><button class="order-link po-link" data-select-po="${po.id}">${html(po.poNumber)}</button></td>
                      <td>${html(po.status)}</td>
                      <td>${html(po.supplier || "Unassigned")}</td>
                      <td>${po.totalUnits || 0}</td>
                      <td>${simpleDate(po.createdAt)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state">No purchase orders assigned to this warehouse.</div>`}
        </section>

        <section class="full-card">
          <h3>Recent receipts</h3>
          ${receipts.length ? `
            <div class="table-wrap compact-table">
              <table>
                <thead><tr><th>Receipt</th><th>PO</th><th>Date</th><th>Units</th></tr></thead>
                <tbody>
                  ${receipts.slice(0, 8).map((receipt) => `
                    <tr>
                      <td>${html(receipt.receiptNumber || "Draft")}</td>
                      <td>${html(receipt.poNumber || "")}</td>
                      <td>${simpleDate(receipt.receivedAt || receipt.createdAt)}</td>
                      <td>${receipt.totalUnits || 0}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state">No receipts yet.</div>`}
        </section>

        <section class="full-card">
          <h3>Returns routed here</h3>
          ${relatedReturns.length ? `
            <div class="table-wrap compact-table">
              <table>
                <thead><tr><th>Return</th><th>Order</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  ${relatedReturns.slice(0, 8).map((item) => `
                    <tr>
                      <td>${html(item.returnNumber || "")}</td>
                      <td>${html(item.orderNumber || "")}</td>
                      <td>${html(item.status || "")}</td>
                      <td>${simpleDate(item.createdAt)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty-state">No returns assigned to this warehouse.</div>`}
        </section>
      </div>
    </div>
  `;
}

function renderPurchaseOrderProfile() {
  const po = (state.purchaseOrders || []).find((item) => item.id === selectedPoId);
  const target = $("#po-profile-page");
  if (!po) {
    target.innerHTML = `<div class="empty-state">No purchase order selected.</div>`;
    return;
  }
  const vendor = (state.vendors || []).find((item) => item.id === po.vendorId || item.name === po.supplier);
  const availableVendors = vendorsForPo(po);
  const warehouses = (state.warehouses || []);
  const settings = vendor?.submissionSettings || {};
  const submissionHistory = Array.isArray(po.submissionHistory) ? [...po.submissionHistory].reverse() : [];
  const poTimeline = Array.isArray(po.timeline) ? [...po.timeline].reverse() : [];
  const vendorReturns = Array.isArray(po.returns) ? [...po.returns].reverse() : [];
  const receiptDrafts = Array.isArray(po.receiptDrafts) ? [...po.receiptDrafts].reverse() : [];
  const receipts = Array.isArray(po.receipts) ? [...po.receipts] : [];
  const receiptAudit = [
    { key: "short", label: "Short", receipts: receipts.filter((receipt) => (receipt.items || []).some((item) => item.varianceStatus === "short")) },
    { key: "over", label: "Over", receipts: receipts.filter((receipt) => (receipt.items || []).some((item) => item.varianceStatus === "over")) },
    { key: "damaged", label: "Damaged", receipts: receipts.filter((receipt) => (receipt.items || []).some((item) => item.varianceStatus === "damaged")) },
    { key: "backordered", label: "Backordered", receipts: receipts.filter((receipt) => (receipt.items || []).some((item) => item.varianceStatus === "backordered")) }
  ];
  const preferredMethod = String(settings.preferredMethod || "").toLowerCase();
  const preferredConfigured = preferredMethod && poSubmissionConfigured(settings, preferredMethod);
  const isClosed = ["canceled", "closed"].includes(String(po.status || "").toLowerCase());
  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="purchasing">Back to purchasing</button>
        <div>
          <p class="eyebrow">${html(po.source || "Purchase order")}</p>
          <h2>${html(po.poNumber)}</h2>
          <p class="muted">${html(po.supplier)} / ${html(po.status)}</p>
        </div>
        <div class="profit-pill">
          <small>Estimated cost</small>
          <strong>${money(po.estimatedCost)}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>PO Summary</h3>
          <div class="summary-grid">
            <span><small>Status</small><strong>${html(po.status)}</strong></span>
            <span><small>Vendor</small><strong>${vendor ? `<button class="order-link" data-select-vendor="${vendor.id}">${html(vendor.name)}</button>` : html(po.supplier || "Unassigned")}</strong></span>
            <span><small>Orders</small><strong>${(po.orderNumbers || []).length}</strong></span>
            <span><small>Units</small><strong>${po.totalUnits || 0}</strong></span>
            <span><small>Warehouse</small><strong>${html(po.warehouseName || "Unassigned")}</strong></span>
            <span><small>Created by</small><strong>${html(po.createdBy || "Luis")}</strong></span>
            <span><small>Created</small><strong>${simpleDate(po.createdAt)}</strong></span>
          </div>
        </section>
        <section class="full-card">
          <h3>Vendor and Warehouse</h3>
          <div class="edit-stack">
            <label>Selected vendor
              <select data-po-field="vendorId" data-po-id="${po.id}">
                ${availableVendors.map((item) => `<option value="${item.id}" ${item.id === po.vendorId ? "selected" : ""}>${html(item.name)}</option>`).join("")}
              </select>
            </label>
            <label>Receive into warehouse
              <select data-po-field="warehouseId" data-po-id="${po.id}">
                ${warehouses.map((item) => `<option value="${item.id}" ${item.id === po.warehouseId ? "selected" : ""}>${html(item.name)}</option>`).join("")}
              </select>
            </label>
          </div>
          ${vendor ? `<p><button class="order-link" data-select-vendor="${vendor.id}">${html(vendor.name)}</button></p><p>${html(vendor.email || "No email")}</p><p>${html(vendor.phone || "No phone")}</p><p class="muted">Preferred PO method: ${html(settings.preferredMethod || "email")}</p><p class="muted">Warehouse: ${html(po.warehouseName || "Unassigned")}</p>` : `<p>${html(po.supplier || "Unassigned supplier")}</p>`}
        </section>
        <section class="full-card">
          <h3>Linked Orders</h3>
          <div class="mini-history">
            ${(po.orderIds || []).map((id, index) => {
              const order = state.orders.find((item) => item.id === id || item.orderNumber === po.orderNumbers?.[index]);
              return order ? `
                <button data-select-order="${order.id}" data-open-detail>
                  <strong>${html(order.orderNumber)}</strong>
                  <span>${html(order.source)} / ${money(order.total)}</span>
                </button>
              ` : "";
            }).join("") || `<p class="muted">No linked orders.</p>`}
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Items</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>SKU</th><th>Title</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Est. unit cost</th><th>Orders</th></tr></thead>
              <tbody>
                ${(po.items || []).map((item) => `
                  <tr>
                    <td><strong>${html(item.sku)}</strong></td>
                    <td>${html(item.title || "")}</td>
                    <td>${item.qty || 0}</td>
                    <td>${Number(item.receivedQty || 0)}</td>
                    <td>${Math.max(0, Number(item.qty || 0) - Number(item.receivedQty || 0))}</td>
                    <td>${money(item.estimatedUnitCost || 0)}</td>
                    <td>${(item.orderNumbers || []).map((number) => {
                      const order = state.orders.find((row) => row.orderNumber === number);
                      return order ? `<button class="order-link inline-link" data-select-order="${order.id}" data-open-detail>${html(number)}</button>` : html(number);
                    }).join(", ")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="7">No PO items yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Receipts</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Received by</th><th>Warehouse</th><th>Units</th><th>Bin</th><th>Docs</th><th>Notes</th></tr></thead>
              <tbody>
                ${receipts.map((receipt) => `
                  <tr>
                    <td><button class="order-link inline-link" data-open-receipt-detail="${receipt.id}" data-receipt-type="receipt"><strong>${html(receipt.receiptNumber)}</strong></button></td>
                    <td>${simpleDate(receipt.receivedAt)}</td>
                    <td>${html(receipt.receivedBy || "Luis")}</td>
                    <td>${html(receipt.warehouseName || po.warehouseName || "Unassigned")}</td>
                    <td>${(receipt.items || []).reduce((sum, item) => sum + Number(item.qtyReceived || 0), 0)}</td>
                    <td>${html(receipt.defaultLocationBin || receipt.items?.find((item) => item.locationBin)?.locationBin || "Unassigned")}</td>
                    <td>${Array.isArray(receipt.attachments) ? receipt.attachments.length : 0}</td>
                    <td>${html(receipt.note || "")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="8">No receipts yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Receipt Drafts</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Draft</th><th>Date</th><th>User</th><th>Warehouse</th><th>Units planned</th><th>Bin</th><th>Notes</th></tr></thead>
              <tbody>
                ${receiptDrafts.map((receipt) => `
                  <tr>
                    <td><button class="order-link inline-link" data-open-receipt-detail="${receipt.id}" data-receipt-type="draft"><strong>${html(receipt.receiptNumber)}</strong></button></td>
                    <td>${simpleDate(receipt.receivedAt)}</td>
                    <td>${html(receipt.receivedBy || "Luis")}</td>
                    <td>${html(receipt.warehouseName || po.warehouseName || "Unassigned")}</td>
                    <td>${(receipt.items || []).reduce((sum, item) => sum + Number(item.qtyReceived || 0), 0)}</td>
                    <td>${html(receipt.defaultLocationBin || receipt.items?.find((item) => item.locationBin)?.locationBin || "Unassigned")}</td>
                    <td>${html(receipt.note || "")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="7">No receipt drafts yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Receiving Audit</h3>
          <div class="audit-grid">
            ${receiptAudit.map((group) => `
              <article class="audit-card">
                <small>${html(group.label)} receipts</small>
                <strong>${group.receipts.length}</strong>
                <p class="muted">${group.receipts.reduce((sum, receipt) => sum + (receipt.items || []).filter((item) => item.varianceStatus === group.key).reduce((inner, item) => inner + Number(item.qtyReceived || 0), 0), 0)} units flagged</p>
              </article>
            `).join("")}
          </div>
          <div class="audit-list">
            ${receiptAudit.flatMap((group) => group.receipts.map((receipt) => {
              const matching = (receipt.items || []).filter((item) => item.varianceStatus === group.key);
              return `
                <button data-open-receipt-detail="${receipt.id}" data-receipt-type="receipt">
                  <strong>${html(receipt.receiptNumber)}</strong>
                  <small>${html(group.label)} / ${matching.map((item) => `${item.sku} (${item.qtyReceived})`).join(", ")}</small>
                </button>
              `;
            })).join("") || `<p class="muted">No receiving variances logged yet.</p>`}
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Notes</h3>
          <p>${html(po.notes || "No notes.")}</p>
        </section>
        <section class="full-card span-2">
          <h3>Submission History</h3>
          <div class="timeline">
            ${submissionHistory.map((event) => `
              <article class="timeline-event">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${html(String(event.method || "manual").toUpperCase())} / ${html(event.status || "queued")}</strong>
                  <p>${html(event.message || "")}</p>
                  <small>${html(event.user || "Luis")} / ${dateLabel(event.createdAt)}</small>
                </div>
              </article>
            `).join("") || `<p class="muted">No submission attempts yet.</p>`}
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Vendor Returns</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Return</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead>
              <tbody>
                ${vendorReturns.map((item) => `
                  <tr>
                    <td><strong>${html(item.returnNumber)}</strong></td>
                    <td><span class="status ${html(item.status)}">${html(item.status)}</span></td>
                    <td>${html(item.reason || "")}</td>
                    <td>${simpleDate(item.createdAt)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="4">No vendor returns yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>PO Timeline</h3>
          <div class="timeline">
            ${poTimeline.map((event) => `
              <article class="timeline-event ${html(event.type || "status")}">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${html(event.title || "PO updated")}</strong>
                  <p>${html(event.message || "")}</p>
                  <small>${html(event.user || "Luis")} / ${dateLabel(event.createdAt)}</small>
                </div>
              </article>
            `).join("") || `<p class="muted">No PO timeline yet.</p>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function findReceiptSelection() {
  const po = (state.purchaseOrders || []).find((item) => item.id === selectedPoId);
  if (!po || !selectedReceiptRef) return { po: null, receipt: null, type: "receipt" };
  const list = selectedReceiptRef.type === "draft" ? (po.receiptDrafts || []) : (po.receipts || []);
  return {
    po,
    receipt: list.find((item) => item.id === selectedReceiptRef.id) || null,
    type: selectedReceiptRef.type || "receipt"
  };
}

function openReceiptDetail(receiptId, type = "receipt") {
  selectedReceiptRef = { id: receiptId, type };
  renderReceiptDetailModal();
  $("#receipt-detail-modal")?.classList.add("show");
  $("#receipt-detail-modal")?.setAttribute("aria-hidden", "false");
}

function closeReceiptDetailModal() {
  $("#receipt-detail-modal")?.classList.remove("show");
  $("#receipt-detail-modal")?.setAttribute("aria-hidden", "true");
  selectedReceiptRef = null;
}

function renderReceiptDetailModal() {
  const { po, receipt, type } = findReceiptSelection();
  const target = $("#receipt-detail-content");
  const title = $("#receipt-detail-title");
  if (!target || !title) return;
  if (!po || !receipt) {
    title.textContent = "Receipt";
    target.innerHTML = `<div class="empty-state">Receipt details are not available.</div>`;
    return;
  }
  const totalUnits = (receipt.items || []).reduce((sum, item) => sum + Number(item.qtyReceived || 0), 0);
  title.textContent = receipt.receiptNumber || "Receipt";
  target.innerHTML = `
    <div class="receipt-meta-grid">
      <span><small>Type</small><strong>${html(type === "draft" ? "Draft receipt" : "Posted receipt")}</strong></span>
      <span><small>PO</small><strong>${html(po.poNumber)}</strong></span>
      <span><small>Date</small><strong>${simpleDate(receipt.receivedAt)}</strong></span>
      <span><small>Units</small><strong>${totalUnits}</strong></span>
      <span><small>Warehouse</small><strong>${html(receipt.warehouseName || po.warehouseName || "Unassigned")}</strong></span>
      <span><small>Received by</small><strong>${html(receipt.receivedBy || "Luis")}</strong></span>
      <span><small>Default bin</small><strong>${html(receipt.defaultLocationBin || "Unassigned")}</strong></span>
      <span><small>Documents</small><strong>${Array.isArray(receipt.attachments) ? receipt.attachments.length : 0}</strong></span>
      <span><small>Notes</small><strong>${html(receipt.note || "No notes")}</strong></span>
    </div>
    <div class="receipt-line-list">
      ${(receipt.items || []).map((item) => `
        <article class="receipt-line-item">
          <div class="receipt-line-top">
            <div>
              <strong>${html(item.sku)}</strong>
              <small>${html(item.title || "")}</small>
            </div>
            <div class="receipt-chip-row">
              <span class="receipt-chip">Received ${Number(item.qtyReceived || 0)}</span>
              <span class="receipt-chip">Bin ${html(item.locationBin || receipt.defaultLocationBin || "Unassigned")}</span>
              ${item.varianceStatus && item.varianceStatus !== "none" ? `<span class="receipt-chip variance-${html(item.varianceStatus)}">${html(item.varianceStatus)}</span>` : ""}
            </div>
          </div>
          <small>Ordered ${Number(item.orderedQty || 0)} / Received before ${Number(item.receivedBefore || 0)}</small>
          ${item.varianceNote ? `<small>Variance note: ${html(item.varianceNote)}</small>` : ""}
          <small>${(item.serials || []).length ? (item.serials || []).map((serial) => serial.serialNumber).join(", ") : "No serials captured"}</small>
        </article>
      `).join("") || `<p class="muted">No receipt lines recorded.</p>`}
    </div>
    <div>
      <h3>Attachments</h3>
      <div class="receipt-attachment-grid">
        ${(receipt.attachments || []).map((file) => `
          <article class="receipt-attachment-item">
            <strong>${html(file.name)}</strong>
            <small>${html(file.source || "Manual upload")}</small>
            <small>${fileSizeLabel(file.size)} / ${html(file.mimeType || "Unknown type")}</small>
          </article>
        `).join("") || `<p class="muted">No documents attached.</p>`}
      </div>
    </div>
  `;
}

function renderVendors(query = "") {
  const vendors = (state.vendors || []).filter((vendor) => {
    const address = vendor.address || {};
    const haystack = `${vendor.vendorNumber} ${vendor.name} ${vendor.contactName} ${vendor.email} ${vendor.phone} ${vendor.notes} ${vendor.type} ${(vendor.categories || []).join(" ")} ${address.city} ${address.state}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#vendor-list").innerHTML = vendors.length
    ? `
      <div class="vendor-table-wrap">
        <table class="vendor-table">
          <thead>
            <tr>
              <th>Vendor name</th>
              <th>Vendor code</th>
              <th>Vendor POC</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${vendors.map((vendor) => `
              <tr class="${vendor.status === "inactive" ? "muted-row" : ""}">
                <td>
                  <button class="order-link vendor-name-link" data-select-vendor="${vendor.id}">${html(vendor.name)}</button>
                  <small><span class="status ${html(vendor.status)}">${html(vendor.status)}</span> ${html(vendor.type)}</small>
                </td>
                <td><strong>${html(vendor.vendorNumber)}</strong></td>
                <td>${html(vendor.contactName || "No contact")}</td>
                <td>${html(vendor.phone || "No phone")}</td>
                <td>${html(vendor.email || "No email")}</td>
                <td class="vendor-notes">${html(vendor.notes || "No notes")}</td>
                <td>
                  <div class="action-menu">
                    <button class="icon-button" data-action-menu="vendor-${vendor.id}" aria-label="Open vendor actions">...</button>
                    <div class="action-popover" data-menu-for="vendor-${vendor.id}">
                      <button data-vendor-action="edit" data-vendor-id="${vendor.id}">Edit vendor</button>
                      <button data-vendor-action="log" data-vendor-id="${vendor.id}">Show change log</button>
                      <button data-vendor-action="${vendor.status === "inactive" ? "active" : "inactive"}" data-vendor-id="${vendor.id}">${vendor.status === "inactive" ? "Set as active" : "Set as inactive"}</button>
                    </div>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No vendors match this search.</div>`;
}

function renderBrands(query = "") {
  const brands = (state.brands || []).filter((brand) => brand.status !== "void").filter((brand) => {
    const mapped = (brand.vendorIds || []).map((id) => state.vendors.find((vendor) => vendor.id === id)?.name).filter(Boolean).join(" ");
    return `${brand.name} ${brand.status} ${mapped} ${brand.notes} ${brand.category}`.toLowerCase().includes(query);
  });

  $("#brand-list").innerHTML = brands.length
    ? `
      <div class="brand-table-wrap">
        <table class="brand-table">
          <thead>
            <tr><th>Logo</th><th>Brand name</th><th>Status</th><th>Default vendor</th><th>Products qty</th><th>Last order</th><th>Order value</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${brands.map((brand) => {
              const products = state.inventory.filter((item) => item.brand === brand.name);
              const productSkus = new Set(products.map((item) => item.sku));
              const brandOrders = state.orders.filter((order) => productSkus.has(order.sku) || (order.items || []).some((item) => productSkus.has(item.sku)));
              const lastOrder = brandOrders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
              const orderValue = brandOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
              const preferredVendor = state.vendors.find((vendor) => vendor.id === brand.preferredVendorId);
              return `
                <tr>
                  <td>${brand.logoDataUrl || brand.logoUrl ? `<img class="brand-logo" src="${html(brand.logoDataUrl || brand.logoUrl)}" alt="${html(brand.name)} logo" />` : `<span class="brand-logo-placeholder">${html(brand.name.slice(0, 2).toUpperCase())}</span>`}</td>
                  <td><button class="order-link brand-name-link" data-select-brand="${brand.id}">${html(brand.name)}</button></td>
                  <td><span class="status ${html(brand.status || "active")}">${html(brand.status || "active")}</span></td>
                  <td>${preferredVendor ? `<button class="order-link" data-select-vendor="${preferredVendor.id}">${html(preferredVendor.name)}</button>` : "No default vendor"}</td>
                  <td>${products.reduce((sum, item) => sum + Number(item.qty || 0), 0)}</td>
                  <td>${lastOrder ? simpleDate(lastOrder.createdAt) : "None"}</td>
                  <td>${money(orderValue)}</td>
                  <td class="vendor-notes">${html(brand.notes || "No notes")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No brands match this search.</div>`;
}

function renderBrandProfile() {
  const brand = (state.brands || []).find((item) => item.id === selectedBrandId) || state.brands?.[0];
  const target = $("#brand-profile-page");
  if (!brand) {
    target.innerHTML = `<div class="empty-state">No brand selected.</div>`;
    return;
  }
  selectedBrandId = brand.id;
  const products = state.inventory.filter((item) => item.brand === brand.name);
  const productSkus = new Set(products.map((item) => item.sku));
  const brandOrders = state.orders.filter((order) => productSkus.has(order.sku) || (order.items || []).some((item) => productSkus.has(item.sku)));
  const preferredVendor = state.vendors.find((vendor) => vendor.id === brand.preferredVendorId);
  const orderValue = brandOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="purchasing">Back to purchasing</button>
        <div>
          <p class="eyebrow">Brand profile</p>
          <h2>${html(brand.name)}</h2>
          <p class="muted">${html(brand.category || "Uncategorized")} / ${html(brand.status || "active")}</p>
        </div>
        <div class="profit-pill">
          <small>Order value</small>
          <strong>${money(orderValue)}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Brand Summary</h3>
          <div class="summary-grid">
            <span><small>Products qty</small><strong>${products.reduce((sum, item) => sum + Number(item.qty || 0), 0)}</strong></span>
            <span><small>Products</small><strong>${products.length}</strong></span>
            <span><small>Orders</small><strong>${brandOrders.length}</strong></span>
            <span><small>Default vendor</small><strong>${preferredVendor ? html(preferredVendor.name) : "None"}</strong></span>
          </div>
        </section>
        <section class="full-card">
          <h3>Core Profile</h3>
          <div class="brand-logo-editor">
            ${brand.logoDataUrl || brand.logoUrl ? `<img class="brand-logo-large" src="${html(brand.logoDataUrl || brand.logoUrl)}" alt="${html(brand.name)} logo" />` : `<span class="brand-logo-large brand-logo-placeholder">${html(brand.name.slice(0, 2).toUpperCase())}</span>`}
            <label class="file-button secondary">
              Upload logo
              <input type="file" accept="image/*" data-brand-logo-upload="${brand.id}" />
            </label>
          </div>
          <div class="edit-stack">
            <label>Brand name<input value="${html(brand.name)}" data-brand-field="name" data-brand-id="${brand.id}" /></label>
            <label>Status<input value="${html(brand.status || "active")}" data-brand-field="status" data-brand-id="${brand.id}" /></label>
            <label>Category<input value="${html(brand.category || "")}" data-brand-field="category" data-brand-id="${brand.id}" /></label>
            <label>Website<input value="${html(brand.website || "")}" data-brand-field="website" data-brand-id="${brand.id}" /></label>
            <label>Logo URL<input value="${html(brand.logoUrl || "")}" data-brand-field="logoUrl" data-brand-id="${brand.id}" /></label>
          </div>
        </section>
        <section class="full-card">
          <h3>Commercial</h3>
          <div class="edit-stack">
            <label>Default vendor
              <select data-brand-field="preferredVendorId" data-brand-id="${brand.id}">
                <option value="">No default vendor</option>
                ${(state.vendors || []).map((vendor) => `<option value="${vendor.id}" ${brand.preferredVendorId === vendor.id ? "selected" : ""}>${html(vendor.name)}</option>`).join("")}
              </select>
            </label>
            <label>MAP policy<input value="${html(brand.mapPolicy || "")}" data-brand-field="mapPolicy" data-brand-id="${brand.id}" /></label>
            <label>Warranty<input value="${html(brand.warranty || "")}" data-brand-field="warranty" data-brand-id="${brand.id}" /></label>
            <label>Lead time notes<input value="${html(brand.leadTimeNotes || "")}" data-brand-field="leadTimeNotes" data-brand-id="${brand.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Vendors Carrying This Brand</h3>
          <div class="vendor-check-list brand-profile-vendors">
            ${(state.vendors || []).map((vendor) => `
              <label><input type="checkbox" ${brand.vendorIds?.includes(vendor.id) ? "checked" : ""} data-brand-vendor="${brand.id}" data-vendor-id="${vendor.id}" />${html(vendor.name)}</label>
            `).join("")}
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Notes</h3>
          <textarea rows="5" data-brand-field="notes" data-brand-id="${brand.id}">${html(brand.notes || "")}</textarea>
        </section>
        <section class="full-card span-2">
          <h3>Products</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>SKU</th><th>Title</th><th>Qty</th><th>Price</th></tr></thead>
              <tbody>${products.map((item) => `<tr><td><strong>${html(item.sku)}</strong></td><td>${html(item.title)}</td><td>${item.qty || 0}</td><td>${money(item.price)}</td></tr>`).join("") || `<tr><td colspan="4">No products for this brand.</td></tr>`}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}


function countLabel(value) {
  return Number(value || 0).toLocaleString();
}

function pctLabel(value, total) {
  const number = Number(value || 0);
  const denominator = Number(total || 0);
  if (!denominator) return "0%";
  return `${((number / denominator) * 100).toFixed(number / denominator >= 0.1 ? 0 : 1)}%`;
}

function chartRows(rows = [], total = 0, options = {}) {
  const selected = rows.filter(Boolean).slice(0, options.limit || 10);
  const max = Math.max(1, ...selected.map((row) => Number(row.count || 0)));
  return selected.length
    ? selected.map((row) => {
      const count = Number(row.count || 0);
      const width = Math.max(2, (count / max) * 100);
      return `
        <div class="vendor-chart-row">
          <div class="vendor-chart-label"><span>${html(row.name || "Unspecified")}</span><strong>${countLabel(count)}</strong></div>
          <div class="vendor-chart-track"><span style="width:${width}%"></span></div>
          <small>${pctLabel(count, total)}</small>
        </div>
      `;
    }).join("")
    : `<p class="muted">No catalog breakdown available.</p>`;
}

function binaryChartRows(rows = [], total = 0) {
  return rows.map((row) => ({ name: row.name, count: Number(row.count || 0) })).filter((row) => row.count > 0).map((row) => `
    <div class="vendor-metric-split-row">
      <span>${html(row.name)}</span>
      <strong>${countLabel(row.count)}</strong>
      <small>${pctLabel(row.count, total)}</small>
    </div>
  `).join("") || `<p class="muted">No split available.</p>`;
}

function purchaseOrderBreakdown(pos = []) {
  const statuses = new Map();
  const units = new Map();
  for (const po of pos) {
    const status = String(po.status || "unknown");
    statuses.set(status, (statuses.get(status) || 0) + 1);
    units.set(status, (units.get(status) || 0) + Number(po.totalUnits || 0));
  }
  return [...statuses.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name: `${name} (${countLabel(units.get(name) || 0)} units)`, count }));
}

function renderVendorCatalogCharts(vendor, pos = []) {
  const stats = vendor.catalogStats || {};
  const total = Number(stats.productCount || 0);
  const activeRows = [
    { name: "Active", count: stats.activeProductCount },
    { name: "Inactive", count: stats.inactiveProductCount }
  ];
  const stockRows = [
    { name: "In stock", count: stats.stockProductCount },
    { name: "Out of stock", count: stats.outOfStockProductCount }
  ];
  const poRows = purchaseOrderBreakdown(pos);
  return `
    <section class="full-card span-2 vendor-analytics-card">
      <div class="section-head vendor-section-head">
        <div>
          <h3>Catalog Analytics</h3>
          <p class="muted">Source catalog mix for this vendor.</p>
        </div>
        <span class="status active">${countLabel(total)} source SKUs</span>
      </div>
      <div class="vendor-kpi-strip">
        <span><small>In stock</small><strong>${countLabel(stats.stockProductCount)}</strong><em>${pctLabel(stats.stockProductCount, total)}</em></span>
        <span><small>Active</small><strong>${countLabel(stats.activeProductCount)}</strong><em>${pctLabel(stats.activeProductCount, total)}</em></span>
        <span><small>Categories</small><strong>${countLabel((stats.categoryCounts || []).length)}</strong><em>top groups</em></span>
        <span><small>Brands</small><strong>${countLabel((stats.brandCounts || []).length)}</strong><em>top brands</em></span>
      </div>
      <div class="vendor-analytics-layout">
        <div class="vendor-chart-panel vendor-primary-chart">
          <h4>Top Categories By SKU Count</h4>
          ${chartRows(stats.categoryCounts || [], total, { limit: 10 })}
        </div>
        <div class="vendor-side-stack">
          <div class="vendor-metric-panel">
            <h4>Availability</h4>
            ${binaryChartRows(stockRows, total)}
          </div>
          <div class="vendor-metric-panel">
            <h4>Source Status</h4>
            ${binaryChartRows(activeRows, total)}
          </div>
          <div class="vendor-chart-panel compact">
            <h4>Supplier Codes</h4>
            ${chartRows(stats.supplierCodeCounts || (stats.supplierCodes || []).map((name) => ({ name, count: 0 })), total, { limit: 5 })}
          </div>
        </div>
      </div>
      <div class="vendor-secondary-grid">
        <div class="vendor-chart-panel compact">
          <h4>Top Brands</h4>
          ${chartRows(stats.brandCounts || [], total, { limit: 7 })}
        </div>
        <div class="vendor-chart-panel compact">
          <h4>Stock Status</h4>
          ${chartRows(stats.stockStatusCounts || [], total, { limit: 7 })}
        </div>
        <div class="vendor-chart-panel compact">
          <h4>PO Status Mix</h4>
          ${chartRows(poRows, Math.max(1, pos.length), { limit: 7 })}
        </div>
      </div>
    </section>
  `;
}
function renderVendorProfile() {
  const vendor = (state.vendors || []).find((item) => item.id === selectedVendorId) || state.vendors?.[0];
  const target = $("#vendor-profile-page");
  if (!vendor) {
    target.innerHTML = `<div class="empty-state">No vendor selected.</div>`;
    return;
  }
  selectedVendorId = vendor.id;
  const address = vendor.address || {};
  const pos = (state.purchaseOrders || []).filter((po) => po.vendorId === vendor.id || po.supplier === vendor.name);
  const changeLog = Array.isArray(vendor.changeLog) ? [...vendor.changeLog].reverse() : [];
  const submission = vendor.submissionSettings || {};
  const fileFeeds = vendor.fileFeeds || {};

  const fileSection = (key, title) => {
    const files = Array.isArray(fileFeeds[key]) ? fileFeeds[key] : [];
    const latest = files[0];
    return `
      <div class="file-feed-panel">
        <div class="section-head">
          <h3>${title}</h3>
          <label class="file-button secondary">
            Upload
            <input type="file" data-vendor-file-upload="${vendor.id}" data-file-type="${key}" />
          </label>
        </div>
        <div class="file-feed-meta">
          <span><small>Last updated</small><strong>${latest ? dateLabel(latest.uploadedAt) : "Never"}</strong></span>
          <span><small>Source</small><strong>${html(latest?.source || "None")}</strong></span>
        </div>
        <div class="compact-list">
          ${files.slice(0, 5).map((file) => `
            <div class="compact-row">
              <div>
                <strong>${html(file.name)}</strong>
                <small>${html(file.source || "Manual upload")} / ${dateLabel(file.uploadedAt)}</small>
              </div>
              <small>${file.size ? `${Math.round(Number(file.size) / 1024)} KB` : ""}</small>
            </div>
          `).join("") || `<p class="muted">No files uploaded yet.</p>`}
        </div>
      </div>
    `;
  };

  target.innerHTML = `
    <div class="full-order vendor-profile">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="purchasing">Back to purchasing</button>
        <div>
          <p class="eyebrow">${html(vendor.vendorNumber)}</p>
          <h2>${html(vendor.name)}</h2>
          <p class="muted">${html(vendor.type)} / ${html(vendor.status)}</p>
        </div>
        <div class="full-order-actions">
          <button class="button secondary">Request quote</button>
          <button class="button">New PO</button>
        </div>
      </div>

      <div class="full-order-grid">
        <section class="full-card span-2 vendor-summary-card">
          <h3>Vendor Summary</h3>
          <div class="summary-grid">
            <span><small>Open POs</small><strong>${vendor.openPOs}</strong></span>
            <span><small>Total POs</small><strong>${vendor.totalPOs}</strong></span>
            <span><small>Total spend</small><strong>${money(vendor.totalSpend)}</strong></span>
            <span><small>Lead time</small><strong>${vendor.leadTimeDays} days</strong></span>
            <span><small>MOQ</small><strong>${vendor.moq}</strong></span>
            <span><small>Rating</small><strong>${vendor.rating || "N/A"}</strong></span>
            <span><small>Source SKUs</small><strong>${countLabel(vendor.catalogStats?.productCount)}</strong></span>
            <span><small>In-stock SKUs</small><strong>${countLabel(vendor.catalogStats?.stockProductCount)}</strong></span>
          </div>
        </section>
        ${renderVendorCatalogCharts(vendor, pos)}
        <section class="full-card">
          <h3>Primary Contact</h3>
          <div class="edit-stack">
            <label>Vendor name<input value="${html(vendor.name)}" data-vendor-field="name" data-vendor-id="${vendor.id}" /></label>
            <label>POC<input value="${html(vendor.contactName)}" data-vendor-field="contactName" data-vendor-id="${vendor.id}" /></label>
            <label>Email<input value="${html(vendor.email)}" data-vendor-field="email" data-vendor-id="${vendor.id}" /></label>
            <label>Phone<input value="${html(vendor.phone)}" data-vendor-field="phone" data-vendor-id="${vendor.id}" /></label>
            <label>Website<input value="${html(vendor.website)}" data-vendor-field="website" data-vendor-id="${vendor.id}" /></label>
          </div>
        </section>
        <section class="full-card">
          <h3>Address</h3>
          <p>${html(address.line1 || "")}${address.line2 ? `, ${html(address.line2)}` : ""}</p>
          <p>${html([address.city, address.state, address.postalCode].filter(Boolean).join(", "))}</p>
          <p>${html(address.country || "")}</p>
        </section>
        <section class="full-card">
          <h3>Terms</h3>
          <div class="edit-stack">
            <label>Payment terms<input value="${html(vendor.paymentTerms)}" data-vendor-field="paymentTerms" data-vendor-id="${vendor.id}" /></label>
            <label>Lead time days<input type="number" value="${vendor.leadTimeDays}" data-vendor-field="leadTimeDays" data-vendor-id="${vendor.id}" /></label>
            <label>Minimum order<input type="number" value="${vendor.moq}" data-vendor-field="moq" data-vendor-id="${vendor.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2 vendor-admin-card">
          <h3>Brands Carried</h3>
          <div class="vendor-check-list vendor-profile-brands">
            ${(state.brands || []).map((brand) => `
              <label><input type="checkbox" ${brand.vendorIds?.includes(vendor.id) ? "checked" : ""} data-vendor-brand="${vendor.id}" data-brand-id="${brand.id}" />${html(brand.name)}</label>
            `).join("")}
          </div>
        </section>
        <section class="full-card span-2 vendor-admin-card">
          <h3>PO Submission Setup</h3>
          <div class="submission-grid">
            <div class="edit-stack">
              <label>Preferred method
                <select data-vendor-field="submissionSettings.preferredMethod" data-vendor-id="${vendor.id}">
                  ${["email", "ftp", "api"].map((method) => `<option value="${method}" ${submission.preferredMethod === method ? "selected" : ""}>${method.toUpperCase()}</option>`).join("")}
                </select>
              </label>
              <label>Email enabled<input type="checkbox" ${submission.emailEnabled !== false ? "checked" : ""} data-vendor-field="submissionSettings.emailEnabled" data-vendor-id="${vendor.id}" /></label>
              <label>Email to<input value="${html(submission.emailTo || vendor.email || "")}" data-vendor-field="submissionSettings.emailTo" data-vendor-id="${vendor.id}" /></label>
              <label>Email cc<input value="${html(submission.emailCc || "")}" data-vendor-field="submissionSettings.emailCc" data-vendor-id="${vendor.id}" /></label>
              <label>Subject<input value="${html(submission.emailSubjectTemplate || "")}" data-vendor-field="submissionSettings.emailSubjectTemplate" data-vendor-id="${vendor.id}" /></label>
            </div>
            <div class="edit-stack">
              <label>FTP enabled<input type="checkbox" ${submission.ftpEnabled ? "checked" : ""} data-vendor-field="submissionSettings.ftpEnabled" data-vendor-id="${vendor.id}" /></label>
              <label>FTP host<input value="${html(submission.ftpHost || "")}" data-vendor-field="submissionSettings.ftpHost" data-vendor-id="${vendor.id}" /></label>
              <label>FTP port<input value="${html(submission.ftpPort || "22")}" data-vendor-field="submissionSettings.ftpPort" data-vendor-id="${vendor.id}" /></label>
              <label>FTP username<input value="${html(submission.ftpUsername || "")}" data-vendor-field="submissionSettings.ftpUsername" data-vendor-id="${vendor.id}" /></label>
              <label>FTP path<input value="${html(submission.ftpPath || "/incoming/po")}" data-vendor-field="submissionSettings.ftpPath" data-vendor-id="${vendor.id}" /></label>
            </div>
            <div class="edit-stack">
              <label>API enabled<input type="checkbox" ${submission.apiEnabled ? "checked" : ""} data-vendor-field="submissionSettings.apiEnabled" data-vendor-id="${vendor.id}" /></label>
              <label>API base URL<input value="${html(submission.apiBaseUrl || "")}" data-vendor-field="submissionSettings.apiBaseUrl" data-vendor-id="${vendor.id}" /></label>
              <label>API auth type<input value="${html(submission.apiAuthType || "API key")}" data-vendor-field="submissionSettings.apiAuthType" data-vendor-id="${vendor.id}" /></label>
              <label>API key reference<input value="${html(submission.apiKeyReference || "")}" data-vendor-field="submissionSettings.apiKeyReference" data-vendor-id="${vendor.id}" /></label>
              <label>Attach CSV<input type="checkbox" ${submission.attachCsv !== false ? "checked" : ""} data-vendor-field="submissionSettings.attachCsv" data-vendor-id="${vendor.id}" /></label>
              <label>Attach PDF<input type="checkbox" ${submission.attachPdf !== false ? "checked" : ""} data-vendor-field="submissionSettings.attachPdf" data-vendor-id="${vendor.id}" /></label>
            </div>
          </div>
        </section>
        <section class="full-card span-2 vendor-admin-card">
          <h3>Vendor Files</h3>
          <div class="file-section-grid">
            ${fileSection("priceUpdates", "Price Update Files")}
            ${fileSection("inventory", "Inventory Files")}
            ${fileSection("productCatalog", "Product Catalog Files")}
            ${fileSection("attachments", "Other Attachments")}
          </div>
        </section>
        <section class="full-card">
          <h3>Notes</h3>
          <textarea rows="5" data-vendor-field="notes" data-vendor-id="${vendor.id}">${html(vendor.notes || "")}</textarea>
        </section>
        <section class="full-card span-2">
          <h3>Purchase Orders</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>PO</th><th>Status</th><th>Orders</th><th>Units</th><th>Est. Cost</th><th>Created</th></tr></thead>
              <tbody>
                ${pos.map((po) => `
                  <tr>
                    <td><button class="order-link po-link" data-select-po="${po.id}">${html(po.poNumber)}</button></td>
                    <td><span class="status ${po.status}">${po.status}</span></td>
                    <td class="inline-links">${orderLinksForPo(po)}</td>
                    <td>${po.totalUnits}</td>
                    <td>${money(po.estimatedCost)}</td>
                    <td>${simpleDate(po.createdAt)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="6">No purchase orders yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2" id="vendor-change-log">
          <h3>Change Log</h3>
          <div class="timeline">
            ${changeLog.map((event) => `
              <article class="timeline-event ${html(event.type || "edited")}">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${html(event.title || "Vendor updated")}</strong>
                  <p>${html(event.message || "")}</p>
                  <small>${html(event.user || "System")} / ${dateLabel(event.createdAt)}</small>
                </div>
              </article>
            `).join("") || `<p class="muted">No vendor changes yet.</p>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderCustomers() {
  const query = $("#customer-search").value.trim().toLowerCase();
  const customers = (state.customers || []).filter((customer) => {
    const address = customer.defaultAddress || {};
    const haystack = `${customer.customerNumber} ${customer.name} ${customer.email} ${customer.phone} ${customer.company} ${customer.customerType} ${customer.status} ${address.city} ${address.state}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#customer-grid").innerHTML = customers.length
    ? `
      <div class="customer-table-wrap">
        <table class="customer-table">
          <thead>
            <tr>
              <th>Customer name</th>
              <th>Customer code</th>
              <th>Type</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Orders</th>
              <th>Lifetime value</th>
              <th>Last order</th>
            </tr>
          </thead>
          <tbody>
            ${customers.map((customer) => `
              <tr>
                <td>
                  <button class="order-link customer-name-link" data-select-customer="${customer.id}">${html(customer.name)}</button>
                  <small><span class="status ${customer.repeatCustomer ? "live" : "draft"}">${customer.repeatCustomer ? "Repeat" : "New"}</span> ${html(customer.status || "active")}</small>
                </td>
                <td><strong>${html(customer.customerNumber)}</strong></td>
                <td>${html(customer.customerType || "Retail")}</td>
                <td>${html(customer.phone || "No phone")}</td>
                <td>${html(customer.email || "No email")}</td>
                <td>${customer.totalOrders || 0}</td>
                <td>${money(customer.lifetimeValue)}</td>
                <td>${customer.lastOrderAt ? simpleDate(customer.lastOrderAt) : "None"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No customers match this search.</div>`;
}

function renderCustomerAddressList(customer, type, title) {
  const key = type === "billing" ? "billingAddresses" : "shippingAddresses";
  const addresses = Array.isArray(customer[key]) ? customer[key] : [];
  return `
    <section class="full-card">
      <div class="section-head">
        <h3>${title}</h3>
        <button class="button secondary" data-add-customer-address="${customer.id}" data-address-type="${type}">Add</button>
      </div>
      <div class="address-list">
        ${addresses.map((address, index) => `
          <article class="address-card">
            <div class="address-card-head">
              <strong>${html(address.label || `${title} ${index + 1}`)}</strong>
              ${address.isDefault ? `<span class="status active">Default</span>` : ""}
            </div>
            <div class="edit-stack">
              <label>Label<input value="${html(address.label || "")}" data-customer-field="${key}.${index}.label" data-customer-id="${customer.id}" /></label>
              <label>Name<input value="${html(address.name || "")}" data-customer-field="${key}.${index}.name" data-customer-id="${customer.id}" /></label>
              <label>Company<input value="${html(address.company || "")}" data-customer-field="${key}.${index}.company" data-customer-id="${customer.id}" /></label>
              <label>Line 1<input value="${html(address.line1 || "")}" data-customer-field="${key}.${index}.line1" data-customer-id="${customer.id}" /></label>
              <label>Line 2<input value="${html(address.line2 || "")}" data-customer-field="${key}.${index}.line2" data-customer-id="${customer.id}" /></label>
              <label>City<input value="${html(address.city || "")}" data-customer-field="${key}.${index}.city" data-customer-id="${customer.id}" /></label>
              <label>State<input value="${html(address.state || "")}" data-customer-field="${key}.${index}.state" data-customer-id="${customer.id}" /></label>
              <label>Postal code<input value="${html(address.postalCode || "")}" data-customer-field="${key}.${index}.postalCode" data-customer-id="${customer.id}" /></label>
              <label>Country<input value="${html(address.country || "US")}" data-customer-field="${key}.${index}.country" data-customer-id="${customer.id}" /></label>
              <label>Phone<input value="${html(address.phone || "")}" data-customer-field="${key}.${index}.phone" data-customer-id="${customer.id}" /></label>
            </div>
          </article>
        `).join("") || `<p class="muted">No ${type} addresses yet.</p>`}
      </div>
    </section>
  `;
}

function renderCustomerProfile() {
  const customer = (state.customers || []).find((item) => item.id === selectedCustomerId) || state.customers?.[0];
  const target = $("#customer-profile-page");
  if (!customer) {
    target.innerHTML = `<div class="empty-state">No customer selected.</div>`;
    return;
  }
  selectedCustomerId = customer.id;
  const orders = state.orders.filter((order) => order.customerId === customer.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tags = Array.isArray(customer.tags) ? customer.tags.join(", ") : customer.tags || "";
  const marketplaceAccounts = Array.isArray(customer.marketplaceAccounts) ? customer.marketplaceAccounts : [];
  const identities = Array.isArray(customer.identities) ? customer.identities : [];
  const timeline = Array.isArray(customer.timeline) ? [...customer.timeline].reverse() : [];
  const drafts = draftsForCustomerHistory(customer).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const returns = returnsForCustomerHistory(customer).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="customers">Back to customers</button>
        <div>
          <p class="eyebrow">${html(customer.customerNumber)}</p>
          <h2>${html(customer.name)}</h2>
          <p class="muted">${html(customer.customerType || "Retail")} / ${customer.repeatCustomer ? "Repeat customer" : "New customer"}</p>
        </div>
        <div class="profit-pill">
          <small>Lifetime value</small>
          <strong>${money(customer.lifetimeValue)}</strong>
        </div>
      </div>

      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Customer Summary</h3>
          <div class="summary-grid">
            <span><small>Total orders</small><strong>${customer.totalOrders || 0}</strong></span>
            <span><small>First order</small><strong>${customer.firstOrderAt ? simpleDate(customer.firstOrderAt) : "None"}</strong></span>
            <span><small>Last order</small><strong>${customer.lastOrderAt ? simpleDate(customer.lastOrderAt) : "None"}</strong></span>
            <span><small>Status</small><strong>${html(customer.status || "active")}</strong></span>
          </div>
        </section>
        <section class="full-card">
          <h3>Core Profile</h3>
          <div class="edit-stack">
            <label>Customer name<input value="${html(customer.name)}" data-customer-field="name" data-customer-id="${customer.id}" /></label>
            <label>Company<input value="${html(customer.company || "")}" data-customer-field="company" data-customer-id="${customer.id}" /></label>
            <label>Customer type<input value="${html(customer.customerType || "Retail")}" data-customer-field="customerType" data-customer-id="${customer.id}" /></label>
            <label>Status<input value="${html(customer.status || "active")}" data-customer-field="status" data-customer-id="${customer.id}" /></label>
            <label>Tags<input value="${html(tags)}" data-customer-field="tags" data-customer-id="${customer.id}" /></label>
          </div>
        </section>
        <section class="full-card">
          <h3>Contact</h3>
          <div class="edit-stack">
            <label>Email<input value="${html(customer.email || "")}" data-customer-field="email" data-customer-id="${customer.id}" /></label>
            <label>Phone<input value="${html(customer.phone || "")}" data-customer-field="phone" data-customer-id="${customer.id}" /></label>
            <label>Preferred channel<input value="${html(customer.preferredChannel || "Email")}" data-customer-field="preferredChannel" data-customer-id="${customer.id}" /></label>
            <label>Tax exempt<input value="${html(customer.taxExempt ? "yes" : "no")}" data-customer-field="taxExempt" data-customer-id="${customer.id}" /></label>
            <label>Marketing opt-in<input value="${html(customer.marketingOptIn ? "yes" : "no")}" data-customer-field="marketingOptIn" data-customer-id="${customer.id}" /></label>
          </div>
        </section>
        ${renderCustomerAddressList(customer, "shipping", "Shipping Addresses")}
        ${renderCustomerAddressList(customer, "billing", "Billing Addresses")}
        <section class="full-card">
          <h3>Accounts</h3>
          <div class="mini-history">
            ${marketplaceAccounts.map((account) => `<button><strong>${html(account.type)}</strong><span>${html(account.value)}</span></button>`).join("") || `<p class="muted">No marketplace accounts yet.</p>`}
            ${identities.map((identity) => `<button><strong>${html(identity.type)}</strong><span>${html(identity.value)}</span></button>`).join("")}
          </div>
        </section>
        <section class="full-card">
          <h3>Notes</h3>
          <textarea rows="7" data-customer-field="notes" data-customer-id="${customer.id}">${html(customer.notes || "")}</textarea>
        </section>
        <section class="full-card span-2">
          <h3>Order History</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Order</th><th>Source</th><th>Status</th><th>Total</th><th>Created</th></tr></thead>
              <tbody>
                ${orders.map((order) => `
                  <tr>
                    <td><button class="order-link" data-select-order="${order.id}" data-open-detail>${html(order.orderNumber)}</button><small>${html(order.marketplaceOrderNumber || order.marketplaceOrderId || "n/a")}</small></td>
                    <td>${html(order.source)}</td>
                    <td><span class="status ${html(order.status)}">${html(order.status)}</span></td>
                    <td>${money(order.total)}</td>
                    <td>${simpleDate(order.createdAt)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="5">No orders yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Quote History</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Draft</th><th>Revision</th><th>Source</th><th>Total</th><th>Updated</th></tr></thead>
              <tbody>
                ${drafts.map((draft) => {
                  const siblingRevisions = (state.orderDrafts || []).filter((row) => row.quoteGroupId && row.quoteGroupId === draft.quoteGroupId);
                  const highestRevision = Math.max(...siblingRevisions.map((row) => Number(row.revisionNumber || 1)));
                  return `
                    <tr>
                      <td><button class="order-link" data-select-draft="${draft.id}" data-open-draft-detail>${html(draft.draftNumber)}</button><small>${html(draft.marketplaceOrderNumber || "No external reference")}</small></td>
                      <td><span class="status ${Number(draft.revisionNumber || 1) === highestRevision ? "confirmed" : "hold"}">Rev ${Number(draft.revisionNumber || 1)}${Number(draft.revisionNumber || 1) === highestRevision ? " / latest" : " / superseded"}</span></td>
                      <td>${html(draft.source || "Manual")}</td>
                      <td>${money(draft.total || 0)}</td>
                      <td>${simpleDate(draft.updatedAt || draft.createdAt)}</td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="5">No quotes yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Return History</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Return</th><th>Order</th><th>Status</th><th>Disposition</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>
                ${returns.map((record) => `
                  <tr>
                    <td><button class="order-link" data-select-return="${record.id}">${html(record.returnNumber || "Pending")}</button></td>
                    <td>${record.orderId ? `<button class="order-link" data-select-order="${record.orderId}" data-open-detail>${html(record.orderNumber || "")}</button>` : html(record.orderNumber || "")}</td>
                    <td><span class="status ${html(record.status || "requested")}">${html(record.status || "requested")}</span></td>
                    <td>${html(record.disposition || "Pending")}</td>
                    <td>${money(record.amount || 0)}</td>
                    <td>${simpleDate(record.createdAt)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="6">No returns yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Customer Timeline</h3>
          <div class="timeline">
            ${timeline.map((event) => `
              <article class="timeline-event ${html(event.type || "edited")}">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${html(event.title || "Customer updated")}</strong>
                  <p>${html(event.message || "")}</p>
                  <small>${html(event.user || "System")} / ${dateLabel(event.createdAt)}</small>
                </div>
              </article>
            `).join("") || `<p class="muted">No customer timeline yet.</p>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function filteredCatalogItems() {
  const query = $("#catalog-search")?.value.trim().toLowerCase() || "";
  const filters = catalogFilters();
  return state.inventory.filter((item) => {
    const shadows = (item.shadowSkus || []).map((shadow) => `${shadow.shadowSku} ${shadow.marketplace}`).join(" ");
    const matchesSearch = `${item.sku} ${item.title} ${item.marketplaceTitle} ${item.brand} ${item.category} ${item.sourceCategory} ${item.vendorCategory} ${item.vendor} ${item.supplier} ${item.supplierCode} ${shadows}`.toLowerCase().includes(query);
    if (!matchesSearch) return false;
    if (filters.supplier && String(item.supplier || item.vendor || "") !== filters.supplier) return false;
    if (filters.active && String(item.active !== false) !== filters.active) return false;
    if (filters.stockStatus && String(item.stockStatus || "") !== filters.stockStatus) return false;
    if (filters.shopifyStatus === "live" && !(item.shopifyId && item.shopifyStatus === "Active" && item.shopifyPublished === true)) return false;
    if (filters.shopifyStatus === "missing" && item.shopifyId) return false;
    if (filters.shopifyStatus && !["live", "missing"].includes(filters.shopifyStatus) && String(item.shopifyStatus || "") !== filters.shopifyStatus) return false;
    if (filters.hasStock && String(Number(item.stockQty ?? item.qty ?? 0) > 0) !== filters.hasStock) return false;
    if (filters.hazardous && String(Boolean(item.hazardous)) !== filters.hazardous) return false;
    if (filters.verifiedBrand && String(Boolean(verifiedBrandForHandle(item))) !== filters.verifiedBrand) return false;
    if (filters.brand && String(item.brand || "") !== filters.brand) return false;
    if (filters.category && String(item.category || "") !== filters.category) return false;
    return true;
  });
}

function catalogFilters() {
  return {
    supplier: catalogTab === "source" ? "" : ($("#catalog-filter-supplier")?.value || ""),
    suppliers: catalogTab === "source" ? [...selectedSourceSuppliers].join("|") : "",
    active: $("#catalog-filter-active")?.value || "",
    productMembership: $("#catalog-filter-product-membership")?.value || "",
    stockStatus: $("#catalog-filter-stock-status")?.value || "",
    shopifyStatus: catalogTab === "source" ? "" : ($("#catalog-filter-shopify-status")?.value || ""),
    hasStock: $("#catalog-filter-has-stock")?.value || "",
    hazardous: $("#catalog-filter-hazardous")?.value || "",
    verifiedBrand: catalogTab === "source" ? "" : ($("#catalog-filter-verified-brand")?.value || ""),
    brand: $("#catalog-filter-brand")?.value || "",
    category: $("#catalog-filter-category")?.value || ""
  };
}

function fillSelectOptions(select, values = [], emptyLabel = "All") {
  if (!select) return;
  const current = select.value;
  const first = select.querySelector("option")?.outerHTML || `<option value="">${emptyLabel}</option>`;
  const unique = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b)).slice(0, 250);
  select.innerHTML = first + unique.map((value) => `<option value="${html(value)}">${html(value)}</option>`).join("");
  if (unique.includes(current)) select.value = current;
}

function domToken(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function hasText(value, min = 1) {
  return String(value || "").replace(/<[^>]+>/g, " ").trim().length >= min;
}

function productReadiness(item = {}) {
  const available = Number(item.qty ?? item.stockQty ?? 0) - Number(item.reserved || 0);
  const checks = [
    { key: "title", label: "Title", ok: hasText(item.marketplaceTitle || item.title, 8) },
    { key: "description", label: "Description", ok: hasText(item.longDescription || item.shortDescription, 40) },
    { key: "image", label: "Image", ok: Boolean(item.defaultImage || (item.images || [])[0]) },
    { key: "category", label: "Main category", ok: hasText(item.category) && item.categoryVerified !== false },
    { key: "brand", label: "Brand", ok: hasText(item.brand) },
    { key: "price", label: "Price", ok: Number(item.price || 0) > 0 },
    { key: "vendor", label: "Vendor", ok: hasText(item.vendor || item.supplier) },
    { key: "stock", label: "Stock", ok: available > 0 },
    { key: "barcode", label: "UPC / barcode", ok: hasText(item.barcode) },
    { key: "dimensions", label: "Weight / dimensions", ok: Number(item.weightOz || item.itemWeight || 0) > 0 }
  ];
  const passed = checks.filter((check) => check.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);
  return { score, passed, total: checks.length, missing, ready: score >= 80 && missing.length <= 2 };
}

function readinessTone(score) {
  if (score >= 80) return "active";
  if (score >= 50) return "hold";
  return "canceled";
}

function renderReadinessPill(item) {
  const readiness = productReadiness(item);
  return `<span class="status ${readinessTone(readiness.score)}">${withIcon("gauge", String(readiness.score) + "% ready", "status-icon")}</span>`;
}

async function loadProductAlternates(sku) {
  const key = String(sku || "").toLowerCase();
  if (!key || productAlternatesCache[key]) return;
  productAlternatesCache[key] = { loading: true, rows: [] };
  try {
    const result = await api(`/api/catalog/alternates?sku=${encodeURIComponent(sku)}`);
    productAlternatesCache[key] = { loading: false, rows: result.alternates?.[key] || [] };
  } catch (error) {
    productAlternatesCache[key] = { loading: false, rows: [], error: error.message };
  }
  if ((state.inventory || []).find((item) => item.id === selectedProductId)?.sku === sku) renderProductContentPage();
}

async function loadProductTableAlternates(items = []) {
  const missingSkus = [...new Set(items.map((item) => item.sku).filter(Boolean))]
    .filter((sku) => !productAlternatesCache[String(sku).toLowerCase()]);
  if (!missingSkus.length) return;
  for (const sku of missingSkus) productAlternatesCache[String(sku).toLowerCase()] = { loading: true, rows: [] };
  try {
    const result = await api(`/api/catalog/alternates?skus=${encodeURIComponent(missingSkus.join(","))}`);
    for (const sku of missingSkus) {
      const key = String(sku).toLowerCase();
      productAlternatesCache[key] = { loading: false, rows: result.alternates?.[key] || [] };
    }
  } catch (error) {
    for (const sku of missingSkus) {
      productAlternatesCache[String(sku).toLowerCase()] = { loading: false, rows: [], error: error.message };
    }
  }
  if (catalogTab === "products") renderProductsTable(filteredCatalogItems());
}

function renderProductAlternatesCell(item = {}) {
  const key = String(item.sku || "").toLowerCase();
  const cache = productAlternatesCache[key];
  if (!cache || cache.loading) return `<span class="status draft">Loading</span>`;
  const rows = cache.rows || [];
  if (!rows.length) return `<span class="status draft">None found</span>`;
  const vendors = [...new Set(rows.map((row) => row.supplier || row.vendor || "Unknown").filter(Boolean))];
  const cheapest = rows.reduce((best, row) => {
    const cost = Number(row.cost || 0);
    if (!best || (cost > 0 && cost < Number(best.cost || Infinity))) return row;
    return best;
  }, null);
  return `
    <span class="status ${vendors.length > 1 ? "hold" : "ready"}">${vendors.length} vendor${vendors.length === 1 ? "" : "s"}</span>
    <small>${html(vendors.slice(0, 2).join(", "))}${vendors.length > 2 ? ` +${vendors.length - 2}` : ""}</small>
    ${cheapest ? `<small>Best cost ${money(cheapest.cost || 0)} / Qty ${Number(cheapest.stockQty ?? cheapest.qty ?? 0)}</small>` : ""}
  `;
}

function renderProductAvailabilityPanel(item = {}) {
  const key = String(item.sku || "").toLowerCase();
  const cache = productAlternatesCache[key];
  if (!cache) {
    loadProductAlternates(item.sku);
    return `<p class="muted">Loading vendor availability...</p>`;
  }
  if (cache.loading) return `<p class="muted">Loading vendor availability...</p>`;
  if (cache.error) return `<p class="muted">Unable to load vendor availability.</p>`;
  const rows = cache.rows || [];
  return rows.length
    ? `
      <div class="catalog-table-wrap compact-availability">
        <table class="catalog-table">
          <thead><tr><th>SKU</th><th>Vendor / Supplier</th><th>Brand</th><th>Cost</th><th>Qty</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${html(row.sku)}</td>
                <td>${html(row.supplier || row.vendor || "Unknown")}</td>
                <td>${html(row.brand || "No brand")}</td>
                <td>${money(row.cost || 0)}</td>
                <td>${Number(row.stockQty ?? row.qty ?? 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<p class="muted">No source catalog vendor availability found for this SKU.</p>`;
}

function updateCatalogFilterOptions() {
  if (!state) return;
  if (catalogTab === "source") {
    if (!sourceCatalogFacets) loadSourceCatalogFacets();
    const facets = sourceCatalogFacets || {};
    renderSupplierMultiSelect(facets.suppliers || []);
    fillSelectOptions($("#catalog-filter-stock-status"), facets.stockStatuses || [], "Any stock status");
    fillSelectOptions($("#catalog-filter-brand"), facets.brands || [], "All brands");
    fillSelectOptions($("#catalog-filter-category"), facets.categories || [], "All categories");
    return;
  }
  const products = state.inventory || [];
  if (productFilterOptionsCache.inventoryCount !== products.length) {
    productFilterOptionsCache = {
      inventoryCount: products.length,
      suppliers: products.map((item) => item.supplier || item.vendor),
      stockStatuses: products.map((item) => item.stockStatus),
      shopifyStatuses: products.map((item) => item.shopifyStatus),
      brands: products.map((item) => item.brand),
      categories: products.map((item) => item.category)
    };
  }
  $("#supplier-multi-filter")?.remove();
  $("#catalog-filter-supplier").style.display = "";
  fillSelectOptions($("#catalog-filter-supplier"), productFilterOptionsCache.suppliers, "All suppliers");
  fillSelectOptions($("#catalog-filter-stock-status"), productFilterOptionsCache.stockStatuses, "Any stock status");
  fillSelectOptions($("#catalog-filter-shopify-status"), productFilterOptionsCache.shopifyStatuses, "Any Shopify status");
  fillSelectOptions($("#catalog-filter-brand"), productFilterOptionsCache.brands, "All brands");
  fillSelectOptions($("#catalog-filter-category"), productFilterOptionsCache.categories, "All categories");
}

function renderSupplierMultiSelect(suppliers = []) {
  const select = $("#catalog-filter-supplier");
  if (!select) return;
  select.style.display = "none";
  let container = $("#supplier-multi-filter");
  if (!container) {
    container = document.createElement("div");
    container.id = "supplier-multi-filter";
    container.className = "supplier-multi-filter";
    select.insertAdjacentElement("afterend", container);
  }
  const query = $("#supplier-multi-search")?.value || "";
  const q = query.trim().toLowerCase();
  const selected = [...selectedSourceSuppliers];
  const filtered = suppliers
    .filter((supplier) => !q || String(supplier).toLowerCase().includes(q))
    .slice(0, 120);
  container.innerHTML = `
    <button type="button" class="supplier-chip-control ${supplierMultiOpen ? "open" : ""}" data-toggle-supplier-filter>
      <span class="supplier-chip-list">
        ${selected.length ? selected.slice(0, 4).map((supplier) => `<span class="supplier-chip">${html(supplier)} <em data-remove-source-supplier="${html(supplier)}">x</em></span>`).join("") : `<span class="supplier-placeholder">All suppliers</span>`}
        ${selected.length > 4 ? `<span class="supplier-chip more">+${selected.length - 4}</span>` : ""}
      </span>
      <span class="supplier-caret">${supplierMultiOpen ? "▲" : "▼"}</span>
    </button>
    <div class="supplier-dropdown ${supplierMultiOpen ? "show" : ""}">
      <div class="supplier-search-row">
        <input id="supplier-multi-search" type="search" placeholder="Search suppliers" value="${html(query)}" />
        <button type="button" class="text-button" data-clear-source-suppliers ${selected.length ? "" : "disabled"}>Clear</button>
      </div>
      <div class="supplier-option-list">
        ${filtered.map((supplier) => `
          <label class="${selectedSourceSuppliers.has(String(supplier)) ? "selected" : ""}">
            <input type="checkbox" data-source-supplier="${html(supplier)}" ${selectedSourceSuppliers.has(String(supplier)) ? "checked" : ""} />
            <span>${html(supplier)}</span>
          </label>
        `).join("") || `<div class="empty-state compact">No suppliers match.</div>`}
      </div>
    </div>
  `;
}

async function loadSourceCatalog(page = sourceCatalogPage) {
  const query = $("#catalog-search")?.value.trim() || "";
  const requestId = ++sourceCatalogRequestId;
  sourceCatalogState = { ...sourceCatalogState, loading: true, query };
  renderSourceCatalogTable();
  try {
    const filters = catalogFilters();
    const params = new URLSearchParams({ q: query, page: String(page), limit: "50" });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const result = await api(`/api/catalog/products?${params.toString()}`);
    if (requestId !== sourceCatalogRequestId) return;
    sourceCatalogPage = result.page || page;
    sourceCatalogState = { ...result, loading: false, query };
    mergeSourceFacetsFromItems(result.items || []);
    renderSourceCatalogTable();
  } catch (error) {
    if (requestId !== sourceCatalogRequestId) return;
    sourceCatalogState = { items: [], totalMatches: 0, hasMore: false, manifest: null, query, loading: false, error: error.message };
    renderSourceCatalogTable();
  }
}

function mergeSourceFacetsFromItems(items = []) {
  const current = sourceCatalogFacets || { suppliers: [], stockStatuses: [], brands: [], categories: [] };
  const merge = (existing = [], values = []) => [...new Set([...existing, ...values.filter(Boolean).map(String)])].sort((a, b) => a.localeCompare(b)).slice(0, 500);
  sourceCatalogFacets = {
    ...current,
    suppliers: merge(current.suppliers, items.map((item) => item.supplier)),
    stockStatuses: merge(current.stockStatuses, items.map((item) => item.stockStatus)),
    brands: merge(current.brands, items.map((item) => item.brand)),
    categories: merge(current.categories, items.map((item) => item.category))
  };
  updateCatalogFilterOptions();
}

async function loadSourceCatalogFacets() {
  try {
    sourceCatalogFacets = await api("/api/catalog/facets");
    if (catalogTab === "source") updateCatalogFilterOptions();
  } catch {
    sourceCatalogFacets = { suppliers: [], stockStatuses: [], brands: [], categories: [] };
  }
}

async function loadCategories() {
  const query = $("#catalog-search")?.value.trim() || "";
  const requestId = ++categoryRequestId;
  categoryState = { ...categoryState, loading: true, query, scope: categoryScope };
  renderCategories();
  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("scope", categoryScope);
    const result = await api(`/api/categories?${params.toString()}`);
    if (requestId !== categoryRequestId) return;
    categoryState = { ...result, query, scope: categoryScope, loading: false };
    if (!selectedCategoryId || !(categoryState.categories || []).some((category) => category.id === selectedCategoryId)) {
      selectedCategoryId = categoryState.categories?.[0]?.id || null;
    }
    renderCategories();
  } catch (error) {
    if (requestId !== categoryRequestId) return;
    categoryState = { categories: [], total: 0, query, loading: false, error: error.message };
    renderCategories();
  }
}

async function loadShopifyTaxonomyOptions(categoryId, query) {
  const requestCategoryId = categoryId;
  const requestQuery = String(query || "").trim();
  shopifyTaxonomyState = { ...shopifyTaxonomyState, categoryId: requestCategoryId, query: requestQuery, loading: true };
  renderCategories();
  try {
    const params = new URLSearchParams({ q: requestQuery, limit: "12" });
    const result = await api(`/api/channel-taxonomies/shopify/categories?${params.toString()}`);
    if (shopifyTaxonomyState.categoryId !== requestCategoryId || shopifyTaxonomyState.query !== requestQuery) return;
    shopifyTaxonomyState = { categoryId: requestCategoryId, query: requestQuery, results: result.categories || [], total: result.total || 0, version: result.version || "", loading: false };
    renderCategories();
  } catch (error) {
    if (shopifyTaxonomyState.categoryId !== requestCategoryId || shopifyTaxonomyState.query !== requestQuery) return;
    shopifyTaxonomyState = { categoryId: requestCategoryId, query: requestQuery, results: [], total: 0, version: "", loading: false, error: error.message };
    renderCategories();
  }
}

function renderShopifyAttributeList(attributes = []) {
  const rows = attributes.slice(0, 24);
  if (!rows.length) return `<p class="muted">Select a Shopify category to see channel attributes.</p>`;
  return `
    <div class="shopify-attribute-list">
      ${rows.map((attribute) => `
        <span title="${html(attribute.description || attribute.name || "")}">
          <strong>${html(attribute.name || attribute.handle || attribute.id)}</strong>
          <small>${html(attribute.handle || attribute.id || "")}${attribute.extended ? " / extended" : ""}</small>
        </span>
      `).join("")}
    </div>
    ${attributes.length > rows.length ? `<small class="muted">+${attributes.length - rows.length} more attributes</small>` : ""}
  `;
}

function renderShopifyCategoryMapper(category) {
  const mapping = category.mappings?.shopify || {};
  const selectedSearch = shopifyTaxonomyState.categoryId === category.id
    ? shopifyTaxonomyState
    : { query: mapping.categoryPath || "", results: [], total: 0, loading: false };
  const status = mappingStatus(category, "shopify");
  return `
    <section class="category-map-card shopify-taxonomy-card ${status}">
      <div class="section-head">
        <div>
          <h4>Shopify</h4>
          <p class="muted">Search Shopify's product taxonomy, then use the matching category.</p>
        </div>
        <span class="status ${status === "mapped" ? "active" : "hold"}">${status}</span>
      </div>
      <div class="shopify-selected-category">
        <span><small>Selected category</small><strong>${html(mapping.categoryPath || "None selected")}</strong></span>
        ${mapping.categoryId ? `<code>${html(mapping.categoryId)}</code>` : ""}
        ${mapping.googleCategory?.id ? `<div class="google-category-chip"><strong>Google ${html(mapping.googleCategory.id)}</strong><small>${html(mapping.googleCategory.breadcrumb || mapping.googleCategory.fullName || "")}</small></div>` : ""}
        ${mapping.taxonomyVersion ? `<small>Taxonomy ${html(mapping.taxonomyVersion)}</small>` : ""}
      </div>
      <label class="shopify-taxonomy-search">Search Shopify taxonomy
        <input value="${html(selectedSearch.query || "")}" placeholder="Search category, e.g. air fryer, safety gloves" data-shopify-taxonomy-search="${category.id}" />
      </label>
      <div class="shopify-taxonomy-results">
        ${selectedSearch.loading ? `<div class="empty-state compact">Searching Shopify...</div>` : ""}
        ${selectedSearch.error ? `<div class="empty-state compact">${html(selectedSearch.error)}</div>` : ""}
        ${(!selectedSearch.loading && selectedSearch.results.length) ? selectedSearch.results.map((result) => `
          <button class="shopify-taxonomy-result" data-apply-shopify-taxonomy="${category.id}" data-shopify-category-id="${html(result.id)}">
            <span><strong>${html(result.name)}</strong><small>${html(result.fullName)}</small>${result.googleCategory?.id ? `<small>Google ${html(result.googleCategory.id)} / ${html(result.googleCategory.breadcrumb || result.googleCategory.fullName || "")}</small>` : ""}</span>
            <em>${Number(result.attributeCount || 0).toLocaleString()} attrs</em>
          </button>
        `).join("") : ""}
        ${(!selectedSearch.loading && selectedSearch.query && !selectedSearch.results.length && !selectedSearch.error) ? `<div class="empty-state compact">No Shopify categories found.</div>` : ""}
      </div>
      <div class="category-map-grid shopify-manual-fields">
        <label>Category ID<input value="${html(mapping.categoryId || "")}" data-category-map="${category.id}" data-channel="shopify" data-map-field="categoryId" /></label>
        <label>Category path<input value="${html(mapping.categoryPath || "")}" data-category-map="${category.id}" data-channel="shopify" data-map-field="categoryPath" /></label>
        <label>Collection / handle<input value="${html(mapping.collectionHandle || "")}" data-category-map="${category.id}" data-channel="shopify" data-map-field="collectionHandle" /></label>
        <label>Notes<input value="${html(mapping.notes || "")}" data-category-map="${category.id}" data-channel="shopify" data-map-field="notes" /></label>
      </div>
      <div class="shopify-required-attributes">
        <h5>Shopify Attributes</h5>
        ${renderShopifyAttributeList(mapping.attributes || [])}
      </div>
    </section>
  `;
}

async function applyShopifyTaxonomyCategory(button) {
  const categoryId = button.dataset.applyShopifyTaxonomy;
  const shopifyCategoryId = button.dataset.shopifyCategoryId;
  if (!categoryId || !shopifyCategoryId) return;
  const result = await api(`/api/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify({ scope: categoryScope, channel: "shopify", mapping: { categoryId: shopifyCategoryId } })
  });
  categoryState = { ...result, query: categoryState.query, scope: categoryScope, loading: false };
  selectedCategoryId = categoryId;
  shopifyTaxonomyState = { categoryId, query: "", results: [], total: 0, version: "", loading: false };
  renderCategories();
  toast("Shopify category mapped.");
}
function mappingStatus(category, channel) {
  const mapping = category.mappings?.[channel] || {};
  return mapping.categoryId || mapping.categoryPath || mapping.collectionHandle ? "mapped" : "missing";
}

function renderCategoryMappingFields(category, channel, label) {
  if (channel === "shopify") return renderShopifyCategoryMapper(category);
  const mapping = category.mappings?.[channel] || {};
  return `
    <section class="category-map-card ${mappingStatus(category, channel)}">
      <div class="section-head">
        <h4>${label}</h4>
        <span class="status ${mappingStatus(category, channel) === "mapped" ? "active" : "hold"}">${mappingStatus(category, channel)}</span>
      </div>
      <div class="category-map-grid">
        <label>Category ID<input value="${html(mapping.categoryId || "")}" data-category-map="${category.id}" data-channel="${channel}" data-map-field="categoryId" /></label>
        <label>Category path<input value="${html(mapping.categoryPath || "")}" data-category-map="${category.id}" data-channel="${channel}" data-map-field="categoryPath" /></label>
        <label>Collection / handle<input value="${html(mapping.collectionHandle || "")}" data-category-map="${category.id}" data-channel="${channel}" data-map-field="collectionHandle" /></label>
        <label>Notes<input value="${html(mapping.notes || "")}" data-category-map="${category.id}" data-channel="${channel}" data-map-field="notes" /></label>
      </div>
    </section>
  `;
}

function renderCategoryCoverage() {
  const coverage = categoryState.coverage || {};
  const pct = (part, total) => total ? `${Math.round((Number(part || 0) / Number(total || 1)) * 100)}%` : "0%";
  const attention = coverage.attention || [];
  const actionCards = [
    ...attention.map((row) => ({ key: row.key, label: row.label, count: row.count })),
    { key: "vendor-category-mappings", label: "Learned vendor category mappings", count: coverage.vendorCategoryMappingCount || 0 }
  ];
  return `
    <section class="category-coverage">
      <div class="category-coverage-head">
        <div>
          <p class="eyebrow">Category coverage</p>
          <h3>Mapping health</h3>
        </div>
        <small>${Number(coverage.productCount || 0).toLocaleString()} products tracked</small>
      </div>
      <div class="category-coverage-grid">
        <span><small>Main categories</small><strong>${Number(coverage.mainCategoryCount || 0).toLocaleString()}</strong><em>${Number(coverage.verifiedProductCount || 0).toLocaleString()} verified products</em></span>
        <span class="${coverage.shopifyMissingCount ? "needs-work" : "ready"}"><small>Missing Shopify</small><strong>${Number(coverage.shopifyMissingCount || 0).toLocaleString()}</strong><em>${pct((coverage.mainCategoryCount || 0) - (coverage.shopifyMissingCount || 0), coverage.mainCategoryCount)} mapped</em></span>
        <span class="${coverage.shopifyPathMissingTaxonomyIdCount ? "needs-work" : "ready"}"><small>Paths missing ID</small><strong>${Number(coverage.shopifyPathMissingTaxonomyIdCount || 0).toLocaleString()}</strong><em>${Number(coverage.shopifyTaxonomyIdCount || 0).toLocaleString()} have taxonomy IDs</em></span>
        <span class="${coverage.activeUncategorizedProductCount ? "needs-work" : "ready"}"><small>Uncategorized active</small><strong>${Number(coverage.activeUncategorizedProductCount || 0).toLocaleString()}</strong><em>${Number(coverage.uncategorizedProductCount || 0).toLocaleString()} total missing</em></span>
        <span><small>Source categories</small><strong>${Number(coverage.sourceCategoryCount || 0).toLocaleString()}</strong><em>Vendor catalog categories</em></span>
        <span><small>Vendor learned maps</small><strong>${Number(coverage.vendorCategoryMappingCount || 0).toLocaleString()}</strong><em>${Number(coverage.sourceVendorCategoryMappedCount || 0).toLocaleString()} matched source paths</em></span>
      </div>
      <div class="category-coverage-attention">
        ${actionCards.map((row) => `
          <div>
            <strong>${html(row.label)}</strong>
            <small>${Number(row.count || 0).toLocaleString()} rows</small>
            <span class="coverage-actions">
              <a href="/api/categories/coverage/${encodeURIComponent(row.key)}">View</a>
              <a href="/api/categories/coverage/${encodeURIComponent(row.key)}.csv">Download CSV</a>
            </span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCategories() {
  const target = $("#category-list");
  if (!target) return;
  const categories = categoryState.categories || [];
  const scopeLabel = categoryScope === "main" ? "Main catalog" : "Source catalog";
  const selected = categories.find((category) => category.id === selectedCategoryId) || categories[0];
  if (selected) selectedCategoryId = selected.id;
  if (categoryState.loading && !categories.length) {
    target.innerHTML = `<div class="empty-state">Loading categories...</div>`;
    return;
  }
  if (categoryState.error) {
    target.innerHTML = `<div class="empty-state">${html(categoryState.error)}</div>`;
    return;
  }
  target.innerHTML = categories.length ? `
    ${renderCategoryCoverage()}
    <div class="category-workspace">
      <aside class="category-list-panel">
        <div class="category-list-head">
          <div>
            <strong>${Number(categoryState.total || categories.length).toLocaleString()} categories</strong>
            <small>${html(categoryScope === "source" && categoryState.indexGeneratedAt ? `Indexed ${simpleDate(categoryState.indexGeneratedAt)}` : scopeLabel)}</small>
          </div>
          <div class="category-scope-tabs" role="tablist" aria-label="Category catalog source">
            <button type="button" class="${categoryScope === "main" ? "active" : ""}" data-category-scope="main">Main</button>
            <button type="button" class="${categoryScope === "source" ? "active" : ""}" data-category-scope="source">Source</button>
          </div>
        </div>
        <div class="category-list-scroll">
          ${categories.slice(0, 500).map((category) => `
            <button class="category-row ${category.id === selectedCategoryId ? "active" : ""}" data-select-category="${category.id}">
              <span><strong>${html(category.name)}</strong><small>${Number(category.productCount || 0).toLocaleString()} products / ${category.mappingCount || 0} mapped</small></span>
              <em>${category.missingMappings?.length ? `${category.missingMappings.length} missing` : "ready"}</em>
            </button>
          `).join("")}
        </div>
      </aside>
      <section class="category-detail-panel">
        ${selected ? `
          <div class="category-detail-head">
            <div>
              <p class="eyebrow">Internal category</p>
              <h2>${html(selected.name)}</h2>
              <p class="muted">${categoryScope === "main" ? "Active product catalog category. Map this to Shopify and Google before listing." : "Full source catalog category. Use this to compare supplier coverage and future product mapping."}</p>
            </div>
            <span class="status ${selected.status === "mapped" ? "active" : "hold"}">${html(selected.status || "needs_review")}</span>
          </div>
          <div class="category-metrics">
            <span><small>Products</small><strong>${Number(selected.productCount || 0).toLocaleString()}</strong></span>
            <span><small>Active</small><strong>${Number(selected.activeProductCount || 0).toLocaleString()}</strong></span>
            <span><small>In stock</small><strong>${Number(selected.stockProductCount || 0).toLocaleString()}</strong></span>
            <span><small>Hazardous</small><strong>${Number(selected.hazardousProductCount || 0).toLocaleString()}</strong></span>
          </div>
          <div class="category-detail-grid">
            <section class="category-settings-card">
              <h3>Category Settings</h3>
              <div class="category-map-grid">
                <label>Status<select data-category-field="status" data-category-id="${selected.id}">${["needs_review", "mapped", "approved", "paused"].map((status) => `<option value="${status}" ${selected.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select></label>
                <label>Owner<input value="${html(selected.owner || "")}" data-category-field="owner" data-category-id="${selected.id}" /></label>
                <label>Default condition<input value="${html(selected.defaults?.condition || "New")}" data-category-default="condition" data-category-id="${selected.id}" /></label>
                <label>Shipping profile<input value="${html(selected.defaults?.shippingProfile || "")}" data-category-default="shippingProfile" data-category-id="${selected.id}" /></label>
                <label>Country of origin<input value="${html(selected.defaults?.countryOfOrigin || "")}" data-category-default="countryOfOrigin" data-category-id="${selected.id}" /></label>
                <label>Required attributes<textarea rows="3" data-category-field="requiredAttributes" data-category-id="${selected.id}">${html((selected.requiredAttributes || []).join("\n"))}</textarea></label>
                <label class="span-2">Notes<textarea rows="3" data-category-field="notes" data-category-id="${selected.id}">${html(selected.notes || "")}</textarea></label>
              </div>
            </section>
            <section class="category-settings-card">
              <h3>Top Vendors</h3>
              <div class="category-mini-list">${(selected.topVendors || []).slice(0, 8).map((vendor) => `<span><strong>${html(vendor.name)}</strong><small>${Number(vendor.count || 0).toLocaleString()}</small></span>`).join("") || `<p class="muted">No vendor data.</p>`}</div>
            </section>
            <section class="category-settings-card">
              <h3>Top Brands</h3>
              <div class="category-mini-list">${(selected.topBrands || []).slice(0, 8).map((brand) => `<span><strong>${html(brand.name)}</strong><small>${Number(brand.count || 0).toLocaleString()}</small></span>`).join("") || `<p class="muted">No brand data.</p>`}</div>
            </section>
          </div>
          <div class="category-mapping-grid">
            ${renderCategoryMappingFields(selected, "shopify", "Shopify")}
            ${renderCategoryMappingFields(selected, "temu", "Temu")}
            ${renderCategoryMappingFields(selected, "tiktok", "TikTok Shop")}
            ${renderCategoryMappingFields(selected, "ebay", "eBay")}
            ${renderCategoryMappingFields(selected, "whatnot", "Whatnot")}
          </div>
        ` : `<div class="empty-state">Select a category.</div>`}
      </section>
    </div>
  ` : `<div class="empty-state">No categories match this search.</div>`;
}

async function updateCategoryField(input) {
  const categoryId = input.dataset.categoryId || input.dataset.categoryMap;
  if (!categoryId) return;
  const body = {};
  body.scope = categoryScope;
  if (input.dataset.categoryField) {
    body[input.dataset.categoryField] = input.dataset.categoryField === "requiredAttributes" ? input.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) : input.value;
  }
  if (input.dataset.categoryDefault) {
    body.defaults = { [input.dataset.categoryDefault]: input.type === "checkbox" ? input.checked : input.value };
  }
  if (input.dataset.channel && input.dataset.mapField) {
    body.channel = input.dataset.channel;
    body.mapping = { [input.dataset.mapField]: input.value };
  }
  const result = await api(`/api/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) });
  categoryState = { ...result, query: categoryState.query, scope: categoryScope, loading: false };
  selectedCategoryId = categoryId;
  renderCategories();
  toast("Category updated.");
}

function renderCatalog() {
  if (!state) return;
  document.querySelectorAll("[data-catalog-tab]").forEach((button) => button.classList.toggle("active", button.dataset.catalogTab === catalogTab));
  updateCatalogFilterOptions();
  if (selectedProductIds.size) {
    const inventoryIds = new Set((state.inventory || []).map((item) => item.id));
    selectedProductIds = new Set([...selectedProductIds].filter((id) => inventoryIds.has(id)));
  }
  updateCatalogBulkBar();
  const catalogToolbar = $("#catalog-search")?.closest(".toolbar");
  const catalogFilters = document.querySelector(".catalog-filters");
  const catalogBulkBar = document.querySelector(".catalog-bulk-bar");
  const showCatalogToolbar = ["products", "source", "categories", "reviews", "inventory"].includes(catalogTab);
  const showCatalogFilters = ["products", "source", "inventory"].includes(catalogTab);
  if (catalogToolbar) catalogToolbar.style.display = showCatalogToolbar ? "" : "none";
  if (catalogFilters) catalogFilters.style.display = showCatalogFilters ? "" : "none";
  if (catalogBulkBar) catalogBulkBar.style.display = ["products", "source"].includes(catalogTab) ? "" : "none";
  const inventoryImportButton = $("#inventory-import")?.closest(".file-button");
  if (inventoryImportButton) inventoryImportButton.style.display = ["products", "inventory"].includes(catalogTab) ? "" : "none";
  document.querySelectorAll(".category-only-control").forEach((element) => {
    element.style.display = catalogTab === "categories" ? "" : "none";
  });
  $("#products-list").style.display = catalogTab === "products" ? "block" : "none";
  $("#source-catalog-list").style.display = catalogTab === "source" ? "block" : "none";
  $("#import-review-list").style.display = catalogTab === "reviews" ? "block" : "none";
  $("#category-list").style.display = catalogTab === "categories" ? "block" : "none";
  const catalogImportExportList = $("#import-export-list");
  if (catalogImportExportList) catalogImportExportList.style.display = catalogTab === "import-export" ? "block" : "none";
  $("#inventory-list").style.display = catalogTab === "inventory" ? "block" : "none";
  $("#template-list").style.display = catalogTab === "templates" ? "block" : "none";
  $("#readiness-list").style.display = catalogTab === "readiness" ? "block" : "none";
  document.querySelectorAll(".source-only-control").forEach((element) => {
    element.style.display = catalogTab === "source" ? "" : "none";
  });
  document.querySelectorAll(".product-only-control").forEach((element) => {
    element.style.display = catalogTab === "products" ? "" : "none";
  });

  if (catalogTab === "source") {
    renderSourceCatalogTable();
    loadSourceCatalog(sourceCatalogPage);
    return;
  }
  if (catalogTab === "categories") {
    renderCategories();
    if (!categoryState.categories.length || categoryState.query !== ($("#catalog-search")?.value.trim() || "") || categoryState.scope !== categoryScope) loadCategories();
    return;
  }
  if (catalogTab === "reviews") {
    renderCatalogImportReviews();
    return;
  }
  if (catalogTab === "inventory") {
    const items = filteredCatalogItems();
    renderInventoryTable(items);
    return;
  }
  if (catalogTab === "import-export") {
    showView("import-export");
    return;
  }
  if (catalogTab === "templates") {
    renderMarketplaceTemplates();
    return;
  }
  if (catalogTab === "readiness") {
    renderReadinessQueue();
    return;
  }
  const items = filteredCatalogItems();
  if (!items.some((item) => item.id === selectedProductId)) {
    selectedProductId = items[0]?.id || state.inventory[0]?.id || null;
  }
  renderProductsTable(items);
}

function renderSourceCatalogTable() {
  const target = $("#source-catalog-list");
  if (!target) return;
  const { items = [], manifest, loading, error, totalMatches = 0, hasMore = false, partial = false, scanned = 0 } = sourceCatalogState || {};
  const importedLabel = manifest?.importedAt ? simpleDate(manifest.importedAt) : "";
  const countLabel = manifest?.productCount ? `${Number(manifest.productCount).toLocaleString()} imported` : "Catalog file pending";
  const exportMappings = state.exportMappings || [];
  const selectedCount = selectedSourceAllFiltered ? totalMatches : selectedSourceSkus.size;
  const sourceSelectionLabel = selectedSourceAllFiltered
    ? `${Number(totalMatches || 0).toLocaleString()} filtered selected`
    : selectedSourceSkus.size
      ? `${Number(selectedSourceSkus.size).toLocaleString()} selected`
      : `${Number(totalMatches || 0).toLocaleString()} filtered products`;

  if (loading && !items.length) {
    target.innerHTML = `<div class="empty-state">Searching source catalog...</div>`;
    return;
  }
  if (error) {
    target.innerHTML = `<div class="empty-state">Unable to search source catalog: ${html(error)}</div>`;
    return;
  }
  target.innerHTML = `
    <div class="catalog-source-summary">
      <span><strong>${html(countLabel)}</strong>${importedLabel ? `<small>Last import ${html(importedLabel)}</small>` : ""}</span>
      <span><strong>${Number(totalMatches || 0).toLocaleString()}</strong><small>${partial ? `matches in ${Number(scanned || 0).toLocaleString()} scanned` : "matches"}</small></span>
      <span><strong>Page ${sourceCatalogPage}</strong><small>${loading ? "Refreshing" : hasMore ? "More available" : "End of results"}</small></span>
    </div>
    ${items.length ? `
      <div class="catalog-selection-toolbar">
        <div class="selection-summary">
          <strong>Source catalog selection</strong>
          <small>${html(sourceSelectionLabel)}${selectedSourceAllFiltered ? " for export" : ""}</small>
        </div>
        <div class="selection-actions">
          <button class="button secondary" type="button" data-select-source-page>Select current page</button>
          <button class="button secondary" type="button" data-select-source-filtered ${totalMatches ? "" : "disabled"}>Select all filtered</button>
          <button class="button secondary" type="button" data-clear-source-selection ${selectedCount ? "" : "disabled"}>Clear</button>
        </div>
        <select id="source-export-template" aria-label="Source export template">
          ${exportMappings.map((template) => `<option value="${template.id}" ${template.id === selectedExportMappingId ? "selected" : ""}>${html(template.name)}</option>`).join("")}
        </select>
        <button class="button secondary" type="button" data-export-source-products ${exportMappings.length ? "" : "disabled"}>Export CSV</button>
      </div>
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr><th><input type="checkbox" data-source-check-all ${items.every((item) => selectedSourceAllFiltered || selectedSourceSkus.has(item.sku)) ? "checked" : ""} /></th><th>Source Product</th><th>Supplier</th><th>Manufacturer</th><th>Brand</th><th>Price</th><th>Stock</th><th>Channels</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${items.map((item) => {
              const sourceMenuId = `source-${domToken(item.sku)}`;
              return `
              <tr class="${item.inProducts && item.productCatalogDiffs?.length ? "source-changed-row" : ""}">
                <td><input type="checkbox" data-source-check="${html(item.sku)}" ${selectedSourceAllFiltered || selectedSourceSkus.has(item.sku) ? "checked" : ""} /></td>
                <td>
                  <strong>${html(item.sku)}</strong>
                  <small>${html(item.title || item.marketplaceTitle || "Untitled product")}</small>
                  ${item.inProducts ? `<span class="status active">In Products</span>` : `<span class="status draft">Source only</span>`}
                  ${item.productCatalogDiffs?.length ? `<small class="source-diff-note">Changed: ${html(item.productCatalogDiffs.slice(0, 4).join(", "))}</small>` : ""}
                  ${item.alternateVendorCount ? `<small>${Number(item.alternateVendorCount)} other vendor${item.alternateVendorCount === 1 ? "" : "s"} available</small>` : ""}
                </td>
                <td>${html([item.supplier, item.supplierCode].filter(Boolean).join(" / ") || "No supplier")}</td>
                <td>${html(item.manufacturer || item.mfrPartNumber || "No manufacturer")}</td>
                <td>${html(item.brand || "No brand")}</td>
                <td><strong>${money(item.price || 0)}</strong><small>Cost ${money(item.cost || 0)}</small></td>
                <td>${Number(item.stockQty || 0)}<small>${html(item.status || (item.active === false ? "Inactive" : "Active"))}</small></td>
                <td>
                  ${item.zoroSku ? `<small>Zoro ${html(item.zoroSku)}</small>` : ""}
                  ${item.varisContractPrice ? `<small>Varis ${money(item.varisContractPrice)}</small>` : ""}
                </td>
                <td>
                  <div class="action-menu">
                    <button class="icon-button" data-action-menu="${html(sourceMenuId)}" aria-label="Open source catalog actions">...</button>
                    <div class="action-popover" data-menu-for="${html(sourceMenuId)}">
                      <button data-promote-catalog-sku="${html(item.sku)}">Add to Active Catalog</button>
                      <button data-source-row-action="set-active" data-source-sku="${html(item.sku)}">Set active</button>
                      <button data-source-row-action="set-inactive" data-source-sku="${html(item.sku)}">Set inactive</button>
                      <button data-source-row-action="set-discontinued" data-source-sku="${html(item.sku)}">Set discontinued</button>
                      <button data-source-row-action="delete" data-source-sku="${html(item.sku)}">Hide from Source Catalog</button>
                    </div>
                  </div>
                </td>
              </tr>
            `; }).join("")}
          </tbody>
        </table>
      </div>
      <div class="catalog-pager">
        <button class="button secondary" data-source-page="${sourceCatalogPage - 1}" ${sourceCatalogPage <= 1 ? "disabled" : ""}>Previous</button>
        <button class="button secondary" data-source-page="${sourceCatalogPage + 1}" ${hasMore ? "" : "disabled"}>Next</button>
      </div>
    ` : `<div class="empty-state">No source catalog products match this search.</div>`}
  `;
  updateCatalogBulkBar();
}

function updateCatalogBulkBar() {
  const count = catalogTab === "source"
    ? (selectedSourceAllFiltered ? Number(sourceCatalogState?.totalMatches || 0) : selectedSourceSkus.size)
    : selectedProductAllFiltered ? filteredCatalogItems().length : selectedProductIds.size;
  const countEl = $("#catalog-selected-count");
  if (countEl) countEl.textContent = count;
  const action = $("#catalog-bulk-action");
  if (!action) return;
  [...action.options].forEach((option) => {
    if (!option.value) return;
    option.disabled = catalogTab !== "source" && option.value === "add-active";
  });
  if (catalogTab !== "source" && action.value === "add-active") action.value = "";
}

function clearCatalogSelection() {
  selectedSourceSkus.clear();
  selectedSourceAllFiltered = false;
  selectedProductIds.clear();
  selectedProductAllFiltered = false;
  renderCatalog();
}

async function loadProductFieldOptions() {
  if (productFieldOptions) return productFieldOptions;
  try {
    const result = await api("/api/product-fields");
    productFieldOptions = result.fields || [];
  } catch {
    productFieldOptions = [
      { key: "sku", label: "SKU" },
      { key: "title", label: "Title" },
      { key: "marketplaceTitle", label: "Marketplace title" },
      { key: "price", label: "Price" },
      { key: "qty", label: "Quantity" },
      { key: "available", label: "Available" }
    ];
  }
  if (currentViewId === "import-export" || catalogTab === "import-export") renderImportExportMappings();
  return productFieldOptions;
}

function mappingRowsText(template) {
  return (template.mappings || []).map((row) => `${row.externalColumn}|${row.productField}|${row.defaultValue || ""}`).join("\n");
}

function parseCsvHeaderLine(text) {
  const line = String(text || "").split(/\r?\n/)[0] || "";
  const headers = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      headers.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  headers.push(field.trim());
  return headers.filter(Boolean);
}

function guessProductField(header) {
  const key = String(header || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const guesses = {
    sku: "sku",
    itemsku: "sku",
    variantsku: "sku",
    handle: "sku",
    title: "marketplaceTitle",
    itemname: "marketplaceTitle",
    name: "marketplaceTitle",
    description: "longDescription",
    bodyhtml: "longDescription",
    brand: "brand",
    brandname: "brand",
    vendor: "vendor",
    price: "price",
    standardprice: "price",
    variantprice: "price",
    quantity: "qty",
    qty: "qty",
    inventoryqty: "qty",
    variantinventoryqty: "qty",
    category: "category",
    productcategory: "shopifyCategoryPath",
    googleproductcategory: "googleCategoryId",
    image: "defaultImage",
    imagesrc: "defaultImage",
    tags: "tags",
    barcode: "barcode",
    condition: "condition"
  };
  return guesses[key] || "";
}

function renderFieldOptionBadges() {
  const fields = productFieldOptions || [];
  return fields.slice(0, 80).map((field) => `<button type="button" class="field-chip" data-copy-field="${html(field.key)}">${html(field.label || field.key)}<small>${html(field.key)}</small></button>`).join("");
}

function renderProductFieldSelect(value = "", templateId = "", rowIndex = 0) {
  const fields = productFieldOptions || [];
  return `
    <select data-export-mapping-draft-row-field="productField" data-export-mapping-id="${templateId}" data-mapping-row-index="${rowIndex}">
      <option value="">Unmapped</option>
      ${fields.map((field) => `<option value="${html(field.key)}" ${field.key === value ? "selected" : ""}>${html(field.label || field.key)} (${html(field.key)})</option>`).join("")}
    </select>
  `;
}

function renderMappingDraftRow(row = {}, templateId = "", index = 0) {
  return `
    <article class="mapping-row-edit">
      <input value="${html(row.externalColumn || "")}" data-export-mapping-draft-row-field="externalColumn" data-export-mapping-id="${templateId}" data-mapping-row-index="${index}" />
      ${renderProductFieldSelect(row.productField, templateId, index)}
      <input value="${html(row.defaultValue || "")}" data-export-mapping-draft-row-field="defaultValue" data-export-mapping-id="${templateId}" data-mapping-row-index="${index}" />
      <label class="checkbox-row"><input type="checkbox" ${row.required ? "checked" : ""} data-export-mapping-draft-row-field="required" data-export-mapping-id="${templateId}" data-mapping-row-index="${index}" /> Required</label>
      <button class="button secondary" type="button" data-remove-export-mapping-row="${templateId}" data-mapping-row-index="${index}">Delete</button>
    </article>
  `;
}

function isBuiltInExportMapping(template = {}) {
  return ["export-shopify-basic", "export-ebay-basic", "export-amazon-basic"].includes(template.id);
}

function importJobRows() {
  const rows = Array.isArray(state?.importJobs) && state.importJobs.length
    ? state.importJobs
    : (state?.syncRuns || []).map((run) => ({
      id: run.id,
      section: run.source || 'System',
      operation: run.type || 'Sync',
      direction: /export/i.test(run.type || '') ? 'export' : 'import',
      status: run.status || 'success',
      fileName: run.fileName || '',
      message: run.message || '',
      totalRows: 0,
      changed: 0,
      created: 0,
      missingCount: 0,
      errors: run.errors || [],
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      finishedAt: run.createdAt
    }));
  return rows.slice().sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function importJobStatusClass(status = '') {
  const value = String(status || '').toLowerCase();
  if (value === 'running' || value === 'queued') return 'hold';
  if (value === 'failed') return 'canceled';
  if (value === 'stopped') return 'inactive';
  if (value === 'warning') return 'draft';
  return 'active';
}

function importJobStatusLabel(status = '') {
  const value = String(status || 'success').toLowerCase();
  if (value === 'running') return 'Running';
  if (value === 'queued') return 'Queued';
  if (value === 'failed') return 'Failed';
  if (value === 'warning') return 'Needs review';
  if (value === 'stopped') return 'Stopped';
  return 'Done';
}

function renderImportJobMetrics(job = {}) {
  const metrics = [];
  if (Number(job.totalRows || 0)) metrics.push(`${Number(job.totalRows || 0).toLocaleString()} rows`);
  if (Number(job.changed || 0)) metrics.push(`${Number(job.changed || 0).toLocaleString()} changed`);
  if (Number(job.created || 0)) metrics.push(`${Number(job.created || 0).toLocaleString()} created`);
  if (Number(job.missingCount || 0)) metrics.push(`${Number(job.missingCount || 0).toLocaleString()} missing`);
  return metrics.join(' / ') || html(job.direction || 'import');
}

function filteredImportJobs({ useJobsFilters = false } = {}) {
  let jobs = importJobRows();
  if (!useJobsFilters) return jobs;
  const query = String(jobsFilter.query || "").trim().toLowerCase();
  if (jobsFilter.section) jobs = jobs.filter((job) => String(job.section || "").toLowerCase() === jobsFilter.section);
  if (jobsFilter.status) jobs = jobs.filter((job) => String(job.status || "").toLowerCase() === jobsFilter.status);
  if (jobsFilter.direction) jobs = jobs.filter((job) => String(job.direction || "").toLowerCase() === jobsFilter.direction);
  if (query) jobs = jobs.filter((job) => `${job.operation} ${job.section} ${job.fileName} ${job.status} ${job.message}`.toLowerCase().includes(query));
  return jobs;
}

function importJobFilterOptions(field) {
  return [...new Set(importJobRows().map((job) => String(job[field] || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function selectedImportJob(filteredJobs = null) {
  const allJobs = importJobRows();
  const visibleJobs = filteredJobs || allJobs;
  let job = allJobs.find((row) => row.id === selectedImportJobId);
  if (!job || (filteredJobs && !visibleJobs.some((row) => row.id === job.id))) {
    job = visibleJobs[0] || allJobs[0] || null;
    selectedImportJobId = job?.id || null;
  }
  return job;
}

function jobImportSection(job = {}) {
  const text = `${job.section || ""} ${job.operation || ""}`.toLowerCase();
  if (/categor/.test(text)) return "categories";
  if (/source/.test(text)) return "source";
  if (/inventory/.test(text)) return "inventory";
  if (/order/.test(text)) return "orders";
  if (/customer/.test(text)) return "customers";
  return "products";
}

function renderJobProfile(job = null) {
  if (!job) {
    return `
      <aside class="job-profile-panel">
        <div class="empty-state compact">Select a job to see its profile.</div>
      </aside>
    `;
  }
  const status = String(job.status || "success").toLowerCase();
  const canStop = ["queued", "running"].includes(status);
  const hasOriginal = Boolean(job.originalFilePath);
  const hasErrors = Boolean((job.errors || []).length || job.errorFilePath || job.errorFileName);
  const statRows = [
    ["Type", job.direction || "import"],
    ["Category", job.section || "System"],
    ["Started", dateLabel(job.startedAt || job.createdAt)],
    ["Ended", job.finishedAt ? dateLabel(job.finishedAt) : "Running"],
    ["Original", job.originalFileName || job.fileName || "None"],
    ["Rows", Number(job.totalRows || 0).toLocaleString()],
    ["Changed", Number(job.changed || 0).toLocaleString()],
    ["Missing", Number(job.missingCount || 0).toLocaleString()]
  ];
  return `
    <aside class="job-profile-panel">
      <div class="job-profile-head">
        <div>
          <p class="eyebrow">Job Profile</p>
          <h3>${html(job.operation || "Import job")}</h3>
          <p class="muted">${html([job.section, job.fileName].filter(Boolean).join(" / ") || "System job")}</p>
        </div>
        <span class="status ${importJobStatusClass(job.status)}">${html(importJobStatusLabel(job.status))}</span>
      </div>
      <div class="job-profile-actions">
        <button class="button" type="button" data-job-run="${html(job.id)}">${withIcon("upload", "Run")}</button>
        <button class="button secondary" type="button" data-refresh-import-jobs>${withIcon("refresh-cw", "Refresh")}</button>
        <button class="button danger" type="button" data-job-stop="${html(job.id)}" ${canStop ? "" : "disabled"}>Stop</button>
      </div>
      <div class="job-profile-note">
        ${canStop ? "This job is currently active and can be stopped." : "Run opens the matching import area. Background reruns will be connected when the runner is added."}
      </div>
      <div class="job-profile-stats">
        ${statRows.map(([label, value]) => `<span><small>${html(label)}</small><strong>${html(value)}</strong></span>`).join("")}
      </div>
      <div class="job-profile-files">
        ${hasOriginal ? `<a class="button secondary" href="/api/import-jobs/${encodeURIComponent(job.id)}/original">${withIcon("download", "Original file")}</a>` : `<button class="button secondary" type="button" disabled>Original file</button>`}
        ${hasErrors ? `<a class="button secondary" href="/api/import-jobs/${encodeURIComponent(job.id)}/errors.csv">${withIcon("download", "Errors CSV")}</a>` : `<button class="button secondary" type="button" disabled>Errors CSV</button>`}
      </div>
      ${job.message ? `<div class="job-profile-message"><strong>Status message</strong><p>${html(job.message)}</p></div>` : ""}
      ${(job.errors || []).length ? `
        <div class="job-profile-errors">
          <strong>Error preview</strong>
          ${(job.errors || []).slice(0, 8).map((error) => `<span>${html(error)}</span>`).join("")}
        </div>
      ` : ""}
    </aside>
  `;
}

function renderImportJobActions(job = {}) {
  const actions = [];
  if (job.originalFilePath) actions.push(`<a href="/api/import-jobs/${encodeURIComponent(job.id)}/original">Original file</a>`);
  if ((job.errors || []).length || job.errorFilePath || job.errorFileName) actions.push(`<a href="/api/import-jobs/${encodeURIComponent(job.id)}/errors.csv">Errors CSV</a>`);
  return actions.length ? `<div class="import-job-actions">${actions.join('')}</div>` : '';
}

function renderImportQueuePanel({ full = false } = {}) {
  const jobs = importJobRows();
  const filteredJobs = filteredImportJobs({ useJobsFilters: full && currentViewId === "jobs" });
  const visibleJobs = full ? filteredJobs : filteredJobs.slice(0, 8);
  const runningCount = jobs.filter((job) => ['queued', 'running'].includes(String(job.status || '').toLowerCase())).length;
  const failedCount = jobs.filter((job) => String(job.status || '').toLowerCase() === 'failed').length;
  return `
    <section class="import-queue-panel ${full ? 'full' : ''}">
      <div class="section-head import-queue-head">
        <div>
          <p class="eyebrow">Queue</p>
          <h3>${full ? 'Import Queue & History' : 'Queue & History'}</h3>
          <p class="muted">${runningCount ? `${runningCount} running / ` : ''}${failedCount ? `${failedCount} failed / ` : ''}${jobs.length} total jobs</p>
        </div>
        <button class="button secondary" type="button" data-refresh-import-jobs>${withIcon('refresh-cw', 'Refresh')}</button>
      </div>
      <div class="import-job-list">
        ${visibleJobs.map((job) => `
          <article class="import-job-row ${selectedImportJobId === job.id ? 'selected' : ''}" data-select-import-job="${html(job.id)}">
            <div class="import-job-main">
              <span class="status ${importJobStatusClass(job.status)}">${html(importJobStatusLabel(job.status))}</span>
              <div class="import-job-title">
                <strong>${html(job.operation || 'Import')}</strong>
                <small>${html([job.section, job.fileName].filter(Boolean).join(' / ') || 'System job')}</small>
              </div>
            </div>
            <div class="import-job-meta">
              <span>${html(renderImportJobMetrics(job))}</span>
              <span>${html(dateLabel(job.startedAt || job.createdAt))}</span>
              <span>${job.finishedAt ? html(dateLabel(job.finishedAt)) : 'Running'}</span>
            </div>
            ${renderImportJobActions(job)}
            ${job.message ? `<p class="import-job-message">${html(job.message)}</p>` : ''}
            ${(job.errors || []).length ? `<details class="import-job-errors"><summary>View details</summary><div>${(job.errors || []).slice(0, 30).map((error) => `<span>${html(error)}</span>`).join('')}</div></details>` : ''}
          </article>
        `).join('') || `<div class="empty-state compact">No imports have been recorded yet.</div>`}
      </div>
    </section>
  `;
}

function importExportSections(templates = []) {
  const jobs = importJobRows();
  return [
    { id: 'products', icon: 'package', label: 'Products', meta: `${templates.length} templates`, description: 'Mapped product imports and marketplace exports.' },
    { id: 'inventory', icon: 'warehouse', label: 'Inventory', meta: 'Stock CSV', description: 'Quantities, costs, and stock updates.' },
    { id: 'source', icon: 'database', label: 'Source Catalog', meta: 'Supplier SKUs', description: 'Move source SKUs into Products.' },
    { id: 'categories', icon: 'tags', label: 'Categories', meta: 'Coming soon', description: 'Category mappings and taxonomy updates.' },
    { id: 'orders', icon: 'shopping-cart', label: 'Orders', meta: 'Coming soon', description: 'Order imports and marketplace order templates.' },
    { id: 'customers', icon: 'users', label: 'Customers', meta: 'Coming soon', description: 'Customer imports and contact updates.' },
    { id: 'queue', icon: 'list-check', label: 'Queue', meta: `${jobs.length} jobs`, description: 'Import history, warnings, and failures.' }
  ];
}

function renderImportSectionMenu(sections = []) {
  return `
    <aside class="import-section-menu">
      <div class="import-menu-title">
        <p class="eyebrow">Sections</p>
        <strong>Import / Export</strong>
      </div>
      ${sections.map((section) => `
        <button class="import-section-button ${activeImportSection === section.id ? 'active' : ''}" type="button" data-import-section="${section.id}">
          ${iconMarkup(section.icon)}
          <span><strong>${html(section.label)}</strong><small>${html(section.description)}</small></span>
          <em>${html(section.meta)}</em>
        </button>
      `).join('')}
    </aside>
  `;
}

function renderTemplateActionRows(templates = []) {
  return `
    <div class="import-template-list">
      ${templates.map((template) => {
        const hasSku = (template.mappings || []).some((row) => row.productField === 'sku');
        return `
          <article class="import-template-row">
            <div>
              <strong>${html(template.name)}</strong>
              <small>${html(template.source)} / ${(template.mappings || []).length} columns / ${hasSku ? 'SKU mapped' : 'Needs SKU'}</small>
            </div>
            <div class="import-template-actions">
              <button class="button secondary" type="button" data-open-export-mapping="${template.id}">${withIcon('file-pen-line', 'Manage')}</button>
              <button class="button secondary" type="button" data-open-product-import="${template.id}">${withIcon('upload', 'Import')}</button>
              <a class="button secondary" href="/api/export-mappings/${template.id}/export">${withIcon('clipboard-list', 'Export')}</a>
              ${isBuiltInExportMapping(template)
                ? `<button class="button secondary" type="button" data-duplicate-export-mapping="${template.id}">${withIcon('copy', 'Duplicate')}</button>`
                : `<button class="button danger" type="button" data-delete-export-mapping="${template.id}">${withIcon('trash-2', 'Delete')}</button>`}
            </div>
          </article>
        `;
      }).join('') || `<div class="empty-state compact">Create a template to start importing or exporting product files.</div>`}
    </div>
  `;
}

function renderImportSectionBody(sectionId, templates = []) {
  const shopifyTemplate = templates.find((template) => /shopify/i.test(`${template.name} ${template.source}`));
  if (sectionId === 'inventory') {
    return `
      <section class="import-section-panel">
        <div class="import-panel-title">
          ${sectionIconTitle('warehouse', 'Inventory Imports')}
          <p class="muted">Update active product quantities, stock fields, and inventory attributes from CSV.</p>
        </div>
        <div class="import-action-list">
          <article class="import-action-row">
            <div><strong>Inventory CSV</strong><small>Imports SKU, quantity, title, brand, costs, prices, and mapped inventory fields.</small></div>
            <label class="file-button">${withIcon('upload', 'Import inventory CSV')}<input type="file" accept=".csv,text/csv" data-central-inventory-import /></label>
          </article>
          <article class="import-action-row muted-row">
            <div><strong>Warehouse stock import</strong><small>Reserved for bin/location stock templates.</small></div>
            <button class="button secondary" type="button" disabled>Coming soon</button>
          </article>
        </div>
      </section>
    `;
  }
  if (sectionId === 'source') {
    return `
      <section class="import-section-panel">
        <div class="import-panel-title">
          ${sectionIconTitle('database', 'Source Catalog')}
          <p class="muted">Promote supplier catalog SKUs into Products from a CSV list.</p>
        </div>
        <div class="import-action-list">
          <article class="import-action-row">
            <div><strong>Add source SKUs to Products</strong><small>Upload a sku list, preview counts, then move matching source rows into the main catalog.</small></div>
            <label class="file-button">${withIcon('upload', 'Add SKUs CSV')}<input type="file" accept=".csv,text/csv" data-central-source-sku-import /></label>
          </article>
          <article class="import-action-row">
            <div><strong>Open Source Catalog</strong><small>Filter suppliers, select rows, export, or run source catalog actions.</small></div>
            <button class="button secondary" type="button" data-view="catalog" data-catalog-tab-link="source">${withIcon('search', 'Open source catalog')}</button>
          </article>
        </div>
      </section>
    `;
  }
  if (sectionId === 'queue') return renderImportQueuePanel({ full: true });
  if (sectionId === 'categories' || sectionId === 'orders' || sectionId === 'customers') {
    const labels = { categories: 'Category Imports', orders: 'Order Imports', customers: 'Customer Imports' };
    const icons = { categories: 'tags', orders: 'shopping-cart', customers: 'users' };
    return `
      <section class="import-section-panel">
        <div class="import-panel-title">
          ${sectionIconTitle(icons[sectionId], labels[sectionId])}
          <p class="muted">This section is reserved so future imports have a clean home instead of being added randomly across pages.</p>
        </div>
        <div class="import-action-list">
          <article class="import-action-row muted-row">
            <div><strong>${html(labels[sectionId])}</strong><small>Template mapping, validation preview, and queue tracking will use this same flow.</small></div>
            <button class="button secondary" type="button" disabled>Coming soon</button>
          </article>
        </div>
      </section>
    `;
  }
  return `
    <section class="import-section-panel">
      <div class="import-panel-title">
        ${sectionIconTitle('package', 'Product Import / Export')}
        <p class="muted">Use mapped templates for Shopify, eBay, Amazon, and custom product files.</p>
      </div>
      <div class="import-action-list">
        <article class="import-action-row">
          <div><strong>Shopify / Matrixify status</strong><small>Updates Shopify ID, Variant ID, handle, published state, and live status after Shopify export.</small></div>
          <label class="file-button">${withIcon('upload', 'Import Shopify status')}<input type="file" accept=".csv,text/csv" data-central-shopify-status-import /></label>
        </article>
        ${shopifyTemplate ? `
          <article class="import-action-row">
            <div><strong>Shopify product CSV</strong><small>Import or export with the Shopify product template already mapped in DataPlus.</small></div>
            <div class="import-template-actions">
              <button class="button secondary" type="button" data-open-product-import="${shopifyTemplate.id}">${withIcon('upload', 'Import CSV')}</button>
              <a class="button secondary" href="/api/export-mappings/${shopifyTemplate.id}/export">${withIcon('clipboard-list', 'Export CSV')}</a>
              <button class="button secondary" type="button" data-open-export-mapping="${shopifyTemplate.id}">${withIcon('file-pen-line', 'Manage')}</button>
            </div>
          </article>
        ` : ''}
        <article class="import-action-row">
          <div><strong>Template library</strong><small>Open each template page to add columns, delete fields, save changes, import, export, or duplicate.</small></div>
          <button class="button" type="button" data-create-export-mapping>${withIcon('plus', 'New template')}</button>
        </article>
      </div>
    </section>
    <section class="import-section-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Templates</p>
          <h3>Product Templates</h3>
        </div>
      </div>
      ${renderTemplateActionRows(templates)}
    </section>
  `;
}

function renderImportExportCenter(templates = []) {
  const sections = importExportSections(templates);
  if (!sections.some((section) => section.id === activeImportSection)) activeImportSection = 'products';
  return `
    <div class="import-center">
      <div class="mapping-directory-head import-center-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h2>Import / Export Center</h2>
          <p class="muted">Central home for product files today, with room for orders, customers, categories, and inventory workflows.</p>
        </div>
        <div class="mapping-actions">
          <button class="button secondary" type="button" data-refresh-import-jobs>${withIcon('refresh-cw', 'Refresh queue')}</button>
          <button class="button" type="button" data-create-export-mapping>${withIcon('plus', 'New template')}</button>
        </div>
      </div>
      <div class="import-center-layout">
        ${renderImportSectionMenu(sections)}
        <main class="import-section-workspace">${renderImportSectionBody(activeImportSection, templates)}</main>
        ${renderImportQueuePanel()}
      </div>
    </div>
  `;
}

function renderMappingDirectory(templates = []) {
  const activeCount = templates.filter((template) => template.status !== "inactive").length;
  const shopifyCount = templates.filter((template) => /shopify/i.test(`${template.name} ${template.source}`)).length;
  return `
    <div class="mapping-directory">
      <div class="mapping-directory-head">
        <div>
          <p class="eyebrow">Import / Export Mapping</p>
          <h2>Template Library</h2>
          <p class="muted">Open a template to manage its settings, mapped columns, imports, and exports.</p>
        </div>
        <button class="button" type="button" data-create-export-mapping>New template</button>
      </div>
      <div class="mapping-summary-grid">
        <span><small>Total templates</small><strong>${templates.length}</strong></span>
        <span><small>Active</small><strong>${activeCount}</strong></span>
        <span><small>Shopify</small><strong>${shopifyCount}</strong></span>
        <span><small>Mapped columns</small><strong>${templates.reduce((sum, template) => sum + (template.mappings || []).length, 0)}</strong></span>
      </div>
      <div class="mapping-template-grid">
        ${templates.map((template) => {
          const hasSku = (template.mappings || []).some((row) => row.productField === "sku");
          return `
            <article class="mapping-template-card">
              <div class="mapping-template-card-head">
                <span class="status ${template.status === "inactive" ? "draft" : "active"}">${html(template.status || "active")}</span>
                <small>${html(template.mode || "both")}</small>
              </div>
              <h3>${html(template.name)}</h3>
              <p>${html(template.source)} / ${(template.mappings || []).length} columns</p>
              <div class="mapping-card-flags">
                <span>${hasSku ? "SKU mapped" : "Needs SKU"}</span>
                <span>${/shopify/i.test(`${template.name} ${template.source}`) ? "Shopify" : "Custom"}</span>
              </div>
              <div class="mapping-template-actions">
                <button class="button secondary" type="button" data-open-export-mapping="${template.id}">Open</button>
                <button class="button secondary" type="button" data-duplicate-export-mapping="${template.id}">Duplicate</button>
                ${isBuiltInExportMapping(template)
                  ? `<button class="button secondary" type="button" disabled title="Built-in templates cannot be deleted">Built-in</button>`
                  : `<button class="button danger" type="button" data-delete-export-mapping="${template.id}">Delete</button>`}
              </div>
            </article>
          `;
        }).join("") || `<div class="empty-state">Create your first import/export template.</div>`}
      </div>
    </div>
  `;
}

function renderJobsPage() {
  const target = $("#jobs-page");
  if (!target) return;
  const sections = importJobFilterOptions("section");
  const statuses = importJobFilterOptions("status");
  const directions = importJobFilterOptions("direction");
  const jobs = filteredImportJobs({ useJobsFilters: true });
  const selectedJob = selectedImportJob(jobs);
  const totalJobs = importJobRows().length;
  const warnings = importJobRows().filter((job) => ["warning", "failed"].includes(String(job.status || "").toLowerCase())).length;
  const savedFiles = importJobRows().filter((job) => job.originalFilePath).length;
  target.innerHTML = `
    <div class="jobs-page">
      <section class="jobs-command-bar">
        <div class="jobs-command-head">
          <div>
            <p class="eyebrow">Operations</p>
            <h2>Jobs</h2>
            <p class="muted">${Number(jobs.length || 0).toLocaleString()} visible of ${Number(totalJobs || 0).toLocaleString()} jobs</p>
          </div>
          <button class="button secondary" type="button" data-refresh-import-jobs>${withIcon("refresh-cw", "Refresh jobs")}</button>
        </div>
        <div class="jobs-quick-stats">
          <span><small>Total</small><strong>${Number(totalJobs || 0).toLocaleString()}</strong></span>
          <span><small>Review</small><strong>${Number(warnings || 0).toLocaleString()}</strong></span>
          <span><small>Files</small><strong>${Number(savedFiles || 0).toLocaleString()}</strong></span>
        </div>
        <div class="jobs-filter-bar">
          <input id="jobs-search" type="search" placeholder="Search jobs, files, messages" value="${html(jobsFilter.query || "")}" />
          <select id="jobs-filter-section">
            <option value="">All categories</option>
            ${sections.map((section) => `<option value="${html(section.toLowerCase())}" ${jobsFilter.section === section.toLowerCase() ? "selected" : ""}>${html(section)}</option>`).join("")}
          </select>
          <select id="jobs-filter-status">
            <option value="">All statuses</option>
            ${statuses.map((status) => `<option value="${html(status.toLowerCase())}" ${jobsFilter.status === status.toLowerCase() ? "selected" : ""}>${html(importJobStatusLabel(status))}</option>`).join("")}
          </select>
          <select id="jobs-filter-direction">
            <option value="">All types</option>
            ${directions.map((direction) => `<option value="${html(direction.toLowerCase())}" ${jobsFilter.direction === direction.toLowerCase() ? "selected" : ""}>${html(direction)}</option>`).join("")}
          </select>
          <button class="button secondary" type="button" data-clear-job-filters>Clear</button>
        </div>
      </section>
      <div class="jobs-workspace">
        ${renderImportQueuePanel({ full: true })}
        ${renderJobProfile(selectedJob)}
      </div>
    </div>
  `;
}

function renderMappingDetailPage(selected) {
  return `
    <div class="mapping-page">
      <div class="mapping-page-head">
        <div>
          <button class="text-button" type="button" data-back-export-mappings>Back to templates</button>
          <p class="eyebrow">Import / Export Mapping</p>
          <h2>${html(selected.name)}</h2>
          <p class="muted">${html(selected.source)} template / ${(selected.mappings || []).length} mapped columns / ${html(selected.mode || "both")}</p>
        </div>
        <div class="mapping-actions">
          <button type="button" class="button" data-save-export-mapping="${selected.id}">Save changes</button>
          <span class="mapping-save-state" id="mapping-save-state">${mappingDraftDirty ? "Unsaved changes" : "No unsaved changes"}</span>
          <a class="button" href="/api/export-mappings/${selected.id}/export">Download CSV</a>
          <button type="button" class="button secondary" data-open-product-import="${selected.id}">Import CSV</button>
          <label class="file-button secondary">Load headers<input type="file" accept=".csv,text/csv" data-load-mapping-headers="${selected.id}" /></label>
          <button type="button" class="button secondary" data-duplicate-export-mapping="${selected.id}">Duplicate</button>
          ${isBuiltInExportMapping(selected) ? "" : `<button type="button" class="button danger" data-delete-export-mapping="${selected.id}">Delete</button>`}
        </div>
      </div>
      <div class="mapping-summary-grid">
        <span><small>Source</small><strong>${html(selected.source)}</strong></span>
        <span><small>Columns</small><strong>${(selected.mappings || []).length}</strong></span>
        <span><small>Import key</small><strong>${(selected.mappings || []).some((row) => row.productField === "sku") ? "SKU mapped" : "Needs SKU"}</strong></span>
        <span><small>Status</small><strong>${html(selected.status || "active")}</strong></span>
      </div>
      <div class="mapping-page-grid">
        <section class="mapping-card">
          <div class="section-head">
            <div>
              <h3>Template Settings</h3>
              <p class="muted">Name, channel, import/export mode, and notes.</p>
            </div>
          </div>
          <div class="category-map-grid">
            <label>Name<input value="${html(selected.name)}" data-export-mapping-draft-field="name" data-export-mapping-id="${selected.id}" /></label>
            <label>Source / channel<input value="${html(selected.source)}" data-export-mapping-draft-field="source" data-export-mapping-id="${selected.id}" /></label>
            <label>Status<select data-export-mapping-draft-field="status" data-export-mapping-id="${selected.id}"><option value="active" ${selected.status === "active" ? "selected" : ""}>active</option><option value="inactive" ${selected.status === "inactive" ? "selected" : ""}>inactive</option></select></label>
            <label>Mode<select data-export-mapping-draft-field="mode" data-export-mapping-id="${selected.id}"><option value="both" ${selected.mode === "both" ? "selected" : ""}>import + export</option><option value="export" ${selected.mode === "export" ? "selected" : ""}>export only</option><option value="import" ${selected.mode === "import" ? "selected" : ""}>import only</option></select></label>
            <label class="span-2">Notes<textarea rows="4" data-export-mapping-draft-field="notes" data-export-mapping-id="${selected.id}">${html(selected.notes || "")}</textarea></label>
          </div>
        </section>
        <section class="mapping-card">
          <div class="section-head">
            <div>
              <h3>Available Product Fields</h3>
              <p class="muted">Use these fields when building mapped columns.</p>
            </div>
          </div>
          <div class="field-chip-grid">${renderFieldOptionBadges() || `<p class="muted">Loading fields...</p>`}</div>
        </section>
      </div>
      <section class="mapping-card">
        <div class="section-head">
          <div>
            <h3>Column Mapping</h3>
            <p class="muted">Edit each template column directly. Empty DataPlus field means the column exports the default value.</p>
          </div>
          <button class="button secondary" type="button" data-add-export-mapping-row="${selected.id}">Add column</button>
        </div>
        <div class="mapping-row-editor">
          <div class="mapping-row-editor-head">
            <span>External column</span>
            <span>DataPlus field</span>
            <span>Default value</span>
            <span>Required</span>
            <span></span>
          </div>
          ${(selected.mappings || []).map((row, index) => renderMappingDraftRow(row, selected.id, index)).join("") || `<div class="empty-state compact">No columns yet. Add a column or load headers from a CSV.</div>`}
        </div>
        <details class="mapping-raw-editor">
          <summary>Advanced raw editor</summary>
          <textarea class="mapping-textarea" rows="10" data-export-mapping-draft-raw="${selected.id}">${html(mappingRowsText(selected))}</textarea>
        </details>
      </section>
    </div>
  `;
}

function renderImportExportMappings() {
  const target = $("#import-export-page") || $("#import-export-list");
  if (!target) return;
  if (!state) {
    target.innerHTML = `<div class="empty-state">Loading import/export templates...</div>`;
    loadExportMappingsOnly().catch((error) => toast(error.message));
    return;
  }
  if (!productFieldOptions) loadProductFieldOptions();
  const templates = state.exportMappings || [];
  const selected = templates.find((template) => template.id === activeExportMappingPageId);
  target.innerHTML = selected ? renderMappingDetailPage(selected) : renderImportExportCenter(templates);
}

async function refreshImportJobs() {
  const result = await api('/api/import-jobs');
  state.importJobs = result.importJobs || [];
  if (currentViewId === 'jobs') renderJobsPage();
  else renderImportExportMappings();
  toast('Import queue refreshed.');
}

async function stopImportJob(jobId) {
  const result = await api(`/api/import-jobs/${encodeURIComponent(jobId)}/stop`, { method: "POST" });
  state.importJobs = result.importJobs || state.importJobs || [];
  selectedImportJobId = result.job?.id || jobId;
  renderJobsPage();
  toast("Job stopped.");
}

function renderMarketplaceTemplates() {
  const templates = state.marketplaceTemplates || [];
  $("#template-list").innerHTML = templates.length
    ? `
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr><th>Marketplace</th><th>Field definitions</th><th>Category mappings</th><th>Title max</th><th>Rules</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${templates.map((template) => `
              <tr>
                <td><button class="order-link product-name-link" data-select-template="${template.id}">${html(template.marketplace)}</button><small>Validation template</small></td>
                <td><textarea rows="5" data-template-field="fieldDefinitions" data-template-id="${template.id}">${html((template.fieldDefinitions || []).map((field) => `${field.key}|${field.type || "text"}|${(field.options || []).join(";")}`).join("\n"))}</textarea></td>
                <td><textarea rows="5" data-template-field="categoryMappings" data-template-id="${template.id}">${html((template.categoryMappings || []).map((mapping) => `${mapping.internalCategory}|${mapping.marketplaceCategory}|${mapping.marketplaceCategoryId}`).join("\n"))}</textarea></td>
                <td><input type="number" min="0" value="${Number(template.titleMaxLength || 0)}" data-template-field="titleMaxLength" data-template-id="${template.id}" /></td>
                <td>
                  <div class="template-rules">
                    <label>Min images <input type="number" min="0" value="${Number(template.minImages || 0)}" data-template-field="minImages" data-template-id="${template.id}" /></label>
                    <label><input type="checkbox" ${template.requirePrice ? "checked" : ""} data-template-field="requirePrice" data-template-id="${template.id}" /> Price</label>
                    <label><input type="checkbox" ${template.requireHandlingTime ? "checked" : ""} data-template-field="requireHandlingTime" data-template-id="${template.id}" /> Handling</label>
                    <label><input type="checkbox" ${template.requireShippingProfile ? "checked" : ""} data-template-field="requireShippingProfile" data-template-id="${template.id}" /> Shipping profile</label>
                  </div>
                </td>
                <td>
                  <div class="action-menu">
                    <button class="icon-button" data-action-menu="template-${template.id}" aria-label="Open template actions">...</button>
                    <div class="action-popover" data-menu-for="template-${template.id}">
                      <button data-template-action="duplicate" data-template-id="${template.id}">Duplicate template</button>
                      <button data-template-action="reset" data-template-id="${template.id}">Reset to default</button>
                      <button data-template-action="${template.status === "inactive" ? "active" : "inactive"}" data-template-id="${template.id}">${template.status === "inactive" ? "Set active" : "Set inactive"}</button>
                      <button data-select-template="${template.id}">Preview template</button>
                    </div>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No marketplace templates found.</div>`;
}

function allShadowRows() {
  const rows = [];
  for (const product of state.inventory || []) {
    for (const shadow of product.shadowSkus || []) {
      rows.push({ product, shadow, validation: validateShadowListing(product, shadow) });
    }
  }
  return rows;
}

function allocatedQtyFor(product, currentShadow = null) {
  return (product.shadowSkus || []).reduce((sum, shadow) => {
    if (currentShadow && shadow.id === currentShadow.id) return sum;
    const parentAvailable = Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0) - Number(shadow.safetyQty || 0));
    const sellable = Number(shadow.maxSellableQty || 0) > 0 ? Math.min(parentAvailable, Number(shadow.maxSellableQty || 0)) : parentAvailable;
    return sum + sellable;
  }, 0);
}

function renderReadinessQueue() {
  const rows = allShadowRows();
  const products = (state.inventory || []).map((product) => ({ product, readiness: productReadiness(product) }))
    .sort((a, b) => a.readiness.score - b.readiness.score);
  $("#readiness-list").innerHTML = `
      <div class="catalog-readiness-overview">
        <div class="mapping-summary-grid">
          <span><small>Products</small><strong>${products.length}</strong></span>
          <span><small>Ready products</small><strong>${products.filter((row) => row.readiness.ready).length}</strong></span>
          <span><small>Needs work</small><strong>${products.filter((row) => !row.readiness.ready).length}</strong></span>
          <span><small>Shadow listings</small><strong>${rows.length}</strong></span>
        </div>
      </div>
      ${products.length ? `
      <div class="catalog-table-wrap readiness-table">
        <table class="catalog-table">
          <thead><tr><th>Product</th><th>Score</th><th>Missing</th><th>Stock</th><th>Price</th><th>Vendor</th><th>Action</th></tr></thead>
          <tbody>
            ${products.slice(0, 150).map(({ product, readiness }) => `
              <tr>
                <td><button class="order-link product-name-link" data-select-product="${product.id}" data-product-target="product-full">${html(product.sku)}</button><small>${html(product.marketplaceTitle || product.title || "Untitled product")}</small></td>
                <td><span class="status ${readinessTone(readiness.score)}">${readiness.score}% ready</span></td>
                <td>${html(readiness.missing.slice(0, 5).join(", ") || "None")}</td>
                <td>${Number(product.qty ?? product.stockQty ?? 0)}</td>
                <td>${money(product.price || 0)}</td>
                <td>${html(product.vendor || product.supplier || "No vendor")}</td>
                <td><button class="button secondary" data-select-product="${product.id}" data-product-target="product-full">Review</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ` : `<div class="empty-state">No products yet.</div>`}
      ${rows.length ? `
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead><tr><th>Shadow SKU</th><th>Marketplace</th><th>Parent</th><th>Readiness</th><th>Missing</th><th>Allocation</th><th>Sync</th><th>Action</th></tr></thead>
          <tbody>
            ${rows.map(({ product, shadow, validation }) => {
              const ready = validation.every((check) => check.ok);
              const missing = validation.filter((check) => !check.ok).map((check) => check.label);
              const parentAvailable = Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0));
              const allocated = allocatedQtyFor(product);
              return `
                <tr>
                  <td><button class="order-link product-name-link" data-select-shadow="${shadow.id}" data-parent-product="${product.id}">${html(shadow.shadowSku)}</button></td>
                  <td>${html(shadow.marketplace || "")}</td>
                  <td>${html(product.sku)}</td>
                  <td><span class="status ${ready ? "active" : "hold"}">${ready ? "Ready" : `${validation.length - missing.length}/${validation.length}`}</span></td>
                  <td>${missing.length ? html(missing.slice(0, 4).join(", ")) : "None"}</td>
                  <td>${allocated}/${parentAvailable}</td>
                  <td>${html(shadow.syncStatus || "Not synced")}</td>
                  <td>
                    <button class="button secondary" data-shadow-sync="${shadow.id}" data-product-id="${product.id}" ${ready ? "" : "disabled"}>Sync</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty-state">No shadow SKUs yet. Create marketplace shadows from a product page.</div>`}
    `;
}

function renderCatalogImportReviews() {
  const reviews = (state.catalogImportReviews || []);
  const pending = reviews.filter((review) => review.status === "pending");
  const decided = reviews.filter((review) => review.status !== "pending").slice(0, 50);
  const byField = pending.reduce((acc, review) => {
    acc[review.field] = (acc[review.field] || 0) + 1;
    return acc;
  }, {});
  const topFields = Object.entries(byField).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#import-review-list").innerHTML = `
    <div class="catalog-review-page">
      <div class="mapping-directory-head">
        <div>
          <p class="eyebrow">Import Review</p>
          <h2>Protected Catalog Changes</h2>
          <p class="muted">Weekly dump changes for protected fields wait here before they touch cleaned product data.</p>
        </div>
        <div class="mapping-actions">
          <button class="button secondary" type="button" data-review-bulk-action="reject">Reject all pending</button>
          <button class="button" type="button" data-review-bulk-action="accept">Accept all pending</button>
        </div>
      </div>
      <div class="mapping-summary-grid">
        <span><small>Pending changes</small><strong>${pending.length}</strong></span>
        <span><small>Products affected</small><strong>${new Set(pending.map((review) => review.sku)).size}</strong></span>
        <span><small>Most changed field</small><strong>${html(topFields[0]?.[0] || "None")}</strong></span>
        <span><small>Resolved history</small><strong>${decided.length}</strong></span>
      </div>
      ${topFields.length ? `<div class="review-field-chips">${topFields.map(([field, count]) => `<span>${html(field)} <strong>${count}</strong></span>`).join("")}</div>` : ""}
      ${pending.length ? `
        <div class="catalog-table-wrap review-table">
          <table class="catalog-table">
            <thead><tr><th>SKU</th><th>Field</th><th>Current DataPlus value</th><th>Incoming dump value</th><th>Source</th><th>Updated</th><th>Action</th></tr></thead>
            <tbody>
              ${pending.slice(0, 300).map((review) => `
                <tr>
                  <td><button class="order-link product-name-link" data-review-open-product="${html(review.sku)}">${html(review.sku)}</button></td>
                  <td><strong>${html(review.label || review.field)}</strong></td>
                  <td>${html(review.currentValue)}</td>
                  <td>${html(review.incomingValue)}</td>
                  <td>${html(review.source || "Product dump")}</td>
                  <td>${review.updatedAt ? simpleDate(review.updatedAt) : ""}</td>
                  <td class="review-actions">
                    <button class="button secondary compact-button" type="button" data-review-action="reject" data-review-id="${review.id}">Reject</button>
                    <button class="button compact-button" type="button" data-review-action="accept" data-review-id="${review.id}">Accept</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${pending.length > 300 ? `<p class="muted">Showing first 300 pending changes. Use the API bulk actions for the full queue.</p>` : ""}
      ` : `<div class="empty-state">No pending protected changes. New weekly dump differences will appear here.</div>`}
      ${decided.length ? `
        <section class="review-history">
          <h3>Recent decisions</h3>
          <div class="catalog-table-wrap">
            <table class="catalog-table">
              <thead><tr><th>SKU</th><th>Field</th><th>Decision</th><th>Value</th><th>Date</th></tr></thead>
              <tbody>${decided.map((review) => `<tr><td>${html(review.sku)}</td><td>${html(review.label || review.field)}</td><td><span class="status ${review.status === "accepted" ? "active" : "inactive"}">${html(review.status)}</span></td><td>${html(review.incomingValue)}</td><td>${review.decidedAt ? simpleDate(review.decidedAt) : ""}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

async function applyCatalogImportReview(id, action) {
  const result = await api(`/api/catalog-import-reviews/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
  setState(result.state);
  renderCatalogImportReviews();
  toast(action === "accept" ? "Change accepted." : "Change rejected.");
}

async function applyCatalogImportReviewBulk(action) {
  const pendingIds = (state.catalogImportReviews || []).filter((review) => review.status === "pending").map((review) => review.id);
  if (!pendingIds.length) return toast("No pending changes.");
  const result = await api("/api/catalog-import-reviews/bulk", {
    method: "POST",
    body: JSON.stringify({ action, ids: pendingIds })
  });
  setState(result.state);
  renderCatalogImportReviews();
  toast(`${result.changed || 0} change${result.changed === 1 ? "" : "s"} ${action === "accept" ? "accepted" : "rejected"}.`);
}

function openProductFromReviewSku(sku) {
  const item = (state.inventory || []).find((product) => String(product.sku || "").toLowerCase() === String(sku || "").toLowerCase());
  if (!item) return toast("Product not found.");
  selectedProductId = item.id;
  selectedProductWorkspaceTab = "source";
  setView("product-full");
}

function renderProductsTable(items) {
  const exportMappings = state.exportMappings || [];
  const filteredCount = items.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / PRODUCT_CATALOG_PAGE_SIZE));
  productCatalogPage = Math.min(Math.max(1, productCatalogPage), pageCount);
  const pageStart = (productCatalogPage - 1) * PRODUCT_CATALOG_PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + PRODUCT_CATALOG_PAGE_SIZE);
  const selectedCount = selectedProductAllFiltered ? filteredCount : selectedProductIds.size;
  const selectionLabel = selectedProductAllFiltered
    ? `${Number(filteredCount).toLocaleString()} filtered results selected`
    : selectedProductIds.size
      ? `${Number(selectedProductIds.size).toLocaleString()} selected`
      : `${Number(filteredCount).toLocaleString()} filtered products`;
  loadProductTableAlternates(pageItems).catch((error) => toast(error.message));
  $("#products-list").innerHTML = items.length
    ? `
      <div class="catalog-selection-toolbar product-export-bar">
        <div class="selection-summary">
          <strong>Product selection</strong>
          <small>${html(selectionLabel)} / showing ${Number(pageItems.length).toLocaleString()}</small>
        </div>
        <div class="selection-actions">
          <button class="button secondary" type="button" data-select-products-page>Select current page</button>
          <button class="button secondary" type="button" data-select-products-filtered>Select all results</button>
          <button class="button secondary" type="button" data-clear-products-selection ${selectedCount ? "" : "disabled"}>Clear</button>
        </div>
        <div class="product-export-controls">
          <select id="product-export-template">
            ${exportMappings.map((template) => `<option value="${template.id}" ${template.id === selectedExportMappingId ? "selected" : ""}>${html(template.name)}</option>`).join("")}
          </select>
          <button class="button secondary" type="button" data-export-products ${exportMappings.length ? "" : "disabled"}>Export CSV</button>
        </div>
      </div>
      <div class="catalog-source-summary product-page-summary">
        <span><strong>${Number(filteredCount).toLocaleString()}</strong><small>filtered products</small></span>
        <span><strong>Page ${productCatalogPage} of ${pageCount}</strong><small>${Number(pageStart + 1).toLocaleString()}-${Number(pageStart + pageItems.length).toLocaleString()}</small></span>
        <span><strong>${Number(PRODUCT_CATALOG_PAGE_SIZE).toLocaleString()}</strong><small>rows per page</small></span>
        <div class="source-pagination">
          <button class="button secondary" type="button" data-product-page="${productCatalogPage - 1}" ${productCatalogPage <= 1 ? "disabled" : ""}>Previous</button>
          <button class="button secondary" type="button" data-product-page="${productCatalogPage + 1}" ${productCatalogPage >= pageCount ? "disabled" : ""}>Next</button>
        </div>
      </div>
      <div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr><th><input type="checkbox" data-product-check-all ${pageItems.length && pageItems.every((item) => selectedProductAllFiltered || selectedProductIds.has(item.id)) ? "checked" : ""} /></th><th>Product</th><th>Readiness</th><th>Alternates</th><th>Manufacturer</th><th>Vendor SKU</th><th>Brand</th><th>Category</th><th>Status</th><th>Shopify</th><th>Shadows</th><th>Price</th><th>Images</th><th>Updated</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${pageItems.map((item) => `
              <tr>
                <td><input type="checkbox" data-product-check="${item.id}" ${selectedProductAllFiltered || selectedProductIds.has(item.id) ? "checked" : ""} /></td>
                <td>
                  <button class="order-link product-name-link" data-select-product="${item.id}" data-product-target="product-full">${html(item.sku)}</button>
                  <small>${html(item.marketplaceTitle || item.title || "Untitled product")}</small>
                </td>
                <td>${renderReadinessPill(item)}<small>${html(productReadiness(item).missing.slice(0, 2).join(", ") || "Ready checks passed")}</small></td>
                <td>${renderProductAlternatesCell(item)}</td>
                <td>${html(item.manufacturer || "No manufacturer")}</td>
                <td>${html(item.vendorSku || "No vendor SKU")}</td>
                <td>${html(item.brand || "No brand")}<small>${verifiedBrandForHandle(item) ? "Verified" : "Unverified"}</small></td>
                <td>${html(item.category || "Uncategorized")}<small>Vendor: ${html(item.sourceCategory || item.vendorCategory || "n/a")}</small></td>
                <td><span class="status ${String(item.status || "draft").toLowerCase()}">${html(item.status || "Draft")}</span></td>
                <td><span class="status ${item.shopifyId && item.shopifyStatus === "Active" && item.shopifyPublished === true ? "active" : "draft"}">${html(item.shopifyStatus || (item.shopifyId ? "Synced" : "Not live"))}</span><small>${html(item.shopifyId || "No Shopify ID")}</small></td>
                <td>${(item.shadowSkus || []).length}</td>
                <td>${money(item.price || 0)}</td>
                <td><span class="image-count-pill ${productImageUrls(item).length > 1 ? "has-gallery" : ""}">${productImageUrls(item).length}</span></td>
                <td>${simpleDate(item.updatedAt)}</td>
                <td>
                  <div class="action-menu">
                    <button class="icon-button" data-action-menu="product-${item.id}" aria-label="Open product actions">...</button>
                    <div class="action-popover" data-menu-for="product-${item.id}">
                      <button data-select-product="${item.id}" data-product-target="product-full">Edit product content</button>
                      <button data-select-product="${item.id}" data-product-target="inventory-full">View inventory details</button>
                      <button data-product-row-action="set-active" data-product-id="${item.id}">Set active</button>
                      <button data-product-row-action="set-inactive" data-product-id="${item.id}">Set inactive</button>
                      <button data-product-row-action="set-discontinued" data-product-id="${item.id}">Set discontinued</button>
                      <button data-product-row-action="delete" data-product-id="${item.id}">Delete from Products</button>
                    </div>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No products match this filter.</div>`;
}

function renderInventoryTable(items) {
  const filteredCount = items.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / PRODUCT_CATALOG_PAGE_SIZE));
  inventoryCatalogPage = Math.min(Math.max(1, inventoryCatalogPage), pageCount);
  const pageStart = (inventoryCatalogPage - 1) * PRODUCT_CATALOG_PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + PRODUCT_CATALOG_PAGE_SIZE);
  $("#inventory-list").innerHTML = items.length
    ? `
      <div class="catalog-source-summary product-page-summary">
        <span><strong>${Number(filteredCount).toLocaleString()}</strong><small>filtered inventory items</small></span>
        <span><strong>Page ${inventoryCatalogPage} of ${pageCount}</strong><small>${Number(pageStart + 1).toLocaleString()}-${Number(pageStart + pageItems.length).toLocaleString()}</small></span>
        <span><strong>${Number(PRODUCT_CATALOG_PAGE_SIZE).toLocaleString()}</strong><small>rows per page</small></span>
        <div class="source-pagination">
          <button class="button secondary" type="button" data-inventory-page="${inventoryCatalogPage - 1}" ${inventoryCatalogPage <= 1 ? "disabled" : ""}>Previous</button>
          <button class="button secondary" type="button" data-inventory-page="${inventoryCatalogPage + 1}" ${inventoryCatalogPage >= pageCount ? "disabled" : ""}>Next</button>
        </div>
      </div>
      <div class="catalog-table-wrap">
        <table class="catalog-table inventory-table">
          <thead>
            <tr><th>SKU</th><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Reorder point</th><th>Cost</th><th>Vendor</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${pageItems.map((item) => {
              const available = Number(item.qty || 0) - Number(item.reserved || 0);
              const low = available <= Number(item.reorderPoint || 0);
              return `
                <tr class="${low ? "inventory-low-row" : ""}">
                  <td><button class="order-link product-name-link" data-select-product="${item.id}" data-product-target="inventory-full">${html(item.sku)}</button></td>
                  <td>${html(item.title || item.marketplaceTitle || "Untitled product")}</td>
                  <td><strong>${Number(item.qty || 0)}</strong></td>
                  <td>${Number(item.reserved || 0)}</td>
                  <td><span class="status ${low ? "hold" : "active"}">${available}</span></td>
                  <td>${Number(item.reorderPoint || 0)}</td>
                  <td>${money(item.cost || 0)}</td>
                  <td>${html(item.vendor || "No vendor")}</td>
                  <td>
                    <div class="action-menu">
                      <button class="icon-button" data-action-menu="inventory-${item.id}" aria-label="Open inventory actions">...</button>
                      <div class="action-popover" data-menu-for="inventory-${item.id}">
                        <button data-select-product="${item.id}" data-product-target="inventory-full">View inventory details</button>
                        <button data-select-product="${item.id}" data-product-target="product-full">Edit product content</button>
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No inventory rows match this filter.</div>`;
}

function productManagerValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderProductManagerFields(item) {
  const fields = item.productManagerFields && typeof item.productManagerFields === "object" ? item.productManagerFields : {};
  const preferredOrder = [
    "_id",
    "sku",
    "active",
    "brand",
    "category",
    "created_at",
    "updated_at",
    "default_image",
    "images",
    "description",
    "short_description",
    "hazardous",
    "item_height",
    "item_length",
    "item_weight",
    "item_width",
    "list_price",
    "price",
    "fob_price",
    "manufacturer",
    "mfr_part_number",
    "min_quantity",
    "name",
    "package_height",
    "package_length",
    "package_weight",
    "package_width",
    "quantity_increments",
    "sds_url",
    "supplier",
    "supplier_code",
    "tags",
    "unspsc",
    "uom",
    "uom_qty",
    "upc",
    "vendor_sku",
    "zoro_sku",
    "zoro_price",
    "zoro_leadtime",
    "zoro_minimum_qty",
    "varis_contract_price",
    "varis_list_price",
    "varis_od_managed_price",
    "varis_non_od_managed_price",
    "varis_od_private_price",
    "varis_non_od_private_price",
    "wildcardSearch",
    "stock_qty",
    "stock_status",
    "stock_updated_at",
    "original_image",
    "default_supplier",
    "last_prices_update_at",
    "last_prices_update_by",
    "lead_time",
    "leadtime",
    "suppliers",
    "alt_vendor_sku",
    "country_of_origin",
    "original_sds_url",
    "inactive_mailed_at",
    "checked_image",
    "validated_at",
    "item_key",
    "item_clearance_indicator",
    "ctech_id",
    "ctech_id_last_export",
    "original",
    "vendor_descripton",
    "vendor_description",
    "uploaded_by"
  ];
  const keys = [...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(fields, key)), ...Object.keys(fields).filter((key) => !preferredOrder.includes(key)).sort()];

  return keys.length
    ? `
      <div class="product-manager-grid">
        ${keys.map((key) => `
          <label>
            ${html(key)}
            <textarea rows="${typeof fields[key] === "object" ? 4 : 2}" readonly>${html(productManagerValue(fields[key]))}</textarea>
          </label>
        `).join("")}
      </div>
    `
    : `<p class="muted">No product dump fields have been imported for this product yet.</p>`;
}

function productFieldLabel(label, field, item, options = {}) {
  const value = item[field] ?? "";
  const className = options.className ? ` class="${html(options.className)}"` : "";
  const attrs = options.readonly
    ? `readonly aria-readonly="true"`
    : `data-product-field="${field}" data-product-id="${item.id}"`;
  if (options.textarea) {
    return `<label${className}>${label}<textarea rows="${options.rows || 3}" ${attrs}>${html(value)}</textarea></label>`;
  }
  const type = options.type || "text";
  const step = options.step ? ` step="${options.step}"` : "";
  const min = options.min !== undefined ? ` min="${options.min}"` : "";
  return `<label${className}>${label}<input type="${type}"${step}${min} value="${html(value)}" ${attrs} /></label>`;
}

function productShadowForMarketplace(item, marketplace) {
  const key = String(marketplace || "").toLowerCase();
  return (item.shadowSkus || []).find((shadow) => String(shadow.marketplace || shadow.company || "").toLowerCase().includes(key)) || null;
}

function productTabButton(id, label) {
  const icons = { home: "home", shopify: "shopping-bag", zoro: "store", shipping: "truck", pricing: "dollar-sign", source: "database", search: "search" };
  return `<button class="product-workspace-tab ${selectedProductWorkspaceTab === id ? "active" : ""}" data-product-workspace-tab="${id}">${withIcon(icons[id] || "info", label)}</button>`;
}

function exportMappingForSource(source) {
  const key = String(source || "").trim().toLowerCase();
  const templates = state.exportMappings || [];
  return templates
    .filter((template) => {
      const sourceText = String(template.source || "").toLowerCase();
      const nameText = String(template.name || "").toLowerCase();
      return sourceText.includes(key) || nameText.includes(key);
    })
    .sort((a, b) => (b.mappings || []).length - (a.mappings || []).length)[0] || null;
}

function slugPart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function verifiedBrandForHandle(item = {}) {
  const explicitBrand = item.verifiedBrand || item.verified_brand;
  if (String(explicitBrand || "").trim()) return explicitBrand;
  return item.brandLocked && String(item.brand || "").trim() ? item.brand : "";
}

function categoryMappingForProduct(item, channel = "shopify") {
  const category = String(item.category || "").trim().toLowerCase();
  if (!category) return null;
  return (state.categorySettings || []).find((row) => (
    String(row.name || "").trim().toLowerCase() === category
    || String(row.categoryId || row.id || "").trim().toLowerCase() === category
  ))?.mappings?.[channel] || null;
}

function shopifyHandleForProduct(item) {
  const verifiedBrand = verifiedBrandForHandle(item);
  const title = item.marketplaceTitle || item.title || item.name;
  const name = item.name || item.title || item.marketplaceTitle;
  const parts = verifiedBrand ? [verifiedBrand, item.sku, title] : [item.sku, name];
  return parts.map(slugPart)
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-");
}

function cleanExportNumber(value, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return Number(number.toFixed(decimals)).toString();
}

function shopifyDimensionValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${cleanExportNumber(number * 25.4, 3)} mm`;
}

function shopifyWeightValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${cleanExportNumber(number * 0.45359237, 3)} kg`;
}

function shopifyBooleanValue(value, item = {}) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "active", "in stock", "instock", "available", "received"].includes(text)) return "TRUE";
  if (["false", "0", "no", "n", "inactive", "out of stock", "outofstock", "unavailable", "discontinued", "deleted"].includes(text)) return "FALSE";
  if (Number.isFinite(Number(value))) return Number(value) > 0 ? "TRUE" : "FALSE";
  return Number(item.stockQty ?? item.qty ?? 0) > 0 ? "TRUE" : "FALSE";
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function shopifyDateTimeValue(value) {
  if (!value) return "";
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmy) {
    const [, day, month, year, hour = "0", minute = "0"] = dmy;
    return `${year}-${padDatePart(month)}-${padDatePart(day)} ${padDatePart(hour)}:${padDatePart(minute)}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())} ${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}`;
}

function shopifyJsonValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return JSON.stringify(trimmed);
    }
  }
  return JSON.stringify(value);
}

function barcodeTextValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let text = raw;
  if (/^\d+(?:\.\d+)?e\+\d+$/i.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) {
      text = number.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 0 });
    }
  }
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 7 && digits.length < 12 ? digits.padStart(12, "0") : digits;
}

function shopifyProductStatusValue(value, item = {}, mapping = {}) {
  const raw = String(value || mapping.defaultValue || item.status || "").trim().toLowerCase();
  if (["active", "published", "publish"].includes(raw)) return "Active";
  if (["archived", "archive", "deleted", "discontinued"].includes(raw)) return "Archived";
  return "Draft";
}

function shopifyPublishedValue(item = {}, mapping = {}) {
  return shopifyProductStatusValue(item.status, item, mapping) === "Active" ? "TRUE" : "FALSE";
}

function categoryTypeValue(value) {
  const parts = String(value || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(-2).join(" > ") || parts[0] || "";
}

function formatMappedExportValue(value, mapping = {}, item = {}) {
  const column = String(mapping.externalColumn || "");
  if (/^(Variant Barcode|Barcode|UPC|GTIN|EAN)$/i.test(column)) return barcodeTextValue(value);
  if (/^Type$/i.test(column)) return categoryTypeValue(value);
  if (/^Status$/i.test(column)) return shopifyProductStatusValue(value, item, mapping);
  if (/^Published$/i.test(column)) return shopifyPublishedValue(item, mapping);
  if (/^Variant Inventory Tracker$/i.test(column)) return "shopify";
  if (/^Metafield:\s*custom\..*\[dimension\]/i.test(column)) return shopifyDimensionValue(value);
  if (/^Metafield:\s*custom\..*\[weight\]/i.test(column)) return shopifyWeightValue(value);
  if (/^Metafield:\s*custom\..*\[boolean\]/i.test(column)) return shopifyBooleanValue(value, item);
  if (/^Metafield:\s*custom\..*\[date_time\]/i.test(column)) return shopifyDateTimeValue(value);
  if (/^Metafield:\s*custom\..*\[json\]/i.test(column)) return shopifyJsonValue(value);
  if (Array.isArray(value)) return value.join("|");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value;
}

function productMappedValue(item, mapping = {}) {
  const field = mapping.productField;
  if (String(mapping.externalColumn || "").trim().toLowerCase() === "handle") return shopifyHandleForProduct(item);
  if (!field) return mapping.defaultValue || "";
  if (field === "available") return Number(item.qty ?? item.stockQty ?? 0) - Number(item.reserved || 0);
  if (field === "vendor") return item.vendor ?? item.supplier ?? "";
  if (field === "qty") return item.qty ?? item.stockQty ?? "";
  if (field === "shopifyHandle") return shopifyHandleForProduct(item);
  if (field === "images") return (item.images || []).join("|");
  if (field === "tags") return Array.isArray(item.tags) ? item.tags.join("|") : item.tags || "";
  if (field === "bulletPoints") return productBulletPoints(item).join("|");
  if (field === "sources") return Object.entries(item.sources || {}).map(([source, id]) => `${source}:${id}`).join(";");
  if (field === "shopifyCategoryId") return categoryMappingForProduct(item, "shopify")?.categoryId || "";
  if (field === "shopifyCategoryPath") return categoryMappingForProduct(item, "shopify")?.categoryPath || "";
  if (field === "googleCategoryId") return categoryMappingForProduct(item, "shopify")?.googleCategory?.id || "";
  if (field === "googleCategoryBreadcrumb") {
    const googleCategory = categoryMappingForProduct(item, "shopify")?.googleCategory;
    return googleCategory?.breadcrumb || googleCategory?.fullName || "";
  }
  const value = item[field];
  const formatted = formatMappedExportValue(value, mapping, item);
  return formatted === undefined || formatted === null || formatted === "" ? mapping.defaultValue || "" : formatted;
}

function mappedFieldDefinition(field) {
  return (productFieldOptions || []).find((option) => option.key === field) || null;
}

function renderMappedProductField(item, mapping = {}) {
  const field = mapping.productField || "";
  const definition = mappedFieldDefinition(field);
  const computedFields = new Set(["available", "shopifyHandle", "shopifyCategoryId", "shopifyCategoryPath", "googleCategoryId", "googleCategoryBreadcrumb", "sources"]);
  const editable = field && !computedFields.has(field) && definition?.type !== "computed" && definition?.type !== "category";
  const value = productMappedValue(item, mapping);
  const isLong = String(value || "").length > 100 || /description|body|html|seo|tags/i.test(`${mapping.externalColumn || ""} ${field}`);
  const meta = [
    field ? `DataPlus: ${field}` : "Not mapped",
    mapping.defaultValue ? `Default: ${mapping.defaultValue}` : ""
  ].filter(Boolean).join(" | ");
  const control = isLong
    ? `<textarea rows="3" ${editable ? `data-product-field="${html(field)}" data-product-id="${item.id}"` : "readonly"}>${html(value)}</textarea>`
    : `<input value="${html(value)}" ${editable ? `data-product-field="${html(field)}" data-product-id="${item.id}"` : "readonly"} />`;
  return `
    <label class="mapped-product-field ${editable ? "" : "readonly"}">
      <span>${html(mapping.externalColumn || field || "Unmapped column")}</span>
      <small>${html(meta)}</small>
      ${control}
    </label>
  `;
}

function renderMarketplaceTab(item, marketplace) {
  const shadow = productShadowForMarketplace(item, marketplace);
  const isShopify = marketplace === "shopify";
  const title = isShopify ? "Shopify" : marketplace.toUpperCase();
  const template = isShopify ? exportMappingForSource("shopify") : null;
  const mappedFields = template?.mappings || [];
  return `
    <div class="product-tab-grid">
      <section class="product-panel span-2">
        <div class="section-head product-section-head">
          <div>
            <h3>${title} Listing Fields</h3>
            <p class="muted">${template ? `${html(template.name)} / ${mappedFields.length} mapped columns` : "Core channel fields"}</p>
          </div>
          <span class="status ${shadow ? "active" : "draft"}">${shadow ? "Shadow exists" : "No shadow"}</span>
        </div>
        ${mappedFields.length ? `
          <div class="mapped-product-field-grid">
            ${mappedFields.map((mapping) => renderMappedProductField(item, mapping)).join("")}
          </div>
        ` : `
          <div class="product-form-grid">
            ${productFieldLabel(`${title} ID`, isShopify ? "shopifyId" : `${marketplace}Id`, item)}
            ${productFieldLabel("Marketplace title", "marketplaceTitle", item)}
            ${productFieldLabel("Main category", "category", item)}
            ${productFieldLabel("Vendor category", "sourceCategory", item, { readonly: true })}
            ${productFieldLabel("Brand", "brand", item)}
            ${productFieldLabel("SEO keywords", "seoKeywords", item)}
            ${productFieldLabel("Tags", "tags", item)}
          </div>
          <div class="product-field-stack">
            ${productFieldLabel("Short description", "shortDescription", item, { textarea: true, rows: 3 })}
            ${productFieldLabel("Long description / body HTML", "longDescription", item, { textarea: true, rows: 8 })}
          </div>
        `}
      </section>
      <section class="product-panel">
        <h3>Channel Pricing</h3>
        <div class="product-price-grid">
          ${shadow ? `
            <label>Shadow price<input type="number" step="0.01" value="${Number(shadow.price || 0)}" data-shadow-field="price" data-product-id="${item.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Status<select data-shadow-field="status" data-product-id="${item.id}" data-shadow-id="${shadow.id}">${["Draft", "Active", "Paused"].map((status) => `<option ${String(shadow.status || "Draft") === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
          ` : `
            ${productFieldLabel("Base price", "price", item, { type: "number", step: "0.01" })}
            ${productFieldLabel("Cost", "cost", item, { type: "number", step: "0.01" })}
          `}
        </div>
      </section>
      <section class="product-panel">
        <h3>Channel Shipping</h3>
        <div class="product-field-stack compact-fields">
          ${shadow ? `
            <label>Handling time<input type="number" min="0" value="${Number(shadow.handlingTimeDays || 0)}" data-shadow-field="handlingTimeDays" data-product-id="${item.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Shipping profile<input value="${html(shadow.shippingProfile || "")}" data-shadow-field="shippingProfile" data-product-id="${item.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Shipping service<input value="${html(shadow.shippingService || "")}" data-shadow-field="shippingService" data-product-id="${item.id}" data-shadow-id="${shadow.id}" /></label>
          ` : `<p class="muted">Create a marketplace shadow to manage channel-specific shipping.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderZoroTab(item) {
  return `
    <div class="product-tab-grid">
      <section class="product-panel span-2">
        <h3>Zoro Fields</h3>
        <div class="product-form-grid">
          ${productFieldLabel("Zoro SKU", "zoroSku", item)}
          ${productFieldLabel("Zoro price", "zoroPrice", item, { type: "number", step: "0.01" })}
          ${productFieldLabel("Zoro lead time", "zoroLeadtime", item)}
          ${productFieldLabel("Zoro minimum qty", "zoroMinimumQty", item, { type: "number", step: "1" })}
          ${productFieldLabel("Default supplier", "defaultSupplier", item)}
          ${productFieldLabel("Alt vendor SKU", "altVendorSku", item)}
        </div>
        <div class="product-field-stack">
          ${productFieldLabel("Vendor description", "vendorDescription", item, { textarea: true, rows: 4 })}
        </div>
      </section>
      <section class="product-panel">
        <h3>Source Availability</h3>
        ${renderProductAvailabilityPanel(item)}
      </section>
    </div>
  `;
}

function renderShippingTab(item) {
  return `
    <div class="product-tab-grid">
      <section class="product-panel span-2">
        <h3>Shipping Preferences</h3>
        <div class="product-form-grid">
          ${productFieldLabel("Item weight", "itemWeight", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Item length", "itemLength", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Item width", "itemWidth", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Item height", "itemHeight", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Package weight", "packageWeight", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Package length", "packageLength", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Package width", "packageWidth", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Package height", "packageHeight", item, { type: "number", step: "0.001" })}
          ${productFieldLabel("Country of origin", "countryOfOrigin", item)}
          ${productFieldLabel("SDS URL", "sdsUrl", item)}
        </div>
      </section>
    </div>
  `;
}

function renderPricingTab(item, grossProfit, margin) {
  const shadows = item.shadowSkus || [];
  return `
    <div class="product-tab-grid">
      <section class="product-panel">
        <h3>Base Pricing</h3>
        <div class="product-price-grid">
          ${productFieldLabel("Price", "price", item, { type: "number", step: "0.01" })}
          ${productFieldLabel("Cost", "cost", item, { type: "number", step: "0.01" })}
          ${productFieldLabel("MSRP", "msrp", item, { type: "number", step: "0.01" })}
          ${productFieldLabel("FOB", "fobPrice", item, { type: "number", step: "0.01" })}
        </div>
        <div class="product-margin-box"><small>Gross profit</small><strong>${money(grossProfit)}</strong><span>${margin.toFixed(1)}% margin</span></div>
      </section>
      <section class="product-panel span-2">
        <h3>Marketplace Pricing</h3>
        <div class="catalog-table-wrap compact-availability">
          <table class="catalog-table">
            <thead><tr><th>Marketplace</th><th>Shadow SKU</th><th>Price</th><th>Status</th><th>Inventory policy</th></tr></thead>
            <tbody>
              ${shadows.map((shadow) => `
                <tr>
                  <td>${html(shadow.marketplace || shadow.company || "")}</td>
                  <td>${html(shadow.shadowSku || "")}</td>
                  <td><input type="number" step="0.01" value="${Number(shadow.price || 0)}" data-shadow-field="price" data-product-id="${item.id}" data-shadow-id="${shadow.id}" /></td>
                  <td>${html(shadow.status || "Draft")}</td>
                  <td>${html(shadow.inventoryPolicy || "Share parent inventory")}</td>
                </tr>
              `).join("") || `<tr><td colspan="5">No marketplace shadows yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderBrandGuard(item = {}) {
  const sourceBrand = item.sourceBrand || item.productManagerFields?.brand || item.original?.brand || "";
  const locked = Boolean(item.brandLocked);
  return `
    <div class="brand-guard-field">
      <div class="brand-guard-head">
        <strong>Brand protection</strong>
        <span class="status ${locked ? "active" : "hold"}">${locked ? "Locked" : "Unlocked"}</span>
      </div>
      ${productFieldLabel("Brand", "brand", item)}
      <label class="brand-lock-toggle">
        <input type="checkbox" ${locked ? "checked" : ""} data-product-field="brandLocked" data-product-id="${item.id}" />
        <span>Lock brand from dump updates</span>
      </label>
      <p class="brand-lock-message">${locked ? "Weekly data dumps cannot overwrite this brand." : "This brand can still be changed by approved imports."}</p>
      <div class="brand-source-note">
        <span>Dump brand</span>
        <strong>${html(sourceBrand || "Not provided")}</strong>
      </div>
    </div>
  `;
}

function renderProductHomeTab(item, context) {
  const { images, galleryImage, tagsText, readiness, activeStatus, stockQty, shadowCount, grossProfit, margin } = context;
  return `
    <div class="product-home-grid">
      <div class="product-home-side">
        <section class="product-image-panel">
          <div class="product-gallery-head">
            <div>
              ${sectionIconTitle("image", "Gallery")}
              <span>${images.length} image${images.length === 1 ? "" : "s"}</span>
            </div>
            <button class="button secondary compact-button" type="button" data-open-product-images="${item.id}">${withIcon("edit-3", "Edit")}</button>
          </div>
          <div class="product-main-image product-home-image">
            ${galleryImage ? `<img src="${html(galleryImage)}" alt="${html(item.title || item.sku)}" />` : `<div class="image-placeholder">No image</div>`}
          </div>
          <div class="product-image-rail">
            ${images.map((image, index) => `
              <button class="product-image-thumb ${image === galleryImage ? "active" : ""}" data-product-gallery-image="${html(image)}" data-product-id="${item.id}" aria-label="Show image ${index + 1}">
                <img src="${html(image)}" alt="${html(item.title || item.sku)} image ${index + 1}" />
              </button>
            `).join("") || `<span>No media</span>`}
          </div>
          <div class="product-gallery-foot">
            ${galleryImage ? `<a class="product-image-link" href="${html(galleryImage)}" target="_blank" rel="noopener">Open image</a>` : `<span>No product media yet</span>`}
            <button class="link-button" type="button" data-open-product-images="${item.id}">${withIcon("image", "Manage images")}</button>
          </div>
        </section>
        ${renderProductDimensionsCard(item)}
      </div>
      <div class="product-home-main">
        <div class="product-home-column">
          <section class="product-section-card product-section-blue">
            <div class="product-section-title">${sectionIconTitle("info", "General")}<span class="status ${item.active === false ? "inactive" : "active"}">${activeStatus}</span></div>
            <div class="product-row-fields">
              ${productFieldLabel("Internal title", "title", item)}
              ${renderBrandGuard(item)}
              ${productFieldLabel("Main category", "category", item)}
              ${productFieldLabel("Vendor category", "sourceCategory", item, { readonly: true })}
              ${productFieldLabel("Condition", "condition", item)}
              ${productFieldLabel("Tags", "tags", item)}
            </div>
            <div class="product-field-stack product-home-descriptions">
              ${productFieldLabel("Short description", "shortDescription", item, { textarea: true, rows: 3, className: "product-description-field" })}
              ${productFieldLabel("Long description", "longDescription", item, { textarea: true, rows: 6, className: "product-description-field" })}
              ${renderProductBulletSection(item)}
            </div>
          </section>
        </div>
        <div class="product-home-column">
          <section class="product-section-card product-section-green">
            <div class="product-section-title">${sectionIconTitle("truck", "Purchasing")}</div>
            <div class="product-row-fields">
              ${productFieldLabel("Supplier", "supplier", item)}
              ${productFieldLabel("Supplier code", "supplierCode", item)}
              ${productFieldLabel("Vendor SKU", "vendorSku", item)}
              ${productFieldLabel("Manufacturer", "manufacturer", item)}
              ${productFieldLabel("MFR part number", "mfrPartNumber", item)}
              ${productFieldLabel("Barcode / UPC", "barcode", item)}
            </div>
          </section>
          <section class="product-section-card product-section-teal">
            <div class="product-section-title">${sectionIconTitle("dollar-sign", "Pricing")}<span>${money(grossProfit)} profit</span></div>
            <div class="product-row-fields">
              ${productFieldLabel("Price", "price", item, { type: "number", step: "0.01" })}
              ${productFieldLabel("Cost", "cost", item, { type: "number", step: "0.01" })}
              ${productFieldLabel("MSRP", "msrp", item, { type: "number", step: "0.01" })}
              ${productFieldLabel("FOB", "fobPrice", item, { type: "number", step: "0.01" })}
            </div>
            <div class="summary-grid product-home-summary pricing-summary">
              <span><small>Margin</small><strong>${margin.toFixed(1)}%</strong></span>
              <span><small>Stock</small><strong>${countLabel(stockQty)}</strong></span>
              <span><small>Shadows</small><strong>${shadowCount}</strong></span>
              <span><small>Readiness</small><strong>${readiness.score}%</strong></span>
            </div>
          </section>
          <section class="product-section-card product-section-purple">
            <div class="product-section-title">${sectionIconTitle("fingerprint", "Identifiers")}</div>
            <div class="product-row-fields">
              ${productFieldLabel("External ID", "externalId", item)}
              ${productFieldLabel("Shopify ID", "shopifyId", item)}
              ${productFieldLabel("Shopify variant ID", "shopifyVariantId", item)}
              ${productFieldLabel("Shopify status", "shopifyStatus", item)}
              ${productFieldLabel("Shopify published at", "shopifyPublishedAt", item)}
              ${productFieldLabel("Shopify synced at", "shopifySyncedAt", item)}
              ${productFieldLabel("UNSPSC", "unspsc", item)}
              ${productFieldLabel("CTech ID", "ctechId", item)}
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
}

function openProductImagesModal(productId) {
  const item = productById(productId);
  if (!item) return;
  const editableImages = productEditableImageUrls(item);
  const defaultImage = item.defaultImage || item.default_image || editableImages[0] || "";
  pendingProductImageManager = {
    productId,
    images: editableImages.length ? editableImages : [""],
    defaultImage
  };
  renderProductImagesModal();
  $("#product-images-modal")?.classList.add("show");
  $("#product-images-modal")?.setAttribute("aria-hidden", "false");
}

function closeProductImagesModal() {
  pendingProductImageManager = { productId: null, images: [], defaultImage: "" };
  $("#product-images-modal")?.classList.remove("show");
  $("#product-images-modal")?.setAttribute("aria-hidden", "true");
}

function renderProductImagesModal() {
  const item = productById(pendingProductImageManager.productId);
  const content = $("#product-images-content");
  if (!content) return;
  if (!item) {
    content.innerHTML = `<p class="muted">Select a product first.</p>`;
    return;
  }
  const rows = pendingProductImageManager.images.length ? pendingProductImageManager.images : [""];
  const sourceImage = String(item.originalImage || item.original_image || "").trim();
  const sourceAlreadyIncluded = !sourceImage || rows.includes(sourceImage);
  content.innerHTML = `
    <div class="product-image-manager">
      <section class="product-image-manager-preview">
        <div class="product-main-image">
          ${pendingProductImageManager.defaultImage ? `<img src="${html(pendingProductImageManager.defaultImage)}" alt="${html(item.title || item.sku)}" />` : `<div class="image-placeholder">No default image</div>`}
        </div>
        <div class="product-image-manager-meta">
          <strong>${html(item.sku || "")}</strong>
          <span>${rows.filter(Boolean).length} managed image${rows.filter(Boolean).length === 1 ? "" : "s"}</span>
        </div>
      </section>
      <section class="product-image-manager-list">
        <div class="product-image-manager-actions">
          <strong>Product images</strong>
          <button class="button secondary compact-button" type="button" data-add-product-image>Add image</button>
        </div>
        <div class="product-image-rows">
          ${rows.map((image, index) => `
            <article class="product-image-row">
              <div class="product-image-row-preview">
                ${image ? `<img src="${html(image)}" alt="${html(item.title || item.sku)} image ${index + 1}" />` : `<span>New</span>`}
              </div>
              <label>Image URL<input value="${html(image)}" data-product-image-url="${index}" placeholder="https://..." /></label>
              <div class="product-image-row-actions">
                <button type="button" class="button secondary compact-button" data-set-default-product-image="${index}" ${image && image === pendingProductImageManager.defaultImage ? "disabled" : ""}>Default</button>
                <button type="button" class="button secondary compact-button" data-remove-product-image="${index}">Remove</button>
              </div>
            </article>
          `).join("")}
        </div>
        ${sourceImage ? `
          <div class="product-source-image-note">
            <div>
              <strong>Source reference image</strong>
              <span>${sourceAlreadyIncluded ? "Already included in product images." : "Available from the supplier feed."}</span>
            </div>
            ${sourceAlreadyIncluded ? "" : `<button class="button secondary compact-button" type="button" data-add-source-product-image="${html(sourceImage)}">Add source image</button>`}
          </div>
        ` : ""}
      </section>
    </div>
  `;
}

function syncProductImageModalInputs() {
  $$("[data-product-image-url]").forEach((input) => {
    const index = Number(input.dataset.productImageUrl);
    pendingProductImageManager.images[index] = input.value.trim();
  });
  pendingProductImageManager.images = pendingProductImageManager.images.map((value) => String(value || "").trim());
  if (!pendingProductImageManager.images.includes(pendingProductImageManager.defaultImage)) {
    pendingProductImageManager.defaultImage = pendingProductImageManager.images.find(Boolean) || "";
  }
}

async function saveProductImagesModal() {
  const item = productById(pendingProductImageManager.productId);
  if (!item) return;
  syncProductImageModalInputs();
  const images = [...new Set(pendingProductImageManager.images.filter(Boolean))];
  const defaultImage = pendingProductImageManager.defaultImage || images[0] || "";
  const secondaryImages = images.filter((image) => image !== defaultImage);
  const result = await api(`/api/inventory/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ defaultImage, images: secondaryImages })
  });
  selectedProductId = result.item.id;
  selectedProductGalleryImageById[result.item.id] = defaultImage;
  setState(result.state || { ...state, inventory: state.inventory.map((row) => row.id === result.item.id ? result.item : row), summary: result.summary });
  closeProductImagesModal();
  toast("Product images updated.");
}

function openProductBulletsModal(productId) {
  const item = productById(productId);
  if (!item) return;
  const bullets = productBulletPoints(item);
  pendingProductBulletManager = {
    productId,
    bulletPoints: bullets.length ? bullets : ["", "", "", "", ""]
  };
  renderProductBulletsModal();
  $("#product-bullets-modal")?.classList.add("show");
  $("#product-bullets-modal")?.setAttribute("aria-hidden", "false");
}

function closeProductBulletsModal() {
  pendingProductBulletManager = { productId: null, bulletPoints: [] };
  $("#product-bullets-modal")?.classList.remove("show");
  $("#product-bullets-modal")?.setAttribute("aria-hidden", "true");
}

function renderProductBulletsModal() {
  const item = productById(pendingProductBulletManager.productId);
  const content = $("#product-bullets-content");
  if (!content) return;
  if (!item) {
    content.innerHTML = `<p class="muted">Select a product first.</p>`;
    return;
  }
  const rows = pendingProductBulletManager.bulletPoints.length ? pendingProductBulletManager.bulletPoints : ["", "", "", "", ""];
  content.innerHTML = `
    <div class="product-bullet-manager">
      <div class="product-bullet-manager-intro">
        <strong>${html(item.sku || "")}</strong>
        <span>Reusable product highlights for marketplace metafields, attributes, or product descriptions.</span>
      </div>
      <div class="product-bullet-rows">
        ${rows.map((bullet, index) => `
          <article class="product-bullet-row">
            <span>${index + 1}</span>
            <input value="${html(bullet)}" data-product-bullet-input="${index}" placeholder="Add a product highlight" />
            <button type="button" class="button secondary compact-button" data-remove-product-bullet="${index}">Remove</button>
          </article>
        `).join("")}
      </div>
      <button type="button" class="button secondary" data-add-product-bullet>Add bullet point</button>
    </div>
  `;
}

function syncProductBulletModalInputs() {
  $$("[data-product-bullet-input]").forEach((input) => {
    pendingProductBulletManager.bulletPoints[Number(input.dataset.productBulletInput)] = input.value.trim();
  });
}

async function saveProductBulletsModal() {
  const item = productById(pendingProductBulletManager.productId);
  if (!item) return;
  syncProductBulletModalInputs();
  const bulletPoints = pendingProductBulletManager.bulletPoints.map((value) => String(value || "").trim()).filter(Boolean);
  const result = await api(`/api/inventory/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ bulletPoints })
  });
  selectedProductId = result.item.id;
  setState(result.state || { ...state, inventory: state.inventory.map((row) => row.id === result.item.id ? result.item : row), summary: result.summary });
  closeProductBulletsModal();
  toast("Bullet points updated.");
}

function renderProductContentPage() {
  const item = productById(selectedProductId);
  const detail = $("#product-profile-page");
  if (!item) {
    detail.innerHTML = `<div class="empty-state">Select a product to edit product content.</div>`;
    return;
  }

  const grossProfit = Number(item.price || 0) - Number(item.cost || 0);
  const margin = Number(item.price || 0) ? (grossProfit / Number(item.price || 0)) * 100 : 0;
  const images = productImageUrls(item);
  const tagsText = (item.tags || []).join(", ");
  const defaultImage = item.defaultImage || item.default_image || images[0] || "";
  const selectedGalleryImage = selectedProductGalleryImageById[item.id];
  const galleryImage = images.includes(selectedGalleryImage) ? selectedGalleryImage : defaultImage || images[0] || "";
  const activeStatus = item.active === false ? "Inactive source" : "Active source";
  const stockQty = Number(item.stockQty ?? item.qty ?? 0);
  const shadowCount = (item.shadowSkus || []).length;
  const readiness = productReadiness(item);
  const context = { images, defaultImage, galleryImage, tagsText, readiness, activeStatus, stockQty, shadowCount, grossProfit, margin };
  let activeTabContent = "";
  if (selectedProductWorkspaceTab === "shopify") {
    activeTabContent = renderMarketplaceTab(item, "shopify");
  } else if (selectedProductWorkspaceTab === "zoro") {
    activeTabContent = renderZoroTab(item);
  } else if (selectedProductWorkspaceTab === "shipping") {
    activeTabContent = renderShippingTab(item);
  } else if (selectedProductWorkspaceTab === "pricing") {
    activeTabContent = renderPricingTab(item, grossProfit, margin);
  } else if (selectedProductWorkspaceTab === "source") {
    activeTabContent = `
      <div class="product-tab-grid">
        <section class="product-panel span-2">
          <h3>Source and Compliance</h3>
          <div class="product-form-grid">
            ${productFieldLabel("External ID", "externalId", item)}
            ${productFieldLabel("UNSPSC", "unspsc", item)}
            ${productFieldLabel("Hazardous", "hazardous", item)}
            ${productFieldLabel("SDS URL", "sdsUrl", item)}
            ${productFieldLabel("Original SDS URL", "originalSdsUrl", item)}
            ${productFieldLabel("Country of origin", "countryOfOrigin", item)}
            ${productFieldLabel("Validated at", "validatedAt", item)}
            ${productFieldLabel("Stock status", "stockStatus", item)}
            ${productFieldLabel("Stock updated", "stockUpdatedAt", item)}
          </div>
        </section>
        <section class="product-panel span-2">
          <h3>Raw Product Manager Fields</h3>
          ${renderProductManagerFields(item)}
        </section>
      </div>
    `;
  } else if (selectedProductWorkspaceTab === "search") {
    activeTabContent = `
      <div class="product-tab-grid">
        <section class="product-panel span-2">
          <h3>Search and Content</h3>
          <div class="product-field-stack">
            ${productFieldLabel("Short description", "shortDescription", item, { textarea: true, rows: 3 })}
            ${productFieldLabel("Long description", "longDescription", item, { textarea: true, rows: 8 })}
            ${productFieldLabel("SEO keywords", "seoKeywords", item)}
            ${productFieldLabel("Wildcard search", "wildcardSearch", item, { textarea: true, rows: 4 })}
          </div>
        </section>
      </div>
    `;
  } else {
    selectedProductWorkspaceTab = "home";
    activeTabContent = renderProductHomeTab(item, context);
  }

  detail.innerHTML = `
    <div class="product-editor-page">
      <div class="product-workspace-head">
        <div class="product-workspace-title">
          <button class="text-button" data-view-jump="catalog">${withIcon("arrow-left", "Back to catalog")}</button>
          <div>
            <h2>Product <span>${html(item.marketplaceTitle || item.title || "Untitled product")}</span></h2>
            <div class="product-workspace-chips">
              <span>SKU ${html(item.sku)}</span>
              <span>${html(item.vendor || item.supplier || "No vendor")}</span>
              <span>${html(item.active === false ? "Inactive" : "Active")}</span>
              <span class="${item.brandLocked ? "brand-lock-chip" : "brand-lock-chip unlocked"}">${item.brandLocked ? "Brand locked" : "Brand unlocked"}</span>
              <span>${countLabel(stockQty)} available</span>
              ${renderReadinessPill(item)}
            </div>
          </div>
        </div>
        <div class="product-editor-actions">
          <button class="button secondary" data-select-product="${item.id}" data-product-target="inventory-full">${withIcon("warehouse", "Inventory")}</button>
          <button class="button" data-create-shadow="${item.id}">${withIcon("plus", "Create shadow")}</button>
        </div>
      </div>
      <div class="product-workspace-tabs">
        ${productTabButton("home", "Product Home")}
        ${productTabButton("shopify", "Shopify")}
        ${productTabButton("zoro", "Zoro")}
        ${productTabButton("shipping", "Shipping Preferences")}
        ${productTabButton("pricing", "Pricing Management")}
        ${productTabButton("source", "Source Details")}
        ${productTabButton("search", "Search Content")}
      </div>
      <div class="product-workspace-body">
        ${activeTabContent}
      </div>
    </div>
  `;
}
function findShadowSelection() {
  for (const product of state.inventory || []) {
    const shadow = (product.shadowSkus || []).find((item) => item.id === selectedShadowId);
    if (shadow) return { product, shadow };
  }
  return { product: null, shadow: null };
}

function marketplaceRequiredAttributes(marketplace = "") {
  const template = marketplaceTemplateFor(marketplace);
  if (template?.fieldDefinitions?.length) return template.fieldDefinitions.filter((field) => field.required !== false).map((field) => field.key);
  if (template?.requiredAttributes?.length) return template.requiredAttributes;
  const key = String(marketplace).toLowerCase();
  if (key.includes("temu")) return ["categoryId", "brandName", "bulletPoints", "packageQty", "material", "countryOfOrigin", "complianceWarning"];
  if (key.includes("ebay")) return ["categoryId", "conditionId", "itemSpecifics", "returnPolicy", "paymentPolicy", "fulfillmentPolicy"];
  if (key.includes("tiktok")) return ["categoryId", "productCertifications", "packageWeight", "packageDimensions", "deliveryOption"];
  if (key.includes("whatnot")) return ["category", "condition", "showTitle", "auctionStartPrice", "shippingWeight"];
  return ["categoryId", "listingTitle", "condition", "shippingTemplate"];
}

function marketplaceFields(marketplace = "") {
  const template = marketplaceTemplateFor(marketplace);
  if (template?.fieldDefinitions?.length) return template.fieldDefinitions;
  return marketplaceRequiredAttributes(marketplace).map((key) => ({ key, type: "text", options: [], required: true }));
}

function renderShadowAttributeInput(field, attributes, productId, shadowId) {
  const value = attributes[field.key] || "";
  const attrs = `data-shadow-attribute="${html(field.key)}" data-product-id="${productId}" data-shadow-id="${shadowId}"`;
  if (field.type === "textarea") return `<label>${html(field.key)}<textarea rows="3" ${attrs}>${html(value)}</textarea></label>`;
  if (field.type === "number") return `<label>${html(field.key)}<input type="number" value="${html(value)}" ${attrs} /></label>`;
  if (field.type === "boolean") {
    return `<label>${html(field.key)}<select ${attrs}><option value="" ${value === "" ? "selected" : ""}>Select</option><option value="true" ${String(value) === "true" ? "selected" : ""}>Yes</option><option value="false" ${String(value) === "false" ? "selected" : ""}>No</option></select></label>`;
  }
  if (field.type === "select" || field.type === "multi-select") {
    return `<label>${html(field.key)}<select ${attrs}><option value="">Select</option>${(field.options || []).map((option) => `<option value="${html(option)}" ${String(value) === String(option) ? "selected" : ""}>${html(option)}</option>`).join("")}</select></label>`;
  }
  return `<label>${html(field.key)}<input value="${html(value)}" ${attrs} /></label>`;
}

function marketplaceTemplateFor(marketplace = "") {
  const key = String(marketplace).toLowerCase();
  return (state.marketplaceTemplates || []).find((template) => {
    const name = String(template.marketplace || "").toLowerCase();
    return key === name || key.includes(name) || name.includes(key);
  });
}

function validateShadowListing(product, shadow) {
  const template = marketplaceTemplateFor(shadow.marketplace || shadow.company) || {};
  const attributes = shadow.marketplaceAttributes || {};
  const images = [product.defaultImage, ...(product.images || [])].filter(Boolean);
  const title = product.marketplaceTitle || product.title || "";
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });

  add("Shadow SKU", Boolean(shadow.shadowSku), "Required for marketplace listing identity.");
  add("Marketplace", Boolean(shadow.marketplace || shadow.company), "Choose which marketplace owns this shadow.");
  if (template.requirePrice !== false) add("Marketplace price", Number(shadow.price || 0) > 0, "Enter a sell price greater than zero.");
  if (template.requireHandlingTime !== false) add("Handling time", Number(shadow.handlingTimeDays || 0) >= 0, "Set handling time in days.");
  if (template.requireShippingProfile) add("Shipping profile", Boolean(shadow.shippingProfile || shadow.shippingService || shadow.shippingTemplateId), "Select a shipping profile, service, or template.");
  add("Sellable inventory", Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0) - Number(shadow.safetyQty || 0)) > 0, "Parent inventory after safety qty must be available.");
  add("Title", Boolean(title), "Parent product needs a marketplace title or internal title.");
  if (Number(template.titleMaxLength || 0) > 0) add("Title length", title.length <= Number(template.titleMaxLength), `Limit ${template.titleMaxLength} characters.`);
  add("Images", images.length >= Number(template.minImages ?? 1), `Requires at least ${Number(template.minImages ?? 1)} image(s).`);
  for (const attribute of template.requiredAttributes || marketplaceRequiredAttributes(shadow.marketplace || shadow.company)) {
    add(attribute, Boolean(String(attributes[attribute] || "").trim()), "Required marketplace attribute.");
  }
  return checks;
}

function shadowsForTemplate(template) {
  const key = String(template?.marketplace || "").toLowerCase();
  const rows = [];
  for (const product of state.inventory || []) {
    for (const shadow of product.shadowSkus || []) {
      const marketplace = String(shadow.marketplace || shadow.company || "").toLowerCase();
      if (marketplace === key || marketplace.includes(key) || key.includes(marketplace)) {
        rows.push({ product, shadow, validation: validateShadowListing(product, shadow) });
      }
    }
  }
  return rows;
}

function sampleProductForTemplate(template) {
  const rows = shadowsForTemplate(template);
  if (rows[0]) return rows[0];
  const product = (state.inventory || [])[0];
  if (!product) return null;
  const shadow = {
    id: "template-preview",
    parentSku: product.sku,
    shadowSku: `${product.sku}-${template.marketplace}`,
    marketplace: template.marketplace,
    price: product.price || 0,
    handlingTimeDays: 2,
    safetyQty: 0,
    maxSellableQty: 0,
    shippingProfile: "",
    shippingService: "",
    shippingTemplateId: "",
    marketplaceAttributes: {}
  };
  return { product, shadow, validation: validateShadowListing(product, shadow), previewOnly: true };
}

function renderTemplatePreviewPage() {
  const template = (state.marketplaceTemplates || []).find((row) => row.id === selectedTemplateId);
  const target = $("#template-profile-page");
  if (!template) {
    target.innerHTML = `<div class="empty-state">Select a marketplace template.</div>`;
    return;
  }
  const linkedRows = shadowsForTemplate(template);
  const preview = sampleProductForTemplate(template);
  const previewValidation = preview ? validateShadowListing(preview.product, preview.shadow) : [];
  const readyRows = linkedRows.filter((row) => row.validation.every((check) => check.ok));

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="catalog">Back to catalog</button>
        <div>
          <p class="eyebrow">Marketplace Template</p>
          <h2>${html(template.marketplace)}</h2>
          <p class="muted">${html(template.notes || "Template used to validate marketplace shadow SKUs.")}</p>
        </div>
        <div class="profit-pill">
          <small>Ready shadows</small>
          <strong>${readyRows.length}/${linkedRows.length}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Template Rules</h3>
          <div class="summary-grid">
            <span><small>Required attributes</small><strong>${(template.requiredAttributes || []).length}</strong></span>
            <span><small>Title max</small><strong>${Number(template.titleMaxLength || 0)}</strong></span>
            <span><small>Min images</small><strong>${Number(template.minImages || 0)}</strong></span>
            <span><small>Price required</small><strong>${template.requirePrice ? "Yes" : "No"}</strong></span>
            <span><small>Handling required</small><strong>${template.requireHandlingTime ? "Yes" : "No"}</strong></span>
            <span><small>Shipping required</small><strong>${template.requireShippingProfile ? "Yes" : "No"}</strong></span>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Required Attribute Preview</h3>
          <div class="validation-grid">
            ${(template.fieldDefinitions || []).map((field) => `
              <div class="validation-item ${preview?.shadow.marketplaceAttributes?.[field.key] ? "ok" : "missing"}">
                <strong>${html(field.key)} (${html(field.type || "text")})</strong>
                <small>${(field.options || []).length ? `Options: ${html(field.options.join(", "))}` : "No option list configured"}</small>
              </div>
            `).join("") || `<p class="muted">No attributes configured.</p>`}
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Category Mappings</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Internal category</th><th>Marketplace category</th><th>Marketplace ID</th></tr></thead>
              <tbody>
                ${(template.categoryMappings || []).map((mapping) => `
                  <tr><td>${html(mapping.internalCategory)}</td><td>${html(mapping.marketplaceCategory)}</td><td>${html(mapping.marketplaceCategoryId)}</td></tr>
                `).join("") || `<tr><td colspan="3">No category mappings configured.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Live Data Preview</h3>
          ${preview ? `
            <div class="summary-grid">
              <span><small>Parent SKU</small><strong>${html(preview.product.sku)}</strong></span>
              <span><small>Shadow SKU</small><strong>${html(preview.shadow.shadowSku)}</strong></span>
              <span><small>Title length</small><strong>${String(preview.product.marketplaceTitle || preview.product.title || "").length}</strong></span>
              <span><small>Images</small><strong>${[preview.product.defaultImage, ...(preview.product.images || [])].filter(Boolean).length}</strong></span>
              <span><small>Price</small><strong>${money(preview.shadow.price || 0)}</strong></span>
              <span><small>Handling</small><strong>${Number(preview.shadow.handlingTimeDays || 0)} days</strong></span>
            </div>
            <div class="validation-grid template-preview-validation">
              ${previewValidation.map((check) => `
                <div class="validation-item ${check.ok ? "ok" : "missing"}">
                  <strong>${check.ok ? "OK" : "Missing"}: ${html(check.label)}</strong>
                  <small>${html(check.detail || "")}</small>
                </div>
              `).join("")}
            </div>
          ` : `<p class="muted">No products available for preview.</p>`}
        </section>

        <section class="full-card span-2">
          <h3>Shadow SKUs Using This Template</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Shadow SKU</th><th>Parent SKU</th><th>Status</th><th>Validation</th><th>Price</th><th>Handling</th></tr></thead>
              <tbody>
                ${linkedRows.map((row) => {
                  const ready = row.validation.every((check) => check.ok);
                  return `
                    <tr>
                      <td><button class="order-link" data-select-shadow="${row.shadow.id}" data-parent-product="${row.product.id}">${html(row.shadow.shadowSku)}</button></td>
                      <td>${html(row.product.sku)}</td>
                      <td><span class="status ${String(row.shadow.status || "draft").toLowerCase()}">${html(row.shadow.status || "Draft")}</span></td>
                      <td><span class="status ${ready ? "active" : "hold"}">${ready ? "Ready" : `${row.validation.filter((check) => check.ok).length}/${row.validation.length}`}</span></td>
                      <td>${money(row.shadow.price || 0)}</td>
                      <td>${Number(row.shadow.handlingTimeDays || 0)} days</td>
                    </tr>
                  `;
                }).join("") || `<tr><td colspan="6">No shadow SKUs use this template yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderShadowSkuPage() {
  const { product, shadow } = findShadowSelection();
  const target = $("#shadow-profile-page");
  if (!product || !shadow) {
    target.innerHTML = `<div class="empty-state">Select a shadow SKU to see marketplace listing details.</div>`;
    return;
  }
  const available = Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0) - Number(shadow.safetyQty || 0));
  const sellable = Number(shadow.maxSellableQty || 0) > 0 ? Math.min(available, Number(shadow.maxSellableQty || 0)) : available;
  const attributes = shadow.marketplaceAttributes || {};
  const requiredAttributes = marketplaceRequiredAttributes(shadow.marketplace || shadow.company);
  const template = marketplaceTemplateFor(shadow.marketplace || shadow.company);
  const fields = marketplaceFields(shadow.marketplace || shadow.company);
  const validation = validateShadowListing(product, shadow);
  const readyCount = validation.filter((item) => item.ok).length;
  const ready = readyCount === validation.length;

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-select-product="${product.id}" data-product-target="product-full">Back to parent product</button>
        <div>
          <p class="eyebrow">${html(shadow.marketplace || "Marketplace shadow")}</p>
          <h2>${html(shadow.shadowSku)}</h2>
          <p class="muted">Parent ${html(product.sku)} / shares product content</p>
        </div>
        <div class="profit-pill">
          <small>Validation</small>
          <strong>${ready ? "Ready" : `${readyCount}/${validation.length}`}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <div class="section-head">
            <h3>Listing Validation</h3>
            <span class="status ${ready ? "active" : "hold"}">${ready ? "Ready to sync" : "Needs work"}</span>
          </div>
          <div class="validation-grid">
            ${validation.map((check) => `
              <div class="validation-item ${check.ok ? "ok" : "missing"}">
                <strong>${check.ok ? "OK" : "Missing"}: ${html(check.label)}</strong>
                <small>${html(check.detail || "")}</small>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Inherited Product Content</h3>
          <div class="summary-grid">
            <span><small>Parent SKU</small><strong>${html(product.sku)}</strong></span>
            <span><small>Title</small><strong>${html(product.marketplaceTitle || product.title || "")}</strong></span>
            <span><small>Brand</small><strong>${html(product.brand || "n/a")}</strong></span>
            <span><small>Main category</small><strong>${html(product.category || "n/a")}</strong></span>
            <span><small>Vendor category</small><strong>${html(product.sourceCategory || product.vendorCategory || "n/a")}</strong></span>
            <span><small>Manufacturer</small><strong>${html(product.manufacturer || "n/a")}</strong></span>
            <span><small>Vendor SKU</small><strong>${html(product.vendorSku || "n/a")}</strong></span>
          </div>
        </section>

        <section class="full-card">
          <h3>Marketplace Listing</h3>
          <div class="edit-stack">
            <label>Shadow SKU<input value="${html(shadow.shadowSku || "")}" data-shadow-field="shadowSku" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Marketplace<input value="${html(shadow.marketplace || "")}" data-shadow-field="marketplace" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Price<input type="number" step="0.01" value="${Number(shadow.price || 0)}" data-shadow-field="price" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Status<select data-shadow-field="status" data-product-id="${product.id}" data-shadow-id="${shadow.id}">
              ${["Draft", "Active", "Paused"].map((status) => `<option ${String(shadow.status || "Draft") === status ? "selected" : ""}>${status}</option>`).join("")}
            </select></label>
          </div>
        </section>

        <section class="full-card">
          <h3>Inventory Controls</h3>
          <div class="edit-stack">
            <label>Safety qty<input type="number" min="0" value="${Number(shadow.safetyQty || 0)}" data-shadow-field="safetyQty" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Max sellable qty<input type="number" min="0" value="${Number(shadow.maxSellableQty || 0)}" data-shadow-field="maxSellableQty" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Inventory policy<select data-shadow-field="inventoryPolicy" data-product-id="${product.id}" data-shadow-id="${shadow.id}">
              ${["Share parent inventory", "Limit by safety qty", "Manual marketplace qty"].map((policy) => `<option ${String(shadow.inventoryPolicy || "Share parent inventory") === policy ? "selected" : ""}>${policy}</option>`).join("")}
            </select></label>
          </div>
          <div class="pnl-strip">
            <span><small>Parent available</small><strong>${Number(product.qty || 0) - Number(product.reserved || 0)}</strong></span>
            <span><small>Safety held</small><strong>${Number(shadow.safetyQty || 0)}</strong></span>
            <span><small>Sellable</small><strong>${sellable}</strong></span>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Shipping Options</h3>
          <div class="form-grid">
            <label>Handling time days<input type="number" min="0" value="${Number(shadow.handlingTimeDays || 0)}" data-shadow-field="handlingTimeDays" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Shipping profile<input value="${html(shadow.shippingProfile || "")}" data-shadow-field="shippingProfile" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Shipping service<input value="${html(shadow.shippingService || "")}" data-shadow-field="shippingService" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Template ID<input value="${html(shadow.shippingTemplateId || "")}" data-shadow-field="shippingTemplateId" data-product-id="${product.id}" data-shadow-id="${shadow.id}" /></label>
            <label>Free shipping<select data-shadow-field="freeShipping" data-product-id="${product.id}" data-shadow-id="${shadow.id}">
              <option value="false" ${shadow.freeShipping ? "" : "selected"}>No</option>
              <option value="true" ${shadow.freeShipping ? "selected" : ""}>Yes</option>
            </select></label>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Required Marketplace Attributes</h3>
          <p class="muted">${template ? `Using ${html(template.marketplace)} template.` : "Using fallback template."}</p>
          <div class="form-grid">
            ${fields.map((field) => renderShadowAttributeInput(field, attributes, product.id, shadow.id)).join("")}
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Marketplace Content Overrides</h3>
          <div class="edit-stack">
            <label>Override title<input value="${html(shadow.contentOverrides?.title || "")}" data-shadow-override="title" data-product-id="${product.id}" data-shadow-id="${shadow.id}" placeholder="${html(product.marketplaceTitle || product.title || "")}" /></label>
            <label>Override short description<textarea rows="3" data-shadow-override="shortDescription" data-product-id="${product.id}" data-shadow-id="${shadow.id}">${html(shadow.contentOverrides?.shortDescription || "")}</textarea></label>
            <label>Override long description<textarea rows="5" data-shadow-override="longDescription" data-product-id="${product.id}" data-shadow-id="${shadow.id}">${html(shadow.contentOverrides?.longDescription || "")}</textarea></label>
            <label>Override image URLs<textarea rows="4" data-shadow-override="imageUrls" data-product-id="${product.id}" data-shadow-id="${shadow.id}">${html((shadow.contentOverrides?.imageUrls || []).join("\n"))}</textarea></label>
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Sync History and Timeline</h3>
          <div class="timeline">
            ${[...(shadow.timeline || []), ...(shadow.syncHistory || []).map((run) => ({ ...run, type: "sync", title: `Sync ${run.status}`, message: run.message }))].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map((event) => `
              <article class="timeline-event ${html(event.type || "edited")}">
                <span class="timeline-dot"></span>
                <div>
                  <strong>${html(event.title || "Shadow updated")}</strong>
                  <p>${html(event.message || "")}</p>
                  <small>${html(event.user || "Luis")} / ${dateLabel(event.createdAt)}</small>
                </div>
              </article>
            `).join("") || `<p class="muted">No shadow timeline yet.</p>`}
          </div>
        </section>

        <section class="full-card span-2">
          <h3>Notes</h3>
          <textarea data-shadow-field="notes" data-product-id="${product.id}" data-shadow-id="${shadow.id}">${html(shadow.notes || "")}</textarea>
        </section>
      </div>
    </div>
  `;
}

function renderInventoryProductPage() {
  const item = productById(selectedProductId);
  const target = $("#inventory-profile-page");
  if (!item) {
    target.innerHTML = `<div class="empty-state">Select an inventory item to view details.</div>`;
    return;
  }
  const available = Number(item.qty || 0) - Number(item.reserved || 0);
  const grossProfit = Number(item.price || 0) - Number(item.cost || 0);
  const ledger = (state.inventoryLedger || []).filter((row) => row.productId === item.id || row.sku === item.sku).slice(0, 12);
  const serialUnits = Array.isArray(item.serialUnits) ? item.serialUnits : [];
  const warehouseStock = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="catalog">Back to catalog</button>
        <div>
          <p class="eyebrow">Inventory</p>
          <h2>${html(item.sku)}</h2>
          <p class="muted">${html(item.title || item.marketplaceTitle || "Untitled product")}</p>
        </div>
        <div class="profit-pill">
          <small>Available</small>
          <strong>${available}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Stock Position</h3>
          <div class="summary-grid">
            <span><small>On hand</small><strong>${Number(item.qty || 0)}</strong></span>
            <span><small>Reserved</small><strong>${Number(item.reserved || 0)}</strong></span>
            <span><small>Available</small><strong>${available}</strong></span>
            <span><small>Reorder point</small><strong>${Number(item.reorderPoint || 0)}</strong></span>
            <span><small>Vendor</small><strong>${html(item.vendor || "No vendor")}</strong></span>
            <span><small>Status</small><strong>${html(item.status || "Draft")}</strong></span>
            <span><small>Supplier stock</small><strong>${Number(item.stockQty ?? item.qty ?? 0)}</strong></span>
            <span><small>Supplier status</small><strong>${html(item.stockStatus || "Unknown")}</strong></span>
            <span><small>Stock updated</small><strong>${html(item.stockUpdatedAt || "Unknown")}</strong></span>
            <span><small>Supplier code</small><strong>${html(item.supplierCode || "n/a")}</strong></span>
          </div>
        </section>
        <section class="full-card">
          <h3>Inventory Controls</h3>
          <p class="muted">Stock is now managed by warehouse and location. Use the warehouse stock table to edit on hand, reserved, and reorder values.</p>
        </section>
        <section class="full-card">
          <h3>Costing</h3>
          <div class="edit-stack">
            <label>Cost<input type="number" step="0.01" value="${item.cost || 0}" data-product-field="cost" data-product-id="${item.id}" /></label>
            <label>Price<input type="number" step="0.01" value="${item.price || 0}" data-product-field="price" data-product-id="${item.id}" /></label>
            <label>FOB price<input type="number" step="0.01" value="${item.fobPrice || 0}" data-product-field="fobPrice" data-product-id="${item.id}" /></label>
            <label>Vendor<input value="${html(item.vendor || "")}" data-product-field="vendor" data-product-id="${item.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Warehouse Stock</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Warehouse</th><th>Default bin</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Reorder point</th><th>Updated</th></tr></thead>
              <tbody>
                ${(state.warehouses || []).map((warehouse) => {
                  const stock = warehouseStock.find((row) => row.warehouseId === warehouse.id) || {
                    warehouseId: warehouse.id,
                    warehouseName: warehouse.name,
                    locationBin: ((warehouse.bins || []).find((bin) => bin.isDefault) || (warehouse.bins || [])[0] || {}).code || "",
                    qty: 0,
                    reserved: 0,
                    reorderPoint: 0,
                    updatedAt: ""
                  };
                  const availableStock = Number(stock.qty || 0) - Number(stock.reserved || 0);
                  return `
                    <tr>
                      <td><button class="order-link" data-select-warehouse="${warehouse.id}">${html(warehouse.name)}</button></td>
                      <td><input value="${html(stock.locationBin || "")}" data-warehouse-stock-field="locationBin" data-product-id="${item.id}" data-warehouse-id="${warehouse.id}" /></td>
                      <td><input type="number" min="0" value="${Number(stock.qty || 0)}" data-warehouse-stock-field="qty" data-product-id="${item.id}" data-warehouse-id="${warehouse.id}" /></td>
                      <td><input type="number" min="0" value="${Number(stock.reserved || 0)}" data-warehouse-stock-field="reserved" data-product-id="${item.id}" data-warehouse-id="${warehouse.id}" /></td>
                      <td><span class="status ${availableStock <= Number(stock.reorderPoint || 0) ? "hold" : "active"}">${availableStock}</span></td>
                      <td><input type="number" min="0" value="${Number(stock.reorderPoint || 0)}" data-warehouse-stock-field="reorderPoint" data-product-id="${item.id}" data-warehouse-id="${warehouse.id}" /></td>
                      <td>${stock.updatedAt ? simpleDate(stock.updatedAt) : "Not set"}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Supplier Stock Feed</h3>
          <div class="form-grid">
            <label>Supplier stock qty<input type="number" min="0" value="${item.stockQty ?? item.qty ?? 0}" data-product-field="stockQty" data-product-id="${item.id}" /></label>
            <label>Supplier stock status<input value="${html(item.stockStatus || "")}" data-product-field="stockStatus" data-product-id="${item.id}" /></label>
            <label>Supplier stock updated<input value="${html(item.stockUpdatedAt || "")}" data-product-field="stockUpdatedAt" data-product-id="${item.id}" /></label>
            <label>CTech last export<input value="${html(item.ctechIdLastExport || "")}" data-product-field="ctechIdLastExport" data-product-id="${item.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Inventory Value</h3>
          <div class="pnl-strip">
            <span><small>On-hand cost</small><strong>${money(Number(item.cost || 0) * Number(item.qty || 0))}</strong></span>
            <span><small>Available sales value</small><strong>${money(Number(item.price || 0) * available)}</strong></span>
            <span><small>Available gross profit</small><strong>${money(grossProfit * available)}</strong></span>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Stock Ledger</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Warehouse</th><th>Reference</th><th>Qty change</th><th>On hand</th><th>Reserved</th><th>Reason</th><th>User</th></tr></thead>
              <tbody>
                ${ledger.map((row) => `
                  <tr>
                    <td>${dateLabel(row.createdAt)}</td>
                    <td>${html(row.type || "adjustment")}</td>
                    <td>${html(row.warehouseName || row.locationBin || "Global")}</td>
                    <td>${html(row.referenceNumber || row.source || "")}</td>
                    <td><strong>${Number(row.quantityChange || 0) > 0 ? "+" : ""}${Number(row.quantityChange || 0)}</strong></td>
                    <td>${Number(row.qtyBefore || 0)} -> ${Number(row.qtyAfter || 0)}</td>
                    <td>${Number(row.reservedBefore || 0)} -> ${Number(row.reservedAfter || 0)}</td>
                    <td>${html(row.reason || "")}${row.locationBin ? `<small>Bin ${html(row.locationBin)}</small>` : ""}${(row.serials || []).length ? `<small>${(row.serials || []).map((serial) => html(serial.serialNumber)).join(", ")}</small>` : ""}</td>
                    <td>${html(row.user || "Luis")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="9">No stock movement yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Serialized Units</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Serial</th><th>Status</th><th>PO</th><th>Vendor code</th><th>Received</th><th>Type</th><th>Bin</th><th>Action</th></tr></thead>
              <tbody>
                ${serialUnits.map((serial) => `
                  <tr>
                    <td><strong>${html(serial.serialNumber)}</strong></td>
                    <td><span class="status ${html(serial.status || "active")}">${html(serial.status || "available")}</span></td>
                    <td>${html(serial.poNumber || "")}</td>
                    <td>${html(serial.vendorCode || "")}</td>
                    <td>${simpleDate(serial.receivedAt)}</td>
                    <td>${serial.noSerial ? "Auto generated" : "Manufacturer serial"}</td>
                    <td>${html(serial.locationBin || "Unassigned")}</td>
                    <td>
                      <div class="action-menu">
                        <button class="icon-button" data-action-menu="serial-${serial.id}" aria-label="Open serial actions">...</button>
                        <div class="action-popover" data-menu-for="serial-${serial.id}">
                          <button data-serial-action="available" data-product-id="${item.id}" data-serial-id="${serial.id}">Set available</button>
                          <button data-serial-action="reserved" data-product-id="${item.id}" data-serial-id="${serial.id}">Reserve unit</button>
                          <button data-serial-action="sold" data-product-id="${item.id}" data-serial-id="${serial.id}">Mark sold</button>
                          <button data-serial-action="quarantine" data-product-id="${item.id}" data-serial-id="${serial.id}">Quarantine</button>
                          <button data-serial-action="returned" data-product-id="${item.id}" data-serial-id="${serial.id}">Return to vendor</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                `).join("") || `<tr><td colspan="8">No serialized units received yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}

function groupBy(list, keyFn) {
  return list.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function renderReports() {
  const orders = state.orders;
  const sales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const productCost = orders.reduce((sum, order) => sum + Number(order.productCost || 0), 0);
  const fees = orders.reduce((sum, order) => sum + Number(order.marketplaceFees || 0), 0);
  const shipping = orders.reduce((sum, order) => sum + Number(order.shippingCost || 0), 0);
  const refunds = orders.reduce((sum, order) => sum + Number(order.refundAmount || 0), 0) + (state.returns || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const profit = sales - productCost - fees - shipping - refunds;

  $("#report-sales").textContent = money(sales);
  $("#report-profit").textContent = money(profit);
  $("#report-returns").textContent = String((state.returns || []).length);
  $("#report-cancellations").textContent = String((state.cancellations || []).length);

  const sourceGroups = groupBy(orders, (order) => order.source);
  const maxSourceSales = Math.max(1, ...Object.values(sourceGroups).map((sourceOrders) => sourceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)));
  $("#source-performance").innerHTML = Object.entries(sourceGroups).map(([source, sourceOrders]) => {
    const sourceSales = sourceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    return `
      <div class="bar-row">
        <div>
          <strong>${source}</strong>
          <small>${sourceOrders.length} orders / ${money(sourceSales)}</small>
        </div>
        <span style="width:${Math.max(8, (sourceSales / maxSourceSales) * 100)}%"></span>
      </div>
    `;
  }).join("");

  $("#pnl-summary").innerHTML = [
    ["Gross sales", sales],
    ["Product cost", -productCost],
    ["Marketplace fees", -fees],
    ["Shipping cost", -shipping],
    ["Returns/refunds", -refunds],
    ["Estimated profit", profit]
  ].map(([label, value]) => `
    <div class="compact-row">
      <strong>${label}</strong>
      <strong>${money(value)}</strong>
    </div>
  `).join("");

  const productGroups = groupBy(orders.flatMap((order) => (order.items || []).map((item) => ({ ...item, source: order.source, profit: profitFor(order), orderTotal: Number(order.total || 0) }))), (item) => item.sku);
  $("#product-performance").innerHTML = `
    <table>
      <thead><tr><th>SKU</th><th>Product</th><th>Units</th><th>Sales</th><th>Est. profit</th></tr></thead>
      <tbody>
        ${Object.entries(productGroups).map(([sku, rows]) => `
          <tr>
            <td><strong>${sku}</strong></td>
            <td>${rows[0]?.title || ""}</td>
            <td>${rows.reduce((sum, row) => sum + Number(row.qty || 0), 0)}</td>
            <td>${money(rows.reduce((sum, row) => sum + Number(row.price || 0) * Number(row.qty || 0), 0))}</td>
            <td>${money(rows.reduce((sum, row) => sum + Number(row.profit || 0), 0))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const exceptions = [
    ...(state.returns || []).map((item) => ({ ...item, type: "Return" })),
    ...(state.cancellations || []).map((item) => ({ ...item, type: "Cancellation" }))
  ];
  $("#exception-list").innerHTML = exceptions.length
    ? exceptions.map((item) => `
      <div class="compact-row">
        <div>
          <strong>${item.type} / ${item.orderNumber}</strong>
          <small>${item.source} / ${item.reason} / ${item.sku}</small>
        </div>
        <strong>${money(item.amount)}</strong>
      </div>
    `).join("")
    : `<p class="muted">No returns or cancellations.</p>`;

}

function renderConnections() {
  $("#connection-grid").innerHTML = state.connections.map((connection) => {
    const isTemu = connection.name === "Temu";
    const isEbay = connection.name === "eBay";
    const temuAuthorized = isTemu && state.connectorState?.temuAuthorized;
    const ebayAuthorized = isEbay && state.connectorState?.ebayAuthorized;
    const connected = isEbay ? ebayAuthorized : connection.connected;
    const statusText = temuAuthorized
      ? `Authorized${state.connectorState.temuMallId ? ` / Mall ${state.connectorState.temuMallId}` : ""} / Last sync ${dateLabel(connection.lastSync)}`
      : ebayAuthorized
        ? `Authorized / ${state.connectorState?.ebayEnvironment || "production"} / Last sync ${dateLabel(connection.lastSync)}`
        : connected
          ? `Connected / Last sync ${dateLabel(connection.lastSync)}`
          : "Ready for marketplace credentials and channel settings.";
    const authBox = isTemu ? `
        <div class="auth-box">
          <label>Authorization code<input id="temu-auth-code" placeholder="Paste code from Temu redirect" /></label>
          <button class="button secondary" data-exchange-temu-code>Save token</button>
        </div>
      ` : isEbay ? `
        <div class="auth-box">
          <a class="button ${ebayAuthorized ? "secondary" : ""}" href="/auth/ebay/start">${ebayAuthorized ? "Reconnect eBay" : "Connect eBay"}</a>
          <p class="muted">Imports paid seller orders with eBay OAuth. Tokens stay on this PC.</p>
        </div>
      ` : "";
    const actionLabel = isTemu || isEbay ? "Sync orders" : connected ? "Sync now" : "Connect demo";
    return `
      <article class="connection-card">
        <div class="channel-card-head">
          <span class="channel-logo-frame">${channelLogoMarkup(connection, connection.name)}</span>
          <h2><button class="order-link product-name-link" data-select-channel="${connection.id}">${connection.name}</button></h2>
        </div>
        <p>${statusText}</p>
        <div class="summary-grid channel-mini-grid">
          <span><small>Default status</small><strong>${html(connection.settings?.defaultShadowStatus || "Draft")}</strong></span>
          <span><small>Inventory</small><strong>${connection.settings?.inventoryUpdateEnabled ? "On" : "Off"}</strong></span>
          <span><small>Orders</small><strong>${connection.settings?.orderDownloadEnabled ? "On" : "Off"}</strong></span>
        </div>
        ${authBox}
        <button class="button ${connected ? "secondary" : ""}" data-sync-source="${connection.name}">${actionLabel}</button>
        <button class="button secondary" data-select-channel="${connection.id}">Settings</button>
      </article>
    `;
  }).join("");
}

function renderChannelProfile() {
  const channel = (state.connections || []).find((row) => row.id === selectedChannelId);
  const target = $("#channel-profile-page");
  if (!channel) {
    target.innerHTML = `<div class="empty-state">Select a channel.</div>`;
    return;
  }
  const settings = channel.settings || {};
  const channelShadows = allShadowRows().filter((row) => String(row.shadow.marketplace || "").toLowerCase() === String(channel.name || "").toLowerCase());
  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="connections">Back to channels</button>
        <div>
          <p class="eyebrow">Marketplace Channel</p>
          <h2>${html(channel.name)}</h2>
          <p class="muted">${channel.connected ? "Connected" : "Not connected"} / ${html(channel.status || "inactive")}</p>
        </div>
        <div class="profit-pill">
          <small>Shadow SKUs</small>
          <strong>${channelShadows.length}</strong>
        </div>
      </div>
      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Branding</h3>
          <div class="brand-logo-editor">
            ${channel.logoDataUrl || channel.logoUrl
              ? `<img class="brand-logo-large" src="${html(channel.logoDataUrl || channel.logoUrl)}" alt="${html(channel.name)} logo" />`
              : `<div class="brand-logo-large brand-logo-placeholder">${html(String(channel.name || "?").slice(0, 1).toUpperCase())}</div>`}
            <label class="file-button">Upload channel logo<input type="file" accept="image/*" data-channel-logo-upload="${channel.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Channel Defaults</h3>
          <div class="form-grid">
            <label>Default shadow status<select data-channel-field="defaultShadowStatus" data-channel-id="${channel.id}">
              ${["Draft", "Active", "Paused"].map((status) => `<option ${settings.defaultShadowStatus === status ? "selected" : ""}>${status}</option>`).join("")}
            </select></label>
            <label>Default handling days<input type="number" min="0" value="${Number(settings.defaultHandlingTimeDays || 0)}" data-channel-field="defaultHandlingTimeDays" data-channel-id="${channel.id}" /></label>
            <label>Default safety qty<input type="number" min="0" value="${Number(settings.defaultSafetyQty || 0)}" data-channel-field="defaultSafetyQty" data-channel-id="${channel.id}" /></label>
            <label>Default max sellable qty<input type="number" min="0" value="${Number(settings.defaultMaxSellableQty || 0)}" data-channel-field="defaultMaxSellableQty" data-channel-id="${channel.id}" /></label>
            <label>Default shipping profile<input value="${html(settings.defaultShippingProfile || "")}" data-channel-field="defaultShippingProfile" data-channel-id="${channel.id}" /></label>
            <label>Default shipping service<input value="${html(settings.defaultShippingService || "")}" data-channel-field="defaultShippingService" data-channel-id="${channel.id}" /></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Automation Settings</h3>
          <div class="channel-toggle-grid">
            ${[
              ["inventoryUpdateEnabled", "Inventory updates"],
              ["priceUpdateEnabled", "Price updates"],
              ["orderDownloadEnabled", "Order downloads"],
              ["trackingUpdateEnabled", "Tracking updates"],
              ["cancellationNotificationEnabled", "Cancellation notifications"],
              ["autoCreateShadow", "Auto-create shadows"]
            ].map(([field, label]) => `
              <label><input type="checkbox" ${settings[field] ? "checked" : ""} data-channel-field="${field}" data-channel-id="${channel.id}" /> ${label}</label>
            `).join("")}
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Pricing Rules</h3>
          <div class="form-grid">
            <label>Price markup %<input type="number" step="0.01" value="${Number(settings.priceMarkupPercent || 0)}" data-channel-field="priceMarkupPercent" data-channel-id="${channel.id}" /></label>
            <label>Minimum margin %<input type="number" step="0.01" value="${Number(settings.minMarginPercent || 0)}" data-channel-field="minMarginPercent" data-channel-id="${channel.id}" /></label>
            <label>Rounding rule<select data-channel-field="roundingRule" data-channel-id="${channel.id}">
              ${["none", "nearest .99", "nearest .95", "round up"].map((rule) => `<option value="${rule}" ${settings.roundingRule === rule ? "selected" : ""}>${rule}</option>`).join("")}
            </select></label>
          </div>
        </section>
        <section class="full-card span-2">
          <h3>Channel Shadow SKUs</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>Shadow SKU</th><th>Parent</th><th>Status</th><th>Sync</th><th>Price</th><th>Safety</th></tr></thead>
              <tbody>
                ${channelShadows.map((row) => `
                  <tr>
                    <td><button class="order-link" data-select-shadow="${row.shadow.id}" data-parent-product="${row.product.id}">${html(row.shadow.shadowSku)}</button></td>
                    <td>${html(row.product.sku)}</td>
                    <td>${html(row.shadow.status)}</td>
                    <td>${html(row.shadow.syncStatus || "Not synced")}</td>
                    <td>${money(row.shadow.price || 0)}</td>
                    <td>${Number(row.shadow.safetyQty || 0)}</td>
                  </tr>
                `).join("") || `<tr><td colspan="6">No shadow SKUs for this channel yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}

function render() {
  renderMetrics();
  renderDashboardOrders();
  renderSyncLog();
  renderOrders();
  renderDrafts();
  renderReturnsManagement();
  renderCustomers();
  renderPurchaseOrders();
  renderCatalog();
  renderJobsPage();
  renderReports();
  renderConnections();
  renderTopbarActions();
  if ($("#order-full").classList.contains("active")) renderFullOrderPage();
  if ($("#draft-full").classList.contains("active")) renderDraftOrderPage();
  if ($("#drafts").classList.contains("active")) renderDrafts();
  if ($("#returns").classList.contains("active")) renderReturnsManagement();
  if ($("#return-full").classList.contains("active")) renderReturnProfilePage();
  if ($("#po-full").classList.contains("active")) renderPurchaseOrderProfile();
  if ($("#vendor-full").classList.contains("active")) renderVendorProfile();
  if ($("#brand-full").classList.contains("active")) renderBrandProfile();
  if ($("#warehouse-full").classList.contains("active")) renderWarehouseProfile();
  if ($("#product-full").classList.contains("active")) renderProductContentPage();
  if ($("#shadow-full").classList.contains("active")) renderShadowSkuPage();
  if ($("#template-full").classList.contains("active")) renderTemplatePreviewPage();
  if ($("#inventory-full").classList.contains("active")) renderInventoryProductPage();
  if ($("#channel-full").classList.contains("active")) renderChannelProfile();
  if ($("#customer-full").classList.contains("active")) renderCustomerProfile();
}

async function load() {
  setState(await api("/api/state"));
}

function lightweightState() {
  return {
    inventory: [],
    sourceCatalog: [],
    orders: [],
    orderDrafts: [],
    returns: [],
    customers: [],
    purchaseOrders: [],
    vendors: [],
    brands: [],
    warehouses: [],
    marketplaceTemplates: [],
    exportMappings: [],
    connections: [],
    importJobs: [],
    syncRuns: [],
    summary: {}
  };
}

function mergeExportMappingsState(result = {}) {
  const exportMappings = result.exportMappings || result.state?.exportMappings || [];
  if (!state) state = lightweightState();
  state = { ...state, exportMappings };
  if (!selectedExportMappingId || !exportMappings.some((template) => template.id === selectedExportMappingId)) {
    selectedExportMappingId = exportMappings[0]?.id || null;
  }
  return exportMappings;
}

async function loadExportMappingsOnly() {
  const result = await api("/api/export-mappings");
  mergeExportMappingsState(result);
  renderImportExportMappings();
}

async function confirmOrder(id) {
  const result = await api(`/api/orders/${id}/confirm`, { method: "POST" });
  selectedOrderId = id;
  setState(result.state);
  toast("Order confirmed and inventory updated.");
}

async function runOrderAction(id, action) {
  const result = await api(`/api/orders/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
  selectedOrderId = id;
  setState(result.state);
  toast(`Order ${labelStatus(result.order.status).toLowerCase()}.`);
}

function toggleOtherCarrierFields() {
  const isOther = $("#fulfillment-carrier")?.value === "Other";
  $("#fulfillment-carrier-name-wrap")?.toggleAttribute("hidden", !isOther);
  $("#fulfillment-tracking-url-wrap")?.toggleAttribute("hidden", !isOther);
  const carrierName = $("#fulfillment-carrier-name");
  const trackingUrl = $("#fulfillment-tracking-url");
  if (carrierName) carrierName.required = isOther;
  if (trackingUrl) trackingUrl.required = isOther;
}

function openFulfillmentModal(orderId) {
  const order = state.orders.find((row) => row.id === orderId);
  if (!order) return;
  fulfillmentOrderId = orderId;
  const items = orderItems(order);
  const savedCarrier = order.shippingCarrier || order.carrierName || "USPS";
  const warehouses = (state.warehouses || []).filter((warehouse) => warehouse.status !== "inactive");
  const selectedWarehouseId = order.fulfillmentWarehouseId || order.reservationWarehouseId || defaultReceivingWarehouse()?.id || warehouses[0]?.id || "";
  $("#fulfillment-order-id").value = orderId;
  $("#fulfillment-warehouse").innerHTML = warehouses.map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === selectedWarehouseId ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
  $("#fulfillment-warehouse").value = selectedWarehouseId;
  $("#fulfillment-carrier").value = ["USPS", "UPS", "FedEx"].includes(savedCarrier) ? savedCarrier : savedCarrier === "Other" || order.carrierName ? "Other" : "USPS";
  $("#fulfillment-tracking-number").value = order.trackingNumber || "";
  $("#fulfillment-carrier-name").value = order.carrierName && !["USPS", "UPS", "FedEx"].includes(order.carrierName) ? order.carrierName : "";
  $("#fulfillment-tracking-url").value = order.trackingUrl || "";
  $("#fulfillment-ship-date").value = order.shipDate || new Date().toISOString().slice(0, 10);
  $("#fulfillment-lines").innerHTML = items.map((item, index) => {
    const remaining = orderItemRemainingQty(order, item, index);
    return `
      <div class="manual-order-line">
        <label>SKU
          <input value="${html(item.sku || "")}" readonly />
        </label>
        <label>Title
          <input value="${html(item.title || item.sku || "")}" readonly />
        </label>
        <label>Ordered
          <input value="${Number(item.qty || 0)}" readonly />
        </label>
        <label>Remaining
          <input value="${remaining}" readonly />
        </label>
        <label>Fulfill now
          <input type="number" min="0" max="${remaining}" value="${remaining}" data-fulfillment-line-qty data-line-index="${index}" data-sku="${html(item.sku || "")}" data-title="${html(item.title || "")}" data-price="${Number(item.price || 0)}" data-cost="${Number(item.cost || 0)}" data-qty="${Number(item.qty || 0)}" />
        </label>
      </div>
    `;
  }).join("") || `<p class="muted">No line items on this order.</p>`;
  toggleOtherCarrierFields();
  $("#fulfillment-modal").classList.add("show");
  $("#fulfillment-modal").setAttribute("aria-hidden", "false");
}

function closeFulfillmentModal() {
  $("#fulfillment-modal")?.classList.remove("show");
  $("#fulfillment-modal")?.setAttribute("aria-hidden", "true");
  fulfillmentOrderId = null;
}

async function submitFulfillment(form) {
  const formData = new FormData(form);
  const orderId = formData.get("orderId") || fulfillmentOrderId;
  const carrier = String(formData.get("carrier") || "");
  const payload = {
    warehouseId: String(formData.get("warehouseId") || ""),
    carrier,
    carrierName: carrier === "Other" ? String(formData.get("carrierName") || "").trim() : carrier,
    trackingNumber: String(formData.get("trackingNumber") || "").trim(),
    trackingUrl: carrier === "Other" ? String(formData.get("trackingUrl") || "").trim() : "",
    shipDate: String(formData.get("shipDate") || ""),
    lines: collectModalLineItems("#fulfillment-lines", "data-fulfillment-line-qty").map((line) => ({
      sku: line.sku,
      title: line.title,
      qty: line.qtySelected,
      lineIndex: line.lineIndex
    }))
  };
  if (!payload.lines.length) throw new Error("Enter at least one line quantity to fulfill.");
  const result = await api(`/api/orders/${orderId}/fulfill`, { method: "POST", body: JSON.stringify(payload) });
  selectedOrderId = orderId;
  closeFulfillmentModal();
  setState(result.state);
  toast("Fulfillment saved and tracking added.");
}

function openOrderReserveModal(orderId) {
  const order = (state.orders || []).find((row) => row.id === orderId);
  if (!order) return;
  reserveOrderModalId = orderId;
  const warehouses = (state.warehouses || []).filter((warehouse) => warehouse.status !== "inactive");
  const preferred = order.reservationWarehouseId || defaultReceivingWarehouse()?.id || warehouses[0]?.id || "";
  $("#order-reserve-id").value = orderId;
  $("#order-reserve-qty").value = Number(order.qty || 1);
  $("#order-reserve-warehouse").innerHTML = warehouses.map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === preferred ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
  $("#order-reserve-warehouse").value = preferred;
  $("#order-reserve-modal")?.classList.add("show");
  $("#order-reserve-modal")?.setAttribute("aria-hidden", "false");
}

function closeOrderReserveModal() {
  $("#order-reserve-modal")?.classList.remove("show");
  $("#order-reserve-modal")?.setAttribute("aria-hidden", "true");
  reserveOrderModalId = null;
}

async function submitOrderReserve(form) {
  const formData = new FormData(form);
  const orderId = String(formData.get("orderId") || reserveOrderModalId || "");
  const payload = {
    warehouseId: String(formData.get("warehouseId") || ""),
    qty: Number(formData.get("qty") || 0),
    note: String(formData.get("note") || "").trim()
  };
  const result = await api(`/api/orders/${orderId}/reserve`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedOrderId = orderId;
  closeOrderReserveModal();
  setState(result.state);
  showView("order-full");
  toast("Inventory reserved.");
}

function openInventoryTransferModal(productId) {
  const item = (state.inventory || []).find((row) => row.id === productId);
  if (!item) return;
  transferProductId = productId;
  const warehouseRows = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
  const warehouses = (state.warehouses || []).filter((warehouse) => warehouse.status !== "inactive");
  const fromId = warehouseRows.find((row) => Number(row.qty || 0) - Number(row.reserved || 0) > 0)?.warehouseId || warehouses[0]?.id || "";
  const toId = warehouses.find((warehouse) => warehouse.id !== fromId)?.id || warehouses[0]?.id || "";
  $("#inventory-transfer-product-id").value = productId;
  $("#inventory-transfer-qty").value = 1;
  $("#inventory-transfer-bin").value = "";
  $("#inventory-transfer-from").innerHTML = warehouses.map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === fromId ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
  $("#inventory-transfer-to").innerHTML = warehouses.map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === toId ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
  $("#inventory-transfer-from").value = fromId;
  $("#inventory-transfer-to").value = toId;
  $("#inventory-transfer-modal")?.classList.add("show");
  $("#inventory-transfer-modal")?.setAttribute("aria-hidden", "false");
}

function closeInventoryTransferModal() {
  $("#inventory-transfer-modal")?.classList.remove("show");
  $("#inventory-transfer-modal")?.setAttribute("aria-hidden", "true");
  transferProductId = null;
}

async function submitInventoryTransfer(form) {
  const formData = new FormData(form);
  const productId = String(formData.get("productId") || transferProductId || "");
  const payload = {
    fromWarehouseId: String(formData.get("fromWarehouseId") || ""),
    toWarehouseId: String(formData.get("toWarehouseId") || ""),
    qty: Number(formData.get("qty") || 0),
    toLocationBin: String(formData.get("toLocationBin") || "").trim(),
    note: String(formData.get("note") || "").trim()
  };
  const result = await api(`/api/inventory/${productId}/transfers`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedProductId = productId;
  closeInventoryTransferModal();
  setState(result.state);
  showView("inventory-full");
  toast("Transfer completed.");
}

async function runSelectedOrderAction(action) {
  const ids = Array.from(selectedOrderIds);
  if (!ids.length) {
    toast("Select at least one order first.");
    return;
  }

  let lastResult = null;
  for (const id of ids) {
    lastResult = await api(`/api/orders/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
  }
  selectedOrderId = ids[0];
  if (lastResult?.state) setState(lastResult.state);
  toast(`${ids.length} order${ids.length === 1 ? "" : "s"} updated.`);
}

async function addOrderNote(id) {
  const note = $("#order-note-input")?.value.trim();
  if (!note) {
    toast("Add a note first.");
    return;
  }
  const result = await api(`/api/orders/${id}/notes`, { method: "POST", body: JSON.stringify({ note }) });
  selectedOrderId = id;
  setState(result.state);
  toast("Note added.");
}

function openPoDuplicateModal(duplicates, requestedOrderIds) {
  pendingPoCreateOrderIds = requestedOrderIds;
  duplicatePoTargetId = duplicates[0]?.po?.id || null;
  $("#po-duplicate-content").innerHTML = `
    <p>The selected order${requestedOrderIds.length === 1 ? "" : "s"} already ${requestedOrderIds.length === 1 ? "has" : "have"} linked open purchase order${duplicates.length === 1 ? "" : "s"}.</p>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>Order</th><th>Existing PO</th><th>Status</th></tr></thead>
        <tbody>
          ${duplicates.map((row) => `
            <tr>
              <td>${html(row.order.orderNumber)}</td>
              <td>${html(row.po.poNumber)}</td>
              <td>${html(row.po.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  $("#po-duplicate-modal").classList.add("show");
  $("#po-duplicate-modal").setAttribute("aria-hidden", "false");
}

function closePoDuplicateModal() {
  $("#po-duplicate-modal")?.classList.remove("show");
  $("#po-duplicate-modal")?.setAttribute("aria-hidden", "true");
}

function openExistingPoFromDuplicate() {
  if (!duplicatePoTargetId) return;
  selectedPoId = duplicatePoTargetId;
  closePoDuplicateModal();
  showView("po-full");
}

function findOpenPoDuplicates(orderIds) {
  const ids = new Set(orderIds);
  const duplicates = [];
  for (const order of state.orders.filter((row) => ids.has(row.id))) {
    const poIds = Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds : [];
    for (const poId of poIds) {
      const po = (state.purchaseOrders || []).find((row) => row.id === poId);
      if (po && !["closed", "canceled"].includes(String(po.status || "").toLowerCase())) {
        duplicates.push({ order, po });
      }
    }
  }
  return duplicates;
}

async function createPurchaseOrder(orderIds, options = {}) {
  const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
  if (!ids.length) {
    toast("Select at least one order.");
    return;
  }
  const duplicates = options.force ? [] : findOpenPoDuplicates(ids);
  if (duplicates.length) {
    openPoDuplicateModal(duplicates, ids);
    return;
  }
  const result = await api("/api/purchase-orders", {
    method: "POST",
    body: JSON.stringify({ orderIds: ids, forceDuplicate: Boolean(options.force) })
  });
  selectedOrderIds.clear();
  pendingPoCreateOrderIds = [];
  duplicatePoTargetId = null;
  setState(result.state);
  toast(`${result.purchaseOrder.poNumber} created.`);
  showView("purchasing");
}

async function syncSource(source) {
  const result = await api(`/api/sync/${encodeURIComponent(source)}`, { method: "POST" });
  setState(result.state);
  toast(`${source} sync complete.`);
}

async function exchangeTemuCode() {
  const input = $("#temu-auth-code");
  const code = input?.value.trim();
  if (!code) {
    toast("Paste the Temu authorization code first.");
    return;
  }
  const result = await api("/api/temu/exchange-code", { method: "POST", body: JSON.stringify({ code }) });
  setState(result.state);
  toast("Temu token saved.");
}

async function updateVendorField(input) {
  const vendor = state.vendors.find((row) => row.id === input.dataset.vendorId);
  if (!vendor) return;
  const field = input.dataset.vendorField;
  const numericFields = new Set(["leadTimeDays", "moq", "rating"]);
  const booleanFields = new Set(["submissionSettings.apiEnabled", "submissionSettings.ftpEnabled", "submissionSettings.emailEnabled", "submissionSettings.attachCsv", "submissionSettings.attachPdf"]);
  let value = numericFields.has(field) ? Number(input.value) : input.value;
  if (booleanFields.has(field)) value = input.checked;
  const result = await api(`/api/vendors/${vendor.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
  setState(result.state);
  toast("Vendor updated.");
}

async function updateBrandField(input) {
  const brand = state.brands.find((row) => row.id === input.dataset.brandId);
  if (!brand) return;
  const result = await api(`/api/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [input.dataset.brandField]: input.value })
  });
  setState(result.state);
  toast("Brand updated.");
}

async function createBrand() {
  const name = prompt("Brand name");
  if (!name?.trim()) return;
  const result = await api("/api/brands", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() })
  });
  selectedBrandId = result.brand.id;
  setState(result.state);
  showView("brand-full");
  toast("Brand created.");
}

async function createVendor() {
  openVendorModal();
}

function openWarehouseModal() {
  $("#warehouse-create-modal")?.classList.add("show");
  $("#warehouse-create-modal")?.setAttribute("aria-hidden", "false");
  $("#new-warehouse-name")?.focus();
}

function closeWarehouseModal() {
  $("#warehouse-create-modal")?.classList.remove("show");
  $("#warehouse-create-modal")?.setAttribute("aria-hidden", "true");
  $("#warehouse-create-form")?.reset();
}

async function submitWarehouseCreate(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    toast("Warehouse name is required.");
    return;
  }
  const payload = Object.fromEntries(formData.entries());
  payload.name = name;
  const result = await api("/api/warehouses", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  closeWarehouseModal();
  selectedWarehouseId = result.warehouse.id;
  setState(result.state);
  purchasingTab = "warehouses";
  showView("warehouse-full");
  toast("Warehouse created.");
}

function openShadowModal(productId) {
  const item = state.inventory.find((row) => row.id === productId);
  if (!item) return;
  shadowModalProductId = productId;
  const modal = $("#shadow-create-modal");
  const marketplaceSelect = $("#shadow-marketplace");
  const marketplaces = (state.connections || []).map((connection) => connection.name).filter(Boolean);
  marketplaceSelect.innerHTML = marketplaces.map((name) => `<option value="${html(name)}">${html(name)}</option>`).join("");
  const channel = state.connections?.[0] || {};
  const settings = channel.settings || {};
  $("#shadow-parent-sku").value = item.sku || "";
  $("#shadow-sku").value = `${item.sku || ""}-${marketplaces[0] || "Marketplace"}`;
  $("#shadow-price").value = Number(item.price || 0).toFixed(2);
  $("#shadow-handling-time").value = Number(settings.defaultHandlingTimeDays ?? 2);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  $("#shadow-sku").focus();
}

function closeShadowModal() {
  const modal = $("#shadow-create-modal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  $("#shadow-create-form")?.reset();
  shadowModalProductId = null;
}

async function submitShadowCreate(form) {
  if (!shadowModalProductId) return;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.price = Number(payload.price || 0);
  payload.handlingTimeDays = Number(payload.handlingTimeDays || 0);
  const result = await api(`/api/inventory/${shadowModalProductId}/shadows`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedProductId = result.item.id;
  closeShadowModal();
  setState(result.state);
  showView("product-full");
  toast(`${result.shadow.shadowSku} created.`);
}

async function bulkCreateShadows(productId) {
  const marketplaces = (state.marketplaceTemplates || []).map((template) => template.marketplace).filter(Boolean);
  if (!marketplaces.length) {
    toast("No marketplace templates found.");
    return;
  }
  const result = await api(`/api/inventory/${productId}/shadows-bulk`, {
    method: "POST",
    body: JSON.stringify({ marketplaces })
  });
  selectedProductId = result.item.id;
  setState(result.state);
  showView("product-full");
  toast(`Created ${result.created.length} shadow SKU${result.created.length === 1 ? "" : "s"}.`);
}

function openVendorModal() {
  const modal = $("#vendor-create-modal");
  modal?.classList.add("show");
  modal?.setAttribute("aria-hidden", "false");
  $("#new-vendor-name")?.focus();
}

function closeVendorModal() {
  const modal = $("#vendor-create-modal");
  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
  $("#vendor-create-form")?.reset();
}

async function submitVendorCreate(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    toast("Vendor name is required.");
    return;
  }
  const payload = Object.fromEntries(formData.entries());
  payload.name = name;
  const result = await api("/api/vendors", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedVendorId = result.vendor.id;
  closeVendorModal();
  setState(result.state);
  showView("vendor-full");
  toast("Vendor created.");
}

async function uploadVendorFile(input) {
  const [file] = input.files || [];
  if (!file) return;
  const source = prompt("File source", "Manual upload") || "Manual upload";
  const result = await api(`/api/vendors/${input.dataset.vendorFileUpload}/files`, {
    method: "POST",
    body: JSON.stringify({
      type: input.dataset.fileType,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      source
    })
  });
  selectedVendorId = result.vendor.id;
  setState(result.state);
  toast("Vendor file recorded.");
  input.value = "";
}

async function createCustomer() {
  const name = prompt("Customer name");
  if (!name?.trim()) return;
  const result = await api("/api/customers", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() })
  });
  selectedCustomerId = result.customer.id;
  setState(result.state);
  showView("customer-full");
  toast("Customer created.");
}

function openOrderReturnModal(orderId) {
  const order = (state.orders || []).find((row) => row.id === orderId);
  if (!order) return;
  returnOrderId = orderId;
  returnDraftAttachments = [];
  $("#order-return-id").value = orderId;
  $("#order-return-date").value = new Date().toISOString().slice(0, 10);
  $("#order-return-reason").value = "";
  $("#order-return-amount").value = Number(order.total || 0).toFixed(2);
  const select = $("#order-return-warehouse");
  if (select) {
    const warehouses = (state.warehouses || []).filter((warehouse) => warehouse.status !== "inactive");
    const selectedWarehouseId = order.returnWarehouseId || defaultReturnWarehouse()?.id || warehouses[0]?.id || "";
    select.innerHTML = warehouses.map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === selectedWarehouseId ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
    select.value = selectedWarehouseId;
  }
  $("#order-return-lines").innerHTML = orderItems(order).map((item, index) => `
    <div class="manual-order-line">
      <label>SKU
        <input value="${html(item.sku || "")}" readonly />
      </label>
      <label>Title
        <input value="${html(item.title || item.sku || "")}" readonly />
      </label>
      <label>Ordered
        <input value="${Number(item.qty || 0)}" readonly />
      </label>
      <label>Price
        <input value="${money(item.price || 0)}" readonly />
      </label>
      <label>Return qty
        <input type="number" min="0" max="${Number(item.qty || 0)}" value="${Number(item.qty || 0)}" data-order-return-line-qty data-line-index="${index}" data-sku="${html(item.sku || "")}" data-title="${html(item.title || "")}" data-price="${Number(item.price || 0)}" data-cost="${Number(item.cost || 0)}" data-qty="${Number(item.qty || 0)}" />
      </label>
    </div>
  `).join("");
  renderReturnAttachmentList("#order-return-attachments", returnDraftAttachments, "data-remove-order-return-attachment", "No images attached.");
  $("#order-return-modal")?.classList.add("show");
  $("#order-return-modal")?.setAttribute("aria-hidden", "false");
}

function closeOrderReturnModal() {
  $("#order-return-modal")?.classList.remove("show");
  $("#order-return-modal")?.setAttribute("aria-hidden", "true");
  returnOrderId = null;
  returnDraftAttachments = [];
}

async function submitOrderReturn(form) {
  const formData = new FormData(form);
  const orderId = formData.get("orderId") || returnOrderId;
  const payload = Object.fromEntries(formData.entries());
  payload.amount = Number(payload.amount || 0);
  payload.items = collectModalLineItems("#order-return-lines", "data-order-return-line-qty").map((line) => ({
    sku: line.sku,
    title: line.title,
    qty: line.qtySelected,
    price: line.price,
    cost: line.cost,
    lineIndex: line.lineIndex
  }));
  payload.attachments = returnDraftAttachments.map((file) => ({ ...file, stage: "requested" }));
  if (!payload.items.length) throw new Error("Select at least one line item to return.");
  const result = await api(`/api/orders/${orderId}/returns`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedOrderId = orderId;
  closeOrderReturnModal();
  setState(result.state);
  showView("order-full");
  toast(`${result.return.returnNumber} created.`);
}

async function uploadBrandLogo(input) {
  const [file] = input.files || [];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Choose an image file.");
    input.value = "";
    return;
  }
  if (file.size > 1_500_000) {
    toast("Logo must be under 1.5 MB.");
    input.value = "";
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const result = await api(`/api/brands/${input.dataset.brandLogoUpload}`, {
    method: "PATCH",
    body: JSON.stringify({ logoDataUrl: dataUrl, logoUrl: "" })
  });
  selectedBrandId = result.brand.id;
  setState(result.state);
  toast("Brand logo uploaded.");
  input.value = "";
}

async function runBrandAction(id, action) {
  const result = await api(`/api/brands/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
  selectedBrandId = result.brand.id;
  setState(result.state);
  if (result.brand.status === "void") {
    showView("purchasing");
    purchasingTab = "brands";
    renderPurchaseOrders();
  } else {
    showView("brand-full");
  }
  toast(`Brand ${result.brand.status}.`);
}

async function updateBrandVendor(input) {
  const brand = state.brands.find((row) => row.id === input.dataset.brandVendor);
  if (!brand) return;
  const vendorIds = new Set(brand.vendorIds || []);
  if (input.checked) vendorIds.add(input.dataset.vendorId);
  else vendorIds.delete(input.dataset.vendorId);
  const result = await api(`/api/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ vendorIds: Array.from(vendorIds) })
  });
  setState(result.state);
  toast("Brand vendor map updated.");
}

async function updateVendorBrand(input) {
  const brand = state.brands.find((row) => row.id === input.dataset.brandId);
  if (!brand) return;
  const vendorIds = new Set(brand.vendorIds || []);
  if (input.checked) vendorIds.add(input.dataset.vendorBrand);
  else vendorIds.delete(input.dataset.vendorBrand);
  const result = await api(`/api/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ vendorIds: Array.from(vendorIds) })
  });
  setState(result.state);
  toast("Vendor brand map updated.");
}

async function updatePoField(input) {
  const po = state.purchaseOrders.find((row) => row.id === input.dataset.poId);
  if (!po) return;
  const result = await api(`/api/purchase-orders/${po.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [input.dataset.poField]: input.value })
  });
  selectedPoId = po.id;
  setState(result.state);
  toast("PO updated.");
}

async function updateWarehouseField(input) {
  const warehouse = (state.warehouses || []).find((row) => row.id === input.dataset.warehouseId);
  if (!warehouse) return;
  const result = await api(`/api/warehouses/${warehouse.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [input.dataset.warehouseField]: input.type === "checkbox" ? input.checked : input.value })
  });
  setState(result.state);
  if (purchasingTab === "warehouses") renderPurchaseOrders();
  if (currentViewId === "warehouse-full") renderWarehouseProfile();
  toast("Warehouse updated.");
}

async function updateWarehouseStatus(id, status) {
  const warehouse = (state.warehouses || []).find((row) => row.id === id);
  if (!warehouse) return;
  const result = await api(`/api/warehouses/${warehouse.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  selectedWarehouseId = warehouse.id;
  setState(result.state);
  if (currentViewId === "warehouse-full") renderWarehouseProfile();
  toast(`Warehouse ${status}.`);
}

function openWarehouseBinModal(warehouseId) {
  warehouseBinModalWarehouseId = warehouseId;
  $("#warehouse-bin-form")?.reset();
  $("#warehouse-bin-warehouse-id").value = warehouseId;
  $("#warehouse-bin-modal")?.classList.add("show");
  $("#warehouse-bin-modal")?.setAttribute("aria-hidden", "false");
}

function closeWarehouseBinModal() {
  $("#warehouse-bin-modal")?.classList.remove("show");
  $("#warehouse-bin-modal")?.setAttribute("aria-hidden", "true");
  warehouseBinModalWarehouseId = null;
}

async function submitWarehouseBin(form) {
  const formData = new FormData(form);
  const warehouseId = String(formData.get("warehouseId") || warehouseBinModalWarehouseId || "");
  if (!warehouseId) return;
  const payload = {
    code: String(formData.get("code") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    type: String(formData.get("type") || "Storage"),
    isDefault: formData.get("isDefault") === "on",
    active: formData.get("active") === "on",
    notes: String(formData.get("notes") || "").trim()
  };
  const result = await api(`/api/warehouses/${warehouseId}/bins`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedWarehouseId = warehouseId;
  closeWarehouseBinModal();
  setState(result.state);
  showView("warehouse-full");
  toast("Warehouse location added.");
}

async function updateWarehouseBinField(input) {
  const warehouseId = input.dataset.warehouseId;
  const binId = input.dataset.binId;
  if (!warehouseId || !binId) return;
  const payload = {
    [input.dataset.warehouseBinField]: input.type === "checkbox" ? input.checked : input.value
  };
  const result = await api(`/api/warehouses/${warehouseId}/bins/${binId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  selectedWarehouseId = warehouseId;
  setState(result.state);
  if (currentViewId === "warehouse-full") renderWarehouseProfile();
  toast("Warehouse location updated.");
}

async function submitPurchaseOrder(id, method) {
  try {
    const result = await api(`/api/purchase-orders/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ method })
    });
    selectedPoId = id;
    setState(result.state);
    showView("po-full");
    toast(`${result.purchaseOrder.poNumber} queued for ${method}.`);
  } catch (error) {
    toast(error.message);
  }
}

function openPoReceiveModal(poId) {
  const po = (state.purchaseOrders || []).find((row) => row.id === poId);
  if (!po) return;
  receivingPoId = poId;
  receiveAttachments = [];
  $("#po-receive-id").value = poId;
  $("#po-receive-mode").value = "final";
  $("#po-receive-date").value = new Date().toISOString().slice(0, 10);
  $("#po-receive-location").value = "";
  $("#po-receive-scan").value = "";
  $("#po-receive-bulk-serials").value = "";
  const warehouseSelect = $("#po-receive-warehouse");
  if (warehouseSelect) {
    const selectedWarehouseId = po.warehouseId || defaultReceivingWarehouse()?.id || "";
    warehouseSelect.innerHTML = (state.warehouses || []).map((warehouse) => `<option value="${warehouse.id}" ${warehouse.id === selectedWarehouseId ? "selected" : ""}>${html(warehouse.name)}</option>`).join("");
    warehouseSelect.value = selectedWarehouseId;
    $("#po-receive-location").value = defaultBinForWarehouse(selectedWarehouseId)?.code || "";
  }
  renderReceiveAttachments();
  $("#po-receive-lines").innerHTML = `
    <div class="receive-line receive-line-head">
      <strong>SKU</strong>
      <strong>Ordered</strong>
      <strong>Received</strong>
      <strong>Receive now</strong>
      <strong>Variance / bin</strong>
      <strong>Serials</strong>
    </div>
    ${(po.items || []).map((item, index) => {
      const ordered = Number(item.qty || 0);
      const received = Number(item.receivedQty || 0);
      const remaining = Math.max(0, ordered - received);
      return `
        <div class="receive-line" data-receive-row="${index}">
          <div><strong>${html(item.sku)}</strong><small>${html(item.title || "")}</small></div>
          <span>${ordered}</span>
          <span>${received}</span>
          <input type="number" min="0" value="${remaining}" data-receive-line="${index}" data-sku="${html(item.sku)}" data-ordered="${ordered}" data-received="${received}" data-remaining="${remaining}" />
          <div class="receive-line-meta">
            <label class="receive-line-variance">Variance
              <select data-variance-status="${index}">
                <option value="none">No variance</option>
                <option value="short">Short received</option>
                <option value="over">Over received</option>
                <option value="damaged">Damaged on arrival</option>
                <option value="backordered">Backordered</option>
              </select>
            </label>
            <label class="receive-line-location">Bin / location
              <input data-location-bin="${index}" placeholder="Use default bin" />
            </label>
            <label class="receive-variance-note">Variance note
              <input data-variance-note="${index}" placeholder="Optional discrepancy note" />
            </label>
          </div>
          <div class="receive-line-actions">
            <span class="receive-progress" data-receive-progress="${index}">0 / ${remaining || 0} ready</span>
            <button type="button" class="text-button" data-toggle-serials="${index}">Hide</button>
          </div>
          <div class="serial-capture open" data-serial-capture="${index}"></div>
        </div>
      `;
    }).join("") || `<p class="muted">No PO lines to receive.</p>`}
  `;
  renderReceiveSerialInputs();
  $("#po-receive-modal").classList.add("show");
  $("#po-receive-modal").setAttribute("aria-hidden", "false");
}

function receiveContext() {
  const po = (state.purchaseOrders || []).find((row) => row.id === receivingPoId);
  const vendor = po ? (state.vendors || []).find((row) => row.id === po.vendorId || row.name === po.supplier) : null;
  const receivedAt = $("#po-receive-date")?.value || new Date().toISOString().slice(0, 10);
  return { po, vendor, receivedAt };
}

function cleanSerialText(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase() || "NA";
}

function previewGeneratedSerial(index, unitIndex) {
  const { po, vendor, receivedAt } = receiveContext();
  const base = `${cleanSerialText(po?.poNumber)}-${cleanSerialText(vendor?.vendorNumber || po?.supplier)}-${cleanSerialText(receivedAt)}`;
  return unitIndex > 0 ? `${base}-${String(unitIndex + 1).padStart(3, "0")}` : base;
}

function renderReceiveAttachments() {
  const target = $("#po-receive-attachments");
  if (!target) return;
  target.innerHTML = receiveAttachments.length
    ? receiveAttachments.map((file, index) => `
      <div class="receive-attachment-item">
        <div>
          <strong>${html(file.name)}</strong>
          <small>${html(file.source || "Manual upload")} / ${fileSizeLabel(file.size)}</small>
        </div>
        <button type="button" class="text-button" data-remove-receive-attachment="${index}">Remove</button>
      </div>
    `).join("")
    : `<p class="muted">No receiving documents added.</p>`;
}

function updateReceiveSummary() {
  const qtyInputs = $$("#po-receive-lines [data-receive-line]");
  const totals = qtyInputs.reduce((summary, input) => {
    summary.ordered += Number(input.dataset.ordered || 0);
    summary.received += Number(input.dataset.received || 0);
    summary.remaining += Math.max(0, Number(input.dataset.remaining || 0));
    return summary;
  }, { ordered: 0, received: 0, remaining: 0 });
  const selectedLines = qtyInputs.filter((input) => Number(input.value || 0) > 0);
  const totalUnits = selectedLines.reduce((sum, input) => sum + Number(input.value || 0), 0);
  const completedLines = qtyInputs.filter((input) => Number(input.dataset.remaining || 0) === 0).length;
  const readyUnits = selectedLines.reduce((sum, input) => {
    const lineIndex = input.dataset.receiveLine;
    return sum + $$(`[data-serial-input="${lineIndex}"]`).filter((serialInput) => {
      const noSerial = document.querySelector(`[data-no-serial="${lineIndex}"][data-serial-index="${serialInput.dataset.serialIndex}"]`);
      return Boolean(noSerial?.checked || serialInput.value.trim());
    }).length;
  }, 0);
  const summary = $("#po-receive-summary");
  if (summary) {
    summary.innerHTML = `
      <div class="receive-summary-strip">
        <span class="receive-pill"><small>Selected</small><strong>${selectedLines.length} lines / ${totalUnits} units</strong></span>
        <span class="receive-pill"><small>Ready</small><strong>${readyUnits} serials ready</strong></span>
        <span class="receive-pill"><small>PO status</small><strong>${totals.received} received / ${totals.remaining} remaining</strong></span>
        <span class="receive-pill"><small>Complete lines</small><strong>${completedLines} of ${qtyInputs.length}</strong></span>
      </div>
    `;
  }
}

function refreshReceiveProgress(index) {
  const qtyInput = document.querySelector(`[data-receive-line="${index}"]`);
  const target = document.querySelector(`[data-receive-progress="${index}"]`);
  if (!qtyInput || !target) return;
  const qty = Number(qtyInput.value || 0);
  const ready = $$(`[data-serial-input="${index}"]`).filter((serialInput) => {
    const noSerial = document.querySelector(`[data-no-serial="${index}"][data-serial-index="${serialInput.dataset.serialIndex}"]`);
    return Boolean(noSerial?.checked || serialInput.value.trim());
  }).length;
  target.textContent = `${ready} / ${qty} ready`;
  updateReceiveSummary();
}

function renderReceiveSerialInputs() {
  $$("#po-receive-lines [data-receive-line]").forEach((qtyInput) => {
    const index = qtyInput.dataset.receiveLine;
    const qty = Math.max(0, Number(qtyInput.value || 0));
    const target = $(`[data-serial-capture="${index}"]`);
    if (!target) return;
    target.innerHTML = qty
      ? `
        <div class="serial-toolbar-row">
          <span>${qty} unit${qty === 1 ? "" : "s"} to receive</span>
          <div class="serial-toolbar-actions">
            <button type="button" class="text-button" data-toggle-paste="${index}">Paste list</button>
            <button type="button" class="text-button" data-fill-no-serial="${index}">Auto-generate all</button>
          </div>
        </div>
        <div class="serial-paste" data-serial-paste="${index}" hidden>
          <label>Paste serials
            <textarea rows="3" data-paste-serials="${index}" placeholder="One serial per line"></textarea>
          </label>
          <button type="button" class="button secondary" data-apply-paste="${index}">Apply pasted serials</button>
        </div>
        ${Array.from({ length: qty }).map((_, unitIndex) => `
          <div class="serial-row">
            <label>Unit ${unitIndex + 1} serial<input data-serial-input="${index}" data-serial-index="${unitIndex}" placeholder="Serial number" /></label>
            <div class="serial-row-actions">
              <button type="button" class="button secondary compact-button" data-skip-serial="${index}" data-serial-index="${unitIndex}">Skip</button>
              <label class="serial-check"><input type="checkbox" data-no-serial="${index}" data-serial-index="${unitIndex}" /> No serial</label>
            </div>
          </div>
        `).join("")}
      `
      : `<p class="muted">No units selected for this line.</p>`;
    refreshReceiveProgress(index);
  });
  updateReceiveSummary();
}

function closePoReceiveModal() {
  $("#po-receive-modal")?.classList.remove("show");
  $("#po-receive-modal")?.setAttribute("aria-hidden", "true");
  receivingPoId = null;
  receiveAttachments = [];
}

function collectPoReceivePayload(form) {
  const formData = new FormData(form);
  const poId = formData.get("poId") || receivingPoId;
  const items = $$("#po-receive-lines [data-receive-line]").map((input) => ({
    sku: input.dataset.sku,
    qtyReceived: Number(input.value || 0),
    varianceStatus: $(`[data-variance-status="${input.dataset.receiveLine}"]`)?.value || "none",
    varianceNote: $(`[data-variance-note="${input.dataset.receiveLine}"]`)?.value || "",
    locationBin: $(`[data-location-bin="${input.dataset.receiveLine}"]`)?.value || "",
    serials: $$(`[data-serial-input="${input.dataset.receiveLine}"]`).map((serialInput) => {
      const noSerial = document.querySelector(`[data-no-serial="${input.dataset.receiveLine}"][data-serial-index="${serialInput.dataset.serialIndex}"]`);
      return {
        serialNumber: serialInput.value.trim(),
        noSerial: Boolean(noSerial?.checked)
      };
    })
  })).filter((item) => item.qtyReceived > 0);
  return {
    poId,
    payload: {
      mode: formData.get("mode") || "final",
      receivedAt: formData.get("receivedAt"),
      warehouseId: formData.get("warehouseId"),
      defaultLocationBin: formData.get("defaultLocationBin"),
      note: formData.get("note"),
      attachments: receiveAttachments,
      items
    }
  };
}

async function submitPoReceive(form) {
  const { poId, payload } = collectPoReceivePayload(form);
  const result = await api(`/api/purchase-orders/${poId}/receive`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  selectedPoId = poId;
  closePoReceiveModal();
  setState(result.state);
  toast(payload.mode === "draft" ? "Receipt draft saved." : "PO received and inventory updated.");
}

function applyReceiveAllRemaining() {
  $$("#po-receive-lines [data-receive-line]").forEach((input) => {
    input.value = Number(input.dataset.remaining || 0);
  });
  renderReceiveSerialInputs();
}

function applyReceiveNone() {
  $$("#po-receive-lines [data-receive-line]").forEach((input) => {
    input.value = 0;
  });
  renderReceiveSerialInputs();
}

function applyPoSerialPaste() {
  const text = ($("#po-receive-bulk-serials")?.value || "").trim();
  if (!text) {
    toast("Paste PO serials first.");
    return;
  }
  const serialsBySku = {};
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const [skuPart, serialPart] = line.split(/\s*[,|]\s*/);
    if (!serialPart) return;
    const key = String(skuPart || "").trim().toLowerCase();
    serialsBySku[key] = serialsBySku[key] || [];
    serialsBySku[key].push(serialPart.trim());
  });
  $$("#po-receive-lines [data-receive-line]").forEach((input) => {
    const sku = String(input.dataset.sku || "").trim().toLowerCase();
    const list = serialsBySku[sku] || [];
    $$(`[data-serial-input="${input.dataset.receiveLine}"]`).forEach((serialInput, serialIndex) => {
      const checkbox = document.querySelector(`[data-no-serial="${input.dataset.receiveLine}"][data-serial-index="${serialIndex}"]`);
      if (list[serialIndex] && checkbox) {
        checkbox.checked = false;
        serialInput.disabled = false;
        serialInput.value = list[serialIndex];
      }
    });
    refreshReceiveProgress(input.dataset.receiveLine);
  });
  toast("PO serial paste applied.");
}

function firstEmptySerialInput(index) {
  return $$(`[data-serial-input="${index}"]`).find((input) => !input.value.trim() && !input.disabled);
}

function handleReceiveScan(value) {
  const scan = String(value || "").trim().toLowerCase();
  if (!scan) return false;
  const matches = $$("#po-receive-lines [data-receive-line]").find((input) => {
    const sku = String(input.dataset.sku || "").trim().toLowerCase();
    const item = (state.inventory || []).find((row) => row.sku === input.dataset.sku);
    const barcode = String(item?.barcode || "").trim().toLowerCase();
    const vendorSku = String(item?.vendorSku || "").trim().toLowerCase();
    return [sku, barcode, vendorSku].filter(Boolean).includes(scan);
  });
  if (!matches) return false;
  const current = Number(matches.value || 0);
  matches.value = current + 1;
  renderReceiveSerialInputs();
  const row = matches.closest("[data-receive-row]");
  row?.classList.add("receive-scan-hit");
  window.setTimeout(() => row?.classList.remove("receive-scan-hit"), 900);
  firstEmptySerialInput(matches.dataset.receiveLine)?.focus();
  return true;
}

async function updateSerialUnitAction(productId, serialId, action) {
  const result = await api(`/api/inventory/${productId}/serials/${serialId}/action`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
  selectedProductId = productId;
  setState(result.state);
  showView("inventory-full");
  toast(`Serial updated to ${result.serial.status}.`);
}

async function runPoWorkflowAction(id, action) {
  const result = await api(`/api/purchase-orders/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
  selectedPoId = id;
  setState(result.state);
  showView("po-full");
  toast(`${result.purchaseOrder.poNumber} ${result.purchaseOrder.status}.`);
}

async function createVendorReturn(id) {
  const po = (state.purchaseOrders || []).find((row) => row.id === id);
  const result = await api(`/api/purchase-orders/${id}/returns`, {
    method: "POST",
    body: JSON.stringify({ reason: "Return to vendor created from PO actions.", warehouseId: po?.warehouseId || "" })
  });
  selectedPoId = id;
  setState(result.state);
  showView("po-full");
  toast(`${result.return.returnNumber} created.`);
}

async function updateCustomerField(input) {
  const customer = state.customers.find((row) => row.id === input.dataset.customerId);
  if (!customer) return;
  const field = input.dataset.customerField;
  const booleanFields = new Set(["taxExempt", "marketingOptIn"]);
  let value = input.value;
  if (booleanFields.has(field)) value = ["yes", "true", "1", "y"].includes(String(input.value).trim().toLowerCase());
  const result = await api(`/api/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
  selectedCustomerId = customer.id;
  setState(result.state);
  toast("Customer updated.");
}

async function addCustomerAddress(id, type) {
  const result = await api(`/api/customers/${id}/addresses`, {
    method: "POST",
    body: JSON.stringify({ type })
  });
  selectedCustomerId = id;
  setState(result.state);
  toast(`${type === "billing" ? "Billing" : "Shipping"} address added.`);
}

async function runVendorAction(id, action) {
  if (action === "edit") {
    selectedVendorId = id;
    showView("vendor-full");
    return;
  }
  if (action === "log") {
    selectedVendorId = id;
    showView("vendor-full");
    window.setTimeout(() => $("#vendor-change-log")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return;
  }
  const result = await api(`/api/vendors/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
  selectedVendorId = id;
  setState(result.state);
  renderPurchaseOrders();
  toast(`Vendor set as ${result.vendor.status}.`);
}

async function updateInventory(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.inventoryId);
  if (!item) return;
  const payload = { [input.dataset.inventoryField]: Number(input.value) };
  const result = await api(`/api/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  item.qty = result.item.qty;
  item.reserved = result.item.reserved;
  item.reorderPoint = result.item.reorderPoint;
  state.summary = result.summary;
  render();
  toast("Inventory updated.");
}

async function updateWarehouseStockField(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!item) return;
  const field = input.dataset.warehouseStockField;
  let value = input.value;
  if (["qty", "reserved", "reorderPoint"].includes(field)) value = Number(input.value || 0);
  const result = await api(`/api/inventory/${item.id}/warehouse-stock/${input.dataset.warehouseId}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value })
  });
  Object.assign(item, result.item);
  state.summary = result.summary;
  render();
  toast("Warehouse stock updated.");
}

async function updateProductField(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!item) return;
  const field = input.dataset.productField;
  const numericFields = new Set(["qty", "reserved", "reorderPoint", "price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "itemHeight", "itemLength", "itemWeight", "itemWidth", "packageHeight", "packageLength", "packageWeight", "packageWidth", "dimensionalWeight", "stockQty", "fobPrice", "zoroPrice", "zoroMinimumQty", "varisContractPrice", "varisListPrice", "varisOdManagedPrice", "varisNonOdManagedPrice", "varisOdPrivatePrice", "varisNonOdPrivatePrice"]);
  const booleanFields = new Set(["hazardous", "active", "brandLocked"]);
  let value = input.value;
  if (numericFields.has(field)) value = Number(input.value);
  if (booleanFields.has(field)) value = input.type === "checkbox" ? input.checked : input.value === "true";
  const payload = { [field]: value };
  if (["packageLength", "packageWidth", "packageHeight"].includes(field)) {
    const next = { ...item, [field]: value };
    payload.dimensionalWeight = calculateDimensionalWeight(next);
  }
  const result = await api(`/api/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(item, result.item);
  state.summary = result.summary;
  render();
  toast("Product updated.");
}

async function updateShadowField(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!item) return;
  const shadow = (item.shadowSkus || []).find((row) => row.id === input.dataset.shadowId);
  if (!shadow) return;
  const field = input.dataset.shadowField;
  let value = input.value;
  if (["price", "handlingTimeDays"].includes(field)) value = Number(input.value);
  if (["safetyQty", "maxSellableQty"].includes(field)) value = Number(input.value);
  if (field === "freeShipping") value = input.value === "true";
  const result = await api(`/api/inventory/${item.id}/shadows/${shadow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value })
  });
  selectedProductId = result.item.id;
  setState(result.state);
  toast("Shadow SKU updated.");
}

async function updateShadowAttribute(input) {
  const product = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!product) return;
  const shadow = (product.shadowSkus || []).find((row) => row.id === input.dataset.shadowId);
  if (!shadow) return;
  const result = await api(`/api/inventory/${product.id}/shadows/${shadow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ attributeKey: input.dataset.shadowAttribute, attributeValue: input.value })
  });
  selectedProductId = result.item.id;
  selectedShadowId = result.shadow.id;
  setState(result.state);
  toast("Marketplace attribute updated.");
}

async function updateShadowOverride(input) {
  const product = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!product) return;
  const shadow = (product.shadowSkus || []).find((row) => row.id === input.dataset.shadowId);
  if (!shadow) return;
  const result = await api(`/api/inventory/${product.id}/shadows/${shadow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ overrideField: input.dataset.shadowOverride, overrideValue: input.value })
  });
  selectedProductId = result.item.id;
  selectedShadowId = result.shadow.id;
  setState(result.state);
  toast("Content override updated.");
}

async function syncShadow(productId, shadowId) {
  const { product, shadow } = findShadowSelection();
  const targetProduct = state.inventory.find((row) => row.id === productId) || product;
  const targetShadow = (targetProduct?.shadowSkus || []).find((row) => row.id === shadowId) || shadow;
  if (!targetProduct || !targetShadow) return;
  const validation = validateShadowListing(targetProduct, targetShadow);
  if (!validation.every((check) => check.ok)) {
    toast("Fix validation before syncing.");
    return;
  }
  const result = await api(`/api/inventory/${targetProduct.id}/shadows/${targetShadow.id}/sync`, { method: "POST" });
  selectedProductId = result.item.id;
  selectedShadowId = result.shadow.id;
  setState(result.state);
  showView("shadow-full");
  toast("Marketplace sync queued.");
}

async function updateMarketplaceTemplate(input) {
  const template = (state.marketplaceTemplates || []).find((row) => row.id === input.dataset.templateId);
  if (!template) return;
  const field = input.dataset.templateField;
  let value = input.value;
  if (input.type === "checkbox") value = input.checked;
  if (["titleMaxLength", "minImages"].includes(field)) value = Number(input.value);
  const result = await api(`/api/marketplace-templates/${template.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value })
  });
  setState(result.state);
  toast("Marketplace template updated.");
}

async function createExportMapping() {
  const form = $("#export-mapping-create-form");
  const formData = form ? new FormData(form) : null;
  const name = String(formData?.get("name") || "Custom Product Mapping").trim();
  const source = String(formData?.get("source") || "Custom").trim();
  const mode = String(formData?.get("mode") || "both").trim();
  const notes = String(formData?.get("notes") || "").trim();
  if (!name) throw new Error("Template name is required.");
  const result = await api("/api/export-mappings", {
    method: "POST",
    body: JSON.stringify({ name, source, mode, notes })
  });
  selectedExportMappingId = result.template.id;
  activeExportMappingPageId = result.template.id;
  mergeExportMappingsState(result);
  closeExportMappingCreateModal();
  renderImportExportMappings();
  toast("Template created.");
}

function openExportMappingCreateModal() {
  const modal = $("#export-mapping-create-modal");
  const form = $("#export-mapping-create-form");
  if (form) form.reset();
  modal?.classList.add("show");
  modal?.setAttribute("aria-hidden", "false");
  setTimeout(() => $("#export-mapping-name")?.focus(), 0);
}

function closeExportMappingCreateModal() {
  $("#export-mapping-create-modal")?.classList.remove("show");
  $("#export-mapping-create-modal")?.setAttribute("aria-hidden", "true");
}

async function updateExportMapping(input) {
  const template = (state.exportMappings || []).find((row) => row.id === input.dataset.exportMappingId);
  if (!template) return;
  const field = input.dataset.exportMappingField;
  const value = input.type === "checkbox" ? input.checked : input.value;
  const result = await api(`/api/export-mappings/${template.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value })
  });
  selectedExportMappingId = result.template.id;
  activeExportMappingPageId = result.template.id;
  mergeExportMappingsState(result);
  renderImportExportMappings();
  toast("Mapping updated.");
}

async function saveExportMappingRows(templateId, mappings) {
  const result = await api(`/api/export-mappings/${templateId}`, {
    method: "PATCH",
    body: JSON.stringify({ mappings })
  });
  selectedExportMappingId = result.template.id;
  activeExportMappingPageId = result.template.id;
  mergeExportMappingsState(result);
  renderImportExportMappings();
  toast("Mapping columns updated.");
}

function markMappingDraftDirty() {
  mappingDraftDirty = true;
  const node = $("#mapping-save-state");
  if (node) {
    node.textContent = "Unsaved changes";
    node.classList.add("dirty");
  }
}

function markMappingDraftSaved() {
  mappingDraftDirty = false;
  const node = $("#mapping-save-state");
  if (node) {
    node.textContent = "Saved";
    node.classList.remove("dirty");
  }
}

function parseMappingRowsText(text) {
  return String(text || "").split(/\r?\n/).map((line) => {
    const [externalColumn = "", productField = "", defaultValue = "", required = ""] = line.split("|");
    return {
      externalColumn: externalColumn.trim(),
      productField: productField.trim(),
      defaultValue: defaultValue.trim(),
      required: ["true", "yes", "required", "1"].includes(required.trim().toLowerCase())
    };
  }).filter((row) => row.externalColumn || row.productField || row.defaultValue);
}

function collectExportMappingDraft(templateId) {
  const payload = {};
  document.querySelectorAll(`[data-export-mapping-draft-field][data-export-mapping-id="${CSS.escape(templateId)}"]`).forEach((input) => {
    const field = input.dataset.exportMappingDraftField;
    payload[field] = input.type === "checkbox" ? input.checked : input.value;
  });
  const raw = document.querySelector(`[data-export-mapping-draft-raw="${CSS.escape(templateId)}"]`);
  if (raw?.dataset.mappingRawDirty === "true") {
    payload.mappings = parseMappingRowsText(raw.value);
    return payload;
  }
  const rows = [];
  document.querySelectorAll(`[data-export-mapping-draft-row-field][data-export-mapping-id="${CSS.escape(templateId)}"]`).forEach((input) => {
    const index = Number(input.dataset.mappingRowIndex || 0);
    const field = input.dataset.exportMappingDraftRowField;
    rows[index] = rows[index] || {};
    rows[index][field] = input.type === "checkbox" ? input.checked : input.value;
  });
  payload.mappings = rows.filter(Boolean).map((row) => ({
    externalColumn: row.externalColumn || "",
    productField: row.productField || "",
    defaultValue: row.defaultValue || "",
    required: Boolean(row.required)
  })).filter((row) => row.externalColumn || row.productField || row.defaultValue);
  return payload;
}

async function saveExportMappingDraft(templateId) {
  const payload = collectExportMappingDraft(templateId);
  const result = await api(`/api/export-mappings/${templateId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  selectedExportMappingId = result.template.id;
  activeExportMappingPageId = result.template.id;
  mergeExportMappingsState(result);
  markMappingDraftSaved();
  renderImportExportMappings();
  toast("Template saved.");
}

function reindexMappingDraftRows(templateId) {
  document.querySelectorAll(".mapping-row-edit").forEach((row, index) => {
    row.querySelectorAll("[data-mapping-row-index]").forEach((input) => {
      input.dataset.mappingRowIndex = String(index);
    });
    const removeButton = row.querySelector("[data-remove-export-mapping-row]");
    if (removeButton) {
      removeButton.dataset.mappingRowIndex = String(index);
      removeButton.dataset.removeExportMappingRow = templateId;
    }
  });
}

function addExportMappingRow(templateId) {
  const editor = document.querySelector(".mapping-row-editor");
  if (!editor) return;
  const empty = editor.querySelector(".empty-state");
  if (empty) empty.remove();
  const index = editor.querySelectorAll(".mapping-row-edit").length;
  editor.insertAdjacentHTML("beforeend", renderMappingDraftRow({ externalColumn: "New Column", productField: "", defaultValue: "" }, templateId, index));
  reindexMappingDraftRows(templateId);
  markMappingDraftDirty();
}

function removeExportMappingRow(templateId, index) {
  const row = [...document.querySelectorAll(".mapping-row-edit")][Number(index)];
  if (!row) return;
  row.remove();
  reindexMappingDraftRows(templateId);
  markMappingDraftDirty();
}

async function duplicateExportMapping(templateId) {
  const template = (state.exportMappings || []).find((row) => row.id === templateId);
  if (!template) return;
  const result = await api("/api/export-mappings", {
    method: "POST",
    body: JSON.stringify({
      name: `${template.name} Copy`,
      source: template.source,
      mode: template.mode,
      notes: template.notes,
      mappings: template.mappings || []
    })
  });
  selectedExportMappingId = result.template.id;
  activeExportMappingPageId = result.template.id;
  mergeExportMappingsState(result);
  renderImportExportMappings();
  toast("Template duplicated.");
}

async function deleteExportMapping(templateId) {
  const template = (state.exportMappings || []).find((row) => row.id === templateId);
  if (isBuiltInExportMapping(template)) {
    toast("Built-in templates cannot be deleted. Duplicate it first, then delete the copy.");
    return;
  }
  if (!confirm("Delete this import/export template? This removes the local mapping configuration.")) return;
  const result = await api(`/api/export-mappings/${templateId}`, { method: "DELETE" });
  activeExportMappingPageId = null;
  const exportMappings = mergeExportMappingsState(result);
  if (selectedExportMappingId === templateId) selectedExportMappingId = exportMappings[0]?.id || null;
  renderImportExportMappings();
  toast("Template deleted.");
}

async function importMappedProducts(input) {
  const [file] = input.files || [];
  if (!file) return;
  const csv = await file.text();
  await previewProductImport(input.dataset.importExportFile, csv, file.name);
}

function renderProductImportModal() {
  const template = (state.exportMappings || []).find((row) => row.id === pendingProductImport.templateId);
  const content = $("#product-import-content");
  if (!content) return;
  const isShopifyStatus = pendingProductImport.mode === "shopify-status";
  if (!template && !isShopifyStatus) return;
  const preview = pendingProductImport.preview;
  $("#product-import-title").textContent = isShopifyStatus ? "Import Shopify status" : `Import ${template.name}`;
  content.innerHTML = `
    <div class="product-import-steps">
      <section class="product-import-step active">
        <span>1</span>
        <strong>Choose CSV</strong>
        <small>${html(pendingProductImport.fileName || "No file selected")}</small>
      </section>
      <section class="product-import-step ${preview ? "active" : ""}">
        <span>2</span>
        <strong>Review preview</strong>
        <small>${preview ? `${preview.changed} updates detected` : "Waiting for file"}</small>
      </section>
      <section class="product-import-step ${preview ? "active" : ""}">
        <span>3</span>
        <strong>Import</strong>
        <small>${isShopifyStatus ? "Updates Shopify fields only" : "Matched by mapped SKU"}</small>
      </section>
    </div>
    <div class="product-import-picker">
      <div>
        <strong>${html(isShopifyStatus ? "Matrixify Products export" : template.name)}</strong>
        <small>${html(isShopifyStatus ? "Matches by Variant SKU, then Handle, then Shopify ID. Does not overwrite product content." : `${template.source} / ${(template.mappings || []).length} mapped columns`)}</small>
      </div>
      <label class="file-button">Choose CSV<input type="file" accept=".csv,text/csv" ${isShopifyStatus ? "data-import-shopify-status-file" : `data-import-export-file="${template.id}"`} /></label>
    </div>
    ${preview ? `
      <div class="product-import-summary">
        <span><small>Updates</small><strong>${preview.changed}</strong></span>
        <span><small>${isShopifyStatus ? "Matched" : "Creates"}</small><strong>${isShopifyStatus ? (preview.matched || 0) : (preview.preview || []).filter((row) => row.action === "create").length}</strong></span>
        <span><small>Updates</small><strong>${(preview.preview || []).filter((row) => row.action === "update").length}</strong></span>
        ${isShopifyStatus ? `<span><small>Missing</small><strong>${(preview.missing || []).length}</strong></span>` : ""}
      </div>
      <div class="mapping-preview-table product-import-preview">
        <table class="catalog-table">
          <thead><tr><th>SKU</th><th>${isShopifyStatus ? "Handle" : "Action"}</th><th>${isShopifyStatus ? "Action / match" : "Mapped fields"}</th><th>Fields</th></tr></thead>
          <tbody>${(preview.preview || []).slice(0, 12).map((row) => `<tr><td>${html(row.sku)}</td><td>${html(isShopifyStatus ? row.handle : row.action)}</td><td>${html(isShopifyStatus ? `${row.action}${row.matchBy ? ` by ${row.matchBy}` : ""}` : "")}</td><td>${html((row.fields || []).join(", "))}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    ` : `<div class="empty-state compact">${isShopifyStatus ? "Choose a Matrixify Products export to preview Shopify IDs and live statuses." : "Choose a CSV to preview what will be created or updated."}</div>`}
  `;
  $("[data-run-product-import]").disabled = !preview || !pendingProductImport.csv;
  $("[data-run-product-import]").textContent = isShopifyStatus ? "Update Shopify status" : "Import products";
}

function openProductImportModal(templateId) {
  pendingProductImport = { templateId, fileName: "", csv: "", preview: null, mode: "mapped" };
  $("#product-import-modal")?.classList.add("show");
  $("#product-import-modal")?.setAttribute("aria-hidden", "false");
  renderProductImportModal();
}

function openShopifyStatusImportModal() {
  pendingProductImport = { templateId: null, fileName: "", csv: "", preview: null, mode: "shopify-status" };
  $("#product-import-modal")?.classList.add("show");
  $("#product-import-modal")?.setAttribute("aria-hidden", "false");
  renderProductImportModal();
}

function closeProductImportModal() {
  pendingProductImport = { templateId: null, fileName: "", csv: "", preview: null, mode: "mapped" };
  $("#product-import-modal")?.classList.remove("show");
  $("#product-import-modal")?.setAttribute("aria-hidden", "true");
}

async function previewProductImport(templateId, csv, fileName = "") {
  const result = await api(`/api/export-mappings/${templateId}/import`, {
    method: "POST",
    body: JSON.stringify({ csv, dryRun: true, fileName })
  });
  pendingProductImport = { templateId, fileName, csv, preview: result, mode: "mapped" };
  renderProductImportModal();
  toast(`Previewed ${result.changed} product row${result.changed === 1 ? "" : "s"}.`);
}

async function importShopifyStatusFile(input) {
  const [file] = input.files || [];
  if (!file) return;
  const csv = await file.text();
  const result = await api("/api/shopify/status-import", {
    method: "POST",
    body: JSON.stringify({ csv, dryRun: true, fileName: file.name })
  });
  pendingProductImport = { templateId: null, fileName: file.name, csv, preview: result, mode: "shopify-status" };
  $("#product-import-modal")?.classList.add("show");
  $("#product-import-modal")?.setAttribute("aria-hidden", "false");
  renderProductImportModal();
  toast(`Previewed ${result.changed} Shopify status update${result.changed === 1 ? "" : "s"}.`);
  input.value = "";
}

async function runProductImport() {
  if (!pendingProductImport.csv) return;
  if (pendingProductImport.mode === "shopify-status") {
    const result = await api("/api/shopify/status-import", {
      method: "POST",
      body: JSON.stringify({ csv: pendingProductImport.csv, fileName: pendingProductImport.fileName })
    });
    closeProductImportModal();
    setState(result.state);
    renderCatalog();
    toast(`Updated Shopify status for ${result.changed} product${result.changed === 1 ? "" : "s"}.`);
    return;
  }
  if (!pendingProductImport.templateId) return;
  const result = await api(`/api/export-mappings/${pendingProductImport.templateId}/import`, {
    method: "POST",
    body: JSON.stringify({ csv: pendingProductImport.csv, fileName: pendingProductImport.fileName })
  });
  closeProductImportModal();
  setState(result.state);
  renderImportExportMappings();
  toast(`Imported ${result.changed} product row${result.changed === 1 ? "" : "s"}.`);
}

async function loadMappingHeaders(input) {
  const [file] = input.files || [];
  if (!file) return;
  const csv = await file.text();
  const headers = parseCsvHeaderLine(csv);
  if (!headers.length) return toast("No CSV headers found.");
  const mappings = headers.map((header) => ({
    externalColumn: header,
    productField: guessProductField(header),
    defaultValue: ""
  }));
  const templateId = input.dataset.loadMappingHeaders;
  const editor = document.querySelector(".mapping-row-editor");
  if (activeExportMappingPageId === templateId && editor) {
    editor.innerHTML = `
      <div class="mapping-row-editor-head">
        <span>External column</span>
        <span>DataPlus field</span>
        <span>Default value</span>
        <span>Required</span>
        <span></span>
      </div>
      ${mappings.map((row, index) => renderMappingDraftRow(row, templateId, index)).join("")}
    `;
    const raw = document.querySelector(`[data-export-mapping-draft-raw="${CSS.escape(templateId)}"]`);
    if (raw) {
      raw.value = mappings.map((row) => `${row.externalColumn}|${row.productField}|${row.defaultValue || ""}`).join("\n");
      raw.dataset.mappingRawDirty = "false";
    }
    markMappingDraftDirty();
    toast(`Loaded ${headers.length} columns. Click Save changes to keep them.`);
    return;
  }
  await saveExportMappingRows(templateId, mappings);
}

async function updateChannelField(input) {
  const channel = (state.connections || []).find((row) => row.id === input.dataset.channelId);
  if (!channel) return;
  const field = input.dataset.channelField;
  let value = input.value;
  if (input.type === "checkbox") value = input.checked;
  if (["defaultHandlingTimeDays", "defaultSafetyQty", "defaultMaxSellableQty", "priceMarkupPercent", "minMarginPercent"].includes(field)) value = Number(input.value || 0);
  const result = await api(`/api/channels/${channel.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [field]: value })
  });
  selectedChannelId = result.channel.id;
  setState(result.state);
  toast("Channel settings updated.");
}

async function uploadChannelLogo(input) {
  const [file] = input.files || [];
  if (!file) return;
  const channelId = input.dataset.channelLogoUpload;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
  const result = await api(`/api/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ logoDataUrl: dataUrl })
  });
  selectedChannelId = result.channel.id;
  setState(result.state);
  toast("Channel logo updated.");
}

async function runTemplateAction(id, action) {
  const result = await api(`/api/marketplace-templates/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
  selectedTemplateId = result.template.id;
  setState(result.state);
  showView("template-full");
  toast(`Template ${action}.`);
}

async function updateOrderMoney(input) {
  const order = state.orders.find((row) => row.id === input.dataset.orderId);
  if (!order) return;
  const field = input.dataset.orderMoney;
  const result = await api(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ [field]: Number(input.value) }) });
  selectedOrderId = order.id;
  setState(result.state);
  toast("Order P&L updated.");
}

async function importInventory(file) {
  const csv = await file.text();
  const result = await api("/api/import/inventory", { method: "POST", body: JSON.stringify({ csv, fileName: file.name }) });
  setState(result.state);
  toast(`Imported ${result.changed} inventory rows.`);
}

async function importSkuCategories(file) {
  const csv = await file.text();
  const result = await api("/api/categories/import-sku-csv", {
    method: "POST",
    body: JSON.stringify({ csv, fileName: file.name })
  });
  setState(result.state);
  categoryScope = "main";
  selectedCategoryId = null;
  categoryRequestId += 1;
  categoryState = { ...(result.categories || {}), query: "", scope: "main", loading: false };
  renderCatalog();
  toast(`Imported ${result.changed} SKU categories. ${result.updatedProducts} active products updated.`);
}

async function importCategoryMappings(file) {
  const csv = await file.text();
  const result = await api("/api/categories/import-mapping-csv", {
    method: "POST",
    body: JSON.stringify({ csv, fileName: file.name })
  });
  setState(result.state);
  categoryScope = "main";
  selectedCategoryId = null;
  categoryRequestId += 1;
  categoryState = { ...(result.categories || {}), query: "", scope: "main", loading: false };
  renderCatalog();
  toast(`Imported ${result.changed} category mappings.`);
}

async function promoteCatalogProduct(sku) {
  if (!sku) return;
  const result = await api("/api/catalog/promote", {
    method: "POST",
    body: JSON.stringify({ sku })
  });
  selectedProductId = result.item?.id || selectedProductId;
  setState(result.state);
  renderSourceCatalogTable();
  toast(`${sku} ${result.existing ? "updated in" : "added to"} active catalog.`);
}

async function promoteCatalogSkusFromCsv(file) {
  const csv = await file.text();
  const result = await api("/api/catalog/promote-csv", {
    method: "POST",
    body: JSON.stringify({ csv })
  });
  selectedSourceSkus.clear();
  selectedSourceAllFiltered = false;
  setState(result.state);
  sourceCatalogPage = 1;
  renderCatalog();
  const missing = result.missing?.length ? ` ${result.missing.length} not found.` : "";
  toast(`Added ${result.changed} of ${result.requested} SKU${result.requested === 1 ? "" : "s"} to active catalog.${missing}`);
}

function sourceSkuCandidatesFromCsv(csv) {
  const text = String(csv || "");
  const records = parseCsvHeaderLine(text).length ? parseCsv(text) : [];
  const headerSkus = records.flatMap((record) => [
    record.sku,
    record.SKU,
    record.Sku,
    record["Variant SKU"],
    record["variant sku"],
    record["Vendor SKU"],
    record.vendorSku
  ]).filter(Boolean);
  const rawSkus = text.split(/[\r\n,;\t]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !["sku", "variant sku", "vendor sku"].includes(value.toLowerCase()));
  return [...new Set((headerSkus.length ? headerSkus : rawSkus).map((sku) => String(sku || "").trim()).filter(Boolean))];
}

async function openSourceSkuImportModal(file) {
  const csv = await file.text();
  pendingSourceSkuImport = {
    fileName: file.name || "source-skus.csv",
    csv,
    skus: sourceSkuCandidatesFromCsv(csv),
    result: null,
    running: false,
    error: ""
  };
  $("#source-sku-import-modal")?.classList.add("show");
  $("#source-sku-import-modal")?.setAttribute("aria-hidden", "false");
  renderSourceSkuImportModal();
}

function closeSourceSkuImportModal() {
  pendingSourceSkuImport = { fileName: "", csv: "", skus: [], result: null, running: false, error: "" };
  $("#source-sku-import-modal")?.classList.remove("show");
  $("#source-sku-import-modal")?.setAttribute("aria-hidden", "true");
}

function renderSourceSkuImportModal() {
  const content = $("#source-sku-import-content");
  if (!content) return;
  const pending = pendingSourceSkuImport;
  const result = pending.result;
  const requested = result?.requested ?? pending.skus.length;
  const changed = result?.changed ?? 0;
  const missing = result?.missing || [];
  const progress = pending.running ? 65 : result ? 100 : pending.skus.length ? 33 : 0;
  content.innerHTML = `
    <div class="product-import-steps">
      <section class="product-import-step active">
        <span>1</span>
        <strong>Upload file</strong>
        <small>${html(pending.fileName || "No file selected")}</small>
      </section>
      <section class="product-import-step ${pending.skus.length || pending.running || result ? "active" : ""}">
        <span>2</span>
        <strong>Read SKUs</strong>
        <small>${Number(pending.skus.length || 0).toLocaleString()} unique SKU${pending.skus.length === 1 ? "" : "s"} found</small>
      </section>
      <section class="product-import-step ${pending.running || result ? "active" : ""}">
        <span>3</span>
        <strong>Add to products</strong>
        <small>${pending.running ? "Working through source catalog" : result ? `${changed} moved` : "Ready to run"}</small>
      </section>
    </div>
    <div class="source-import-progress">
      <div class="source-import-progress-bar"><span style="width:${progress}%"></span></div>
      <div class="source-import-progress-meta">
        <strong>${pending.running ? "Importing source SKUs..." : result ? "Import complete" : "Ready to import"}</strong>
        <small>${result ? `${changed} added or updated / ${requested} requested` : `${requested} SKU${requested === 1 ? "" : "s"} queued`}</small>
      </div>
    </div>
    ${pending.error ? `<div class="empty-state compact">${html(pending.error)}</div>` : ""}
    <div class="product-import-summary">
      <span><small>Requested</small><strong>${Number(requested || 0).toLocaleString()}</strong></span>
      <span><small>Moved to products</small><strong>${Number(changed || 0).toLocaleString()}</strong></span>
      <span><small>Missing</small><strong>${Number(missing.length || 0).toLocaleString()}</strong></span>
    </div>
    <div class="source-import-preview-grid">
      <section class="mapping-card">
        <h3>SKU preview</h3>
        <div class="source-import-sku-list">
          ${pending.skus.slice(0, 80).map((sku) => `<span>${html(sku)}</span>`).join("") || `<p class="muted">No SKUs detected. Use a sku column or one SKU per line.</p>`}
        </div>
      </section>
      <section class="mapping-card">
        <h3>Missing after import</h3>
        <div class="source-import-sku-list missing">
          ${missing.slice(0, 100).map((sku) => `<span>${html(sku)}</span>`).join("") || `<p class="muted">${result ? "All requested SKUs were found in the source catalog." : "Missing SKUs will appear here after import."}</p>`}
        </div>
      </section>
    </div>
  `;
  const runButton = $("[data-run-source-sku-import]");
  if (runButton) runButton.disabled = pending.running || !pending.skus.length || Boolean(result);
}

async function runSourceSkuImport() {
  if (!pendingSourceSkuImport.csv || pendingSourceSkuImport.running) return;
  pendingSourceSkuImport.running = true;
  pendingSourceSkuImport.error = "";
  renderSourceSkuImportModal();
  try {
    const result = await api("/api/catalog/promote-csv", {
      method: "POST",
      body: JSON.stringify({ csv: pendingSourceSkuImport.csv, fileName: pendingSourceSkuImport.fileName })
    });
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    pendingSourceSkuImport = { ...pendingSourceSkuImport, running: false, result };
    setState(result.state);
    sourceCatalogPage = 1;
    renderCatalog();
    renderSourceSkuImportModal();
    const missing = result.missing?.length ? ` ${result.missing.length} not found.` : "";
    toast(`Added ${result.changed} of ${result.requested} SKU${result.requested === 1 ? "" : "s"} to active catalog.${missing}`);
  } catch (error) {
    pendingSourceSkuImport.running = false;
    pendingSourceSkuImport.error = error.message;
    renderSourceSkuImportModal();
  }
}

async function applyCatalogBulkAction() {
  const action = $("#catalog-bulk-action")?.value || "";
  if (!action) {
    toast("Choose a bulk action.");
    return;
  }
  if (catalogTab === "source") {
    if (selectedSourceAllFiltered) return toast("Select current page or individual source products before applying bulk actions.");
    const skus = [...selectedSourceSkus];
    if (!skus.length) return toast("Select source catalog products first.");
    if (action === "delete" && !confirm(`Hide ${skus.length} source catalog product${skus.length === 1 ? "" : "s"} from this catalog view?`)) return;
    const result = await api("/api/catalog/bulk", {
      method: "POST",
      body: JSON.stringify({ skus, action })
    });
    setState(result.state);
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    renderCatalog();
    toast(sourceCatalogActionMessage(action, result.changed));
    return;
  }

  const ids = selectedProductAllFiltered ? filteredCatalogItems().map((item) => item.id) : [...selectedProductIds];
  if (!ids.length) return toast("Select active products first.");
  if (action === "delete" && !confirm(`Delete ${ids.length} product${ids.length === 1 ? "" : "s"} from Products?`)) return;
  const result = await api("/api/inventory/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action })
  });
  setState(result.state);
  selectedProductIds.clear();
  selectedProductAllFiltered = false;
  renderCatalog();
  toast(productActionMessage(action, result.changed));
}

function productActionMessage(action, count) {
  const label = {
    delete: "Deleted",
    "set-active": "Set active",
    "set-inactive": "Set inactive",
    "set-discontinued": "Set discontinued"
  }[action] || "Updated";
  return `${label} ${count} product${count === 1 ? "" : "s"}.`;
}

function sourceCatalogActionMessage(action, count) {
  const label = {
    "add-active": "Added to active catalog",
    delete: "Hidden from Source Catalog",
    "set-active": "Set active",
    "set-inactive": "Set inactive",
    "set-discontinued": "Set discontinued"
  }[action] || "Updated";
  return `${label} ${count} source product${count === 1 ? "" : "s"}.`;
}

async function runProductRowAction(id, action) {
  if (action === "delete" && !confirm("Delete this product from Products?")) return;
  const result = await api("/api/inventory/bulk", {
    method: "POST",
    body: JSON.stringify({ ids: [id], action })
  });
  setState(result.state);
  selectedProductIds.delete(id);
  selectedProductAllFiltered = false;
  renderCatalog();
  toast(productActionMessage(action, result.changed));
}

async function runSourceCatalogRowAction(sku, action) {
  if (action === "delete" && !confirm("Hide this product from Source Catalog?")) return;
  const result = await api("/api/catalog/bulk", {
    method: "POST",
    body: JSON.stringify({ skus: [sku], action })
  });
  setState(result.state);
  selectedSourceSkus.delete(sku);
  selectedSourceAllFiltered = false;
  renderCatalog();
  toast(sourceCatalogActionMessage(action, result.changed));
}

async function exportProductsFromProductsTab() {
  const templateId = $("#product-export-template")?.value || selectedExportMappingId;
  if (!templateId) return toast("Choose an export mapping.");
  selectedExportMappingId = templateId;
  const selectedSkus = [...selectedProductIds]
    .map((id) => (state.inventory || []).find((item) => item.id === id)?.sku)
    .filter(Boolean);
  const filteredSkus = selectedSkus.length && !selectedProductAllFiltered
    ? selectedSkus
    : filteredCatalogItems().map((item) => item.sku).filter(Boolean);
  if (!filteredSkus.length) return toast("No products match this export.");
  const result = await api(`/api/export-mappings/${templateId}/export`, {
    method: "POST",
    body: JSON.stringify({ skus: filteredSkus })
  });
  downloadCsvResult(result, "product-export.csv");
  toast(`Exported ${Number(result.count || 0).toLocaleString()} product${result.count === 1 ? "" : "s"}.`);
}

async function exportSourceCatalogProducts() {
  const templateId = $("#source-export-template")?.value || selectedExportMappingId;
  if (!templateId) return toast("Choose an export mapping.");
  selectedExportMappingId = templateId;
  const body = selectedSourceAllFiltered || !selectedSourceSkus.size
    ? { query: $("#catalog-search")?.value.trim() || "", filters: catalogFilters() }
    : { skus: [...selectedSourceSkus] };
  const result = await api("/api/catalog/export", {
    method: "POST",
    body: JSON.stringify({ ...body, mappingId: templateId })
  });
  downloadCsvResult(result, "source-catalog-export.csv");
  const limited = result.limited && result.matched > result.count ? ` of ${Number(result.matched).toLocaleString()} matched` : "";
  toast(`Exported ${Number(result.count || 0).toLocaleString()}${limited} source product${result.count === 1 ? "" : "s"}.`);
}

function downloadCsvResult(result, fallbackName) {
  const blob = new Blob([result.csv || ""], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  const jumpButton = event.target.closest("[data-view-jump]");
  const confirmButton = event.target.closest("[data-confirm-order]");
  const syncButton = event.target.closest("[data-sync-source]");
  const orderButton = event.target.closest("[data-select-order]");
  const poButton = event.target.closest("[data-select-po]");
  const productButton = event.target.closest("[data-select-product]");
  const productWorkspaceTabButton = event.target.closest("[data-product-workspace-tab]");
  const shadowButton = event.target.closest("[data-select-shadow]");
  const templateButton = event.target.closest("[data-select-template]");
  const categoryButton = event.target.closest("[data-select-category]");
  const categoryScopeButton = event.target.closest("[data-category-scope]");
  const clearJobFiltersButton = event.target.closest("[data-clear-job-filters]");
  const channelButton = event.target.closest("[data-select-channel]");
  const exchangeTemuButton = event.target.closest("[data-exchange-temu-code]");
  const actionMenuButton = event.target.closest("[data-action-menu]");
  const orderActionButton = event.target.closest("[data-order-action]");
  const openDetailButton = event.target.closest("[data-open-detail]");
  const addNoteButton = event.target.closest("[data-add-order-note]");
  const orderCheck = event.target.closest("[data-order-check]");
  const createPoOrder = event.target.closest("[data-create-po-order]");
  const createPoSelected = event.target.closest("[data-create-po-selected]");
  const clearOrderSelection = event.target.closest("[data-clear-order-selection]");
  const orderBulkActionButton = event.target.closest("[data-order-bulk-action]");
  const toggleOrderDetailAction = event.target.closest("[data-toggle-order-detail-action]");
  const purchasingTabButton = event.target.closest("[data-purchasing-tab]");
  const catalogTabButton = event.target.closest("[data-catalog-tab]");
  const sourcePageButton = event.target.closest("[data-source-page]");
  const promoteCatalogButton = event.target.closest("[data-promote-catalog-sku]");
  const sourceRowActionButton = event.target.closest("[data-source-row-action]");
  const applyShopifyTaxonomyButton = event.target.closest("[data-apply-shopify-taxonomy]");
  const reviewActionButton = event.target.closest("[data-review-action]");
  const reviewBulkActionButton = event.target.closest("[data-review-bulk-action]");
  const reviewOpenProductButton = event.target.closest("[data-review-open-product]");
  const exportMappingButton = event.target.closest("[data-select-export-mapping]");
  const openExportMappingButton = event.target.closest("[data-open-export-mapping]");
  const backExportMappingsButton = event.target.closest("[data-back-export-mappings]");
  const createExportMappingButton = event.target.closest("[data-create-export-mapping]");
  const saveExportMappingButton = event.target.closest("[data-save-export-mapping]");
  const duplicateExportMappingButton = event.target.closest("[data-duplicate-export-mapping]");
  const deleteExportMappingButton = event.target.closest("[data-delete-export-mapping]");
  const addExportMappingRowButton = event.target.closest("[data-add-export-mapping-row]");
  const removeExportMappingRowButton = event.target.closest("[data-remove-export-mapping-row]");
  const openProductImportButton = event.target.closest("[data-open-product-import]");
  const closeProductImportButton = event.target.closest("[data-close-product-import-modal]");
  const closeExportMappingCreateButton = event.target.closest("[data-close-export-mapping-create-modal]");
  const runProductImportButton = event.target.closest("[data-run-product-import]");
  const closeSourceSkuImportButton = event.target.closest("[data-close-source-sku-import-modal]");
  const runSourceSkuImportButton = event.target.closest("[data-run-source-sku-import]");
  const importSectionButton = event.target.closest("[data-import-section]");
  const refreshImportJobsButton = event.target.closest("[data-refresh-import-jobs]");
  const selectImportJobButton = event.target.closest("[data-select-import-job]");
  const stopJobButton = event.target.closest("[data-job-stop]");
  const runJobButton = event.target.closest("[data-job-run]");
  const exportProductsButton = event.target.closest("[data-export-products]");
  const exportSourceProductsButton = event.target.closest("[data-export-source-products]");
  const copyFieldButton = event.target.closest("[data-copy-field]");
  const sourceCheck = event.target.closest("[data-source-check]");
  const sourceCheckAll = event.target.closest("[data-source-check-all]");
  const selectSourcePageButton = event.target.closest("[data-select-source-page]");
  const selectSourceFilteredButton = event.target.closest("[data-select-source-filtered]");
  const clearSourceSelectionButton = event.target.closest("[data-clear-source-selection]");
  const sourceSupplierCheck = event.target.closest("[data-source-supplier]");
  const toggleSupplierFilterButton = event.target.closest("[data-toggle-supplier-filter]");
  const clearSourceSuppliersButton = event.target.closest("[data-clear-source-suppliers]");
  const removeSourceSupplierButton = event.target.closest("[data-remove-source-supplier]");
  const productCheck = event.target.closest("[data-product-check]");
  const productCheckAll = event.target.closest("[data-product-check-all]");
  const productRowActionButton = event.target.closest("[data-product-row-action]");
  const productPageButton = event.target.closest("[data-product-page]");
  const inventoryPageButton = event.target.closest("[data-inventory-page]");
  const selectProductsPageButton = event.target.closest("[data-select-products-page]");
  const selectProductsFilteredButton = event.target.closest("[data-select-products-filtered]");
  const clearProductsSelectionButton = event.target.closest("[data-clear-products-selection]");
  const vendorButton = event.target.closest("[data-select-vendor]");
  const brandButton = event.target.closest("[data-select-brand]");
  const customerButton = event.target.closest("[data-select-customer]");
  const returnButton = event.target.closest("[data-select-return]");
  const warehouseButton = event.target.closest("[data-select-warehouse]");
  const vendorActionButton = event.target.closest("[data-vendor-action]");
  const brandActionButton = event.target.closest("[data-brand-action]");
  const menuGroupsToggle = event.target.closest("[data-toggle-menu-groups]");
  const addCustomerAddressButton = event.target.closest("[data-add-customer-address]");
  const poSubmitButton = event.target.closest("[data-po-submit]");
  const poActionButton = event.target.closest("[data-po-action]");
  const openPoReceiveButton = event.target.closest("[data-open-po-receive]");
  const toggleSerialsButton = event.target.closest("[data-toggle-serials]");
  const fillNoSerialButton = event.target.closest("[data-fill-no-serial]");
  const togglePasteButton = event.target.closest("[data-toggle-paste]");
  const applyPasteButton = event.target.closest("[data-apply-paste]");
  const skipSerialButton = event.target.closest("[data-skip-serial]");
  const receiveOpenAllButton = event.target.closest("[data-receive-open-all]");
  const receiveCollapseAllButton = event.target.closest("[data-receive-collapse-all]");
  const receiveAllButton = event.target.closest("[data-receive-all]");
  const receiveNoneButton = event.target.closest("[data-receive-none]");
  const applyPoPasteButton = event.target.closest("[data-apply-po-paste]");
  const addReceiveAttachmentButton = event.target.closest("[data-add-receive-attachment]");
  const removeReceiveAttachmentButton = event.target.closest("[data-remove-receive-attachment]");
  const addOrderReturnAttachmentButton = event.target.closest("[data-add-order-return-attachment]");
  const removeOrderReturnAttachmentButton = event.target.closest("[data-remove-order-return-attachment]");
  const addReturnReceiveAttachmentButton = event.target.closest("[data-add-return-receive-attachment]");
  const removeReturnReceiveAttachmentButton = event.target.closest("[data-remove-return-receive-attachment]");
  const addReturnWorkflowAttachmentButton = event.target.closest("[data-add-return-workflow-attachment]");
  const removeReturnWorkflowAttachmentButton = event.target.closest("[data-remove-return-workflow-attachment]");
  const savePoDraftButton = event.target.closest("[data-save-po-draft]");
  const finalPoReceiveButton = event.target.closest("[data-final-po-receive]");
  const poReturnButton = event.target.closest("[data-po-return]");
  const openOrderReturnButton = event.target.closest("[data-open-order-return]");
  const openOrderRefundButton = event.target.closest("[data-open-order-refund]");
  const openOrderReserveButton = event.target.closest("[data-open-order-reserve]");
  const openOrderEditButton = event.target.closest("[data-open-order-edit]");
  const openReturnWorkflowButton = event.target.closest("[data-open-return-workflow]");
  const openReturnReceiveButton = event.target.closest("[data-open-return-receive]");
  const createBrandButton = event.target.closest("[data-create-brand]");
  const createVendorButton = event.target.closest("[data-create-vendor]");
  const createWarehouseButton = event.target.closest("[data-create-warehouse]");
  const warehouseStatusButton = event.target.closest("[data-warehouse-status]");
  const openWarehouseBinButton = event.target.closest("[data-open-warehouse-bin]");
  const createCustomerButton = event.target.closest("[data-create-customer]");
  const draftButton = event.target.closest("[data-select-draft]");
  const openDraftDetailButton = event.target.closest("[data-open-draft-detail]");
  const openManualOrderButton = event.target.closest("[data-open-manual-order]");
  const addDraftLineButton = event.target.closest("[data-add-draft-line]");
  const removeDraftLineButton = event.target.closest("[data-remove-draft-line]");
  const editDraftButton = event.target.closest("[data-edit-draft]");
  const duplicateDraftButton = event.target.closest("[data-duplicate-draft]");
  const duplicateOrderButton = event.target.closest("[data-duplicate-order]");
  const convertDraftButton = event.target.closest("[data-convert-draft]");
  const createShadowButton = event.target.closest("[data-create-shadow]");
  const bulkCreateShadowsButton = event.target.closest("[data-bulk-create-shadows]");
  const shadowSyncButton = event.target.closest("[data-shadow-sync]");
  const serialActionButton = event.target.closest("[data-serial-action]");
  const openReceiptDetailButton = event.target.closest("[data-open-receipt-detail]");
  const templateActionButton = event.target.closest("[data-template-action]");
  const closeVendorModalButton = event.target.closest("[data-close-vendor-modal]");
  const closeManualOrderModalButton = event.target.closest("[data-close-manual-order-modal]");
  const closeOrderEditModalButton = event.target.closest("[data-close-order-edit-modal]");
  const closeOrderRefundModalButton = event.target.closest("[data-close-order-refund-modal]");
  const closeReturnWorkflowModalButton = event.target.closest("[data-close-return-workflow-modal]");
  const closeReturnReceiveModalButton = event.target.closest("[data-close-return-receive-modal]");
  const closeWarehouseModalButton = event.target.closest("[data-close-warehouse-modal]");
  const closeWarehouseBinModalButton = event.target.closest("[data-close-warehouse-bin-modal]");
  const closeShadowModalButton = event.target.closest("[data-close-shadow-modal]");
  const closeFulfillmentModalButton = event.target.closest("[data-close-fulfillment-modal]");
  const closeOrderReturnModalButton = event.target.closest("[data-close-order-return-modal]");
  const closeOrderReserveModalButton = event.target.closest("[data-close-order-reserve-modal]");
  const openInventoryTransferButton = event.target.closest("[data-open-inventory-transfer]");
  const closeInventoryTransferModalButton = event.target.closest("[data-close-inventory-transfer-modal]");
  const closePoReceiveModalButton = event.target.closest("[data-close-po-receive-modal]");
  const closePoDuplicateModalButton = event.target.closest("[data-close-po-duplicate-modal]");
  const closeReceiptDetailModalButton = event.target.closest("[data-close-receipt-detail-modal]");
  const topbarSyncButton = event.target.closest("[data-topbar-sync]");
  const openExistingPoButton = event.target.closest("[data-open-existing-po]");
  const forceCreatePoButton = event.target.closest("[data-force-create-po]");
  const openFulfillmentButton = event.target.closest("[data-open-fulfillment]");
  const themeToggleButton = event.target.closest("[data-toggle-theme]");
  const productGalleryButton = event.target.closest("[data-product-gallery-image]");
  const openProductImagesButton = event.target.closest("[data-open-product-images]");
  const closeProductImagesButton = event.target.closest("[data-close-product-images-modal]");
  const addProductImageButton = event.target.closest("[data-add-product-image]");
  const addSourceProductImageButton = event.target.closest("[data-add-source-product-image]");
  const removeProductImageButton = event.target.closest("[data-remove-product-image]");
  const setDefaultProductImageButton = event.target.closest("[data-set-default-product-image]");
  const saveProductImagesButton = event.target.closest("[data-save-product-images]");
  const openProductBulletsButton = event.target.closest("[data-open-product-bullets]");
  const closeProductBulletsButton = event.target.closest("[data-close-product-bullets-modal]");
  const addProductBulletButton = event.target.closest("[data-add-product-bullet]");
  const removeProductBulletButton = event.target.closest("[data-remove-product-bullet]");
  const saveProductBulletsButton = event.target.closest("[data-save-product-bullets]");

  if (categoryButton) {
    selectedCategoryId = categoryButton.dataset.selectCategory;
    shopifyTaxonomyState = { categoryId: selectedCategoryId, query: "", results: [], total: 0, version: "", loading: false };
    renderCategories();
    return;
  }
  if (categoryScopeButton) {
    categoryScope = categoryScopeButton.dataset.categoryScope === "source" ? "source" : "main";
    selectedCategoryId = null;
    shopifyTaxonomyState = { categoryId: null, query: "", results: [], total: 0, version: "", loading: false };
    categoryRequestId += 1;
    loadCategories();
    return;
  }
  if (clearJobFiltersButton) {
    jobsFilter = { query: "", section: "", status: "", direction: "" };
    renderJobsPage();
    return;
  }
  if (applyShopifyTaxonomyButton) {
    applyShopifyTaxonomyCategory(applyShopifyTaxonomyButton).catch((error) => toast(error.message));
    return;
  }
  if (reviewActionButton) {
    applyCatalogImportReview(reviewActionButton.dataset.reviewId, reviewActionButton.dataset.reviewAction).catch((error) => toast(error.message));
    return;
  }
  if (reviewBulkActionButton) {
    applyCatalogImportReviewBulk(reviewBulkActionButton.dataset.reviewBulkAction).catch((error) => toast(error.message));
    return;
  }
  if (reviewOpenProductButton) {
    openProductFromReviewSku(reviewOpenProductButton.dataset.reviewOpenProduct);
    return;
  }
  if (productWorkspaceTabButton) {
    selectedProductWorkspaceTab = productWorkspaceTabButton.dataset.productWorkspaceTab || "home";
    renderProductContentPage();
    return;
  }
  if (productGalleryButton) {
    selectedProductGalleryImageById[productGalleryButton.dataset.productId] = productGalleryButton.dataset.productGalleryImage || "";
    renderProductContentPage();
    return;
  }
  if (openProductImagesButton) {
    openProductImagesModal(openProductImagesButton.dataset.openProductImages);
    return;
  }
  if (closeProductImagesButton) {
    closeProductImagesModal();
    return;
  }
  if (addProductImageButton) {
    syncProductImageModalInputs();
    pendingProductImageManager.images.push("");
    renderProductImagesModal();
    return;
  }
  if (addSourceProductImageButton) {
    syncProductImageModalInputs();
    const image = addSourceProductImageButton.dataset.addSourceProductImage || "";
    if (image && !pendingProductImageManager.images.includes(image)) pendingProductImageManager.images.push(image);
    if (!pendingProductImageManager.defaultImage) pendingProductImageManager.defaultImage = image;
    renderProductImagesModal();
    return;
  }
  if (removeProductImageButton) {
    syncProductImageModalInputs();
    pendingProductImageManager.images.splice(Number(removeProductImageButton.dataset.removeProductImage), 1);
    if (!pendingProductImageManager.images.length) pendingProductImageManager.images.push("");
    if (!pendingProductImageManager.images.includes(pendingProductImageManager.defaultImage)) {
      pendingProductImageManager.defaultImage = pendingProductImageManager.images.find(Boolean) || "";
    }
    renderProductImagesModal();
    return;
  }
  if (setDefaultProductImageButton) {
    syncProductImageModalInputs();
    pendingProductImageManager.defaultImage = pendingProductImageManager.images[Number(setDefaultProductImageButton.dataset.setDefaultProductImage)] || "";
    renderProductImagesModal();
    return;
  }
  if (saveProductImagesButton) {
    saveProductImagesModal().catch((error) => toast(error.message));
    return;
  }
  if (openProductBulletsButton) {
    openProductBulletsModal(openProductBulletsButton.dataset.openProductBullets);
    return;
  }
  if (closeProductBulletsButton) {
    closeProductBulletsModal();
    return;
  }
  if (addProductBulletButton) {
    syncProductBulletModalInputs();
    pendingProductBulletManager.bulletPoints.push("");
    renderProductBulletsModal();
    return;
  }
  if (removeProductBulletButton) {
    syncProductBulletModalInputs();
    pendingProductBulletManager.bulletPoints.splice(Number(removeProductBulletButton.dataset.removeProductBullet), 1);
    if (!pendingProductBulletManager.bulletPoints.length) pendingProductBulletManager.bulletPoints.push("");
    renderProductBulletsModal();
    return;
  }
  if (saveProductBulletsButton) {
    saveProductBulletsModal().catch((error) => toast(error.message));
    return;
  }
  if (importSectionButton) {
    activeImportSection = importSectionButton.dataset.importSection || "products";
    renderImportExportMappings();
    return;
  }
  if (refreshImportJobsButton) {
    refreshImportJobs().catch((error) => toast(error.message));
    return;
  }
  if (selectImportJobButton && currentViewId === "jobs" && !event.target.closest("a, button, input, select, summary")) {
    selectedImportJobId = selectImportJobButton.dataset.selectImportJob;
    renderJobsPage();
    return;
  }
  if (stopJobButton && !stopJobButton.disabled) {
    stopImportJob(stopJobButton.dataset.jobStop).catch((error) => toast(error.message));
    return;
  }
  if (runJobButton) {
    const job = importJobRows().find((row) => row.id === runJobButton.dataset.jobRun);
    activeImportSection = jobImportSection(job);
    showView("import-export");
    toast("Opened the matching import area.");
    return;
  }
  if (exportMappingButton) {
    selectedExportMappingId = exportMappingButton.dataset.selectExportMapping;
    activeExportMappingPageId = exportMappingButton.dataset.selectExportMapping;
    renderImportExportMappings();
    return;
  }
  if (openExportMappingButton) {
    selectedExportMappingId = openExportMappingButton.dataset.openExportMapping;
    activeExportMappingPageId = openExportMappingButton.dataset.openExportMapping;
    mappingDraftDirty = false;
    renderImportExportMappings();
    return;
  }
  if (backExportMappingsButton) {
    activeExportMappingPageId = null;
    mappingDraftDirty = false;
    renderImportExportMappings();
    return;
  }
  if (createExportMappingButton) {
    openExportMappingCreateModal();
    return;
  }
  if (closeExportMappingCreateButton) {
    closeExportMappingCreateModal();
    return;
  }
  if (saveExportMappingButton) {
    saveExportMappingDraft(saveExportMappingButton.dataset.saveExportMapping).catch((error) => toast(error.message));
    return;
  }
  if (duplicateExportMappingButton) {
    duplicateExportMapping(duplicateExportMappingButton.dataset.duplicateExportMapping).catch((error) => toast(error.message));
    return;
  }
  if (deleteExportMappingButton) {
    deleteExportMapping(deleteExportMappingButton.dataset.deleteExportMapping).catch((error) => toast(error.message));
    return;
  }
  if (addExportMappingRowButton) {
    addExportMappingRow(addExportMappingRowButton.dataset.addExportMappingRow);
    return;
  }
  if (removeExportMappingRowButton) {
    removeExportMappingRow(removeExportMappingRowButton.dataset.removeExportMappingRow, removeExportMappingRowButton.dataset.mappingRowIndex);
    return;
  }
  if (openProductImportButton) {
    openProductImportModal(openProductImportButton.dataset.openProductImport);
    return;
  }
  if (closeProductImportButton) {
    closeProductImportModal();
    return;
  }
  if (runProductImportButton) {
    runProductImport().catch((error) => toast(error.message));
    return;
  }
  if (closeSourceSkuImportButton) {
    closeSourceSkuImportModal();
    return;
  }
  if (runSourceSkuImportButton) {
    runSourceSkuImport().catch((error) => toast(error.message));
    return;
  }
  if (exportProductsButton) {
    exportProductsFromProductsTab().catch((error) => toast(error.message));
    return;
  }
  if (exportSourceProductsButton) {
    exportSourceCatalogProducts().catch((error) => toast(error.message));
    return;
  }
  if (copyFieldButton) {
    navigator.clipboard?.writeText(copyFieldButton.dataset.copyField || "");
    toast(`Field key: ${copyFieldButton.dataset.copyField}`);
    return;
  }
  if (themeToggleButton) {
    themeMode = themeMode === "dark" ? "light" : "dark";
    localStorage.setItem("dataplus-theme", themeMode);
    applyTheme();
    return;
  }
  if (closeFulfillmentModalButton) {
    closeFulfillmentModal();
    return;
  }
  if (closeOrderReturnModalButton) {
    closeOrderReturnModal();
    return;
  }
  if (closeOrderReserveModalButton) {
    closeOrderReserveModal();
    return;
  }
  if (closeInventoryTransferModalButton) {
    closeInventoryTransferModal();
    return;
  }
  if (closePoReceiveModalButton) {
    closePoReceiveModal();
    return;
  }
  if (closePoDuplicateModalButton) {
    closePoDuplicateModal();
    return;
  }
  if (closeReceiptDetailModalButton) {
    closeReceiptDetailModal();
    return;
  }
  if (closeManualOrderModalButton) {
    closeManualOrderModal();
    return;
  }
  if (closeOrderEditModalButton) {
    closeOrderEditModal();
    return;
  }
  if (closeOrderRefundModalButton) {
    closeOrderRefundModal();
    return;
  }
  if (closeReturnWorkflowModalButton) {
    closeReturnWorkflowModal();
    return;
  }
  if (closeReturnReceiveModalButton) {
    closeReturnReceiveModal();
    return;
  }
  if (openExistingPoButton) {
    openExistingPoFromDuplicate();
    return;
  }
  if (forceCreatePoButton) {
    const ids = [...pendingPoCreateOrderIds];
    closePoDuplicateModal();
    createPurchaseOrder(ids, { force: true });
    return;
  }
  if (topbarSyncButton) {
    $("#sync-all")?.click();
    return;
  }
  if (openManualOrderButton) {
    closeActionMenus();
    openManualOrderModal();
    return;
  }
  if (addDraftLineButton) {
    addManualOrderLine();
    return;
  }
  if (removeDraftLineButton) {
    removeManualOrderLine(removeDraftLineButton.dataset.removeDraftLine);
    return;
  }
  if (editDraftButton) {
    closeActionMenus();
    openManualOrderModal(editDraftButton.dataset.editDraft);
    return;
  }
  if (duplicateDraftButton) {
    closeActionMenus();
    duplicateDraftAsNewDraft(duplicateDraftButton.dataset.duplicateDraft).catch((error) => toast(error.message));
    return;
  }
  if (duplicateOrderButton) {
    closeActionMenus();
    duplicateOrderAsDraft(duplicateOrderButton.dataset.duplicateOrder).catch((error) => toast(error.message));
    return;
  }
  if (convertDraftButton) {
    closeActionMenus();
    convertDraftToOrder(convertDraftButton.dataset.convertDraft).catch((error) => toast(error.message));
    return;
  }
  if (openFulfillmentButton) {
    event.stopPropagation();
    openFulfillmentModal(openFulfillmentButton.dataset.openFulfillment);
    return;
  }
  if (openOrderReturnButton) {
    event.stopPropagation();
    closeActionMenus();
    openOrderReturnModal(openOrderReturnButton.dataset.openOrderReturn);
    return;
  }
  if (openOrderRefundButton) {
    event.stopPropagation();
    closeActionMenus();
    openOrderRefundModal(openOrderRefundButton.dataset.openOrderRefund);
    return;
  }
  if (openOrderEditButton) {
    event.stopPropagation();
    closeActionMenus();
    openOrderEditModal(openOrderEditButton.dataset.openOrderEdit);
    return;
  }
  if (openReturnWorkflowButton) {
    event.stopPropagation();
    closeActionMenus();
    openReturnWorkflowModal(openReturnWorkflowButton.dataset.openReturnWorkflow);
    return;
  }
  if (openReturnReceiveButton) {
    event.stopPropagation();
    closeActionMenus();
    openReturnReceiveModal(openReturnReceiveButton.dataset.openReturnReceive);
    return;
  }
  if (openOrderReserveButton) {
    event.stopPropagation();
    closeActionMenus();
    openOrderReserveModal(openOrderReserveButton.dataset.openOrderReserve);
    return;
  }
  if (openInventoryTransferButton) {
    event.stopPropagation();
    closeActionMenus();
    openInventoryTransferModal(openInventoryTransferButton.dataset.openInventoryTransfer);
    return;
  }
  if (openPoReceiveButton) {
    event.stopPropagation();
    closeActionMenus();
    openPoReceiveModal(openPoReceiveButton.dataset.openPoReceive);
    return;
  }
  if (addReceiveAttachmentButton) {
    $("#po-receive-file-input")?.click();
    return;
  }
  if (removeReceiveAttachmentButton) {
    receiveAttachments.splice(Number(removeReceiveAttachmentButton.dataset.removeReceiveAttachment), 1);
    renderReceiveAttachments();
    return;
  }
  if (addOrderReturnAttachmentButton) {
    $("#order-return-file-input")?.click();
    return;
  }
  if (removeOrderReturnAttachmentButton) {
    returnDraftAttachments.splice(Number(removeOrderReturnAttachmentButton.dataset.removeOrderReturnAttachment), 1);
    renderReturnAttachmentList("#order-return-attachments", returnDraftAttachments, "data-remove-order-return-attachment", "No images attached.");
    return;
  }
  if (addReturnReceiveAttachmentButton) {
    $("#return-receive-file-input")?.click();
    return;
  }
  if (removeReturnReceiveAttachmentButton) {
    returnReceiveAttachments.splice(Number(removeReturnReceiveAttachmentButton.dataset.removeReturnReceiveAttachment), 1);
    renderReturnAttachmentList("#return-receive-attachments", returnReceiveAttachments, "data-remove-return-receive-attachment", "No receiving images added.");
    return;
  }
  if (addReturnWorkflowAttachmentButton) {
    $("#return-workflow-file-input")?.click();
    return;
  }
  if (removeReturnWorkflowAttachmentButton) {
    returnWorkflowAttachments.splice(Number(removeReturnWorkflowAttachmentButton.dataset.removeReturnWorkflowAttachment), 1);
    renderReturnAttachmentList("#return-workflow-attachments", returnWorkflowAttachments, "data-remove-return-workflow-attachment", "No inspection images added.");
    return;
  }
  if (savePoDraftButton) {
    $("#po-receive-mode").value = "draft";
    $("#po-receive-form")?.requestSubmit();
    return;
  }
  if (finalPoReceiveButton) {
    $("#po-receive-mode").value = "final";
  }
  if (receiveOpenAllButton) {
    $$("#po-receive-lines .serial-capture").forEach((node) => node.classList.add("open"));
    $$("[data-toggle-serials]").forEach((button) => { button.textContent = "Hide"; });
    return;
  }
  if (receiveCollapseAllButton) {
    $$("#po-receive-lines .serial-capture").forEach((node) => node.classList.remove("open"));
    $$("[data-toggle-serials]").forEach((button) => { button.textContent = "Show"; });
    return;
  }
  if (toggleSerialsButton) {
    const index = toggleSerialsButton.dataset.toggleSerials;
    const target = $(`[data-serial-capture="${index}"]`);
    if (target) {
      target.classList.toggle("open");
      toggleSerialsButton.textContent = target.classList.contains("open") ? "Hide" : "Show";
    }
    return;
  }
  if (receiveAllButton) {
    applyReceiveAllRemaining();
    return;
  }
  if (receiveNoneButton) {
    applyReceiveNone();
    return;
  }
  if (applyPoPasteButton) {
    applyPoSerialPaste();
    return;
  }
  if (fillNoSerialButton) {
    const index = fillNoSerialButton.dataset.fillNoSerial;
    $$(`[data-no-serial="${index}"]`).forEach((checkbox) => {
      checkbox.checked = true;
      const serialInput = document.querySelector(`[data-serial-input="${index}"][data-serial-index="${checkbox.dataset.serialIndex}"]`);
      if (serialInput) {
        serialInput.value = previewGeneratedSerial(index, Number(checkbox.dataset.serialIndex));
        serialInput.disabled = true;
        serialInput.placeholder = "Auto-generated on receive";
      }
    });
    refreshReceiveProgress(index);
    return;
  }
  if (togglePasteButton) {
    const target = $(`[data-serial-paste="${togglePasteButton.dataset.togglePaste}"]`);
    if (target) target.hidden = !target.hidden;
    return;
  }
  if (applyPasteButton) {
    const index = applyPasteButton.dataset.applyPaste;
    const text = $(`[data-paste-serials="${index}"]`)?.value || "";
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    $$(`[data-serial-input="${index}"]`).forEach((input, serialIndex) => {
      const checkbox = document.querySelector(`[data-no-serial="${index}"][data-serial-index="${serialIndex}"]`);
      if (!input || !checkbox) return;
      if (lines[serialIndex]) {
        checkbox.checked = false;
        input.disabled = false;
        input.value = lines[serialIndex];
        input.placeholder = "Serial number";
      }
    });
    refreshReceiveProgress(index);
    return;
  }
  if (skipSerialButton) {
    const index = skipSerialButton.dataset.skipSerial;
    const serialIndex = skipSerialButton.dataset.serialIndex;
    const checkbox = document.querySelector(`[data-no-serial="${index}"][data-serial-index="${serialIndex}"]`);
    const input = document.querySelector(`[data-serial-input="${index}"][data-serial-index="${serialIndex}"]`);
    if (checkbox && input) {
      checkbox.checked = true;
      input.disabled = true;
      input.value = previewGeneratedSerial(index, Number(serialIndex));
      input.placeholder = "Auto-generated on receive";
    }
    refreshReceiveProgress(index);
    return;
  }
  if (serialActionButton) {
    event.stopPropagation();
    closeActionMenus();
    updateSerialUnitAction(serialActionButton.dataset.productId, serialActionButton.dataset.serialId, serialActionButton.dataset.serialAction);
    return;
  }
  if (openReceiptDetailButton) {
    event.stopPropagation();
    openReceiptDetail(openReceiptDetailButton.dataset.openReceiptDetail, openReceiptDetailButton.dataset.receiptType || "receipt");
    return;
  }
  if (closeShadowModalButton) {
    closeShadowModal();
    return;
  }
  if (closeWarehouseModalButton) {
    closeWarehouseModal();
    return;
  }
  if (closeWarehouseBinModalButton) {
    closeWarehouseBinModal();
    return;
  }
  if (closeVendorModalButton) {
    closeVendorModal();
    return;
  }
  if (createShadowButton) {
    event.stopPropagation();
    closeActionMenus();
    openShadowModal(createShadowButton.dataset.createShadow);
    return;
  }
  if (bulkCreateShadowsButton) {
    event.stopPropagation();
    closeActionMenus();
    bulkCreateShadows(bulkCreateShadowsButton.dataset.bulkCreateShadows);
    return;
  }
  if (shadowSyncButton) {
    event.stopPropagation();
    closeActionMenus();
    syncShadow(shadowSyncButton.dataset.productId, shadowSyncButton.dataset.shadowSync);
    return;
  }
  if (templateActionButton) {
    event.stopPropagation();
    closeActionMenus();
    runTemplateAction(templateActionButton.dataset.templateId, templateActionButton.dataset.templateAction);
    return;
  }
  if (createCustomerButton) {
    closeActionMenus();
    createCustomer();
    return;
  }
  if (createVendorButton) {
    closeActionMenus();
    createVendor();
    return;
  }
  if (createWarehouseButton) {
    closeActionMenus();
    openWarehouseModal();
    return;
  }
  if (openWarehouseBinButton) {
    closeActionMenus();
    openWarehouseBinModal(openWarehouseBinButton.dataset.openWarehouseBin);
    return;
  }
  if (warehouseStatusButton) {
    closeActionMenus();
    updateWarehouseStatus(warehouseStatusButton.dataset.warehouseStatus, warehouseStatusButton.dataset.warehouseStatusValue);
    return;
  }
  if (createBrandButton) {
    closeActionMenus();
    createBrand();
    return;
  }
  if (orderBulkActionButton) {
    event.stopPropagation();
    closeActionMenus();
    runSelectedOrderAction(orderBulkActionButton.dataset.orderBulkAction);
    return;
  }
  if (toggleOrderDetailAction) {
    event.stopPropagation();
    closeActionMenus();
    orderDetailVisible = !orderDetailVisible;
    renderOrders();
    return;
  }
  if (poReturnButton) {
    event.stopPropagation();
    createVendorReturn(poReturnButton.dataset.poReturn);
    return;
  }
  if (brandActionButton) {
    event.stopPropagation();
    runBrandAction(brandActionButton.dataset.brandId, brandActionButton.dataset.brandAction);
    return;
  }
  if (poActionButton) {
    event.stopPropagation();
    runPoWorkflowAction(poActionButton.dataset.poAction, poActionButton.dataset.poWorkflow);
    return;
  }
  if (poSubmitButton) {
    event.stopPropagation();
    submitPurchaseOrder(poSubmitButton.dataset.poSubmit, poSubmitButton.dataset.submitMethod);
    return;
  }
  if (addCustomerAddressButton) {
    event.stopPropagation();
    addCustomerAddress(addCustomerAddressButton.dataset.addCustomerAddress, addCustomerAddressButton.dataset.addressType);
    return;
  }
  if (menuGroupsToggle) {
    event.stopPropagation();
    menuGroupsExpanded = !menuGroupsExpanded;
    localStorage.setItem("dataplus-menu-groups-expanded", String(menuGroupsExpanded));
    applyMenuGroupState();
    return;
  }
  if (vendorActionButton) {
    event.stopPropagation();
    runVendorAction(vendorActionButton.dataset.vendorId, vendorActionButton.dataset.vendorAction);
    return;
  }
  if (vendorButton) {
    selectedVendorId = vendorButton.dataset.selectVendor;
    showView("vendor-full");
    return;
  }
  if (brandButton) {
    selectedBrandId = brandButton.dataset.selectBrand;
    showView("brand-full");
    return;
  }
  if (customerButton) {
    selectedCustomerId = customerButton.dataset.selectCustomer;
    showView("customer-full");
    return;
  }
  if (returnButton) {
    selectedReturnId = returnButton.dataset.selectReturn;
    showView("return-full");
    return;
  }
  if (draftButton) {
    selectedDraftId = draftButton.dataset.selectDraft;
    if (openDraftDetailButton) {
      showView("draft-full");
      return;
    }
    renderDrafts();
    return;
  }
  if (warehouseButton) {
    selectedWarehouseId = warehouseButton.dataset.selectWarehouse;
    showView("warehouse-full");
    return;
  }
  if (poButton) {
    selectedPoId = poButton.dataset.selectPo;
    showView("po-full");
    return;
  }
  if (templateButton) {
    selectedTemplateId = templateButton.dataset.selectTemplate;
    showView("template-full");
    return;
  }
  if (channelButton) {
    selectedChannelId = channelButton.dataset.selectChannel;
    showView("channel-full");
    return;
  }
  if (purchasingTabButton) {
    purchasingTab = purchasingTabButton.dataset.purchasingTab;
    renderPurchaseOrders();
    return;
  }
  if (catalogTabButton) {
    catalogTab = catalogTabButton.dataset.catalogTab;
    if (catalogTab === "source") sourceCatalogPage = 1;
    if (catalogTab === "categories") categoryRequestId += 1;
    renderCatalog();
    return;
  }
  if (sourcePageButton) {
    sourceCatalogPage = Math.max(1, Number(sourcePageButton.dataset.sourcePage || 1));
    loadSourceCatalog(sourceCatalogPage);
    return;
  }
  if (sourceRowActionButton) {
    closeActionMenus();
    runSourceCatalogRowAction(sourceRowActionButton.dataset.sourceSku, sourceRowActionButton.dataset.sourceRowAction).catch((error) => toast(error.message));
    return;
  }
  if (promoteCatalogButton) {
    promoteCatalogProduct(promoteCatalogButton.dataset.promoteCatalogSku);
    return;
  }
  if (sourceCheck) {
    selectedSourceAllFiltered = false;
    if (sourceCheck.checked) selectedSourceSkus.add(sourceCheck.dataset.sourceCheck);
    else selectedSourceSkus.delete(sourceCheck.dataset.sourceCheck);
    renderSourceCatalogTable();
    return;
  }
  if (sourceCheckAll) {
    selectedSourceAllFiltered = false;
    for (const item of sourceCatalogState.items || []) {
      if (sourceCheckAll.checked) selectedSourceSkus.add(item.sku);
      else selectedSourceSkus.delete(item.sku);
    }
    renderSourceCatalogTable();
    return;
  }
  if (selectSourcePageButton) {
    selectedSourceAllFiltered = false;
    for (const item of sourceCatalogState.items || []) selectedSourceSkus.add(item.sku);
    renderSourceCatalogTable();
    return;
  }
  if (selectSourceFilteredButton) {
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = true;
    renderSourceCatalogTable();
    return;
  }
  if (clearSourceSelectionButton) {
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    renderSourceCatalogTable();
    return;
  }
  if (toggleSupplierFilterButton) {
    if (event.target.closest("[data-remove-source-supplier]")) {
      selectedSourceSuppliers.delete(event.target.closest("[data-remove-source-supplier]").dataset.removeSourceSupplier);
      sourceCatalogPage = 1;
      selectedSourceSkus.clear();
      selectedSourceAllFiltered = false;
      renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
      renderCatalog();
      return;
    }
    supplierMultiOpen = !supplierMultiOpen;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
    if (supplierMultiOpen) setTimeout(() => $("#supplier-multi-search")?.focus(), 0);
    return;
  }
  if (sourceSupplierCheck) {
    if (sourceSupplierCheck.checked) selectedSourceSuppliers.add(sourceSupplierCheck.dataset.sourceSupplier);
    else selectedSourceSuppliers.delete(sourceSupplierCheck.dataset.sourceSupplier);
    supplierMultiOpen = true;
    sourceCatalogPage = 1;
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
    renderCatalog();
    return;
  }
  if (clearSourceSuppliersButton) {
    selectedSourceSuppliers.clear();
    supplierMultiOpen = true;
    sourceCatalogPage = 1;
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
    renderCatalog();
    return;
  }
  if (removeSourceSupplierButton) {
    selectedSourceSuppliers.delete(removeSourceSupplierButton.dataset.removeSourceSupplier);
    sourceCatalogPage = 1;
    selectedSourceSkus.clear();
    selectedSourceAllFiltered = false;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
    renderCatalog();
    return;
  }
  if (productCheck) {
    selectedProductAllFiltered = false;
    if (productCheck.checked) selectedProductIds.add(productCheck.dataset.productCheck);
    else selectedProductIds.delete(productCheck.dataset.productCheck);
    renderProductsTable(filteredCatalogItems());
    updateCatalogBulkBar();
    return;
  }
  if (productCheckAll) {
    selectedProductAllFiltered = false;
    const items = filteredCatalogItems();
    const pageStart = (productCatalogPage - 1) * PRODUCT_CATALOG_PAGE_SIZE;
    const pageItems = items.slice(pageStart, pageStart + PRODUCT_CATALOG_PAGE_SIZE);
    for (const item of pageItems) {
      if (productCheckAll.checked) selectedProductIds.add(item.id);
      else selectedProductIds.delete(item.id);
    }
    renderProductsTable(items);
    updateCatalogBulkBar();
    return;
  }
  if (productPageButton) {
    productCatalogPage = Math.max(1, Number(productPageButton.dataset.productPage || 1));
    renderProductsTable(filteredCatalogItems());
    return;
  }
  if (inventoryPageButton) {
    inventoryCatalogPage = Math.max(1, Number(inventoryPageButton.dataset.inventoryPage || 1));
    renderInventoryTable(filteredCatalogItems());
    return;
  }
  if (selectProductsPageButton || selectProductsFilteredButton) {
    const items = filteredCatalogItems();
    const pageStart = (productCatalogPage - 1) * PRODUCT_CATALOG_PAGE_SIZE;
    if (selectProductsFilteredButton) {
      selectedProductIds.clear();
      selectedProductAllFiltered = true;
    } else {
      selectedProductAllFiltered = false;
      const nextItems = items.slice(pageStart, pageStart + PRODUCT_CATALOG_PAGE_SIZE);
      for (const item of nextItems) selectedProductIds.add(item.id);
    }
    renderProductsTable(items);
    updateCatalogBulkBar();
    return;
  }
  if (clearProductsSelectionButton) {
    selectedProductIds.clear();
    selectedProductAllFiltered = false;
    renderProductsTable(filteredCatalogItems());
    updateCatalogBulkBar();
    return;
  }
  if (productRowActionButton) {
    closeActionMenus();
    runProductRowAction(productRowActionButton.dataset.productId, productRowActionButton.dataset.productRowAction).catch((error) => toast(error.message));
    return;
  }
  if (orderCheck) {
    event.stopPropagation();
    if (orderCheck.checked) selectedOrderIds.add(orderCheck.dataset.orderCheck);
    else selectedOrderIds.delete(orderCheck.dataset.orderCheck);
    renderBulkOrderBar();
    return;
  }
  if (createPoOrder) {
    event.stopPropagation();
    createPurchaseOrder(createPoOrder.dataset.createPoOrder);
    return;
  }
  if (createPoSelected) {
    closeActionMenus();
    createPurchaseOrder(Array.from(selectedOrderIds));
    return;
  }
  if (clearOrderSelection) {
    closeActionMenus();
    selectedOrderIds.clear();
    renderOrders();
    return;
  }
  if (addNoteButton) {
    addOrderNote(addNoteButton.dataset.addOrderNote);
    return;
  }
  if (orderActionButton) {
    event.stopPropagation();
    runOrderAction(orderActionButton.dataset.orderId, orderActionButton.dataset.orderAction);
    return;
  }
  if (viewButton) {
    if (viewButton.dataset.purchasingTabLink) purchasingTab = viewButton.dataset.purchasingTabLink;
    if (viewButton.dataset.catalogTabLink) catalogTab = viewButton.dataset.catalogTabLink;
    showView(viewButton.dataset.view);
    if (viewButton.dataset.view === "purchasing") renderPurchaseOrders();
    if (viewButton.dataset.view === "catalog") renderCatalog();
    if (viewButton.dataset.view === "jobs") renderJobsPage();
  }
  if (jumpButton) {
    closeActionMenus();
    showView(jumpButton.dataset.viewJump);
    if (jumpButton.dataset.viewJump === "catalog") renderCatalog();
    if (jumpButton.dataset.viewJump === "purchasing") renderPurchaseOrders();
    if (jumpButton.dataset.viewJump === "jobs") renderJobsPage();
  }
  if (confirmButton) confirmOrder(confirmButton.dataset.confirmOrder);
  if (syncButton) syncSource(syncButton.dataset.syncSource);
  if (actionMenuButton) {
    event.stopPropagation();
    const id = actionMenuButton.dataset.actionMenu;
    document.querySelectorAll(".action-popover.open").forEach((menu) => {
      if (menu.dataset.menuFor !== id) menu.classList.remove("open");
    });
    document.querySelector(`[data-menu-for="${id}"]`)?.classList.toggle("open");
    return;
  }
  if (orderButton) {
    selectedOrderId = orderButton.dataset.selectOrder;
    if (openDetailButton) {
      showView("order-full");
      return;
    }
    renderOrders();
  }
  if (productButton) {
    selectedProductId = productButton.dataset.selectProduct;
    if (productButton.dataset.productTarget === "product-full") selectedProductWorkspaceTab = "home";
    if (productButton.dataset.productTarget) {
      closeActionMenus();
      showView(productButton.dataset.productTarget);
    } else {
      renderCatalog();
    }
  }
  if (shadowButton) {
    selectedProductId = shadowButton.dataset.parentProduct || selectedProductId;
    selectedShadowId = shadowButton.dataset.selectShadow;
    showView("shadow-full");
    return;
  }
  if (exchangeTemuButton) exchangeTemuCode();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu")) {
    closeActionMenus();
  }
});

$("#sync-all").addEventListener("click", async () => {
  for (const connection of state.connections) {
    if (connection.settings?.orderDownloadEnabled !== false) await syncSource(connection.name);
  }
});

$("#order-search").addEventListener("input", renderOrders);
$("#order-status").addEventListener("change", renderOrders);
$("#draft-search")?.addEventListener("input", renderDrafts);
$("#return-search")?.addEventListener("input", renderReturnsManagement);
document.addEventListener("input", (event) => {
  const jobsSearch = event.target.closest("#jobs-search");
  if (!jobsSearch) return;
  jobsFilter.query = jobsSearch.value;
  renderJobsPage();
});
document.addEventListener("change", (event) => {
  const section = event.target.closest("#jobs-filter-section");
  const status = event.target.closest("#jobs-filter-status");
  const direction = event.target.closest("#jobs-filter-direction");
  if (!section && !status && !direction) return;
  if (section) jobsFilter.section = section.value;
  if (status) jobsFilter.status = status.value;
  if (direction) jobsFilter.direction = direction.value;
  renderJobsPage();
});
$("#toggle-order-detail")?.addEventListener("click", () => {
  orderDetailVisible = !orderDetailVisible;
  $("#toggle-order-detail").textContent = orderDetailVisible ? "Hide details" : "Show details";
  renderOrders();
});
$("#customer-search").addEventListener("input", renderCustomers);
$("#po-search").addEventListener("input", renderPurchaseOrders);
$("#catalog-search").addEventListener("input", () => {
  if (catalogTab === "source") sourceCatalogPage = 1;
  if (catalogTab === "products") productCatalogPage = 1;
  if (catalogTab === "inventory") inventoryCatalogPage = 1;
  if (catalogTab === "categories") categoryRequestId += 1;
  selectedSourceSkus.clear();
  selectedSourceAllFiltered = false;
  selectedProductIds.clear();
  selectedProductAllFiltered = false;
  renderCatalog();
});
[
  "#catalog-filter-supplier",
  "#catalog-filter-active",
  "#catalog-filter-product-membership",
  "#catalog-filter-stock-status",
  "#catalog-filter-shopify-status",
  "#catalog-filter-has-stock",
  "#catalog-filter-hazardous",
  "#catalog-filter-verified-brand",
  "#catalog-filter-brand",
  "#catalog-filter-category"
].forEach((selector) => {
  $(selector)?.addEventListener("change", () => {
    sourceCatalogPage = 1;
    productCatalogPage = 1;
    inventoryCatalogPage = 1;
    clearCatalogSelection();
  });
});
$("#catalog-clear-filters")?.addEventListener("click", () => {
  $("#catalog-search").value = "";
  selectedSourceSuppliers.clear();
  for (const selector of ["#catalog-filter-supplier", "#catalog-filter-active", "#catalog-filter-product-membership", "#catalog-filter-stock-status", "#catalog-filter-shopify-status", "#catalog-filter-has-stock", "#catalog-filter-hazardous", "#catalog-filter-verified-brand", "#catalog-filter-brand", "#catalog-filter-category"]) {
    const element = $(selector);
    if (element) element.value = "";
  }
  sourceCatalogPage = 1;
  productCatalogPage = 1;
  inventoryCatalogPage = 1;
  clearCatalogSelection();
});
$("#catalog-apply-bulk")?.addEventListener("click", applyCatalogBulkAction);
$("#inventory-import").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importInventory(file);
  event.target.value = "";
});
$("#source-sku-import")?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) openSourceSkuImportModal(file).catch((error) => toast(error.message));
  event.target.value = "";
});
$("#shopify-status-import")?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importShopifyStatusFile(event.target).catch((error) => toast(error.message));
});
$("#category-sku-import")?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importSkuCategories(file).catch((error) => toast(error.message));
  event.target.value = "";
});
$("#category-mapping-import")?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importCategoryMappings(file).catch((error) => toast(error.message));
  event.target.value = "";
});
$("#vendor-create-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitVendorCreate(event.currentTarget);
});
$("#manual-order-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitManualOrder(event.currentTarget).catch((error) => toast(error.message));
});
$("#order-edit-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitOrderEdit(event.currentTarget).catch((error) => toast(error.message));
});
$("#order-refund-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitOrderRefund(event.currentTarget).catch((error) => toast(error.message));
});
$("#return-workflow-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitReturnWorkflow(event.currentTarget).catch((error) => toast(error.message));
});
$("#return-receive-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitReturnReceive(event.currentTarget).catch((error) => toast(error.message));
});
$("#warehouse-create-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWarehouseCreate(event.currentTarget).catch((error) => toast(error.message));
});
$("#warehouse-bin-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWarehouseBin(event.currentTarget).catch((error) => toast(error.message));
});
$("#shadow-create-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitShadowCreate(event.currentTarget);
});
$("#fulfillment-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitFulfillment(event.currentTarget).catch((error) => toast(error.message));
});
$("#order-reserve-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitOrderReserve(event.currentTarget).catch((error) => toast(error.message));
});
$("#inventory-transfer-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitInventoryTransfer(event.currentTarget).catch((error) => toast(error.message));
});
$("#export-mapping-create-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  createExportMapping().catch((error) => toast(error.message));
});
$("#po-receive-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  $("#po-receive-mode").value = $("#po-receive-mode").value || "final";
  submitPoReceive(event.currentTarget).catch((error) => toast(error.message));
});
$("#order-return-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitOrderReturn(event.currentTarget).catch((error) => toast(error.message));
});
$("#fulfillment-carrier")?.addEventListener("change", toggleOtherCarrierFields);
$("#po-receive-scan")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (handleReceiveScan(event.currentTarget.value)) {
    event.currentTarget.value = "";
  } else {
    toast("No matching PO line found for that scan.");
  }
});
$("#po-receive-file-input")?.addEventListener("change", (event) => {
  const files = Array.from(event.currentTarget.files || []);
  if (!files.length) return;
  receiveAttachments.push(...files.map((file) => ({
    name: file.name,
    size: file.size,
    mimeType: file.type,
    source: "File picker"
  })));
  renderReceiveAttachments();
  event.currentTarget.value = "";
});
$("#order-return-file-input")?.addEventListener("change", async (event) => {
  const files = Array.from(event.currentTarget.files || []);
  if (!files.length) return;
  returnDraftAttachments.push(...await readImageAttachments(files));
  renderReturnAttachmentList("#order-return-attachments", returnDraftAttachments, "data-remove-order-return-attachment", "No images attached.");
  event.currentTarget.value = "";
});
$("#return-receive-file-input")?.addEventListener("change", async (event) => {
  const files = Array.from(event.currentTarget.files || []);
  if (!files.length) return;
  returnReceiveAttachments.push(...await readImageAttachments(files));
  renderReturnAttachmentList("#return-receive-attachments", returnReceiveAttachments, "data-remove-return-receive-attachment", "No receiving images added.");
  event.currentTarget.value = "";
});
$("#return-workflow-file-input")?.addEventListener("change", async (event) => {
  const files = Array.from(event.currentTarget.files || []);
  if (!files.length) return;
  returnWorkflowAttachments.push(...await readImageAttachments(files));
  renderReturnAttachmentList("#return-workflow-attachments", returnWorkflowAttachments, "data-remove-return-workflow-attachment", "No inspection images added.");
  event.currentTarget.value = "";
});
document.addEventListener("input", (event) => {
  const dimensionInput = event.target.closest("[data-product-dimension-field]");
  if (dimensionInput) {
    const product = productById(dimensionInput.dataset.productId);
    if (product) {
      const next = {
        ...product,
        [dimensionInput.dataset.productDimensionField]: Number(dimensionInput.value || 0)
      };
      const preview = document.querySelector(`[data-dimensional-weight-preview="${CSS.escape(dimensionInput.dataset.productId)}"]`);
      if (preview) preview.value = calculateDimensionalWeight(next);
    }
  }
  const supplierSearch = event.target.closest("#supplier-multi-search");
  if (supplierSearch) {
    supplierMultiOpen = true;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
    setTimeout(() => {
      const input = $("#supplier-multi-search");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 0);
    return;
  }
  const shopifySearch = event.target.closest("[data-shopify-taxonomy-search]");
  if (shopifySearch) {
    clearTimeout(shopifyTaxonomyTimer);
    const categoryId = shopifySearch.dataset.shopifyTaxonomySearch;
    const query = shopifySearch.value;
    shopifyTaxonomyState = { ...shopifyTaxonomyState, categoryId, query };
    shopifyTaxonomyTimer = setTimeout(() => loadShopifyTaxonomyOptions(categoryId, query), 300);
    return;
  }
  const draftField = event.target.closest("[data-draft-line-field]");
  if (draftField) {
    const id = draftField.dataset.lineId;
    const row = document.querySelector(`[data-draft-line-row="${id}"]`);
    if (row && draftField.dataset.draftLineField === "sku") {
      const inventoryItem = (state.inventory || []).find((item) => String(item.sku || "").toLowerCase() === draftField.value.trim().toLowerCase());
      const titleInput = row.querySelector(`[data-draft-line-field="title"][data-line-id="${id}"]`);
      const priceInput = row.querySelector(`[data-draft-line-field="price"][data-line-id="${id}"]`);
      const costInput = row.querySelector(`[data-draft-line-field="cost"][data-line-id="${id}"]`);
      if (inventoryItem) {
        if (titleInput) titleInput.value = inventoryItem.title || "";
        if (priceInput && Number(priceInput.value || 0) === 0) priceInput.value = inventoryItem.price ?? 0;
        if (costInput) costInput.value = inventoryItem.cost ?? 0;
      } else {
        if (titleInput) titleInput.value = "";
        if (costInput) costInput.value = "0";
      }
    }
    refreshManualOrderTotals();
  }
  if (event.target.closest("[data-receive-line]")) renderReceiveSerialInputs();
  const serialInput = event.target.closest("[data-serial-input]");
  if (serialInput) refreshReceiveProgress(serialInput.dataset.serialInput);
  const refundQtyInput = event.target.closest("[data-refund-line-qty]");
  if (refundQtyInput) {
    const max = Number(refundQtyInput.max || 0);
    const nextValue = Math.max(0, Math.min(max, Number(refundQtyInput.value || 0)));
    refundQtyInput.value = String(nextValue);
    const checkbox = document.querySelector(`[data-refund-line-select="${refundQtyInput.dataset.lineIndex}"]`);
    if (checkbox) checkbox.checked = nextValue > 0;
    refreshOrderRefundTotals();
  }
  const defaultLocationInput = event.target.closest("#po-receive-location");
  if (defaultLocationInput) {
    $$("[data-location-bin]").forEach((input) => {
      if (!input.value) input.placeholder = defaultLocationInput.value ? `Default: ${defaultLocationInput.value}` : "Use default bin";
    });
  }
});

document.addEventListener("click", (event) => {
  if (catalogTab === "source" && supplierMultiOpen && !event.target.closest("#supplier-multi-filter")) {
    supplierMultiOpen = false;
    renderSupplierMultiSelect(sourceCatalogFacets?.suppliers || []);
  }
}, true);

document.addEventListener("change", (event) => {
  const refundSelect = event.target.closest("[data-refund-line-select]");
  if (!refundSelect) return;
  const qtyInput = document.querySelector(`[data-refund-line-qty="${refundSelect.dataset.refundLineSelect}"]`);
  if (!qtyInput) return;
  qtyInput.value = refundSelect.checked ? String(Math.max(1, Math.min(Number(qtyInput.max || 1), Number(qtyInput.value || 1)))) : "0";
  refreshOrderRefundTotals();
});
document.addEventListener("change", (event) => {
  const channelLogoUpload = event.target.closest("[data-channel-logo-upload]");
  if (channelLogoUpload) {
    uploadChannelLogo(channelLogoUpload).catch((error) => toast(error.message));
    event.target.value = "";
    return;
  }
  const noSerial = event.target.closest("[data-no-serial]");
  if (noSerial) {
    const serialInput = document.querySelector(`[data-serial-input="${noSerial.dataset.noSerial}"][data-serial-index="${noSerial.dataset.serialIndex}"]`);
    if (serialInput) {
      serialInput.disabled = noSerial.checked;
      if (noSerial.checked) {
        serialInput.value = previewGeneratedSerial(noSerial.dataset.noSerial, Number(noSerial.dataset.serialIndex));
        serialInput.placeholder = "Auto-generated on receive";
      } else {
        serialInput.value = "";
        serialInput.placeholder = "Serial number";
      }
    }
    refreshReceiveProgress(noSerial.dataset.noSerial);
  }
  const warehouseField = event.target.closest("[data-warehouse-field]");
  if (warehouseField) {
    updateWarehouseField(warehouseField).catch((error) => toast(error.message));
    return;
  }
  const warehouseBinField = event.target.closest("[data-warehouse-bin-field]");
  if (warehouseBinField) {
    updateWarehouseBinField(warehouseBinField).catch((error) => toast(error.message));
    return;
  }
  const receiveWarehouseSelect = event.target.closest("#po-receive-warehouse");
  if (receiveWarehouseSelect) {
    $("#po-receive-location").value = defaultBinForWarehouse(receiveWarehouseSelect.value)?.code || "";
    return;
  }
});
document.addEventListener("keydown", (event) => {
  const serialInput = event.target.closest("[data-serial-input]");
  if (serialInput && event.key === "Enter") {
    event.preventDefault();
    const rowIndex = serialInput.dataset.serialInput;
    const inputs = $$(`[data-serial-input="${rowIndex}"]`);
    const currentIndex = inputs.findIndex((input) => input === serialInput);
    const nextInput = inputs[currentIndex + 1] || $(`[data-receive-line="${Number(rowIndex) + 1}"]`);
    if (nextInput) nextInput.focus();
  }
});
$("#shadow-marketplace")?.addEventListener("change", (event) => {
  const parentSku = $("#shadow-parent-sku")?.value || "";
  const shadowInput = $("#shadow-sku");
  if (shadowInput && (!shadowInput.value || shadowInput.value.startsWith(`${parentSku}-`))) {
    shadowInput.value = `${parentSku}-${event.target.value}`;
  }
  const channel = (state.connections || []).find((row) => row.name === event.target.value);
  if (channel?.settings) $("#shadow-handling-time").value = Number(channel.settings.defaultHandlingTimeDays ?? 2);
});
document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-inventory-field]");
  const productInput = event.target.closest("[data-product-field]");
  const shadowInput = event.target.closest("[data-shadow-field]");
  const shadowAttributeInput = event.target.closest("[data-shadow-attribute]");
  const shadowOverrideInput = event.target.closest("[data-shadow-override]");
  const templateInput = event.target.closest("[data-template-field]");
  const exportMappingInput = event.target.closest("[data-export-mapping-field]");
  const exportMappingRowInput = event.target.closest("[data-export-mapping-row-field]");
  const exportMappingDraftInput = event.target.closest("[data-export-mapping-draft-field], [data-export-mapping-draft-row-field], [data-export-mapping-draft-raw]");
  const mappedImportFile = event.target.closest("[data-import-export-file]");
  const shopifyStatusImportFile = event.target.closest("[data-import-shopify-status-file]");
  const centralInventoryImportFile = event.target.closest("[data-central-inventory-import]");
  const centralSourceSkuImportFile = event.target.closest("[data-central-source-sku-import]");
  const centralShopifyStatusImportFile = event.target.closest("[data-central-shopify-status-import]");
  const categorySkuImportFile = event.target.closest("[data-category-sku-import]");
  const mappingHeaderFile = event.target.closest("[data-load-mapping-headers]");
  const channelInput = event.target.closest("[data-channel-field]");
  const categoryInput = event.target.closest("[data-category-field], [data-category-default], [data-category-map]");
  const orderMoneyInput = event.target.closest("[data-order-money]");
  const vendorField = event.target.closest("[data-vendor-field]");
  const customerField = event.target.closest("[data-customer-field]");
  const brandField = event.target.closest("[data-brand-field]");
  const brandVendor = event.target.closest("[data-brand-vendor]");
  const vendorBrand = event.target.closest("[data-vendor-brand]");
  const poField = event.target.closest("[data-po-field]");
  const warehouseStockField = event.target.closest("[data-warehouse-stock-field]");
  const brandLogoUpload = event.target.closest("[data-brand-logo-upload]");
  const vendorFileUpload = event.target.closest("[data-vendor-file-upload]");
  if (input) updateInventory(input);
  if (productInput) updateProductField(productInput);
  if (shadowInput) updateShadowField(shadowInput);
  if (shadowAttributeInput) updateShadowAttribute(shadowAttributeInput);
  if (shadowOverrideInput) updateShadowOverride(shadowOverrideInput);
  if (templateInput) updateMarketplaceTemplate(templateInput);
  if (exportMappingInput) updateExportMapping(exportMappingInput).catch((error) => toast(error.message));
  if (exportMappingRowInput) markMappingDraftDirty();
  if (exportMappingDraftInput) markMappingDraftDirty();
  if (mappedImportFile) {
    importMappedProducts(mappedImportFile).catch((error) => toast(error.message));
    event.target.value = "";
  }
  if (shopifyStatusImportFile) {
    importShopifyStatusFile(shopifyStatusImportFile).catch((error) => toast(error.message));
  }
  if (centralInventoryImportFile) {
    const [file] = centralInventoryImportFile.files || [];
    if (file) importInventory(file).catch((error) => toast(error.message));
    event.target.value = "";
  }
  if (centralSourceSkuImportFile) {
    const [file] = centralSourceSkuImportFile.files || [];
    if (file) openSourceSkuImportModal(file).catch((error) => toast(error.message));
    event.target.value = "";
  }
  if (centralShopifyStatusImportFile) {
    importShopifyStatusFile(centralShopifyStatusImportFile).catch((error) => toast(error.message));
  }
  if (categorySkuImportFile) {
    const [file] = categorySkuImportFile.files || [];
    if (file) importSkuCategories(file).catch((error) => toast(error.message));
    event.target.value = "";
  }
  if (mappingHeaderFile) {
    loadMappingHeaders(mappingHeaderFile).catch((error) => toast(error.message));
    event.target.value = "";
  }
  if (event.target.id === "product-export-template") {
    selectedExportMappingId = event.target.value;
  }
  if (channelInput) updateChannelField(channelInput);
  if (categoryInput) updateCategoryField(categoryInput).catch((error) => toast(error.message));
if (orderMoneyInput) updateOrderMoney(orderMoneyInput);
  if (vendorField) updateVendorField(vendorField);
  if (customerField) updateCustomerField(customerField);
  if (brandField) updateBrandField(brandField);
  if (brandVendor) updateBrandVendor(brandVendor);
  if (vendorBrand) updateVendorBrand(vendorBrand);
  if (poField) updatePoField(poField);
  if (warehouseStockField) updateWarehouseStockField(warehouseStockField);
  if (brandLogoUpload) uploadBrandLogo(brandLogoUpload);
  if (vendorFileUpload) uploadVendorFile(vendorFileUpload);
});

document.addEventListener("input", (event) => {
  const mappingDraftInput = event.target.closest("[data-export-mapping-draft-field], [data-export-mapping-draft-row-field], [data-export-mapping-draft-raw]");
  if (!mappingDraftInput) return;
  if (mappingDraftInput.matches("[data-export-mapping-draft-raw]")) {
    mappingDraftInput.dataset.mappingRawDirty = "true";
  }
  markMappingDraftDirty();
});

hydrateStaticIcons();
applyMenuGroupState();
applyTheme();
load().catch((error) => toast(error.message));
