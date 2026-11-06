const crypto = require('node:crypto');
const { schema: orderImportSchema, createOrderImporter } = require('./manual-order-store');
const { LEGACY_COMPANY_NUMBER } = require('./order-identity');
const { seal, unseal } = require('./encrypted-credentials');

const LEGACY_TENANT = 'organization-default';
const LEGACY_COMPANY = 'linq-usa';
const OPERATIONAL_RECORD_VERSION = 1;
const OPERATIONAL_RECORD_FIELDS = ['orders', 'orderDrafts', 'returns', 'customers'];
const BUYSUPPLY_PUBLIC_PROFILE = Object.freeze({
  displayName: 'BuySupply',
  legalName: 'Buy Supply, Corp.',
  website: 'https://www.buysupply.com',
  email: 'support@buysupply.com',
  phone: '646-213-2345',
  tagline: 'Business procurement for fleet, facility, and workplace supplies - sourced direct with quote support for bulk orders.',
  businessHours: 'Monday-Thursday 9:30 AM-5:00 PM ET; Friday 9:30 AM-4:30 PM ET',
  address: { line1: '388 South Avenue', line2: '', city: 'Staten Island', state: 'NY', postalCode: '10303', country: 'US' },
  source: {
    contactUrl: 'https://www.buysupply.com/contact',
    termsUrl: 'https://www.buysupply.com/terms',
    shippingReturnsUrl: 'https://www.buysupply.com/shipping-returns',
    verifiedAt: '2026-11-06'
  }
});
function fail(message, status = 400) { throw Object.assign(new Error(message), { status, statusCode: status }); }
function text(value, label, max = 200, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`Enter a valid ${label}.`);
  return value.trim();
}
function money(value, label = 'Cost') {
  if (value === null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,6})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) > 1e9) fail(`${label} must be a nonnegative number with at most six decimal places.`);
  return String(value);
}
function optionalText(value, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > max) fail(`Enter a valid ${label}.`);
  return value.trim();
}
function optionalUrl(value, label) {
  const result=optionalText(value,label,500);
  if(!result)return '';
  let parsed;
  try { parsed=new URL(result); } catch { fail(`Enter a valid ${label}.`); }
  if(!['http:','https:'].includes(parsed.protocol))fail(`Enter a valid ${label}.`);
  return parsed.toString().replace(/\/$/,'');
}
function normalizeCompanyProfile(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))fail('Enter valid company profile details.');
  const address=input.address;
  if(address!==undefined && (!address || typeof address!=='object' || Array.isArray(address)))fail('Enter a valid company address.');
  const email=optionalText(input.email,'company email',240);
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid company email.');
  return {
    displayName:optionalText(input.displayName,'display name',160),
    legalName:optionalText(input.legalName,'legal name',200),
    website:optionalUrl(input.website,'website'),
    email,
    phone:optionalText(input.phone,'phone number',80),
    tagline:optionalText(input.tagline,'tagline',500),
    businessHours:optionalText(input.businessHours,'business hours',500),
    address:{
      line1:optionalText(address?.line1,'address line 1',240),
      line2:optionalText(address?.line2,'address line 2',240),
      city:optionalText(address?.city,'city',120),
      state:optionalText(address?.state,'state',120),
      postalCode:optionalText(address?.postalCode,'postal code',40),
      country:optionalText(address?.country,'country',80)
    }
  };
}

