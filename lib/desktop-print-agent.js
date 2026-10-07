const crypto = require("crypto");

const PRINT_AGENT_LEASE_MS = 2 * 60 * 1000;
const PRINT_STATION_ONLINE_MS = 90 * 1000;

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function tokenMatches(value, expectedHash) {
  const actual = Buffer.from(tokenHash(value), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function publicPrintStation(station, now = Date.now()) {
  const lastSeen = Date.parse(station?.lastSeenAt || "");
  return {
    id: station?.id || "",
    name: station?.name || "Print station",
    status: station?.status || "pending",
    paired: Boolean(station?.tokenHash),
    online: station?.status === "active" && Number.isFinite(lastSeen) && now - lastSeen <= PRINT_STATION_ONLINE_MS,
    hostname: station?.hostname || "",
    platform: station?.platform || "",
    printers: Array.isArray(station?.printers) ? station.printers : [],
    defaultPrinter: station?.defaultPrinter || "",
    lastSeenAt: station?.lastSeenAt || "",
    lastError: station?.lastError || "",
    createdAt: station?.createdAt || "",
    updatedAt: station?.updatedAt || ""
  };
}

function claimablePrintJob(job, stationId, now = Date.now()) {
  if (String(job?.stationId || "") !== String(stationId || "")) return false;
  const deliveryStatus = String(job?.deliveryStatus || "").toLowerCase();
  if (deliveryStatus === "queued") return true;
  if (!["claimed", "printing"].includes(deliveryStatus)) return false;
  const leaseExpiresAt = Date.parse(job?.leaseExpiresAt || "");
  return !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now;
}

function claimPrintJob(job, station, now = new Date()) {
  job.deliveryStatus = "claimed";
  job.status = "queued";
  job.claimedAt = now.toISOString();
  job.leaseExpiresAt = new Date(now.getTime() + PRINT_AGENT_LEASE_MS).toISOString();
  job.agentAttemptCount = Number(job.agentAttemptCount || 0) + 1;
  job.updatedAt = now.toISOString();
  return {
    id: job.id,
    printNumber: job.printNumber,
    printerName: job.printerName || station?.defaultPrinter || "",
    size: job.size || "4x6",
    includePackingSlips: job.includePackingSlips === true,
    orderCount: Number(job.orderCount || 0),
    documentUrl: `/api/fulfillment/print-agent/jobs/${encodeURIComponent(String(job.id))}/document.pdf`
  };
}

function applyPrintJobStatus(job, status, detail = {}, now = new Date()) {
  const next = String(status || "").toLowerCase();
  if (!['printing', 'printed', 'failed'].includes(next)) throw new Error("Unsupported print status.");
  job.deliveryStatus = next;
  job.status = next === "printed" ? "printed" : next === "failed" ? "failed" : "queued";
  job.updatedAt = now.toISOString();
  job.leaseExpiresAt = next === "printing" ? new Date(now.getTime() + PRINT_AGENT_LEASE_MS).toISOString() : "";
  if (next === "printing") job.printingAt = now.toISOString();
  if (next === "printed") {
    job.printedAt = now.toISOString();
    job.printedBy = detail.printedBy || detail.stationName || "Desktop print agent";
    job.printCount = Number(job.printCount || 0) + 1;
    job.lastError = "";
  }
  if (next === "failed") job.lastError = String(detail.error || "The desktop print agent could not print this packet.").slice(0, 1000);
  return job;
}

function releasePrintJobsForStation(printQueue, station, now = new Date()) {
  let released = 0;
  for (const job of Array.isArray(printQueue) ? printQueue : []) {
    if (String(job?.stationId || "") !== String(station?.id || "")) continue;
    const deliveryStatus = String(job.deliveryStatus || job.status || "").toLowerCase();
    if (["printed", "completed", "cancelled", "canceled"].includes(deliveryStatus) || job.printedAt) continue;
    job.status = "ready";
    job.deliveryStatus = "ready";
    job.stationId = "";
    job.stationName = "";
    job.printerName = "";
    job.claimedAt = "";
    job.printingAt = "";
    job.leaseExpiresAt = "";
    job.lastError = `${station?.name || "Print station"} was removed. Choose another print destination.`;
    job.updatedAt = now.toISOString();
    released += 1;
  }
  return released;
}

module.exports = {
  PRINT_AGENT_LEASE_MS,
  PRINT_STATION_ONLINE_MS,
  tokenHash,
  tokenMatches,
  publicPrintStation,
  claimablePrintJob,
  claimPrintJob,
  applyPrintJobStatus,
  releasePrintJobsForStation
};
