const assert = require('node:assert/strict');
const { parseReport, itemReport } = require('../lib/walmart-item-report');
(async()=>{
const csv='SKU,UPC,GTIN,Publish Status,Price,Item Page URL,Fulfillment Lag Time\n00123,036000291452,00036000291452,PUBLISHED,0,https://www.walmart.com/ip/12345,0\nB,,,UNPUBLISHED,,,\n';
assert.equal(parseReport(Buffer.from('SKU,Publish Status,Product ID Type,Product ID\nX,PUBLISHED,UPC,036000291452'))[0].upc,'036000291452');
const rows=parseReport(Buffer.from(csv));
assert.equal(rows[0].sku,'00123'); assert.equal(rows[0].upc,'036000291452'); assert.equal(rows[0].gtin,'00036000291452'); assert.equal(rows[0].price.amount,0); assert.equal(rows[0].fulfillmentLagTime,0); assert.equal(rows[0].itemId,'12345'); assert.equal(rows[1].price,null); assert.equal(rows[1].fulfillmentLagTime,null);
assert.throws(()=>parseReport(Buffer.from('SKU,Price\nA,10')),/missing/);
const XLSX=require('xlsx');const zip=XLSX.CFB.utils.cfb_new();XLSX.CFB.utils.cfb_add(zip,'items.csv',Buffer.from(csv));assert.deepEqual(parseReport(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip'})),rows);
let time=Date.now(); let requested=0; const docs=new Map(); const args={job:{id:'t'},read:async k=>docs.get(k),write:async(k,v)=>docs.set(k,v),check:async()=>{},persist:async()=>{},now:()=>time,pause:async ms=>{time+=ms;},client:{request:async(path,opts)=>{if(opts?.method==='POST'){requested++;return {requestId:'r'};} if(path.includes('downloadReport'))return {downloadURL:'https://reports.walmart.com/file'};return {requestStatus:'READY'};}},fetchImpl:async()=>new Response(csv)};
assert.deepEqual(await itemReport(args),rows);assert.deepEqual(await itemReport(args),rows);assert.equal(requested,1);
await assert.rejects(itemReport({...args,check:async()=>{throw new Error('disabled')}}),/disabled/);
let throttled=0; const prior=args.client.request; const backoff={...args,client:{request:async(path,opts)=>{if(path.includes('/reportRequests/') && throttled++ === 0)throw Object.assign(new Error('throttled'),{upstreamStatus:429});return prior(path,opts);}}}; const started=time; assert.deepEqual(await itemReport(backoff),rows);assert.ok(time-started>=900000);
console.log('PASS Walmart report CSV/ZIP, identifier strings, null/zero, persisted request reuse and disable gate');
})().catch(e=>{console.error(e);process.exitCode=1});
