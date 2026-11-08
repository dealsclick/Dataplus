const crypto = require("crypto");
const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const INSPECTION_TTL_MS = 15 * 60_000;
const MAX_INSPECTIONS = 250;
const inspections = new Map();

const blockedAddresses = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4]
]) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]
]) blockedAddresses.addSubnet(address, prefix, "ipv6");

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) throw failure("Paste a valid public product URL.");
  let url;
  try { url = new URL(raw); } catch { throw failure("Paste a valid public product URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw failure("Only public HTTP and HTTPS product pages are supported.");
  if (url.username || url.password) throw failure("Product URLs cannot include usernames or passwords.");
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    throw failure("Product URLs must use the standard web port.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw failure("Private and internal network addresses are not supported.");
  }
  if (net.isIP(host) && !isPublicAddress(host)) throw failure("Private and internal network addresses are not supported.");
  url.hash = "";
  return url;
}

function isPublicAddress(address) {
  const value = String(address || "").trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = net.isIP(value);
  if (family === 4) return !blockedAddresses.check(value, "ipv4");
  if (family === 6) return !blockedAddresses.check(value, "ipv6");
  return false;
}

function publicLookup(hostname, options, callback) {
  const lookupOptions = typeof options === "object" ? options : {};
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    const rows = (addresses || []).filter((row) => row?.address);
    if (!rows.length) return callback(failure("The product page host could not be resolved.", 502));
    if (rows.some((row) => !isPublicAddress(row.address))) {
      return callback(failure("Private and internal network addresses are not supported."));
    }
    if (lookupOptions.all) return callback(null, rows);
    return callback(null, rows[0].address, rows[0].family);
  });
}

function fetchHtmlOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1_000, Math.min(15_000, Number(options.timeoutMs) || 10_000));
    const transport = url.protocol === "https:" ? https : http;
    let responseBytes = 0;
    const chunks = [];
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };
    const request = transport.request(url, {
      method: "GET",
      lookup: publicLookup,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "DataPlusProductResearch/1.0 (+https://dataplusapp.duckdns.org)"
      }
    }, (response) => {
      const encoding = String(response.headers["content-encoding"] || "identity").trim().toLowerCase();
      if (encoding && encoding !== "identity") return finishError(failure(`The product page returned unsupported ${encoding} compression.`, 502));
      const declaredBytes = Number(response.headers["content-length"] || 0);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_HTML_BYTES) {
        return finishError(failure("The product page is too large to inspect.", 413));
      }
      response.on("data", (chunk) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += bytes.length;
        if (responseBytes > MAX_HTML_BYTES) return finishError(failure("The product page is too large to inspect.", 413));
        chunks.push(bytes);
      });
      response.on("error", finishError);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: Number(response.statusCode || 0),
          headers: response.headers,
          html: Buffer.concat(chunks, responseBytes).toString("utf8")
        });
      });
    });
    request.on("socket", (socket) => {
      const verifyRemote = () => {
        if (socket.remoteAddress && !isPublicAddress(socket.remoteAddress)) {
          finishError(failure("The product page resolved to a private network address."));
        }
      };
      socket.once("connect", verifyRemote);
      socket.once("secureConnect", verifyRemote);
    });
    request.on("error", finishError);
    request.setTimeout(timeoutMs, () => finishError(failure("The product page took too long to respond.", 504)));
    request.end();
  });
}

async function fetchPublicHtml(value, options = {}) {
  let current = normalizeSourceUrl(value);
  const visited = new Set();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const key = current.toString();
    if (visited.has(key)) throw failure("The product page redirected in a loop.", 502);
    visited.add(key);
    const response = await fetchHtmlOnce(current, options);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = String(response.headers.location || "").trim();
      if (!location || redirects === MAX_REDIRECTS) throw failure("The product page redirected too many times.", 502);
      current = normalizeSourceUrl(new URL(location, current).toString());
      continue;
    }
    if (response.statusCode === 401 || response.statusCode === 403) throw failure("This site does not allow DataPlus to inspect that public page. Enter the product identifiers manually instead.", 409);
    if (response.statusCode === 429) throw failure("This site is temporarily limiting product lookups. Try again later or enter the identifiers manually.", 429);
    if (response.statusCode < 200 || response.statusCode >= 300) throw failure(`The product page returned HTTP ${response.statusCode || "error"}.`, 502);
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw failure("The URL did not return an HTML product page.");
    }
    return { ...response, finalUrl: current.toString() };
  }
  throw failure("The product page could not be inspected.", 502);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))))
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
}

function cleanText(value, maximum = 500) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, maximum);
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const result = cleanText(value);
      if (result) return result;
    }
  }
  return "";
}

function parseTagAttributes(tag) {
  const attributes = {};
  const matcher = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = matcher.exec(String(tag || "")))) {
    const key = String(match[1] || "").toLowerCase();
    if (!key || key === "meta" || key === "script") continue;
    attributes[key] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function metaValues(html) {
  const values = new Map();
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const key = String(attributes.property || attributes.name || attributes.itemprop || "").trim().toLowerCase();
    const content = cleanText(attributes.content || "", 2_000);
    if (key && content && !values.has(key)) values.set(key, content);
  }
  return values;
}

