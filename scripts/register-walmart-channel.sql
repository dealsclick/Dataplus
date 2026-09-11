-- Idempotent deployment registration; preserve every existing channel and setting.
-- Run against the existing LINQ operational database only.
begin;
select pg_advisory_xact_lock(hashtext('dataplus:walmart-registration'));
with added as (
  insert into entity_documents(collection,entity_id,position,data)
  select 'connections','walmart-marketplace',coalesce((select max(position)+1 from entity_documents where collection='connections'),0),
    '{"id":"walmart-marketplace","name":"Walmart","connected":false,"status":"inactive","settings":{"channelEnabled":false,"walmartOrdersEnabled":false,"walmartLaunchEnabled":false,"walmartInventoryEnabled":false,"walmartPriceEnabled":false,"walmartOrderUpdatesEnabled":false,"walmartOrderScheduleEnabled":false,"walmartEnvironment":"production","walmartSpecVersion":"","walmartPriceMarkupPercent":30,"walmartMinMarginPercent":15}}'::jsonb
  where not exists(select 1 from entity_documents where collection='connections' and lower(data->>'name')='walmart')
  on conflict(collection,entity_id) do nothing
  returning entity_id
)
insert into channel_api_logs(channel,operation,method,path,status_code,ok,message,raw)
select 'Walmart','Register disabled Walmart channel','MIGRATE','deployment/walmart',200,true,'Walmart registered with all selling operations disabled.','{"transport":"Deployment","kind":"settings"}'::jsonb from added;
commit;
