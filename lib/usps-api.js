const crypto = require("node:crypto");

const { countryCode, stateProvinceCode } = require("./ups-rating");

let tokenCache = { key: "", accessToken: "", expiresAt: 0 };

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function config(env = process.env, runtime = {}) {
  const runtimeEnvironment = text(runtime.environment).toLowerCase();
  const test = runtimeEnvironment ? runtimeEnvironment === "test" : ["1", "true", "yes"].includes(text(env.USPS_TEST_MODE).toLowerCase());
  const prefix = test ? "USPS_TEST_" : "USPS_";
  const clientId = text(runtime.clientId || env[`${prefix}CONSUMER_KEY`] || env[`${prefix}CLIENT_ID`] || env.USPS_CONSUMER_KEY || env.USPS_CLIENT_ID);
  const clientSecret = text(runtime.clientSecret || env[`${prefix}CONSUMER_SECRET`] || env[`${prefix}CLIENT_SECRET`] || env.USPS_CONSUMER_SECRET || env.USPS_CLIENT_SECRET);
  const enabled = !["0", "false", "no"].includes(text(env.USPS_API_ENABLED || "true").toLowerCase());
  return {
    enabled,
    configured: Boolean(enabled && clientId && clientSecret),
    clientId,
    clientSecret,
    crid: text(runtime.crid || env[`${prefix}CRID`] || env.USPS_CRID),
    mid: text(runtime.mid || env[`${prefix}MID`] || env.USPS_MID),
    accountType: text(runtime.accountType || env[`${prefix}ACCOUNT_TYPE`] || env.USPS_ACCOUNT_TYPE || "EPS").toUpperCase(),
    accountNumber: text(runtime.accountNumber || env[`${prefix}ACCOUNT_NUMBER`] || env.USPS_ACCOUNT_NUMBER),
    webhookAdminEmail: text(runtime.webhookAdminEmail || env[`${prefix}WEBHOOK_ADMIN_EMAIL`] || env.USPS_WEBHOOK_ADMIN_EMAIL),
    webhookSecret: text(runtime.webhookSecret || env[`${prefix}WEBHOOK_SECRET`] || env.USPS_WEBHOOK_SECRET),
    baseUrl: test ? "https://apis-tem.usps.com" : "https://apis.usps.com",
    environment: test ? "test" : "production",
  };
}

function capabilities(settings) {
  return [
    { id: "oauth", label: "OAuth 2.0", status: settings.configured ? "ready" : "needs_credentials", detail: "Consumer Key and Consumer Secret; tokens renew automatically." },
    { id: "addresses", label: "Addresses", status: settings.configured ? "ready" : "needs_credentials", detail: "Standardization, ZIP Code, and city/state lookup." },
    { id: "tracking", label: "Tracking 3.2", status: settings.configured ? "ready" : "needs_credentials", detail: "Direct scan events, delivery estimates, and delivery eligibility." },
    { id: "pricing", label: "Domestic pricing", status: settings.configured ? "ready" : "needs_credentials", detail: settings.accountNumber ? "Published and authorized account pricing." : "Published commercial rates; add an authorized payment account for contract rates." },
    { id: "subscriptions", label: "Tracking webhooks", status: settings.configured && settings.mid && settings.webhookAdminEmail ? "setup_available" : "needs_setup", detail: "Requires a Mailer ID, administrator email, public listener URL, and active USPS traffic." },
    { id: "proof_of_delivery", label: "Proof of delivery", status: settings.configured && settings.crid ? "email_request_available" : "needs_crid", detail: "USPS sends eligible POD or electronic return receipt records by email; no synchronous photo download is provided." },
    { id: "labels", label: "Labels and payments", status: settings.accountNumber ? "approval_required" : "needs_payment_account", detail: "Requires separate USPS Ship enrollment, Enterprise Payment Account authorization, Payments API access, and USPS approval." },
  ];
}

