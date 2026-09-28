const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const at=source.indexOf('parts[3] === "item-notes" && postgres.isPostgresEnabled()');
const route=source.slice(source.lastIndexOf('  if (',at),source.indexOf('\n  if (',at));
async function run(body={},status='in_progress'){
 const known={id:'line',sku:'SKU',countedQty:3,locationBin:'A'},unknown={barcode:'UPC',locationBin:'B',count:2};
 const audit={id:'audit',status,lines:[known],unknownBarcodes:[unknown]};let saved;
 const ctx={req:{method:'POST'},res:{},parts:['api','warehouse-audits','audit','item-notes'],authUser:{name:'Maria'},parseBody:async()=>({kind:'known',lineKey:'line',note:'Damaged box',...body}),sendJson:(_,status,data)=>({status,data}),notFound:()=>({status:404}),postgres:{isPostgresEnabled:()=>true,readStateField:async()=>[audit],writeStateDocuments:async state=>{saved=state;}}};
 return{response:await vm.runInNewContext(`(async()=>{${route}})()`,ctx),known,unknown,get saved(){return saved;}};
}
(async()=>{const a=await run();assert.equal(a.response.status,200);assert.equal(a.known.note,'Damaged box');assert.equal(a.known.noteUpdatedBy,'Maria');assert.equal(a.known.countedQty,3);assert.equal(a.known.locationBin,'A');assert.equal(a.known.noteHistory.length,1);
 const b=await run({kind:'unknown',lineKey:'UPC::B',note:'Missing label'});assert.equal(b.unknown.note,'Missing label');assert.equal(b.unknown.count,2);assert.equal(b.known.note,undefined);
 for(const [body,status,code] of [[{note:'x'.repeat(4001)},'in_progress',400],[{note:42},'in_progress',400],[{kind:'bad'},'in_progress',400],[{lineKey:'missing'},'in_progress',404],[{},'completed',400],[{},'locked',400]]){const result=await run(body,status);assert.equal(result.response.status,code);assert.equal(result.saved,undefined);}
 console.log('Audit notes: known/unknown persistence, authenticated author, history, validation, closed-audit guards, counts/bins preserved.');})().catch(e=>{console.error(e);process.exitCode=1});
