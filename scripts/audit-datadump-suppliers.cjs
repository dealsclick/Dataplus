// Read-only audit: does not load credentials or connect to a database/FTP.
const fs = require("node:fs");
const path = require("node:path");
const { forEachDumpRecord } = require("./import-product-dump");
const { createSupplierInventory } = require("../lib/datadump-suppliers");

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--source", "--output", "--sku"].includes(args[index]) || !args[index + 1]) throw new Error("Usage: node scripts/audit-datadump-suppliers.cjs --source FILE [--output REPORT.json] [--sku SKU]");
    values[args[index]] = args[index + 1];
  }
  if (!values["--source"]) throw new Error("--source is required; select the exact file used by the import job.");
  const source = path.resolve(values["--source"]);
  const output = path.resolve(values["--output"] || "outputs/datadump-supplier-audit.json");
  if (source === output) throw new Error("The report must not overwrite the source dump.");
  const before = fs.statSync(source);
  const inventory = createSupplierInventory();
  const skuMatches = [];
  let scanned = 0;
  await forEachDumpRecord(source, {}, row => {
    inventory.observe(row);
    scanned += 1;
    if (values["--sku"] && [row._id, row.sku, row.SKU, row.id].some(value => String(value || "").toLowerCase() === values["--sku"].toLowerCase())) {
      skuMatches.push({ sku: String(row._id || row.sku || row.SKU || row.id), supplier: row.supplier, supplierCode: row.supplier_code || row.supplierCode });
    }
    if (scanned % 1000000 === 0) process.stderr.write(`Scanned ${scanned} records.\n`);
  });
  const after = fs.statSync(source);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The dump changed during the audit; rerun against a stable file.");
  const result = { source, size: before.size, modifiedAt: before.mtime.toISOString(), scanned, suppliers: inventory.rows(), requestedSku: values["--sku"] || null, skuMatches };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ scanned, supplierIdentities: result.suppliers.length, requestedSku: result.requestedSku, skuMatches, report: output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
