const {parseUpload,normalize,fields}=require('./manual-order-import');
const crypto=require('node:crypto');
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
alter table workspace_order_imports add column if not exists channel_id text;
`;
function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function createOrderImporter({pool,init,transaction,access,audit,existingChannels=async()=>[]}) {
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
  async function classify(client,scope,source,lines) {
    const existing=(await client.query('select order_id,line_id,data from workspace_imported_order_lines where tenant_id=$1 and company_id=$2 and source=$3 and active and order_id=any($4::text[])',[scope.tenantId,scope.companyId,source,[...new Set(lines.map(l=>l.orderId))]])).rows;
    const found=new Map(existing.map(l=>[JSON.stringify([l.order_id,l.line_id]),l.data.fingerprint]));
    const fresh=[],conflicts=[];let duplicates=0;
    for(const line of lines){const old=found.get(JSON.stringify([line.orderId,line.lineId]));if(!old)fresh.push(line);else if(old===line.fingerprint)duplicates++;else conflicts.push({row:line.sourceRow,level:'error',message:`Order ${line.orderId}, line ${line.lineId} already exists with different values. Review and roll back its original batch before replacing it.`});}
    return {fresh,conflicts,duplicates};
  }
  function previewResult(row){const p=row.payload;return {id:row.id,templateName:p.template?.name,channelId:row.channel_id,channelName:p.channelName || row.source,status:row.status,previewToken:p.previewToken,filename:row.filename,source:row.source,headers:p.parsed.headers,sheet:p.parsed.sheet,sheets:p.parsed.sheets,mapping:p.mapping || p.parsed.suggested,fields:Object.keys(fields),sample:p.parsed.rows.slice(0,5),summary:row.summary,issues:[...(p.issues || [])].sort((a,b)=>(a.level==='error'?0:1)-(b.level==='error'?0:1)).slice(0,100),lines:(p.lines || []).slice(0,10)};}
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
        await access(client,user,scope,true);
        const selected=await channel(client,scope,input.channelId),source=selected.source_key;
        let template=null;
        if(input.templateId) {
          template=(await client.query('select id,name,channel_id,mapping,updated_at from workspace_order_import_templates where tenant_id=$1 and company_id=$2 and id=$3 for share',[scope.tenantId,scope.companyId,input.templateId])).rows[0];
          if(!template)fail('Template not found in this company.',404);
          if(template.channel_id!==selected.id)fail('This template belongs to a different channel. Select the matching channel.',409);
        }
        const row=(await client.query('insert into workspace_order_imports(tenant_id,company_id,source,filename,file_hash,payload,created_by,channel_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[scope.tenantId,scope.companyId,source,String(input.filename).slice(0,240),parsed.hash,JSON.stringify({parsed,channelName:selected.name,...(template?{mapping:template.mapping,template}:{})}),user.id,selected.id])).rows[0];
        await audit(client,scope,user,'manual_order_file_uploaded',{batchId:row.id,filename:row.filename,source});return previewResult(row);
      });
    },
    async preview(user,scope,input){return transaction(async client=>{
      await access(client,user,scope,true);const row=await batch(client,scope,input.batchId);
      await channel(client,scope,row.channel_id);
      if(!['uploaded','preview'].includes(row.status))fail('Only an unapplied batch can be previewed.',409);
      const result=normalize(row.payload.parsed,input.mapping || {});
      const classified=await classify(client,scope,row.source,result.lines);
      result.issues.push(...classified.conflicts);result.summary.errors+=classified.conflicts.length;
      Object.assign(result.summary,{newLines:classified.fresh.length,duplicateLines:classified.duplicates});
      row.payload={...row.payload,mapping:input.mapping,lines:result.lines,issues:result.issues};row.summary=result.summary;row.status='preview';
      row.payload.previewToken=crypto.createHash('sha256').update(JSON.stringify([result.lines,result.summary,input.mapping])).digest('hex');
      await client.query("update workspace_order_imports set payload=$4,summary=$5,status='preview' where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,row.id,JSON.stringify(row.payload),JSON.stringify(row.summary)]);
      return previewResult(row);
    });},
    async apply(user,scope,input){return transaction(async client=>{
      await access(client,user,scope,true);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(scope)]);
      const row=await batch(client,scope,input.batchId);
      if(row.status==='applied')return {id:row.id,status:row.status,summary:row.summary};
      await channel(client,scope,row.channel_id);
      if(row.status!=='preview' || row.summary.errors || input.confirm!==true)fail('Preview and resolve all errors before confirming this import.',409);
      if(input.previewToken!==row.payload.previewToken)fail('The preview changed. Review the latest preview before importing.',409);
      const classified=await classify(client,scope,row.source,row.payload.lines);
      if(classified.conflicts.length)fail('Existing orders changed after preview. Preview this batch again.',409);
      for(let offset=0;offset<classified.fresh.length;offset+=500){
        await client.query(`insert into workspace_imported_order_lines(tenant_id,company_id,source,order_id,line_id,batch_id,data)
          select $1,$2,$3,x->>'orderId',x->>'lineId',$4,x from jsonb_array_elements($5::jsonb) x`,[scope.tenantId,scope.companyId,row.source,row.id,JSON.stringify(classified.fresh.slice(offset,offset+500))]);
      }
      const summary={...row.summary,insertedLines:classified.fresh.length,duplicateLines:classified.duplicates};
      await client.query("update workspace_order_imports set status='applied',summary=$4,applied_at=now() where tenant_id=$1 and company_id=$2 and id=$3",[scope.tenantId,scope.companyId,row.id,JSON.stringify(summary)]);
      await audit(client,scope,user,'manual_orders_imported',{batchId:row.id,source:row.source,...summary});return {id:row.id,status:'applied',summary};
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
    async history(user,scope){await init();await access(pool(),user,scope);return {rows:(await pool().query('select id,source,filename,status,summary,created_at,applied_at,rolled_back_at from workspace_order_imports where tenant_id=$1 and company_id=$2 order by id desc limit 100',[scope.tenantId,scope.companyId])).rows};},
    async detail(user,scope,id){return transaction(async client=>{await access(client,user,scope);return previewResult(await batch(client,scope,id));});},
    async orderLines(user,scope,query){
      await init();await access(pool(),user,scope);
      return {rows:(await pool().query('select batch_id,data from workspace_imported_order_lines where tenant_id=$1 and company_id=$2 and source=$3 and order_id=$4 and active order by line_id limit 10001',[scope.tenantId,scope.companyId,query.get('source') || '',query.get('orderId') || ''])).rows};
    },
    async report(user,scope,query){
      await init();await access(pool(),user,scope);
      const page=Number(query.get('page') || 1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail('Invalid page.');
      const status=(query.get('status') || '').slice(0,100),source=(query.get('source') || '').slice(0,100);
      const from=query.get('from') || '',to=query.get('to') || '';
      for(const date of [from,to])if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail('Invalid reporting date.');
      if(from&&to&&from>to)fail('From date must be before To date.');
      const where="tenant_id=$1 and company_id=$2 and active and ($3='' or data->>'status'=$3) and ($4='' or source=$4) and ($5='' or data->>'date'>=$5) and ($6='' or data->>'date'<=$6)";
      const args=[scope.tenantId,scope.companyId,status,source,from,to];
      const summary=(await pool().query(`select count(*)::int as lines,count(distinct (source,order_id))::int as orders,coalesce(sum((data->>'salesMinor')::numeric),0) as sales_minor,coalesce(sum((data->>'costMinor')::numeric),0) as known_cost_minor,count(*) filter(where data->>'costMinor' is null)::int as missing_cost_lines,coalesce(sum((data->>'salesMinor')::numeric-(data->>'costMinor')::numeric) filter(where data->>'costMinor' is not null),0) as known_profit_minor from workspace_imported_order_lines where ${where}`,args)).rows[0];
      const rows=(await pool().query(`select source,order_id,min(data->>'date') as date,min(data->>'customer') as customer,string_agg(distinct data->>'status',', ') as status,count(*)::int as lines,sum((data->>'salesMinor')::numeric) as sales_minor,case when count(*) filter(where data->>'costMinor' is null)>0 then null else sum((data->>'costMinor')::numeric) end as cost_minor from workspace_imported_order_lines where ${where} group by source,order_id order by min(data->>'date') desc,source,order_id limit 26 offset $7`,[...args,(page-1)*25])).rows;
      return {summary,rows:rows.slice(0,25),hasMore:rows.length>25,page};
    }
  };
}
module.exports={schema,createOrderImporter};
