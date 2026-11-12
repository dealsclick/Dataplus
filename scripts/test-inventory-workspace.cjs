const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'web', 'src', 'App.tsx'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'catalog-workspaces.tsx'), 'utf8');

assert.match(dbSource, /options\.inventorySummary/);
assert.match(dbSource, /physical_on_hand/);
assert.match(dbSource, /supplier_available/);
assert.match(dbSource, /physical_value/);
assert.match(dbSource, /hydrateProductsWithLastSold/);
assert.match(dbSource, /max\(coalesce\(order_record\.order_date, order_record\.created_at\)\) as last_sold_at/);

assert.match(serverSource, /url\.pathname === "\/api\/inventory\/summary"/);
assert.match(serverSource, /physical_on_hand,physical_reserved,physical_available,supplier_available,combined_available/);
assert.match(serverSource, /physical_inventory_value,last_sold_at/);
assert.match(serverSource, /inventoryMetricLocationKeys/);
assert.match(serverSource, /inventoryOwnershipForLocations/);

for (const field of ['physicalOnHand', 'physicalReserved', 'physicalAvailable', 'supplierAvailable', 'combinedAvailable', 'physicalValue', 'lastSoldAt']) {
  assert.match(appSource, new RegExp(`${field}\\?`));
}

assert.match(workspaceSource, /Physical owned/);
assert.match(workspaceSource, /Supplier available/);
assert.match(workspaceSource, /Combined availability/);
assert.match(workspaceSource, /Physical inventory value/);
assert.match(workspaceSource, /Export results/);
assert.match(workspaceSource, /Last sold/);
assert.match(workspaceSource, /Supplier availability is sourcing capacity, not warehouse-owned inventory/);

console.log('inventory workspace tests passed');
