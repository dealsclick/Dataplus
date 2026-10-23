const crypto = require("crypto");

let tokenCache = { key: "", accessToken: "", expiresAt: 0 };

const US_STATE_CODES = new Map(Object.entries({
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO",
  CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR",
  PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA",
  "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
  "PUERTO RICO": "PR", GUAM: "GU", "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
  "U.S. VIRGIN ISLANDS": "VI", "US VIRGIN ISLANDS": "VI",
}));

const CA_PROVINCE_CODES = new Map(Object.entries({
  ALBERTA: "AB", "BRITISH COLUMBIA": "BC", MANITOBA: "MB", "NEW BRUNSWICK": "NB",
  "NEWFOUNDLAND AND LABRADOR": "NL", "NORTHWEST TERRITORIES": "NT", "NOVA SCOTIA": "NS",
  NUNAVUT: "NU", ONTARIO: "ON", "PRINCE EDWARD ISLAND": "PE", QUEBEC: "QC", SASKATCHEWAN: "SK",
  YUKON: "YT",
}));

function text(value) {
  return String(value ?? "").trim();
}

function countryCode(value) {
  const normalized = text(value || "US").toUpperCase().replaceAll(".", "");
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(normalized)) return "US";
  if (["CA", "CAN", "CANADA"].includes(normalized)) return "CA";
  return normalized;
}

function stateProvinceCode(value, country) {
  const normalized = text(value).toUpperCase().replace(/\s+/g, " ");
  if (!normalized) return "";
  const normalizedCountry = countryCode(country);
  if (normalizedCountry === "US") return US_STATE_CODES.get(normalized) || normalized;
  if (normalizedCountry === "CA") return CA_PROVINCE_CODES.get(normalized) || normalized;
  return normalized;
}

function config(env = process.env, runtime = {}) {
  const runtimeEnvironment = text(runtime.environment).toLowerCase();
  const test = runtimeEnvironment ? runtimeEnvironment === "test" : ["1", "true", "yes"].includes(text(env.UPS_TEST_MODE).toLowerCase());
  const clientId = text(runtime.clientId || env[test ? "UPS_TEST_CLIENT_ID" : "UPS_CLIENT_ID"] || env.UPS_CLIENT_ID);
  const clientSecret = text(runtime.clientSecret || env[test ? "UPS_TEST_CLIENT_SECRET" : "UPS_CLIENT_SECRET"] || env.UPS_CLIENT_SECRET);
  const accountNumber = text(runtime.accountNumber || env[test ? "UPS_TEST_ACCOUNT_NUMBER" : "UPS_ACCOUNT_NUMBER"] || env[test ? "UPS_TEST_SHIPPER_NUMBER" : "UPS_SHIPPER_NUMBER"] || env.UPS_ACCOUNT_NUMBER || env.UPS_SHIPPER_NUMBER);
  const enabled = !["0", "false", "no"].includes(text(env.UPS_RATING_ENABLED || "true").toLowerCase());
  return {
    enabled,
    configured: Boolean(enabled && clientId && clientSecret && accountNumber),
    clientId,
    clientSecret,
    accountNumber,
    baseUrl: test ? "https://wwwcie.ups.com" : "https://onlinetools.ups.com",
    environment: test ? "test" : "production",
  };
}

