const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Client}=require('pg');
(async()=>{
  const client=new Client({host:'127.0.0.1',user:'postgres',database:'postgres',port:5432});await client.connect();
  try{
    await client.query('begin');
    await client.query(`create temporary table operations_jobs (job_id text primary key,job_type text,category text,status text,name text,message text,total_rows int,processed_rows int,changed_rows int,missing_rows int,progress numeric,eta_seconds int,source text,output_path text,error_path text,raw jsonb,created_at timestamptz default now(),started_at timestamptz,ended_at timestamptz,updated_at timestamptz default now()) on commit drop`);
    const source=fs.readFileSync(require.resolve('../db'),'utf8');
    const start=source.indexOf('async function claimQueuedOperationJob('),end=source.indexOf('\nconst BACKUP_CORE_TABLES',start);
    const context={getPool:()=>client,initRelationalSchema:async()=>{},nullableString:s=>s,crypto:require('node:crypto')};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
    await client.query(`insert into operations_jobs(job_id,status,raw) values ('bulk','queued',$1),('order','queued',$2)`,[JSON.stringify({workerTask:'walmart-bulk-launch',scheduledFor:'2099-01-01T00:00:00.000Z',queuePriority:30}),JSON.stringify({workerTask:'walmart-orders',queuePriority:65})]);
    const claim=()=>context.claimQueuedOperationJob({workerId:'fixture',tasks:['walmart-bulk-launch','walmart-orders']});
    assert.equal((await claim()).id,'order');assert.equal(await claim(),null,'future bulk jobs cannot spin or block orders');
    await client.query(`update operations_jobs set raw=raw || '{"scheduledFor":"2000-01-01T00:00:00.000Z"}' where job_id='bulk'`);
    assert.equal((await claim()).id,'bulk');
    console.log('PASS PostgreSQL scheduled bulk claim and order priority (temporary rollback-only fixtures)');
  }finally{await client.query('rollback');await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