function jsonLdNodes(html) {
  const nodes = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(add);
    if (typeof value !== "object") return;
    nodes.push(value);
    if (Array.isArray(value["@graph"])) value["@graph"].forEach(add);
    if (value.mainEntity && typeof value.mainEntity === "object") add(value.mainEntity);
  };
  for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = parseTagAttributes(`<script ${match[1]}>`);
    if (!String(attributes.type || "").toLowerCase().includes("ld+json")) continue;
    const source = String(match[2] || "").trim().replace(/^<!--|-->$/g, "").trim();
    if (!source || source.length > 1_000_000) continue;
    try { add(JSON.parse(source)); } catch { /* Ignore malformed third-party metadata. */ }
  }
  return nodes;
}

function isProductNode(node) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.some((type) => String(type || "").toLowerCase() === "product");
}

function imageValue(value, baseUrl) {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const raw = typeof candidate === "object" ? candidate?.url || candidate?.contentUrl : candidate;
    if (!raw) continue;
    try {
      return normalizeSourceUrl(new URL(String(raw), baseUrl).toString()).toString();
    } catch { /* Ignore malformed image metadata. */ }
  }
  return "";
}

function numericPrice(value) {
  const result = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(result) && result >= 0 ? Number(result.toFixed(2)) : null;
}

function offerFacts(value) {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const price = numericPrice(offer.price ?? offer.lowPrice ?? offer.highPrice ?? offer.priceSpecification?.price);
    if (price !== null) return { price, currency: textValue(offer.priceCurrency, offer.priceSpecification?.priceCurrency).toUpperCase().slice(0, 3) };
  }
  return { price: null, currency: "" };
}

function explicitIdentifier(text, pattern) {
  const match = pattern.exec(text);
  return cleanText(match?.[1] || "", 80);
}

function normalizeGtin(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : "";
}

function gtinKey(value) {
  const gtin = normalizeGtin(value);
  return gtin ? gtin.padStart(14, "0") : "";
}

