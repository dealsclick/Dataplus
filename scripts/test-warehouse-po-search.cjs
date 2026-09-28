const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Client}=require('pg');
(async()=>{
 const client=new Client({host:'127.0.0.1',user:'postgres',database:'postgres',port:5432});await client.connect();
 try{
  await client.query('begin');await client.query("set local statement_timeout='10s'");
  await client.query("create temp table purchase_order_records (po_id text, po_number text, status text, supplier text, warehouse_name text, raw jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()) on commit drop");
  await client.query("insert into purchase_order_records(po_id,po_number,status,supplier,warehouse_name) select 'po-'||n,'PO-'||n,'submitted','Supplier Alpha','Warehouse A' from generate_series(1,25) n");
  for(const status of ['received','closed','canceled','cancelled','rejected','superseded','deleted'])await client.query('insert into purchase_order_records(po_id,po_number,status,supplier) values($1,$1,$2,$3)',['closed-'+status,status,'Supplier Alpha']);
  await client.query("insert into purchase_order_records(po_id,po_number,status,supplier) values('literal','PO%_1','submitted','Literal')");
  const source=fs.readFileSync(path.join(__dirname,'../db.js'),'utf8');const start=source.indexOf('async function searchReceivingPurchaseOrders(');const end=source.indexOf('\nasync function ',start+1);let queries=0;
  const search=vm.runInNewContext(`(${source.slice(start,end)})`,{getPool:()=>({query:async(...args)=>{queries++;return client.query(...args)}}),initRelationalSchema:async()=>{}});
  assert.equal((await search('   ')).purchaseOrders.length,0);assert.equal(queries,0);
  const broad=await search('supplier alpha');assert.equal(broad.purchaseOrders.length,20);assert.equal(broad.hasMore,true);assert.ok(broad.purchaseOrders.every(x=>x.status==='submitted'));assert.ok(broad.purchaseOrders.every(x=>!('raw' in x)&&!('items' in x)));
  const exact=await search('PO-2');assert.equal(exact.purchaseOrders[0].poNumber,'PO-2');assert.equal((await search('%_')).purchaseOrders.length,1);assert.equal((await search("' OR 1=1 --")).purchaseOrders.length,0);assert.equal((await search('unmatched')).hasMore,false);
  assert.equal((await search('warehouse a')).purchaseOrders.length,20);
  console.log('Receiving search: blank lookup skips DB; bounded summaries, closed statuses, literal queries and exact-first ordering passed.');
 }finally{await client.query('rollback');await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
