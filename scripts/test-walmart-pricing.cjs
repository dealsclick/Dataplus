const assert = require('node:assert/strict');
const { runPricing, rowKey, prefix, normalize } = require('../lib/walmart-pricing');
(async()=>{
  assert.equal(normalize({sku:'A',competitorPrice:0},'now').competitorPrice,0);
  assert.equal(normalize({sku:'A',competitorPrice:null},'now').competitorPrice,null);
  let now=1000000,calls=0,mode='ok'; const docs=new Map();
  const read=async k=>structuredClone(docs.get(k)),write=async(k,v)=>docs.set(k,structuredClone(v));
  const job={id:'pricing-test',workerPayload:{channelId:'channel',environment:'production',credentialKey:'one'}};
  const deps={job,read,write,now:()=>now,lock:async(k,fn)=>fn(),check:async()=>{},persist:async p=>Object.assign(job,p),client:{request:async(path,options)=>{
    calls++; assert.equal(path,'/v3/price/getPricingInsights'); assert.equal(options.method,'POST');
    assert.deepEqual(options.body.sort,{sortField:'GMVL30D',sortOrder:'DESC'});
    if(mode==='429'){await options.onResponse({status:429,headers:new Headers({'retry-after':'90'})});throw Object.assign(new Error('limited'),{upstreamStatus:429});}
    if(mode==='invalid')return {};
    return {data:{pricingInsightsResponseList:[{sku:options.body.pageNumber===0?'SELLER-A':'SELLER-B',buyBoxTotalPrice:20,competitorPrice:0}],pageContext:{totalCount:2,totalPages:2}}};
  }}};
  await runPricing(deps);assert.equal(job.status,'queued');assert.equal(calls,1);
  await runPricing(deps);assert.equal(calls,1,'rate wait makes no API call');
  now+=35001;await runPricing(deps);assert.equal(job.status,'success');assert.equal(job.processedRows,2);
  assert.equal((await read(rowKey(job.workerPayload,'SELLER-A'))).competitorPrice,0);
  assert.equal(await read(rowKey({...job.workerPayload,credentialKey:'different'},'SELLER-A')),undefined,'account cache is isolated');
  await runPricing(deps);assert.equal(calls,2,'completion retry does not repeat API reads');
  job.id='limited';mode='429';now+=35001;await runPricing(deps);assert.equal(job.status,'queued');assert.equal(Date.parse(job.scheduledFor),now+90000);
  now+=90001;mode='invalid';await assert.rejects(runPricing(deps),/Invalid Walmart pricing response/);
  assert.equal((await read(rowKey(job.workerPayload,'SELLER-A'))).buyBoxTotalPrice,20,'bad response preserves previous cache');
  assert.ok(await read(`${prefix(job.workerPayload)}.sync`));
  job.id='repeated';mode='ok';now+=35001;
  docs.set(`walmart.pricing-run.${job.id}`,{page:1,processed:1});
  docs.set(`walmart.pricing-run.${job.id}.seen.${require('node:crypto').createHash('sha256').update(JSON.stringify(['SELLER-B'])).digest('hex')}`,{seen:true});
  await runPricing(deps);assert.equal(job.status,'queued');
  now+=60001;await runPricing(deps);assert.equal(job.status,'queued');
  now+=60001;await runPricing(deps);assert.equal(job.status,'warning');assert.match(job.message,/existing cached prices were preserved/);
  console.log('PASS Walmart pricing cache, nullable/zero prices, pagination, pacing, 429 recovery, account isolation and retry safety');
})().catch(e=>{console.error(e);process.exitCode=1});
