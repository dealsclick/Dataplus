const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const at=source.indexOf('parts[5] === "count" && postgres.isPostgresEnabled()');
const route=source.slice(source.lastIndexOf('  if (',at),source.indexOf('\n  if (',at));
async function run(body={}, {closed=false,collision=false}={}) {
 const line={id:'line',productId:'product',sku:'SKU',locationBin:'A-01',countedQty:7,expectedQty:3};
 const audit={id:'audit',status:closed?'completed':'in_progress',warehouseId:'warehouse',lines:[line,...(collision?[{...line,id:'other',locationBin:'B-02'}]:[])]};let saved,reads=0;
 const ctx={req:{method:'POST'},res:{},parts:['api','warehouse-audits','audit','lines','line','count'],parseBody:async()=>({countedQty:7,locationBin:'B-02',note:'Wrong shelf',...body}),crypto:{randomUUID:()=> 'adjustment'},sendJson:(_,status,data)=>({status,data}),notFound:()=>({status:404}),validateWarehouseBin:(_,value)=>['A-01','B-02'].includes(value)?{value}:{error:'Invalid bin'},auditExpectedQuantity:(_,__,bin)=>{assert.equal(bin,'B-02');return 11;},postgres:{isPostgresEnabled:()=>true,readStateField:async()=>[audit],readStateFields:async keys=>{assert.deepEqual(Array.from(keys),['warehouses']);reads++;return{warehouses:[{id:'warehouse'}]};},readProductByKey:async key=>{assert.equal(key,'product');return{id:'product'};},writeStateDocuments:async state=>{saved=state;}}};
 const response=await vm.runInNewContext(`(async()=>{${route}})()`,ctx);return{response,saved,line,reads};
}
(async()=>{
 const moved=await run();assert.equal(moved.response.status,200);assert.equal(moved.line.locationBin,'B-02');assert.equal(moved.line.countedQty,7);assert.equal(moved.line.expectedQty,11);assert.equal(moved.line.countAdjustments[0].previousLocationBin,'A-01');assert.equal(moved.line.countAdjustments[0].locationBin,'B-02');assert.equal(moved.line.countAdjustments[0].note,'Wrong shelf');
 for(const [body,options,status] of [[{locationBin:''},{},400],[{locationBin:'invalid'},{},400],[{}, {closed:true},400],[{}, {collision:true},409],[{countedQty:-1},{},400]]){const result=await run(body,options);assert.equal(result.response.status,status);assert.equal(result.saved,undefined);assert.equal(result.line.locationBin,'A-01');}
 const countOnly=await run({locationBin:undefined,countedQty:9});assert.equal(countOnly.line.locationBin,'A-01');assert.equal(countOnly.line.countedQty,9);assert.equal(countOnly.reads,0);
 console.log('Audit item bin edits: bin-only save, expected count, history, validation, collision and closed-audit safeguards passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
