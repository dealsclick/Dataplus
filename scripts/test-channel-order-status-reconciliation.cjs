const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const walmart = fs.readFileSync(path.join(__dirname, '../lib/walmart-marketplace.js'), 'utf8');

const shopifyImport = server.slice(
  server.indexOf('async function importShopifyOrders('),
  server.indexOf('function shopifyOrderWebhookQuery(')
);
assert.match(shopifyImport, /order\.cancelledAt && !includeCanceled/);
assert.match(shopifyImport, /postgres\.readOrderByKey\(order\.id\)/);
assert.match(shopifyImport, /existingById\.set\(order\.id, existing\)/);
assert.match(server, /ORDERS_CANCELLED/);

const ebayImport = server.slice(
  server.indexOf('async function importEbayOrders('),
  server.indexOf('function ebayReturnId(')
);
assert.match(ebayImport, /lastmodifieddate/);
assert.match(ebayImport, /reconcileTerminalOrderPurchasing/);

assert.match(walmart, /existing orders refreshed/);
assert.match(walmart, /walmart\.orderStatusSweep/);
assert.match(walmart, /client\.request\(`\/v3\/orders\/\$\{encodeURIComponent\(id\)\}`/);
assert.match(walmart, /reconcileExisting: true/);

console.log('PASS channel order status guards: Shopify cancellations, eBay modified polling, Walmart existing-order sweep');
