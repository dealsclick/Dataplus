# EchoSync freight integration

DataPlus connects the EchoSync APIs as separate credential domains because Echo grants each service independently.

## Capabilities

- LTL rates: `POST /api/shipping-providers/echosync/quotes` with `mode: "ltl"` forwards the request payload to Echo Shipper API V2 rates.
- Truckload and partial-load quotes: the same endpoint with `mode: "tl"` or `mode: "pl"` uses Echo Pricing API V2.
- Capacity matching: `POST /api/shipping-providers/echosync/capacity` searches Carrier API V2 available loads. This is optional and requires carrier credentials with `loads:read`.
- Shipment tracking: `GET /api/shipping-providers/echosync/tracking/:shipmentId` returns the Echo shipment record and tracking events.
- Webhooks: Echo posts tracking or available-load events to `POST /api/webhooks/echosync`.

## Credentials

Configure EchoSync under System Settings > Shipping providers. Secrets remain server-side and are never returned to the browser.

- Shipper UserName and API Key enable LTL rates and shipment tracking.
- Pricing Client ID and Client Secret enable TL and PL quotes using `quotes:create`.
- Carrier Client ID and Client Secret enable capacity matching using `loads:read`.
- The webhook signing secret is created by BuySupply and supplied to Echo during webhook registration.

Environment-variable fallbacks are documented in `.env.example`.

## Webhook security and processing

DataPlus verifies `X-Echo-Hmac-SHA256` against the exact raw request body using HMAC-SHA256. It deduplicates retries by `X-Echo-Webhook-Id`, stores accepted events in a bounded NDJSON inbox, acknowledges immediately, and processes linked order shipment updates asynchronously. An order shipment is linked when its `echoShipmentId` equals the Echo load or shipment ID.

Register the public HTTPS callback as:

```text
https://dataplusapp.duckdns.org/api/webhooks/echosync
```

## Verification

```powershell
node scripts/test-echo-sync.cjs
node --check lib/echo-sync.js
node --check server.js
cd web
.\node_modules\.bin\tsc.cmd -b --pretty false
```
