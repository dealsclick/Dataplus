const assert = require("node:assert/strict");
const {
  defaultQuoteTermIds,
  normalizeQuoteTermIds,
  normalizeQuoteTermLibrary,
  normalizeQuoteTermSnapshot,
  quoteTermSnapshot,
  quoteTerms
} = require("../lib/quote-documents");

const library = normalizeQuoteTermLibrary([
  { id: "shipping", group: "Shipping", label: "Shipping", text: "Shipping is additional.", active: true, defaultSelected: true },
  { id: "net-30", group: "Payment", label: "Net 30", text: "Payment is due in 30 days.", active: true, defaultSelected: true, exclusiveGroup: "payment" },
  { id: "inactive", group: "Other", label: "Inactive", text: "Old wording.", active: false, defaultSelected: true }
]);

assert.deepEqual(defaultQuoteTermIds(library), ["shipping", "net-30"]);
assert.deepEqual(normalizeQuoteTermIds(["net-30", "missing", "shipping"], library), ["shipping", "net-30"]);

const snapshot = quoteTermSnapshot(library, ["shipping", "net-30"]);
assert.deepEqual(snapshot.map((term) => term.id), ["shipping", "net-30"]);
assert.deepEqual(quoteTerms({ selectedTermIds: ["shipping", "net-30"], selectedTermsSnapshot: snapshot }), ["Shipping is additional.", "Payment is due in 30 days."]);

const changedLibrary = normalizeQuoteTermLibrary(library.map((term) => term.id === "shipping" ? { ...term, text: "New shipping wording." } : term));
assert.deepEqual(quoteTerms({ selectedTermIds: ["shipping", "net-30"], selectedTermsSnapshot: snapshot }), ["Shipping is additional.", "Payment is due in 30 days."]);
assert.equal(quoteTermSnapshot(changedLibrary, ["shipping"])[0].text, "New shipping wording.");

const removedTerm = quoteTermSnapshot([], ["shipping"], snapshot);
assert.equal(removedTerm[0].text, "Shipping is additional.");
assert.deepEqual(normalizeQuoteTermSnapshot(removedTerm), removedTerm);

console.log("Quote term library and immutable quote snapshots passed.");
