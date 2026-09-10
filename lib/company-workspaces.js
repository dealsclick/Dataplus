const crypto = require('node:crypto');
const { schema: orderImportSchema, createOrderImporter } = require('./manual-order-store');

const LEGACY_TENANT = 'organization-default';
const LEGACY_COMPANY = 'linq-usa';
function fail(message, status = 400) { throw Object.assign(new Error(message), { status, statusCode: status }); }
function text(value, label, max = 200, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`Enter a valid ${label}.`);
  return value.trim();
}
function money(value) {
  if (value === null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,6})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) > 1e9) fail('Cost must be a nonnegative number with at most six decimal places.');
  return String(value);
}

// New company data never passes through the legacy global app_state or workers.
function createCompanyStore(getPool) {
  let ready;
  const pool = () => getPool() || fail('Company workspaces require PostgreSQL.', 503);
  async function init() {
    if (!ready) ready = pool().query(`
      select pg_advisory_xact_lock(8250925);
      create table if not exists workspace_tenants (
        id text primary key, name text not null, created_at timestamptz not null default now()
      );
      create table if not exists workspace_companies (
        tenant_id text not null references workspace_tenants(id), id text not null,
        name text not null, mode text not null check(mode in ('legacy','reporting')),
        currency text not null default 'USD', created_at timestamptz not null default now(),
        primary key(tenant_id,id), unique(tenant_id,name)
      );
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
        sku text not null, created_at timestamptz not null default now(),
        primary key(tenant_id,company_id,product_id), unique(tenant_id,company_id,sku),
        foreign key(tenant_id,company_id) references workspace_companies(tenant_id,id)
      );
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
      ${orderImportSchema}
      create table if not exists workspace_operational_state (
        tenant_id text not null, company_id text not null, data jsonb not null default '{}',
        updated_at timestamptz not null default now(), primary key(tenant_id,company_id),
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
    async operationalState(user, scope) {
      await init(); await access(pool(),user,scope);
      return (await pool().query('select data from workspace_operational_state where tenant_id=$1 and company_id=$2',[scope.tenantId,scope.companyId])).rows[0]?.data || {};
    },
    async updateOperationalState(user, scope, action, work) {
      return transaction(async client => {
        await access(client,user,scope);
        await client.query('insert into workspace_operational_state(tenant_id,company_id) values($1,$2) on conflict do nothing',[scope.tenantId,scope.companyId]);
        const data=(await client.query('select data from workspace_operational_state where tenant_id=$1 and company_id=$2 for update',[scope.tenantId,scope.companyId])).rows[0].data;
        const result=await work(data);
        await client.query('update workspace_operational_state set data=$3,updated_at=now() where tenant_id=$1 and company_id=$2',[scope.tenantId,scope.companyId,JSON.stringify(data)]);
        await audit(client,scope,user,action,{recordId:result?.draft?.id || result?.order?.id});
        return result;
      });
    },
    importer: createOrderImporter({pool,init,transaction,access,audit}),
    init,
    async bootstrap(user, users) {
      if (!user.isMasterAdmin) fail('The existing master administrator must initialize the organization.', 403);
      return transaction(async client => {
        await client.query('select pg_advisory_xact_lock(8250926)');
        const existing = (await client.query('select id from workspace_tenants where id=$1', [LEGACY_TENANT])).rows[0];
        if (existing) return { created: false };
        await client.query('insert into workspace_tenants(id,name) values($1,$2)', [LEGACY_TENANT, 'Your organization']);
        await client.query("insert into workspace_companies(tenant_id,id,name,mode) values($1,$2,$3,'legacy'),($1,'buysupply','BuySupply','reporting')", [LEGACY_TENANT, LEGACY_COMPANY, 'LINQ USA dba Dealsclick']);
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
      // Never select p.raw, cost, price, supplier fields, availability, or channel metadata.
      const rows = (await pool().query(`select p.product_id,p.sku as source_sku,p.title,p.brand,p.manufacturer,
        p.mfr_part_number,p.barcode,p.main_category,p.default_image,p.uom,
        cp.sku as company_sku, (cp.product_id is not null) as selected
        from products p left join workspace_company_products cp
          on cp.tenant_id=$1 and cp.company_id=$2 and cp.product_id=p.product_id
        where ($3='' or p.sku ilike $4 or p.title ilike $4 or p.barcode=$3)
          and ($5::boolean=false or cp.product_id is not null)
        order by p.sku limit 26 offset $6`, [scope.tenantId,scope.companyId,query,`%${query.replace(/[\\%_]/g,'\\$&')}%`,selected,(page-1)*25])).rows;
      return { rows: rows.slice(0,25), page, hasMore: rows.length > 25 };
    },
    async selectProduct(user, scope, input) {
      const productId = text(input.productId, 'product'); const sku = text(input.sku, 'company SKU', 120);
      return transaction(async client => {
        await access(client, user, scope, true); await sharedCatalog(client, scope.tenantId);
        if (!(await client.query('select product_id from products where product_id=$1', [productId])).rows.length) fail('Shared product not found.',404);
        await client.query('insert into workspace_company_products(tenant_id,company_id,product_id,sku) values($1,$2,$3,$4) on conflict(tenant_id,company_id,product_id) do update set sku=excluded.sku', [scope.tenantId,scope.companyId,productId,sku]);
        await audit(client, scope, user, 'company_product_saved', { productId, sku });
        if (input.cost !== undefined) await writeCost(client, user, scope, { ...input.cost, productId });
        return { saved: true };
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
module.exports={ createCompanyStore, LEGACY_TENANT, LEGACY_COMPANY, money };
