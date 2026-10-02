const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { orderMode, mergePhase, selectOpenStatusSweep } = require('../lib/temu-order-phases');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const body = source.slice(source.indexOf('async function importTemuOrders('), source.indexOf('async function queueTemuOrderImportJob('));
const existing = { id:'local', source:'Temu', marketplaceOrderNumber:'one', status:'paid', fulfillmentStatus:'paid', total:99, items:[{sku:'MANUAL',qty:2}], address:{line1:'kept'}, notes:'operator', external:{} };
async function run(mode, hasExisting, limit = 10, options = {}) {
  const db = options.db || {orders:hasExisting?[structuredClone(existing)]:[],connections:[],connectorState:{}};
  const calls = [], saved = [], progress = [];
  const ctx = {
    require:()=>({orderMode,mergePhase}),
    temuChannelSettings:()=>({}),getTemuConfig:()=>({pageSize:50}),unixStartOfDay:()=>0,
    chunkTemuList:(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,(index+1)*size)),sourceOrderFullyShipped:(order)=>['shipped','fulfilled','completed'].includes(String(order.status||'').toLowerCase()),postgres:{isPostgresEnabled:()=>!!options.postgres,readChannelOrderForReturn:async(source,reference)=>{
      assert.equal(source,'Temu');
      if(reference.existsOnly) return hasExisting;
      if(options.duplicates && reference.requireUnique) throw Object.assign(new Error('ambiguous order'),{code:'AMBIGUOUS_MARKETPLACE_ORDER'});
      return hasExisting ? structuredClone(existing) : null;
    },readOrdersByMarketplaceKey:async()=>structuredClone(options.duplicateOrders||[])}, requireEnabledChannel:()=>({}),
    temuPayload:x=>x,firstArrayFrom:x=>x.rows || [],extractTemuOrderSn:x=>x.parentOrderSn,
    mapTemuStatus:x=>x,temuOrderStatusImpliesPaid:x=>x==='paid',
    valueAt:(obj,keys,fallback)=>keys.map(k=>obj[k]).find(x=>x!==undefined) ?? fallback,
    findExistingMarketplaceOrder:d=>d.orders[0],
    temuRequest:async(type)=>{calls.push(type);return type==='bg.order.list.v2.get'?{rows:Array.from({length:options.pageRows || 1},()=>({parentOrderSn:'one',status:mode==='status'?'canceled':'paid'})),total:options.pageRows || 1}:{parentOrderSn:'one',status:'paid'};},
    optionalTemuOrderRequest:async(type)=>{calls.push(type);return type==='bg.order.amount.query' && !options.noAmount?{total:99}:{};},
    childItemsFromTemuPayload:()=>[],extractTemuPackageSns:()=>[],
    mapTemuOrder:()=>({source:'Temu',id:'new',marketplaceOrderNumber:'one',orderNumber:'one',status:mode==='status'?'canceled':'paid',fulfillmentStatus:mode==='status'?'canceled':'paid',total:0,items:[{sku:'remote',qty:8}],address:{},external:{},trackingNumber:'TRACK'}),
    temuOrderIsImportable:()=>true,upsertOrder:(d,o)=>{d.orders.push(o);return 'created';},
    mergeImportedSourceShipments:(a,b)=>b,preserveShipmentCorrections:x=>x,orderLineItems:o=>o.items || [],sourceTextValue:x=>x || '',
    markDuplicateOrderVoided:(order,canonical)=>Object.assign(order,{status:'void',fulfillmentStatus:'void',duplicateOrderRecord:true,duplicateOfOrderId:canonical.id,excludedFromOperationalQueues:true,excludedFromAnalytics:true,reportable:false,notes:'Voided due to duplicate.'}),
  };
  vm.createContext(ctx);vm.runInContext(body,ctx);
  const result = await ctx.importTemuOrders(db,{mode,limit,parentOrderSnList:options.parentOrderSnList,forceLookback:!options.resume,flushOrders:async rows=>saved.push(...rows),progress:async row=>progress.push(row)});
  assert(progress.length>0);
  return {db,calls,saved,result};
}
(async()=>{
  const dbSource=fs.readFileSync(require('node:path').join(__dirname,'../db.js'),'utf8');
  const lookupContext={getPool:()=>({query:async()=>({rows:[{order_id:'a'},{order_id:'b'}]})}),initRelationalSchema:async()=>{},readOrderByKey:()=>{throw new Error('Intake must not hydrate existing orders');}};
  vm.createContext(lookupContext);
  vm.runInContext(dbSource.slice(dbSource.indexOf('async function readChannelOrderForReturn('),dbSource.indexOf('async function acquireReturnWriteLock(')),lookupContext);
  assert.equal(await lookupContext.readChannelOrderForReturn('Temu',{orderId:'one',existsOnly:true}),true);
  await assert.rejects(lookupContext.readChannelOrderForReturn('Temu',{orderId:'one',requireUnique:true}),/Multiple local orders/);
  assert.equal(orderMode({}), 'intake');assert.equal(orderMode({repairBlind:true}),'enrichment');
  assert.throws(()=>orderMode({mode:'bad'}));
  let r=await run('intake',true);assert.equal(r.calls.length,1);assert.equal(r.saved.length,0);
  r=await run('intake',true,10,{postgres:true,duplicates:true});assert.equal(r.calls.length,1);assert.equal(r.saved.length,0);assert(r.db.connectorState.temuIntakeLastOrderSync);
  r=await run('status',true,10,{postgres:true,duplicates:true});assert.equal(r.result.rows[0].action,'needs_review');assert.equal(r.saved.length,0);
  const duplicateReady={...structuredClone(existing),id:'older',orderNumber:'100',marketplaceOrderNumber:'one',status:'paid',items:[{sku:'MANUAL',qty:2,channelOrderItemId:'line-1',fulfilledQty:0,remainingQty:2,fulfillmentStatus:'ready'}]};
  const duplicateShipped={...structuredClone(existing),id:'newer',orderNumber:'200',marketplaceOrderNumber:'one',status:'shipped',fulfillmentStatus:'shipped',items:[{sku:'MANUAL',qty:2,channelOrderItemId:'line-1',fulfilledQty:2,remainingQty:0,fulfillmentStatus:'fulfilled'}],shipments:[{reference:'one',status:'fulfilled'}]};
  r=await run('status',true,10,{postgres:true,duplicates:true,duplicateOrders:[duplicateReady,duplicateShipped],parentOrderSnList:['one']});
  assert.equal(r.result.rows[0].action,'updated');assert.equal(r.saved.length,2);assert.equal(r.saved.find(row=>row.id==='older').status,'shipped');
  const voidedDuplicate=r.saved.find(row=>row.id==='newer');assert.equal(voidedDuplicate.status,'void');assert.equal(voidedDuplicate.duplicateOfOrderId,'older');assert.equal(voidedDuplicate.reportable,false);assert.match(voidedDuplicate.notes,/Voided due to duplicate/);
  r=await run('enrichment',true,10,{postgres:true,duplicates:true});assert.equal(r.result.rows[0].action,'needs_review');assert.equal(r.saved.length,0);
  r=await run('intake',false);assert.equal(r.saved.length,1);assert(r.calls.includes('bg.order.amount.query'));assert(!r.calls.includes('bg.order.unshipped.package.get'));
  r=await run('status',true,10,{parentOrderSnList:['one']});assert.deepEqual(r.calls,['bg.order.detail.v2.get']);assert.equal(r.db.orders[0].status,'canceled');assert.equal(r.db.orders[0].total,99);assert.equal(r.db.orders[0].items[0].sku,'MANUAL');assert.equal(r.db.orders[0].notes,'operator');
  r=await run('status',false,10,{parentOrderSnList:['one']});assert.equal(r.saved.length,0);assert.equal(r.calls.length,0);
  r=await run('enrichment',true);assert(!r.calls.includes('bg.order.amount.query'));assert.equal(r.db.orders[0].status,'paid');assert.equal(r.db.orders[0].total,99);assert.equal(r.db.orders[0].trackingNumber,'TRACK');
  r=await run('enrichment',false);assert.equal(r.saved.length,0);
  r=await run('intake',true,1,{pageRows:50});assert.equal(r.db.connectorState.temuIntakeLastOrderSync,undefined);assert.equal(r.db.connectorState.temuIntakeLastOrderSyncCursor.offset,1);
  r=await run('intake',true,1,{pageRows:50,db:r.db,resume:true});assert.equal(r.db.connectorState.temuIntakeLastOrderSyncCursor.offset,2);
  r=await run('intake',true,48,{pageRows:50,db:r.db,resume:true});assert(r.db.connectorState.temuIntakeLastOrderSync);assert.equal(r.db.connectorState.temuIntakeLastOrderSyncCursor,undefined);
  r=await run('intake',false,10,{noAmount:true});assert.equal(r.saved.length,0);assert(r.result.errors.length);assert.equal(r.db.connectorState.temuIntakeLastOrderSync,undefined);
  r=await run('status',true);assert(r.db.connectorState.temuStatusLastOrderSync);assert.equal(r.db.connectorState.temuIntakeLastOrderSync,undefined);
  assert.equal(mergePhase(existing,{status:'paid',fulfillmentStatus:'paid'},'status'),null);
  assert.equal(mergePhase({...existing,status:'void'},{status:'paid'},'status'),null);
  const completed = mergePhase(
    {...existing,items:[{sku:'MANUAL',qty:2,channelOrderItemId:'line-1',fulfilledQty:0,remainingQty:2,fulfillmentStatus:'ready',price:49.5}],shipments:[]},
    {status:'shipped',fulfillmentStatus:'shipped',items:[{sku:'REMOTE',qty:99,channelOrderItemId:'line-1',fulfilledQty:2,remainingQty:0,fulfillmentStatus:'fulfilled',status:'fulfilled'}],shipments:[{reference:'one',status:'fulfilled'}]},
    'status',
    (left,right)=>right
  );
  assert.equal(completed.items[0].sku,'MANUAL');
  assert.equal(completed.items[0].qty,2);
  assert.equal(completed.items[0].price,49.5);
  assert.equal(completed.items[0].fulfilledQty,2);
  assert.equal(completed.items[0].remainingQty,0);
  assert.equal(completed.shipments.length,1);
  const sweepOrders = [
    {source:'Temu',marketplaceOrderNumber:'300',status:'ready'},
    {source:'Temu',marketplaceOrderNumber:'100',status:'shipped'},
    {source:'Temu',marketplaceOrderNumber:'200',status:'ready'},
    {source:'eBay',marketplaceOrderNumber:'150',status:'ready'},
    {source:'Temu',marketplaceOrderNumber:'400',status:'canceled'}
  ];
  assert.deepEqual(selectOpenStatusSweep(sweepOrders,{limit:1,offset:0}),{parentOrderSnList:['200'],candidateCount:2,nextOffset:1});
  assert.deepEqual(selectOpenStatusSweep(sweepOrders,{limit:1,offset:1}),{parentOrderSnList:['300'],candidateCount:2,nextOffset:0});
  const runner=source.slice(source.indexOf('async function runTemuOrderImportWorkerJob('),source.indexOf('async function runEbayListingLaunchWorkerJob('));
  assert(!runner.includes('upsertOrdersFromState(workDb.orders'), 'No broad final order rewrite');
  console.log('PASS Temu phases: endpoint separation, existing-only refresh, preserved commerce/local fields, canceled reconciliation, changed-only persistence');
})().catch(error=>{console.error(error);process.exitCode=1;});
