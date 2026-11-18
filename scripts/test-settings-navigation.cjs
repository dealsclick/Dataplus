const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "web/src/components/settings-navigation.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "web/src/components/settings-route.tsx"), "utf8");
const carrierProviders = fs.readFileSync(path.join(root, "web/src/components/carrier-provider-settings.tsx"), "utf8");

assert.match(navigation, /id:\s*"shipping",\s*label:\s*"Shipping providers"/);
assert.match(route, /aria-label="Search system settings"/);
assert.match(route, /label:\s*"EchoSync Freight"[\s\S]*tab:\s*"shipping"|tab:\s*"shipping"[\s\S]*label:\s*"EchoSync Freight"/);
assert.match(route, /<TabsContent value="shipping"[\s\S]*<CarrierProviderSettings/);
assert.equal((route.match(/<CarrierProviderSettings/g) || []).length, 1, "Carrier settings must have one canonical workspace");
assert.match(route, /nextUrl\.searchParams\.set\("tab", tab\)/);
assert.match(route, /<TabsContent value="shipping" className="grid min-w-0 max-w-full gap-4 overflow-x-clip">/);
assert.match(carrierProviders, /return <div className="grid min-w-0 max-w-full gap-4 overflow-x-clip">/);
assert.match(carrierProviders, /2xl:grid-cols-\[minmax\(0,1fr\)_auto\]/);

console.log("Settings navigation, search, and responsive containment checks passed.");
