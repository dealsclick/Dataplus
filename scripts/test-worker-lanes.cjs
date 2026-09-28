const assert = require('node:assert/strict');
const {LANES, ORDER_TASKS, SHOPIFY_ORDER_TASKS, EBAY_ORDER_TASKS, TEMU_ORDER_TASKS, WALMART_TASKS, validateLane, supportsTask, summarizeWorkers, jobWorkerStatus, laneSql} = require('../lib/worker-lanes');
assert.throws(()=>validateLane('typo'));
const now=new Date().toISOString();
const workers=summarizeWorkers(LANES.map(lane=>({lane,workerId:lane+'-new',status:'running',lastSeenAt:now,supportedTasks:ORDER_TASKS})),true);
assert.equal(workers.workers.length,6);
assert.equal(jobWorkerStatus({workerId:'orders-temu-new',workerLane:'orders-temu'},workers).workerId,'orders-temu-new');
assert.equal(jobWorkerStatus({workerId:'orders-temu-old',workerLane:'orders-temu'},workers).workerId,'orders-temu-new');
assert.equal(jobWorkerStatus({workerId:'unknown'},workers).online,false);
assert.equal(jobWorkerStatus({workerId:'manual-new'},workers).workerId,'manual-new');
assert.equal(summarizeWorkers([{lastSeenAt:'2000-01-01',status:'running'}],true).online,false);
assert.equal(summarizeWorkers([],true).online,false);
assert.match(laneSql, /workerPayload'->>'background'/, 'explicit background jobs must be claimable by the background lane');
assert.equal(supportsTask('background', 'ebay-catalog-sync'), true);
assert.equal(supportsTask('background', 'shopify-order-import'), false);
assert.equal(supportsTask('orders-shopify', 'shopify-order-import'), true);
assert.equal(supportsTask('orders-ebay', 'ebay-return-import'), true);
assert.equal(supportsTask('orders-temu', 'temu-order-status'), true);
assert.equal(supportsTask('walmart', 'walmart-orders'), true);
if (!process.argv.includes('--sql')) { console.log('PASS independent worker heartbeat ownership and replacement'); process.exit(); }
// Temp tables only; explicit local database required for queue routing checks.
const {Pool}=require('pg');const url=process.env.WORKER_TEST_DATABASE_URL;
if(!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use an explicit local WORKER_TEST_DATABASE_URL');
(async()=>{const pool=new Pool({connectionString:url});const c=await pool.connect();try{
await c.query('begin');await c.query('create temp table lane_jobs(name text,raw jsonb) on commit drop');
const cases=[['manual launch',{workerTask:'walmart-bulk-launch'},'walmart'],['Scheduled feed',{workerTask:'vendor-feed-import'},'background'],['Walmart order import',{workerTask:'walmart-orders'},'walmart'],['Shopify order import',{workerTask:'shopify-order-import'},'orders-shopify'],['scheduled eBay returns',{workerTask:'ebay-return-import',scheduled:true},'orders-ebay'],['Temu status',{workerTask:'temu-order-status'},'orders-temu'],['sync',{workerTask:'shopify-inventory-update',workerPayload:{scheduled:true}},'background'],['explicit background sync',{workerTask:'ebay-catalog-sync',workerPayload:{background:true}},'background'],['manual sync',{workerTask:'shopify-inventory-update',scheduled:false},'manual']];
const testLaneSql=laneSql.replaceAll('$4','$1').replaceAll('$5','$2').replaceAll('$6','$3').replaceAll('$7','$4');
for(const [name,raw,lane]of cases){await c.query('truncate lane_jobs');await c.query('insert into lane_jobs values($1,$2)',[name,raw]);const result=await c.query(`select ${testLaneSql} lane from lane_jobs`,[SHOPIFY_ORDER_TASKS,EBAY_ORDER_TASKS,TEMU_ORDER_TASKS,WALMART_TASKS]);assert.equal(result.rows[0].lane,lane);}
await c.query('rollback');console.log('PASS SQL worker routing for independent marketplace order lanes and background work');
}finally{c.release();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