function publicStatus(env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  return {
    enabled: settings.enabled,
    configured: settings.configured,
    environment: settings.environment,
    cridConfigured: Boolean(settings.crid),
    midConfigured: Boolean(settings.mid),
    accountConfigured: Boolean(settings.accountNumber),
    accountType: settings.accountType,
    capabilities: capabilities(settings),
    message: settings.configured
      ? "Direct USPS address, pricing, and Tracking 3.2 APIs are configured."
      : "Add the USPS Consumer Key and Consumer Secret in System Settings > Fulfillment.",
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { return { raw: body.slice(0, 4000) }; }
}

function errorMessage(payload = {}, fallback = "Unknown USPS error.") {
  const root = payload.error || payload;
  const rows = [
    ...list(root.errors),
    ...list(payload.errors),
    ...list(payload.errorDetails),
  ];
  return text(root.message || root.error_description || payload.message || rows.map((entry) => entry?.detail || entry?.message || entry?.title || entry?.code).filter(Boolean).join("; ") || fallback);
}

function credentialKey(settings) {
  return crypto.createHash("sha256").update(JSON.stringify([settings.environment, settings.clientId, settings.clientSecret])).digest("hex");
}

async function fetchAccessToken(settings) {
  const response = await fetch(`${settings.baseUrl}/oauth2/v3/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: settings.clientId, client_secret: settings.clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) throw new Error(`USPS OAuth failed (${response.status}): ${errorMessage(payload, "No access token returned.")}`);
  return payload;
}

async function accessToken(settings, { force = false } = {}) {
  const key = credentialKey(settings);
  if (!force && tokenCache.key === key && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const payload = await fetchAccessToken(settings);
  tokenCache = {
    key,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(1, Number(payload.expires_in || 3600)) * 1000,
  };
  return tokenCache.accessToken;
}

async function verifyCredentials(runtime = {}, env = process.env) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS Consumer Key and Consumer Secret are required.");
  const payload = await fetchAccessToken(settings);
  tokenCache = {
    key: credentialKey(settings),
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(1, Number(payload.expires_in || 3600)) * 1000,
  };
  return {
    environment: settings.environment,
    expiresIn: Math.max(0, Number(payload.expires_in || 0) || 0),
    scope: text(payload.scope),
    status: text(payload.status || payload.token_type || "approved"),
    capabilities: capabilities(settings),
  };
}

async function authorizedJson(settings, pathname, options = {}) {
  const token = await accessToken(settings);
  const response = await fetch(`${settings.baseUrl}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`USPS API failed (${response.status}): ${errorMessage(payload)}`);
  return { response, payload };
}

function uspsAddress(input = {}) {
  const country = countryCode(input.country || input.country_code || "US");
  if (!new Set(["US", "PR", "VI", "GU", "AS", "MP"]).has(country)) throw new Error("USPS address validation supports domestic U.S. destinations only.");
  return {
    streetAddress: text(input.streetAddress || input.line1 || input.address1),
    secondaryAddress: text(input.secondaryAddress || input.line2 || input.address2),
    city: text(input.city || input.town),
    state: stateProvinceCode(input.state || input.county, "US"),
    ZIPCode: text(input.ZIPCode || input.postalCode || input.postcode).match(/\d{5}/)?.[0] || "",
    ZIPPlus4: text(input.ZIPPlus4 || input.postalCode || input.postcode).match(/\d{5}[-\s]?(\d{4})/)?.[1] || "",
    urbanization: text(input.urbanization),
  };
}

function queryString(values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== "" && value != null) query.set(key, String(value));
  return query.toString();
}

function addressFromPayload(payload = {}) {
  const address = payload.address || payload.Address || payload.result?.address || payload;
  return {
    line1: text(address.streetAddress || address.streetAddressAbbreviation),
    line2: text(address.secondaryAddress),
    city: text(address.city || address.cityAbbreviation),
    state: text(address.state),
    postalCode: [text(address.ZIPCode), text(address.ZIPPlus4)].filter(Boolean).join("-"),
    ZIPCode: text(address.ZIPCode),
    ZIPPlus4: text(address.ZIPPlus4),
    urbanization: text(address.urbanization),
  };
}

