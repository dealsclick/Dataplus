const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const {parseFile,normalize,lineFingerprint}=require('../lib/manual-order-import');

const filename=process.argv.find(value=>/\.(csv|xlsx|xls)$/i.test(value));
const apply=process.argv.includes('--apply');
if(!filename)throw new Error('Pass the CTech CSV, XLSX, or XLS export path. Add --apply after reviewing the dry run.');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');

const absolute=path.resolve(filename);
const parsed=parseFile({filename:path.basename(absolute),content:fs.readFileSync(absolute).toString('base64')});
const normalized=normalize(parsed,parsed.suggested);
if(normalized.summary.errors)throw new Error(`The export has ${normalized.summary.errors} invalid row(s). Correct them before backfilling shipping.`);

const sourceRows=normalized.lines.map(line=>({orderId:line.orderId,lineId:line.lineId,shippingMinor:line.shippingMinor}));
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});

async function run(){
  const client=await pool.connect();
  try{
    const counts=(await client.query(`select count(*)::int as lines,count(*) filter(where active)::int as active_lines,
      count(*) filter(where coalesce(data->>'shippingMinor','')<>'')::int as existing_shipping
      from workspace_imported_order_lines
      where tenant_id='organization-default' and company_id='buysupply' and lower(source)='zoro'`)).rows[0];
    const available=new Set(sourceRows.map(row=>JSON.stringify([row.orderId,row.lineId])));
    const existing=(await client.query(`select order_id,line_id from workspace_imported_order_lines
      where tenant_id='organization-default' and company_id='buysupply' and lower(source)='zoro'`)).rows;
    const missing=existing.filter(row=>!available.has(JSON.stringify([row.order_id,row.line_id])));
    const report={file:absolute,fileRows:sourceRows.length,databaseLines:Number(counts.lines),activeLines:Number(counts.active_lines),existingShippingLines:Number(counts.existing_shipping),unmatchedDatabaseLines:missing.length,shippingCollected:Number(normalized.summary.shippingMinor)/100,apply};
    console.log(JSON.stringify(report,null,2));
    if(missing.length)throw new Error(`${missing.length} database line(s) are absent from this export. No changes were made.`);
    if(!apply)return;
    await client.query('begin');
    let updated=0;
    for(let offset=0;offset<sourceRows.length;offset+=1000){
      const values=sourceRows.slice(offset,offset+1000);
      const rows=(await client.query(`update workspace_imported_order_lines l set data=l.data||jsonb_build_object(
          'shippingMinor',(x->>'shippingMinor')::bigint,
          'fingerprintVersion',2
        ) from jsonb_array_elements($1::jsonb) x
        where l.tenant_id='organization-default' and l.company_id='buysupply' and lower(l.source)='zoro'
          and l.order_id=x->>'orderId' and l.line_id=x->>'lineId'
        returning l.id,l.data`,[JSON.stringify(values)])).rows;
      const fingerprints=rows.map(row=>({id:row.id,fingerprint:lineFingerprint(row.data)}));
      await client.query(`update workspace_imported_order_lines l set data=jsonb_set(l.data,'{fingerprint}',to_jsonb(x->>'fingerprint'),true)
        from jsonb_array_elements($1::jsonb) x where l.id=(x->>'id')::bigint`,[JSON.stringify(fingerprints)]);
      updated+=rows.length;
      if(updated%10000<1000)console.log(`Updated ${updated.toLocaleString()} of ${sourceRows.length.toLocaleString()} lines.`);
    }
    if(updated!==Number(counts.lines))throw new Error(`Expected to update ${counts.lines} lines but updated ${updated}.`);
    await client.query('commit');
    console.log(JSON.stringify({updated,shippingCollected:Number(normalized.summary.shippingMinor)/100,status:'complete'}));
  }catch(error){
    try{await client.query('rollback');}catch{}
    throw error;
  }finally{client.release();await pool.end();}
}

run().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
