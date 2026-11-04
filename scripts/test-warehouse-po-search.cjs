const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Client}=require('pg');
(async()=>{
 const client=new Client({host:'127.0.0.1',user:'postgres',database:'postgres',port:5432});await client.connect();
 try{
  await client.query('begin');await client.query("set local statement_timeout='10s'");
  await client.query("create temp table purchase_order_records (po_id text, po_number text, status text, supplier text, warehouse_name text, received_units numeric default 0, received_at date, raw jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()) on commit drop");
  await client.query("create temp table purchase_order_line_items (line_id text, po_id text, sku text, qty numeric default 0, received_qty numeric default 0, remaining_qty numeric default 0, raw jsonb default '{}') on commit drop");
  await client.query("insert into purchase_order_records(po_id,po_number,status,supplier,warehouse_name) select 'po-'||n,'PO-'||n,'submitted','Supplier Alpha','Warehouse A' from generate_series(1,25) n");
  await client.query("update purchase_order_records set raw=jsonb_build_object('ctechId','CT-991-ABC','supplierOrderNumber','SUP-REF-55') where po_id='po-3'");
  for(const status of ['received','closed','canceled','cancelled','rejected','superseded','deleted'])await client.query('insert into purchase_order_records(po_id,po_number,status,supplier) values($1,$1,$2,$3)',['closed-'+status,status,'Supplier Alpha']);
  await client.query("insert into purchase_order_records(po_id,po_number,status,supplier) values('literal','PO%_1','submitted','Literal')");
  const source=fs.readFileSync(path.join(__dirname,'../db.js'),'utf8');const start=source.indexOf('async function searchReceivingPurchaseOrders(');const end=source.indexOf('\nasync function ',start+1);let queries=0;
  const search=vm.runInNewContext(`(${source.slice(start,end)})`,{getPool:()=>({query:async(...args)=>{queries++;return client.query(...args)}}),initRelationalSchema:async()=>{}});
  assert.equal((await search('   ')).purchaseOrders.length,0);assert.equal(queries,0);
  const broad=await search('supplier alpha');assert.equal(broad.purchaseOrders.length,20);assert.equal(broad.hasMore,true);assert.ok(broad.purchaseOrders.every(x=>x.status==='submitted'));assert.ok(broad.purchaseOrders.every(x=>!('raw' in x)&&!('items' in x)));
  const exact=await search('PO-2');assert.equal(exact.purchaseOrders[0].poNumber,'PO-2');assert.equal((await search('%_')).purchaseOrders.length,1);assert.equal((await search("' OR 1=1 --")).purchaseOrders.length,0);assert.equal((await search('unmatched')).hasMore,false);
  const ctech=await search('ct991abc');assert.equal(ctech.purchaseOrders[0].poNumber,'PO-3');assert.equal(ctech.purchaseOrders[0].ctechId,'CT-991-ABC');assert.equal(ctech.purchaseOrders[0].matchLabel,'CTech ID');
  const supplierReference=await search('sup ref 55');assert.equal(supplierReference.purchaseOrders[0].poNumber,'PO-3');assert.equal(supplierReference.purchaseOrders[0].supplierOrderNumber,'SUP-REF-55');assert.equal(supplierReference.purchaseOrders[0].matchLabel,'Supplier reference');
  assert.equal((await search('warehouse a')).purchaseOrders.length,20);
  await client.query("insert into purchase_order_line_items(line_id,po_id,sku,qty,received_qty,raw) values ('line-2','po-2','SKU-EXTRA',5,2,'{}'),('line-3','po-3','SKU-EXTRA',4,4,'{}'),('closed-line','closed-received','SKU-EXTRA',8,0,'{}')");
  const expectationStart=source.indexOf('async function findOpenPurchaseOrdersExpectingSkus(');const expectationEnd=source.indexOf('\nasync function ',expectationStart+1);
  const findExpectations=vm.runInNewContext(`(${source.slice(expectationStart,expectationEnd)})`,{getPool:()=>({query:(...args)=>client.query(...args)}),initRelationalSchema:async()=>{},nullableString:value=>{const normalized=String(value??'').trim();return normalized||null}});
  const expectations=await findExpectations(['SKU-EXTRA'],{excludePurchaseOrderId:'po-3'});assert.equal(expectations.length,1);assert.equal(expectations[0].purchaseOrderNumber,'PO-2');assert.equal(expectations[0].remainingQty,3);
  const progressStart=source.indexOf('async function updatePurchaseOrderReceivingProgress(');const progressEnd=source.indexOf('\nasync function ',progressStart+1);
  const updateProgress=vm.runInNewContext(`(${source.slice(progressStart,progressEnd)})`,{getPool:()=>client,initRelationalSchema:async()=>{},nullableString:value=>{const normalized=String(value??'').trim();return normalized||null}});
  const active=await updateProgress('po-2',{auditId:'audit-2',auditNumber:'AUDIT-202',status:'in_progress',scannedUnits:37});assert.equal(active.activeReceivingAudit.auditNumber,'AUDIT-202');assert.equal(active.activeReceivingAudit.scannedUnits,37);
  const updatesStart=source.indexOf('async function listPurchaseOrderUpdatesSince(');const updatesEnd=source.indexOf('\nasync function ',updatesStart+1);
  const listUpdates=vm.runInNewContext(`(${source.slice(updatesStart,updatesEnd)})`,{getPool:()=>client,initRelationalSchema:async()=>{}});
  const receivingUpdates=await listUpdates(new Date(Date.now()-60_000).toISOString());assert.equal(receivingUpdates.find(row=>row.id==='po-2').activeReceivingAudit.auditId,'audit-2');
  const cleared=await updateProgress('po-2',null);assert.equal(cleared.activeReceivingAudit,null);assert.equal((await client.query("select raw ? 'activeReceivingAudit' as present from purchase_order_records where po_id='po-2'")).rows[0].present,false);
  console.log('Receiving search: blank lookup skips DB; bounded summaries, closed statuses, literal queries and exact-first ordering passed.');
 }finally{await client.query('rollback');await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