async function standardizeAddress(input = {}, env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured for address verification.");
  const address = uspsAddress(input);
  if (!address.streetAddress || !address.city || !address.state) throw new Error("USPS address verification requires street, city, and state.");
  const { payload } = await authorizedJson(settings, `/addresses/v3/address?${queryString(address)}`, { method: "GET" });
  return { address: addressFromPayload(payload), corrections: list(payload.corrections), additionalInfo: payload.additionalInfo || {}, raw: payload };
}

function collectZipCandidates(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectZipCandidates(entry, output, seen);
    return output;
  }
  const ZIPCode = text(value.ZIPCode || value.zipCode || value.postalCode).match(/\d{5}/)?.[0] || "";
  if (ZIPCode && !seen.has(ZIPCode)) {
    seen.add(ZIPCode);
    output.push({ postalCode: ZIPCode, country: "US", city: text(value.city), state: text(value.state) });
  }
  for (const nested of Object.values(value)) collectZipCandidates(nested, output, seen);
  return output;
}

function selectPostalCandidate(candidates = [], selectionKey = "") {
  if (!candidates.length) return null;
  const stable = [...candidates].sort((left, right) => left.postalCode.localeCompare(right.postalCode));
  if (stable.length === 1) return stable[0];
  const digest = crypto.createHash("sha256").update(`${text(selectionKey)}|${stable.map((row) => row.postalCode).join("|")}`).digest();
  return stable[digest.readUInt32BE(0) % stable.length];
}

async function suggestPostalCodes(input = {}, env = process.env, runtime = {}, options = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured for ZIP Code lookup.");
  const city = text(input.city || input.town);
  const state = stateProvinceCode(input.state || input.county, "US");
  if (!city || !state) throw new Error("USPS ZIP Code lookup requires city and state.");
  const { payload } = await authorizedJson(settings, `/addresses/v3/zipcode?${queryString({ city, state })}`, { method: "GET" });
  const candidates = collectZipCandidates(payload).slice(0, Math.max(1, Math.min(50, Number(options.maximumCandidates || 50) || 50)));
  const selected = selectPostalCandidate(candidates, options.selectionKey || `${city}:${state}`);
  return { candidates, selected, candidateCount: candidates.length, ambiguous: candidates.length > 1 };
}

async function cityStateLookup(postalCode, env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured for city/state lookup.");
  const ZIPCode = text(postalCode).match(/\d{5}/)?.[0] || "";
  if (!ZIPCode) throw new Error("Enter a valid five-digit ZIP Code.");
  const { payload } = await authorizedJson(settings, `/addresses/v3/city-state?${queryString({ ZIPCode })}`, { method: "GET" });
  return { ...addressFromPayload(payload), raw: payload };
}

function pounds(value, unit = "lb") {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return /kg/i.test(text(unit)) ? amount * 2.2046226218 : /oz/i.test(text(unit)) ? amount / 16 : amount;
}

function inches(value, unit = "in") {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return /cm/i.test(text(unit)) ? amount / 2.54 : amount;
}

function serviceLabel(mailClass = "") {
  return ({
    USPS_GROUND_ADVANTAGE: "USPS Ground Advantage",
    PRIORITY_MAIL: "USPS Priority Mail",
    PRIORITY_MAIL_EXPRESS: "USPS Priority Mail Express",
    PARCEL_SELECT: "USPS Parcel Select",
  })[text(mailClass).toUpperCase()] || text(mailClass).replaceAll("_", " ");
}

