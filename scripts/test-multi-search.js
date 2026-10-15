const assert = require("assert");
const { MULTI_SEARCH_LIMIT, parseSearchTerms, isMultiSearch } = require("../lib/multi-search");

assert.deepStrictEqual(parseSearchTerms("ABC1, abc2,ABC1"), ["abc1", "abc2"]);
assert.deepStrictEqual(parseSearchTerms("ABC1\r\nabc2\nabc3"), ["abc1", "abc2", "abc3"]);
assert.deepStrictEqual(parseSearchTerms("'ABC1'; \"ABC2\""), ["abc1", "abc2"]);
assert.strictEqual(isMultiSearch("ABC1"), false);
assert.strictEqual(isMultiSearch("ABC1,ABC2"), true);
assert.strictEqual(parseSearchTerms(Array.from({ length: MULTI_SEARCH_LIMIT + 20 }, (_, index) => `SKU${index}`).join(",")).length, MULTI_SEARCH_LIMIT);

console.log("Multi-value search parser tests passed.");
