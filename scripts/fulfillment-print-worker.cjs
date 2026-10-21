"use strict";

const fs = require("node:fs");
const { buildLabelPacket } = require("../lib/fulfillment-print");

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error("A print packet request file is required.");
  const request = JSON.parse(await fs.promises.readFile(requestPath, "utf8"));
  const packet = await buildLabelPacket(request.entries || [], request.options || {});
  await fs.promises.writeFile(request.outputPath, packet.buffer);
  await fs.promises.writeFile(request.resultPath, JSON.stringify({ failures: packet.failures || [] }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
