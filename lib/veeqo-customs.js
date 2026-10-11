const COUNTRY_CODES = Object.freeze({
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
  "U.S.A": "US",
  CANADA: "CA",
  MEXICO: "MX",
  CHINA: "CN",
  "PEOPLE'S REPUBLIC OF CHINA": "CN",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  INDIA: "IN",
  TAIWAN: "TW",
  VIETNAM: "VN",
  "SOUTH KOREA": "KR",
  "REPUBLIC OF KOREA": "KR",
  JAPAN: "JP"
});

const US_TERRITORIES = new Set([
  "PR", "PUERTO RICO",
  "GU", "GUAM",
  "VI", "US VIRGIN ISLANDS", "U.S. VIRGIN ISLANDS", "UNITED STATES VIRGIN ISLANDS",
  "AS", "AMERICAN SAMOA",
  "MP", "NORTHERN MARIANA ISLANDS", "COMMONWEALTH OF THE NORTHERN MARIANA ISLANDS"
]);

function scalarText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    for (const key of ["value", "code", "name", "label", "text"]) {
      const nested = scalarText(value[key]);
      if (nested) return nested;
    }
    return "";
  }
  return String(value).trim();
}

function normalizeCountryOfManufacture(value = "") {
  const text = scalarText(value);
  if (!text) return "";
  const upper = text.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^[A-Z]{2}$/.test(upper)) return US_TERRITORIES.has(upper) ? "US" : upper;
  if (US_TERRITORIES.has(upper)) return "US";
  return COUNTRY_CODES[upper] || "";
}

function normalizeVeeqoAddressCountry(value = "") {
  const text = scalarText(value);
  if (!text) return "";
  const upper = text.toUpperCase().replace(/\s+/g, " ").trim();
  if (US_TERRITORIES.has(upper)) return "US";
  return normalizeCountryOfManufacture(upper);
}

function productCountryOfOrigin(product = {}) {
  const containers = [
    product,
    product.raw,
    product.original,
    product.productManagerFields,
    product.attributes,
    product.shippingPreferences
  ].filter((entry) => entry && typeof entry === "object");
  for (const container of containers) {
    for (const key of ["countryOfOrigin", "country_of_origin", "originCountry", "origin_country", "countryOfManufacture", "country_of_manufacture"]) {
      const code = normalizeCountryOfManufacture(container[key]);
      if (code) return code;
    }
  }
  return "";
}

function productTariffCode(product = {}) {
  const containers = [product, product.raw, product.original, product.productManagerFields, product.attributes]
    .filter((entry) => entry && typeof entry === "object");
  for (const container of containers) {
    for (const key of ["tariffCode", "tariff_code", "hsTariffNumber", "hs_tariff_number", "harmonizedCode", "harmonized_code"]) {
      const value = scalarText(container[key]);
      if (value) return value;
    }
  }
  return "";
}

function addVeeqoCustomsFields(line = {}, product = {}) {
  const origin = productCountryOfOrigin(line) || productCountryOfOrigin(product);
  const tariffCode = productTariffCode(line) || productTariffCode(product);
  const description = scalarText(line.description || line.title || product.marketplaceTitle || product.title || line.sku || "Merchandise").slice(0, 40);
  const { countryOfOrigin, country_of_origin, originCountry, origin_country, ...publicLine } = line;
  return {
    ...publicLine,
    description,
    ...(origin ? { country_of_manufacture: origin } : {}),
    ...(tariffCode ? { tariff_code: tariffCode } : {}),
    ...(product.hazardous === true || product.hazmat === true || line.hazardous === true || line.hazmat === true ? { hazmat: true } : {})
  };
}

module.exports = {
  addVeeqoCustomsFields,
  normalizeCountryOfManufacture,
  normalizeVeeqoAddressCountry,
  productCountryOfOrigin,
  productTariffCode
};
