const {parseUpload,normalize,fields,MAX_UPLOAD_BYTES}=require('./manual-order-import');
const {ctechOrderMetadata,ctechCustomerSql,ctechChannelSql}=require('./ctech-orders');
const crypto=require('node:crypto');
const MAX_UPLOAD_CHUNK_BYTES=3*1024*1024;
const schema=`
create table if not exists workspace_order_import_templates (
 id text not null, tenant_id text not null, company_id text not null, name text not null, channel_id text not null,
 mapping jsonb not null, updated_at timestamptz not null default now(), created_by text not null,
 primary key(tenant_id,company_id,id), foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
);
create unique index if not exists workspace_order_template_name on workspace_order_import_templates(tenant_id,company_id,lower(name));
create table if not exists workspace_order_imports (
  id bigserial primary key, tenant_id text not null, company_id text not null, source text not null,
  filename text not null, file_hash text not null, status text not null default 'uploaded',
  payload jsonb not null, summary jsonb not null default '{}', created_by text not null,
  created_at timestamptz not null default now(), applied_at timestamptz, rolled_back_at timestamptz,
  unique(tenant_id,company_id,id),
  foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
);
create table if not exists workspace_imported_order_lines (
  id bigserial primary key, tenant_id text not null, company_id text not null, source text not null,
  order_id text not null, line_id text not null, batch_id bigint not null, data jsonb not null,
  active boolean not null default true,
  foreign key(tenant_id,company_id,batch_id) references workspace_order_imports(tenant_id,company_id,id)
);
create unique index if not exists workspace_imported_order_identity on workspace_imported_order_lines(tenant_id,company_id,source,order_id,line_id) where active;
create index if not exists workspace_imported_order_batch on workspace_imported_order_lines(tenant_id,company_id,batch_id);
create index if not exists workspace_imported_order_company_date on workspace_imported_order_lines(tenant_id,company_id,(data->>'date')) where active;
create table if not exists workspace_order_import_rows (
  tenant_id text not null, company_id text not null, batch_id bigint not null, source_row integer not null,
  raw jsonb not null, data jsonb,
  primary key(tenant_id,company_id,batch_id,source_row),
  foreign key(tenant_id,company_id,batch_id) references workspace_order_imports(tenant_id,company_id,id) on delete cascade
);
create index if not exists workspace_order_import_rows_batch on workspace_order_import_rows(tenant_id,company_id,batch_id);
create table if not exists workspace_order_import_uploads (
  tenant_id text not null, company_id text not null, id text not null, channel_id text not null,
  template_id text, filename text not null, total_bytes integer not null, chunk_count integer not null,
  status text not null default 'uploading', batch_id bigint, created_by text not null,
  created_at timestamptz not null default now(), completed_at timestamptz,
  primary key(tenant_id,company_id,id),
  foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id),
  foreign key(tenant_id,company_id,batch_id) references workspace_order_imports(tenant_id,company_id,id)
);
create table if not exists workspace_order_import_upload_chunks (
  tenant_id text not null, company_id text not null, upload_id text not null, chunk_index integer not null,
  content bytea not null, content_hash text not null,
  primary key(tenant_id,company_id,upload_id,chunk_index),
  foreign key(tenant_id,company_id,upload_id) references workspace_order_import_uploads(tenant_id,company_id,id) on delete cascade
);
alter table workspace_order_imports add column if not exists channel_id text;
`;
function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function createOrderImporter({pool,init,transaction,access,audit,existingChannels=async()=>[]}) {
  const customerSql=(data='l.data',source='l.source')=>ctechCustomerSql(data,source);
  const reportChannelSql=(data='l.data',source='l.source')=>ctechChannelSql(data,source);
  async function channel(client,scope,id) {
    if(typeof id!=='string' || !id || id.length>200)fail('Select a manual channel source for this import.');
    const row=(await existingChannels(scope)).find(c=>c.id===id) || (await client.query('select id,name,source_key,enabled from workspace_manual_channels where tenant_id=$1 and company_id=$2 and id=$3 for share',[scope.tenantId,scope.companyId,id])).rows[0];
    if(!row)fail('Select a manual channel belonging to this company.',404);
    if(!row.enabled)fail('This manual channel is disabled. Enable it before importing orders.',409);
    return row;
  }
  async function batch(client,scope,id) {
    if(!/^\d+$/.test(String(id)))fail('Select an import batch.');
    const row=(await client.query('select * from workspace_order_imports where tenant_id=$1 and company_id=$2 and id=$3 for update',[scope.tenantId,scope.companyId,id])).rows[0];
    if(!row)fail('Import not found.',404);return row;
  }
  async function classify(client,scope,source,lines,{collectFresh=true}={}) {
    const orderIds=[...new Set(lines.map(l=>l.orderId))],existing=[];
    for(let offset=0;offset<orderIds.length;offset+=5000) {
      existing.push(...(await client.query('select order_id,line_id,data from workspace_imported_order_lines where tenant_id=$1 and company_id=$2 and source=$3 and active and order_id=any($4::text[])',[scope.tenantId,scope.companyId,source,orderIds.slice(offset,offset+5000)])).rows);
    }
    const found=new Map(existing.map(l=>[JSON.stringify([l.order_id,l.line_id]),l.data.fingerprint]));
    const fresh=[],conflicts=[];let freshCount=0,duplicates=0;
    for(const line of lines){const old=found.get(JSON.stringify([line.orderId,line.lineId]));if(!old){freshCount++;if(collectFresh)fresh.push(line);}else if(old===line.fingerprint)duplicates++;else conflicts.push({row:line.sourceRow,level:'error',message:`Order ${line.orderId}, line ${line.lineId} already exists with different values. Review and roll back its original batch before replacing it.`});}
    return {fresh,freshCount,conflicts,duplicates};
  }
  function previewResult(row){const p=row.payload;return {id:row.id,templateName:p.template?.name,channelId:row.channel_id,channelName:p.channelName || row.source,status:row.status,previewToken:p.previewToken,filename:row.filename,source:row.source,headers:p.parsed.headers,sheet:p.parsed.sheet,sheets:p.parsed.sheets,mapping:p.mapping || p.parsed.suggested,fields:Object.keys(fields),sample:p.parsed.sample || p.parsed.rows?.slice(0,5) || [],summary:row.summary,issues:[...(p.issues || [])].sort((a,b)=>(a.level==='error'?0:1)-(b.level==='error'?0:1)).slice(0,100),lines:(p.lines || []).slice(0,10)};}
  async function stageRows(client,scope,batchId,rows) {
    for(let offset=0;offset<rows.length;offset+=500) {
      const values=rows.slice(offset,offset+500).map((raw,index)=>({sourceRow:offset+index+2,raw}));
      await client.query(`insert into workspace_order_import_rows(tenant_id,company_id,batch_id,source_row,raw)
        select $1,$2,$3,(x->>'sourceRow')::integer,x->'raw' from jsonb_array_elements($4::jsonb) x`,[scope.tenantId,scope.companyId,batchId,JSON.stringify(values)]);
    }
  }
  async function rawRows(client,scope,batchId) {
    return (await client.query('select source_row,raw from workspace_order_import_rows where tenant_id=$1 and company_id=$2 and batch_id=$3 order by source_row',[scope.tenantId,scope.companyId,batchId])).rows;
  }
  async function normalizedRows(client,scope,batchId) {
    return (await client.query('select data from workspace_order_import_rows where tenant_id=$1 and company_id=$2 and batch_id=$3 and data is not null order by source_row',[scope.tenantId,scope.companyId,batchId])).rows.map(row=>row.data);
  }
  async function saveNormalizedRows(client,scope,batchId,lines) {
    await client.query('update workspace_order_import_rows set data=null where tenant_id=$1 and company_id=$2 and batch_id=$3',[scope.tenantId,scope.companyId,batchId]);
    for(let offset=0;offset<lines.length;offset+=500) {
      await client.query(`update workspace_order_import_rows r set data=x->'data' from jsonb_array_elements($4::jsonb) x
        where r.tenant_id=$1 and r.company_id=$2 and r.batch_id=$3 and r.source_row=(x->>'sourceRow')::integer`,[scope.tenantId,scope.companyId,batchId,JSON.stringify(lines.slice(offset,offset+500).map(line=>({sourceRow:line.sourceRow,data:line}))) ]);
    }
  }
  async function saveParsedImport(client,user,scope,input,parsed) {
    await access(client,user,scope,true);
    const selected=await channel(client,scope,input.channelId),source=selected.source_key;
    let template=null;
    if(input.templateId) {
      template=(await client.query('select id,name,channel_id,mapping,updated_at from workspace_order_import_templates where tenant_id=$1 and company_id=$2 and id=$3 for share',[scope.tenantId,scope.companyId,input.templateId])).rows[0];
      if(!template)fail('Template not found in this company.',404);
      if(template.channel_id!==selected.id)fail('This template belongs to a different channel. Select the matching channel.',409);
    }
    const {rows,...metadata}=parsed;
    metadata.sample=rows.slice(0,5);
    const row=(await client.query('insert into workspace_order_imports(tenant_id,company_id,source,filename,file_hash,payload,created_by,channel_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[scope.tenantId,scope.companyId,source,String(input.filename).slice(0,240),parsed.hash,JSON.stringify({parsed:metadata,channelName:selected.name,...(template?{mapping:template.mapping,template}:{})}),user.id,selected.id])).rows[0];
    await stageRows(client,scope,row.id,rows);
    await audit(client,scope,user,'manual_order_file_uploaded',{batchId:row.id,filename:row.filename,source,rowCount:rows.length,reportingOnly:true,inventoryAllocation:false});
    return row;
  }
  return {
    async templates(user,scope) {
      await init();await access(pool(),user,scope);
      return {rows:(await pool().query('select id,name,channel_id,mapping,updated_at from workspace_order_import_templates where tenant_id=$1 and company_id=$2 order by lower(name)',[scope.tenantId,scope.companyId])).rows};
    },
    async saveTemplate(user,scope,input) {return transaction(async client=>{
      await access(client,user,scope,true);await channel(client,scope,input.channelId);
      const name=typeof input.name==='string'?input.name.trim():'';
      if(!name || name.length>100)fail('Enter a template name of up to 100 characters.');
      const mapping=input.mapping;
      if(!mapping || typeof mapping!=='object' || Array.isArray(mapping) || Object.entries(mapping).some(([key,value])=>!Object.hasOwn(fields,key) || typeof value!=='string' || value.length>300))fail('Invalid template mapping.');
      for(const key of ['orderId','date','sku','quantity'])if(!mapping[key])fail(`Map ${key} before saving the template.`);
      if(!mapping.sales && !mapping.unitPrice)fail('Map extended sales or unit price before saving.');
      let row;
      if(input.id) {
        row=(await client.query('update workspace_order_import_templates set name=$4,channel_id=$5,mapping=$6,updated_at=now() where tenant_id=$1 and company_id=$2 and id=$3 returning id,name,channel_id,mapping,updated_at',[scope.tenantId,scope.companyId,input.id,name,input.channelId,JSON.stringify(mapping)])).rows[0];
        if(!row)fail('Template not found in this company.',404);
      } else row=(await client.query('insert into workspace_order_import_templates(tenant_id,company_id,id,name,channel_id,mapping,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id,name,channel_id,mapping,updated_at',[scope.tenantId,scope.companyId,crypto.randomUUID(),name,input.channelId,JSON.stringify(mapping),user.id])).rows[0];
      await audit(client,scope,user,'order_import_template_saved',{templateId:row.id,name,channelId:input.channelId});return row;
    });},
    async upload(user,scope,input){
      await init();await access(pool(),user,scope,true);
      await channel(pool(),scope,input.channelId);
      const parsed=await parseUpload(input);
      return transaction(async client=>{
        return previewResult(await saveParsedImport(client,user,scope,input,parsed));
      });
    },
    async startUpload(user,scope,input){
      await init();
      return transaction(async client=>{
      await access(client,user,scope,true);await channel(client,scope,input.channelId);
      const filename=typeof input.filename==='string'?input.filename.trim():'';
      const totalBytes=Number(input.totalBytes),chunkCount=Number(input.chunkCount);
      if(!/\.(csv|xlsx|xls)$/i.test(filename) || filename.length>240)fail('Choose a CSV, XLSX, or XLS order export.');
      if(!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>MAX_UPLOAD_BYTES)fail('Upload a file up to 25 MB.');
      if(!Number.isSafeInteger(chunkCount)||chunkCount<1||chunkCount>Math.ceil(MAX_UPLOAD_BYTES/MAX_UPLOAD_CHUNK_BYTES))fail('Invalid upload chunk count.');
      if(input.templateId) {
        const template=(await client.query('select channel_id from workspace_order_import_templates where tenant_id=$1 and company_id=$2 and id=$3',[scope.tenantId,scope.companyId,input.templateId])).rows[0];
        if(!template)fail('Template not found in this company.',404);
        if(template.channel_id!==input.channelId)fail('This template belongs to a different channel. Select the matching channel.',409);
      }
      await client.query("delete from workspace_order_import_uploads where tenant_id=$1 and company_id=$2 and status='uploading' and created_at<now()-interval '24 hours'",[scope.tenantId,scope.companyId]);
      const uploadId=crypto.randomUUID();
      await client.query('insert into workspace_order_import_uploads(tenant_id,company_id,id,channel_id,template_id,filename,total_bytes,chunk_count,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[scope.tenantId,scope.companyId,uploadId,input.channelId,input.templateId || null,filename,totalBytes,chunkCount,user.id]);
      return {uploadId,chunkBytes:MAX_UPLOAD_CHUNK_BYTES,chunkCount};
      });
    },
    async uploadChunk(user,scope,input){
      await init();
      return transaction(async client=>{
      await access(client,user,scope,true);
      const uploadId=typeof input.uploadId==='string'?input.uploadId:'';
      const upload=(await client.query('select * from workspace_order_import_uploads where tenant_id=$1 and company_id=$2 and id=$3 for update',[scope.tenantId,scope.companyId,uploadId])).rows[0];
      if(!upload||upload.created_by!==user.id)fail('Upload session not found.',404);
      if(upload.status!=='uploading')fail('This upload is already complete.',409);
      const chunkIndex=Number(input.chunkIndex);
      if(!Number.isSafeInteger(chunkIndex)||chunkIndex<0||chunkIndex>=upload.chunk_count)fail('Invalid upload chunk.');
      if(typeof input.content!=='string'||input.content.length>Math.ceil(MAX_UPLOAD_CHUNK_BYTES/3)*4+8)fail('Upload chunk is too large.');
      const content=Buffer.from(input.content,'base64');
      if(!content.length||content.length>MAX_UPLOAD_CHUNK_BYTES)fail('Upload chunk is empty or too large.');
      const contentHash=crypto.createHash('sha256').update(content).digest('hex');
      await client.query(`insert into workspace_order_import_upload_chunks(tenant_id,company_id,upload_id,chunk_index,content,content_hash) values($1,$2,$3,$4,$5,$6)
        on conflict(tenant_id,company_id,upload_id,chunk_index) do update set content=excluded.content,content_hash=excluded.content_hash`,[scope.tenantId,scope.companyId,uploadId,chunkIndex,content,contentHash]);
      const received=(await client.query('select count(*)::int as count from workspace_order_import_upload_chunks where tenant_id=$1 and company_id=$2 and upload_id=$3',[scope.tenantId,scope.companyId,uploadId])).rows[0].count;
      return {uploadId,chunkIndex,received,total:Number(upload.chunk_count)};
      });
    },
    async completeUpload(user,scope,input){
      await init();await access(pool(),user,scope,true);
      const uploadId=typeof input.uploadId==='string'?input.uploadId:'';
      const upload=(await pool().query('select * from workspace_order_import_uploads where tenant_id=$1 and company_id=$2 and id=$3',[scope.tenantId,scope.companyId,uploadId])).rows[0];
      if(!upload||upload.created_by!==user.id)fail('Upload session not found.',404);
      if(upload.status==='completed'&&upload.batch_id) {
        return transaction(async client=>{
          await access(client,user,scope);
          return previewResult(await batch(client,scope,upload.batch_id));
        });
      }
      await channel(pool(),scope,upload.channel_id);
      const chunks=(await pool().query('select chunk_index,content from workspace_order_import_upload_chunks where tenant_id=$1 and company_id=$2 and upload_id=$3 order by chunk_index',[scope.tenantId,scope.companyId,uploadId])).rows;
      if(chunks.length!==Number(upload.chunk_count)||chunks.some((chunk,index)=>Number(chunk.chunk_index)!==index))fail('Some upload parts are missing. Retry the upload.',409);
      const content=Buffer.concat(chunks.map(chunk=>chunk.content));
      if(content.length!==Number(upload.total_bytes))fail('The uploaded file size does not match. Retry the upload.',409);
      const parsed=await parseUpload({filename:upload.filename,content:content.toString('base64')});
      return transaction(async client=>{
        const locked=(await client.query('select * from workspace_order_import_uploads where tenant_id=$1 and company_id=$2 and id=$3 for update',[scope.tenantId,scope.companyId,uploadId])).rows[0];
        if(locked.status==='completed'&&locked.batch_id)return previewResult(await batch(client,scope,locked.batch_id));
        const row=await saveParsedImport(client,user,scope,{filename:locked.filename,channelId:locked.channel_id,templateId:locked.template_id},parsed);
        await client.query("update workspace_order_import_uploads set status='completed',batch_id=$4,completed_at=now() where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,uploadId,row.id]);
        await client.query('delete from workspace_order_import_upload_chunks where tenant_id=$1 and company_id=$2 and upload_id=$3',[scope.tenantId,scope.companyId,uploadId]);
        return previewResult(row);
      });
    },
    async preview(user,scope,input){return transaction(async client=>{
      await access(client,user,scope,true);const row=await batch(client,scope,input.batchId);
      await channel(client,scope,row.channel_id);
      if(!['uploaded','preview'].includes(row.status))fail('Only an unapplied batch can be previewed.',409);
      const staged=await rawRows(client,scope,row.id);
      const parsedRows=staged.length ? staged.map(item=>item.raw) : row.payload.parsed.rows;
      if(!Array.isArray(parsedRows) || !parsedRows.length)fail('This import has no staged source rows. Upload the file again.',409);
      const result=normalize({...row.payload.parsed,rows:parsedRows},input.mapping || {});
      const classified=await classify(client,scope,row.source,result.lines,{collectFresh:false});
      result.issues.push(...classified.conflicts);result.summary.errors+=classified.conflicts.length;
      Object.assign(result.summary,{newLines:classified.freshCount,duplicateLines:classified.duplicates});
      if(staged.length)await saveNormalizedRows(client,scope,row.id,result.lines);
      const lineDigest=crypto.createHash('sha256');for(const line of result.lines)lineDigest.update(line.fingerprint);
      row.payload={...row.payload,mapping:input.mapping,issues:result.issues.slice(0,100)};row.summary=result.summary;row.status='preview';
      if(!staged.length)row.payload.lines=result.lines;
      row.payload.previewToken=crypto.createHash('sha256').update(JSON.stringify([row.file_hash,lineDigest.digest('hex'),result.summary,input.mapping])).digest('hex');
      await client.query("update workspace_order_imports set payload=$4,summary=$5,status='preview' where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,row.id,JSON.stringify(row.payload),JSON.stringify(row.summary)]);
      return previewResult(row);
    });},
    async apply(user,scope,input){return transaction(async client=>{
      await access(client,user,scope,true);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(scope)]);
      const row=await batch(client,scope,input.batchId);
      if(row.status==='applied')return {id:row.id,status:row.status,summary:row.summary};
      const selected=await channel(client,scope,row.channel_id);
      if(row.status!=='preview' || row.summary.errors || input.confirm!==true)fail('Preview and resolve all errors before confirming this import.',409);
      if(input.previewToken!==row.payload.previewToken)fail('The preview changed. Review the latest preview before importing.',409);
      const staged=await normalizedRows(client,scope,row.id),lines=staged.length ? staged : row.payload.lines;
      if(!Array.isArray(lines) || lines.length!==Number(row.summary.lineCount || 0))fail('The validated import rows are incomplete. Preview this batch again.',409);
      const classified=await classify(client,scope,row.source,lines);
      if(classified.conflicts.length)fail('Existing orders changed after preview. Preview this batch again.',409);
      const fresh=selected.source_key==='zoro'
        ? classified.fresh.map(line=>({...line,...ctechOrderMetadata(line.customer)}))
        : classified.fresh;
      for(let offset=0;offset<fresh.length;offset+=500){
        await client.query(`insert into workspace_imported_order_lines(tenant_id,company_id,source,order_id,line_id,batch_id,data)
          select $1,$2,$3,x->>'orderId',x->>'lineId',$4,x from jsonb_array_elements($5::jsonb) x`,[scope.tenantId,scope.companyId,row.source,row.id,JSON.stringify(fresh.slice(offset,offset+500))]);
      }
      const summary={...row.summary,insertedLines:fresh.length,duplicateLines:classified.duplicates};
      await client.query("update workspace_order_imports set status='applied',summary=$4,applied_at=now() where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,row.id,JSON.stringify(summary)]);
      await client.query('delete from workspace_order_import_rows where tenant_id=$1 and company_id=$2 and batch_id=$3',[scope.tenantId,scope.companyId,row.id]);
      await audit(client,scope,user,'manual_orders_imported',{batchId:row.id,source:row.source,reportingOnly:true,inventoryAllocation:false,...summary});return {id:row.id,status:'applied',summary,reportingOnly:true,inventoryAllocation:false};
    });},
    async rollback(user,scope,input){return transaction(async client=>{
      await access(client,user,scope,true);
      if(input.confirm!==true)fail('Confirm rollback.');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(scope)]);
      const row=await batch(client,scope,input.batchId);
      if(row.status==='rolled_back')return {id:row.id,status:row.status};
      if(row.status!=='applied')fail('Only an applied batch can be rolled back.',409);
      await client.query('update workspace_imported_order_lines set active=false where tenant_id=$1 and company_id=$2 and batch_id=$3',[scope.tenantId,scope.companyId,row.id]);
      await client.query("update workspace_order_imports set status='rolled_back',rolled_back_at=now() where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,row.id]);
      await audit(client,scope,user,'manual_order_import_rolled_back',{batchId:row.id});return {id:row.id,status:'rolled_back'};
    });},
    async history(user,scope){await init();await access(pool(),user,scope);return {rows:(await pool().query(`select i.id,i.source,coalesce(c.name,i.source) as channel_name,i.filename,i.status,i.summary,i.created_at,i.applied_at,i.rolled_back_at
      from workspace_order_imports i left join workspace_manual_channels c on c.tenant_id=i.tenant_id and c.company_id=i.company_id and c.id=i.channel_id
      where i.tenant_id=$1 and i.company_id=$2 order by i.id desc limit 100`,[scope.tenantId,scope.companyId])).rows};},
    async detail(user,scope,id){return transaction(async client=>{await access(client,user,scope);return previewResult(await batch(client,scope,id));});},
    async orderLines(user,scope,query){
      await init();await access(pool(),user,scope);
      return {rows:(await pool().query('select batch_id,data from workspace_imported_order_lines where tenant_id=$1 and company_id=$2 and source=$3 and order_id=$4 and active order by line_id limit 10001',[scope.tenantId,scope.companyId,query.get('source') || '',query.get('orderId') || ''])).rows};
    },
    async listOrders(user,scope,input={}){
      await init();await access(pool(),user,scope);
      const value=name=>String(typeof input?.get==='function' ? input.get(name) || '' : input?.[name] || '').trim();
      const integer=(name,fallback,max)=>{const parsed=Number(value(name) || fallback);if(!Number.isSafeInteger(parsed)||parsed<0||parsed>max)fail(`Invalid ${name}.`);return parsed;};
      const limit=integer('limit',100,500),offset=integer('offset',0,10000000);
      const split=name=>[...new Set(value(name).split(',').map(entry=>entry.trim().toLowerCase()).filter(entry=>entry && entry!=='all'))];
      const q=value('q').slice(0,2000),qTerms=q.split(/[\r\n,]+/).map(entry=>entry.trim().toLowerCase()).filter(Boolean).slice(0,100);
      const statuses=split('status'),sources=split('source'),from=value('dateFrom') || value('from'),to=value('dateTo') || value('to');
      for(const date of [from,to])if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail('Invalid reporting date.');
      if(from&&to&&from>to)fail('From date must be before To date.');
      const optionalAmount=name=>{const raw=value(name);if(!raw)return null;const parsed=Number(raw);if(!Number.isFinite(parsed)||parsed<0||parsed>1e12)fail(`Invalid ${name}.`);return Math.round(parsed*100);};
      const totalMin=optionalAmount('totalMin'),totalMax=optionalAmount('totalMax');
      if(totalMin!==null&&totalMax!==null&&totalMin>totalMax)fail('Minimum total must not exceed maximum total.');

      const incompatible=[
        ['payment',[]],['fulfillment',[]],['brand',[]],['carrier',[]],['country',[]],['state',[]],['warehouse',[]],
        ['shipping',['unshipped']],['delivery',['no_tracking']],['label',['no_label']],['returnStatus',['no_return']],['exception',['no_exception']],['po',['unlinked']]
      ].some(([name,allowed])=>{const selected=split(name);return selected.length>0 && !selected.some(entry=>allowed.includes(entry));});
      if(incompatible)return {orders:[],total:0,offset,limit};

      const args=[],bind=value=>{args.push(value);return `$${args.length}`;};
      const candidateWhere=[`l.tenant_id=${bind(scope.tenantId)}`,`l.company_id=${bind(scope.companyId)}`,'l.active'];
      if(sources.length)candidateWhere.push(`lower(${reportChannelSql()})=any(${bind(sources)}::text[])`);
      if(statuses.length)candidateWhere.push(`lower(case when l.data->>'status'='Cancelled' then 'Canceled' else l.data->>'status' end)=any(${bind(statuses)}::text[])`);
      if(from)candidateWhere.push(`l.data->>'date'>=${bind(from)}`);
      if(to)candidateWhere.push(`l.data->>'date'<=${bind(to)}`);
      if(qTerms.length){
        const qParam=bind(qTerms);
        candidateWhere.push(`exists(select 1 from unnest(${qParam}::text[]) term where lower(concat_ws(' ',${reportChannelSql()},l.source,l.order_id,${customerSql()},l.data->>'customer',l.data->>'reference',l.data->>'status',l.data->>'sku',l.data->>'description',l.data->>'vendor',l.data->>'uom')) like '%'||term||'%')`);
      }
      const supplier=value('supplier');
      if(supplier&&supplier.toLowerCase()!=='all')candidateWhere.push(`lower(l.data->>'vendor')=${bind(supplier.toLowerCase())}`);
      const groupedWhere=[];
      if(totalMin!==null)groupedWhere.push(`sales_minor>=${bind(totalMin)}`);
      if(totalMax!==null)groupedWhere.push(`sales_minor<=${bind(totalMax)}`);
      const groupedFilter=groupedWhere.length?`where ${groupedWhere.join(' and ')}`:'';
      const sort={
        'created-asc':'order_date asc nulls last,source asc,order_id asc',
        'total-desc':'sales_minor desc,order_date desc nulls last,source asc,order_id asc',
        'total-asc':'sales_minor asc,order_date desc nulls last,source asc,order_id asc',
        'customer-asc':'lower(customer) asc nulls last,order_date desc nulls last,source asc,order_id asc',
        'created-desc':'order_date desc nulls last,source asc,order_id desc'
      }[value('sort')] || 'order_date desc nulls last,source asc,order_id desc';
      const limitParam=bind(limit),offsetParam=bind(offset);
      const result=await pool().query(`with candidate_orders as (
        select distinct l.tenant_id,l.company_id,l.source,l.order_id
        from workspace_imported_order_lines l where ${candidateWhere.join(' and ')}
      ), grouped as (
        select l.source,l.order_id,min(${reportChannelSql()}) as report_channel,min(l.data->>'date') as order_date,
          min(${customerSql()}) as customer,min(nullif(l.data->>'reference','')) as reference,
          case when count(distinct nullif(l.data->>'status',''))>1 then 'Mixed' else min(coalesce(nullif(l.data->>'status',''),'Unspecified')) end as status,
          sum((l.data->>'salesMinor')::numeric) as product_sales_minor,
          sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as shipping_minor,
          sum((l.data->>'salesMinor')::numeric)+sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as sales_minor,
          case when count(*) filter(where l.data->>'costMinor' is null)>0 then null else sum((l.data->>'costMinor')::numeric) end as cost_minor,
          max(i.applied_at) as imported_at,
          jsonb_agg(jsonb_build_object('sku',l.data->>'sku','title',coalesce(nullif(l.data->>'description',''),l.data->>'sku'),'qty',(l.data->>'quantity')::numeric,'quantity',(l.data->>'quantity')::numeric,'price',coalesce((l.data->>'unitPrice')::numeric,case when (l.data->>'quantity')::numeric<>0 then (l.data->>'salesMinor')::numeric/100/(l.data->>'quantity')::numeric else 0 end),'unitCost',case when l.data->>'unitCost' is null then null else (l.data->>'unitCost')::numeric end,'cost',case when l.data->>'unitCost' is null then null else (l.data->>'unitCost')::numeric end,'supplier',l.data->>'vendor','vendor',l.data->>'vendor','uom',l.data->>'uom','lineId',l.line_id) order by l.id) as items
        from candidate_orders c join workspace_imported_order_lines l on l.tenant_id=c.tenant_id and l.company_id=c.company_id and l.source=c.source and l.order_id=c.order_id and l.active
        join workspace_order_imports i on i.tenant_id=l.tenant_id and i.company_id=l.company_id and i.id=l.batch_id
        group by l.source,l.order_id
      ) select *,count(*) over()::int as total_count from grouped ${groupedFilter} order by ${sort} limit ${limitParam} offset ${offsetParam}`,args);
      const rows=result.rows,total=rows.length?Number(rows[0].total_count):0;
      const orders=rows.map(row=>{
        const items=Array.isArray(row.items)?row.items:[],salesMinor=Number(row.sales_minor || 0),productSalesMinor=Number(row.product_sales_minor || 0),shippingMinor=Number(row.shipping_minor || 0),costMinor=row.cost_minor===null?null:Number(row.cost_minor);
        const hash=crypto.createHash('sha256').update(`${scope.tenantId}\0${scope.companyId}\0${row.source}\0${row.order_id}`).digest('hex').slice(0,24);
        return {
          id:`reporting:${hash}`,orderNumber:row.order_id,marketplaceOrderNumber:row.order_id,reference:row.reference || '',orderDate:row.order_date,orderAt:row.order_date,createdAt:row.order_date,updatedAt:row.imported_at,
          buyer:row.customer || '',customerName:row.customer || '',status:row.status || 'Unspecified',channelSource:row.report_channel,source:row.source,importSource:row.source,salesChannel:row.report_channel,
          subtotal:productSalesMinor/100,total:salesMinor/100,shippingPaid:shippingMinor/100,shippingCollected:shippingMinor/100,productCost:costMinor===null?null:costMinor/100,estimatedProfit:costMinor===null?null:(salesMinor-costMinor)/100,
          items,financialStatus:'Historical',paymentStatus:'Historical',fulfillmentStatus:'Reporting only',deliveryStatus:'Not managed',shippingAddress:{},shipments:[],payments:[],purchaseOrderIds:[],purchaseOrderNumbers:[],workflowExceptions:[],
          reportingOnly:true,inventoryAllocation:false,operationalActions:false,readOnly:true,recordType:'reporting'
        };
      });
      return {orders,total,offset,limit};
    },
    async salesReport(user,scope,input={}){
      await init();await access(pool(),user,scope);
      const value=name=>String(typeof input?.get==='function' ? input.get(name) || '' : input?.[name] || '').trim();
      const from=value('from'),to=value('to'),channel=value('channel'),costScope=value('costScope') || 'all';
      for(const date of [from,to])if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail('Invalid reporting date.');
      if(from&&to&&from>to)fail('From date must be before To date.');
      if(!['all','complete','missing'].includes(costScope))fail('Choose a valid cost-data filter.');
      const result=await pool().query(`with filtered_lines as materialized (
        select l.source,l.order_id,l.line_id,l.data,${reportChannelSql()} as report_channel,${customerSql()} as canonical_customer
        from workspace_imported_order_lines l
        where l.tenant_id=$1 and l.company_id=$2 and l.active
          and ($3='' or l.data->>'date'>=$3) and ($4='' or l.data->>'date'<=$4)
          and ($5='' or lower(${reportChannelSql()})=lower($5))
      ), order_rollup as materialized (
        select source,report_channel,order_id,min(data->>'date') as sales_at,min(canonical_customer) as buyer,
          case when count(distinct nullif(data->>'status',''))>1 then 'Mixed' else min(coalesce(nullif(data->>'status',''),'Unspecified')) end as status,
          sum((data->>'salesMinor')::numeric) as product_sales_minor,
          sum(distinct coalesce((data->>'shippingMinor')::numeric,0)) as shipping_minor,
          sum((data->>'salesMinor')::numeric)+sum(distinct coalesce((data->>'shippingMinor')::numeric,0)) as sales_minor,
          sum(coalesce((data->>'costMinor')::numeric,0)) as known_cost_minor,
          bool_or(data->>'costMinor' is null) as missing_product_cost,
          sum((data->>'quantity')::numeric) as units,
          bool_or(lower(coalesce(data->>'status','')) in ('cancelled','canceled','void','voided')) as excluded
        from filtered_lines group by source,report_channel,order_id
      ), filtered_orders as materialized (
        select * from order_rollup where not excluded
          and ($6='all' or ($6='complete' and not missing_product_cost) or ($6='missing' and missing_product_cost))
      ), report_lines as materialized (
        select l.source,l.order_id,l.line_id,l.data,o.sales_at,o.buyer,o.status,o.report_channel
        from filtered_lines l join filtered_orders o using(source,order_id)
      )
      select jsonb_build_object(
        'summary',(select jsonb_build_object(
          'order_count',count(*)::int,
          'gross_sales',coalesce(sum(sales_minor),0)/100.0,
          'refunds',0,
          'net_sales',coalesce(sum(sales_minor),0)/100.0,
          'customer_shipping_collected',coalesce(sum(shipping_minor),0)/100.0,
          'product_cost',coalesce(sum(known_cost_minor),0)/100.0,
          'shipping_cost',0,
          'shipping_cost_adjustments',0,
          'marketplace_fees',0,
          'estimated_costs',coalesce(sum(known_cost_minor),0)/100.0,
          'estimated_profit',(coalesce(sum(sales_minor),0)-coalesce(sum(known_cost_minor),0))/100.0,
          'units',coalesce(sum(units),0),
          'refunded_order_count',0,
          'cost_covered_order_count',count(*) filter(where not missing_product_cost)::int,
          'missing_cost_order_count',count(*) filter(where missing_product_cost)::int,
          'missing_product_cost_order_count',count(*) filter(where missing_product_cost)::int,
          'missing_label_cost_order_count',0
        ) from filtered_orders),
        'daily',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.date) from (
          select sales_at as date,count(*)::int as order_count,sum(sales_minor)/100.0 as gross_sales,0::numeric as refunds,
            sum(sales_minor)/100.0 as net_sales,sum(shipping_minor)/100.0 as customer_shipping_collected,
            sum(known_cost_minor)/100.0 as product_cost,0::numeric as shipping_cost,0::numeric as marketplace_fees,
            (sum(sales_minor)-sum(known_cost_minor))/100.0 as estimated_profit,sum(units) as units
          from filtered_orders group by sales_at
        ) rows),'[]'::jsonb),
        'monthly',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.month) from (
          select left(sales_at,7)||'-01' as month,count(*)::int as order_count,sum(sales_minor)/100.0 as gross_sales,0::numeric as refunds,
            sum(sales_minor)/100.0 as net_sales,sum(shipping_minor)/100.0 as customer_shipping_collected,
            sum(known_cost_minor)/100.0 as product_cost,0::numeric as shipping_cost,0::numeric as marketplace_fees,
            (sum(sales_minor)-sum(known_cost_minor))/100.0 as estimated_profit,sum(units) as units
          from filtered_orders group by left(sales_at,7)
        ) rows),'[]'::jsonb),
        'channels',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.net_sales desc,rows.channel) from (
          select report_channel as channel,count(*)::int as order_count,sum(sales_minor)/100.0 as gross_sales,0::numeric as refunds,
            sum(sales_minor)/100.0 as net_sales,sum(shipping_minor)/100.0 as customer_shipping_collected,
            sum(known_cost_minor)/100.0 as product_cost,0::numeric as shipping_cost,0::numeric as marketplace_fees,
            (sum(sales_minor)-sum(known_cost_minor))/100.0 as estimated_profit,sum(units) as units
          from filtered_orders group by report_channel
        ) rows),'[]'::jsonb),
        'brands','[]'::jsonb,
        'products',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.product_sales desc,rows.sku) from (
          select data->>'sku' as sku,min(coalesce(nullif(data->>'description',''),data->>'sku')) as title,
            'Not provided'::text as brand,min(nullif(data->>'vendor','')) as supplier,
            count(distinct (source,order_id))::int as order_count,sum((data->>'quantity')::numeric) as units,
            sum((data->>'salesMinor')::numeric)/100.0 as product_sales,
            sum(coalesce((data->>'costMinor')::numeric,0))/100.0 as estimated_product_cost,
            (sum((data->>'salesMinor')::numeric)-sum(coalesce((data->>'costMinor')::numeric,0)))/100.0 as estimated_product_profit
          from report_lines group by data->>'sku' order by product_sales desc limit 250
        ) rows),'[]'::jsonb),
        'customers',coalesce((select jsonb_agg(to_jsonb(rows) order by rows.net_sales desc,rows.customer) from (
          select coalesce(nullif(buyer,''),'Unknown customer') as customer,count(*)::int as order_count,
            sum(sales_minor)/100.0 as net_sales,(sum(sales_minor)/100.0)/nullif(count(*),0) as average_order_value,max(sales_at) as last_order_at
          from filtered_orders group by coalesce(nullif(buyer,''),'Unknown customer') order by net_sales desc limit 250
        ) rows),'[]'::jsonb),
        'paymentStatuses',coalesce((select jsonb_agg(to_jsonb(rows)) from (
          select 'Historical import'::text as payment_status,count(*)::int as order_count,sum(sales_minor)/100.0 as net_sales from filtered_orders
        ) rows where rows.order_count>0),'[]'::jsonb)
      ) as payload`,[scope.tenantId,scope.companyId,from,to,channel,costScope]);
      const payload=result.rows[0]?.payload || {},summary=payload.summary || {};
      const orderCount=Number(summary.order_count || 0),netSales=Number(summary.net_sales || 0),estimatedProfit=Number(summary.estimated_profit || 0);
      return {
        generatedAt:new Date().toISOString(),range:{from,to,channel:channel || 'all',costScope},scope:'company',reportingOnly:true,
        summary:{...summary,average_order_value:orderCount?netSales/orderCount:0,estimated_margin:netSales?estimatedProfit/netSales:0,cost_coverage:orderCount?Number(summary.cost_covered_order_count || 0)/orderCount:0},
        daily:payload.daily || [],monthly:payload.monthly || [],channels:payload.channels || [],brands:payload.brands || [],products:payload.products || [],customers:payload.customers || [],paymentStatuses:payload.paymentStatuses || []
      };
    },
    async salesReportOrders(user,scope,input={}){
      await init();await access(pool(),user,scope);
      const value=name=>String(typeof input?.get==='function' ? input.get(name) || '' : input?.[name] || '').trim();
      const from=value('from'),to=value('to'),channel=value('channel'),costScope=value('costScope') || 'all',page=Number(value('page') || 1);
      for(const date of [from,to])if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail('Invalid reporting date.');
      if(from&&to&&from>to)fail('From date must be before To date.');
      if(!['all','complete','missing'].includes(costScope))fail('Choose a valid cost-data filter.');
      if(!Number.isSafeInteger(page)||page<1||page>100000)fail('Invalid page.');
      const result=await pool().query(`with order_rollup as (
        select l.source,${reportChannelSql()} as report_channel,l.order_id,min(l.data->>'date') as sales_at,min(${customerSql()}) as buyer,
          case when count(distinct nullif(l.data->>'status',''))>1 then 'Mixed' else min(coalesce(nullif(l.data->>'status',''),'Unspecified')) end as status,
          sum((l.data->>'salesMinor')::numeric) as product_sales_minor,
          sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as shipping_minor,
          sum((l.data->>'salesMinor')::numeric)+sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as sales_minor,
          sum(coalesce((l.data->>'costMinor')::numeric,0)) as known_cost_minor,
          bool_or(l.data->>'costMinor' is null) as missing_product_cost,
          bool_or(lower(coalesce(l.data->>'status','')) in ('cancelled','canceled','void','voided')) as excluded
        from workspace_imported_order_lines l
        where l.tenant_id=$1 and l.company_id=$2 and l.active
          and ($3='' or l.data->>'date'>=$3) and ($4='' or l.data->>'date'<=$4)
          and ($5='' or lower(${reportChannelSql()})=lower($5))
        group by l.source,${reportChannelSql()},l.order_id
      ), filtered as (
        select * from order_rollup where not excluded
          and ($6='all' or ($6='complete' and not missing_product_cost) or ($6='missing' and missing_product_cost))
      ) select md5(source||chr(31)||order_id) as order_id,order_id as order_number,order_id as marketplace_order_id,
        source,report_channel as channel_source,coalesce(buyer,'') as buyer,sales_at,status,sales_minor/100.0 as net_sales,
        product_sales_minor/100.0 as product_sales,shipping_minor/100.0 as customer_shipping_collected,
        known_cost_minor/100.0 as product_cost,0::numeric as shipping_cost,0::numeric as marketplace_fees,
        (sales_minor-known_cost_minor)/100.0 as estimated_profit,
        case when missing_product_cost then 'missing_product_cost' else 'complete' end as cost_status,
        missing_product_cost,false as missing_label_cost,true as reporting_only,true as read_only,
        count(*) over()::int as total_count
      from filtered order by sales_at desc nulls last,report_channel,order_number desc limit 50 offset $7`,
      [scope.tenantId,scope.companyId,from,to,channel,costScope,(page-1)*50]);
      return {rows:result.rows,total:result.rows.length?Number(result.rows[0].total_count):0,page,pageSize:50,reportingOnly:true};
    },
    async customers(user,scope){
      await init();await access(pool(),user,scope);
      const result=await pool().query(`with orders as (
        select l.source,l.order_id,min(${customerSql()}) as customer,min(${reportChannelSql()}) as report_channel,
          min(l.data->>'date') as order_date,
          sum((l.data->>'salesMinor')::numeric)+sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as sales_minor
        from workspace_imported_order_lines l
        where l.tenant_id=$1 and l.company_id=$2 and l.active
          and lower(${reportChannelSql()})='buysupply b2b'
          and lower(coalesce(l.data->>'status','')) not in ('cancelled','canceled','void','voided')
        group by l.source,l.order_id
      ) select customer,count(*)::int as order_count,coalesce(sum(sales_minor),0)/100.0 as lifetime_value,
          min(order_date) as first_order_at,max(order_date) as last_order_at,
          jsonb_agg(distinct report_channel) as channels
        from orders group by customer order by lower(customer)`,[scope.tenantId,scope.companyId]);
      return result.rows.map(row=>({customer:row.customer,orderCount:Number(row.order_count || 0),lifetimeValue:Number(row.lifetime_value || 0),firstOrderAt:row.first_order_at || '',lastOrderAt:row.last_order_at || '',channels:row.channels || [],reportingOnly:true,readOnly:false}));
    },
    async report(user,scope,query){
      await init();await access(pool(),user,scope);
      const page=Number(query.get('page') || 1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail('Invalid page.');
      const status=(query.get('status') || '').slice(0,100),source=(query.get('source') || '').slice(0,100);
      const from=query.get('from') || '',to=query.get('to') || '';
      for(const date of [from,to])if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail('Invalid reporting date.');
      if(from&&to&&from>to)fail('From date must be before To date.');
      const where=`l.tenant_id=$1 and l.company_id=$2 and l.active and ($3='' or l.data->>'status'=$3) and ($4='' or lower(${reportChannelSql()})=lower($4)) and ($5='' or l.data->>'date'>=$5) and ($6='' or l.data->>'date'<=$6)`;
      const args=[scope.tenantId,scope.companyId,status,source,from,to];
      const summary=(await pool().query(`with filtered as materialized (
        select l.* from workspace_imported_order_lines l where ${where}
      ), line_summary as (
        select count(*)::int as lines,count(distinct (source,order_id))::int as orders,
          coalesce(sum((data->>'salesMinor')::numeric),0) as product_sales_minor,
          coalesce(sum((data->>'costMinor')::numeric),0) as known_cost_minor,
          count(*) filter(where data->>'costMinor' is null)::int as missing_cost_lines,
          coalesce(sum((data->>'salesMinor')::numeric-(data->>'costMinor')::numeric) filter(where data->>'costMinor' is not null),0) as known_profit_minor
        from filtered
      ), shipping_summary as (
        select coalesce(sum(shipping_minor),0) as shipping_minor from (
          select source,order_id,sum(distinct coalesce((data->>'shippingMinor')::numeric,0)) as shipping_minor
          from filtered group by source,order_id
        ) orders
      ) select line_summary.*,shipping_summary.shipping_minor,
        line_summary.product_sales_minor+shipping_summary.shipping_minor as sales_minor
      from line_summary cross join shipping_summary`,args)).rows[0];
      const rows=(await pool().query(`select l.source,min(${reportChannelSql()}) as channel,l.order_id,min(l.data->>'date') as date,min(${customerSql()}) as customer,string_agg(distinct l.data->>'status',', ') as status,count(*)::int as lines,
        sum((l.data->>'salesMinor')::numeric) as product_sales_minor,
        sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as shipping_minor,
        sum((l.data->>'salesMinor')::numeric)+sum(distinct coalesce((l.data->>'shippingMinor')::numeric,0)) as sales_minor,
        case when count(*) filter(where l.data->>'costMinor' is null)>0 then null else sum((l.data->>'costMinor')::numeric) end as cost_minor
        from workspace_imported_order_lines l where ${where} group by l.source,l.order_id order by min(l.data->>'date') desc,min(${reportChannelSql()}),l.order_id limit 26 offset $7`,[...args,(page-1)*25])).rows;
      return {summary,rows:rows.slice(0,25),hasMore:rows.length>25,page};
    }
  };
}
module.exports={schema,createOrderImporter};
