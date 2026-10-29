const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

assert.match(database, /function filterOptionValues\(value\)/, "database parses comma-separated categorical filters");
assert.match(database, /then 'canceled' else lower\(coalesce\(status, ''\)\) end\) = any/, "database canonicalizes both canceled spellings");
assert.match(database, /const sources = filterOptionValues/, "channel filter supports multiple values");
assert.match(database, /const payments = filterOptionValues/, "payment filter supports multiple values");
assert.match(database, /const shippingStatuses = filterOptionValues/, "shipping filter supports multiple values");
assert.match(database, /const outcomes = filterOptionValues/, "outcome filter supports multiple values");

assert.match(app, /function OrderMultiSelect\(/, "React app includes the shared multi-select control");
assert.match(app, /normalized === "cancelled" \? "canceled"/, "React app canonicalizes the British spelling");
assert.doesNotMatch(app, /\["new", "pending", "processing", "hold", "completed", "canceled", "cancelled"/, "status choices do not expose duplicate canceled spellings");
assert.match(app, /setStatus\(serializeOrderFilterValues\(orderFilterValues\(filters\.status/, "saved views restore canonical multi-value statuses");
assert.doesNotMatch(app, /\+ Filter<\/Button>.*Add order filter/, "legacy single-choice order filter was removed");

console.log("order multi-select filter tests passed");
