const assert = require('node:assert/strict');
const { createBulkRequester, runBulkLaunch, pause } = require('../lib/walmart-bulk-launch');
async function main() {
  let now = 1000000000000, calls = 0, before = 0;
  const docs = new Map(), read = async key => structuredClone(docs.get(key)), write = async (key,value) => docs.set(key,structuredClone(value));
  const client = { request: async (path, options) => { calls++; await options.onResponse({ status: 429, headers: new Headers({ 'retry-after': '600', 'x-current-token-count':'0' }) }); throw Object.assign(new Error('429'),{upstreamStatus:429,statusCode:502}); } };
  const request = createBulkRequester({client,read,write,lock:async(k,fn)=>fn(),account:'test',check:async()=>{},now:()=>now});
  await assert.rejects(request('/v3/feeds?feedType=MP_ITEM_MATCH',{method:'POST',beforeSend:async()=>before++}),e=>e.bulkPause&&e.rejected&&e.until===now+600000);
  await assert.rejects(request('/v3/feeds?feedType=MP_ITEM_MATCH',{method:'POST',beforeSend:async()=>before++}),e=>e.bulkPause&&!e.rejected);
  assert.equal(calls,1);assert.equal(before,1,'rate wait must happen before durable mutation intent');
  docs.clear(); now+=600001;
  const job={id:'job',workerPayload:{actor:'user',bulkRunId:'run'}};let submitted=[],suspend=true;
  const keys=Array.from({length:1001},(_,i)=>`SKU-${i}`);
  const deps={job,read,write,check:async()=>{},persist:async patch=>Object.assign(job,patch),record:()=>{},identity:'stable',now:()=>now,
    selectionPage:async page=>({keys:keys.slice(page*500,(page+1)*500),hasMore:(page+1)*500<keys.length}),
    request:async()=>({ItemResponse:[]}),
    prepare:async sku=>{if(sku==='SKU-51'&&suspend){suspend=false;throw pause('throttled',now+60000)}return {sku,productId:sku,token:sku,version:'4.2',header:{version:'4.2'},item:{Item:{sku}},status:'prepared'}},
    submit:async(key,rows)=>{submitted.push(rows.length);return rows.map(r=>({sku:r.sku,status:'submitted',feedId:key}))}};
  for(let i=0;i<40;i++){await runBulkLaunch(deps);if(job.status==='success')break;now+=60001;}
  assert.equal(job.status,'success');assert.deepEqual(submitted,[1000,1]);assert.equal(job.processedRows,1001);
  job.status='running'; await runBulkLaunch(deps); assert.equal(job.status,'success');assert.deepEqual(submitted,[1000,1],'completed run cannot resubmit');
  await assert.rejects(runBulkLaunch({...deps,identity:'another-account'}),/account or selection changed/);
  console.log('PASS bulk pacing, Retry-After, pre-intent waiting, resumed matching, 1000-item feeds, and completed-run idempotency');
}
main().catch(e=>{console.error(e);process.exitCode=1});