function rateRows(payload = {}) {
  const options = list(payload.rateOptions || payload.rates || payload);
  const rows = [];
  for (const option of options) {
    const rate = list(option.rates)[0] || option;
    const mailClass = text(rate.mailClass || option.mailClass);
    const amount = Number(option.totalPrice ?? option.totalBasePrice ?? rate.price ?? 0);
    if (!mailClass || !(amount > 0) || /MEDIA_MAIL|BOUND_PRINTED_MATTER|LIBRARY_MAIL/i.test(mailClass)) continue;
    rows.push({
      id: `usps-direct-${text(rate.SKU || rate.sku || mailClass)}-${rows.length + 1}`,
      provider: "usps_direct",
      providerLabel: "Direct USPS",
      carrier: "USPS",
      service: serviceLabel(mailClass),
      amount,
      currency: "USD",
      deliveryDays: Number(rate.deliveryDays || option.deliveryDays || 0) || null,
      deliveryDate: text(rate.deliveryDate || option.deliveryDate || option.expectedDeliveryDate),
      rateSource: "usps_domestic_prices_v3",
      raw: { mailClass, rateIndicator: text(rate.rateIndicator), SKU: text(rate.SKU || rate.sku), priceType: text(rate.priceType), zone: text(rate.zone), warnings: [...list(rate.warnings), ...list(option.warnings)] },
    });
  }
  return rows.sort((left, right) => left.amount - right.amount).slice(0, 30);
}

async function shopRates(input = {}, env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured for rate shopping.");
  const originZIPCode = text(input.from?.postalCode || input.from?.postcode).match(/\d{5}/)?.[0] || "";
  const destinationZIPCode = text(input.to?.postalCode || input.to?.postcode).match(/\d{5}/)?.[0] || "";
  if (!originZIPCode || !destinationZIPCode) throw new Error("USPS rates require origin and destination five-digit ZIP Codes.");
  const parcel = input.package || {};
  const dimensions = [inches(parcel.length, parcel.dimensionUnit), inches(parcel.width, parcel.dimensionUnit), inches(parcel.height, parcel.dimensionUnit)].sort((left, right) => right - left);
  const body = {
    originZIPCode,
    destinationZIPCode,
    weight: Math.max(0.01, pounds(parcel.weight, parcel.weightUnit)),
    length: Math.max(0.1, dimensions[0] || 0.1),
    width: Math.max(0.1, dimensions[1] || 0.1),
    height: Math.max(0.1, dimensions[2] || 0.1),
    mailClasses: ["USPS_GROUND_ADVANTAGE", "PRIORITY_MAIL", "PRIORITY_MAIL_EXPRESS"],
    priceType: settings.accountNumber ? "CONTRACT" : "COMMERCIAL",
    mailingDate: new Date().toISOString().slice(0, 10),
    hasNonstandardCharacteristics: false,
    itemValue: Math.max(0, Number(input.itemValue || 0) || 0),
    extraServices: [920],
    ...(settings.accountNumber ? { accountType: settings.accountType, accountNumber: settings.accountNumber } : {}),
  };
  const { payload } = await authorizedJson(settings, "/prices/v3/total-rates/search", { method: "POST", body: JSON.stringify(body) });
  const rates = rateRows(payload);
  return {
    rates,
    status: {
      ...publicStatus(env, runtime),
      ok: rates.length > 0,
      rateCount: rates.length,
      cheapestAmount: rates.length ? rates[0].amount : null,
      priceType: body.priceType,
    },
  };
}

function trackingStatusFromText(value, hasEvent = false) {
  const normalized = text(value).toLowerCase();
  if (/delivered/.test(normalized)) return "delivered";
  if (/out for delivery/.test(normalized)) return "out_for_delivery";
  if (/available for pickup|held at post office|ready for pickup/.test(normalized)) return "available_for_pickup";
  if (/return to sender|returning|returned/.test(normalized)) return "returning";
  if (/alert|exception|unable to deliver|insufficient address|no access|forwarded/.test(normalized)) return "exception";
  if (/accepted|in transit|moving through network|arrived|departed|processed|distribution center/.test(normalized)) return "in_transit";
  if (/pre-shipment|label created|awaiting item|electronic information/.test(normalized)) return "awaiting_pickup";
  return hasEvent ? "in_transit" : "unknown";
}

