const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { appendNdjsonRowSync, pruneNdjsonFile } = require("../lib/bounded-ndjson");

async function main() {
  const directory = fs.mkdtempSync(path.join(__dirname, ".tmp-ndjson-"));
  const file = path.join(directory, "channel.ndjson");
  const now = Date.now();
  try {
    appendNdjsonRowSync(file, { id: "expired", createdAt: new Date(now - 10_000).toISOString() });
    appendNdjsonRowSync(file, { id: "kept", createdAt: new Date(now).toISOString() });
    fs.appendFileSync(file, "not-json\n");
    const result = await pruneNdjsonFile(file, { cutoffMs: now - 1_000, maxScanBytes: 1024 * 1024 });
    assert.equal(result.kept, 1);
    assert.equal(result.removed, 2);
    const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.id), ["kept"]);

    for (let index = 0; index < 10_000; index += 1) {
      appendNdjsonRowSync(file, { id: `row-${index}`, createdAt: new Date(now).toISOString(), message: "x".repeat(120) });
    }
    const bounded = await pruneNdjsonFile(file, { cutoffMs: now - 1_000, maxScanBytes: 1024 * 1024 });
    assert.equal(bounded.truncatedPrefix, true);
    assert.ok(fs.statSync(file).size <= 1024 * 1024 + 1024, "retained compatibility log should stay near the scan budget");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("Bounded NDJSON retention checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
