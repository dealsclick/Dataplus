const crypto = require('crypto');

function supplierTokens(vendor = {}) {
  const codes = vendor.catalogSettings?.sourceCodes || [];
  return [...new Set([vendor.id, vendor.code, vendor.name, ...(Array.isArray(codes) ? codes : String(codes).split(/[|,\n]/))]
    .map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
}

function retiredSupplier(item = {}, vendors = []) {
  const tokens = [item.vendorId, item.supplierCode, item.supplier, item.vendor].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
  const marker=item.supplierRetirement;
  const markerApplies=marker?.retiredAt && (!Array.isArray(marker.sourceTokens) || marker.sourceTokens.some(t=>tokens.includes(t)));
  return vendors.find(v => v.retirement?.retiredAt && supplierTokens(v).some(t => tokens.includes(t)))
    || (markerApplies ? { retirement: marker } : null);
}

// Unknown/virtual locations never establish physical stock for a retired source.
function retirementPhysicalQty(item = {}) {
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return (Array.isArray(item.warehouseStock) ? item.warehouseStock : [])
    .filter(row => row && row.isPhysical === true && row.inventorySourceType !== 'supplier_feed' && row.status !== 'inactive' && row.active !== false && row.isSellable !== false)
    .reduce((sum, row) => sum + Math.max(0, number(row.qty) - number(row.reserved)), 0);
}

function retirementLaunchReason(item = {}, vendors = []) {
  return retiredSupplier(item, vendors) && retirementPhysicalQty(item) <= 0
    ? 'Supplier retired: no verified physical stock. Review and approve a replacement source before launch.' : '';
}

const PRIMARY = `(lower(coalesce(p.supplier_code,''))=any($1::text[])
  or lower(coalesce(p.supplier,''))=any($1::text[])
  or lower(coalesce(p.raw->>'vendorId',''))=any($1::text[])
  or lower(coalesce(p.raw->>'vendor',''))=any($1::text[]))`;

function createRetirementService({ postgres, createJob, persistJob, artifactsDir, invalidate, log }) {
  const fs = require('fs');
  const path = require('path');
  async function vendorById(id) {
    const vendors = await postgres.readStateField('vendors');
    const vendor = (vendors || []).find(v => v.id === id);
    if (!vendor) throw Object.assign(new Error('Supplier not found.'), {statusCode:404});
    return vendor;
  }
  async function preview(id, actor) {
    const vendor = await vendorById(id);
    const tokens = supplierTokens(vendor);
    const result = await postgres.getPool().query(`select count(*)::int as products,
      count(*) filter(where coalesce(p.raw->>'shopifyId','') <> '')::int as shopify,
      count(*) filter(where coalesce(p.raw->'ebayListing','{}'::jsonb)<>'{}'::jsonb)::int as ebay,
      count(*) filter(where exists(select 1 from product_supplier_links l where l.product_id=p.product_id and not(lower(l.vendor_id)=any($1::text[]))))::int as alternate_candidates
      from products p where ${PRIMARY}`, [tokens]);
    const sample = await postgres.getPool().query(`select p.sku,p.title,p.raw->'warehouseStock' as stock from products p where ${PRIMARY} order by p.product_id limit 50`, [tokens]);
    const connections = await postgres.readStateField('connections');
    const pos = (await postgres.getPool().query(`select po_id as id,po_number as number,status,count(*) over()::int as total from purchase_order_records where (lower(coalesce(vendor_id,''))=any($1::text[]) or lower(coalesce(supplier,''))=any($1::text[])) and lower(coalesce(status,'')) not in ('closed','canceled','cancelled','completed','received') order by po_id limit 50`,[tokens])).rows;
    const orders = (await postgres.getPool().query(`select o.order_id as id,o.order_number as number,o.status,count(*) over()::int as total from order_records o where lower(coalesce(o.status,'')) not in ('shipped','fulfilled','canceled','cancelled','closed','returned','completed') and exists(select 1 from order_line_items l join products p on lower(p.sku)=lower(coalesce(nullif(l.mapped_sku,''),l.sku)) or lower(p.sku)=regexp_replace(lower(l.sku),'-[0-9]+pc$','') where l.order_id=o.order_id and ${PRIMARY}) order by o.order_id limit 50`,[tokens])).rows;
    const previewId = crypto.randomUUID();
    const summary = {...result.rows[0], openPurchaseOrders:pos[0]?.total || 0, openOrders:orders[0]?.total || 0};
    const record = {vendorId:id,vendorName:vendor.name,tokens,summary,createdAt:new Date().toISOString(),expiresAt:Date.now()+30*60*1000,actor,
      vendorHash:crypto.createHash('sha256').update(JSON.stringify(vendor)).digest('hex'),
      samples:sample.rows.map(r=>({sku:r.sku,title:r.title,physicalQty:retirementPhysicalQty({warehouseStock:r.stock})})),
      purchaseOrders:pos.map(po=>({id:po.id,number:po.number || po.id,status:po.status})),
      orders:orders.map(o=>({id:o.id,number:o.number || o.id,status:o.status})),
      channels:(connections || []).map(c=>({name:c.name,enabled:c.settings?.channelEnabled!==false}))};
    fs.mkdirSync(artifactsDir,{recursive:true});
    fs.writeFileSync(path.join(artifactsDir,`retirement-preview-${previewId}.json`),JSON.stringify(record));
    return {...record,previewId,retired:!!vendor.retirement?.retiredAt};
  }
  async function queue(id, body, actor) {
    if (!/^[a-f0-9-]{36}$/.test(String(body.previewId || ''))) throw Object.assign(new Error('Preview the supplier first.'),{statusCode:400});
    const filename=path.join(artifactsDir,`retirement-preview-${body.previewId}.json`);
    const snapshot=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(snapshot.vendorId!==id || snapshot.actor!==actor || snapshot.expiresAt<Date.now()) throw Object.assign(new Error('Preview expired. Refresh the impact review.'),{statusCode:409});
    const reason=String(body.reason || '').trim();
    if(reason.length<5 || reason.length>1000 || body.confirmName!==snapshot.vendorName) throw Object.assign(new Error('Enter a retirement reason and the exact supplier name.'),{statusCode:400});
    const running=await postgres.getPool().query("select job_number from operations_jobs where status='running' and raw->>'workerTask'=any($1::text[]) limit 1",[['product-dump-import','vendor-feed-import','shopify-inventory-update','shopify-product-create','shopify-product-publication-update','ebay-price-inventory-sync','ebay-listing-launch']]);
    if(running.rows.length) throw Object.assign(new Error(`Job #${running.rows[0].job_number} is updating source or channel data. Wait for it to finish, then preview retirement again.`),{statusCode:409});
    const client=await postgres.getPool().connect();
    let job;
    try {
      await client.query('begin');
      const {rows}=await client.query("select data from entity_documents where collection='vendors' and entity_id=$1 for update",[id]);
      const vendor=rows[0]?.data;
      if(!vendor) throw new Error('Supplier profile unavailable.');
      if(vendor.retirement?.jobId) {
        await client.query('rollback');
        return {job:{id:vendor.retirement.jobId},duplicate:true};
      }
      if(crypto.createHash('sha256').update(JSON.stringify(vendor)).digest('hex')!==snapshot.vendorHash) throw Object.assign(new Error('Supplier changed since preview. Preview again.'),{statusCode:409});
      job=createJob({}, {section:'Vendors',operation:`Retire supplier: ${vendor.name}`,direction:'internal',status:'queued',workerTask:'supplier-retirement',workerPayload:{vendorId:id,previewId:body.previewId,reason,actor},totalRows:snapshot.summary.products,message:'Supplier retirement queued; channel quantities require a separate reviewed sync.'});
      const retirement={retiredAt:new Date().toISOString(),reason,actor,jobId:job.id};
      const patch={status:'inactive',active:false,retirement,inventoryRules:{...vendor.inventoryRules,replenishableEnabled:false,replenishableQty:0},purchaseOrderRules:{...vendor.purchaseOrderRules,autoCreateDrafts:false,dropShipEnabled:false},catalogSettings:{...vendor.catalogSettings,enabled:false},changeLog:[{id:crypto.randomUUID(),type:'retirement',title:'Supplier retired',message:reason,user:actor,createdAt:retirement.retiredAt},...(vendor.changeLog || [])]};
      await client.query("update entity_documents set data=data || $2::jsonb,updated_at=now() where collection='vendors' and entity_id=$1",[id,JSON.stringify(patch)]);
      // Persist the durable job in the same transaction as the supplier guard.
      const number=Number((await client.query("select nextval('operations_job_number_seq') as n")).rows[0].n);
      job.jobNumber=number;
      await client.query(`insert into operations_jobs(job_id,job_number,status,name,category,created_at,raw) values($1,$2,'queued',$3,'Vendors',now(),$4::jsonb)`,[job.id,number,job.operation,JSON.stringify(job)]);
      await client.query('commit');
    } catch(e) {await client.query('rollback');throw e;} finally {client.release();}
    await invalidate();
    log({channel:'System',transport:'Job',method:'QUEUE',path:'supplier-retirement',operation:job.operation,jobId:job.id,ok:true,statusCode:202,message:`Retirement confirmed by ${actor}; source availability will be suppressed. Channel sync remains a separate action.`});
    return {job};
  }
  async function run(job) {
    const vendor=await vendorById(job.workerPayload.vendorId);
    if(vendor.retirement?.jobId!==job.id) throw new Error('Retirement authorization does not match this job.');
    const tokens=supplierTokens(vendor);
    const dir=path.join(artifactsDir,job.id);
    fs.mkdirSync(dir,{recursive:true});
    const report=path.join(dir,'supplier-retirement.ndjson');
    let cursor=job.retirementCursor || '',processed=Number(job.processedRows || 0);
    await persistJob(job,{status:'running',phase:'suppress_supplier_availability',startedAt:job.startedAt || new Date().toISOString()});
    for(;;){
      const current=await postgres.readOperationJob(job.id);
      if (current && ['stopped','canceled','cancelled'].includes(current.status)) throw new Error('Supplier retirement stopped. Supplier guard remains active; retry to finish product protection.');
      const {rows}=await postgres.getPool().query(`select p.product_id,p.sku,p.raw from products p where ${PRIMARY} and p.product_id>$2 order by p.product_id limit 500`,[tokens,cursor]);
      if(!rows.length) break;
      const ids=rows.map(r=>r.product_id);
      // Source evidence and all physical balances are retained. Selling reads apply the retirement mask.
      await postgres.getPool().query(`update products set raw=raw || $2::jsonb,updated_at=now() where product_id=any($1::text[])`,[ids,JSON.stringify({supplierRetirement:{...vendor.retirement,vendorId:vendor.id,vendorName:vendor.name,sourceTokens:tokens}})]);
      fs.appendFileSync(report,rows.map(r=>JSON.stringify({sku:r.sku,physicalQty:retirementPhysicalQty(r.raw),action:'supplier_availability_suppressed',channelAction:'pending_inventory_sync'})).join('\n')+'\n');
      cursor=rows.at(-1).product_id;processed+=rows.length;
      await persistJob(job,{processedRows:processed,changed:processed,retirementCursor:cursor,message:`${processed} products protected; physical stock and historical records preserved.`});
    }
    await invalidate();
    await persistJob(job,{status:'warning',phase:'channel_sync_required',finishedAt:new Date().toISOString(),progressPercent:100,processedRows:processed,changed:processed,
      originalFilePath:report,originalFileName:'supplier-retirement.ndjson',
      message:`Supplier retired locally: ${processed} products protected. Review alternate sources, open orders and POs; run channel inventory syncs to remove previously published supplier quantities. No live quantities were changed by this job.`});
  }
  return {preview,queue,run};
}

module.exports={supplierTokens,retiredSupplier,retirementPhysicalQty,retirementLaunchReason,createRetirementService};
