const assert = require('node:assert/strict');
const url = process.env.DATAPLUS_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw Error('Use an isolated local database ending in _test.');
process.env.DATABASE_URL = url;
const db = require('../db');
async function main() {
  await db.initRelationalSchema();
  const pool = db.getPool();
  await pool.query(`insert into order_records(order_id,source,marketplace_order_id,internal_order_number,raw) values
    ('temu-page-A','Temu','A','1002','{"id":"temu-page-A","external":{"temuListRefresh":{"fingerprint":"abc"}},"warehouseId":"physical","notes":"Keep local notes"}'),
    ('other-A','eBay','A','DP-9999','{}'), ('temu-other','Temu','B','1003','{}')`);
  const rows = await db.readTemuOrderPage(['A','unknown']);
  assert.equal(rows.length,1); assert.equal(rows[0].id,'temu-page-A');
  assert.equal(rows[0].warehouseId,'physical'); assert.equal(rows[0].notes,'Keep local notes');
  assert.equal(rows[0].external.temuListRefresh.fingerprint,'abc');
  assert.equal(await db.readOrderNumberFloor(),9999);
  await pool.query(`insert into state_documents(doc_key,data) values ('sequence','{"order":9999,"po":20}'),('connectorState','{"temuLastOrderSync":200,"otherChannel":"keep"}');
    insert into entity_documents(collection,entity_id,position,data) values ('connections','temu-test',0,'{"id":"temu-test","name":"Temu","settings":{"temuWebhookEnabled":true,"temuLastOrderSync":200,"unrelated":"keep"}}')`);
  await db.saveTemuImportCheckpoint({syncTime:100,sequenceOrder:1000,channelId:'temu-test'});
  const docs = await pool.query("select doc_key,data from state_documents where doc_key in ('sequence','connectorState')");
  assert.equal(docs.rows.find(r=>r.doc_key==='sequence').data.order,9999);
  assert.equal(docs.rows.find(r=>r.doc_key==='connectorState').data.temuLastOrderSync,200);
  await db.saveTemuImportCheckpoint({syncTime:300,sequenceOrder:10000,channelId:'temu-test'});
  const connection = (await pool.query("select data from entity_documents where entity_id='temu-test'")).rows[0].data;
  assert.equal(connection.settings.temuLastOrderSync,300); assert.equal(connection.settings.unrelated,'keep'); assert.equal(connection.settings.temuWebhookEnabled,true);
  assert.deepEqual(await db.readTemuOrderPage([]),[]);
  await assert.rejects(db.readTemuOrderPage(Array.from({length:251},(_,i)=>String(i))), /one page/);
  await pool.query("insert into order_records(order_id,source,marketplace_order_id,raw) values ('duplicate-A','Temu','A','{}')");
  await assert.rejects(db.readTemuOrderPage(['A']),/Duplicate/);
  console.log('Temu SQL: bounded source scope, saved metadata/local fields, numbering floor and ambiguous identity checks passed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.closePool());
