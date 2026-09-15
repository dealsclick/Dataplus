const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { mappedTaxonomy } = require('../lib/datadump-category');
const apply = process.argv.includes('--apply');
const vendor = process.argv.find(x => x.startsWith('--vendor='))?.slice(9);
const supplier = process.argv.find(x => x.startsWith('--supplier='))?.slice(11);
if (!vendor || !supplier) throw Error('Specify --vendor=dh --supplier=D&H; preview is the default.');
const id = crypto.randomUUID(), dir = path.resolve('outputs', `category-repair-${id}`);
fs.mkdirSync(dir, { recursive: true });
const report = { id, apply, vendor, supplier, scanned: 0, parsed: 0, products: 0, sources: 0, paths: {}, malformed: 0 };
const job = { id, section: 'Products', operation: `${apply ? 'Repair' : 'Review'} ${supplier} stored datadump categories`, direction: 'import', status: 'running', phase: 'category_repair', workerTask: '', createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), message: 'Parsing saved mapped_category levels; no datadump download or re-import.' };
async function run() {
  const pool = db.getPool(); if (!pool) throw Error('PostgreSQL is required');
  await db.upsertOperationJob(job);
  let after = '';
  for (;;) {
    const rows = (await pool.query('select source_sku,mapped_category from product_dump_commercial_fields where vendor_id=$1 and source_sku>$2 order by source_sku limit 500', [vendor, after])).rows;
    if (!rows.length) break;
    after = rows.at(-1).source_sku;
    const values = [];
    for (const row of rows) {
      report.scanned++; const parsed = mappedTaxonomy(row);
      if (!parsed.path) { report.malformed++; continue; }
      report.parsed++; report.paths[parsed.path] = (report.paths[parsed.path] || 0) + 1;
      values.push({ sku: row.source_sku, category: parsed.path, unspsc: parsed.unspsc });
    }
    if (apply && values.length) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const keys = values.map(x => x.sku);
        const before = (await client.query("select product_id,sku,category,main_category,source_category,raw from products where supplier=$1 and sku=any($2) for update", [supplier, keys])).rows;
        const sources = (await client.query('select vendor_id,source_sku,category,source_category,raw from vendor_catalog_items where vendor_id=$1 and source_sku=any($2) for update', [vendor, keys])).rows;
        fs.appendFileSync(path.join(dir, 'before.ndjson'), JSON.stringify({ through: after, products: before, sources }) + '\n');
        const sourceResult = await client.query(`with v as (select * from jsonb_to_recordset($2::jsonb) as x(sku text,category text,unspsc text))
          update vendor_catalog_items s set source_category=v.category,
          raw=coalesce(s.raw,'{}')||jsonb_build_object('sourceCategory',v.category,'vendorCategory',v.category,'unspsc',coalesce(nullif(s.raw->>'unspsc',''),v.unspsc),'mappedCategoryRepairedAt',now()),updated_at=now()
          from v where s.vendor_id=$1 and s.source_sku=v.sku and coalesce(nullif(s.source_category,''),nullif(s.raw->>'vendorCategory',''),nullif(s.raw->>'sourceCategory','')) is null`, [vendor, JSON.stringify(values)]);
        const productResult = await client.query(`with v as (select * from jsonb_to_recordset($2::jsonb) as x(sku text,category text,unspsc text))
          update products p set source_category=coalesce(nullif(p.source_category,''),v.category),
          category=coalesce(nullif(p.category,''),nullif(p.main_category,''),v.category),main_category=coalesce(nullif(p.main_category,''),nullif(p.category,''),v.category),
          raw=coalesce(p.raw,'{}')||jsonb_build_object(
            'sourceCategory',coalesce(nullif(p.source_category,''),nullif(p.raw->>'sourceCategory',''),v.category),
            'vendorCategory',coalesce(nullif(p.raw->>'vendorCategory',''),v.category),
            'category',coalesce(nullif(p.category,''),nullif(p.main_category,''),v.category),
            'mainCategory',coalesce(nullif(p.main_category,''),nullif(p.category,''),v.category),
            'categoryVerified',case when coalesce(nullif(p.category,''),nullif(p.main_category,'')) is null then 'true'::jsonb else coalesce(p.raw->'categoryVerified','false'::jsonb) end,
            'unspsc',coalesce(nullif(p.raw->>'unspsc',''),v.unspsc),'mappedCategoryRepairedAt',now(),'mappedCategoryRepairJobId',$3::text),updated_at=now()
          from v where p.supplier=$1 and p.sku=v.sku and (coalesce(p.source_category,'')='' or (coalesce(p.category,'')='' and coalesce(p.main_category,'')=''))`, [supplier, JSON.stringify(values), id]);
        await client.query('commit'); report.products += productResult.rowCount; report.sources += sourceResult.rowCount;
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    }
    job.message = `${report.scanned} stored records checked; ${report.parsed} structured categories; ${report.products} products repaired.`;
    Object.assign(job, { processedRows: report.scanned, changed: report.products, updatedAt: new Date().toISOString() });
    await db.upsertOperationJob(job); console.log(job.message);
  }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  Object.assign(job, { status: 'success', phase: 'complete', progressPercent: 100, finishedAt: new Date().toISOString(), totalRows: report.scanned, originalFilePath: path.join(dir,'report.json'), originalFileName: 'category-repair-report.json' });
  await db.upsertOperationJob(job); await db.upsertOperationArtifact(job, 'original');
  console.log(JSON.stringify({ ...report, paths: Object.keys(report.paths).length, reportPath: path.join(dir,'report.json') }));
}
run().then(() => db.closePool()).catch(async error => { console.error(error); Object.assign(job,{status:'failed',message:error.message,finishedAt:new Date().toISOString()}); await db.upsertOperationJob(job).catch(()=>{}); await db.closePool(); process.exitCode=1; });
