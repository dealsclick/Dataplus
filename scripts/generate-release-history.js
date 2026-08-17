#!/usr/bin/env node
const { HISTORY_FILE, writeReleaseHistory } = require("../lib/release-history");

try {
  const history = writeReleaseHistory();
  process.stdout.write(`Generated ${history.total.toLocaleString()} release entries at ${HISTORY_FILE}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
