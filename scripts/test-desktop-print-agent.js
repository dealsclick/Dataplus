const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  tokenHash,
  tokenMatches,
  publicPrintStation,
  claimablePrintJob,
  claimPrintJob,
  applyPrintJobStatus,
  releasePrintJobsForStation
} = require("../lib/desktop-print-agent");

test("Windows installer stops when pairing fails", () => {
  const script = fs.readFileSync(path.join(__dirname, "dataplus-print-agent.ps1"), "utf8");
  assert.match(script, /if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(script, /Print-agent pairing failed/);
});

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

test("removing a station releases unfinished jobs and preserves printed history", () => {
  const queue = [
    { id: "ready", stationId: "station-1", stationName: "Packing desk", printerName: "Zebra", deliveryStatus: "queued" },
    { id: "claimed", stationId: "station-1", deliveryStatus: "claimed", leaseExpiresAt: "2026-10-01T12:05:00.000Z" },
    { id: "printed", stationId: "station-1", stationName: "Packing desk", deliveryStatus: "printed", printedAt: "2026-10-01T11:00:00.000Z" },
    { id: "other", stationId: "station-2", deliveryStatus: "queued" }
  ];
  const released = releasePrintJobsForStation(queue, { id: "station-1", name: "Packing desk" }, new Date("2026-10-01T12:00:00.000Z"));

  assert.equal(released, 2);
  assert.equal(queue[0].deliveryStatus, "ready");
  assert.equal(queue[0].stationId, "");
  assert.match(queue[0].lastError, /Packing desk was removed/);
  assert.equal(queue[1].leaseExpiresAt, "");
  assert.equal(queue[2].deliveryStatus, "printed");
  assert.equal(queue[2].stationName, "Packing desk");
  assert.equal(queue[3].stationId, "station-2");
});
