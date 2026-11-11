const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const {parseFile,normalize,lineFingerprint}=require('../lib/manual-order-import');

const filename=process.argv.find(value=>/\.(csv|xlsx|xls)$/i.test(value));
const apply=process.argv.includes('--apply');
if(!filename)throw new Error('Pass the CTech CSV, XLSX, or XLS export path. Add --apply only after reviewing the dry run.');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');

const absolute=path.resolve(filename);
const parsed=parseFile({filename:path.basename(absolute),content:fs.readFileSync(absolute).toString('base64')});
const normalized=normalize(parsed,parsed.suggested);
if(normalized.summary.errors)throw new Error(`The export has ${normalized.summary.errors} invalid row(s). Correct them before backfilling metadata.`);

const metadataFields=['unitPrice','unitCost','reportedProfit','sourceMargin','customerPo','orderDesk','shipZip','notes','additional'];
const sourceRows=normalized.lines.map(line=>{
  const metadata=Object.fromEntries(metadataFields.map(field=>[field,line[field]===undefined?null:line[field]]));
  return {orderId:line.orderId,lineId:line.lineId,date:line.date,sku:line.sku,quantity:line.quantity,salesMinor:line.salesMinor,costMinor:line.costMinor,metadata};
});
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});

async function run(){
  const client=await pool.connect();
  let transaction=false;
  try{
    const counts=(await client.query(`select count(*)::int as active_lines,
      count(*) filter(where nullif(data->>'orderDesk','') is not null)::int as existing_order_desk,
      count(*) filter(where data->>'sourceMargin' is not null)::int as existing_source_margin
      from workspace_imported_order_lines
      where tenant_id='organization-default' and company_id='buysupply' and lower(source)='zoro' and active`)).rows[0];
    const report={
      file:absolute,
      fileRows:sourceRows.length,
      activeDatabaseLines:Number(counts.active_lines),
      existingOrderDeskLines:Number(counts.existing_order_desk),
      existingSourceMarginLines:Number(counts.existing_source_margin),
      sourceOrderDeskLines:sourceRows.filter(row=>row.metadata.orderDesk).length,
      sourceMarginLines:sourceRows.filter(row=>row.metadata.sourceMargin!==null && row.metadata.sourceMargin!==undefined).length,
      sourceProfitLines:sourceRows.filter(row=>row.metadata.reportedProfit!==null && row.metadata.reportedProfit!==undefined).length,
      apply
    };
    console.log(JSON.stringify(report,null,2));
    if(sourceRows.length!==Number(counts.active_lines))throw new Error(`The export has ${sourceRows.length} lines but DataPlus has ${counts.active_lines} active CTech lines. No changes were made.`);

    await client.query('begin');
    transaction=true;
    let updated=0;
    for(let offset=0;offset<sourceRows.length;offset+=1000){
      const values=sourceRows.slice(offset,offset+1000);
      const rows=(await client.query(`update workspace_imported_order_lines l set data=l.data||(x->'metadata')||jsonb_build_object('fingerprintVersion',3)
        from jsonb_array_elements($1::jsonb) x
        where l.tenant_id='organization-default' and l.company_id='buysupply' and lower(l.source)='zoro' and l.active
          and l.order_id=x->>'orderId' and l.line_id=x->>'lineId'
          and l.data->>'date'=x->>'date' and l.data->>'sku'=x->>'sku'
          and (l.data->>'quantity')::numeric=(x->>'quantity')::numeric
          and (l.data->>'salesMinor')::numeric=(x->>'salesMinor')::numeric
          and ((l.data->>'costMinor' is null and x->>'costMinor' is null) or (l.data->>'costMinor')::numeric=(x->>'costMinor')::numeric)
        returning l.id,l.data`,[JSON.stringify(values)])).rows;
      const fingerprints=rows.map(row=>({id:row.id,fingerprint:lineFingerprint(row.data)}));
      if(fingerprints.length)await client.query(`update workspace_imported_order_lines l set data=jsonb_set(l.data,'{fingerprint}',to_jsonb(x->>'fingerprint'),true)
        from jsonb_array_elements($1::jsonb) x where l.id=(x->>'id')::bigint`,[JSON.stringify(fingerprints)]);
      updated+=rows.length;
      if(updated%10000<1000)console.log(`Matched ${updated.toLocaleString()} of ${sourceRows.length.toLocaleString()} lines.`);
    }
    if(updated!==sourceRows.length)throw new Error(`Only ${updated} of ${sourceRows.length} lines matched every identity and financial safeguard. No changes were made.`);

    const coverage=(await client.query(`select
      count(*) filter(where nullif(data->>'orderDesk','') is not null)::int as order_desk_lines,
      count(*) filter(where data->>'sourceMargin' is not null)::int as source_margin_lines,
      count(*) filter(where data->>'reportedProfit' is not null)::int as source_profit_lines
      from workspace_imported_order_lines
      where tenant_id='organization-default' and company_id='buysupply' and lower(source)='zoro' and active`)).rows[0];
    if(apply){
      await client.query('commit');
      transaction=false;
    }else{
      await client.query('rollback');
      transaction=false;
    }
    console.log(JSON.stringify({updated,...coverage,status:apply?'complete':'dry-run-complete-no-changes'},null,2));
  }catch(error){
    if(transaction){try{await client.query('rollback');}catch{}}
    throw error;
  }finally{
    client.release();
    await pool.end();
  }
}

run().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