function identifierKey(value) {
  return String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function inspectProductHtml(html, sourceUrl) {
  const meta = metaValues(html);
  const nodes = jsonLdNodes(html);
  const products = nodes.filter(isProductNode);
  const product = products.sort((left, right) => JSON.stringify(right).length - JSON.stringify(left).length)[0] || {};
  const offers = offerFacts(product.offers);
  const brand = typeof product.brand === "object" ? product.brand?.name : product.brand;
  const pageText = cleanText(String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " "), 50_000);
  const explicitGtin = explicitIdentifier(pageText, /\b(?:UPC|GTIN(?:-?\d+)?|EAN)\s*(?:#|:)?\s*([0-9][0-9\s-]{6,20})/i);
  const explicitMpn = explicitIdentifier(pageText, /\b(?:MPN|Manufacturer(?:'s)? Part(?: Number)?|Model(?: Number)?|Part Number)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._\/-]{2,79})/i);
  const explicitSku = explicitIdentifier(pageText, /\b(?:SKU|Item(?: Number)?|Product Code)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._\/-]{2,79})/i);
  const gtin = normalizeGtin(textValue(product.gtin14, product.gtin13, product.gtin12, product.gtin8, product.gtin, product.upc, meta.get("product:upc"), meta.get("product:gtin"), explicitGtin));
  const title = textValue(product.name, meta.get("og:title"), meta.get("twitter:title"), /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]).slice(0, 300);
  const price = offers.price ?? numericPrice(meta.get("product:price:amount") || meta.get("og:price:amount"));
  const result = {
    title,
    brand: textValue(brand, meta.get("product:brand"), meta.get("brand")).slice(0, 160),
    description: textValue(product.description, meta.get("og:description"), meta.get("description")).slice(0, 1_000),
    gtin,
    sku: textValue(product.sku, meta.get("product:retailer_item_id"), meta.get("sku"), explicitSku).slice(0, 120),
    mpn: textValue(product.mpn, product.model, meta.get("product:mpn"), meta.get("mpn"), explicitMpn).slice(0, 120),
    imageUrl: imageValue(product.image || meta.get("og:image") || meta.get("twitter:image"), sourceUrl),
    competitorPrice: price,
    currency: textValue(offers.currency, meta.get("product:price:currency"), meta.get("og:price:currency")).toUpperCase().slice(0, 3) || "USD",
    structuredDataFound: products.length > 0
  };
  result.identifiersFound = [result.gtin, result.sku, result.mpn].filter(Boolean).length;
  return result;
}

function productIdentifiers(product = {}) {
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const gtins = [product.barcode, product.upc, product.gtin, product.ean, raw.barcode, raw.upc, raw.gtin, raw.ean];
  const skus = [product.sku, product.company_sku, product.source_sku, product.vendorSku, product.vendor_sku, product.sourceSku, raw.vendorSku, raw.sourceSku];
  const mpns = [product.mfrPartNumber, product.manufacturerPartNumber, product.manufacturerSku, product.mpn, product.mfr_part_number, raw.mfrPartNumber, raw.manufacturerPartNumber, raw.mpn];
  for (const alias of Array.isArray(product.aliases) ? product.aliases : []) skus.push(alias?.sku || alias?.aliasSku || alias);
  for (const offer of Array.isArray(product.vendorOffers) ? product.vendorOffers : Array.isArray(product.suppliers) ? product.suppliers : []) {
    gtins.push(offer?.barcode, offer?.upc, offer?.gtin);
    skus.push(offer?.sku, offer?.vendorSku, offer?.sourceSku);
    mpns.push(offer?.mfrPartNumber, offer?.manufacturerPartNumber, offer?.mpn);
  }
  return {
    gtins: new Set(gtins.map(gtinKey).filter(Boolean)),
    skus: new Set(skus.map(identifierKey).filter(Boolean)),
    mpns: new Set(mpns.map(identifierKey).filter(Boolean))
  };
}

function candidateProjection(product = {}) {
  return {
    id: product.id || product.productId || product.product_id || product.sku || product.source_sku,
    sku: product.company_sku || product.sku || product.source_sku || "",
    title: product.title || product.marketplaceTitle || product.sku || product.source_sku || "",
    brand: product.brand || "",
    manufacturer: product.manufacturer || "",
    manufacturerPartNumber: product.mfrPartNumber || product.manufacturerPartNumber || product.mpn || product.mfr_part_number || "",
    barcode: product.barcode || product.upc || product.gtin || "",
    image: product.defaultImage || product.default_image || product.image || "",
    websitePrice: product.sell_price ?? product.websitePrice ?? product.price ?? null,
    msrp: product.msrp ?? product.listPrice ?? null,
    mapPrice: product.mapPrice ?? product.map ?? null,
    sharedCatalog: Boolean(product.product_id || product.sharedCatalog)
  };
}

function matchCatalogCandidates(extracted = {}, products = []) {
  const gtin = gtinKey(extracted.gtin);
  const sku = identifierKey(extracted.sku);
  const mpn = identifierKey(extracted.mpn);
  const matches = [];
  const seen = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    const ids = productIdentifiers(product);
    let basis = "";
    if (gtin && ids.gtins.has(gtin)) basis = "UPC / GTIN";
    else if (sku && ids.skus.has(sku)) basis = "Page SKU";
    else if (mpn && ids.mpns.has(mpn)) basis = "Manufacturer part number";
    if (!basis) continue;
    const projected = candidateProjection(product);
    const key = String(projected.id || projected.sku).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    matches.push({
      ...projected,
      matchBasis: basis,
      reviewRequired: basis !== "UPC / GTIN",
      confirmedIdentifier: basis === "UPC / GTIN"
    });
  }
  return matches.sort((left, right) => Number(left.reviewRequired) - Number(right.reviewRequired) || String(left.sku).localeCompare(String(right.sku)));
}

function pruneInspections() {
  const now = Date.now();
  for (const [key, value] of inspections) if (value.expiresAt <= now) inspections.delete(key);
  while (inspections.size >= MAX_INSPECTIONS) inspections.delete(inspections.keys().next().value);
}

async function inspectCompetitorUrl(value, options = {}) {
  const scopeKey = String(options.scopeKey || "").trim();
  if (!scopeKey) throw failure("The quote company scope is missing.", 409);
  const requestedUrl = normalizeSourceUrl(value).toString();
  const fetched = await (options.fetchHtml || fetchPublicHtml)(requestedUrl, options);
  const product = inspectProductHtml(fetched.html, fetched.finalUrl || requestedUrl);
  if (!product.title && !product.identifiersFound) throw failure("No recognizable product metadata was found on this page. Enter the product manually instead.", 409);
  pruneInspections();
  const inspectionId = crypto.randomUUID();
  const inspectedAt = new Date().toISOString();
  const record = {
    inspectionId,
    scopeKey,
    requestedUrl,
    sourceUrl: fetched.finalUrl || requestedUrl,
    sourceHost: new URL(fetched.finalUrl || requestedUrl).hostname,
    product,
    inspectedAt,
    expiresAt: Date.now() + INSPECTION_TTL_MS
  };
  inspections.set(inspectionId, record);
  return { ...record, expiresAt: new Date(record.expiresAt).toISOString() };
}

function readInspection(inspectionId, scopeKey) {
  pruneInspections();
  const record = inspections.get(String(inspectionId || ""));
  if (!record || record.scopeKey !== String(scopeKey || "")) throw failure("This product-page inspection expired. Inspect the URL again.", 410);
  return record;
}

module.exports = {
  candidateProjection,
  fetchPublicHtml,
  gtinKey,
  identifierKey,
  inspectCompetitorUrl,
  inspectProductHtml,
  isPublicAddress,
  matchCatalogCandidates,
  normalizeSourceUrl,
  productIdentifiers,
  readInspection
};
