function compactTrackingValue(value) {
  return String(value || "")
    .trim()
    .replace(/^\][A-Z0-9]{2}/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

function trackingLookupCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 300) return [];
  const candidates = new Set();
  const add = (candidate) => {
    const compact = compactTrackingValue(candidate);
    if (compact.length >= 6 && compact.length <= 80) candidates.add(compact);
  };

  add(raw);
  for (const token of raw.replace(/[\u001d\u001e\u001f]/g, " ").split(/\s+/)) add(token);

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

  const embedded = compact.match(/(?:1Z[A-Z0-9]{16}|TBA\d{8,}|JD\d{8,}|[A-Z]{1,3}\d{8,})/g) || [];
  for (const candidate of embedded) add(candidate);
  return [...candidates];
}

function trackingValuesMatch(left, right) {
  const leftCandidates = new Set(trackingLookupCandidates(left));
  return trackingLookupCandidates(right).some((candidate) => leftCandidates.has(candidate));
}

module.exports = { compactTrackingValue, trackingLookupCandidates, trackingValuesMatch };
