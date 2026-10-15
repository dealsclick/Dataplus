const MULTI_SEARCH_LIMIT = 100;

function parseSearchTerms(value, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || MULTI_SEARCH_LIMIT)));
  const terms = String(value || "")
    .split(/[\r\n,;]+/)
    .map((term) => term.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, limit);
}

function isMultiSearch(value) {
  return parseSearchTerms(value).length > 1;
}

module.exports = { MULTI_SEARCH_LIMIT, parseSearchTerms, isMultiSearch };
