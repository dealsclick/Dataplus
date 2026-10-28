function compactTrackingValue(value) {
  return String(value || "")
    .trim()
    .replace(/^\][A-Z0-9]{2}/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

function trackingUrlValues(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  try {
    const url = new URL(raw);
    const values = [];
    const trackingKeys = new Set([
      "tracking", "trackingnumber", "trackingno", "tracknum", "tracknumber", "tracknumbers",
      "waybill", "waybillno", "waybillnumber", "mailno", "shiptrackingnumber", "shipmenttrackingnumber"
    ]);
    for (const [key, entry] of url.searchParams.entries()) {
      if (!trackingKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) continue;
      values.push(...String(entry || "").split(/[\s,|]+/));
    }
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    for (const [key, entry] of hashParams.entries()) {
      if (trackingKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) values.push(entry);
    }
    for (const segment of url.pathname.split("/")) {
      const decoded = decodeURIComponent(segment || "").trim();
      if (decoded.length >= 8 && /\d/.test(decoded)) values.push(decoded);
    }
    return values.filter(Boolean);
  } catch {
    return [];
  }
}

function canonicalTrackingValue(value) {
  const raw = String(value || "").trim();
  const urlValue = trackingUrlValues(raw)[0];
  if (urlValue) return canonicalTrackingValue(urlValue);
  const compact = compactTrackingValue(raw);
  if (!compact) return "";
  if (/^420\d{9}/.test(compact) && compact.length >= 34) return compact.slice(12);
  if (/^420\d{5}/.test(compact) && compact.length >= 26) return compact.slice(8);
  const parenthesized = raw.match(/\(\d{2,4}\)\s*([A-Z0-9-]{8,80})/i);
  if (parenthesized?.[1]) return compactTrackingValue(parenthesized[1]);
  const embedded = compact.match(/(?:1Z[A-Z0-9]{16}|TBA\d{8,}|JD\d{8,})/i);
  return embedded?.[0]?.toUpperCase() || compact;
}

function trackingLookupCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 300) return [];
  const candidates = new Set();
  const add = (candidate) => {
    const compact = compactTrackingValue(candidate);
    if (compact.length >= 4 && compact.length <= 120) candidates.add(compact);
  };

  add(raw);
  for (const token of raw.replace(/[\u001d\u001e\u001f]/g, " ").split(/\s+/)) add(token);
  for (const candidate of trackingUrlValues(raw)) add(candidate);

  const compact = compactTrackingValue(raw);
  // USPS IMpb scans commonly prefix the visible tracking number with 420 and
  // the destination ZIP. Keep both ZIP-5 and ZIP-9 forms as candidates.
  if (/^420\d{5}/.test(compact)) add(compact.slice(8));
  if (/^420\d{9}/.test(compact)) add(compact.slice(12));

  // GS1 application identifiers can be emitted by hardware scanners as text.
  const parenthesized = [...raw.matchAll(/\(\d{2,4}\)\s*([A-Z0-9-]{8,80})/gi)];
  for (const match of parenthesized) add(match[1]);

  // Some carrier barcodes include a numeric routing prefix. Exact suffixes are
  // still safe because the database resolver returns every matching shipment.
  if (/^\d+$/.test(compact)) {
    for (const length of [34, 30, 26, 22, 20, 18, 15, 12, 10]) {
      if (compact.length > length) add(compact.slice(-length));
    }
  }

  const embedded = compact.match(/(?:1Z[A-Z0-9]{16}|TB[AMCD]\d{8,}|(?:GM|JVGL|JJD|JD)[A-Z0-9]{8,}|(?:SPX|SPD)\d{8,}|(?:GF\d{10,}|GOFO[A-Z0-9]{6,})|SWIFTX[A-Z0-9]{6,}|[A-Z]{1,3}\d{8,})/g) || [];
  for (const candidate of embedded) add(candidate);
  return [...candidates];
}

function trackingValuesMatch(left, right) {
  const leftCandidates = new Set(trackingLookupCandidates(left));
  return trackingLookupCandidates(right).some((candidate) => leftCandidates.has(candidate));
}

module.exports = { compactTrackingValue, canonicalTrackingValue, trackingLookupCandidates, trackingValuesMatch, trackingUrlValues };
