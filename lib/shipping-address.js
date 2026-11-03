function text(value) {
  return String(value ?? "").trim();
}

function token(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function puertoRicoPostalCode(value) {
  return /^(?:006|007|009)\d{2}(?:-\d{4})?$/.test(text(value));
}

function isPuertoRicoAddress(address = {}) {
  const country = token(address.countryCode || address.country);
  const state = token(address.state || address.province || address.stateOrProvince);
  const city = text(address.city || address.town);
  const postalCode = text(address.postalCode || address.zip || address.postcode);
  return country === "pr"
    || country === "puertorico"
    || state === "pr"
    || state === "puertorico"
    || /\bpuerto\s+rico\b/i.test(city)
    || (puertoRicoPostalCode(postalCode) && ["", "us", "usa", "pr", "puertorico"].includes(country));
}

function normalizedPuertoRicoLocalityLine(value, city, postalCode) {
  const compact = token(value);
  if (!compact) return false;
  const cityToken = token(city);
  const postalToken = token(postalCode);
  return [
    `${cityToken}pr${postalToken}`,
    `${cityToken}puertorico${postalToken}`,
    `${cityToken}${postalToken}`,
  ].filter(Boolean).includes(compact);
}

function stripPuertoRicoLocalitySuffix(value, city, postalCode) {
  const source = text(value);
  if (!source || !city || !postalCode) return source;
  const cityPattern = escapeRegex(city).replace(/\s+/g, "\\s+");
  const postalPattern = escapeRegex(postalCode).replace(/\\-/, "-?");
  const locality = new RegExp(`\\s+${cityPattern}\\s+(?:(?:PR|Puerto\\s+Rico)\\s+)?${postalPattern}\\s*$`, "i");
  const stripped = source.replace(locality, "").trim();
  return stripped || source;
}

function normalizeCarrierShippingAddress(address = {}) {
  const normalized = { ...address };
  if (!isPuertoRicoAddress(address)) return normalized;

  const postalCode = text(address.postalCode || address.zip || address.postcode);
  const rawCity = text(address.city || address.town);
  const city = rawCity.replace(/\s+(?:puerto\s+rico|pr)\s*$/i, "").trim();
  const line1Parts = text(address.line1 || address.addressLine1 || address.address1)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const primaryLine = stripPuertoRicoLocalitySuffix(line1Parts.shift() || "", city, postalCode);
  const secondaryParts = [
    ...line1Parts,
    text(address.line2 || address.addressLine2 || address.address2),
  ].filter((part) => part && !normalizedPuertoRicoLocalityLine(part, city, postalCode));

  return {
    ...normalized,
    line1: primaryLine,
    line2: secondaryParts.join(", "),
    city,
    state: "PR",
    postalCode,
    country: "US",
  };
}

module.exports = {
  isPuertoRicoAddress,
  normalizeCarrierShippingAddress,
};