// New company data never passes through the legacy global app_state or workers.
function createCompanyStore(getPool, { readLegacyChannels = async () => [], credentialEnv = process.env } = {}) {
  async function existingChannels(scope) {
    if(scope.tenantId!==LEGACY_TENANT || scope.companyId!==LEGACY_COMPANY)return [];
    return (await readLegacyChannels()).filter(c=>c.id && c.name).map(c=>({id:`api:${c.id}`,name:String(c.name),source_key:`api:${c.id}`,enabled:c.enabled===true,kind:"connected"}));
  }
  let ready;
  const pool = () => getPool() || fail('Company workspaces require PostgreSQL.', 503);
  async function init() {
    if (!ready) ready = pool().query(`
      select pg_advisory_xact_lock(8250925);
      create sequence if not exists workspace_company_number_seq start with 102;
      create table if not exists workspace_tenants (
        id text primary key, name text not null, created_at timestamptz not null default now()
      );
      create table if not exists workspace_companies (
        tenant_id text not null references workspace_tenants(id), id text not null,
        company_number bigint not null default nextval('workspace_company_number_seq'),
        name text not null, mode text not null check(mode in ('legacy','reporting')),
        currency text not null default 'USD', profile jsonb not null default '{}', created_at timestamptz not null default now(),
        primary key(tenant_id,id), unique(tenant_id,name)
      );
      alter table workspace_companies add column if not exists profile jsonb;
      update workspace_companies set profile='{}'::jsonb where profile is null;
      alter table workspace_companies alter column profile set default '{}';
      alter table workspace_companies alter column profile set not null;
      update workspace_companies set profile=$profile$${JSON.stringify(BUYSUPPLY_PUBLIC_PROFILE)}$profile$::jsonb || profile
        where tenant_id='${LEGACY_TENANT}' and id='buysupply';
      alter table workspace_companies add column if not exists company_number bigint;
      alter table workspace_companies alter column company_number set default nextval('workspace_company_number_seq');
      update workspace_companies set company_number=${LEGACY_COMPANY_NUMBER}
        where tenant_id='${LEGACY_TENANT}' and id='${LEGACY_COMPANY}' and company_number is distinct from ${LEGACY_COMPANY_NUMBER};
      update workspace_companies set company_number=101
        where tenant_id='${LEGACY_TENANT}' and id='buysupply' and company_number is null;
      update workspace_companies set company_number=nextval('workspace_company_number_seq') where company_number is null;
      select setval('workspace_company_number_seq', greatest(coalesce((select max(company_number) from workspace_companies), 101), 101), true);
      alter table workspace_companies alter column company_number set not null;
      create unique index if not exists workspace_companies_company_number_idx on workspace_companies(company_number);
      create table if not exists workspace_memberships (
        tenant_id text not null references workspace_tenants(id), user_id text not null,
        role text not null check(role in ('owner','member')), company_ids jsonb not null default '[]',
        primary key(tenant_id,user_id)
      );
      create table if not exists workspace_catalog_links (
        tenant_id text primary key references workspace_tenants(id), source_company_id text not null,
        foreign key(tenant_id,source_company_id) references workspace_companies(tenant_id,id)
      );
      create table if not exists workspace_company_products (
        tenant_id text not null, company_id text not null, product_id text not null,
        sku text not null, selling_status text not null default 'draft', sell_price numeric,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by text,
        primary key(tenant_id,company_id,product_id), unique(tenant_id,company_id,sku),
        constraint workspace_company_products_status_check check(selling_status in ('draft','active','inactive')),
        constraint workspace_company_products_sell_price_check check(sell_price is null or sell_price >= 0),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      alter table workspace_company_products add column if not exists selling_status text not null default 'draft';
      alter table workspace_company_products add column if not exists sell_price numeric;
      alter table workspace_company_products add column if not exists updated_at timestamptz not null default now();
      alter table workspace_company_products add column if not exists updated_by text;
      do $$ begin
        if not exists(select 1 from pg_constraint where conname='workspace_company_products_status_check' and connamespace=current_schema()::regnamespace) then
          alter table workspace_company_products add constraint workspace_company_products_status_check check(selling_status in ('draft','active','inactive'));
        end if;
        if not exists(select 1 from pg_constraint where conname='workspace_company_products_sell_price_check' and connamespace=current_schema()::regnamespace) then
          alter table workspace_company_products add constraint workspace_company_products_sell_price_check check(sell_price is null or sell_price >= 0);
        end if;
      end $$;
      create table if not exists workspace_vendor_accounts (
        tenant_id text not null, company_id text not null, id text not null,
        supplier_name text not null, account_reference text not null,
        primary key(tenant_id,company_id,id),
        unique(tenant_id,company_id,supplier_name,account_reference),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      create table if not exists workspace_product_costs (
        tenant_id text not null, company_id text not null, product_id text not null,
        vendor_account_id text not null, unit_cost numeric, uom text not null,
        updated_at timestamptz not null default now(), updated_by text not null,
        primary key(tenant_id,company_id,product_id,vendor_account_id),
        check(unit_cost is null or unit_cost >= 0),
        foreign key(tenant_id,company_id,product_id) references workspace_company_products(tenant_id,company_id,product_id),
        foreign key(tenant_id,company_id,vendor_account_id) references workspace_vendor_accounts(tenant_id,company_id,id)
      );
      create table if not exists workspace_activity (
        id bigserial primary key, tenant_id text not null references workspace_tenants(id),
        company_id text, actor_id text not null, action text not null,
        detail jsonb not null, created_at timestamptz not null default now(),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      create table if not exists workspace_manual_channels (
        tenant_id text not null, company_id text not null, id text not null,
        name text not null, source_key text not null, enabled boolean not null default true,
        created_at timestamptz not null default now(), primary key(tenant_id,company_id,id),
        unique(tenant_id,company_id,source_key),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      ${orderImportSchema}
      insert into workspace_manual_channels(tenant_id,company_id,id,name,source_key)
        select distinct tenant_id,company_id,'existing-'||md5(source),source,source from workspace_order_imports where channel_id is null
        on conflict(tenant_id,company_id,source_key) do nothing;
      update workspace_order_imports i set channel_id=c.id from workspace_manual_channels c
        where i.channel_id is null and i.tenant_id=c.tenant_id and i.company_id=c.company_id and i.source=c.source_key;
      create table if not exists workspace_operational_state (
        tenant_id text not null, company_id text not null, data jsonb not null default '{}',
        updated_at timestamptz not null default now(), primary key(tenant_id,company_id),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      create table if not exists workspace_company_records (
        tenant_id text not null, company_id text not null, record_type text not null,
        record_id text not null, record_number text not null default '', status text not null default '',
        position integer not null default 0, data jsonb not null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(tenant_id,company_id,record_type,record_id),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
      alter table workspace_company_records add column if not exists position integer not null default 0;
      create unique index if not exists workspace_company_records_number_idx
        on workspace_company_records(tenant_id,company_id,record_type,lower(record_number)) where record_number <> '';
      create index if not exists workspace_company_records_status_idx
        on workspace_company_records(tenant_id,company_id,record_type,status,updated_at desc);
      create index if not exists workspace_company_records_updated_idx
        on workspace_company_records(tenant_id,company_id,updated_at desc);
      create table if not exists workspace_channel_credentials (
        tenant_id text not null, company_id text not null, channel_id text not null,
        sealed_payload jsonb not null, updated_at timestamptz not null default now(), updated_by text not null,
        primary key(tenant_id,company_id,channel_id),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
    `).catch(error => { ready = null; throw error; });
    await ready;
  }
  async function transaction(work) {
    await init(); const client = await pool().connect();
    try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function audit(client, scope, actor, action, detail) {
    await client.query('insert into workspace_activity(tenant_id,company_id,actor_id,action,detail) values($1,$2,$3,$4,$5)', [scope.tenantId, scope.companyId || null, actor.id, action, JSON.stringify(detail)]);
  }
  async function membership(client, user, tenantId, owner = false) {
    const row = (await client.query('select * from workspace_memberships where tenant_id=$1 and user_id=$2', [tenantId, user.id])).rows[0];
    if (!row || (owner && row.role !== 'owner')) fail('You do not have access to this organization.', 403);
    return row;
  }
  async function access(client, user, scope, owner = false) {
    const member = await membership(client, user, scope.tenantId, owner);
    const company = (await client.query('select * from workspace_companies where tenant_id=$1 and id=$2', [scope.tenantId, scope.companyId])).rows[0];
    if (!company || (member.role !== 'owner' && !member.company_ids.includes(scope.companyId))) fail('You do not have access to this company.', 403);
    return company;
  }
  function operationalRecordId(field, record = {}) {
    let value = record.id || record.orderId || record.returnId || record.customerId;
    if (value === undefined || value === null || value === '') { value=crypto.randomUUID(); record.id=value; }
    if (typeof value !== 'string' || !value.trim() || value.length > 240) fail(`Company ${field} record requires a valid ID.`);
    return value.trim();
  }
  function operationalRecordNumber(field, record = {}) {
    const value = field === 'orderDrafts' ? record.draftNumber
      : field === 'orders' ? (record.orderNumber || record.internalOrderNumber)
        : field === 'returns' ? (record.returnNumber || record.rmaNumber)
          : (record.customerNumber || '');
    return String(value || '').trim().slice(0,240);
  }
  async function relationalOperationalState(client, scope, stored = {}) {
    if (Number(stored._companyRecordsVersion || 0) < OPERATIONAL_RECORD_VERSION) return stored;
    const rows = (await client.query(`select record_type,data from workspace_company_records
      where tenant_id=$1 and company_id=$2 and record_type=any($3::text[])
      order by record_type,position,created_at`, [scope.tenantId,scope.companyId,OPERATIONAL_RECORD_FIELDS])).rows;
    const result={...stored};
    for(const field of OPERATIONAL_RECORD_FIELDS)result[field]=[];
    for(const row of rows)if(OPERATIONAL_RECORD_FIELDS.includes(row.record_type))result[row.record_type].push(row.data);
    return result;
  }
  async function syncOperationalRecords(client, scope, data) {
    for(const field of OPERATIONAL_RECORD_FIELDS) {
      const records=Array.isArray(data[field])?data[field]:[];
      const ids=[],seen=new Set();
      for(let position=0;position<records.length;position+=1) {
        const record=records[position];
        if(!record || typeof record!=='object' || Array.isArray(record))fail(`Company ${field} contains an invalid record.`);
        const id=operationalRecordId(field,record);
        if(seen.has(id))fail(`Company ${field} contains duplicate record ID ${id}.`,409);
        seen.add(id);ids.push(id);
        record.tenantId=scope.tenantId;record.companyId=scope.companyId;
        const number=operationalRecordNumber(field,record),status=String(record.status || '').trim().slice(0,120);
        await client.query(`insert into workspace_company_records(tenant_id,company_id,record_type,record_id,record_number,status,position,data)
          values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(tenant_id,company_id,record_type,record_id) do update set
          record_number=excluded.record_number,status=excluded.status,position=excluded.position,data=excluded.data,updated_at=now()`,
        [scope.tenantId,scope.companyId,field,id,number,status,position,JSON.stringify(record)]);
      }
      if(ids.length)await client.query(`delete from workspace_company_records where tenant_id=$1 and company_id=$2 and record_type=$3 and not(record_id=any($4::text[]))`,[scope.tenantId,scope.companyId,field,ids]);
      else await client.query('delete from workspace_company_records where tenant_id=$1 and company_id=$2 and record_type=$3',[scope.tenantId,scope.companyId,field]);
    }
  }
  async function sharedCatalog(client, tenantId) {
    const link = (await client.query('select * from workspace_catalog_links where tenant_id=$1', [tenantId])).rows[0];
    // Only the migrated organization may use the existing catalog source.
    if (!link || tenantId !== LEGACY_TENANT || link.source_company_id !== LEGACY_COMPANY) fail('This organization has no shared catalog source configured.', 409);
  }
  async function writeCost(client, user, scope, input) {
    const cost=money(input.unitCost), productId=text(input.productId,'product'), account=text(input.vendorAccountId,'vendor account'), uom=text(input.uom,'cost UOM',80);
    // Serialize updates even when the cost row does not exist yet, for accurate before/after history.
    await client.query('select product_id from workspace_company_products where tenant_id=$1 and company_id=$2 and product_id=$3 for update',[scope.tenantId,scope.companyId,productId]);
    const previous=(await client.query('select unit_cost,uom from workspace_product_costs where tenant_id=$1 and company_id=$2 and product_id=$3 and vendor_account_id=$4 for update',[scope.tenantId,scope.companyId,productId,account])).rows[0] || null;
    await client.query('insert into workspace_product_costs values($1,$2,$3,$4,$5,$6,now(),$7) on conflict(tenant_id,company_id,product_id,vendor_account_id) do update set unit_cost=excluded.unit_cost,uom=excluded.uom,updated_at=now(),updated_by=excluded.updated_by',[scope.tenantId,scope.companyId,productId,account,cost,uom,user.id]);
    await audit(client,scope,user,'product_cost_saved',{ productId,vendorAccountId:account,before:previous,after:{ unitCost:cost,uom } });
  }
  return {
    async importChannels(user,scope) {
      await init();await access(pool(),user,scope);
      const manual=(await pool().query("select id,name,source_key,enabled from workspace_manual_channels where tenant_id=$1 and company_id=$2 order by name",[scope.tenantId,scope.companyId])).rows;
      return [...manual.map(c=>({...c,kind:"manual"})),...await existingChannels(scope)];
    },
    async manualChannels(user,scope) {
      await init();await access(pool(),user,scope);
      return (await pool().query('select id,name,source_key,enabled from workspace_manual_channels where tenant_id=$1 and company_id=$2 order by name',[scope.tenantId,scope.companyId])).rows;
    },
    async createManualChannel(user,scope,input) {
      const name=text(input.name,'channel name',100);
      return transaction(async client=>{
        await access(client,user,scope,true);
        const row=(await client.query('insert into workspace_manual_channels(tenant_id,company_id,id,name,source_key) values($1,$2,$3,$4,$5) returning id,name,source_key,enabled',[scope.tenantId,scope.companyId,crypto.randomUUID(),name,name.toLowerCase()])).rows[0];
        await audit(client,scope,user,'manual_channel_created',{channelId:row.id,name});return row;
      });
    },
    async updateManualChannel(user,scope,input) {
      const id=text(input.id,'channel');if(typeof input.enabled!=='boolean')fail('Choose whether the channel is enabled.');
      return transaction(async client=>{
        await access(client,user,scope,true);
        const row=(await client.query('update workspace_manual_channels set enabled=$4 where tenant_id=$1 and company_id=$2 and id=$3 returning id,name,source_key,enabled',[scope.tenantId,scope.companyId,id,input.enabled])).rows[0];
        if(!row)fail('Manual channel not found.',404);
        await audit(client,scope,user,'manual_channel_status_changed',{channelId:id,enabled:input.enabled});return row;
      });
    },
    async operationalState(user, scope) {
      await init(); await access(pool(),user,scope);
      const stored=(await pool().query('select data from workspace_operational_state where tenant_id=$1 and company_id=$2',[scope.tenantId,scope.companyId])).rows[0]?.data || {};
      return relationalOperationalState(pool(),scope,stored);
    },
    async updateOperationalState(user, scope, action, work) {
      return transaction(async client => {
        await access(client,user,scope);
        await client.query('insert into workspace_operational_state(tenant_id,company_id) values($1,$2) on conflict do nothing',[scope.tenantId,scope.companyId]);
        const stored=(await client.query('select data from workspace_operational_state where tenant_id=$1 and company_id=$2 for update',[scope.tenantId,scope.companyId])).rows[0].data;
        const data=await relationalOperationalState(client,scope,stored);
        const result=await work(data);
        await syncOperationalRecords(client,scope,data);
        const document={...data,_companyRecordsVersion:OPERATIONAL_RECORD_VERSION};
        for(const field of OPERATIONAL_RECORD_FIELDS)delete document[field];
        await client.query('update workspace_operational_state set data=$3,updated_at=now() where tenant_id=$1 and company_id=$2',[scope.tenantId,scope.companyId,JSON.stringify(document)]);
        await audit(client,scope,user,action,{recordId:result?.draft?.id || result?.order?.id});
        return result;
      });
    },
    async channelCredentials(user, scope, channelId) {
      await init(); await access(pool(),user,scope);
      const id=text(channelId,'channel',80);
      const row=(await pool().query('select sealed_payload,updated_at from workspace_channel_credentials where tenant_id=$1 and company_id=$2 and channel_id=$3',[scope.tenantId,scope.companyId,id])).rows[0];
      if(!row)return { values:{},updatedAt:'' };
      return { values:unseal(row.sealed_payload,credentialEnv) || {},updatedAt:row.updated_at };
    },
    async saveChannelCredentials(user, scope, channelId, patch) {
      const id=text(channelId,'channel',80);
      if(!patch || typeof patch!=='object' || Array.isArray(patch))fail('Enter valid channel credentials.');
      return transaction(async client=>{
        await access(client,user,scope,true);
        const existing=(await client.query('select sealed_payload from workspace_channel_credentials where tenant_id=$1 and company_id=$2 and channel_id=$3 for update',[scope.tenantId,scope.companyId,id])).rows[0];
        const previous=existing ? (unseal(existing.sealed_payload,credentialEnv) || {}) : {};
        const values={...previous,...patch};
        const envelope=seal(values,credentialEnv);
        const row=(await client.query(`insert into workspace_channel_credentials(tenant_id,company_id,channel_id,sealed_payload,updated_by)
          values($1,$2,$3,$4,$5) on conflict(tenant_id,company_id,channel_id) do update set
          sealed_payload=excluded.sealed_payload,updated_at=now(),updated_by=excluded.updated_by returning updated_at`,
        [scope.tenantId,scope.companyId,id,JSON.stringify(envelope),user.id])).rows[0];
        await audit(client,scope,user,'channel_credentials_saved',{channelId:id,fields:Object.keys(patch).sort()});
        return { values,updatedAt:row.updated_at };
      });
    },
    importer: createOrderImporter({pool,init,transaction,access,audit,existingChannels}),
    init,
    async bootstrap(user, users) {
      if (!user.isMasterAdmin) fail('The existing master administrator must initialize the organization.', 403);
      return transaction(async client => {
        await client.query('select pg_advisory_xact_lock(8250926)');
        const existing = (await client.query('select id from workspace_tenants where id=$1', [LEGACY_TENANT])).rows[0];
        if (existing) return { created: false };
        await client.query('insert into workspace_tenants(id,name) values($1,$2)', [LEGACY_TENANT, 'Your organization']);
        await client.query("insert into workspace_companies(tenant_id,id,company_number,name,mode) values($1,$2,$3,$4,'legacy'),($1,'buysupply',101,'BuySupply','reporting')", [LEGACY_TENANT, LEGACY_COMPANY, LEGACY_COMPANY_NUMBER, 'LINQ USA dba Dealsclick']);
        await client.query('update workspace_companies set profile=$3 where tenant_id=$1 and id=$2',[LEGACY_TENANT,'buysupply',JSON.stringify(BUYSUPPLY_PUBLIC_PROFILE)]);
        for (const member of users) {
          if (!member.id || member.status !== 'active') continue;
          await client.query('insert into workspace_memberships(tenant_id,user_id,role,company_ids) values($1,$2,$3,$4) on conflict do nothing', [LEGACY_TENANT, member.id, member.id === user.id ? 'owner' : 'member', JSON.stringify([LEGACY_COMPANY])]);
        }
        await client.query("insert into workspace_memberships(tenant_id,user_id,role,company_ids) values($1,$2,'owner','[]') on conflict(tenant_id,user_id) do update set role='owner'", [LEGACY_TENANT, user.id]);
        await client.query('insert into workspace_catalog_links values($1,$2)', [LEGACY_TENANT, LEGACY_COMPANY]);
        await audit(client, { tenantId: LEGACY_TENANT }, user, 'organization_initialized', { legacyCompany: LEGACY_COMPANY, reportingCompany: 'buysupply', catalog: 'allowlisted product facts from existing catalog' });
        return { created: true };
      });
    },
    async directory(user) {
      await init();
      const initialized = Boolean((await pool().query('select id from workspace_tenants limit 1')).rows.length);
      const tenants = (await pool().query('select t.*,m.role from workspace_tenants t join workspace_memberships m on m.tenant_id=t.id where m.user_id=$1 order by t.name', [user.id])).rows;
      const companies = (await pool().query("select c.* from workspace_companies c join workspace_memberships m on m.tenant_id=c.tenant_id where m.user_id=$1 and (m.role='owner' or m.company_ids ? c.id) order by c.created_at,c.name", [user.id])).rows;
      return { initialized, canInitialize: Boolean(user.isMasterAdmin), tenants, companies };
    },
    async authorize(user, scope) { await init(); return access(pool(), user, scope); },
    async companyProfile(user, scope) {
      await init();
      const company=await access(pool(),user,scope);
      return company.profile || {};
    },
    async saveCompanyProfile(user, scope, input) {
      const profile=normalizeCompanyProfile(input);
      return transaction(async client=>{
        const company=await access(client,user,scope,true);
        const previous=company.profile || {};
        const saved={...profile,source:previous.source || {}};
        await client.query('update workspace_companies set profile=$3 where tenant_id=$1 and id=$2',[scope.tenantId,scope.companyId,JSON.stringify(saved)]);
        await audit(client,scope,user,'company_profile_saved',{before:previous,after:saved});
        return saved;
      });
    },
    async legacyAccess(user, scope) {
      await init();
      const initialized = (await pool().query('select id from workspace_tenants limit 1')).rows.length;
      if (!initialized && !scope) return;
      const selected = scope || { tenantId: LEGACY_TENANT, companyId: LEGACY_COMPANY };
      await access(pool(), user, selected);
      if (selected.tenantId !== LEGACY_TENANT || selected.companyId !== LEGACY_COMPANY) fail('Open the company workspace. This operation is available only in LINQ until its company migration is complete.', 409);
    },
    async createCompany(user, tenantId, input) {
      const name = text(input.name, 'company name', 160);
      return transaction(async client => {
        await membership(client, user, tenantId, true);
        await client.query('select id from workspace_tenants where id=$1 for update', [tenantId]);
        if ((await client.query('select id from workspace_companies where tenant_id=$1 and lower(name)=lower($2)', [tenantId,name])).rows.length) fail('A company with this name already exists in this organization.',409);
        const companyId = crypto.randomUUID();
        const row = (await client.query("insert into workspace_companies(tenant_id,id,name,mode) values($1,$2,$3,'reporting') returning *", [tenantId, companyId, name])).rows[0];
        await audit(client, { tenantId, companyId }, user, 'company_created', { name }); return row;
      });
    },
    async members(user, tenantId) {
      await init(); await membership(pool(), user, tenantId, true);
      return (await pool().query('select user_id,role,company_ids from workspace_memberships where tenant_id=$1 order by user_id', [tenantId])).rows;
    },
    async saveMember(user, tenantId, input, users) {
      const userId = text(input.userId, 'user');
      if (!users.some(row => row.id === userId && row.status === 'active')) fail('Select an existing active user.');
      if (!Array.isArray(input.companyIds) || input.companyIds.some(id => typeof id !== 'string')) fail('Select company access.');
      return transaction(async client => {
        await membership(client, user, tenantId, true);
        const current = (await client.query('select role from workspace_memberships where tenant_id=$1 and user_id=$2 for update', [tenantId,userId])).rows[0];
        if (current?.role === 'owner') fail('Owner access cannot be changed here.');
        const ids = [...new Set(input.companyIds)];
        const companies = (await client.query('select id from workspace_companies where tenant_id=$1 and id=any($2::text[])', [tenantId, ids])).rows;
        if (companies.length !== ids.length) fail('Company must belong to this organization.');
        await client.query("insert into workspace_memberships values($1,$2,'member',$3) on conflict(tenant_id,user_id) do update set company_ids=excluded.company_ids", [tenantId, userId, JSON.stringify(ids)]);
        await audit(client, { tenantId }, user, 'company_access_changed', { userId, companyIds: ids }); return { saved: true };
      });
    },
    async catalog(user, scope, query = '', page = 1, selected = false) {
      await init(); await access(pool(), user, scope); await sharedCatalog(pool(), scope.tenantId);
      page = Number(page); if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Invalid page.');
      query = String(query).trim().slice(0,120);
      // Never select shared raw, cost, price, supplier, availability, or channel metadata.
      // Company SKU, status, and sell price come only from the active company's overlay.
      const rows = (await pool().query(`select p.product_id,p.sku as source_sku,p.title,p.brand,p.manufacturer,
        p.mfr_part_number,p.barcode,p.main_category,p.default_image,p.uom,
        cp.sku as company_sku, cp.selling_status as company_status, cp.sell_price, (cp.product_id is not null) as selected
        from products p left join workspace_company_products cp
          on cp.tenant_id=$1 and cp.company_id=$2 and cp.product_id=p.product_id
        where ($3='' or p.sku ilike $4 or p.title ilike $4 or p.barcode=$3)
          and ($5::boolean=false or cp.product_id is not null)
        order by p.sku limit 26 offset $6`, [scope.tenantId,scope.companyId,query,`%${query.replace(/[\\%_]/g,'\\$&')}%`,selected,(page-1)*25])).rows;
      return { rows: rows.slice(0,25), page, hasMore: rows.length > 25 };
    },
    async selectProduct(user, scope, input) {
      const productId = text(input.productId, 'product'); const sku = text(input.sku, 'company SKU', 120);
      const status=input.status===undefined?undefined:String(input.status || '').trim().toLowerCase();
      if(status!==undefined && !['draft','active','inactive'].includes(status))fail('Select a valid company product status.');
      const hasSellPrice=Object.prototype.hasOwnProperty.call(input,'sellPrice');
      const sellPrice=hasSellPrice?money(input.sellPrice,'Sell price'):undefined;
      return transaction(async client => {
        await access(client, user, scope, true); await sharedCatalog(client, scope.tenantId);
        if (!(await client.query('select product_id from products where product_id=$1', [productId])).rows.length) fail('Shared product not found.',404);
        const saved=(await client.query(`insert into workspace_company_products(tenant_id,company_id,product_id,sku,selling_status,sell_price,updated_by)
          values($1,$2,$3,$4,$5,$6,$7) on conflict(tenant_id,company_id,product_id) do update set sku=excluded.sku,
          selling_status=case when $8::boolean then excluded.selling_status else workspace_company_products.selling_status end,
          sell_price=case when $9::boolean then excluded.sell_price else workspace_company_products.sell_price end,
          updated_at=now(),updated_by=excluded.updated_by returning sku,selling_status,sell_price`,
        [scope.tenantId,scope.companyId,productId,sku,status || 'draft',sellPrice ?? null,user.id,status!==undefined,hasSellPrice])).rows[0];
        await audit(client, scope, user, 'company_product_saved', { productId,sku:saved.sku,status:saved.selling_status,sellPrice:saved.sell_price });
        if (input.cost !== undefined) await writeCost(client, user, scope, { ...input.cost, productId });
        return { saved: true,product:{productId,sku:saved.sku,status:saved.selling_status,sellPrice:saved.sell_price} };
      });
    },
    async vendorAccounts(user, scope) {
      await init(); await access(pool(),user,scope);
      return (await pool().query('select id,supplier_name,account_reference from workspace_vendor_accounts where tenant_id=$1 and company_id=$2 order by supplier_name', [scope.tenantId,scope.companyId])).rows;
    },
    async createVendorAccount(user, scope, input) {
      const supplier = text(input.supplierName, 'supplier name'); const reference = text(input.accountReference, 'account reference',120);
      return transaction(async client => {
        await access(client,user,scope,true); const id=crypto.randomUUID();
        await client.query('insert into workspace_vendor_accounts values($1,$2,$3,$4,$5)', [scope.tenantId,scope.companyId,id,supplier,reference]);
        await audit(client,scope,user,'vendor_account_created',{ id,supplierName:supplier }); return { id };
      });
    },
    async costs(user, scope, productId) {
      await init(); await access(pool(),user,scope);
      return (await pool().query('select c.product_id,c.vendor_account_id,c.unit_cost,c.uom,c.updated_at,v.supplier_name from workspace_product_costs c join workspace_vendor_accounts v on v.tenant_id=c.tenant_id and v.company_id=c.company_id and v.id=c.vendor_account_id where c.tenant_id=$1 and c.company_id=$2 and c.product_id=$3', [scope.tenantId,scope.companyId,productId])).rows;
    },
    async saveCost(user,scope,input) {
      return transaction(async client => {
        await access(client,user,scope,true);
        await writeCost(client,user,scope,input); return { saved:true };
      });
    },
    async activity(user,scope) {
      await init(); await access(pool(),user,scope);
      return (await pool().query('select id,action,actor_id,detail,created_at from workspace_activity where tenant_id=$1 and company_id=$2 order by id desc limit 100',[scope.tenantId,scope.companyId])).rows;
    }
  };
}
module.exports={ createCompanyStore, LEGACY_TENANT, LEGACY_COMPANY, LEGACY_COMPANY_NUMBER, BUYSUPPLY_PUBLIC_PROFILE, money };
