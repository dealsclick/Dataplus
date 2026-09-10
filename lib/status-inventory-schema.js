// Triggers make the status change and its inventory job one atomic transaction.
async function installStatusInventoryTriggers(client) {
  await client.query(`
    create or replace function dataplus_master_inactive(a boolean, r jsonb) returns boolean
    language sql immutable as $$ select coalesce(a=false,false)
      or coalesce(lower(trim(r->>'active')) in ('false','0'),false)
      or coalesce(lower(trim(r->>'status')) in ('inactive','disabled','deleted'),false)
      or coalesce(r->>'deleted'='true',false) $$;
    create or replace function dataplus_status_inventory_job() returns trigger language plpgsql as $$
    declare payload jsonb; jobid text; n bigint; label text;
    begin
      if TG_TABLE_NAME='products' then
        if not dataplus_master_inactive(NEW.active,NEW.raw)
          or dataplus_master_inactive(OLD.active,OLD.raw) then return NEW; end if;
        payload=jsonb_build_object('productId',NEW.product_id);
        label='Automatic inactive inventory: ' || NEW.sku;
      else
        if NEW.collection<>'vendors' then return NEW; end if;
        if not (coalesce(lower(NEW.data->>'status'),'') in ('inactive','disabled')
          or coalesce(NEW.data->>'active','') in ('false','0') or NEW.data->'retirement'->>'retiredAt' is not null)
          or (coalesce(lower(OLD.data->>'status'),'') in ('inactive','disabled')
          or coalesce(OLD.data->>'active','') in ('false','0') or OLD.data->'retirement'->>'retiredAt' is not null) then return NEW; end if;
        payload=jsonb_build_object('vendorId',NEW.entity_id);
        label='Automatic supplier inventory: ' || coalesce(NEW.data->>'name',NEW.entity_id);
      end if;
      jobid='status-inventory-' || md5(random()::text || clock_timestamp()::text);
      n=nextval('operations_job_number_seq');
      insert into operations_jobs(job_id,job_number,status,name,category,message,raw)
      values(jobid,n,'queued',label,'Inventory','Pending automatic channel inventory protection.',
        jsonb_build_object('id',jobid,'jobNumber',n,'status','queued','section','Products','category','Inventory',
          'operation',label,'direction','sync','phase','queued','createdAt',now(),
          'message','Pending automatic channel inventory protection. See this job for channel results.',
          'workerTask','status-inventory','workerPayload',payload));
      return NEW;
    end $$;
    drop trigger if exists dataplus_product_status_inventory on products;
    create trigger dataplus_product_status_inventory after update on products
      for each row when (OLD.active is distinct from NEW.active or OLD.raw->'active' is distinct from NEW.raw->'active'
        or OLD.raw->'status' is distinct from NEW.raw->'status' or OLD.raw->'deleted' is distinct from NEW.raw->'deleted')
      execute function dataplus_status_inventory_job();
    drop trigger if exists dataplus_vendor_status_inventory on entity_documents;
    create trigger dataplus_vendor_status_inventory after update on entity_documents
      for each row when (NEW.collection='vendors' and (OLD.data->'status' is distinct from NEW.data->'status'
        or OLD.data->'active' is distinct from NEW.data->'active' or OLD.data->'retirement' is distinct from NEW.data->'retirement'))
      execute function dataplus_status_inventory_job();
  `);
}
module.exports = { installStatusInventoryTriggers };
