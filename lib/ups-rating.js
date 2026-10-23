const crypto = require("crypto");

let tokenCache = { accessToken: "", expiresAt: 0 };

function text(value) {
  return String(value ?? "").trim();
}

function config(env = process.env) {
  const clientId = text(env.UPS_CLIENT_ID);
  const clientSecret = text(env.UPS_CLIENT_SECRET);
  const accountNumber = text(env.UPS_ACCOUNT_NUMBER || env.UPS_SHIPPER_NUMBER);
  const enabled = !["0", "false", "no"].includes(text(env.UPS_RATING_ENABLED || "true").toLowerCase());
  const test = ["1", "true", "yes"].includes(text(env.UPS_TEST_MODE).toLowerCase());
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

function publicStatus(env = process.env) {
  const settings = config(env);
  return {
    enabled: settings.enabled,
    configured: settings.configured,
    environment: settings.environment,
    accountEnding: settings.accountNumber ? settings.accountNumber.slice(-4) : "",
    message: settings.configured
      ? "Direct UPS negotiated-rate shopping is configured."
      : "Add server-only UPS_CLIENT_ID, UPS_CLIENT_SECRET, and UPS_ACCOUNT_NUMBER values to enable direct UPS quotes.",
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { return { raw: body.slice(0, 2000) }; }
}

async function accessToken(settings) {
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const response = await fetch(`${settings.baseUrl}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) {
    throw new Error(`UPS OAuth failed (${response.status}): ${text(payload.response?.errors?.[0]?.message || payload.error_description || payload.error || "No access token returned.")}`);
  }
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in || 3600)) * 1000,
  };
  return tokenCache.accessToken;
}

function upsAddress(address = {}) {
  return {
    AddressLine: [text(address.line1), text(address.line2)].filter(Boolean),
    City: text(address.city || address.town),
    StateProvinceCode: text(address.state || address.county),
    PostalCode: text(address.postalCode || address.postcode),
    CountryCode: text(address.country || address.country_code || "US").toUpperCase(),
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

async function shopRates(input = {}, env = process.env) {
  const settings = config(env);
  if (!settings.configured) return { rates: [], status: publicStatus(env) };
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
  return {
    status: { ...publicStatus(env), ok: true, transactionId, rateCount: rows.length },
    rates: rows.map((shipment, index) => {
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
    }).filter((rate) => rate.amount > 0),
  };
}

module.exports = { config, publicStatus, shopRates };