function publicStatus(env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  return {
    enabled: settings.enabled,
    configured: settings.configured,
    environment: settings.environment,
    accountEnding: settings.accountNumber ? settings.accountNumber.slice(-4) : "",
    message: settings.configured
      ? "Direct UPS negotiated-rate shopping is configured."
      : "Add UPS credentials in System Settings > Fulfillment to enable direct UPS quotes.",
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { return { raw: body.slice(0, 2000) }; }
}

function credentialKey(settings) {
  return crypto.createHash("sha256").update(JSON.stringify([settings.environment, settings.clientId, settings.clientSecret, settings.accountNumber])).digest("hex");
}

async function fetchAccessToken(settings) {
  const response = await fetch(`${settings.baseUrl}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "x-merchant-id": settings.accountNumber,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) {
    throw new Error(`UPS OAuth failed (${response.status}): ${text(payload.response?.errors?.[0]?.message || payload.error_description || payload.error || "No access token returned.")}`);
  }
  return payload;
}

async function accessToken(settings, { force = false } = {}) {
  const key = credentialKey(settings);
  if (!force && tokenCache.key === key && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const payload = await fetchAccessToken(settings);
  tokenCache = {
    key,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in || 3600)) * 1000,
  };
  return tokenCache.accessToken;
}

async function verifyCredentials(runtime = {}, env = process.env) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("UPS Client ID, Client Secret, and billing account number are required.");
  const payload = await fetchAccessToken(settings);
  tokenCache = {
    key: credentialKey(settings),
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in || 3600)) * 1000,
  };
  return {
    environment: settings.environment,
    expiresIn: Math.max(0, Number(payload.expires_in || 0) || 0),
    scope: text(payload.scope),
    status: text(payload.status || "approved"),
  };
}

function upsAddress(address = {}) {
  const country = countryCode(address.country || address.country_code || "US");
  return {
    AddressLine: [text(address.line1), text(address.line2)].filter(Boolean),
    City: text(address.city || address.town),
    StateProvinceCode: stateProvinceCode(address.state || address.county, country),
    PostalCode: text(address.postalCode || address.postcode),
    CountryCode: country,
  };
}

function amountFromShipment(shipment = {}) {
  const negotiated = shipment.NegotiatedRateCharges?.TotalCharge || shipment.NegotiatedRateCharges?.TotalCharges;
  const total = negotiated || shipment.TotalCharges || shipment.TotalCharge;
  const amount = Number(total?.MonetaryValue ?? total?.monetaryValue ?? 0);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency: text(total?.CurrencyCode || total?.currencyCode || "USD"),
    negotiated: Boolean(negotiated),
  };
}

function serviceLabel(code) {
  return ({
    "01": "UPS Next Day Air",
    "02": "UPS 2nd Day Air",
    "03": "UPS Ground",
    "07": "UPS Worldwide Express",
    "08": "UPS Worldwide Expedited",
    "11": "UPS Standard",
    "12": "UPS 3 Day Select",
    "13": "UPS Next Day Air Saver",
    "14": "UPS Next Day Air Early",
    "54": "UPS Worldwide Express Plus",
    "59": "UPS 2nd Day Air A.M.",
    "65": "UPS Worldwide Saver",
  })[text(code)] || `UPS service ${text(code) || "unknown"}`;
}

async function shopRates(input = {}, env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) return { rates: [], status: publicStatus(env, runtime) };
  const parcel = input.package || {};
  const from = input.from || {};
  const to = input.to || {};
  if (![parcel.weight, parcel.length, parcel.width, parcel.height].every((value) => Number(value) > 0)) throw new Error("UPS rating requires positive package weight and dimensions.");
  if (![from.line1, from.city || from.town, from.state || from.county, from.postalCode || from.postcode, to.line1, to.city || to.town, to.state || to.county, to.postalCode || to.postcode].every(Boolean)) {
    throw new Error("UPS rating requires complete ship-from and destination addresses.");
  }
  const transactionId = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
  const payload = {
    RateRequest: {
      Request: { RequestOption: "Shop", TransactionReference: { CustomerContext: text(input.reference || "DataPlus shipping dispute") } },
      Shipment: {
        Shipper: { Name: text(from.company || from.name || "DataPlus"), ShipperNumber: settings.accountNumber, Address: upsAddress(from) },
        ShipFrom: { Name: text(from.company || from.name || "DataPlus"), Address: upsAddress(from) },
        ShipTo: { Name: text(to.company || to.name || "Customer"), Address: upsAddress(to) },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "" },
        Package: [{
          PackagingType: { Code: "02", Description: text(parcel.type || "Package") },
          Dimensions: {
            UnitOfMeasurement: { Code: /^cm$/i.test(text(parcel.dimensionUnit)) ? "CM" : "IN" },
            Length: String(Number(parcel.length)), Width: String(Number(parcel.width)), Height: String(Number(parcel.height)),
          },
          PackageWeight: {
            UnitOfMeasurement: { Code: /^kg$/i.test(text(parcel.weightUnit)) ? "KGS" : "LBS" },
            Weight: String(Number(parcel.weight)),
          },
        }],
      },
    },
  };
  const token = await accessToken(settings);
  const response = await fetch(`${settings.baseUrl}/api/rating/v2403/Shop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      transId: transactionId,
      transactionSrc: "DataPlus",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await readJson(response);
  if (!response.ok) {
    const errors = result.response?.errors || result.Response?.ResponseStatus || [];
    const message = Array.isArray(errors) ? errors.map((error) => error.message || error.Message || error.code).filter(Boolean).join("; ") : text(errors);
    throw new Error(`UPS Rating API failed (${response.status}): ${message || "Unknown UPS error."}`);
  }
  const shipments = result.RateResponse?.RatedShipment;
  const rows = Array.isArray(shipments) ? shipments : shipments ? [shipments] : [];
  const quotedAt = new Date().toISOString();
  const rates = rows.map((shipment, index) => {
    const price = amountFromShipment(shipment);
    const serviceCode = text(shipment.Service?.Code);
    const time = shipment.TimeInTransit?.ServiceSummary || {};
    return {
      id: text(shipment.RateChart || shipment.BillingWeight?.Weight || `ups-${serviceCode}-${index}`),
      provider: "ups_direct",
      carrier: "UPS",
      service: text(shipment.Service?.Description) || serviceLabel(serviceCode),
      amount: price.amount,
      currency: price.currency,
      deliveryDays: Number(time.EstimatedArrival?.BusinessDaysInTransit || 0) || 0,
      deliveryEstimate: text(time.EstimatedArrival?.Arrival?.Date || time.EstimatedArrival?.Date),
      quotedAt,
      rateSource: price.negotiated ? "ups_negotiated" : "ups_account",
      warning: price.negotiated ? "" : "UPS did not identify this response as a negotiated rate.",
    };
  }).filter((rate) => rate.amount > 0);
  return {
    status: {
      ...publicStatus(env, runtime),
      ok: true,
      transactionId,
      rateCount: rates.length,
      cheapestAmount: rates.length ? Math.min(...rates.map((rate) => rate.amount)) : null,
    },
    rates,
  };
}

module.exports = { config, countryCode, publicStatus, shopRates, stateProvinceCode, verifyCredentials };
