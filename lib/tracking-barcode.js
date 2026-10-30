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

function fedexGroundTrackingValue(value) {
  const raw = String(value || "").trim();
  const numeric = raw.replace(/[\s()-]/g, "");
  // FedEx Ground return labels can encode a 34-digit routing value whose
  // final 12 digits are the tracking number printed next to TRK#.
  if (/^\d{34}$/.test(numeric) && /^0{10,13}$/.test(numeric.slice(9, 22))) return numeric.slice(-12);
  const labelled = raw.match(/(?:TRK|TRACKING)(?:\s*(?:NO|NUMBER))?\s*#?\s*[:=-]?\s*([0-9][0-9\s-]{10,28}[0-9])/i);
  if (labelled?.[1]) {
    const tracking = labelled[1].replace(/\D/g, "");
    if ([12, 15, 20, 22].includes(tracking.length)) return tracking;
  }
  return "";
}

function canonicalTrackingValue(value) {
  const raw = String(value || "").trim();
  const urlValue = trackingUrlValues(raw)[0];
  if (urlValue) return canonicalTrackingValue(urlValue);
  const compact = compactTrackingValue(raw);
  if (!compact) return "";
  const fedexGround = fedexGroundTrackingValue(raw);
  if (fedexGround) return fedexGround;
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
  const fedexGround = fedexGroundTrackingValue(raw);
  if (fedexGround) add(fedexGround);
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

  // PDF417 and scanner keyboard payloads may include carrier fields around a
  // long numeric value. Preserve each field and its common carrier suffixes.
  // This also resolves the 34-digit FedEx Ground return barcode to TRK#.
  for (const match of raw.matchAll(/\d{10,60}/g)) {
    const numeric = match[0];
    add(numeric);
    for (const length of [34, 30, 26, 22, 20, 18, 15, 12, 10]) {
      if (numeric.length > length) add(numeric.slice(-length));
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
