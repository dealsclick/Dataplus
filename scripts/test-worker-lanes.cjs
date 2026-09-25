const assert = require('node:assert/strict');
const {LANES, ORDER_TASKS, WALMART_TASKS, validateLane, supportsTask, summarizeWorkers, jobWorkerStatus, laneSql} = require('../lib/worker-lanes');
assert.throws(()=>validateLane('typo'));
const now=new Date().toISOString();
const workers=summarizeWorkers(LANES.map(lane=>({lane,workerId:lane+'-new',status:'running',lastSeenAt:now,supportedTasks:ORDER_TASKS})),true);
assert.equal(workers.workers.length,4);
assert.equal(jobWorkerStatus({workerId:'orders-new',workerLane:'orders'},workers).workerId,'orders-new');
assert.equal(jobWorkerStatus({workerId:'orders-old',workerLane:'orders'},workers).workerId,'orders-new');
assert.equal(jobWorkerStatus({workerId:'unknown'},workers).online,false);
assert.equal(jobWorkerStatus({workerId:'manual-new'},workers).workerId,'manual-new');
assert.equal(summarizeWorkers([{lastSeenAt:'2000-01-01',status:'running'}],true).online,false);
assert.equal(summarizeWorkers([],true).online,false);
assert.match(laneSql, /workerPayload'->>'background'/, 'explicit background jobs must be claimable by the background lane');
assert.equal(supportsTask('background', 'ebay-catalog-sync'), true);
assert.equal(supportsTask('background', 'shopify-order-import'), false);
if (!process.argv.includes('--sql')) { console.log('PASS independent worker heartbeat ownership and replacement'); process.exit(); }
// Temp tables only; explicit local database required for queue routing checks.
const {Pool}=require('pg');const url=process.env.WORKER_TEST_DATABASE_URL;
if(!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use an explicit local WORKER_TEST_DATABASE_URL');
(async()=>{const pool=new Pool({connectionString:url});const c=await pool.connect();try{
await c.query('begin');await c.query('create temp table lane_jobs(name text,raw jsonb) on commit drop');
const cases=[['manual launch',{workerTask:'walmart-bulk-launch'},'walmart'],['Scheduled feed',{workerTask:'vendor-feed-import'},'background'],['manual order import',{workerTask:'walmart-orders'},'orders'],['scheduled returns',{workerTask:'ebay-return-import',scheduled:true},'orders'],['sync',{workerTask:'shopify-inventory-update',workerPayload:{scheduled:true}},'background'],['explicit background sync',{workerTask:'ebay-catalog-sync',workerPayload:{background:true}},'background'],['manual sync',{workerTask:'shopify-inventory-update',scheduled:false},'manual']];
for(const [name,raw,lane]of cases){await c.query('truncate lane_jobs');await c.query('insert into lane_jobs values($1,$2)',[name,raw]);const result=await c.query(`select ${laneSql.replaceAll('$4','$1').replaceAll('$5','$2')} lane from lane_jobs`,[ORDER_TASKS,WALMART_TASKS]);assert.equal(result.rows[0].lane,lane);}
await c.query('rollback');console.log('PASS SQL worker routing for manual, scheduled, explicit background, orders and returns');
}finally{c.release();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