function parseTrackingResponse(payload = {}, trackingNumber = "") {
  const records = Array.isArray(payload) ? payload : list(payload.tracking || payload.trackingResults || payload.results || payload);
  const selected = records.find((entry) => text(entry.trackingNumber || entry.uniqueTrackingID).toUpperCase() === text(trackingNumber).toUpperCase()) || records[0] || {};
  const events = list(selected.trackingEvents || selected.events).map((event) => ({
    description: text(event.eventType || event.status || event.eventDescription),
    occurredAt: text(event.GMTTimestamp || event.eventTimestamp || event.timestamp),
    code: text(event.eventCode || event.actionCode),
    city: text(event.eventCity),
    state: text(event.eventState),
    postalCode: text(event.eventZIPCode),
    country: text(event.eventCountry),
    recipientName: text(event.recipientName),
    veriPoint: event.veriPoint === true,
  })).sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime());
  const latest = events[0] || null;
  const description = text(selected.status || selected.statusSummary || latest?.description || selected.statusCategory);
  const physicalEvents = events.filter((event) => !/pre-shipment|label created|awaiting item|electronic information/i.test(event.description));
  const status = trackingStatusFromText(`${description} ${latest?.description || ""}`, physicalEvents.length > 0);
  const eligibility = selected.servicesEligibility || {};
  return {
    trackingNumber: text(selected.trackingNumber || trackingNumber),
    uniqueTrackingID: text(selected.uniqueTrackingID),
    mailingDate: text(selected.mailingDate),
    status,
    statusDescription: description || status.replaceAll("_", " "),
    physicalScan: physicalEvents.length > 0,
    physicalScanAt: physicalEvents[0]?.occurredAt || "",
    latestActivityAt: latest?.occurredAt || "",
    latestActivity: latest?.description || description,
    activityCount: events.length,
    activities: events,
    service: text(selected.mailClass || selected.mailClassCode),
    expectedDeliveryDate: text(selected.deliveryDateExpectation?.expectedDeliveryDate || selected.deliveryDateExpectation?.predictedDeliveryDate),
    deliveryEvidence: {
      proofOfDeliveryAvailable: eligibility.proofOfDeliveryEnabled === true || eligibility.trackingProofOfDeliveryEnabled === true,
      returnReceiptElectronicAvailable: eligibility.RREEnabled === true,
      veriPoint: events.some((event) => event.veriPoint),
      receivedBy: events.find((event) => event.recipientName)?.recipientName || "",
      location: [latest?.city, latest?.state, latest?.postalCode].filter(Boolean).join(", "),
      synchronousDownloadAvailable: false,
    },
  };
}

async function trackShipment(trackingNumber, env = process.env, runtime = {}, details = {}) {
  const inquiryNumber = text(trackingNumber).replace(/[^0-9A-Z]/gi, "").toUpperCase();
  if (!inquiryNumber) throw new Error("USPS tracking number is required.");
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured for carrier scan checks.");
  const body = [{
    trackingNumber: inquiryNumber,
    ...(text(details.mailingDate) ? { mailingDate: text(details.mailingDate).slice(0, 10) } : {}),
    ...(text(details.destinationZIPCode).match(/\d{5}/)?.[0] ? { destinationZIPCode: text(details.destinationZIPCode).match(/\d{5}/)[0] } : {}),
  }];
  const { payload } = await authorizedJson(settings, "/tracking/v3r2/tracking", { method: "POST", body: JSON.stringify(body) });
  return { ...parseTrackingResponse(payload, inquiryNumber), source: "usps_api" };
}

