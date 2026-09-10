const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {supplierTokens, retiredSupplier, retirementPhysicalQty, retirementLaunchReason, createRetirementService} = require('../lib/supplier-retirement');

const vendor = {id:'supplier-1',name:'Example Supplier',code:'EX',status:'active',catalogSettings:{enabled:true,sourceCodes:['FEED1']}};
const retirement = {retiredAt:'2026-09-10T00:00:00Z',reason:'Supplier closed'};
const retired = {...vendor,retirement};
assert.deepEqual(supplierTokens(vendor),['supplier-1','ex','example supplier','feed1']);
assert.equal(retiredSupplier({supplierCode:'FEED1'},[retired]),retired);
assert.equal(retiredSupplier({supplierCode:'FEED10'},[retired]),null);
assert.equal(retiredSupplier({supplier:'Other',brand:'Example Supplier'},[retired]),null);
assert.equal(retiredSupplier({supplier:'Example Supplier'},[vendor]),null);
const item={supplierRetirement:retirement,qty:999,replenishable:true,warehouseStock:[
  {isPhysical:false,inventorySourceType:'supplier_feed',qty:900},
  {isPhysical:true,inventorySourceType:'physical',qty:7,reserved:2},
  {isPhysical:true,qty:10,status:'inactive'},
  {qty:82}
]};
assert.equal(retirementPhysicalQty(item),5);
assert.equal(retirementLaunchReason(item),'');
assert.match(retirementLaunchReason({...item,warehouseStock:[]}),/Supplier retired/);
assert.equal(retirementPhysicalQty({warehouseStock:[{isPhysical:true,qty:1,reserved:5}]}),0);
assert.equal(retirementPhysicalQty({warehouseStock:[null,{isPhysical:true,qty:'invalid'},{isPhysical:true,qty:Infinity}]}),0);
assert.equal(retiredSupplier({supplier:'Replacement',supplierRetirement:{...retirement,sourceTokens:['ex']}},[]),null);

const vm=require('node:vm');
const {productIsMasterInactive}=require('../lib/product-selling-status');
const shopifySource=fs.readFileSync(path.join(__dirname,'shopify-inventory-update-from-dump.js'),'utf8');
const context={baseSkuCandidates:()=>['SKU'],channelShippingRestriction:()=>({blocked:false}),booleanValue:v=>v===true || v==='true',numberValue:(v,f)=>Number(v)||f,channelSellableQuantity:()=>99,productUomQty:()=>1};
vm.createContext(context);
context.productIsMasterInactive=productIsMasterInactive;
vm.runInContext(shopifySource.slice(shopifySource.indexOf('function expectedVariantQuantities('),shopifySource.indexOf('function expectedVariantQuantitiesForShopify(')),context);
assert.equal(context.expectedVariantQuantities({supplier_retired:true,source_qty:999,replenishable:true,replenishable_qty:1000})[0].quantity,0,'retirement overrides feed stock, replenishment and fixed quantity');
const serverSource=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const ebayContext={retiredSupplier,retirementPhysicalQty,channelShippingRestriction:()=>({blocked:false})};
vm.createContext(ebayContext);
ebayContext.productIsMasterInactive=productIsMasterInactive;
vm.runInContext(serverSource.slice(serverSource.indexOf('function marketplaceListingQuantity('),serverSource.indexOf('function ebayListingDescription(')),ebayContext);
assert.equal(ebayContext.marketplaceListingQuantity(item),5);
assert.equal(ebayContext.marketplaceListingQuantity({...item,warehouseStock:[]}),0);
assert.equal(ebayContext.marketplaceListingQuantity(item,{ebaySafetyQty:1,ebayMaxSellableQty:2}),2);

async function serviceTests() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-test-'));
  let stored=structuredClone(vendor),writes=[],jobCount=0;
  const client={release(){},async query(sql,params){
    writes.push({sql,params});
    if(sql.includes('select data from entity_documents')) return {rows:[{data:stored}]};
    if(sql.includes("nextval")) return {rows:[{n:123}]};
    if(sql.includes('update entity_documents')) stored={...stored,...JSON.parse(params[1])};
    if(sql.includes('insert into operations_jobs')) jobCount++;
    return {rows:[]};
  }};
  const pool={connect:async()=>client,async query(sql){
    if(sql.includes('as products')) return {rows:[{products:3,shopify:2,ebay:1,alternate_candidates:1}]};
    if(sql.includes('as stock')) return {rows:[{sku:'SKU1',title:'Example',stock:item.warehouseStock}]};
    return {rows:[]};
  }};
  const service=createRetirementService({postgres:{readStateField:async()=>[stored],getPool:()=>pool},createJob:(_db,attrs)=>({id:'job-1',...attrs}),persistJob:async()=>{},readDb:async()=>({connections:[]}),artifactsDir:dir,invalidate:async()=>{},log:()=>{}});
  const preview=await service.preview(vendor.id,'user-1');
  assert.equal(preview.summary.products,3);
  assert.equal(writes.length,0,'preview does not mutate supplier or inventory');
  const body={previewId:preview.previewId,reason:'Supplier closed',confirmName:vendor.name};
  await assert.rejects(service.queue(vendor.id,body,'user-2'),/Preview expired/);
  await assert.rejects(service.queue(vendor.id,{...body,confirmName:'Wrong'},'user-1'),/exact supplier name/);
  const result=await service.queue(vendor.id,body,'user-1');
  assert.equal(result.job.jobNumber,123);
  assert.equal(stored.status,'inactive');
  assert.equal(stored.inventoryRules.replenishableEnabled,false);
  assert.equal(stored.purchaseOrderRules.autoCreateDrafts,false);
  assert.equal(stored.catalogSettings.enabled,false);
  assert.equal(stored.retirement.reason,'Supplier closed');
  assert.equal(jobCount,1);
  assert.equal((await service.queue(vendor.id,body,'user-1')).duplicate,true);
  assert.equal(jobCount,1,'repeated apply must not create another job');
  assert.ok(!writes.some(w=>/update inventory_levels|delete from products|update order_/i.test(w.sql)),'retirement must not mutate physical balances or order history');
  console.log('Supplier retirement checks passed: identity, physical stock, launch, preview, actor binding, confirmation, atomic job guard and idempotency.');
}
serviceTests().catch(error=>{console.error(error);process.exitCode=1});
