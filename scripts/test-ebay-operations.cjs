const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const operations = require("../lib/ebay-operations");

const cancellation = operations.normalizeCancellation({
  cancelId: "CANCEL-1",
  cancelStatus: "CANCEL_REQUESTED",
  orderId: "ORDER-1",
  cancelReason: "BUYER_ASKED_CANCEL",
  creationDate: "2026-10-29T12:00:00Z"
});
assert.equal(cancellation.id, "CANCEL-1");
assert.equal(cancellation.orderId, "ORDER-1");
assert.equal(cancellation.reason, "BUYER_ASKED_CANCEL");

const dispute = operations.normalizePaymentDispute({
  paymentDisputeId: "PD-1",
  paymentDisputeStatus: "OPEN",
  orderId: "ORDER-2",
  amount: { value: "24.99", currency: "USD" }
});
assert.equal(dispute.amount.value, 24.99);
assert.equal(dispute.amount.currency, "USD");

const conversation = operations.normalizeConversation({
  conversationId: "CONV-1",
  otherPartyUsername: "buyer-name",
  unreadCount: 2,
  latestMessage: { messageText: "Where is my order?" }
});
assert.equal(conversation.otherPartyUsername, "buyer-name");
assert.equal(conversation.unreadCount, 2);

const shipped = operations.localOrderReference({
  id: "100",
  orderNumber: "55577",
  shipments: [{ status: "in_transit", trackingNumber: "1Z999" }]
});
assert.equal(shipped.shipped, true);
assert.deepEqual(shipped.trackingNumbers, ["1Z999"]);

const capabilities = operations.scopeCapabilities([
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/commerce.message"
].join(" "));
assert.deepEqual(capabilities, {
  orders: true,
  returnsAndCancellations: true,
  paymentDisputes: true,
  analytics: true,
  marketing: true,
  messages: true
});

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const channels = fs.readFileSync(path.join(root, "web", "src", "components", "channels-route.tsx"), "utf8");
const messages = fs.readFileSync(path.join(root, "web", "src", "components", "messages-route.tsx"), "utf8");

for (const route of ["/api/ebay/operations", "/api/ebay/performance", "/api/ebay/marketing/opportunities", "/api/ebay/messages"]) {
  assert.ok(server.includes(route), `missing ${route}`);
}
assert.match(server, /ebayCancellationActionMatch/, "missing cancellation action routing");
assert.match(server, /ebayDisputeActionMatch/, "missing payment dispute action routing");

assert.match(server, /localOrder\?\.shipped/, "cancellation approval must be blocked after shipment activity");
assert.match(server, /body\.confirm !== true/, "live eBay actions must require explicit confirmation");
assert.match(server, /sell\.analytics\.readonly/, "analytics scope must be requested");
assert.match(server, /commerce\.message/, "message scope must be requested");
assert.match(channels, /<EbayOperations enabled=/, "eBay Operations must be reachable from the channel workspace");
assert.match(messages, /<SelectItem value="ebay">eBay<\/SelectItem>/, "shared Messages must expose eBay as a source");

console.log("eBay operations tests passed");