async function requestProofOfDelivery(tracking = {}, recipients = [], env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured.");
  if (!settings.crid) throw new Error("Add the USPS CRID before requesting proof of delivery.");
  const trackingNumber = text(tracking.trackingNumber);
  if (!trackingNumber || !text(tracking.uniqueTrackingID)) throw new Error("Refresh USPS tracking first so the unique tracking ID is available.");
  const normalizedRecipients = list(recipients).map((recipient) => ({
    email: text(recipient.email),
    firstName: text(recipient.firstName),
    lastName: text(recipient.lastName),
  })).filter((recipient) => recipient.email).slice(0, 3);
  if (!normalizedRecipients.length) throw new Error("At least one proof-of-delivery email recipient is required.");
  const { payload } = await authorizedJson(settings, `/tracking/v3r2/tracking/${encodeURIComponent(trackingNumber)}/proof-of-delivery`, {
    method: "POST",
    body: JSON.stringify({
      uniqueTrackingID: text(tracking.uniqueTrackingID),
      ...(text(tracking.mailingDate) ? { mailingDate: text(tracking.mailingDate).slice(0, 10) } : {}),
      letterType: text(tracking.letterType || "PROOF_OF_DELIVERY"),
      recipients: normalizedRecipients,
      CRID: settings.crid,
    }),
  });
  return payload;
}

async function listTrackingSubscriptions(env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured.");
  const query = settings.mid ? `?${queryString({ MID: settings.mid, limit: 100 })}` : "?limit=100";
  const { payload } = await authorizedJson(settings, `/subscriptions-tracking/v3r2/subscriptions${query}`, { method: "GET" });
  return payload;
}

async function createTrackingSubscription(input = {}, env = process.env, runtime = {}) {
  const settings = config(env, runtime);
  if (!settings.configured) throw new Error("USPS credentials are not configured.");
  const listenerURL = text(input.listenerURL);
  const adminEmail = text(input.adminEmail || settings.webhookAdminEmail);
  const MID = text(input.MID || settings.mid);
  const trackingNumber = text(input.trackingNumber);
  if (!/^https:\/\//i.test(listenerURL)) throw new Error("USPS tracking subscriptions require a public HTTPS listener URL.");
  if (!adminEmail) throw new Error("Add an administrator email for USPS subscription alerts.");
  if (!MID && !trackingNumber) throw new Error("Add a USPS Mailer ID or one tracking number for the subscription.");
  if (settings.webhookSecret.length !== 32) throw new Error("Save the USPS settings again to generate the required 32-character webhook secret.");
  const filterProperties = MID
    ? { MID, trackingEventTypes: ["ALL_UPDATES"], includeVeriPoint: true }
    : { trackingNumber, trackingEventTypes: ["ALL_UPDATES"], includeVeriPoint: true };
  const { payload } = await authorizedJson(settings, "/subscriptions-tracking/v3r2/subscriptions", {
    method: "POST",
    body: JSON.stringify({ listenerURL, secret: settings.webhookSecret, adminNotification: [{ email: adminEmail }], filterProperties }),
  });
  return payload;
}

function verifyTrackingNotification(body = {}, hmac = "", secret = "") {
  const expected = crypto.createHmac("sha256", text(secret)).update(`${text(body.timestamp)}${text(body.payload)}`).digest("base64");
  const supplied = text(hmac);
  if (!supplied || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

module.exports = {
  accessToken,
  addressFromPayload,
  capabilities,
  cityStateLookup,
  collectZipCandidates,
  config,
  createTrackingSubscription,
  listTrackingSubscriptions,
  parseTrackingResponse,
  publicStatus,
  rateRows,
  requestProofOfDelivery,
  selectPostalCandidate,
  shopRates,
  standardizeAddress,
  suggestPostalCodes,
  trackShipment,
  trackingStatusFromText,
  uspsAddress,
  verifyCredentials,
  verifyTrackingNotification,
};
