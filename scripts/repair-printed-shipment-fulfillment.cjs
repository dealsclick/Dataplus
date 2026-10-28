const { reconcilePrintedShipmentFulfillment } = require("../server");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

async function main() {
  const order = argument("order");
  const shipment = argument("shipment");
  const actor = argument("actor") || "DataPlus repair";
  if (!order) throw new Error("Pass --order with the DataPlus order number or ID.");
  if (!process.argv.includes("--apply")) throw new Error("This repair changes fulfillment, inventory, and channel state. Re-run with --apply after confirming the order and shipment.");
  const result = await reconcilePrintedShipmentFulfillment(order, shipment, actor);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
