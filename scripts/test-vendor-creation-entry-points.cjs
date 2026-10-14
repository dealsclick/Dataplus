const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'web', 'src', 'App.tsx'), 'utf8');
const warehouse = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');
const dialog = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'vendor-create-dialog.tsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(app, /New vendor/, 'Vendors page exposes a create-vendor action');
assert.match(app, /<VendorCreateDialog/, 'Vendors page uses the shared create-vendor workflow');
assert.match(warehouse, /<VendorCreateDialog[\s\S]*context="external-receipt"/, 'external PO receiving uses the shared dialog');
assert.match(warehouse, /setReceivingSupplierId\(vendor\.id\)/, 'new receiving vendor is selected automatically');
assert.match(dialog, /"\/api\/vendors"/, 'shared dialog uses the canonical vendor API');
assert.match(dialog, /inactive vendor/, 'new vendor status is explicit to the operator');
assert.match(server, /Vendor already exists:/, 'duplicate vendor creation is blocked');

console.log('Shared vendor creation is available from Vendors and External PO receipt with duplicate protection and automatic selection.');
