const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "web/src/components/settings-navigation.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "web/src/components/settings-route.tsx"), "utf8");

assert.match(navigation, /id:\s*"shipping",\s*label:\s*"Shipping providers"/);
assert.match(route, /aria-label="Search system settings"/);
assert.match(route, /label:\s*"EchoSync Freight"[\s\S]*tab:\s*"shipping"|tab:\s*"shipping"[\s\S]*label:\s*"EchoSync Freight"/);
assert.match(route, /<TabsContent value="shipping"[\s\S]*<CarrierProviderSettings/);
assert.equal((route.match(/<CarrierProviderSettings/g) || []).length, 1, "Carrier settings must have one canonical workspace");
assert.match(route, /nextUrl\.searchParams\.set\("tab", tab\)/);

console.log("Settings navigation and search checks passed.");
