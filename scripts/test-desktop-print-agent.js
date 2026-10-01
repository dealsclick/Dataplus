const test = require("node:test");
const assert = require("node:assert/strict");
const {
  tokenHash,
  tokenMatches,
  publicPrintStation,
  claimablePrintJob,
  claimPrintJob,
  applyPrintJobStatus
} = require("../lib/desktop-print-agent");

test("print-agent tokens are compared by their hashes", () => {
  const hash = tokenHash("secret-token");
  assert.equal(tokenMatches("secret-token", hash), true);
  assert.equal(tokenMatches("wrong-token", hash), false);
});

test("public stations never expose pairing or agent secrets", () => {
  const station = publicPrintStation({ id: "station-1", status: "active", tokenHash: "secret", pairingCodeHash: "secret", lastSeenAt: new Date().toISOString() });
  assert.equal(station.online, true);
  assert.equal("tokenHash" in station, false);
  assert.equal("pairingCodeHash" in station, false);
});

test("queued and expired leased jobs can be claimed", () => {
  assert.equal(claimablePrintJob({ stationId: "station-1", deliveryStatus: "queued" }, "station-1"), true);
  assert.equal(claimablePrintJob({ stationId: "station-1", deliveryStatus: "claimed", leaseExpiresAt: "2020-01-01T00:00:00.000Z" }, "station-1"), true);
  assert.equal(claimablePrintJob({ stationId: "station-2", deliveryStatus: "queued" }, "station-1"), false);
});

test("claim and acknowledgement preserve the durable print lifecycle", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const job = { id: "print-1", printNumber: "PRINT-1", stationId: "station-1", deliveryStatus: "queued", printCount: 0 };
  const claimed = claimPrintJob(job, { defaultPrinter: "Zebra" }, now);
  assert.equal(claimed.printerName, "Zebra");
  assert.equal(job.deliveryStatus, "claimed");
  applyPrintJobStatus(job, "printed", { stationName: "Packing desk" }, now);
  assert.equal(job.status, "printed");
  assert.equal(job.printCount, 1);
  assert.equal(job.printedBy, "Packing desk");
});
