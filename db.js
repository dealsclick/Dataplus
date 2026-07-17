const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

let pool;
let relationalSchemaReady = false;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (process.env.DATAPLUS_DISABLE_POSTGRES === "1") return "";
  if (/your_password/i.test(databaseUrl)) return "";
  if (!databaseUrl || process.env.DATAPLUS_DOCKER !== "1") return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.hostname = "host.docker.internal";
      return url.toString();
    }
  } catch {
    return databaseUrl;
  }
  return databaseUrl;
}

function isPostgresEnabled() {
  return Boolean(getDatabaseUrl());
}

function getPool() {
  if (!isPostgresEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl()
    });
  }
  return pool;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDatabase() {
  const client = getPool();
  if (!client) return false;
  await client.query(`
    create table if not exists app_state (
      id integer primary key default 1 check (id = 1),
      data json not null,
      updated_at timestamptz not null default now()
    )
  `);
  const column = await client.query(`
    select data_type
    from information_schema.columns
    where table_name = 'app_state' and column_name = 'data'
  `);
  if (column.rows[0]?.data_type === "jsonb") {
    await client.query("alter table app_state alter column data type json using data::json");
  }
  await initRelationalSchema();
  return true;
}

async function initRelationalSchema() {
  const client = getPool();
  if (!client) return false;
  if (relationalSchemaReady) return true;
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );

    create table if not exists state_documents (
      doc_key text primary key,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists user_table_preferences (
      user_id text not null,
      table_id text not null,
      preferences jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (user_id, table_id)
    );
    create index if not exists user_table_preferences_user_idx on user_table_preferences (user_id);

    create table if not exists entity_documents (
      collection text not null,
      entity_id text not null,
      position integer not null default 0,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (collection, entity_id)
    );
    create index if not exists entity_documents_collection_position_idx on entity_documents (collection, position);
    create index if not exists entity_documents_collection_updated_idx on entity_documents (collection, updated_at desc);

    create table if not exists vendors (
      vendor_id text primary key,
      code text,
      name text not null,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists vendors_code_idx on vendors (lower(code));
    create index if not exists vendors_name_idx on vendors (lower(name));

    create table if not exists products (
      product_id text primary key,
      sku text not null unique,
      title text,
      marketplace_title text,
      brand text,
      manufacturer text,
      mfr_part_number text,
      vendor_sku text,
      barcode text,
      category text,
      main_category text,
      source_category text,
      supplier text,
      supplier_code text,
      active boolean,
      to_be_discontinued boolean,
      uom text,
      uom_qty numeric,
      cost numeric,
      price numeric,
      qty numeric,
      default_image text,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists products_sku_lower_idx on products (lower(sku));
    create index if not exists products_vendor_sku_idx on products (lower(vendor_sku));
    create index if not exists products_barcode_idx on products (barcode);
    create index if not exists products_mfr_part_number_idx on products (lower(mfr_part_number));
    create index if not exists products_supplier_idx on products (lower(supplier));
    create index if not exists products_category_idx on products (category);
    create index if not exists products_discontinued_idx on products (to_be_discontinued);

    create table if not exists product_identifiers (
      product_id text not null references products(product_id) on delete cascade,
      identifier_type text not null,
      identifier_value text not null,
      source text not null default 'system',
      created_at timestamptz not null default now(),
      primary key (product_id, identifier_type, identifier_value, source)
    );
    create index if not exists product_identifiers_lookup_idx on product_identifiers (identifier_type, lower(identifier_value));

    create table if not exists product_aliases (
      alias_id text primary key,
      product_id text not null references products(product_id) on delete cascade,
      parent_sku text,
      alias_sku text not null,
      source text,
      alias_type text not null default 'direct',
      active boolean not null default true,
      created_from_order_id text,
      created_from_order_number text,
      created_from_line_index integer,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists product_aliases_product_idx on product_aliases (product_id);
    create index if not exists product_aliases_alias_lookup_idx on product_aliases (lower(alias_sku));
    create unique index if not exists product_aliases_active_alias_unique_idx on product_aliases (lower(alias_sku)) where active = true;

    create table if not exists vendor_offers (
      offer_id bigserial primary key,
      product_id text not null references products(product_id) on delete cascade,
      vendor_id text references vendors(vendor_id),
      source_key text,
      vendor_sku text,
      cost numeric,
      price numeric,
      qty numeric,
      uom text,
      uom_qty numeric,
      discontinued boolean,
      raw jsonb not null default '{}'::jsonb,
      observed_at timestamptz not null default now()
    );
    create index if not exists vendor_offers_product_idx on vendor_offers (product_id, observed_at desc);
    create index if not exists vendor_offers_vendor_idx on vendor_offers (vendor_id, lower(vendor_sku));
    alter table vendor_offers add column if not exists source_key text;
    create unique index if not exists vendor_offers_source_key_idx on vendor_offers (source_key) where source_key is not null;

    create table if not exists inventory_levels (
      product_id text not null references products(product_id) on delete cascade,
      location_key text not null,
      on_hand numeric not null default 0,
      available numeric not null default 0,
      reserved numeric not null default 0,
      committed numeric not null default 0,
      incoming numeric not null default 0,
      updated_at timestamptz not null default now(),
      primary key (product_id, location_key)
    );

    create table if not exists vendor_feed_runs (
      feed_run_id text primary key,
      job_id text,
      vendor_id text,
      source_file text,
      status text not null default 'running',
      total_rows integer not null default 0,
      processed_rows integer not null default 0,
      changed_rows integer not null default 0,
      missing_rows integer not null default 0,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists vendor_feed_runs_vendor_started_idx on vendor_feed_runs (vendor_id, started_at desc);
    create index if not exists vendor_feed_runs_status_idx on vendor_feed_runs (status, updated_at desc);

    create table if not exists vendor_catalog_items (
      vendor_id text not null,
      source_sku text not null,
      internal_sku text,
      vendor_sku text,
      title text,
      brand text,
      manufacturer text,
      mfr_part_number text,
      barcode text,
      category text,
      source_category text,
      cost numeric,
      price numeric,
      list_price numeric,
      qty numeric,
      stock_status text,
      uom text,
      uom_qty numeric,
      to_be_discontinued boolean not null default false,
      default_image text,
      raw jsonb not null default '{}'::jsonb,
      last_feed_run_id text,
      last_seen_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (vendor_id, source_sku)
    );
    create index if not exists vendor_catalog_items_source_sku_idx on vendor_catalog_items (lower(source_sku));
    create index if not exists vendor_catalog_items_internal_sku_idx on vendor_catalog_items (lower(internal_sku));
    create index if not exists vendor_catalog_items_vendor_sku_idx on vendor_catalog_items (lower(vendor_sku));
    create index if not exists vendor_catalog_items_brand_idx on vendor_catalog_items (lower(brand));
    create index if not exists vendor_catalog_items_category_idx on vendor_catalog_items (category);
    create index if not exists vendor_catalog_items_discontinued_idx on vendor_catalog_items (to_be_discontinued);
    create index if not exists vendor_catalog_items_qty_idx on vendor_catalog_items (qty);
    create table if not exists product_dump_commercial_fields (
      vendor_id text not null,
      source_sku text not null,
      alt_sku text,
      minimum_allowed_price numeric,
      fob_price_for_varis numeric,
      fob_destination numeric,
      fob_price_for_zoro numeric,
      preferred_vendor text,
      uploaded_image text,
      restricted_states jsonb,
      ship_mode text,
      drop_ship boolean,
      show_prop_65 boolean,
      prop_65_message text,
      warranty text,
      drop_ship_min_qty text,
      additional_attributes text,
      certifications text,
      returnable text,
      competitor_part_number text,
      oversize boolean,
      mapped_category jsonb,
      checked_sds jsonb,
      category_id text,
      vendor_website_price numeric,
      is_banned boolean,
      is_marketplace_restricted boolean,
      bulk_prices jsonb,
      trusted_brand text,
      keywords text,
      sub_brand text,
      replacement_sku text,
      icons text,
      raw jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (vendor_id, source_sku)
    );
    create index if not exists product_dump_commercial_fields_alt_sku_idx on product_dump_commercial_fields (lower(alt_sku));
    create index if not exists product_dump_commercial_fields_preferred_vendor_idx on product_dump_commercial_fields (lower(preferred_vendor));
    create index if not exists product_dump_commercial_fields_replacement_sku_idx on product_dump_commercial_fields (lower(replacement_sku));
    create index if not exists product_dump_commercial_fields_compliance_idx on product_dump_commercial_fields (is_banned, is_marketplace_restricted, show_prop_65);
    create table if not exists product_dump_system_fields (
      vendor_id text not null,
      source_sku text not null,
      add_tags jsonb,
      remove_tags jsonb,
      bin_location text,
      bsc_reporting jsonb,
      bsc_reporting_updated_at timestamptz,
      cei_id text,
      contract_name text,
      contract_short_description text,
      default_lead_time text,
      default_price numeric,
      default_supplier_price numeric,
      default_supplier_sku text,
      i_by_l jsonb,
      key_features jsonb,
      marcone_make text,
      marcone_part text,
      master_sku text,
      max_quantity numeric,
      minimum_quantity numeric,
      notes text,
      u_key text,
      updated_by text,
      weight numeric,
      source text not null default 'system_default',
      raw jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (vendor_id, source_sku)
    );
    create index if not exists product_dump_system_fields_cei_id_idx on product_dump_system_fields (lower(cei_id));
    create index if not exists product_dump_system_fields_master_sku_idx on product_dump_system_fields (lower(master_sku));
    create index if not exists product_dump_system_fields_marcone_part_idx on product_dump_system_fields (lower(marcone_part));
    create index if not exists product_dump_system_fields_u_key_idx on product_dump_system_fields (lower(u_key));
    create table if not exists vendor_catalog_facets (
      facet_type text not null,
      facet_value text not null,
      row_count bigint not null default 0,
      display_value text,
      updated_at timestamptz not null default now(),
      primary key (facet_type, facet_value)
    );
    create index if not exists vendor_catalog_facets_type_count_idx on vendor_catalog_facets (facet_type, row_count desc, facet_value);

    create table if not exists vendor_catalog_snapshots (
      feed_run_id text not null references vendor_feed_runs(feed_run_id) on delete cascade,
      vendor_id text not null,
      source_sku text not null,
      cost numeric,
      price numeric,
      list_price numeric,
      qty numeric,
      stock_status text,
      to_be_discontinued boolean,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      primary key (feed_run_id, vendor_id, source_sku)
    );
    create index if not exists vendor_catalog_snapshots_vendor_sku_idx on vendor_catalog_snapshots (vendor_id, source_sku);

    create table if not exists category_channel_mappings (
      mapping_id text primary key,
      category_id text,
      category_name text not null,
      channel text not null,
      channel_category_id text,
      channel_category_path text,
      channel_category_handle text,
      status text,
      attribute_count integer not null default 0,
      attribute_mapping_count integer not null default 0,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists category_channel_mappings_category_channel_idx on category_channel_mappings (lower(category_name), lower(channel));
    create index if not exists category_channel_mappings_channel_status_idx on category_channel_mappings (lower(channel), status);

    create table if not exists category_summary_index (
      scope text not null,
      category_key text not null,
      position integer not null default 0,
      data jsonb not null default '{}'::jsonb,
      generated_at timestamptz not null default now(),
      primary key (scope, category_key)
    );
    create index if not exists category_summary_index_scope_position_idx on category_summary_index (scope, position);
    create index if not exists category_summary_index_scope_generated_idx on category_summary_index (scope, generated_at desc);

    create table if not exists order_records (
      order_id text primary key,
      order_number text,
      internal_order_number text,
      marketplace_order_id text,
      source text,
      status text,
      buyer text,
      buyer_email text,
      phone text,
      customer_id text,
      total numeric,
      product_cost numeric,
      marketplace_fees numeric,
      shipping_cost numeric,
      refund_amount numeric,
      paid_amount numeric,
      qty numeric,
      ship_by date,
      shipped_at timestamptz,
      tracking_number text,
      shipping_carrier text,
      reportable boolean not null default true,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists order_records_status_idx on order_records (status, created_at desc);
    create index if not exists order_records_source_idx on order_records (lower(source), created_at desc);
    create index if not exists order_records_customer_idx on order_records (customer_id, created_at desc);
    create index if not exists order_records_order_number_idx on order_records (lower(order_number));
    create index if not exists order_records_marketplace_order_idx on order_records (lower(marketplace_order_id));

    create table if not exists order_line_items (
      line_id text primary key,
      order_id text not null references order_records(order_id) on delete cascade,
      line_index integer not null default 0,
      sku text,
      mapped_sku text,
      original_sku text,
      title text,
      qty numeric,
      price numeric,
      cost numeric,
      raw jsonb not null default '{}'::jsonb
    );
    create index if not exists order_line_items_order_idx on order_line_items (order_id, line_index);
    create index if not exists order_line_items_sku_idx on order_line_items (lower(sku));

    create table if not exists purchase_order_records (
      po_id text primary key,
      po_number text,
      status text,
      vendor_id text,
      supplier text,
      warehouse_id text,
      warehouse_name text,
      source text,
      total_units numeric,
      received_units numeric,
      estimated_cost numeric,
      received_at date,
      reportable boolean not null default true,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists purchase_order_records_status_idx on purchase_order_records (status, created_at desc);
    create index if not exists purchase_order_records_supplier_idx on purchase_order_records (lower(supplier), created_at desc);
    create index if not exists purchase_order_records_po_number_idx on purchase_order_records (lower(po_number));

    create table if not exists purchase_order_line_items (
      line_id text primary key,
      po_id text not null references purchase_order_records(po_id) on delete cascade,
      line_index integer not null default 0,
      sku text,
      title text,
      qty numeric,
      received_qty numeric,
      remaining_qty numeric,
      estimated_unit_cost numeric,
      raw jsonb not null default '{}'::jsonb
    );
    create index if not exists purchase_order_line_items_po_idx on purchase_order_line_items (po_id, line_index);
    create index if not exists purchase_order_line_items_sku_idx on purchase_order_line_items (lower(sku));

    create table if not exists operations_jobs (
      job_id text primary key,
      job_type text,
      category text,
      status text not null,
      name text,
      message text,
      total_rows integer,
      processed_rows integer,
      changed_rows integer,
      missing_rows integer,
      progress numeric,
      eta_seconds integer,
      source text,
      output_path text,
      error_path text,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      ended_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create index if not exists operations_jobs_status_idx on operations_jobs (status, updated_at desc);
    create index if not exists operations_jobs_category_idx on operations_jobs (category, updated_at desc);

    create table if not exists operation_artifacts (
      artifact_id text primary key,
      job_id text not null references operations_jobs(job_id) on delete cascade,
      artifact_kind text not null,
      file_name text,
      file_path text not null,
      content_type text,
      row_count integer,
      byte_size bigint,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists operation_artifacts_job_kind_path_idx on operation_artifacts (job_id, artifact_kind, file_path);
    create index if not exists operation_artifacts_job_idx on operation_artifacts (job_id, created_at desc);

    create table if not exists channel_api_logs (
      log_id bigserial primary key,
      channel text,
      operation text,
      method text,
      path text,
      status_code integer,
      ok boolean,
      request_id text,
      job_id text,
      message text,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists channel_api_logs_channel_created_idx on channel_api_logs (channel, created_at desc);

    create table if not exists product_change_events (
      event_id bigserial primary key,
      product_id text references products(product_id) on delete cascade,
      sku text,
      field_name text not null,
      old_value text,
      new_value text,
      source text not null default 'system',
      job_id text,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists product_change_events_product_idx on product_change_events (product_id, created_at desc);
    create index if not exists product_change_events_field_idx on product_change_events (field_name, created_at desc);
    create index if not exists product_change_events_created_idx on product_change_events (created_at desc);
    create index if not exists product_change_events_sku_idx on product_change_events (lower(sku));
    create index if not exists product_change_events_source_idx on product_change_events (source, created_at desc);

    create table if not exists product_source_enrichments (
      sku text primary key,
      product_id text references products(product_id) on delete set null,
      supplier text,
      vendor_sku text,
      source_sku text,
      source_payload jsonb not null default '{}'::jsonb,
      enriched_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists product_source_enrichments_product_idx on product_source_enrichments (product_id);
    create index if not exists product_source_enrichments_supplier_idx on product_source_enrichments (lower(supplier));
    create index if not exists product_source_enrichments_vendor_sku_idx on product_source_enrichments (lower(vendor_sku));

    create table if not exists shopify_product_statuses (
      sku text primary key,
      product_id text references products(product_id) on delete set null,
      shopify_id text,
      shopify_variant_id text,
      shopify_handle text,
      shopify_status text,
      shopify_published boolean,
      shopify_synced_at timestamptz,
      sync_source text,
      status_payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create index if not exists shopify_product_statuses_product_idx on shopify_product_statuses (product_id);
    create index if not exists shopify_product_statuses_shopify_id_idx on shopify_product_statuses (shopify_id);
    create index if not exists shopify_product_statuses_lower_sku_idx on shopify_product_statuses (lower(sku));
    create index if not exists shopify_product_statuses_status_idx on shopify_product_statuses (shopify_status, updated_at desc);

    create table if not exists product_quality_rows (
      sku text primary key,
      product_score numeric,
      shopify_score numeric,
      ebay_score numeric,
      issue_count integer not null default 0,
      issue_types text[] not null default array[]::text[],
      shopify_ready boolean not null default false,
      shopify_live boolean not null default false,
      to_be_discontinued boolean not null default false,
      quality_payload jsonb not null default '{}'::jsonb,
      scanned_at timestamptz not null default now()
    );
    create index if not exists product_quality_rows_issue_count_idx on product_quality_rows (issue_count desc);
    create index if not exists product_quality_rows_shopify_ready_idx on product_quality_rows (shopify_ready);
    create index if not exists product_quality_rows_shopify_live_idx on product_quality_rows (shopify_live);
    create index if not exists product_quality_rows_discontinued_idx on product_quality_rows (to_be_discontinued);
    create index if not exists product_quality_rows_issue_types_idx on product_quality_rows using gin (issue_types);
  `);
  await client.query(
    "insert into schema_migrations (name) values ($1) on conflict (name) do nothing",
    ["2026-05-26-core-catalog-ops"]
  );
  relationalSchemaReady = true;
  return true;
}

async function databaseHealth() {
  const client = getPool();
  const enabled = isPostgresEnabled();
  if (!client) {
    return { enabled, connected: false, mode: "json-file", message: "DATABASE_URL is not configured." };
  }
  try {
    await initRelationalSchema();
    const result = await client.query(`
      select
        current_database() as database,
        current_user as "user",
        version() as version,
        (select count(*)::int from products) as products,
        (select count(*)::int from vendors) as vendors,
        (select count(*)::int from vendor_offers) as "vendorOffers",
        (select count(*)::int from product_aliases) as "productAliases",
        (select count(*)::int from category_channel_mappings) as "categoryChannelMappings",
        (select count(*)::int from order_records) as orders,
        (select count(*)::int from order_line_items) as "orderLines",
        (select count(*)::int from purchase_order_records) as "purchaseOrders",
        (select count(*)::int from purchase_order_line_items) as "purchaseOrderLines",
        (select count(*)::int from vendor_feed_runs) as "vendorFeedRuns",
        (select count(*)::int from vendor_catalog_items) as "vendorCatalogItems",
        (select count(*)::int from vendor_catalog_snapshots) as "vendorCatalogSnapshots",
        (select count(*)::int from operations_jobs) as jobs,
        (select count(*)::int from operation_artifacts) as "operationArtifacts",
        (select count(*)::int from product_change_events) as "productChangeEvents",
        (select count(*)::int from product_source_enrichments) as "productSourceEnrichments",
        (select count(*)::int from shopify_product_statuses) as "shopifyProductStatuses",
        (select count(*)::int from product_quality_rows) as "productQualityRows"
    `);
    return { enabled, connected: true, mode: "postgres", ...result.rows[0] };
  } catch (error) {
    return { enabled, connected: false, mode: "postgres", error: error.message };
  }
}

async function readState(options = {}) {
  const client = getPool();
  if (!client) return null;
  const relational = await readRelationalState(options);
  if (relational) return relational;
  await initDatabase();
  const result = await client.query("select data from app_state where id = 1");
  return result.rows[0]?.data || null;
}

async function readStateField(field) {
  const client = getPool();
  if (!client) return undefined;
  await initRelationalSchema();
  if (ENTITY_DOCUMENT_COLLECTIONS.has(field)) {
    const entities = await client.query(`
      select data
      from entity_documents
      where collection = $1
      order by position, entity_id
    `, [field]);
    if (entities.rows.length) return entities.rows.map((row) => row.data);
  }
  const doc = await client.query("select data from state_documents where doc_key = $1", [field]);
  if (doc.rows.length) return doc.rows[0].data;
  await initDatabase();
  const result = await client.query("select data -> $1 as value from app_state where id = 1", [field]);
  return result.rows[0]?.value;
}

async function readCategoryState() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const docs = await readStateDocuments();
  if (Object.keys(docs).length) {
    const result = await client.query(`
      select json_agg(json_build_object(
        'sku', sku,
        'title', title,
        'marketplaceTitle', marketplace_title,
        'category', category,
        'mainCategory', main_category,
        'sourceCategory', source_category,
        'vendorCategory', coalesce(raw ->> 'vendorCategory', source_category),
        'categoryVerified', raw -> 'categoryVerified',
        'active', active,
        'stockQty', raw -> 'stockQty',
        'qty', qty,
        'hazardous', raw -> 'hazardous',
        'supplier', supplier,
        'vendor', coalesce(raw ->> 'vendor', supplier),
        'brand', brand
      )) as inventory
      from products
    `);
    return {
      inventory: result.rows[0]?.inventory || [],
      categorySettings: docs.categorySettings || [],
      vendorCategoryMappings: docs.vendorCategoryMappings || {}
    };
  }
  await initDatabase();
  const result = await client.query(`
    select json_build_object(
      'inventory', coalesce((
        select json_agg(json_build_object(
          'sku', item ->> 'sku',
          'title', item ->> 'title',
          'marketplaceTitle', item ->> 'marketplaceTitle',
          'category', item ->> 'category',
          'mainCategory', item ->> 'mainCategory',
          'sourceCategory', item ->> 'sourceCategory',
          'vendorCategory', item ->> 'vendorCategory',
          'categoryVerified', item -> 'categoryVerified',
          'active', item -> 'active',
          'stockQty', item -> 'stockQty',
          'qty', item -> 'qty',
          'hazardous', item -> 'hazardous',
          'supplier', item ->> 'supplier',
          'vendor', item ->> 'vendor',
          'brand', item ->> 'brand'
        ))
        from json_array_elements(data -> 'inventory') item
      ), '[]'::json),
      'categorySettings', coalesce(data -> 'categorySettings', '[]'::json),
      'vendorCategoryMappings', coalesce(data -> 'vendorCategoryMappings', '{}'::json)
    ) as data
    from app_state
    where id = 1
  `);
  return result.rows[0]?.data || null;
}

async function writeState(data) {
  const client = getPool();
  if (!client) return false;
  return writeRelationalState(data);
}

async function writeLegacyState(data) {
  const client = getPool();
  if (!client) return false;
  await initDatabase();
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values (1, $1::json, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [JSON.stringify(data)]
  );
  return true;
}

async function writeStateField(field, value) {
  const client = getPool();
  if (!client) return false;
  if (ENTITY_DOCUMENT_COLLECTIONS.has(field) && Array.isArray(value)) {
    return writeStateDocuments({ [field]: value });
  }
  await initRelationalSchema();
  await client.query(
    `
      insert into state_documents (doc_key, data, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (doc_key) do update set
          data = excluded.data,
          updated_at = now()
    `,
    [field, JSON.stringify(value)]
  );
  return true;
}

function nullableString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function splitFilterValues(value) {
  return String(value ?? "")
    .split("|")
    .map((item) => nullableString(item))
    .filter(Boolean);
}

function parseFilterBoolean(value) {
  return ["true", "1", "yes", "y", "active", "in-stock"].includes(String(value || "").trim().toLowerCase());
}

function isClearanceCatalogItem(item = {}) {
  const statusValues = [
    item.status,
    item.stockStatus,
    item.stock_status,
    item.raw?.status,
    item.raw?.stockStatus,
    item.raw?.stock_status
  ].map((value) => String(value ?? "").trim().toLowerCase());
  const indicatorValues = [
    item.itemClearanceIndicator,
    item.item_clearance_indicator,
    item.raw?.itemClearanceIndicator,
    item.raw?.item_clearance_indicator
  ].map((value) => String(value ?? "").trim().toLowerCase());
  return statusValues.some((value) => ["clearance", "clearance item", "closeout"].includes(value))
    || indicatorValues.some((value) => ["clearance", "clearance item", "closeout", "y", "yes", "true", "1"].includes(value));
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableTimestamp(value) {
  const text = nullableString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function boolOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "active"].includes(text)) return true;
  if (["0", "false", "no", "n", "inactive"].includes(text)) return false;
  return null;
}

function nullableJson(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const STATE_DOCUMENT_KEYS = [
  "sequence",
  "inventoryLedger",
  "marketplaceTemplates",
  "exportMappings",
  "categorySettings",
  "sourceCatalogOverrides",
  "vendorCategoryMappings",
  "catalogImportReviews",
  "deletedOrders",
  "syncRuns",
  "importJobs",
  "knowledgeSettings",
  "knowledgeArticles",
  "systemSettings",
  "dataQualitySummary",
  "connections",
  "connectorState",
  "orders",
  "orderDrafts",
  "returns",
  "cancellations",
  "customers",
  "purchaseOrders",
  "vendors",
  "brands",
  "warehouses",
  "marketplaceAttributeMappings",
  "attributeMappings",
  "attributeGroups",
  "shopifySettings",
  "ebaySettings",
  "channelInventorySchedules",
  "workerHeartbeat"
];

const ENTITY_DOCUMENT_COLLECTIONS = new Set([
  "inventoryLedger",
  "marketplaceTemplates",
  "exportMappings",
  "categorySettings",
  "catalogImportReviews",
  "deletedOrders",
  "syncRuns",
  "knowledgeArticles",
  "connections",
  "orders",
  "orderDrafts",
  "returns",
  "cancellations",
  "customers",
  "purchaseOrders",
  "vendors",
  "brands",
  "warehouses"
]);

function entityDocumentId(collection, row, index = 0) {
  const candidates = [
    row?.id,
    row?.categoryId,
    row?.sku,
    row?.orderNumber,
    row?.draftNumber,
    row?.returnNumber,
    row?.poNumber,
    row?.name && `${collection}:${row.name}`,
    row?.marketplace && `${collection}:${row.marketplace}`,
    row?.source && row?.type && `${collection}:${row.source}:${row.type}:${row.createdAt || index}`,
    row?.createdAt && `${collection}:${row.createdAt}:${index}`
  ];
  const found = candidates.map((value) => String(value || "").trim()).find(Boolean);
  if (found) return found.slice(0, 300);
  return crypto.createHash("sha1").update(`${collection}:${index}:${JSON.stringify(row || {})}`).digest("hex");
}

async function stateDocumentCount() {
  const client = getPool();
  if (!client) return 0;
  await initRelationalSchema();
  const result = await client.query(`
    select
      (select count(*)::int from state_documents) +
      (select count(distinct collection)::int from entity_documents) as count
  `);
  return result.rows[0]?.count || 0;
}

async function readStateDocuments() {
  const client = getPool();
  if (!client) return {};
  await initRelationalSchema();
  const result = await client.query("select doc_key, data from state_documents");
  const docs = {};
  for (const row of result.rows) docs[row.doc_key] = row.data;
  const entities = await client.query(`
    select collection, data
    from entity_documents
    order by collection, position, entity_id
  `);
  for (const row of entities.rows) {
    if (!Array.isArray(docs[row.collection])) docs[row.collection] = [];
    if (Array.isArray(docs[row.collection])) docs[row.collection].push(row.data);
  }
  return docs;
}

async function readUserTablePreferences() {
  const client = getPool();
  if (!client) return {};
  await initRelationalSchema();
  const result = await client.query("select user_id, table_id, preferences from user_table_preferences order by user_id, table_id");
  return result.rows.reduce((prefs, row) => {
    const userId = String(row.user_id || "").trim();
    const tableId = String(row.table_id || "").trim();
    if (!userId || !tableId) return prefs;
    if (!prefs[userId]) prefs[userId] = {};
    prefs[userId][tableId] = row.preferences && typeof row.preferences === "object" ? row.preferences : {};
    return prefs;
  }, {});
}

async function upsertUserTablePreference(userId, tableId, preferences = {}) {
  const client = getPool();
  if (!client) return {};
  await initRelationalSchema();
  const result = await client.query(`
    insert into user_table_preferences (user_id, table_id, preferences, updated_at)
    values ($1, $2, $3::jsonb, now())
    on conflict (user_id, table_id)
    do update set preferences = excluded.preferences, updated_at = now()
    returning preferences
  `, [String(userId || "").trim(), String(tableId || "").trim(), JSON.stringify(preferences && typeof preferences === "object" ? preferences : {})]);
  return result.rows[0]?.preferences || {};
}

async function writeStateDocuments(state = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const rows = [];
  const entityRows = [];
  for (const key of STATE_DOCUMENT_KEYS) {
    if (state[key] === undefined) continue;
    const value = state[key];
    if (ENTITY_DOCUMENT_COLLECTIONS.has(key) && Array.isArray(value)) {
      value.forEach((row, index) => {
        entityRows.push({
          collection: key,
          entity_id: entityDocumentId(key, row, index),
          position: index,
          data: row
        });
      });
    } else {
      rows.push({ doc_key: key, data: value });
    }
  }
  if (!rows.length && !entityRows.length) return true;
  const batchSize = 250;
  await client.query("begin");
  try {
    if (rows.length) {
      for (let i = 0; i < rows.length; i += batchSize) {
        await client.query(`
          insert into state_documents (doc_key, data, updated_at)
          select doc_key, data, now()
          from jsonb_to_recordset($1::jsonb) as x(doc_key text, data jsonb)
          on conflict (doc_key) do update set
            data = excluded.data,
            updated_at = now()
        `, [JSON.stringify(rows.slice(i, i + batchSize))]);
      }
    }
    if (entityRows.length) {
      const collections = [...new Set(entityRows.map((row) => row.collection))];
      await client.query("delete from entity_documents where collection = any($1::text[])", [collections]);
      await client.query("delete from state_documents where doc_key = any($1::text[])", [collections]);
      for (let i = 0; i < entityRows.length; i += batchSize) {
        await client.query(`
          insert into entity_documents (collection, entity_id, position, data, updated_at)
          select collection, entity_id, position, data, now()
          from jsonb_to_recordset($1::jsonb) as x(collection text, entity_id text, position integer, data jsonb)
          on conflict (collection, entity_id) do update set
            position = excluded.position,
            data = excluded.data,
            updated_at = now()
        `, [JSON.stringify(entityRows.slice(i, i + batchSize))]);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return true;
}

async function readAllProducts(options = {}) {
  const client = getPool();
  if (!client) return [];
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(5000000, Number(options.limit || 5000000)));
  const offset = Math.max(0, Number(options.offset || 0));
  const result = await client.query(`
    select *
    from products
    order by sku
    limit $1 offset $2
  `, [limit, offset]);
  return result.rows.map(productRowToState);
}

async function listShopifyLinkedProducts(options = {}) {
  const client = getPool();
  if (!client) return { items: [], total: 0 };
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(10000, Number(options.limit || 1000)));
  const offset = Math.max(0, Number(options.offset || 0));
  const countResult = await client.query(`
    select count(distinct p.product_id)::int as total
    from (
      select distinct lower(s.sku) as sku_key
      from shopify_product_statuses s
      where coalesce(s.shopify_id, '') <> ''
        and coalesce(s.sku, '') <> ''
    ) linked
    join products p on lower(p.sku) = linked.sku_key
  `);
  const result = await client.query(`
    select p.*,
      coalesce(p.raw, '{}'::jsonb) || jsonb_build_object(
        'shopifyId', linked.shopify_id,
        'shopifyProductId', linked.shopify_id,
        'shopifyVariantId', linked.shopify_variant_id,
        'shopifyStatus', linked.shopify_status,
        'shopifyPublished', linked.shopify_published
      ) as raw
    from products p
    join (
      select distinct on (lower(s.sku))
        lower(s.sku) as sku_key,
        s.shopify_id,
        s.shopify_variant_id,
        s.shopify_status,
        s.shopify_published
      from shopify_product_statuses s
      where coalesce(s.shopify_id, '') <> ''
        and coalesce(s.sku, '') <> ''
      order by lower(s.sku), s.updated_at desc
    ) linked on lower(p.sku) = linked.sku_key
    order by p.sku
    limit $1 offset $2
  `, [limit, offset]);
  return {
    items: result.rows.map(productRowToState),
    total: countResult.rows[0]?.total || result.rows.length
  };
}

async function readRelationalState(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const hasDocuments = await stateDocumentCount();
  if (!hasDocuments && !options.allowEmptyDocuments) return null;
  const docs = await readStateDocuments();
  const [inventory, importJobs, orders, purchaseOrders] = await Promise.all([
    options.skipInventory ? Promise.resolve([]) : readAllProducts({ limit: options.productLimit, offset: options.productOffset }),
    readOperationJobs(1000),
    listOrders({ limit: options.orderLimit || 5000 }),
    listPurchaseOrders({ limit: options.purchaseOrderLimit || 5000 })
  ]);
  return {
    ...docs,
    inventory,
    orders: orders || (Array.isArray(docs.orders) ? docs.orders : []),
    purchaseOrders: purchaseOrders || (Array.isArray(docs.purchaseOrders) ? docs.purchaseOrders : []),
    importJobs: importJobs.length ? importJobs : (Array.isArray(docs.importJobs) ? docs.importJobs : [])
  };
}

async function writeRelationalState(state = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  await writeStateDocuments(state);
  if (Array.isArray(state.inventory)) await upsertProductsFromState(state.inventory);
  if (Array.isArray(state.inventory)) await upsertInventoryLevelsFromProducts(state.inventory);
  if (Array.isArray(state.categorySettings)) await upsertCategoryChannelMappingsFromState(state.categorySettings);
  if (Array.isArray(state.orders)) await upsertOrdersFromState(state.orders);
  if (Array.isArray(state.purchaseOrders)) await upsertPurchaseOrdersFromState(state.purchaseOrders);
  if (Array.isArray(state.importJobs)) {
    for (const job of state.importJobs) await upsertOperationJob(job);
  }
  return true;
}

function vendorIdFor(item = {}) {
  return nullableString(item.supplierCode || item.vendorCode || item.supplier || item.vendor)?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || null;
}

function productRecordFromState(item = {}) {
  const sku = nullableString(item.sku || item.externalId);
  if (!sku) return null;
  return {
    product_id: nullableString(item.id) || sku,
    sku,
    title: nullableString(item.title),
    marketplace_title: nullableString(item.marketplaceTitle),
    brand: nullableString(item.brand),
    manufacturer: nullableString(item.manufacturer),
    mfr_part_number: nullableString(item.mfrPartNumber),
    vendor_sku: nullableString(item.vendorSku),
    barcode: nullableString(item.barcode || item.upc || item.gtin),
    category: nullableString(item.category),
    main_category: nullableString(item.mainCategory || item.category),
    source_category: nullableString(item.sourceCategory || item.vendorCategory),
    supplier: nullableString(item.supplier || item.vendor),
    supplier_code: nullableString(item.supplierCode),
    active: boolOrNull(item.active),
    to_be_discontinued: boolOrNull(item.toBeDiscontinued || item.discontinued || item.closeoutEligible),
    uom: nullableString(item.uom),
    uom_qty: nullableNumber(item.uomQty || item.uom_qty),
    cost: nullableNumber(item.cost || item.sourceCost),
    price: nullableNumber(item.price || item.websitePrice),
    qty: nullableNumber(item.qty ?? item.stockQty),
    default_image: nullableString(item.defaultImage || (Array.isArray(item.images) ? item.images[0] : "")),
    raw: item
  };
}

function vendorRecordFromState(item = {}) {
  const vendorId = vendorIdFor(item);
  const name = nullableString(item.supplier || item.vendor || item.supplierCode);
  if (!vendorId || !name) return null;
  return {
    vendor_id: vendorId,
    code: nullableString(item.supplierCode),
    name,
    raw: {
      supplier: item.supplier || "",
      vendor: item.vendor || "",
      supplierCode: item.supplierCode || ""
    }
  };
}

function vendorCatalogIdFor(item = {}) {
  return nullableString(item.supplierCode || item.supplier || item.vendor || item.defaultSupplier)?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-vendor";
}

function leanVendorCatalogRaw(item = {}) {
  return {
    sku: nullableString(item.sku || item.externalId),
    supplier: nullableString(item.supplier || item.vendor || item.defaultSupplier),
    supplierCode: nullableString(item.supplierCode),
    vendorSku: nullableString(item.vendorSku),
    productDumpUpdatedAt: nullableString(item.productDumpUpdatedAt),
    itemKey: nullableString(item.itemKey),
    uploadedBy: nullableString(item.uploadedBy)
  };
}

function vendorCatalogRecordFromProduct(item = {}, feedRunId = "", options = {}) {
  const sourceSku = nullableString(item.sku || item.externalId);
  if (!sourceSku) return null;
  return {
    feed_run_id: nullableString(feedRunId),
    vendor_id: vendorCatalogIdFor(item),
    source_sku: sourceSku,
    internal_sku: nullableString(item.internalSku || item.productCatalogSku || item.sku),
    vendor_sku: nullableString(item.vendorSku),
    title: nullableString(item.marketplaceTitle || item.title),
    brand: nullableString(item.brand || item.sourceBrand),
    manufacturer: nullableString(item.manufacturer),
    mfr_part_number: nullableString(item.mfrPartNumber),
    barcode: nullableString(item.barcode || item.upc || item.gtin),
    category: nullableString(item.mainCategory || item.category),
    source_category: nullableString(item.sourceCategory || item.vendorCategory || item.category),
    cost: nullableNumber(item.sourceCost ?? item.cost),
    price: nullableNumber(item.websitePrice ?? item.price),
    list_price: isClearanceCatalogItem(item) ? nullableNumber(item.listPrice ?? item.msrp) : null,
    qty: nullableNumber(item.stockQty ?? item.qty),
    stock_status: nullableString(item.stockStatus),
    uom: nullableString(item.uom),
    uom_qty: nullableNumber(item.uomQty ?? item.uom_qty),
    to_be_discontinued: Boolean(boolOrNull(item.toBeDiscontinued ?? item.closeoutEligible ?? item.discontinued)),
    default_image: nullableString(item.defaultImage || (Array.isArray(item.images) ? item.images[0] : "")),
    raw: options.leanRaw ? leanVendorCatalogRaw(item) : item
  };
}

function productDumpCommercialRecordFromProduct(item = {}) {
  const sourceSku = nullableString(item.sku || item.externalId);
  if (!sourceSku) return null;
  const raw = item.productManagerFields && typeof item.productManagerFields === "object" ? item.productManagerFields : {};
  return {
    vendor_id: vendorCatalogIdFor(item),
    source_sku: sourceSku,
    alt_sku: nullableString(item.altSku ?? raw.alt_sku),
    minimum_allowed_price: nullableNumber(item.minimumAllowedPrice ?? raw.minimum_allowed_price),
    fob_price_for_zoro: nullableNumber(item.fobPriceForZoro ?? raw.fob_price_for_zoro),
    preferred_vendor: nullableString(item.preferredVendor ?? raw.preferred_vendor),
    uploaded_image: nullableString(item.uploadedImage ?? raw.uploaded_image),
    restricted_states: nullableJson(item.restrictedStates ?? raw.restricted_states),
    ship_mode: nullableString(item.shipMode ?? raw.ship_mode),
    drop_ship: boolOrNull(item.dropShip ?? raw.drop_ship),
    show_prop_65: boolOrNull(item.showProp65 ?? raw.show_prop_65),
    prop_65_message: nullableString(item.prop65Message ?? raw.prop_65_message),
    warranty: nullableString(item.warranty ?? raw.warranty),
    drop_ship_min_qty: nullableString(item.dropShipMinQty ?? raw.drop_ship_min_qty),
    additional_attributes: nullableString(item.additionalAttributes ?? raw.additional_attributes),
    certifications: nullableString(item.certifications ?? raw.certifications),
    returnable: nullableString(item.returnable ?? raw.returnable),
    competitor_part_number: nullableString(item.competitorPartNumber ?? raw.competitor_part_number),
    oversize: boolOrNull(item.oversize ?? raw.oversize),
    mapped_category: nullableJson(item.mappedCategory ?? raw.mapped_category),
    checked_sds: nullableJson(item.checkedSds ?? raw.checked_sds),
    category_id: nullableString(item.sourceCategoryId ?? raw.category_id),
    vendor_website_price: nullableNumber(item.vendorWebsitePrice ?? raw.vendor_website_price),
    is_banned: boolOrNull(item.isBanned ?? raw.is_banned),
    is_marketplace_restricted: boolOrNull(item.isMarketplaceRestricted ?? raw.is_marketplace_restricted),
    bulk_prices: nullableJson(item.bulkPrices ?? raw.bulk_prices),
    trusted_brand: nullableString(item.trustedBrand ?? raw.trusted_brand),
    keywords: nullableString(item.keywords ?? raw.keywords),
    sub_brand: nullableString(item.subBrand ?? raw.sub_brand),
    replacement_sku: nullableString(item.replacementSku ?? raw.replacement_sku),
    icons: nullableString(item.icons ?? raw.icons),
    raw: {
      alt_sku: raw.alt_sku,
      minimum_allowed_price: raw.minimum_allowed_price,
      fob_price_for_zoro: raw.fob_price_for_zoro,
      preferred_vendor: raw.preferred_vendor,
      uploaded_image: raw.uploaded_image,
      restricted_states: raw.restricted_states,
      ship_mode: raw.ship_mode,
      drop_ship: raw.drop_ship,
      show_prop_65: raw.show_prop_65,
      prop_65_message: raw.prop_65_message,
      warranty: raw.warranty,
      drop_ship_min_qty: raw.drop_ship_min_qty,
      additional_attributes: raw.additional_attributes,
      certifications: raw.certifications,
      returnable: raw.returnable,
      competitor_part_number: raw.competitor_part_number,
      oversize: raw.oversize,
      mapped_category: raw.mapped_category,
      checked_sds: raw.checked_sds,
      category_id: raw.category_id,
      vendor_website_price: raw.vendor_website_price,
      is_banned: raw.is_banned,
      is_marketplace_restricted: raw.is_marketplace_restricted,
      bulk_prices: raw.bulk_prices,
      trusted_brand: raw.trusted_brand,
      keywords: raw.keywords,
      sub_brand: raw.sub_brand,
      replacement_sku: raw.replacement_sku,
      icons: raw.icons
    }
  };
}

function productDumpSystemRecordFromProduct(item = {}) {
  const sourceSku = nullableString(item.sku || item.externalId);
  if (!sourceSku) return null;
  const raw = item.productManagerFields && typeof item.productManagerFields === "object" ? item.productManagerFields : {};
  return {
    vendor_id: vendorCatalogIdFor(item),
    source_sku: sourceSku,
    add_tags: nullableJson(item.addTags ?? raw.add_tags),
    remove_tags: nullableJson(item.removeTags ?? raw.remove_tags),
    bin_location: nullableString(item.binLocation ?? raw.bin_location),
    bsc_reporting: nullableJson(item.bscReporting ?? raw.bsc_reporting),
    bsc_reporting_updated_at: nullableTimestamp(item.bscReportingUpdatedAt ?? raw.bsc_reporting_updated_at),
    cei_id: nullableString(item.ceiId ?? raw["cei-id"]),
    contract_name: nullableString(item.contractName ?? raw.contract_name),
    contract_short_description: nullableString(item.contractShortDescription ?? raw.contract_short_description),
    default_lead_time: nullableString(item.defaultLeadTime ?? raw.default_lead_time),
    default_price: nullableNumber(item.defaultPrice ?? raw.default_price),
    default_supplier_price: nullableNumber(item.defaultSupplierPrice ?? raw.default_supplier_price),
    default_supplier_sku: nullableString(item.defaultSupplierSku ?? raw.default_supplier_sku),
    i_by_l: nullableJson(item.inventoryByLocation ?? raw.i_by_l),
    key_features: nullableJson(item.keyFeaturesRaw ?? raw.key_features),
    marcone_make: nullableString(item.marconeMake ?? raw.marcone_make),
    marcone_part: nullableString(item.marconePart ?? raw.marcone_part),
    master_sku: nullableString(item.masterSku ?? raw.master_sku),
    max_quantity: nullableNumber(item.maxQuantity ?? raw.max_quantity),
    minimum_quantity: nullableNumber(item.minimumQuantity ?? raw.minimum_quantity),
    notes: nullableString(item.notes ?? raw.notes),
    u_key: nullableString(item.uKey ?? raw["u-key"]),
    updated_by: nullableString(item.updatedBy ?? raw.updated_by),
    weight: nullableNumber(item.weight ?? raw.weight),
    source: nullableString(item.systemFieldSource ?? raw.systemFieldSource) || "system_default",
    raw: {
      add_tags: raw.add_tags,
      remove_tags: raw.remove_tags,
      bin_location: raw.bin_location,
      bsc_reporting: raw.bsc_reporting,
      bsc_reporting_updated_at: raw.bsc_reporting_updated_at,
      "cei-id": raw["cei-id"],
      contract_name: raw.contract_name,
      contract_short_description: raw.contract_short_description,
      default_lead_time: raw.default_lead_time,
      default_price: raw.default_price,
      default_supplier_price: raw.default_supplier_price,
      default_supplier_sku: raw.default_supplier_sku,
      i_by_l: raw.i_by_l,
      key_features: raw.key_features,
      marcone_make: raw.marcone_make,
      marcone_part: raw.marcone_part,
      master_sku: raw.master_sku,
      max_quantity: raw.max_quantity,
      minimum_quantity: raw.minimum_quantity,
      notes: raw.notes,
      "u-key": raw["u-key"],
      updated_by: raw.updated_by,
      weight: raw.weight
    }
  };
}

function commercialStateFromRaw(raw = {}) {
  const source = raw.productManagerFields && typeof raw.productManagerFields === "object" ? raw.productManagerFields : raw;
  return {
    altSku: raw.altSku ?? source.alt_sku ?? "",
    minimumAllowedPrice: nullableNumber(raw.minimumAllowedPrice ?? source.minimum_allowed_price) ?? 0,
    fobPriceForZoro: nullableNumber(raw.fobPriceForZoro ?? source.fob_price_for_zoro) ?? 0,
    preferredVendor: raw.preferredVendor ?? source.preferred_vendor ?? "",
    uploadedImage: raw.uploadedImage ?? source.uploaded_image ?? "",
    restrictedStates: raw.restrictedStates ?? source.restricted_states ?? "",
    shipMode: raw.shipMode ?? source.ship_mode ?? "",
    dropShip: boolOrNull(raw.dropShip ?? source.drop_ship),
    showProp65: boolOrNull(raw.showProp65 ?? source.show_prop_65),
    prop65Message: raw.prop65Message ?? source.prop_65_message ?? "",
    warranty: raw.warranty ?? source.warranty ?? "",
    dropShipMinQty: raw.dropShipMinQty ?? source.drop_ship_min_qty ?? "",
    additionalAttributes: raw.additionalAttributes ?? source.additional_attributes ?? "",
    certifications: raw.certifications ?? source.certifications ?? "",
    returnable: raw.returnable ?? source.returnable ?? "",
    competitorPartNumber: raw.competitorPartNumber ?? source.competitor_part_number ?? "",
    oversize: boolOrNull(raw.oversize ?? source.oversize),
    mappedCategory: raw.mappedCategory ?? source.mapped_category ?? null,
    checkedSds: raw.checkedSds ?? source.checked_sds ?? null,
    sourceCategoryId: raw.sourceCategoryId ?? source.category_id ?? "",
    vendorWebsitePrice: nullableNumber(raw.vendorWebsitePrice ?? source.vendor_website_price) ?? 0,
    isBanned: boolOrNull(raw.isBanned ?? source.is_banned),
    isMarketplaceRestricted: boolOrNull(raw.isMarketplaceRestricted ?? source.is_marketplace_restricted),
    bulkPrices: raw.bulkPrices ?? source.bulk_prices ?? [],
    trustedBrand: raw.trustedBrand ?? source.trusted_brand ?? "",
    keywords: raw.keywords ?? source.keywords ?? "",
    subBrand: raw.subBrand ?? source.sub_brand ?? "",
    replacementSku: raw.replacementSku ?? source.replacement_sku ?? "",
    icons: raw.icons ?? source.icons ?? ""
  };
}

async function createVendorFeedRun(run = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const feedRunId = nullableString(run.id || run.feedRunId) || crypto.randomUUID();
  await client.query(`
    insert into vendor_feed_runs (
      feed_run_id, job_id, vendor_id, source_file, status, total_rows,
      processed_rows, changed_rows, missing_rows, started_at, raw, updated_at
    )
    values ($1, $2, $3, $4, $5, $6::int, $7::int, $8::int, $9::int, coalesce($10::timestamptz, now()), $11::jsonb, now())
    on conflict (feed_run_id) do update set
      job_id = coalesce(excluded.job_id, vendor_feed_runs.job_id),
      vendor_id = coalesce(excluded.vendor_id, vendor_feed_runs.vendor_id),
      source_file = coalesce(excluded.source_file, vendor_feed_runs.source_file),
      status = excluded.status,
      total_rows = excluded.total_rows,
      processed_rows = excluded.processed_rows,
      changed_rows = excluded.changed_rows,
      missing_rows = excluded.missing_rows,
      raw = vendor_feed_runs.raw || excluded.raw,
      updated_at = now()
  `, [
    feedRunId,
    nullableString(run.jobId),
    nullableString(run.vendorId),
    nullableString(run.sourceFile || run.fileName),
    nullableString(run.status) || "running",
    nullableNumber(run.totalRows) || 0,
    nullableNumber(run.processedRows) || 0,
    nullableNumber(run.changedRows) || 0,
    nullableNumber(run.missingRows) || 0,
    nullableString(run.startedAt),
    JSON.stringify(run)
  ]);
  return feedRunId;
}

async function finishVendorFeedRun(feedRunId, attrs = {}) {
  const client = getPool();
  const id = nullableString(feedRunId);
  if (!client || !id) return false;
  await initRelationalSchema();
  await client.query(`
    update vendor_feed_runs
    set status = $2,
        total_rows = coalesce($3::int, total_rows),
        processed_rows = coalesce($4::int, processed_rows),
        changed_rows = coalesce($5::int, changed_rows),
        missing_rows = coalesce($6::int, missing_rows),
        finished_at = coalesce($7::timestamptz, now()),
        raw = raw || $8::jsonb,
        updated_at = now()
    where feed_run_id = $1
  `, [
    id,
    nullableString(attrs.status) || "success",
    nullableNumber(attrs.totalRows),
    nullableNumber(attrs.processedRows),
    nullableNumber(attrs.changedRows),
    nullableNumber(attrs.missingRows),
    nullableString(attrs.finishedAt),
    JSON.stringify(attrs)
  ]);
  return true;
}

async function upsertVendorCatalogItemsFromProducts(feedRunId, products = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, items: 0, changes: 0 };
  await initRelationalSchema();
  const sourceProducts = Array.isArray(products) ? products : [];
  const records = sourceProducts.map((item) => vendorCatalogRecordFromProduct(item, feedRunId, options)).filter(Boolean);
  const commercialRecords = sourceProducts.map((item) => productDumpCommercialRecordFromProduct(item)).filter(Boolean);
  const systemRecords = sourceProducts.map((item) => productDumpSystemRecordFromProduct(item)).filter(Boolean);
  if (!records.length) return { enabled: true, items: 0, changes: 0 };
  const source = nullableString(options.source) || "vendor_feed";
  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  let changes = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await client.query("begin");
    try {
      if (!options.currentOnly) {
        await client.query(`
          insert into vendor_catalog_snapshots (
            feed_run_id, vendor_id, source_sku, cost, price, list_price, qty,
            stock_status, to_be_discontinued, raw
          )
          select feed_run_id, vendor_id, source_sku, cost, price, list_price, qty,
            stock_status, to_be_discontinued, raw
          from jsonb_to_recordset($1::jsonb) as x(
            feed_run_id text, vendor_id text, source_sku text, cost numeric, price numeric,
            list_price numeric, qty numeric, stock_status text, to_be_discontinued boolean, raw jsonb
          )
          on conflict (feed_run_id, vendor_id, source_sku) do update set
            cost = excluded.cost,
            price = excluded.price,
            list_price = excluded.list_price,
            qty = excluded.qty,
            stock_status = excluded.stock_status,
            to_be_discontinued = excluded.to_be_discontinued,
            raw = excluded.raw
        `, [JSON.stringify(batch)]);
        const changeResult = await client.query(`
          with incoming as (
            select *
            from jsonb_to_recordset($1::jsonb) as x(
              feed_run_id text, vendor_id text, source_sku text, internal_sku text, vendor_sku text,
              title text, brand text, manufacturer text, mfr_part_number text, barcode text,
              category text, source_category text, cost numeric, price numeric, list_price numeric,
              qty numeric, stock_status text, uom text, uom_qty numeric, to_be_discontinued boolean,
              default_image text, raw jsonb
            )
          ),
          changed as (
            select
              incoming.feed_run_id,
              incoming.source_sku,
              field.field_name,
              field.old_value,
              field.new_value,
              incoming.vendor_id,
              incoming.vendor_sku,
              incoming.raw
            from incoming
            join vendor_catalog_items current
              on current.vendor_id = incoming.vendor_id
             and lower(current.source_sku) = lower(incoming.source_sku)
            cross join lateral (
              values
                ('cost', current.cost::text, incoming.cost::text),
                ('price', current.price::text, incoming.price::text),
                ('list_price', current.list_price::text, incoming.list_price::text),
                ('qty', current.qty::text, incoming.qty::text),
                ('stock_status', current.stock_status, incoming.stock_status),
                ('uom', current.uom, incoming.uom),
                ('uom_qty', current.uom_qty::text, incoming.uom_qty::text),
                ('to_be_discontinued', current.to_be_discontinued::text, incoming.to_be_discontinued::text),
                ('title', current.title, incoming.title),
                ('brand', current.brand, incoming.brand),
                ('mfr_part_number', current.mfr_part_number, incoming.mfr_part_number),
                ('vendor_sku', current.vendor_sku, incoming.vendor_sku),
                ('category', current.category, incoming.category),
                ('default_image', current.default_image, incoming.default_image)
            ) as field(field_name, old_value, new_value)
            where coalesce(field.old_value, '') is distinct from coalesce(field.new_value, '')
          )
          insert into product_change_events (sku, field_name, old_value, new_value, source, job_id, raw)
          select
            source_sku,
            field_name,
            old_value,
            new_value,
            $2,
            feed_run_id,
            jsonb_build_object(
              'vendorId', vendor_id,
              'vendorSku', vendor_sku,
              'feedRunId', feed_run_id,
              'raw', raw
            )
          from changed
        `, [JSON.stringify(batch), source]);
        changes += changeResult.rowCount || 0;
      }
      await client.query(`
        insert into vendor_catalog_items (
          vendor_id, source_sku, internal_sku, vendor_sku, title, brand, manufacturer,
          mfr_part_number, barcode, category, source_category, cost, price, list_price,
          qty, stock_status, uom, uom_qty, to_be_discontinued, default_image, raw,
          last_feed_run_id, last_seen_at, updated_at
        )
        select vendor_id, source_sku, internal_sku, vendor_sku, title, brand, manufacturer,
          mfr_part_number, barcode, category, source_category, cost, price, list_price,
          qty, stock_status, uom, uom_qty, coalesce(to_be_discontinued, false), default_image,
          raw, feed_run_id, now(), now()
        from jsonb_to_recordset($1::jsonb) as x(
          feed_run_id text, vendor_id text, source_sku text, internal_sku text, vendor_sku text,
          title text, brand text, manufacturer text, mfr_part_number text, barcode text,
          category text, source_category text, cost numeric, price numeric, list_price numeric,
          qty numeric, stock_status text, uom text, uom_qty numeric, to_be_discontinued boolean,
          default_image text, raw jsonb
        )
        on conflict (vendor_id, source_sku) do update set
          internal_sku = excluded.internal_sku,
          vendor_sku = excluded.vendor_sku,
          title = excluded.title,
          brand = excluded.brand,
          manufacturer = excluded.manufacturer,
          mfr_part_number = excluded.mfr_part_number,
          barcode = excluded.barcode,
          category = excluded.category,
          source_category = excluded.source_category,
          cost = excluded.cost,
          price = excluded.price,
          list_price = excluded.list_price,
          qty = excluded.qty,
          stock_status = excluded.stock_status,
          uom = excluded.uom,
          uom_qty = excluded.uom_qty,
          to_be_discontinued = excluded.to_be_discontinued,
          default_image = excluded.default_image,
          raw = excluded.raw,
          last_feed_run_id = excluded.last_feed_run_id,
          last_seen_at = now(),
          updated_at = now()
      `, [JSON.stringify(batch)]);
      const commercialBatch = commercialRecords.slice(i, i + batchSize);
      if (commercialBatch.length) {
        await client.query(`
          insert into product_dump_commercial_fields (
            vendor_id, source_sku, alt_sku, minimum_allowed_price,
            fob_price_for_zoro, preferred_vendor, uploaded_image,
            restricted_states, ship_mode, drop_ship, show_prop_65, prop_65_message,
            warranty, drop_ship_min_qty, additional_attributes, certifications,
            returnable, competitor_part_number, oversize, mapped_category, checked_sds,
            category_id, vendor_website_price, is_banned, is_marketplace_restricted,
            bulk_prices, trusted_brand, keywords, sub_brand, replacement_sku, icons,
            raw, updated_at
          )
          select
            vendor_id, source_sku, alt_sku, minimum_allowed_price,
            fob_price_for_zoro, preferred_vendor, uploaded_image,
            restricted_states, ship_mode, drop_ship, show_prop_65, prop_65_message,
            warranty, drop_ship_min_qty, additional_attributes, certifications,
            returnable, competitor_part_number, oversize, mapped_category, checked_sds,
            category_id, vendor_website_price, is_banned, is_marketplace_restricted,
            bulk_prices, trusted_brand, keywords, sub_brand, replacement_sku, icons,
            raw, now()
          from jsonb_to_recordset($1::jsonb) as x(
            vendor_id text, source_sku text, alt_sku text, minimum_allowed_price numeric,
            fob_price_for_zoro numeric, preferred_vendor text, uploaded_image text, restricted_states jsonb,
            ship_mode text, drop_ship boolean, show_prop_65 boolean, prop_65_message text,
            warranty text, drop_ship_min_qty text, additional_attributes text,
            certifications text, returnable text, competitor_part_number text,
            oversize boolean, mapped_category jsonb, checked_sds jsonb, category_id text,
            vendor_website_price numeric, is_banned boolean, is_marketplace_restricted boolean,
            bulk_prices jsonb, trusted_brand text, keywords text, sub_brand text,
            replacement_sku text, icons text, raw jsonb
          )
          on conflict (vendor_id, source_sku) do update set
            alt_sku = excluded.alt_sku,
            minimum_allowed_price = excluded.minimum_allowed_price,
            fob_price_for_zoro = excluded.fob_price_for_zoro,
            preferred_vendor = excluded.preferred_vendor,
            uploaded_image = excluded.uploaded_image,
            restricted_states = excluded.restricted_states,
            ship_mode = excluded.ship_mode,
            drop_ship = excluded.drop_ship,
            show_prop_65 = excluded.show_prop_65,
            prop_65_message = excluded.prop_65_message,
            warranty = excluded.warranty,
            drop_ship_min_qty = excluded.drop_ship_min_qty,
            additional_attributes = excluded.additional_attributes,
            certifications = excluded.certifications,
            returnable = excluded.returnable,
            competitor_part_number = excluded.competitor_part_number,
            oversize = excluded.oversize,
            mapped_category = excluded.mapped_category,
            checked_sds = excluded.checked_sds,
            category_id = excluded.category_id,
            vendor_website_price = excluded.vendor_website_price,
            is_banned = excluded.is_banned,
            is_marketplace_restricted = excluded.is_marketplace_restricted,
            bulk_prices = excluded.bulk_prices,
            trusted_brand = excluded.trusted_brand,
            keywords = excluded.keywords,
            sub_brand = excluded.sub_brand,
            replacement_sku = excluded.replacement_sku,
            icons = excluded.icons,
            raw = excluded.raw,
            updated_at = now()
        `, [JSON.stringify(commercialBatch)]);
      }
      const systemBatch = systemRecords.slice(i, i + batchSize);
      if (systemBatch.length) {
        await client.query(`
          insert into product_dump_system_fields (
            vendor_id, source_sku, add_tags, remove_tags, bin_location,
            bsc_reporting, bsc_reporting_updated_at, cei_id, contract_name,
            contract_short_description, default_lead_time, default_price,
            default_supplier_price, default_supplier_sku, i_by_l, key_features,
            marcone_make, marcone_part, master_sku, max_quantity,
            minimum_quantity, notes, u_key, updated_by, weight, source, raw,
            updated_at
          )
          select
            vendor_id, source_sku, add_tags, remove_tags, bin_location,
            bsc_reporting, bsc_reporting_updated_at, cei_id, contract_name,
            contract_short_description, default_lead_time, default_price,
            default_supplier_price, default_supplier_sku, i_by_l, key_features,
            marcone_make, marcone_part, master_sku, max_quantity,
            minimum_quantity, notes, u_key, updated_by, weight,
            coalesce(source, 'system_default'), raw, now()
          from jsonb_to_recordset($1::jsonb) as x(
            vendor_id text, source_sku text, add_tags jsonb, remove_tags jsonb,
            bin_location text, bsc_reporting jsonb, bsc_reporting_updated_at timestamptz,
            cei_id text, contract_name text, contract_short_description text,
            default_lead_time text, default_price numeric, default_supplier_price numeric,
            default_supplier_sku text, i_by_l jsonb, key_features jsonb,
            marcone_make text, marcone_part text, master_sku text,
            max_quantity numeric, minimum_quantity numeric, notes text, u_key text,
            updated_by text, weight numeric, source text, raw jsonb
          )
          on conflict (vendor_id, source_sku) do update set
            add_tags = excluded.add_tags,
            remove_tags = excluded.remove_tags,
            bin_location = excluded.bin_location,
            bsc_reporting = excluded.bsc_reporting,
            bsc_reporting_updated_at = excluded.bsc_reporting_updated_at,
            cei_id = excluded.cei_id,
            contract_name = excluded.contract_name,
            contract_short_description = excluded.contract_short_description,
            default_lead_time = excluded.default_lead_time,
            default_price = excluded.default_price,
            default_supplier_price = excluded.default_supplier_price,
            default_supplier_sku = excluded.default_supplier_sku,
            i_by_l = excluded.i_by_l,
            key_features = excluded.key_features,
            marcone_make = excluded.marcone_make,
            marcone_part = excluded.marcone_part,
            master_sku = excluded.master_sku,
            max_quantity = excluded.max_quantity,
            minimum_quantity = excluded.minimum_quantity,
            notes = excluded.notes,
            u_key = excluded.u_key,
            updated_by = excluded.updated_by,
            weight = excluded.weight,
            source = excluded.source,
            raw = excluded.raw,
            updated_at = now()
        `, [JSON.stringify(systemBatch)]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  return { enabled: true, items: records.length, changes };
}

function vendorCatalogRowToState(row = {}) {
  const listPrice = isClearanceCatalogItem(row) ? row.list_price ?? row.raw?.listPrice ?? row.raw?.msrp : null;
  const commercial = commercialStateFromRaw(row.raw || {});
  const commercialMinimumAllowedPrice = nullableNumber(row.commercial_minimum_allowed_price);
  if (commercialMinimumAllowedPrice !== null) commercial.minimumAllowedPrice = commercialMinimumAllowedPrice;
  const commercialVendorWebsitePrice = nullableNumber(row.commercial_vendor_website_price);
  if (commercialVendorWebsitePrice !== null) commercial.vendorWebsitePrice = commercialVendorWebsitePrice;
  return {
    ...(row.raw || {}),
    id: row.source_sku || row.raw?.id,
    sku: row.source_sku || row.raw?.sku,
    externalId: row.raw?._id || row.raw?.externalId || row.source_sku,
    title: row.title ?? row.raw?.title,
    marketplaceTitle: row.title ?? row.raw?.marketplaceTitle ?? row.raw?.title,
    brand: row.brand ?? row.raw?.brand,
    sourceBrand: row.brand ?? row.raw?.sourceBrand ?? row.raw?.brand,
    manufacturer: row.manufacturer ?? row.raw?.manufacturer,
    mfrPartNumber: row.mfr_part_number ?? row.raw?.mfrPartNumber,
    vendorSku: row.vendor_sku ?? row.raw?.vendorSku,
    barcode: row.barcode ?? row.raw?.barcode,
    category: row.category ?? row.raw?.category,
    mainCategory: row.category ?? row.raw?.mainCategory,
    sourceCategory: row.source_category ?? row.raw?.sourceCategory,
    vendorCategory: row.source_category ?? row.raw?.vendorCategory,
    supplier: row.raw?.supplier || row.raw?.vendor || row.vendor_id,
    supplierCode: row.raw?.supplierCode || row.vendor_id,
    vendor: row.raw?.vendor || row.raw?.supplier || row.vendor_id,
    cost: row.cost ?? row.raw?.cost,
    sourceCost: row.cost ?? row.raw?.sourceCost ?? row.raw?.cost,
    price: row.price ?? row.raw?.price,
    websitePrice: row.price ?? row.raw?.websitePrice ?? row.raw?.price,
    listPrice,
    msrp: listPrice,
    qty: row.qty ?? row.raw?.qty,
    stockQty: row.qty ?? row.raw?.stockQty ?? row.raw?.qty,
    stockStatus: row.stock_status ?? row.raw?.stockStatus,
    uom: row.uom ?? row.raw?.uom,
    uomQty: row.uom_qty ?? row.raw?.uomQty ?? row.raw?.uom_qty,
    toBeDiscontinued: row.to_be_discontinued ?? row.raw?.toBeDiscontinued,
    closeoutEligible: row.to_be_discontinued ?? row.raw?.closeoutEligible,
    defaultImage: row.default_image ?? row.raw?.defaultImage,
    ...commercial,
    lastSeenAt: row.last_seen_at?.toISOString?.() || row.raw?.lastSeenAt || "",
    updatedAt: row.updated_at?.toISOString?.() || row.raw?.updatedAt || ""
  };
}

function vendorCatalogWhere(options = {}) {
  const q = nullableString(options.q || options.query);
  const filters = options.filters || {};
  const params = [];
  const where = [];
  if (q) {
    const trimmed = q.toLowerCase();
    const includeTextSearch = Boolean(options.textSearchReady);
    const searchExpression = `lower(
      coalesce(source_sku, '') || ' ' ||
      coalesce(internal_sku, '') || ' ' ||
      coalesce(vendor_sku, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(brand, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' ||
      coalesce(mfr_part_number, '') || ' ' ||
      coalesce(barcode, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(source_category, '') || ' ' ||
      coalesce(stock_status, '')
    )`;
    if (/^[a-z0-9_-]{5,}$/i.test(q)) {
      params.push(trimmed, `${trimmed}%`);
      const clauses = [
        `lower(source_sku) = $${params.length - 1}`,
        `lower(coalesce(internal_sku, '')) = $${params.length - 1}`,
        `lower(coalesce(vendor_sku, '')) = $${params.length - 1}`,
        `lower(coalesce(mfr_part_number, '')) = $${params.length - 1}`,
        `lower(coalesce(barcode, '')) = $${params.length - 1}`,
        `lower(source_sku) like $${params.length}`,
        `lower(coalesce(internal_sku, '')) like $${params.length}`,
        `lower(coalesce(vendor_sku, '')) like $${params.length}`
      ];
      if (includeTextSearch) clauses.push(`${searchExpression} like $${params.length}`);
      where.push(`(${clauses.join(" or ")})`);
    } else {
      params.push(includeTextSearch ? `%${trimmed}%` : `${trimmed}%`);
      if (includeTextSearch) {
        where.push(`${searchExpression} like $${params.length}`);
      } else {
        where.push(`(
          lower(source_sku) like $${params.length}
          or lower(coalesce(internal_sku, '')) like $${params.length}
          or lower(coalesce(vendor_sku, '')) like $${params.length}
          or lower(coalesce(mfr_part_number, '')) like $${params.length}
          or lower(coalesce(barcode, '')) like $${params.length}
        )`);
      }
    }
  }
  const suppliers = String(filters.suppliers || filters.supplier || "")
    .split("|")
    .map((value) => nullableString(value)?.toLowerCase())
    .filter(Boolean);
  const supplierKeys = Array.isArray(filters.supplierKeys)
    ? filters.supplierKeys.map((value) => nullableString(value)).filter(Boolean)
    : [];
  if (supplierKeys.length) {
    params.push(supplierKeys);
    where.push(`vendor_id = any($${params.length})`);
  } else if (suppliers.length) {
    params.push(suppliers);
    where.push(`lower(coalesce(vendor_id, '')) = any($${params.length})`);
  }
  const productMembership = nullableString(filters.productMembership);
  if (productMembership === "in-products") {
    where.push(`exists (select 1 from products p where lower(p.sku) = lower(vendor_catalog_items.source_sku))`);
  } else if (productMembership === "not-in-products") {
    where.push(`not exists (select 1 from products p where lower(p.sku) = lower(vendor_catalog_items.source_sku))`);
  }
  const stockStatus = nullableString(filters.stockStatus);
  if (stockStatus) {
    params.push(stockStatus.toLowerCase());
    where.push(`lower(coalesce(stock_status, '')) = $${params.length}`);
  }
  const hasStock = nullableString(filters.hasStock);
  if (hasStock) {
    if (["true", "1", "yes", "in-stock"].includes(hasStock.toLowerCase())) where.push(`coalesce(qty, 0) > 0`);
    if (["false", "0", "no", "out-of-stock"].includes(hasStock.toLowerCase())) where.push(`coalesce(qty, 0) <= 0`);
  }
  const stockQtyOperator = nullableString(filters.stockQtyOperator);
  const stockQtyValues = String(filters.stockQty || "")
    .split("|")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (stockQtyOperator === "empty") {
    where.push(`qty is null`);
  } else if (stockQtyOperator === "notEmpty") {
    where.push(`qty is not null`);
  } else if (stockQtyOperator && stockQtyValues.length) {
    params.push(stockQtyValues[0]);
    const firstParam = params.length;
    if (stockQtyOperator === "gt") where.push(`qty > $${firstParam}`);
    else if (stockQtyOperator === "gte") where.push(`qty >= $${firstParam}`);
    else if (stockQtyOperator === "lt") where.push(`qty < $${firstParam}`);
    else if (stockQtyOperator === "lte") where.push(`qty <= $${firstParam}`);
    else if (stockQtyOperator === "between") {
      params.push(stockQtyValues[1] ?? stockQtyValues[0]);
      where.push(`qty >= $${firstParam} and qty <= $${params.length}`);
    } else {
      where.push(`qty = $${firstParam}`);
    }
  }
  const discontinued = nullableString(filters.toBeDiscontinued || filters.discontinued);
  if (discontinued) {
    params.push(["true", "1", "yes", "y"].includes(discontinued.toLowerCase()));
    where.push(`coalesce(to_be_discontinued, false) = $${params.length}`);
  }
  const brand = nullableString(filters.brand);
  if (brand) {
    params.push(brand.toLowerCase());
    where.push(`lower(coalesce(brand, '')) = $${params.length}`);
  }
  const category = nullableString(filters.category);
  if (category) {
    params.push(category.toLowerCase());
    where.push(`lower(coalesce(source_category, category, '')) = $${params.length}`);
  }
  const hazardous = nullableString(filters.hazardous);
  if (hazardous) {
    params.push(["true", "1", "yes", "y"].includes(hazardous.toLowerCase()));
    where.push(`case when lower(coalesce(raw ->> 'hazardous', 'false')) in ('true','1','yes','y') then true else false end = $${params.length}`);
  }
  const active = nullableString(filters.active);
  if (active) {
    params.push(["true", "1", "yes", "active"].includes(active.toLowerCase()));
    where.push(`case when lower(coalesce(raw ->> 'active', 'true')) in ('true','1','yes','active') then true else false end = $${params.length}`);
  }
  return {
    params,
    whereSql: where.length ? `where ${where.join(" and ")}` : ""
  };
}

async function vendorCatalogFiltersWithSupplierKeys(client, filters = {}) {
  const suppliers = String(filters.suppliers || filters.supplier || "")
    .split("|")
    .map((value) => nullableString(value))
    .filter(Boolean);
  const existingSupplierKeys = Array.isArray(filters.supplierKeys)
    ? filters.supplierKeys.map((value) => nullableString(value)).filter(Boolean)
    : [];
  if (!suppliers.length && !existingSupplierKeys.length) return filters;
  const lowerSuppliers = [...new Set(suppliers.map((value) => value.toLowerCase()))];
  const keys = new Set([...existingSupplierKeys, ...suppliers]);
  for (const value of suppliers) {
    keys.add(value.toLowerCase());
    keys.add(value.toUpperCase());
  }
  if (lowerSuppliers.length) try {
    const facetResult = await client.query(`
      select facet_value, display_value
      from vendor_catalog_facets
      where facet_type = 'supplier'
        and (
          lower(coalesce(facet_value, '')) = any($1)
          or lower(coalesce(display_value, '')) = any($1)
        )
    `, [lowerSuppliers]);
    for (const row of facetResult.rows) {
      if (row.facet_value) keys.add(row.facet_value);
      if (row.display_value) keys.add(row.display_value);
    }
    const vendorResult = await client.query(`
      select vendor_id, code, name
      from vendors
      where lower(coalesce(vendor_id, '')) = any($1)
         or lower(coalesce(code, '')) = any($1)
         or lower(coalesce(name, '')) = any($1)
    `, [lowerSuppliers]);
    for (const row of vendorResult.rows) {
      if (row.vendor_id) keys.add(row.vendor_id);
      if (row.code) {
        keys.add(row.code);
        keys.add(String(row.code).toUpperCase());
        keys.add(String(row.code).toLowerCase());
      }
    }
  } catch {
    // Keep the user-provided supplier keys; vendor alias resolution is a convenience.
  }
  return { ...filters, supplierKeys: [...keys] };
}

async function listVendorCatalogItems(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(500, Number(options.limit || 50)));
  const page = Math.max(1, Number(options.page || 1));
  const offset = (page - 1) * limit;
  const exactQ = nullableString(options.q || options.query)?.toLowerCase();
  const filters = await vendorCatalogFiltersWithSupplierKeys(client, options.filters || {});
  const hasUserFilters = Object.values(filters).some((value) => nullableString(value));
  if (exactQ && /^[a-z0-9_-]{5,}$/i.test(exactQ) && !hasUserFilters) {
    const result = await client.query(`
      with matches as (
        select * from vendor_catalog_items where lower(source_sku) = $1
        union all
        select * from vendor_catalog_items where lower(coalesce(internal_sku, '')) = $1
        union all
        select * from vendor_catalog_items where lower(coalesce(vendor_sku, '')) = $1
      )
      select distinct on (vendor_id, source_sku) *
      from matches
      order by vendor_id, source_sku
      limit $2 offset $3
    `, [exactQ, limit + 1, offset]);
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(vendorCatalogRowToState),
      total: offset + rows.length + (result.rows.length > limit ? 1 : 0),
      page,
      limit
    };
  }
  const textSearchReady = (await client.query("select to_regclass('vendor_catalog_items_search_trgm_idx') is not null as ready")).rows[0]?.ready;
  const { params, whereSql } = vendorCatalogWhere({ ...options, filters, textSearchReady });
  const q = nullableString(options.q || options.query);
  const useFastWindow = Boolean(q);
  const listParams = [...params, useFastWindow ? limit + 1 : limit, offset];
  const result = await client.query(`
    select *
    from vendor_catalog_items
    ${whereSql}
    order by source_sku
    limit $${listParams.length - 1} offset $${listParams.length}
  `, listParams);
  let total = 0;
  let rows = result.rows;
  if (useFastWindow) {
    const hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
    total = offset + rows.length + (hasMore ? 1 : 0);
  } else {
    const hasFilters = whereSql.trim() !== "";
    if (hasFilters) {
      const countResult = await client.query(`select count(*)::int as total from vendor_catalog_items ${whereSql}`, params);
      total = countResult.rows[0]?.total || 0;
    } else {
      const estimate = await client.query("select greatest(reltuples::bigint, 0)::bigint as total from pg_class where oid = 'vendor_catalog_items'::regclass");
      total = Number(estimate.rows[0]?.total || 0);
    }
  }
  return {
    items: rows.map(vendorCatalogRowToState),
    total,
    page,
    limit
  };
}

async function collectVendorCatalogItems(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(25000, Number(options.limit || 10000)));
  const filters = await vendorCatalogFiltersWithSupplierKeys(client, options.filters || {});
  const textSearchReady = (await client.query("select to_regclass('vendor_catalog_items_search_trgm_idx') is not null as ready")).rows[0]?.ready;
  const { params, whereSql } = vendorCatalogWhere({ ...options, filters, textSearchReady });
  const includeCount = options.includeCount !== false;
  const listLimit = includeCount ? limit : limit + 1;
  const listParams = [...params, listLimit];
  const result = await client.query(`
    select *
    from vendor_catalog_items
    ${whereSql}
    order by source_sku
    limit $${listParams.length}
  `, listParams);
  const rows = includeCount ? result.rows : result.rows.slice(0, limit);
  const countResult = includeCount ? await client.query(`select count(*)::int as total from vendor_catalog_items ${whereSql}`, params) : { rows: [] };
  return {
    items: rows.map(vendorCatalogRowToState),
    matched: includeCount ? (countResult.rows[0]?.total || 0) : rows.length + (result.rows.length > limit ? 1 : 0),
    limited: includeCount ? result.rows.length >= limit : result.rows.length > limit
  };
}

async function listVendorCategoryMappingSources(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 500)));
  const supplier = nullableString(options.supplier || options.vendor || "");
  const supplierKeys = supplier
    ? [...new Set([supplier, supplier.toLowerCase(), supplier.toUpperCase()])]
    : [];
  if (!supplier) return [];
  if (supplier.toLowerCase() === "essendant") supplierKeys.push("uss", "USS");
  if (supplier) {
    const aliasResult = await client.query(`
      select vendor_id, code, name
      from vendors
      where lower(coalesce(vendor_id, '')) = lower($1)
         or lower(coalesce(code, '')) = lower($1)
         or lower(coalesce(name, '')) = lower($1)
    `, [supplier]);
    for (const row of aliasResult.rows) {
      if (row.vendor_id) supplierKeys.push(row.vendor_id);
      if (row.code) supplierKeys.push(row.code, String(row.code).toLowerCase(), String(row.code).toUpperCase());
      if (row.name) supplierKeys.push(row.name);
    }
  }
  const params = [];
  const where = [];
  if (supplierKeys.length) {
    params.push([...new Set(supplierKeys.map((value) => String(value || "").trim()).filter(Boolean))]);
    where.push(`vendor_id = any($${params.length})`);
  }
  const categoryQuery = nullableString(options.q || options.query || "");
  if (categoryQuery) {
    params.push(`%${categoryQuery.toLowerCase()}%`);
    where.push(`lower(coalesce(source_category, category, '')) like $${params.length}`);
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  params.push(limit);
  const result = await client.query(`
    select
      coalesce(nullif(raw ->> 'supplier', ''), nullif(raw ->> 'vendor', ''), nullif(vendor_id, ''), 'Unknown') as supplier,
      coalesce(nullif(source_category, ''), nullif(category, ''), 'Uncategorized') as vendor_category,
      min(coalesce(nullif(source_sku, ''), nullif(internal_sku, ''), nullif(vendor_sku, ''))) as sample_sku,
      count(*)::int as match_count
    from vendor_catalog_items
    ${whereSql}
    group by 1, 2
    order by count(*) desc, vendor_category
    limit $${params.length}
  `, params);
  return result.rows.map((row) => ({
    supplier: supplier || row.supplier || "",
    vendorCategory: row.vendor_category || "",
    sampleSku: row.sample_sku || "",
    matchCount: Number(row.match_count || 0)
  }));
}

async function applyVendorCategoryMainMapping(options = {}) {
  const client = getPool();
  if (!client) return { updatedProducts: 0 };
  await initRelationalSchema();
  const supplier = nullableString(options.supplier || options.vendor || "");
  const vendorCategory = nullableString(options.vendorCategory || options.sourceCategory || options.category || "");
  const mainCategory = nullableString(options.mainCategory || vendorCategory || "");
  if (!supplier || !vendorCategory || !mainCategory) return { updatedProducts: 0 };
  const supplierKeys = [...new Set([supplier, supplier.toLowerCase(), supplier.toUpperCase()])];
  if (supplier.toLowerCase() === "essendant") supplierKeys.push("USS", "uss");
  const result = await client.query(`
    update products
    set
      category = $3,
      main_category = $3,
      raw = coalesce(raw, '{}'::jsonb)
        || jsonb_build_object(
          'categoryVerified', true,
          'vendorCategoryMappingUpdatedAt', now(),
          'vendorCategoryMappedFrom', 'vendor-category-main'
        ),
      updated_at = now()
    where lower(coalesce(source_category, raw ->> 'vendorCategory', category, '')) = lower($2)
      and (
        lower(coalesce(supplier, raw ->> 'supplier', raw ->> 'vendor', '')) = lower($1)
        or supplier_code = any($4)
        or lower(coalesce(raw ->> 'supplierCode', raw ->> 'defaultSupplier', '')) in (select lower(x) from unnest($4::text[]) x)
      )
  `, [supplier, vendorCategory, mainCategory, supplierKeys]);
  return { updatedProducts: Number(result.rowCount || 0) };
}

async function readVendorCatalogItemsBySkus(skus = []) {
  const client = getPool();
  if (!client) return null;
  const values = [...new Set((Array.isArray(skus) ? skus : []).map((sku) => nullableString(sku)?.toLowerCase()).filter(Boolean))];
  if (!values.length) return [];
  await initRelationalSchema();
  const result = await client.query(`
    with matched as (
      select *
      from vendor_catalog_items
      where lower(source_sku) = any($1)
      union all
      select *
      from vendor_catalog_items
      where lower(internal_sku) = any($1)
      union all
      select *
      from vendor_catalog_items
      where lower(vendor_sku) = any($1)
    )
    select distinct on (matched.source_sku)
      matched.*,
      commercial.minimum_allowed_price as commercial_minimum_allowed_price,
      commercial.vendor_website_price as commercial_vendor_website_price
    from matched
    left join product_dump_commercial_fields commercial
      on lower(commercial.source_sku) = lower(matched.source_sku)
    order by matched.source_sku, matched.updated_at desc
  `, [values]);
  return result.rows.map(vendorCatalogRowToState);
}

async function vendorCatalogFacets() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const liveSupplierValues = async () => {
    const result = await client.query(`
      select value
      from (
        select name as value from vendors where coalesce(name, '') <> ''
        union
        select code as value from vendors where coalesce(code, '') <> ''
        union
        select vendor_id as value from vendor_catalog_items where coalesce(vendor_id, '') <> ''
      ) values
      where coalesce(value, '') <> ''
      order by value
      limit 50000
    `);
    return result.rows.map((row) => row.value).filter(Boolean);
  };
  try {
    const cached = await client.query(`
      select facet_type, display_value, facet_value, row_count
      from vendor_catalog_facets
      where facet_type in ('supplier', 'brand', 'category', 'stock_status')
      order by facet_type, display_value nulls last, facet_value
    `);
    if (cached.rows.length) {
      const grouped = { supplier: [], brand: [], category: [], stock_status: [] };
      for (const row of cached.rows) {
        grouped[row.facet_type]?.push(row.display_value || row.facet_value);
      }
      const totalResult = await client.query(`select greatest(reltuples::bigint, 0)::bigint as total from pg_class where oid = 'vendor_catalog_items'::regclass`).catch(() => ({ rows: [] }));
      return {
        suppliers: grouped.supplier,
        brands: grouped.brand,
        categories: grouped.category,
        stockStatuses: grouped.stock_status,
        total: totalResult.rows[0]?.total || 0,
        cached: true
      };
    }
  } catch {
    // Fall back to live facet queries if the cache is unavailable during migration.
  }
  const facetQuery = async (sql, params = []) => {
    try {
      const result = await client.query(sql, params);
      return result.rows.map((row) => row.value).filter(Boolean);
    } catch {
      return [];
    }
  };
  const [suppliers, brands, categories, stockStatuses, totalResult] = await Promise.all([
    liveSupplierValues(),
    facetQuery(`
      select brand as value
      from vendor_catalog_items
      where coalesce(brand, '') <> ''
      group by brand
      order by brand
      limit 1000
    `),
    facetQuery(`
      select category as value
      from vendor_catalog_items
      where coalesce(category, '') <> ''
      group by category
      order by category
      limit 2000
    `),
    facetQuery(`
      select stock_status as value
      from vendor_catalog_items
      where coalesce(stock_status, '') <> ''
      group by stock_status
      order by stock_status
      limit 100
    `),
    client.query(`select greatest(reltuples::bigint, 0)::bigint as total from pg_class where oid = 'vendor_catalog_items'::regclass`).catch(() => ({ rows: [] }))
  ]);
  return {
    suppliers,
    brands,
    categories,
    stockStatuses,
    total: totalResult.rows[0]?.total || 0,
    cached: false
  };
}

async function refreshVendorCatalogFacets({ onProgress, isCanceled } = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const checkCanceled = () => {
    if (typeof isCanceled === "function" && isCanceled()) throw new Error("Source catalog facet refresh canceled.");
  };
  const startedAt = Date.now();
  const runStep = async (phase, sql) => {
    checkCanceled();
    progress({ phase, message: phase.replace(/_/g, " "), processedRows: 0, totalRows: 4 });
    await client.query(sql);
    checkCanceled();
  };
  await runStep("clearing_facets", `delete from vendor_catalog_facets`);
  await runStep("supplier_facets", `
    insert into vendor_catalog_facets (facet_type, facet_value, display_value, row_count, updated_at)
    select 'supplier', item.vendor_id, coalesce(v.name, v.code, item.vendor_id), count(*)::bigint, now()
    from vendor_catalog_items item
    left join vendors v on v.vendor_id = item.vendor_id
    where coalesce(item.vendor_id, '') <> ''
    group by item.vendor_id, v.name, v.code
    order by coalesce(v.name, v.code, item.vendor_id)
    on conflict (facet_type, facet_value) do update
      set display_value = excluded.display_value,
          row_count = excluded.row_count,
          updated_at = now()
  `);
  await runStep("brand_facets", `
    insert into vendor_catalog_facets (facet_type, facet_value, display_value, row_count, updated_at)
    select 'brand', lower(brand), min(brand), count(*)::bigint, now()
    from vendor_catalog_items
    where coalesce(brand, '') <> ''
    group by lower(brand)
    order by min(brand)
    limit 2000
    on conflict (facet_type, facet_value) do update
      set display_value = excluded.display_value,
          row_count = excluded.row_count,
          updated_at = now()
  `);
  await runStep("category_facets", `
    insert into vendor_catalog_facets (facet_type, facet_value, display_value, row_count, updated_at)
    select 'category', category, category, count(*)::bigint, now()
    from vendor_catalog_items
    where coalesce(category, '') <> ''
    group by category
    order by category
    limit 5000
    on conflict (facet_type, facet_value) do update
      set display_value = excluded.display_value,
          row_count = excluded.row_count,
          updated_at = now()
  `);
  await runStep("stock_status_facets", `
    insert into vendor_catalog_facets (facet_type, facet_value, display_value, row_count, updated_at)
    select 'stock_status', stock_status, stock_status, count(*)::bigint, now()
    from vendor_catalog_items
    where coalesce(stock_status, '') <> ''
    group by stock_status
    order by stock_status
    limit 250
    on conflict (facet_type, facet_value) do update
      set display_value = excluded.display_value,
          row_count = excluded.row_count,
          updated_at = now()
  `);
  progress({ phase: "complete", processedRows: 4, totalRows: 4, progressPercent: 100 });
  const facets = await vendorCatalogFacets();
  return { ...facets, durationMs: Date.now() - startedAt };
}

async function sourceCatalogSearchIndexStatus() {
  const client = getPool();
  if (!client) return { enabled: false, ready: false };
  await initRelationalSchema();
  const index = await client.query(`
    select
      c.relname as index_name,
      i.indisvalid as valid,
      i.indisready as ready
    from pg_class c
    join pg_index i on i.indexrelid = c.oid
    where c.relname = 'vendor_catalog_items_search_trgm_idx'
    limit 1
  `);
  const progress = await client.query(`
    select pid, phase, blocks_total, blocks_done, tuples_total, tuples_done
    from pg_stat_progress_create_index
    where index_relid = to_regclass('vendor_catalog_items_search_trgm_idx')
       or command like 'CREATE INDEX%'
  `);
  const row = index.rows[0] || {};
  const progressRow = progress.rows[0] || null;
  const tupleTotal = Number(progressRow?.tuples_total || 0);
  const tupleDone = Number(progressRow?.tuples_done || 0);
  const blockTotal = Number(progressRow?.blocks_total || 0);
  const blockDone = Number(progressRow?.blocks_done || 0);
  const total = tupleTotal > 0 ? tupleTotal : blockTotal;
  const done = tupleTotal > 0 ? tupleDone : blockDone;
  return {
    enabled: true,
    exists: Boolean(row.index_name),
    valid: Boolean(row.valid),
    ready: Boolean(row.ready && row.valid),
    building: Boolean(progressRow),
    phase: progressRow?.phase || "",
    pid: progressRow?.pid || null,
    processedRows: done,
    totalRows: total,
    progressPercent: total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : (row.valid ? 100 : 0)
  };
}

function productChangeDirection(fieldName = "", oldValue = "", newValue = "") {
  const field = String(fieldName || "");
  if (field === "to_be_discontinued" || field === "toBeDiscontinued") {
    const next = String(newValue || "").toLowerCase();
    if (["true", "1", "yes", "y"].includes(next)) return "closeout";
    return "changed";
  }
  const before = Number(oldValue);
  const after = Number(newValue);
  if (Number.isFinite(before) && Number.isFinite(after)) {
    if (after > before) return "up";
    if (after < before) return "down";
  }
  return "changed";
}

function productChangeRowToState(row = {}) {
  const direction = productChangeDirection(row.field_name, row.old_value, row.new_value);
  const beforeNumber = Number(row.old_value);
  const afterNumber = Number(row.new_value);
  const numeric = Number.isFinite(beforeNumber) && Number.isFinite(afterNumber);
  const delta = numeric ? afterNumber - beforeNumber : null;
  const deltaPercent = numeric && beforeNumber !== 0 ? (delta / Math.abs(beforeNumber)) * 100 : null;
  const raw = row.raw || {};
  return {
    id: row.event_id,
    sku: row.sku || "",
    productId: row.resolved_product_id || row.product_id || "",
    activeCatalog: row.active_catalog === true,
    field: row.field_name || "",
    before: row.old_value,
    after: row.new_value,
    oldValue: row.old_value,
    newValue: row.new_value,
    delta,
    deltaPercent,
    direction,
    source: row.source || "",
    jobId: row.job_id || "",
    supplier: row.supplier || raw.vendorId || raw.raw?.supplier || raw.raw?.vendor || "",
    vendorId: raw.vendorId || "",
    vendorSku: row.vendor_sku || raw.vendorSku || raw.raw?.vendorSku || "",
    title: row.title || raw.raw?.title || raw.raw?.marketplaceTitle || "",
    brand: row.brand || raw.raw?.brand || "",
    category: row.category || raw.raw?.category || "",
    importedAt: row.created_at?.toISOString?.() || "",
    createdAt: row.created_at?.toISOString?.() || "",
    raw
  };
}

function productChangeWhere(options = {}) {
  const params = [];
  const where = [];
  const trackedFields = Array.isArray(options.trackedFields)
    ? options.trackedFields.map((field) => nullableString(field)).filter(Boolean)
    : [];
  const q = nullableString(options.q || options.query);
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(coalesce(e.sku, '')) like $${params.length}
      or lower(coalesce(v.vendor_sku, '')) like $${params.length}
      or lower(coalesce(v.title, '')) like $${params.length}
      or lower(coalesce(v.brand, '')) like $${params.length}
      or lower(coalesce(v.mfr_part_number, '')) like $${params.length}
      or lower(coalesce(v.category, '')) like $${params.length}
      or lower(coalesce(e.raw ->> 'vendorSku', '')) like $${params.length}
    )`);
  }
  const field = nullableString(options.field);
  if (field && field !== "all") {
    params.push(field);
    where.push(`e.field_name = $${params.length}`);
  } else if (trackedFields.length && options.includeUntracked !== true) {
    params.push(trackedFields);
    where.push(`e.field_name = any($${params.length}::text[])`);
  }
  const view = nullableString(options.view || options.scope);
  if (view === "active") {
    where.push(`p.product_id is not null and coalesce(p.active, true) = true`);
  } else if (view === "opportunities") {
    const minCutPercent = Math.max(1, Math.min(95, Number(options.minPriceCutPercent || options.priceCutPercent || 20)));
    params.push(minCutPercent);
    const cutParam = params.length;
    where.push(`exists (
      select 1
      from vendor_catalog_items current_item
      where lower(current_item.source_sku) = lower(e.sku)
        and coalesce(current_item.to_be_discontinued, false) = true
        and coalesce(current_item.qty, 0) > 0
    )`);
    where.push(`(
      (e.field_name in ('cost','price','list_price','sourceCost','websitePrice')
        and e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
        and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
        and e.old_value::numeric > 0
        and e.new_value::numeric < e.old_value::numeric
        and ((e.old_value::numeric - e.new_value::numeric) / abs(e.old_value::numeric)) * 100 >= $${cutParam})
      or (e.field_name in ('to_be_discontinued','toBeDiscontinued')
        and lower(coalesce(e.new_value, '')) in ('true','1','yes','y')
        and coalesce(e.raw #>> '{raw,msrp}', e.raw #>> '{raw,listPrice}', e.raw #>> '{raw,list_price}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        and coalesce(e.raw #>> '{raw,price}', e.raw #>> '{raw,websitePrice}', e.raw #>> '{raw,cost}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        and coalesce(e.raw #>> '{raw,msrp}', e.raw #>> '{raw,listPrice}', e.raw #>> '{raw,list_price}')::numeric > 0
        and coalesce(e.raw #>> '{raw,price}', e.raw #>> '{raw,websitePrice}', e.raw #>> '{raw,cost}')::numeric < coalesce(e.raw #>> '{raw,msrp}', e.raw #>> '{raw,listPrice}', e.raw #>> '{raw,list_price}')::numeric
        and ((coalesce(e.raw #>> '{raw,msrp}', e.raw #>> '{raw,listPrice}', e.raw #>> '{raw,list_price}')::numeric - coalesce(e.raw #>> '{raw,price}', e.raw #>> '{raw,websitePrice}', e.raw #>> '{raw,cost}')::numeric) / abs(coalesce(e.raw #>> '{raw,msrp}', e.raw #>> '{raw,listPrice}', e.raw #>> '{raw,list_price}')::numeric)) * 100 >= $${cutParam})
    )`);
  }
  const catalogPresence = nullableString(options.catalogPresence || options.catalog || options.productPresence);
  if (catalogPresence && catalogPresence !== "all") {
    if (catalogPresence === "active") {
      where.push(`p.product_id is not null and coalesce(p.active, true) = true`);
    } else if (catalogPresence === "products" || catalogPresence === "product") {
      where.push(`p.product_id is not null`);
    } else if (catalogPresence === "source-only" || catalogPresence === "sourceOnly") {
      where.push(`p.product_id is null`);
    } else if (catalogPresence === "inactive") {
      where.push(`p.product_id is not null and coalesce(p.active, true) = false`);
    }
  }
  const discontinued = nullableString(options.discontinued || options.closeout);
  if (discontinued && discontinued !== "all") {
    where.push(`exists (
      select 1
      from vendor_catalog_items discontinued_item
      where lower(discontinued_item.source_sku) = lower(e.sku)
        and (coalesce(e.raw ->> 'vendorId', '') = '' or discontinued_item.vendor_id = e.raw ->> 'vendorId')
        and coalesce(discontinued_item.to_be_discontinued, false) = ${["yes", "true", "1"].includes(discontinued.toLowerCase()) ? "true" : "false"}
    )`);
  }
  const stock = nullableString(options.stock || options.stockAvailability);
  if (stock && stock !== "all") {
    if (stock === "in-stock" || stock === "inStock") {
      where.push(`exists (
        select 1
        from vendor_catalog_items stock_item
        where lower(stock_item.source_sku) = lower(e.sku)
          and (coalesce(e.raw ->> 'vendorId', '') = '' or stock_item.vendor_id = e.raw ->> 'vendorId')
          and coalesce(stock_item.qty, 0) > 0
      )`);
    } else if (stock === "out-of-stock" || stock === "outOfStock") {
      where.push(`exists (
        select 1
        from vendor_catalog_items stock_item
        where lower(stock_item.source_sku) = lower(e.sku)
          and (coalesce(e.raw ->> 'vendorId', '') = '' or stock_item.vendor_id = e.raw ->> 'vendorId')
          and coalesce(stock_item.qty, 0) <= 0
      )`);
    }
  }
  const priceCut = nullableString(options.priceCut || options.priceMovement);
  const priceCutValue = String(priceCut || "").toLowerCase();
  if (["yes", "true", "1", "cut", "price-cut"].includes(priceCutValue)) {
    const minCutPercent = Math.max(1, Math.min(95, Number(options.minPriceCutPercent || options.priceCutPercent || 20)));
    params.push(minCutPercent);
    where.push(`e.field_name in ('cost','price','list_price','sourceCost','websitePrice')
      and e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
      and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
      and e.old_value::numeric > 0
      and e.new_value::numeric < e.old_value::numeric
      and ((e.old_value::numeric - e.new_value::numeric) / abs(e.old_value::numeric)) * 100 >= $${params.length}`);
  }
  const source = nullableString(options.source);
  if (source && source !== "all") {
    params.push(source);
    where.push(`e.source = $${params.length}`);
  }
  const vendor = nullableString(options.vendor || options.supplier);
  if (vendor && vendor !== "all") {
    params.push(vendor.toLowerCase());
    where.push(`(
      lower(coalesce(v.vendor_id, '')) = $${params.length}
      or lower(coalesce(v.raw ->> 'supplier', '')) = $${params.length}
      or lower(coalesce(v.raw ->> 'vendor', '')) = $${params.length}
      or lower(coalesce(e.raw ->> 'vendorId', '')) = $${params.length}
    )`);
  }
  const direction = nullableString(options.direction);
  if (direction && direction !== "all") {
    if (direction === "closeout") {
      where.push(`e.field_name in ('to_be_discontinued','toBeDiscontinued') and lower(coalesce(e.new_value, '')) in ('true','1','yes','y')`);
    } else if (["up", "down"].includes(direction)) {
      where.push(`e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and (e.new_value::numeric ${direction === "up" ? ">" : "<"} e.old_value::numeric)`);
    } else if (direction === "changed") {
      where.push(`not (e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value::numeric <> e.old_value::numeric)`);
    }
  }
  const from = nullableString(options.from || options.dateFrom);
  if (from) {
    params.push(from);
    where.push(`e.created_at >= $${params.length}::timestamptz`);
  }
  const to = nullableString(options.to || options.dateTo);
  if (to) {
    params.push(to);
    where.push(`e.created_at < ($${params.length}::date + interval '1 day')`);
  }
  return { params, whereSql: where.length ? `where ${where.join(" and ")}` : "" };
}

async function listProductChangeEvents(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 500)));
  const page = Math.max(1, Number(options.page || 1));
  const offset = (page - 1) * limit;
  const skipMeta = options.skipMeta === true;
  const { params, whereSql } = productChangeWhere(options);
  const listParams = [...params, limit, offset];
  const rows = await client.query(`
    select
      e.event_id, e.product_id, e.sku, e.field_name, e.old_value, e.new_value,
      e.source, e.job_id, e.raw, e.created_at,
      coalesce(e.product_id, p.product_id) as resolved_product_id,
      coalesce(p.active, false) as active_catalog,
      v.vendor_id, v.vendor_sku, v.title, v.brand, v.category
    from product_change_events e
    left join products p on lower(p.sku) = lower(e.sku)
    left join lateral (
      select vendor_id, vendor_sku, title, brand, category, mfr_part_number, raw
      from vendor_catalog_items item
      where lower(item.source_sku) = lower(e.sku)
        and (coalesce(e.raw ->> 'vendorId', '') = '' or item.vendor_id = e.raw ->> 'vendorId')
      order by (item.source_sku = e.sku) desc, item.updated_at desc
      limit 1
    ) v on true
    ${whereSql}
    order by e.created_at desc, e.event_id desc
    limit $${listParams.length - 1} offset $${listParams.length}
  `, listParams);
  if (skipMeta) {
    return {
      rows: rows.rows.map(productChangeRowToState),
      total: null,
      page,
      limit,
      summary: {},
      facets: {},
      database: "postgres"
    };
  }
  const count = await client.query(`
    select count(*)::int as total
    from product_change_events e
    left join products p on lower(p.sku) = lower(e.sku)
    left join lateral (
      select vendor_id, vendor_sku, title, brand, category, mfr_part_number, raw
      from vendor_catalog_items item
      where lower(item.source_sku) = lower(e.sku)
        and (coalesce(e.raw ->> 'vendorId', '') = '' or item.vendor_id = e.raw ->> 'vendorId')
      order by (item.source_sku = e.sku) desc, item.updated_at desc
      limit 1
    ) v on true
    ${whereSql}
  `, params);
  const summary = await client.query(`
    select
      count(*)::int as total,
      count(*) filter (where e.field_name in ('cost','price','list_price','sourceCost','websitePrice'))::int as cost_changes,
      count(*) filter (where e.field_name in ('qty','stock_status','stockQty','stockStatus'))::int as stock_changes,
      count(*) filter (where e.field_name in ('to_be_discontinued','toBeDiscontinued') and lower(coalesce(e.new_value, '')) in ('true','1','yes','y'))::int as closeouts,
      count(*) filter (where e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value::numeric > e.old_value::numeric)::int as up,
      count(*) filter (where e.old_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and e.new_value::numeric < e.old_value::numeric)::int as down
    from product_change_events e
    left join products p on lower(p.sku) = lower(e.sku)
    left join lateral (
      select vendor_id, vendor_sku, title, brand, category, mfr_part_number, raw
      from vendor_catalog_items item
      where lower(item.source_sku) = lower(e.sku)
        and (coalesce(e.raw ->> 'vendorId', '') = '' or item.vendor_id = e.raw ->> 'vendorId')
      order by (item.source_sku = e.sku) desc, item.updated_at desc
      limit 1
    ) v on true
    ${whereSql}
  `, params);
  const facets = await client.query(`
    select
      (select jsonb_agg(field_name order by field_name) from (select distinct field_name from product_change_events where field_name is not null) f) as fields,
      (select jsonb_agg(source order by source) from (select distinct source from product_change_events where source is not null and source <> '') s) as sources,
      (select jsonb_agg(vendor_id order by vendor_id) from (
        select distinct coalesce(v.vendor_id, e.raw ->> 'vendorId') as vendor_id
        from product_change_events e
        left join lateral (
          select vendor_id
          from vendor_catalog_items item
          where lower(item.source_sku) = lower(e.sku)
            and (coalesce(e.raw ->> 'vendorId', '') = '' or item.vendor_id = e.raw ->> 'vendorId')
          order by (item.source_sku = e.sku) desc, item.updated_at desc
          limit 1
        ) v on true
        where coalesce(v.vendor_id, e.raw ->> 'vendorId') is not null
      ) v) as vendors
  `);
  const summaryRow = summary.rows[0] || {};
  return {
    rows: rows.rows.map(productChangeRowToState),
    total: count.rows[0]?.total || 0,
    page,
    limit,
    summary: {
      total: Number(summaryRow.total || 0),
      costChanges: Number(summaryRow.cost_changes || 0),
      stockChanges: Number(summaryRow.stock_changes || 0),
      closeouts: Number(summaryRow.closeouts || 0),
      up: Number(summaryRow.up || 0),
      down: Number(summaryRow.down || 0)
    },
    facets: {
      fields: facets.rows[0]?.fields || [],
      sources: facets.rows[0]?.sources || [],
      vendors: facets.rows[0]?.vendors || []
    },
    database: "postgres"
  };
}

async function exportProductChangeEventsCsv(options = {}) {
  const result = await listProductChangeEvents({ ...options, limit: Math.min(25000, Number(options.limit || 25000)), page: 1 });
  return result;
}

async function buildSourceCatalogSearchIndex({ isCanceled, onProgress } = {}) {
  const pool = getPool();
  if (!pool) return { enabled: false, ready: false };
  await initRelationalSchema();
  await pool.query("create extension if not exists pg_trgm");
  const invalid = await pool.query(`
    select c.relname
    from pg_class c
    join pg_index i on i.indexrelid = c.oid
    where c.relname = 'vendor_catalog_items_search_trgm_idx'
      and i.indisvalid = false
  `);
  if (invalid.rows.length) {
    await pool.query("drop index concurrently if exists vendor_catalog_items_search_trgm_idx");
  }
  const before = await sourceCatalogSearchIndexStatus();
  if (before.ready) return before;

  const client = await pool.connect();
  let backendPid = null;
  let stopped = false;
  let lastProgress = null;
  const progressTimer = setInterval(async () => {
    if (stopped) return;
    try {
      const status = await sourceCatalogSearchIndexStatus();
      lastProgress = status;
      if (onProgress) onProgress(status);
      if (backendPid && isCanceled?.()) {
        await pool.query("select pg_cancel_backend($1)", [backendPid]);
      }
    } catch {
      // Progress polling should never break the index build itself.
    }
  }, 2000);
  try {
    backendPid = (await client.query("select pg_backend_pid() as pid")).rows[0]?.pid || null;
    if (onProgress) onProgress({ phase: "starting", pid: backendPid, processedRows: 0, totalRows: 0, progressPercent: 0 });
    if (isCanceled?.()) throw new Error("Source catalog search index job canceled.");
    await client.query(`
      create index concurrently if not exists vendor_catalog_items_search_trgm_idx on vendor_catalog_items
      using gin ((lower(
        coalesce(source_sku, '') || ' ' ||
        coalesce(internal_sku, '') || ' ' ||
        coalesce(vendor_sku, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(brand, '') || ' ' ||
        coalesce(manufacturer, '') || ' ' ||
        coalesce(mfr_part_number, '') || ' ' ||
        coalesce(barcode, '') || ' ' ||
        coalesce(category, '') || ' ' ||
        coalesce(source_category, '') || ' ' ||
        coalesce(stock_status, '')
      )) gin_trgm_ops)
    `);
    const status = await sourceCatalogSearchIndexStatus();
    if (onProgress) onProgress(status);
    return status;
  } catch (error) {
    if (isCanceled?.() || /canceling statement due to user request/i.test(String(error.message || ""))) {
      throw new Error("Source catalog search index job canceled.");
    }
    throw error;
  } finally {
    stopped = true;
    clearInterval(progressTimer);
    client.release();
    if (lastProgress && onProgress) onProgress(lastProgress);
  }
}

async function buildSourceCatalogPerformanceIndexes({ isCanceled, onProgress } = {}) {
  const pool = getPool();
  if (!pool) return { enabled: false, indexes: [] };
  await initRelationalSchema();
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const checkCanceled = () => {
    if (typeof isCanceled === "function" && isCanceled()) throw new Error("Source catalog performance index job canceled.");
  };
  const indexes = [
    ["vendor_catalog_items_vendor_source_idx", "create index concurrently if not exists vendor_catalog_items_vendor_source_idx on vendor_catalog_items (vendor_id, source_sku)"],
    ["vendor_catalog_items_vendor_brand_idx", "create index concurrently if not exists vendor_catalog_items_vendor_brand_idx on vendor_catalog_items (vendor_id, lower(brand))"],
    ["vendor_catalog_items_vendor_category_idx", "create index concurrently if not exists vendor_catalog_items_vendor_category_idx on vendor_catalog_items (vendor_id, category)"],
    ["vendor_catalog_items_vendor_stock_idx", "create index concurrently if not exists vendor_catalog_items_vendor_stock_idx on vendor_catalog_items (vendor_id, stock_status)"],
    ["vendor_catalog_items_vendor_discontinued_idx", "create index concurrently if not exists vendor_catalog_items_vendor_discontinued_idx on vendor_catalog_items (vendor_id, to_be_discontinued)"],
    ["vendor_catalog_items_vendor_qty_idx", "create index concurrently if not exists vendor_catalog_items_vendor_qty_idx on vendor_catalog_items (vendor_id, qty)"],
    ["vendor_catalog_items_membership_idx", "create index concurrently if not exists vendor_catalog_items_membership_idx on vendor_catalog_items (lower(source_sku), vendor_id)"]
  ];
  const completed = [];
  for (let index = 0; index < indexes.length; index += 1) {
    checkCanceled();
    const [name, sql] = indexes[index];
    progress({
      phase: `building_${name}`,
      processedRows: index,
      totalRows: indexes.length,
      progressPercent: Math.round((index / indexes.length) * 100),
      message: `Building ${name}...`
    });
    await pool.query(sql);
    completed.push(name);
    progress({
      phase: `built_${name}`,
      processedRows: index + 1,
      totalRows: indexes.length,
      progressPercent: Math.round(((index + 1) / indexes.length) * 100),
      message: `${name} is ready.`
    });
  }
  return { enabled: true, indexes: completed };
}

function identifierRecordsFromState(item = {}) {
  const productId = nullableString(item.id) || nullableString(item.sku);
  if (!productId) return [];
  const identifiers = [
    ["internal_sku", item.sku],
    ["vendor_sku", item.vendorSku],
    ["barcode", item.barcode || item.upc || item.gtin],
    ["mfr_part_number", item.mfrPartNumber],
    ["shopify_product_gid", item.shopifyId],
    ["shopify_variant_gid", item.shopifyVariantId],
    ["shopify_variant_sku", item.shopifyVariantSku]
  ];
  return identifiers
    .map(([identifier_type, identifier_value]) => ({
      product_id: productId,
      identifier_type,
      identifier_value: nullableString(identifier_value),
      source: "json-migration"
    }))
    .filter((row) => row.identifier_value);
}

function offerRecordFromState(item = {}) {
  const productId = nullableString(item.id) || nullableString(item.sku);
  if (!productId) return null;
  const vendorId = vendorIdFor(item);
  const vendorSku = nullableString(item.vendorSku);
  const cost = nullableNumber(item.cost || item.sourceCost);
  const price = nullableNumber(item.price || item.websitePrice);
  const qty = nullableNumber(item.qty ?? item.stockQty);
  const uom = nullableString(item.uom);
  const uomQty = nullableNumber(item.uomQty || item.uom_qty);
  const discontinued = boolOrNull(item.toBeDiscontinued || item.discontinued || item.closeoutEligible);
  return {
    product_id: productId,
    vendor_id: vendorId,
    source_key: [
      "json-migration",
      productId,
      vendorId || "",
      vendorSku || "",
      cost ?? "",
      price ?? "",
      qty ?? "",
      uom || "",
      uomQty ?? "",
      discontinued ?? ""
    ].join("|"),
    vendor_sku: vendorSku,
    cost,
    price,
    qty,
    uom,
    uom_qty: uomQty,
    discontinued,
    raw: {
      sku: item.sku || "",
      supplier: item.supplier || item.vendor || "",
      supplierCode: item.supplierCode || "",
      lastSourceUpdatedAt: item.stockUpdatedAt || item.validatedAt || ""
    }
  };
}

function inventoryLevelRecordsFromState(item = {}) {
  const productId = nullableString(item.id) || nullableString(item.sku);
  if (!productId) return [];
  const rows = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
  return rows
    .map((row) => {
      const locationKey = nullableString(row.warehouseId || row.locationKey || row.warehouseName || row.name);
      if (!locationKey) return null;
      const onHand = nullableNumber(row.qty ?? row.onHand ?? row.available);
      const reserved = nullableNumber(row.reserved);
      const committed = nullableNumber(row.committed);
      const incoming = nullableNumber(row.incoming);
      const available = nullableNumber(row.available) ?? Math.max(0, Number(onHand || 0) - Number(reserved || 0) - Number(committed || 0));
      return {
        product_id: productId,
        location_key: locationKey,
        on_hand: onHand ?? 0,
        available,
        reserved: reserved ?? 0,
        committed: committed ?? 0,
        incoming: incoming ?? 0
      };
    })
    .filter(Boolean);
}

function aliasRecordsFromState(item = {}) {
  const productId = nullableString(item.id) || nullableString(item.sku);
  const parentSku = nullableString(item.sku);
  if (!productId) return [];
  const aliases = Array.isArray(item.aliases) ? item.aliases : [];
  return aliases
    .map((alias, index) => {
      const aliasSku = nullableString(alias.aliasSku || alias.sku || alias.value);
      if (!aliasSku) return null;
      return {
        alias_id: nullableString(alias.id) || crypto.createHash("sha1").update(`${productId}:${aliasSku}:${index}`).digest("hex"),
        product_id: productId,
        parent_sku: nullableString(alias.parentSku) || parentSku,
        alias_sku: aliasSku,
        source: nullableString(alias.source || alias.marketplace),
        alias_type: nullableString(alias.type || alias.mode) || "direct",
        active: alias.active !== false,
        created_from_order_id: nullableString(alias.createdFromOrderId || alias.orderId),
        created_from_order_number: nullableString(alias.createdFromOrderNumber || alias.orderNumber),
        created_from_line_index: nullableNumber(alias.createdFromLineIndex ?? alias.lineIndex),
        created_at: nullableString(alias.createdAt),
        updated_at: nullableString(alias.updatedAt || alias.createdAt),
        raw: alias
      };
    })
    .filter(Boolean);
}

function categoryChannelMappingRecordsFromState(categorySettings = []) {
  const rows = [];
  for (const category of Array.isArray(categorySettings) ? categorySettings : []) {
    const categoryName = nullableString(category.name || category.category);
    if (!categoryName) continue;
    const categoryId = nullableString(category.categoryId || category.id);
    const mappings = category.mappings && typeof category.mappings === "object" ? category.mappings : {};
    for (const [channel, mapping] of Object.entries(mappings)) {
      const channelKey = nullableString(channel)?.toLowerCase();
      if (!channelKey || !mapping || typeof mapping !== "object") continue;
      const hasMapping = nullableString(mapping.categoryId || mapping.categoryPath || mapping.categoryHandle || mapping.collectionHandle);
      const attributes = Array.isArray(mapping.attributes) ? mapping.attributes : [];
      const attributeMappings = Array.isArray(mapping.attributeMappings) ? mapping.attributeMappings : [];
      const storedStatus = nullableString(mapping.status);
      rows.push({
        mapping_id: crypto.createHash("sha1").update(`${categoryName.toLowerCase()}::${channelKey}`).digest("hex"),
        category_id: categoryId,
        category_name: categoryName,
        channel: channelKey,
        channel_category_id: nullableString(mapping.categoryId),
        channel_category_path: nullableString(mapping.categoryPath),
        channel_category_handle: nullableString(mapping.categoryHandle || mapping.collectionHandle),
        status: hasMapping && (!storedStatus || storedStatus === "missing") ? "mapped" : (storedStatus || "missing"),
        attribute_count: attributes.length,
        attribute_mapping_count: attributeMappings.length,
        raw: mapping
      });
    }
  }
  return rows;
}

async function upsertProductAliasesFromState(items = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, aliases: 0 };
  await initRelationalSchema();
  const productIds = [];
  const aliases = [];
  for (const item of Array.isArray(items) ? items : []) {
    const productId = nullableString(item.id) || nullableString(item.sku);
    if (productId) productIds.push(productId);
    aliases.push(...aliasRecordsFromState(item));
  }
  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  await client.query("begin");
  try {
    for (let i = 0; i < productIds.length; i += batchSize) {
      await client.query("delete from product_aliases where product_id = any($1::text[])", [productIds.slice(i, i + batchSize)]);
    }
    for (let i = 0; i < aliases.length; i += batchSize) {
      await client.query(`
        insert into product_aliases (
          alias_id, product_id, parent_sku, alias_sku, source, alias_type, active,
          created_from_order_id, created_from_order_number, created_from_line_index,
          raw, created_at, updated_at
        )
        select alias_id, product_id, parent_sku, alias_sku, source, alias_type, active,
          created_from_order_id, created_from_order_number, created_from_line_index,
          raw, coalesce(created_at, now()), coalesce(updated_at, now())
        from jsonb_to_recordset($1::jsonb) as x(
          alias_id text, product_id text, parent_sku text, alias_sku text, source text,
          alias_type text, active boolean, created_from_order_id text, created_from_order_number text,
          created_from_line_index integer, raw jsonb, created_at timestamptz, updated_at timestamptz
        )
        on conflict (alias_id) do update set
          product_id = excluded.product_id,
          parent_sku = excluded.parent_sku,
          alias_sku = excluded.alias_sku,
          source = excluded.source,
          alias_type = excluded.alias_type,
          active = excluded.active,
          created_from_order_id = excluded.created_from_order_id,
          created_from_order_number = excluded.created_from_order_number,
          created_from_line_index = excluded.created_from_line_index,
          raw = excluded.raw,
          updated_at = now()
      `, [JSON.stringify(aliases.slice(i, i + batchSize))]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, aliases: aliases.length };
}

async function upsertInventoryLevelsFromProducts(items = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, levels: 0 };
  await initRelationalSchema();
  const productIds = [];
  const levels = [];
  for (const item of Array.isArray(items) ? items : []) {
    const productId = nullableString(item.id) || nullableString(item.sku);
    if (productId) productIds.push(productId);
    levels.push(...inventoryLevelRecordsFromState(item));
  }
  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  await client.query("begin");
  try {
    if (options.replace !== false && productIds.length) {
      for (let i = 0; i < productIds.length; i += batchSize) {
        await client.query("delete from inventory_levels where product_id = any($1::text[])", [productIds.slice(i, i + batchSize)]);
      }
    }
    for (let i = 0; i < levels.length; i += batchSize) {
      await client.query(`
        insert into inventory_levels (
          product_id, location_key, on_hand, available, reserved, committed, incoming, updated_at
        )
        select product_id, location_key, on_hand, available, reserved, committed, incoming, now()
        from jsonb_to_recordset($1::jsonb) as x(
          product_id text, location_key text, on_hand numeric, available numeric,
          reserved numeric, committed numeric, incoming numeric
        )
        on conflict (product_id, location_key) do update set
          on_hand = excluded.on_hand,
          available = excluded.available,
          reserved = excluded.reserved,
          committed = excluded.committed,
          incoming = excluded.incoming,
          updated_at = now()
      `, [JSON.stringify(levels.slice(i, i + batchSize))]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, levels: levels.length };
}

async function upsertCategoryChannelMappingsFromState(categorySettings = []) {
  const client = getPool();
  if (!client) return { enabled: false, mappings: 0 };
  await initRelationalSchema();
  const records = categoryChannelMappingRecordsFromState(categorySettings);
  await client.query("begin");
  try {
    await client.query("delete from category_channel_mappings");
    const batchSize = 1000;
    for (let i = 0; i < records.length; i += batchSize) {
      await client.query(`
        insert into category_channel_mappings (
          mapping_id, category_id, category_name, channel, channel_category_id,
          channel_category_path, channel_category_handle, status, attribute_count,
          attribute_mapping_count, raw, updated_at
        )
        select mapping_id, category_id, category_name, channel, channel_category_id,
          channel_category_path, channel_category_handle, status, attribute_count,
          attribute_mapping_count, raw, now()
        from jsonb_to_recordset($1::jsonb) as x(
          mapping_id text, category_id text, category_name text, channel text,
          channel_category_id text, channel_category_path text, channel_category_handle text,
          status text, attribute_count integer, attribute_mapping_count integer, raw jsonb
        )
        on conflict (mapping_id) do update set
          category_id = excluded.category_id,
          category_name = excluded.category_name,
          channel = excluded.channel,
          channel_category_id = excluded.channel_category_id,
          channel_category_path = excluded.channel_category_path,
          channel_category_handle = excluded.channel_category_handle,
          status = excluded.status,
          attribute_count = excluded.attribute_count,
          attribute_mapping_count = excluded.attribute_mapping_count,
          raw = excluded.raw,
          updated_at = now()
      `, [JSON.stringify(records.slice(i, i + batchSize))]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, mappings: records.length };
}

async function replaceCategorySummaryIndex(scope = "main", rows = [], meta = {}) {
  const client = getPool();
  if (!client) return { enabled: false, rows: 0 };
  await initRelationalSchema();
  const normalizedScope = String(scope || "main").trim().toLowerCase() === "source" ? "source" : "main";
  const generatedAt = meta.generatedAt || new Date().toISOString();
  const records = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const name = nullableString(row.name || row.category || row.categoryName);
    const categoryKey = nullableString(row.id || row.categoryId)
      || (name ? crypto.createHash("sha1").update(`${normalizedScope}:${name.toLowerCase()}`).digest("hex") : `${normalizedScope}:${index}`);
    return {
      scope: normalizedScope,
      category_key: categoryKey,
      position: index,
      data: {
        ...row,
        __indexMeta: {
          generatedAt,
          scope: normalizedScope,
          source: meta.source || "category-summary-index"
        }
      }
    };
  });
  await client.query("begin");
  try {
    await client.query("delete from category_summary_index where scope = $1", [normalizedScope]);
    const batchSize = 1000;
    for (let i = 0; i < records.length; i += batchSize) {
      await client.query(`
        insert into category_summary_index (scope, category_key, position, data, generated_at)
        select scope, category_key, position, data, $2::timestamptz
        from jsonb_to_recordset($1::jsonb) as x(scope text, category_key text, position integer, data jsonb)
        on conflict (scope, category_key) do update set
          position = excluded.position,
          data = excluded.data,
          generated_at = excluded.generated_at
      `, [JSON.stringify(records.slice(i, i + batchSize)), generatedAt]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, rows: records.length, scope: normalizedScope, generatedAt };
}

async function readCategorySummaryIndex(scope = "main", options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const normalizedScope = String(scope || "main").trim().toLowerCase() === "source" ? "source" : "main";
  const limit = Math.max(1, Math.min(100000, Number(options.limit || 100000)));
  const offset = Math.max(0, Number(options.offset || 0));
  const q = String(options.q || "").trim().toLowerCase();
  const params = [normalizedScope, limit, offset];
  const where = ["scope = $1"];
  if (q) {
    params.push(`%${q}%`);
    where.push(`lower(coalesce(data ->> 'name', '') || ' ' || coalesce(data ->> 'status', '') || ' ' || coalesce(data ->> 'notes', '')) like $${params.length}`);
  }
  const result = await client.query(`
    select data, generated_at, count(*) over()::int as total
    from category_summary_index
    where ${where.join(" and ")}
    order by position, category_key
    limit $2 offset $3
  `, params);
  return {
    rows: result.rows.map((row) => row.data),
    total: result.rows[0]?.total || 0,
    generatedAt: result.rows[0]?.generated_at ? result.rows[0].generated_at.toISOString() : ""
  };
}

function orderIsReportable(order = {}) {
  return !["void", "canceled", "cancelled", "deleted"].includes(String(order.status || "").trim().toLowerCase());
}

function dateOrNull(value) {
  const text = nullableString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : text;
}

function orderRecordFromState(order = {}) {
  const orderId = nullableString(order.id || order.orderId || order.internalOrderNumber || order.orderNumber);
  if (!orderId) return null;
  return {
    order_id: orderId,
    order_number: nullableString(order.orderNumber || order.displayOrderNumber || order.internalOrderNumber),
    internal_order_number: nullableString(order.internalOrderNumber),
    marketplace_order_id: nullableString(order.marketplaceOrderId || order.marketplaceOrderNumber),
    source: nullableString(order.source),
    status: nullableString(order.status),
    buyer: nullableString(order.buyer || order.customerName),
    buyer_email: nullableString(order.buyerEmail),
    phone: nullableString(order.phone),
    customer_id: nullableString(order.customerId),
    total: nullableNumber(order.total),
    product_cost: nullableNumber(order.productCost),
    marketplace_fees: nullableNumber(order.marketplaceFees),
    shipping_cost: nullableNumber(order.shippingCost),
    refund_amount: nullableNumber(order.refundAmount),
    paid_amount: nullableNumber(order.paidAmount ?? order.paid ?? order.total),
    qty: nullableNumber(order.qty),
    ship_by: dateOrNull(order.shipBy),
    shipped_at: dateOrNull(order.shippedAt || order.shipDate),
    tracking_number: nullableString(order.trackingNumber),
    shipping_carrier: nullableString(order.shippingCarrier || order.carrierName),
    reportable: orderIsReportable(order),
    raw: order,
    created_at: dateOrNull(order.createdAt),
    updated_at: dateOrNull(order.updatedAt || order.createdAt)
  };
}

function orderLineRecordsFromState(order = {}) {
  const orderId = nullableString(order.id || order.orderId || order.internalOrderNumber || order.orderNumber);
  if (!orderId) return [];
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{
    sku: order.sku,
    title: order.title,
    qty: order.qty,
    price: order.total,
    cost: order.productCost
  }];
  return items.map((line, index) => ({
    line_id: nullableString(line.id || line.lineId) || crypto.createHash("sha1").update(`${orderId}:${index}:${line.sku || ""}:${line.title || ""}`).digest("hex"),
    order_id: orderId,
    line_index: index,
    sku: nullableString(line.sku),
    mapped_sku: nullableString(line.mappedSku || line.parentSku),
    original_sku: nullableString(line.originalSku || line.mappedFromSku),
    title: nullableString(line.title),
    qty: nullableNumber(line.qty ?? line.quantity),
    price: nullableNumber(line.price ?? line.unitPrice),
    cost: nullableNumber(line.cost ?? line.unitCost),
    raw: line
  }));
}

function purchaseOrderIsReportable(po = {}) {
  return !["void", "canceled", "cancelled", "deleted"].includes(String(po.status || "").trim().toLowerCase());
}

function purchaseOrderRecordFromState(po = {}) {
  const poId = nullableString(po.id || po.poId || po.poNumber);
  if (!poId) return null;
  return {
    po_id: poId,
    po_number: nullableString(po.poNumber),
    status: nullableString(po.status),
    vendor_id: nullableString(po.vendorId),
    supplier: nullableString(po.supplier || po.vendor),
    warehouse_id: nullableString(po.warehouseId),
    warehouse_name: nullableString(po.warehouseName),
    source: nullableString(po.source),
    total_units: nullableNumber(po.totalUnits),
    received_units: nullableNumber(po.receivedUnits),
    estimated_cost: nullableNumber(po.estimatedCost),
    received_at: dateOrNull(po.receivedAt),
    reportable: purchaseOrderIsReportable(po),
    raw: po,
    created_at: dateOrNull(po.createdAt),
    updated_at: dateOrNull(po.updatedAt || po.createdAt)
  };
}

function purchaseOrderLineRecordsFromState(po = {}) {
  const poId = nullableString(po.id || po.poId || po.poNumber);
  if (!poId) return [];
  const items = Array.isArray(po.items) ? po.items : [];
  return items.map((line, index) => {
    const qty = nullableNumber(line.qty ?? line.quantity);
    const receivedQty = nullableNumber(line.receivedQty ?? line.receivedQuantity ?? line.received);
    return {
      line_id: nullableString(line.id || line.lineId) || crypto.createHash("sha1").update(`${poId}:${index}:${line.sku || ""}:${line.title || ""}`).digest("hex"),
      po_id: poId,
      line_index: index,
      sku: nullableString(line.sku),
      title: nullableString(line.title),
      qty,
      received_qty: receivedQty,
      remaining_qty: nullableNumber(line.remainingQty) ?? (qty === null ? null : Math.max(0, Number(qty || 0) - Number(receivedQty || 0))),
      estimated_unit_cost: nullableNumber(line.estimatedUnitCost ?? line.unitCost ?? line.cost),
      raw: line
    };
  });
}

function orderLineRowToState(row = {}) {
  return {
    ...(row.raw || {}),
    id: row.line_id || row.raw?.id,
    lineId: row.line_id || row.raw?.lineId,
    sku: row.sku || row.raw?.sku || "",
    mappedSku: row.mapped_sku || row.raw?.mappedSku || "",
    originalSku: row.original_sku || row.raw?.originalSku || row.raw?.mappedFromSku || "",
    title: row.title || row.raw?.title || "",
    qty: row.qty ?? row.raw?.qty ?? row.raw?.quantity,
    price: row.price ?? row.raw?.price ?? row.raw?.unitPrice,
    cost: row.cost ?? row.raw?.cost ?? row.raw?.unitCost
  };
}

function orderRowToState(row = {}, lines = []) {
  return {
    ...(row.raw || {}),
    id: row.order_id || row.raw?.id,
    orderId: row.order_id || row.raw?.orderId,
    orderNumber: row.order_number || row.raw?.orderNumber || row.raw?.displayOrderNumber || "",
    internalOrderNumber: row.internal_order_number || row.raw?.internalOrderNumber || "",
    marketplaceOrderId: row.marketplace_order_id || row.raw?.marketplaceOrderId || "",
    marketplaceOrderNumber: row.marketplace_order_id || row.raw?.marketplaceOrderNumber || "",
    source: row.source || row.raw?.source || "",
    status: row.status || row.raw?.status || "",
    buyer: row.buyer || row.raw?.buyer || row.raw?.customerName || "",
    buyerEmail: row.buyer_email || row.raw?.buyerEmail || "",
    phone: row.phone || row.raw?.phone || "",
    customerId: row.customer_id || row.raw?.customerId || "",
    total: row.total ?? row.raw?.total,
    productCost: row.product_cost ?? row.raw?.productCost,
    marketplaceFees: row.marketplace_fees ?? row.raw?.marketplaceFees,
    shippingCost: row.shipping_cost ?? row.raw?.shippingCost,
    refundAmount: row.refund_amount ?? row.raw?.refundAmount,
    paidAmount: row.paid_amount ?? row.raw?.paidAmount ?? row.raw?.paid,
    qty: row.qty ?? row.raw?.qty,
    shipBy: row.ship_by?.toISOString?.().slice(0, 10) || row.raw?.shipBy || "",
    shippedAt: row.shipped_at?.toISOString?.() || row.raw?.shippedAt || "",
    trackingNumber: row.tracking_number || row.raw?.trackingNumber || "",
    shippingCarrier: row.shipping_carrier || row.raw?.shippingCarrier || row.raw?.carrierName || "",
    reportable: row.reportable !== false,
    createdAt: row.created_at?.toISOString?.() || row.raw?.createdAt || "",
    updatedAt: row.updated_at?.toISOString?.() || row.raw?.updatedAt || "",
    items: lines.length ? lines.map(orderLineRowToState) : (Array.isArray(row.raw?.items) ? row.raw.items : [])
  };
}

function purchaseOrderLineRowToState(row = {}) {
  return {
    ...(row.raw || {}),
    id: row.line_id || row.raw?.id,
    lineId: row.line_id || row.raw?.lineId,
    sku: row.sku || row.raw?.sku || "",
    title: row.title || row.raw?.title || "",
    qty: row.qty ?? row.raw?.qty ?? row.raw?.quantity,
    receivedQty: row.received_qty ?? row.raw?.receivedQty ?? row.raw?.received,
    remainingQty: row.remaining_qty ?? row.raw?.remainingQty,
    estimatedUnitCost: row.estimated_unit_cost ?? row.raw?.estimatedUnitCost ?? row.raw?.cost
  };
}

function purchaseOrderRowToState(row = {}, lines = []) {
  return {
    ...(row.raw || {}),
    id: row.po_id || row.raw?.id,
    poId: row.po_id || row.raw?.poId,
    poNumber: row.po_number || row.raw?.poNumber || "",
    status: row.status || row.raw?.status || "",
    vendorId: row.vendor_id || row.raw?.vendorId || "",
    supplier: row.supplier || row.raw?.supplier || row.raw?.vendor || "",
    warehouseId: row.warehouse_id || row.raw?.warehouseId || "",
    warehouseName: row.warehouse_name || row.raw?.warehouseName || "",
    source: row.source || row.raw?.source || "",
    totalUnits: row.total_units ?? row.raw?.totalUnits,
    receivedUnits: row.received_units ?? row.raw?.receivedUnits,
    estimatedCost: row.estimated_cost ?? row.raw?.estimatedCost,
    receivedAt: row.received_at?.toISOString?.().slice(0, 10) || row.raw?.receivedAt || "",
    reportable: row.reportable !== false,
    createdAt: row.created_at?.toISOString?.() || row.raw?.createdAt || "",
    updatedAt: row.updated_at?.toISOString?.() || row.raw?.updatedAt || "",
    items: lines.length ? lines.map(purchaseOrderLineRowToState) : (Array.isArray(row.raw?.items) ? row.raw.items : [])
  };
}

async function upsertOrdersFromState(orders = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, orders: 0, lines: 0 };
  await initRelationalSchema();
  const records = [];
  const lines = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    const record = orderRecordFromState(order);
    if (!record) continue;
    records.push(record);
    lines.push(...orderLineRecordsFromState(order));
  }
  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  await client.query("begin");
  try {
    if (options.replace !== false) {
      await client.query("delete from order_records");
    } else if (records.length) {
      for (let i = 0; i < records.length; i += batchSize) {
        await client.query("delete from order_records where order_id = any($1::text[])", [records.slice(i, i + batchSize).map((row) => row.order_id)]);
      }
    }
    for (let i = 0; i < records.length; i += batchSize) {
      await client.query(`
        insert into order_records (
          order_id, order_number, internal_order_number, marketplace_order_id, source,
          status, buyer, buyer_email, phone, customer_id, total, product_cost,
          marketplace_fees, shipping_cost, refund_amount, paid_amount, qty, ship_by,
          shipped_at, tracking_number, shipping_carrier, reportable, raw, created_at, updated_at
        )
        select order_id, order_number, internal_order_number, marketplace_order_id, source,
          status, buyer, buyer_email, phone, customer_id, total, product_cost,
          marketplace_fees, shipping_cost, refund_amount, paid_amount, qty, ship_by,
          shipped_at, tracking_number, shipping_carrier, reportable, raw,
          coalesce(created_at, now()), coalesce(updated_at, now())
        from jsonb_to_recordset($1::jsonb) as x(
          order_id text, order_number text, internal_order_number text, marketplace_order_id text,
          source text, status text, buyer text, buyer_email text, phone text, customer_id text,
          total numeric, product_cost numeric, marketplace_fees numeric, shipping_cost numeric,
          refund_amount numeric, paid_amount numeric, qty numeric, ship_by date, shipped_at timestamptz,
          tracking_number text, shipping_carrier text, reportable boolean, raw jsonb,
          created_at timestamptz, updated_at timestamptz
        )
        on conflict (order_id) do update set
          order_number = excluded.order_number,
          internal_order_number = excluded.internal_order_number,
          marketplace_order_id = excluded.marketplace_order_id,
          source = excluded.source,
          status = excluded.status,
          buyer = excluded.buyer,
          buyer_email = excluded.buyer_email,
          phone = excluded.phone,
          customer_id = excluded.customer_id,
          total = excluded.total,
          product_cost = excluded.product_cost,
          marketplace_fees = excluded.marketplace_fees,
          shipping_cost = excluded.shipping_cost,
          refund_amount = excluded.refund_amount,
          paid_amount = excluded.paid_amount,
          qty = excluded.qty,
          ship_by = excluded.ship_by,
          shipped_at = excluded.shipped_at,
          tracking_number = excluded.tracking_number,
          shipping_carrier = excluded.shipping_carrier,
          reportable = excluded.reportable,
          raw = excluded.raw,
          updated_at = now()
      `, [JSON.stringify(records.slice(i, i + batchSize))]);
    }
    for (let i = 0; i < lines.length; i += batchSize) {
      await client.query(`
        insert into order_line_items (
          line_id, order_id, line_index, sku, mapped_sku, original_sku, title, qty, price, cost, raw
        )
        select line_id, order_id, line_index, sku, mapped_sku, original_sku, title, qty, price, cost, raw
        from jsonb_to_recordset($1::jsonb) as x(
          line_id text, order_id text, line_index integer, sku text, mapped_sku text,
          original_sku text, title text, qty numeric, price numeric, cost numeric, raw jsonb
        )
        on conflict (line_id) do update set
          order_id = excluded.order_id,
          line_index = excluded.line_index,
          sku = excluded.sku,
          mapped_sku = excluded.mapped_sku,
          original_sku = excluded.original_sku,
          title = excluded.title,
          qty = excluded.qty,
          price = excluded.price,
          cost = excluded.cost,
          raw = excluded.raw
      `, [JSON.stringify(lines.slice(i, i + batchSize))]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, orders: records.length, lines: lines.length };
}

async function upsertPurchaseOrdersFromState(purchaseOrders = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, purchaseOrders: 0, lines: 0 };
  await initRelationalSchema();
  const records = [];
  const lines = [];
  for (const po of Array.isArray(purchaseOrders) ? purchaseOrders : []) {
    const record = purchaseOrderRecordFromState(po);
    if (!record) continue;
    records.push(record);
    lines.push(...purchaseOrderLineRecordsFromState(po));
  }
  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  await client.query("begin");
  try {
    if (options.replace !== false) {
      await client.query("delete from purchase_order_records");
    } else if (records.length) {
      for (let i = 0; i < records.length; i += batchSize) {
        await client.query("delete from purchase_order_records where po_id = any($1::text[])", [records.slice(i, i + batchSize).map((row) => row.po_id)]);
      }
    }
    for (let i = 0; i < records.length; i += batchSize) {
      await client.query(`
        insert into purchase_order_records (
          po_id, po_number, status, vendor_id, supplier, warehouse_id, warehouse_name,
          source, total_units, received_units, estimated_cost, received_at, reportable,
          raw, created_at, updated_at
        )
        select po_id, po_number, status, vendor_id, supplier, warehouse_id, warehouse_name,
          source, total_units, received_units, estimated_cost, received_at, reportable,
          raw, coalesce(created_at, now()), coalesce(updated_at, now())
        from jsonb_to_recordset($1::jsonb) as x(
          po_id text, po_number text, status text, vendor_id text, supplier text,
          warehouse_id text, warehouse_name text, source text, total_units numeric,
          received_units numeric, estimated_cost numeric, received_at date, reportable boolean,
          raw jsonb, created_at timestamptz, updated_at timestamptz
        )
        on conflict (po_id) do update set
          po_number = excluded.po_number,
          status = excluded.status,
          vendor_id = excluded.vendor_id,
          supplier = excluded.supplier,
          warehouse_id = excluded.warehouse_id,
          warehouse_name = excluded.warehouse_name,
          source = excluded.source,
          total_units = excluded.total_units,
          received_units = excluded.received_units,
          estimated_cost = excluded.estimated_cost,
          received_at = excluded.received_at,
          reportable = excluded.reportable,
          raw = excluded.raw,
          updated_at = now()
      `, [JSON.stringify(records.slice(i, i + batchSize))]);
    }
    for (let i = 0; i < lines.length; i += batchSize) {
      await client.query(`
        insert into purchase_order_line_items (
          line_id, po_id, line_index, sku, title, qty, received_qty, remaining_qty, estimated_unit_cost, raw
        )
        select line_id, po_id, line_index, sku, title, qty, received_qty, remaining_qty, estimated_unit_cost, raw
        from jsonb_to_recordset($1::jsonb) as x(
          line_id text, po_id text, line_index integer, sku text, title text,
          qty numeric, received_qty numeric, remaining_qty numeric, estimated_unit_cost numeric, raw jsonb
        )
        on conflict (line_id) do update set
          po_id = excluded.po_id,
          line_index = excluded.line_index,
          sku = excluded.sku,
          title = excluded.title,
          qty = excluded.qty,
          received_qty = excluded.received_qty,
          remaining_qty = excluded.remaining_qty,
          estimated_unit_cost = excluded.estimated_unit_cost,
          raw = excluded.raw
      `, [JSON.stringify(lines.slice(i, i + batchSize))]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return { enabled: true, purchaseOrders: records.length, lines: lines.length };
}

async function listOrders(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(10000, Number(options.limit || 5000)));
  const status = nullableString(options.status);
  const params = [];
  const where = [];
  if (status && status !== "all") {
    params.push(status.toLowerCase());
    where.push("lower(coalesce(status, '')) = $" + params.length);
  }
  if (options.includeDeleted !== true) {
    where.push("lower(coalesce(status, '')) <> 'deleted'");
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  params.push(limit);
  const orders = await client.query(`
    select *
    from order_records
    ${whereSql}
    order by coalesce(created_at, updated_at) desc, order_number desc
    limit $${params.length}
  `, params);
  const ids = orders.rows.map((row) => row.order_id).filter(Boolean);
  let lineRows = [];
  if (ids.length) {
    const lines = await client.query(`
      select *
      from order_line_items
      where order_id = any($1::text[])
      order by order_id, line_index
    `, [ids]);
    lineRows = lines.rows;
  }
  const byOrder = new Map();
  for (const line of lineRows) {
    if (!byOrder.has(line.order_id)) byOrder.set(line.order_id, []);
    byOrder.get(line.order_id).push(line);
  }
  return orders.rows.map((row) => orderRowToState(row, byOrder.get(row.order_id) || []));
}

async function readOrderByKey(key) {
  const client = getPool();
  const value = nullableString(key);
  if (!client || !value) return null;
  await initRelationalSchema();
  const result = await client.query(`
    select *
    from order_records
    where order_id = $1
      or lower(order_number) = lower($1)
      or lower(internal_order_number) = lower($1)
      or lower(marketplace_order_id) = lower($1)
    limit 1
  `, [value]);
  if (!result.rows[0]) return null;
  const lines = await client.query(`
    select *
    from order_line_items
    where order_id = $1
    order by line_index
  `, [result.rows[0].order_id]);
  return orderRowToState(result.rows[0], lines.rows);
}

async function saveOrder(order = {}) {
  const result = await upsertOrdersFromState([order], { replace: false });
  return result;
}

async function listPurchaseOrders(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(10000, Number(options.limit || 5000)));
  const result = await client.query(`
    select *
    from purchase_order_records
    where lower(coalesce(status, '')) <> 'deleted'
    order by coalesce(created_at, updated_at) desc, po_number desc
    limit $1
  `, [limit]);
  const ids = result.rows.map((row) => row.po_id).filter(Boolean);
  let lineRows = [];
  if (ids.length) {
    const lines = await client.query(`
      select *
      from purchase_order_line_items
      where po_id = any($1::text[])
      order by po_id, line_index
    `, [ids]);
    lineRows = lines.rows;
  }
  const byPo = new Map();
  for (const line of lineRows) {
    if (!byPo.has(line.po_id)) byPo.set(line.po_id, []);
    byPo.get(line.po_id).push(line);
  }
  return result.rows.map((row) => purchaseOrderRowToState(row, byPo.get(row.po_id) || []));
}

async function readPurchaseOrderByKey(key) {
  const client = getPool();
  const value = nullableString(key);
  if (!client || !value) return null;
  await initRelationalSchema();
  const result = await client.query(`
    select *
    from purchase_order_records
    where po_id = $1 or lower(po_number) = lower($1)
    limit 1
  `, [value]);
  if (!result.rows[0]) return null;
  const lines = await client.query(`
    select *
    from purchase_order_line_items
    where po_id = $1
    order by line_index
  `, [result.rows[0].po_id]);
  return purchaseOrderRowToState(result.rows[0], lines.rows);
}

async function savePurchaseOrder(po = {}) {
  return upsertPurchaseOrdersFromState([po], { replace: false });
}

async function upsertProductsFromState(items = [], options = {}) {
  const client = getPool();
  if (!client) return { enabled: false, products: 0, vendors: 0, identifiers: 0, offers: 0 };
  await initRelationalSchema();
  const products = [];
  const vendorMap = new Map();
  const identifiers = [];
  const offers = [];
  const aliases = [];
  for (const item of Array.isArray(items) ? items : []) {
    const product = productRecordFromState(item);
    if (!product) continue;
    products.push(product);
    const vendor = vendorRecordFromState(item);
    if (vendor) vendorMap.set(vendor.vendor_id, vendor);
    identifiers.push(...identifierRecordsFromState(item));
    aliases.push(...aliasRecordsFromState(item));
    const offer = offerRecordFromState(item);
    if (offer) offers.push(offer);
  }

  const batchSize = Math.max(100, Math.min(2000, Number(options.batchSize || 1000)));
  await client.query("begin");
  try {
    const vendors = [...vendorMap.values()];
    for (let i = 0; i < vendors.length; i += batchSize) {
      await client.query(`
        insert into vendors (vendor_id, code, name, raw, updated_at)
        select vendor_id, code, name, raw, now()
        from jsonb_to_recordset($1::jsonb) as x(vendor_id text, code text, name text, raw jsonb)
        on conflict (vendor_id) do update set
          code = excluded.code,
          name = excluded.name,
          raw = vendors.raw || excluded.raw,
          updated_at = now()
      `, [JSON.stringify(vendors.slice(i, i + batchSize))]);
    }

    for (let i = 0; i < products.length; i += batchSize) {
      await client.query(`
        insert into products (
          product_id, sku, title, marketplace_title, brand, manufacturer, mfr_part_number,
          vendor_sku, barcode, category, main_category, source_category, supplier, supplier_code,
          active, to_be_discontinued, uom, uom_qty, cost, price, qty, default_image, raw, updated_at
        )
        select product_id, sku, title, marketplace_title, brand, manufacturer, mfr_part_number,
          vendor_sku, barcode, category, main_category, source_category, supplier, supplier_code,
          active, to_be_discontinued, uom, uom_qty, cost, price, qty, default_image, raw, now()
        from jsonb_to_recordset($1::jsonb) as x(
          product_id text, sku text, title text, marketplace_title text, brand text, manufacturer text,
          mfr_part_number text, vendor_sku text, barcode text, category text, main_category text,
          source_category text, supplier text, supplier_code text, active boolean,
          to_be_discontinued boolean, uom text, uom_qty numeric, cost numeric, price numeric,
          qty numeric, default_image text, raw jsonb
        )
        on conflict (product_id) do update set
          sku = excluded.sku,
          title = excluded.title,
          marketplace_title = excluded.marketplace_title,
          brand = excluded.brand,
          manufacturer = excluded.manufacturer,
          mfr_part_number = excluded.mfr_part_number,
          vendor_sku = excluded.vendor_sku,
          barcode = excluded.barcode,
          category = excluded.category,
          main_category = excluded.main_category,
          source_category = excluded.source_category,
          supplier = excluded.supplier,
          supplier_code = excluded.supplier_code,
          active = excluded.active,
          to_be_discontinued = excluded.to_be_discontinued,
          uom = excluded.uom,
          uom_qty = excluded.uom_qty,
          cost = excluded.cost,
          price = excluded.price,
          qty = excluded.qty,
          default_image = excluded.default_image,
          raw = products.raw || excluded.raw,
          updated_at = now()
      `, [JSON.stringify(products.slice(i, i + batchSize))]);
    }

    for (let i = 0; i < identifiers.length; i += batchSize) {
      await client.query(`
        insert into product_identifiers (product_id, identifier_type, identifier_value, source)
        select product_id, identifier_type, identifier_value, source
        from jsonb_to_recordset($1::jsonb) as x(product_id text, identifier_type text, identifier_value text, source text)
        on conflict do nothing
      `, [JSON.stringify(identifiers.slice(i, i + batchSize))]);
    }

    if (products.length) {
      for (let i = 0; i < products.length; i += batchSize) {
        await client.query("delete from product_aliases where product_id = any($1::text[])", [products.slice(i, i + batchSize).map((row) => row.product_id)]);
      }
    }

    for (let i = 0; i < aliases.length; i += batchSize) {
      await client.query(`
        insert into product_aliases (
          alias_id, product_id, parent_sku, alias_sku, source, alias_type, active,
          created_from_order_id, created_from_order_number, created_from_line_index,
          raw, created_at, updated_at
        )
        select alias_id, product_id, parent_sku, alias_sku, source, alias_type, active,
          created_from_order_id, created_from_order_number, created_from_line_index,
          raw, coalesce(created_at, now()), coalesce(updated_at, now())
        from jsonb_to_recordset($1::jsonb) as x(
          alias_id text, product_id text, parent_sku text, alias_sku text, source text,
          alias_type text, active boolean, created_from_order_id text, created_from_order_number text,
          created_from_line_index integer, raw jsonb, created_at timestamptz, updated_at timestamptz
        )
        on conflict (alias_id) do update set
          product_id = excluded.product_id,
          parent_sku = excluded.parent_sku,
          alias_sku = excluded.alias_sku,
          source = excluded.source,
          alias_type = excluded.alias_type,
          active = excluded.active,
          created_from_order_id = excluded.created_from_order_id,
          created_from_order_number = excluded.created_from_order_number,
          created_from_line_index = excluded.created_from_line_index,
          raw = excluded.raw,
          updated_at = now()
      `, [JSON.stringify(aliases.slice(i, i + batchSize))]);
    }

    for (let i = 0; i < offers.length; i += batchSize) {
      await client.query(`
        insert into vendor_offers (product_id, vendor_id, source_key, vendor_sku, cost, price, qty, uom, uom_qty, discontinued, raw)
        select product_id, vendor_id, source_key, vendor_sku, cost, price, qty, uom, uom_qty, discontinued, raw
        from jsonb_to_recordset($1::jsonb) as x(
          product_id text, vendor_id text, source_key text, vendor_sku text, cost numeric, price numeric,
          qty numeric, uom text, uom_qty numeric, discontinued boolean, raw jsonb
        )
        on conflict (source_key) where source_key is not null do update set
          cost = excluded.cost,
          price = excluded.price,
          qty = excluded.qty,
          uom = excluded.uom,
          uom_qty = excluded.uom_qty,
          discontinued = excluded.discontinued,
          raw = vendor_offers.raw || excluded.raw
      `, [JSON.stringify(offers.slice(i, i + batchSize))]);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  return {
    enabled: true,
    products: products.length,
    vendors: vendorMap.size,
    identifiers: identifiers.length,
    aliases: aliases.length,
    offers: offers.length
  };
}

async function deleteProductsByIds(ids = []) {
  const client = getPool();
  if (!client) return { enabled: false, deleted: 0 };
  const values = [...new Set((Array.isArray(ids) ? ids : []).map((id) => nullableString(id)).filter(Boolean))];
  if (!values.length) return { enabled: true, deleted: 0 };
  await initRelationalSchema();
  const lowerValues = values.map((id) => id.toLowerCase());
  const result = await client.query(`
    delete from products
    where lower(product_id) = any($1)
      or lower(sku) = any($1)
  `, [lowerValues]);
  return { enabled: true, deleted: result.rowCount || 0 };
}

async function cleanupLegacyMigratedVendorOffers() {
  const client = getPool();
  if (!client) return 0;
  await initRelationalSchema();
  const result = await client.query(`
    delete from vendor_offers
    where source_key is null
      and raw ? 'sku'
      and (raw ? 'supplier' or raw ? 'supplierCode')
  `);
  return result.rowCount || 0;
}

function jobRecordFromState(job = {}) {
  const id = nullableString(job.id || job.jobId);
  if (!id) return null;
  const status = nullableString(job.status) || "queued";
  return {
    job_id: id,
    job_type: nullableString(job.type || job.jobType),
    category: nullableString(job.category || job.section),
    status,
    name: nullableString(job.name || job.operation || job.title),
    message: nullableString(job.message || job.details),
    total_rows: nullableNumber(job.totalRows),
    processed_rows: nullableNumber(job.processedRows),
    changed_rows: nullableNumber(job.changed ?? job.changedRows),
    missing_rows: nullableNumber(job.missingCount ?? job.missingRows),
    progress: nullableNumber(job.progressPercent ?? job.progress),
    eta_seconds: nullableNumber(job.estimatedSecondsRemaining ?? job.etaSeconds),
    source: nullableString(job.source),
    output_path: nullableString(job.originalFilePath || job.filePath || job.outputPath),
    error_path: nullableString(job.errorFilePath || job.errorPath),
    created_at: nullableString(job.createdAt || job.startedAt),
    started_at: nullableString(job.startedAt),
    ended_at: nullableString(job.finishedAt || job.endedAt),
    raw: job
  };
}

function artifactRecordFromState(job = {}, kind = "original") {
  const jobId = nullableString(job.id || job.jobId);
  const isError = kind === "error" || kind === "errors";
  const isManifest = kind === "manifest";
  const filePath = nullableString(isManifest ? job.manifestFilePath : isError ? (job.errorFilePath || job.errorPath) : (job.originalFilePath || job.filePath || job.outputPath));
  if (!jobId || !filePath) return null;
  const fileName = nullableString(isManifest ? (job.manifestFileName || "manifest.json") : isError ? job.errorFileName : (job.originalFileName || job.fileName || job.filename));
  let byteSize = null;
  try {
    if (fs.existsSync(filePath)) byteSize = fs.statSync(filePath).size;
  } catch {
    byteSize = null;
  }
  return {
    artifact_id: `${jobId}:${isManifest ? "manifest" : isError ? "errors" : "original"}:${crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16)}`,
    job_id: jobId,
    artifact_kind: isManifest ? "manifest" : isError ? "errors" : "original",
    file_name: fileName || null,
    file_path: filePath,
    content_type: fileName?.endsWith(".json") ? "application/json" : fileName?.endsWith(".gz") ? "application/gzip" : "text/csv",
    row_count: nullableNumber(job.changed ?? job.totalRows ?? job.processedRows),
    byte_size: byteSize,
    raw: job
  };
}

async function upsertOperationArtifact(job = {}, kind = "original") {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const record = artifactRecordFromState(job, kind);
  if (!record) return false;
  await upsertOperationJob(job);
  await client.query(`
    insert into operation_artifacts (
      artifact_id, job_id, artifact_kind, file_name, file_path, content_type,
      row_count, byte_size, raw, updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7::int, $8::bigint, $9::jsonb, now())
    on conflict (artifact_id) do update set
      file_name = coalesce(excluded.file_name, operation_artifacts.file_name),
      file_path = excluded.file_path,
      content_type = coalesce(excluded.content_type, operation_artifacts.content_type),
      row_count = coalesce(excluded.row_count, operation_artifacts.row_count),
      byte_size = coalesce(excluded.byte_size, operation_artifacts.byte_size),
      raw = operation_artifacts.raw || excluded.raw,
      updated_at = now()
  `, [
    record.artifact_id, record.job_id, record.artifact_kind, record.file_name,
    record.file_path, record.content_type, record.row_count, record.byte_size,
    JSON.stringify(record.raw)
  ]);
  return true;
}

async function upsertOperationJob(job = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const record = jobRecordFromState(job);
  if (!record) return false;
  await client.query(`
    insert into operations_jobs (
      job_id, job_type, category, status, name, message, total_rows, processed_rows,
      changed_rows, missing_rows, progress, eta_seconds, source, output_path,
      error_path, created_at, started_at, ended_at, raw, updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7::int, $8::int, $9::int, $10::int, $11::numeric,
      $12::int, $13, $14, $15, coalesce($16::timestamptz, now()),
      $17::timestamptz, $18::timestamptz, $19::jsonb, now()
    )
    on conflict (job_id) do update set
      job_type = coalesce(excluded.job_type, operations_jobs.job_type),
      category = coalesce(excluded.category, operations_jobs.category),
      status = excluded.status,
      name = coalesce(excluded.name, operations_jobs.name),
      message = coalesce(excluded.message, operations_jobs.message),
      total_rows = coalesce(excluded.total_rows, operations_jobs.total_rows),
      processed_rows = coalesce(excluded.processed_rows, operations_jobs.processed_rows),
      changed_rows = coalesce(excluded.changed_rows, operations_jobs.changed_rows),
      missing_rows = coalesce(excluded.missing_rows, operations_jobs.missing_rows),
      progress = coalesce(excluded.progress, operations_jobs.progress),
      eta_seconds = coalesce(excluded.eta_seconds, operations_jobs.eta_seconds),
      source = coalesce(excluded.source, operations_jobs.source),
      output_path = coalesce(excluded.output_path, operations_jobs.output_path),
      error_path = coalesce(excluded.error_path, operations_jobs.error_path),
      started_at = coalesce(excluded.started_at, operations_jobs.started_at),
      ended_at = coalesce(excluded.ended_at, operations_jobs.ended_at),
      raw = operations_jobs.raw || excluded.raw,
      updated_at = now()
  `, [
    record.job_id, record.job_type, record.category, record.status, record.name,
    record.message, record.total_rows, record.processed_rows, record.changed_rows,
    record.missing_rows, record.progress, record.eta_seconds, record.source,
    record.output_path, record.error_path, record.created_at, record.started_at,
    record.ended_at, JSON.stringify(record.raw)
  ]);
  return true;
}

async function readOperationJobs(limit = 250) {
  const client = getPool();
  if (!client) return [];
  await initRelationalSchema();
  const result = await client.query(`
    select
      job_id, job_type, category, status, name, message, total_rows, processed_rows,
      changed_rows, missing_rows, progress, eta_seconds, source, output_path,
      error_path, created_at, started_at, ended_at, updated_at, raw
    from operations_jobs
    order by coalesce(created_at, updated_at) desc, updated_at desc
    limit $1
  `, [Math.max(1, Math.min(5000, Number(limit || 250)))]);
  const jobs = result.rows.map((row) => ({
    ...(row.raw || {}),
    id: row.job_id,
    type: row.job_type || row.raw?.type || "",
    category: row.category || row.raw?.category || "",
    status: row.status || row.raw?.status || "queued",
    operation: row.name || row.raw?.operation || row.raw?.name || "",
    message: row.message || row.raw?.message || "",
    totalRows: row.total_rows ?? row.raw?.totalRows,
    processedRows: row.processed_rows ?? row.raw?.processedRows,
    changed: row.changed_rows ?? row.raw?.changed,
    missingCount: row.missing_rows ?? row.raw?.missingCount,
    progressPercent: row.progress ?? row.raw?.progressPercent ?? row.raw?.progress,
    estimatedSecondsRemaining: row.eta_seconds ?? row.raw?.estimatedSecondsRemaining,
    source: row.source || row.raw?.source || "",
    originalFilePath: row.output_path || row.raw?.originalFilePath || row.raw?.filePath || "",
    filePath: row.output_path || row.raw?.filePath || "",
    errorFilePath: row.error_path || row.raw?.errorFilePath || row.raw?.errorPath || "",
    errorPath: row.error_path || row.raw?.errorPath || "",
    workerId: row.raw?.workerId || "",
    workerClaimedAt: row.raw?.workerClaimedAt || "",
    workerLastSeenAt: row.raw?.workerLastSeenAt || (row.raw?.workerId ? row.updated_at?.toISOString?.() || "" : ""),
    workerHealth: row.raw?.workerHealth || "",
    createdAt: row.created_at?.toISOString?.() || row.raw?.createdAt || "",
    startedAt: row.started_at?.toISOString?.() || row.raw?.startedAt || "",
    finishedAt: row.ended_at?.toISOString?.() || row.raw?.finishedAt || "",
    updatedAt: row.updated_at?.toISOString?.() || row.raw?.updatedAt || ""
  }));
  const ids = jobs.map((job) => job.id).filter(Boolean);
  if (ids.length) {
    const artifacts = await client.query(`
      select job_id, artifact_kind, file_name, file_path, content_type, row_count, byte_size, raw
      from operation_artifacts
      where job_id = any($1::text[])
      order by created_at desc
    `, [ids]);
    const byJob = new Map();
    for (const row of artifacts.rows) byJob.set(row.job_id, [...(byJob.get(row.job_id) || []), row]);
    for (const job of jobs) {
      const rows = byJob.get(job.id) || [];
      job.artifacts = rows.map((row) => ({
        kind: row.artifact_kind,
        fileName: row.file_name || "",
        filePath: row.file_path || "",
        contentType: row.content_type || "",
        rowCount: row.row_count,
        byteSize: row.byte_size,
        ...(row.raw?.artifact || {})
      }));
      const original = rows.find((row) => row.artifact_kind === "original");
      const errors = rows.find((row) => row.artifact_kind === "errors");
      if (original) {
        job.originalFileName = job.originalFileName || original.file_name || "";
        job.originalFilePath = job.originalFilePath || original.file_path || "";
        job.filePath = job.filePath || original.file_path || "";
      }
      if (errors) {
        job.errorFileName = job.errorFileName || errors.file_name || "";
        job.errorFilePath = job.errorFilePath || errors.file_path || "";
      }
    }
  }
  return jobs;
}

async function deleteOperationArtifactsForJob(jobId = "") {
  const client = getPool();
  if (!client || !jobId) return false;
  await initRelationalSchema();
  await client.query(`delete from operation_artifacts where job_id = $1`, [String(jobId)]);
  return true;
}

async function claimQueuedOperationJob({ workerId = "", tasks = [] } = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const taskList = (Array.isArray(tasks) ? tasks : []).map(String).filter(Boolean);
  if (!taskList.length) return null;
  const worker = nullableString(workerId) || `worker-${crypto.randomUUID()}`;
  const result = await client.query(`
    with candidate as (
      select job_id
      from operations_jobs
      where lower(status) = 'queued'
        and coalesce(raw ->> 'workerTask', '') = any($1::text[])
      order by created_at asc, updated_at asc
      for update skip locked
      limit 1
    )
    update operations_jobs job
    set
      status = 'running',
      started_at = coalesce(job.started_at, now()),
      updated_at = now(),
      raw = job.raw || jsonb_build_object(
        'status', 'running',
        'phase', 'claimed',
        'workerId', $2::text,
        'workerClaimedAt', now(),
        'workerLastSeenAt', now()
      )
    from candidate
    where job.job_id = candidate.job_id
    returning
      job.job_id, job.job_type, job.category, job.status, job.name, job.message,
      job.total_rows, job.processed_rows, job.changed_rows, job.missing_rows,
      job.progress, job.eta_seconds, job.source, job.output_path, job.error_path,
      job.created_at, job.started_at, job.ended_at, job.updated_at, job.raw
  `, [taskList, worker]);
  if (!result.rows.length) return null;
  const claimed = result.rows[0];
  return {
    ...(claimed.raw || {}),
    id: claimed.job_id,
    type: claimed.job_type || claimed.raw?.type || "",
    category: claimed.category || claimed.raw?.category || "",
    status: claimed.status,
    operation: claimed.name || claimed.raw?.operation || "",
    message: claimed.message || claimed.raw?.message || "",
    totalRows: claimed.total_rows ?? claimed.raw?.totalRows,
    processedRows: claimed.processed_rows ?? claimed.raw?.processedRows,
    changed: claimed.changed_rows ?? claimed.raw?.changed,
    missingCount: claimed.missing_rows ?? claimed.raw?.missingCount,
    progressPercent: claimed.progress ?? claimed.raw?.progressPercent,
    estimatedSecondsRemaining: claimed.eta_seconds ?? claimed.raw?.estimatedSecondsRemaining,
    source: claimed.source || claimed.raw?.source || "",
    originalFilePath: claimed.output_path || claimed.raw?.originalFilePath || "",
    errorFilePath: claimed.error_path || claimed.raw?.errorFilePath || "",
    workerId: claimed.raw?.workerId || "",
    workerClaimedAt: claimed.raw?.workerClaimedAt || "",
    workerLastSeenAt: claimed.raw?.workerLastSeenAt || (claimed.raw?.workerId ? claimed.updated_at?.toISOString?.() || "" : ""),
    workerHealth: claimed.raw?.workerHealth || "",
    createdAt: claimed.created_at?.toISOString?.() || claimed.raw?.createdAt || "",
    startedAt: claimed.started_at?.toISOString?.() || claimed.raw?.startedAt || "",
    finishedAt: claimed.ended_at?.toISOString?.() || claimed.raw?.finishedAt || "",
    updatedAt: claimed.updated_at?.toISOString?.() || claimed.raw?.updatedAt || ""
  };
}

const BACKUP_CORE_TABLES = [
  "vendors",
  "products",
  "product_identifiers",
  "product_aliases",
  "vendor_offers",
  "inventory_levels",
  "vendor_feed_runs",
  "category_channel_mappings",
  "order_records",
  "order_line_items",
  "purchase_order_records",
  "purchase_order_line_items",
  "operations_jobs",
  "operation_artifacts",
  "channel_api_logs",
  "product_change_events",
  "product_source_enrichments",
  "shopify_product_statuses",
  "product_quality_rows",
  "state_documents",
  "entity_documents"
];

const BACKUP_LARGE_TABLES = [
  "vendor_catalog_items",
  "vendor_catalog_snapshots",
  "vendor_catalog_facets"
];

function safeBackupTableName(table = "") {
  const name = String(table || "").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return "";
  return name;
}

async function countTableRows(table) {
  const client = getPool();
  const safeTable = safeBackupTableName(table);
  if (!client || !safeTable) return 0;
  const result = await client.query(`select count(*)::bigint as count from ${safeTable}`);
  return Number(result.rows[0]?.count || 0);
}

async function writeTableBackup({ table, outputDir, pageSize = 5000, onProgress, isCanceled } = {}) {
  const client = getPool();
  const safeTable = safeBackupTableName(table);
  if (!client || !safeTable) return { table, rows: 0, fileName: "", byteSize: 0 };
  const totalRows = await countTableRows(safeTable);
  const fileName = `${safeTable}.jsonl.gz`;
  const filePath = path.join(outputDir, fileName);
  const gzip = zlib.createGzip();
  const stream = fs.createWriteStream(filePath);
  gzip.pipe(stream);
  let written = 0;
  const batchSize = Math.max(100, Math.min(20000, Number(pageSize || 5000)));
  for (let offset = 0; offset < totalRows || (totalRows === 0 && offset === 0); offset += batchSize) {
    if (typeof isCanceled === "function" && isCanceled()) throw new Error("Backup job canceled.");
    const result = await client.query(
      `select row_to_json(t)::text as row_json from (select * from ${safeTable} offset $1 limit $2) t`,
      [offset, batchSize]
    );
    if (!result.rows.length) break;
    for (const row of result.rows) gzip.write(`${row.row_json}\n`);
    written += result.rows.length;
    if (typeof onProgress === "function") onProgress({ table: safeTable, tableRows: written, tableTotal: totalRows });
    if (result.rows.length < batchSize) break;
  }
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    gzip.on("error", reject);
    gzip.end();
  });
  const stat = fs.statSync(filePath);
  return { table: safeTable, rows: written, fileName, filePath, byteSize: stat.size };
}

async function createPostgresBackup({ outputDir, includeSourceCatalog = false, pageSize = 5000, onProgress, isCanceled } = {}) {
  const client = getPool();
  if (!client) throw new Error("Postgres is not configured.");
  await initRelationalSchema();
  const backupId = crypto.randomUUID();
  const rootDir = outputDir || path.join(process.cwd(), "data", "backups");
  const backupDir = path.join(rootDir, `dataplus-postgres-${new Date().toISOString().replace(/[:.]/g, "-")}-${backupId.slice(0, 8)}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const tables = [...BACKUP_CORE_TABLES, ...(includeSourceCatalog ? BACKUP_LARGE_TABLES : [])];
  const totals = [];
  let totalRows = 0;
  for (const table of tables) {
    const rows = await countTableRows(table);
    totals.push({ table, rows });
    totalRows += rows;
  }
  const manifest = {
    id: backupId,
    database: "",
    createdAt: new Date().toISOString(),
    includeSourceCatalog,
    totalRows,
    tables: [],
    skippedTables: includeSourceCatalog ? [] : BACKUP_LARGE_TABLES,
    format: "jsonl.gz-per-table"
  };
  const dbResult = await client.query("select current_database() as database");
  manifest.database = dbResult.rows[0]?.database || "";
  let processedRows = 0;
  for (const tableInfo of totals) {
    const tableResult = await writeTableBackup({
      table: tableInfo.table,
      outputDir: backupDir,
      pageSize,
      isCanceled,
      onProgress: (progress = {}) => {
        const tableRows = Number(progress.tableRows || 0);
        const alreadyBeforeTable = processedRows;
        onProgress?.({
          phase: "backing_up_table",
          table: tableInfo.table,
          processedRows: alreadyBeforeTable + tableRows,
          totalRows,
          message: `Backing up ${tableInfo.table} (${tableRows.toLocaleString()} / ${Number(tableInfo.rows || 0).toLocaleString()})`
        });
      }
    });
    processedRows += tableResult.rows;
    manifest.tables.push(tableResult);
    onProgress?.({
      phase: "backing_up_table",
      table: tableInfo.table,
      processedRows,
      totalRows,
      message: `Backed up ${tableInfo.table}.`
    });
  }
  const manifestPath = path.join(backupDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, backupDir, manifestPath, rows: processedRows };
}

function channelApiLogRowToState(row = {}) {
  const raw = row.raw || {};
  return {
    ...raw,
    id: String(row.log_id || raw.id || ""),
    createdAt: row.created_at?.toISOString?.() || raw.createdAt || "",
    channel: row.channel || raw.channel || "",
    transport: raw.transport || "",
    method: row.method || raw.method || "",
    path: row.path || raw.path || "",
    operation: row.operation || raw.operation || "",
    statusCode: row.status_code ?? raw.statusCode ?? 0,
    ok: row.ok ?? raw.ok ?? false,
    durationMs: Number(raw.durationMs || 0) || 0,
    requestId: row.request_id || raw.requestId || "",
    jobId: row.job_id || raw.jobId || "",
    message: row.message || raw.message || ""
  };
}

async function insertChannelApiLog(entry = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const raw = { ...entry };
  await client.query(`
    insert into channel_api_logs (
      channel, operation, method, path, status_code, ok, request_id, job_id, message, raw, created_at
    )
    values ($1, $2, $3, $4, $5::int, $6::boolean, $7, $8, $9, $10::jsonb, coalesce($11::timestamptz, now()))
  `, [
    nullableString(entry.channel),
    nullableString(entry.operation),
    nullableString(entry.method),
    nullableString(entry.path),
    nullableNumber(entry.statusCode),
    Boolean(entry.ok),
    nullableString(entry.requestId),
    nullableString(entry.jobId),
    nullableString(entry.message),
    JSON.stringify(raw),
    nullableString(entry.createdAt)
  ]);
  return true;
}

async function readChannelApiLogs({ channel = "", days = 30, limit = 250, jobId = "" } = {}) {
  const client = getPool();
  if (!client) return [];
  await initRelationalSchema();
  const channelKey = nullableString(channel);
  const jobKey = nullableString(jobId);
  const maxRows = Math.max(1, Math.min(1000, Number(limit || 250)));
  const daysBack = Math.max(1, Math.min(365, Number(days || 30)));
  const params = [daysBack, maxRows];
  let channelClause = "";
  if (channelKey) {
    params.push(channelKey);
    channelClause = `and lower(channel) = lower($${params.length})`;
  }
  let jobClause = "";
  if (jobKey) {
    params.push(jobKey);
    jobClause = `and job_id = $${params.length}`;
  }
  const result = await client.query(`
    select log_id, channel, operation, method, path, status_code, ok, request_id, job_id, message, raw, created_at
    from channel_api_logs
    where created_at >= now() - ($1::int * interval '1 day')
      ${channelClause}
      ${jobClause}
    order by created_at desc
    limit $2
  `, params);
  return result.rows.map(channelApiLogRowToState);
}

async function pruneChannelApiLogs(days = 30) {
  const client = getPool();
  if (!client) return 0;
  await initRelationalSchema();
  const daysBack = Math.max(1, Math.min(365, Number(days || 30)));
  const result = await client.query(`
    delete from channel_api_logs
    where created_at < now() - ($1::int * interval '1 day')
  `, [daysBack]);
  return Number(result.rowCount || 0);
}

function productRowNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replace(/[$,%\s]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function productRowUomInfo(item = {}) {
  const code = String(item.uom || item.unitOfMeasure || item.unit_of_measure || "EA").trim().toUpperCase() || "EA";
  const qty = Math.max(1, Math.floor(productRowNumber(item.uomQty ?? item.uom_qty ?? item.minQuantity ?? item.min_quantity ?? item.quantityIncrements ?? item.quantity_increments, 1)));
  const names = { EA: "Each", CS: "Case", PK: "Pack", BX: "Box", CT: "Carton" };
  const name = names[code] || code || "Each";
  return {
    code,
    name,
    qty,
    isMultiUnit: qty > 1,
    display: qty > 1 ? (code === "EA" ? `Pack of ${qty}` : `${name} of ${qty}`) : name
  };
}

function productRowVariantSku(baseSku = "", suffix = "") {
  const sku = String(baseSku || "").trim();
  const cleanSuffix = String(suffix || "").trim().toUpperCase();
  return sku && cleanSuffix && !sku.toUpperCase().endsWith(`-${cleanSuffix}`) ? `${sku}-${cleanSuffix}` : sku;
}

function productRowSystemVariants(item = {}) {
  const uom = productRowUomInfo(item);
  const parentSku = String(item.sku || item.vendorSku || item.mfrPartNumber || "").trim();
  const sku = uom.isMultiUnit ? productRowVariantSku(parentSku, `${uom.qty}PC`) : parentSku;
  if (!sku) return [];
  const available = Math.max(0, productRowNumber(item.qty ?? item.stockQty, 0) - productRowNumber(item.reserved, 0));
  const unitCost = productRowNumber(item.sourceCost ?? item.cost, 0) * uom.qty;
  return [{
    id: `${parentSku || "sku"}:${uom.isMultiUnit ? `pack-${uom.qty}` : "each"}`,
    key: uom.isMultiUnit ? `pack-${uom.qty}` : "each",
    sku,
    parentSku,
    title: String(item.marketplaceTitle || item.title || parentSku || "").trim(),
    source: "data-dump",
    variantType: "sell-unit",
    optionName: uom.isMultiUnit ? "Purchase Unit" : "Title",
    optionValue: uom.isMultiUnit ? uom.display : "Default Title",
    uom: uom.code,
    uomName: uom.name,
    uomQty: uom.qty,
    packQty: uom.qty,
    inventoryMultiplier: 1,
    quantity: available,
    unitCost,
    actual: true,
    generated: true,
    status: "active",
    note: uom.isMultiUnit ? `Actual sell unit from source data: ${uom.display}.` : "Actual sell unit from source data."
  }];
}

function productRowToState(row = {}) {
  const product = {
    ...(row.raw || {}),
    id: row.product_id || row.raw?.id,
    sku: row.sku || row.raw?.sku,
    title: row.title ?? row.raw?.title,
    marketplaceTitle: row.marketplace_title ?? row.raw?.marketplaceTitle,
    brand: row.brand ?? row.raw?.brand,
    manufacturer: row.manufacturer ?? row.raw?.manufacturer,
    mfrPartNumber: row.mfr_part_number ?? row.raw?.mfrPartNumber,
    vendorSku: row.vendor_sku ?? row.raw?.vendorSku,
    barcode: row.barcode ?? row.raw?.barcode,
    category: row.category ?? row.raw?.category,
    mainCategory: row.main_category ?? row.raw?.mainCategory,
    sourceCategory: row.source_category ?? row.raw?.sourceCategory,
    supplier: row.supplier ?? row.raw?.supplier,
    supplierCode: row.supplier_code ?? row.raw?.supplierCode,
    active: row.active ?? row.raw?.active,
    toBeDiscontinued: row.to_be_discontinued ?? row.raw?.toBeDiscontinued,
    uom: row.uom ?? row.raw?.uom,
    uomQty: row.uom_qty ?? row.raw?.uomQty,
    cost: row.cost ?? row.raw?.cost,
    price: row.price ?? row.raw?.price,
    qty: row.qty ?? row.raw?.qty,
    defaultImage: row.default_image ?? row.raw?.defaultImage
  };
  product.systemVariants = productRowSystemVariants(product);
  return product;
}

function aliasRowToState(row = {}) {
  return {
    ...(row.raw || {}),
    id: row.alias_id || row.raw?.id,
    parentSku: row.parent_sku || row.raw?.parentSku || "",
    aliasSku: row.alias_sku || row.raw?.aliasSku || row.raw?.sku || "",
    source: row.source || row.raw?.source || "",
    type: row.alias_type || row.raw?.type || row.raw?.mode || "direct",
    active: row.active !== false,
    createdFromOrderId: row.created_from_order_id || row.raw?.createdFromOrderId || "",
    createdFromOrderNumber: row.created_from_order_number || row.raw?.createdFromOrderNumber || "",
    createdFromLineIndex: row.created_from_line_index ?? row.raw?.createdFromLineIndex ?? null,
    createdAt: row.created_at?.toISOString?.() || row.raw?.createdAt || "",
    updatedAt: row.updated_at?.toISOString?.() || row.raw?.updatedAt || ""
  };
}

function offerRowToState(row = {}) {
  return {
    ...(row.raw || {}),
    id: row.offer_id,
    productId: row.product_id || row.raw?.productId || "",
    vendorId: row.vendor_id || row.raw?.vendorId || "",
    sourceKey: row.source_key || row.raw?.sourceKey || "",
    vendorSku: row.vendor_sku || row.raw?.vendorSku || "",
    cost: row.cost ?? row.raw?.cost,
    price: row.price ?? row.raw?.price,
    qty: row.qty ?? row.raw?.qty,
    uom: row.uom || row.raw?.uom || "",
    uomQty: row.uom_qty ?? row.raw?.uomQty,
    discontinued: row.discontinued ?? row.raw?.discontinued ?? false,
    observedAt: row.observed_at?.toISOString?.() || row.raw?.observedAt || ""
  };
}

function inventoryLevelRowToState(row = {}) {
  return {
    warehouseId: row.location_key || "",
    warehouseName: row.location_key || "",
    qty: Number(row.on_hand || 0),
    available: Number(row.available || 0),
    reserved: Number(row.reserved || 0),
    committed: Number(row.committed || 0),
    incoming: Number(row.incoming || 0),
    updatedAt: row.updated_at?.toISOString?.() || ""
  };
}

function changeEventRowToState(row = {}) {
  return {
    id: row.event_id,
    sku: row.sku || "",
    field: row.field_name || "",
    before: row.old_value,
    after: row.new_value,
    source: row.source || "",
    jobId: row.job_id || "",
    createdAt: row.created_at?.toISOString?.() || ""
  };
}

async function readProductByKey(key) {
  const client = getPool();
  const value = nullableString(key);
  if (!client || !value) return null;
  await initRelationalSchema();
  const result = await client.query(`
    select *
    from products
    where product_id = $1
      or lower(sku) = lower($1)
      or product_id = (
        select product_id
        from product_aliases
        where lower(alias_sku) = lower($1)
          and active = true
        limit 1
      )
    limit 1
  `, [value]);
  if (!result.rows[0]) return null;
  const item = productRowToState(result.rows[0]);
  const productId = item.id;
  const sku = item.sku || "";
  const [aliases, identifiers, offers, levels, changes, sourceRows, shopifyStatus, sourceEnrichment] = await Promise.all([
    client.query(`
      select *
      from product_aliases
      where product_id = $1
      order by active desc, updated_at desc, alias_sku
    `, [productId]),
    client.query(`
      select identifier_type, identifier_value, source, created_at
      from product_identifiers
      where product_id = $1
      order by identifier_type, identifier_value
    `, [productId]),
    client.query(`
      select *
      from vendor_offers
      where product_id = $1
      order by observed_at desc
      limit 25
    `, [productId]),
    client.query(`
      select *
      from inventory_levels
      where product_id = $1
      order by location_key
    `, [productId]),
    client.query(`
      select event_id, sku, field_name, old_value, new_value, source, job_id, created_at
      from product_change_events
      where product_id = $1 or lower(sku) = lower($2)
      order by created_at desc, event_id desc
      limit 50
    `, [productId, sku]),
    client.query(`
      select vendor_id, source_sku, internal_sku, vendor_sku, title, brand, manufacturer,
        mfr_part_number, barcode, category, source_category, cost, price, list_price,
        qty, stock_status, uom, uom_qty, to_be_discontinued, default_image, raw,
        last_seen_at, updated_at
      from vendor_catalog_items
      where lower(source_sku) = lower($1)
        or lower(internal_sku) = lower($1)
        or lower(vendor_sku) = lower($2)
      order by (lower(source_sku) = lower($1)) desc, updated_at desc
      limit 10
    `, [sku, item.vendorSku || sku]),
    client.query(`
      select status_payload
      from shopify_product_statuses
      where lower(sku) = lower($1)
      limit 1
    `, [sku]),
    client.query(`
      select source_payload
      from product_source_enrichments
      where lower(sku) = lower($1)
      limit 1
    `, [sku])
  ]);
  if (sourceEnrichment.rows[0]?.source_payload) {
    const payload = sourceEnrichment.rows[0].source_payload || {};
    const numericPayloadFields = new Set([
      "itemHeight", "itemLength", "itemWeight", "itemWidth",
      "packageHeight", "packageLength", "packageWeight", "packageWidth",
      "dimensionalWeight"
    ]);
    for (const [key, value] of Object.entries(payload)) {
      if (numericPayloadFields.has(key)) {
        if (!(Number(item[key] || 0) > 0) && Number(value || 0) > 0) item[key] = value;
      } else if (item[key] === undefined || item[key] === null || item[key] === "") {
        item[key] = value;
      }
    }
  }
  if (shopifyStatus.rows[0]?.status_payload) Object.assign(item, shopifyStatus.rows[0].status_payload || {});
  item.aliases = aliases.rows.map(aliasRowToState);
  item.identifiers = identifiers.rows.map((row) => ({
    type: row.identifier_type,
    value: row.identifier_value,
    source: row.source,
    createdAt: row.created_at?.toISOString?.() || ""
  }));
  item.vendorOffers = offers.rows.map(offerRowToState);
  if (levels.rows.length) {
    item.warehouseStock = levels.rows.map(inventoryLevelRowToState);
    item.qty = item.warehouseStock.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    item.stockQty = item.qty;
    item.reserved = item.warehouseStock.reduce((sum, row) => sum + Number(row.reserved || 0), 0);
    item.available = item.warehouseStock.reduce((sum, row) => sum + Number(row.available || 0), 0);
  }
  item.recentChanges = changes.rows.map(changeEventRowToState);
  item.sourceCatalogMatches = sourceRows.rows.map((row) => {
    const listPrice = isClearanceCatalogItem(row) ? row.list_price : null;
    const commercial = commercialStateFromRaw(row.raw || {});
    return {
      vendorId: row.vendor_id,
      sourceSku: row.source_sku,
      internalSku: row.internal_sku,
      vendorSku: row.vendor_sku,
      title: row.title,
      brand: row.brand,
      manufacturer: row.manufacturer,
      mfrPartNumber: row.mfr_part_number,
      barcode: row.barcode,
      category: row.category,
      sourceCategory: row.source_category,
      cost: row.cost,
      price: row.price,
      listPrice,
      qty: row.qty,
      stockStatus: row.stock_status,
      uom: row.uom,
      uomQty: row.uom_qty,
      toBeDiscontinued: row.to_be_discontinued,
      defaultImage: row.default_image,
      ...commercial,
      raw: row.raw,
      lastSeenAt: row.last_seen_at?.toISOString?.() || "",
      updatedAt: row.updated_at?.toISOString?.() || ""
    };
  });
  return item;
}

async function readProductByShopifyGid(gid) {
  const client = getPool();
  const value = nullableString(gid);
  if (!client || !value) return null;
  await initRelationalSchema();
  const legacy = value.match(/\/Product\/(\d+)$/)?.[1] || value;
  const result = await client.query(`
    select *
    from products
    where coalesce(raw ->> 'shopifyId', '') = $1
      or coalesce(raw ->> 'shopifyId', '') = $2
      or regexp_replace(coalesce(raw ->> 'shopifyId', ''), '^.*/Product/', '') = $2
      or product_id = (
        select product_id
        from shopify_product_statuses
        where shopify_id = $1
          or shopify_id = $2
          or regexp_replace(coalesce(shopify_id, ''), '^.*/Product/', '') = $2
        limit 1
      )
    limit 1
  `, [value, legacy]);
  return result.rows[0] ? productRowToState(result.rows[0]) : null;
}

async function readProductsByKeys(keys = []) {
  const client = getPool();
  if (!client) return [];
  const normalized = [...new Set((Array.isArray(keys) ? keys : [])
    .map((key) => nullableString(key))
    .filter(Boolean))];
  if (!normalized.length) return [];
  await initRelationalSchema();
  const lowerKeys = normalized.map((key) => key.toLowerCase());
  const legacyKeys = normalized.map((key) => key.match(/\/Product\/(\d+)$/)?.[1] || key).filter(Boolean);
  const lowerLegacyKeys = [...new Set(legacyKeys.map((key) => String(key).toLowerCase()))];
  const result = await client.query(`
    select *
    from products
    where lower(product_id) = any($1)
      or lower(sku) = any($1)
      or lower(coalesce(raw ->> 'shopifyId', '')) = any($1)
      or lower(regexp_replace(coalesce(raw ->> 'shopifyId', ''), '^.*/Product/', '')) = any($2)
      or product_id in (
        select product_id
        from product_aliases
        where lower(alias_sku) = any($1)
          and active = true
      )
  `, [lowerKeys, lowerLegacyKeys]);
  return result.rows.map(productRowToState);
}

async function listProducts(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const q = nullableString(options.q || options.query);
  const limit = Math.max(1, Math.min(100000, Number(options.limit || 100000)));
  const page = Math.max(1, Number(options.page || 1));
  const offset = (page - 1) * limit;
  const params = [];
  const where = [];
  const filters = options.filters || {};
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(sku) like $${params.length}
      or lower(coalesce(title, '')) like $${params.length}
      or lower(coalesce(brand, '')) like $${params.length}
      or lower(coalesce(vendor_sku, '')) like $${params.length}
      or lower(coalesce(mfr_part_number, '')) like $${params.length}
      or lower(coalesce(barcode, '')) like $${params.length}
      or lower(coalesce(category, '')) like $${params.length}
      or lower(coalesce(supplier, '')) like $${params.length}
      or exists (
        select 1
        from product_aliases pa
        where pa.product_id = products.product_id
          and lower(pa.alias_sku) like $${params.length}
      )
    )`);
  }
  const supplierValues = splitFilterValues(filters.supplier).map((value) => value.toLowerCase());
  if (supplierValues.length) {
    params.push(supplierValues);
    where.push(`lower(coalesce(supplier, '')) = any($${params.length})`);
  }
  const activeValues = [...new Set(splitFilterValues(filters.active).map(parseFilterBoolean))];
  if (activeValues.length === 1) {
    params.push(activeValues[0]);
    where.push(`coalesce(active, true) = $${params.length}`);
  }
  const hasStockValues = [...new Set(splitFilterValues(filters.hasStock).map(parseFilterBoolean))];
  if (hasStockValues.length === 1) {
    where.push(hasStockValues[0] ? `coalesce(qty, 0) > 0` : `coalesce(qty, 0) <= 0`);
  }
  const discontinuedValues = [...new Set(splitFilterValues(filters.toBeDiscontinued).map(parseFilterBoolean))];
  if (discontinuedValues.length === 1) {
    params.push(discontinuedValues[0]);
    where.push(`coalesce(to_be_discontinued, false) = $${params.length}`);
  }
  const brandValues = splitFilterValues(filters.brand).map((value) => value.toLowerCase());
  if (brandValues.length) {
    params.push(brandValues);
    where.push(`lower(coalesce(brand, '')) = any($${params.length})`);
  }
  const categoryValues = splitFilterValues(filters.category).map((value) => value.toLowerCase());
  if (categoryValues.length) {
    params.push(categoryValues);
    where.push(`lower(coalesce(category, '')) = any($${params.length})`);
  }
  const stockStatusValues = splitFilterValues(filters.stockStatus);
  if (stockStatusValues.length) {
    params.push(stockStatusValues);
    where.push(`coalesce(raw ->> 'stockStatus', '') = any($${params.length})`);
  }
  const stockQtyExpression = `coalesce(
    qty,
    case when coalesce(raw ->> 'stockQty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'stockQty')::numeric end,
    case when coalesce(raw ->> 'qty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'qty')::numeric end
  )`;
  const stockQtyOperator = nullableString(filters.stockQtyOperator);
  const stockQtyValues = splitFilterValues(filters.stockQty).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (stockQtyOperator) {
    if (stockQtyOperator === "empty") where.push(`${stockQtyExpression} is null`);
    else if (stockQtyOperator === "notEmpty") where.push(`${stockQtyExpression} is not null`);
    else if (stockQtyValues.length) {
      if (stockQtyOperator === "gt") {
        params.push(stockQtyValues[0]);
        where.push(`${stockQtyExpression} > $${params.length}`);
      } else if (stockQtyOperator === "gte") {
        params.push(stockQtyValues[0]);
        where.push(`${stockQtyExpression} >= $${params.length}`);
      } else if (stockQtyOperator === "lt") {
        params.push(stockQtyValues[0]);
        where.push(`${stockQtyExpression} < $${params.length}`);
      } else if (stockQtyOperator === "lte") {
        params.push(stockQtyValues[0]);
        where.push(`${stockQtyExpression} <= $${params.length}`);
      } else if (stockQtyOperator === "between") {
        params.push(stockQtyValues[0], stockQtyValues[1] ?? stockQtyValues[0]);
        where.push(`${stockQtyExpression} between $${params.length - 1} and $${params.length}`);
      } else {
        params.push(stockQtyValues[0]);
        where.push(`${stockQtyExpression} = $${params.length}`);
      }
    }
  }
  const hazardousValues = [...new Set(splitFilterValues(filters.hazardous).map(parseFilterBoolean))];
  if (hazardousValues.length === 1) {
    params.push(hazardousValues[0]);
    where.push(`case when lower(coalesce(raw ->> 'hazardous', 'false')) in ('true','1','yes','y') then true else false end = $${params.length}`);
  }
  const verifiedBrandValues = [...new Set(splitFilterValues(filters.verifiedBrand).map(parseFilterBoolean))];
  if (verifiedBrandValues.length === 1) {
    params.push(verifiedBrandValues[0]);
    where.push(`case when lower(coalesce(raw ->> 'brandLocked', 'false')) in ('true','1','yes','y') then true else false end = $${params.length}`);
  }
  const hasShopifyLiveStatus = `(
    (
      coalesce(raw ->> 'shopifyId', '') <> ''
      and lower(coalesce(raw ->> 'shopifyStatus', '')) = 'active'
      and case when lower(coalesce(raw ->> 'shopifyPublished', 'false')) in ('true','1','yes','y') then true else false end = true
    )
    or exists (
      select 1
      from shopify_product_statuses sps
      where sps.product_id = products.product_id
        and coalesce(sps.shopify_id, '') <> ''
        and lower(coalesce(sps.shopify_status, '')) = 'active'
        and coalesce(sps.shopify_published, false) = true
    )
  )`;
  const numericPriceExpression = `coalesce(
    price,
    case when coalesce(raw ->> 'websitePrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'websitePrice')::numeric end,
    case when coalesce(raw ->> 'shopifyPrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'shopifyPrice')::numeric end,
    case when coalesce(raw ->> 'listPrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'listPrice')::numeric end,
    0
  )`;
  const uomQtyExpression = `coalesce(
    case when coalesce(raw ->> 'uomQty', '') ~ '^[0-9]+(\\.[0-9]+)?$' then (raw ->> 'uomQty')::numeric end,
    case when coalesce(raw ->> 'uom_qty', '') ~ '^[0-9]+(\\.[0-9]+)?$' then (raw ->> 'uom_qty')::numeric end,
    1
  )`;
  const shopifyStatusSkuMatch = `(
    sps.product_id = products.product_id
    or lower(sps.sku) = lower(products.sku)
    or (
      ${uomQtyExpression} > 1
      and lower(sps.sku) = lower(products.sku || '-' || floor(${uomQtyExpression})::text || 'pc')
    )
  )`;
  const numericQtyExpression = `coalesce(
    qty,
    case when coalesce(raw ->> 'inventoryQty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'inventoryQty')::numeric end,
    case when coalesce(raw ->> 'shopifyInventoryQty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'shopifyInventoryQty')::numeric end,
    0
  )`;
  const ebayListingStatusExpression = `coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '')`;
  const hasEbayOffer = `(
    coalesce(raw #>> '{ebayListing,offerId}', '') <> ''
    or ${ebayListingStatusExpression} = 'Offer'
  )`;
  const hasEbayLive = `(
    coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') <> ''
    or ${ebayListingStatusExpression} = 'Live'
  )`;
  const numericEbayPriceExpression = `coalesce(
    case when coalesce(raw #>> '{ebayListing,price}', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw #>> '{ebayListing,price}')::numeric end,
    price,
    case when coalesce(raw ->> 'ebayPrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'ebayPrice')::numeric end,
    case when coalesce(raw ->> 'websitePrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'websitePrice')::numeric end,
    case when coalesce(raw ->> 'listPrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'listPrice')::numeric end,
    0
  )`;
  const numericEbayQtyExpression = `coalesce(
    case when coalesce(raw #>> '{ebayListing,quantity}', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw #>> '{ebayListing,quantity}')::numeric end,
    qty,
    case when coalesce(raw ->> 'stockQty', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (raw ->> 'stockQty')::numeric end,
    0
  )`;
  const hasEbayRequiredFields = `(
    coalesce(raw #>> '{ebayListing,merchantLocationKey}', raw ->> 'ebayMerchantLocationKey', '') <> ''
    and coalesce(raw #>> '{ebayListing,categoryId}', raw ->> 'ebayCategoryId', category, raw ->> 'category', '') <> ''
    and coalesce(raw #>> '{ebayListing,paymentPolicyId}', raw ->> 'ebayPaymentPolicyId', '') <> ''
    and coalesce(raw #>> '{ebayListing,returnPolicyId}', raw ->> 'ebayReturnPolicyId', '') <> ''
    and coalesce(raw #>> '{ebayListing,fulfillmentPolicyId}', raw ->> 'ebayFulfillmentPolicyId', '') <> ''
    and ${numericEbayPriceExpression} > 0
    and ${numericEbayQtyExpression} > 0
    and (
      coalesce(raw ->> 'image', raw ->> 'imageUrl', raw ->> 'defaultImage', raw ->> 'primaryImage', raw ->> 'thumbnailUrl', '') <> ''
      or jsonb_array_length(case when jsonb_typeof(raw -> 'images') = 'array' then raw -> 'images' else '[]'::jsonb end) > 0
      or jsonb_array_length(case when jsonb_typeof(raw -> 'productImages') = 'array' then raw -> 'productImages' else '[]'::jsonb end) > 0
    )
  )`;
  const hasShopifyRequiredFields = `(
    coalesce(sku, raw ->> 'sku', raw ->> 'variantSku', raw ->> 'shopifyVariantSku', '') <> ''
    and not (
      coalesce(to_be_discontinued, false) = true
      and ${numericQtyExpression} <= 0
    )
    and coalesce(title, raw ->> 'marketplaceTitle', raw ->> 'title', raw ->> 'name', '') <> ''
    and coalesce(raw ->> 'bodyHtml', raw ->> 'bodyHTML', raw ->> 'longDescription', raw ->> 'description', raw ->> 'shortDescription', '') <> ''
    and coalesce(raw ->> 'productType', raw ->> 'shopifyProductType', category, raw ->> 'category', raw ->> 'shopifyTaxonomyId', raw ->> 'shopifyCategoryId', '') <> ''
    and coalesce(raw ->> 'vendor', raw ->> 'supplier', brand, raw ->> 'brand', '') <> ''
    and ${numericPriceExpression} > 0
    and ${numericQtyExpression} > 0
    and (
      coalesce(raw ->> 'image', raw ->> 'imageUrl', raw ->> 'defaultImage', raw ->> 'primaryImage', raw ->> 'thumbnailUrl', '') <> ''
      or jsonb_array_length(case when jsonb_typeof(raw -> 'images') = 'array' then raw -> 'images' else '[]'::jsonb end) > 0
      or jsonb_array_length(case when jsonb_typeof(raw -> 'shopifyImages') = 'array' then raw -> 'shopifyImages' else '[]'::jsonb end) > 0
      or jsonb_array_length(case when jsonb_typeof(raw -> 'productImages') = 'array' then raw -> 'productImages' else '[]'::jsonb end) > 0
    )
  )`;
  const channelStatusValues = splitFilterValues(filters.channelStatus).map((value) => value.toLowerCase());
  const channelStatusClause = (channelStatus) => {
    if (channelStatus === "shopify-live" || channelStatus === "live") {
      return hasShopifyLiveStatus;
    }
    if (channelStatus === "shopify-not-live") {
      return `(not (${hasShopifyLiveStatus}))`;
    }
    if (channelStatus === "shopify-price-mismatch") {
      return `exists (
        select 1
        from shopify_product_statuses sps
        where sps.product_id = products.product_id
          and coalesce(sps.status_payload ->> 'shopifyVariantPrice', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          and abs(
            ${numericPriceExpression}
            - (sps.status_payload ->> 'shopifyVariantPrice')::numeric
          ) >= 0.01
      )`;
    }
    if (channelStatus === "shopify-linked") {
      return `(
        coalesce(raw ->> 'shopifyId', '') <> ''
        or exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and coalesce(sps.shopify_id, '') <> ''
        )
      )`;
    }
    if (channelStatus === "shopify-published") {
      return `(
        case when lower(coalesce(raw ->> 'shopifyPublished', 'false')) in ('true','1','yes','y') then true else false end = true
        or exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and coalesce(sps.shopify_published, false) = true
        )
      )`;
    }
    if (channelStatus === "shopify-unpublished") {
      return `(
        (
          coalesce(raw ->> 'shopifyId', '') <> ''
          and case when lower(coalesce(raw ->> 'shopifyPublished', 'false')) in ('true','1','yes','y') then true else false end = false
        )
        or exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and coalesce(sps.shopify_id, '') <> ''
            and coalesce(sps.shopify_published, false) = false
        )
      )`;
    }
    if (channelStatus === "shopify-sync-graphql" || channelStatus === "shopify-sync-manual" || channelStatus === "shopify-sync-failed") {
      const syncSource = channelStatus === "shopify-sync-graphql" ? "graphql"
        : channelStatus === "shopify-sync-manual" ? "manual_upload"
          : "failed";
      params.push(syncSource);
      return `(
        lower(coalesce(raw ->> 'shopifySyncSource', '')) = $${params.length}
        or exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and lower(coalesce(sps.sync_source, '')) = $${params.length}
        )
      )`;
    }
    if (channelStatus === "shopify-ready") return `(${hasShopifyLiveStatus} or ${hasShopifyRequiredFields})`;
    if (channelStatus === "shopify-not-ready") return `(not (${hasShopifyLiveStatus}) and not (${hasShopifyRequiredFields}))`;
    if (channelStatus === "shopify-missing" || channelStatus === "missing") {
      return `(
        coalesce(raw ->> 'shopifyId', '') = ''
        and not exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and coalesce(sps.shopify_id, '') <> ''
        )
      )`;
    }
    if (channelStatus.startsWith("shopify:") || channelStatus.startsWith("shopify-")) {
      const statusValue = channelStatus.startsWith("shopify:")
        ? channelStatus.slice("shopify:".length)
        : channelStatus.slice("shopify-".length);
      params.push(statusValue.toLowerCase());
      return `(
        lower(coalesce(raw ->> 'shopifyStatus', '')) = $${params.length}
        or exists (
          select 1
          from shopify_product_statuses sps
          where sps.product_id = products.product_id
            and lower(coalesce(sps.shopify_status, '')) = $${params.length}
        )
      )`;
    }
    if (channelStatus === "ebay-ready") return `(not (${hasEbayLive}) and not (${hasEbayOffer}) and ${hasEbayRequiredFields})`;
    if (channelStatus === "ebay-not-ready") return `(not (${hasEbayLive}) and not (${hasEbayRequiredFields}))`;
    if (channelStatus === "ebay-live") return hasEbayLive;
    if (channelStatus === "ebay-offer") return hasEbayOffer;
    if (channelStatus === "ebay-missing") return `(not (${hasEbayLive}) and not (${hasEbayOffer}))`;
    if (channelStatus.startsWith("ebay:")) {
      params.push(channelStatus.slice("ebay:".length));
      return `${ebayListingStatusExpression} = $${params.length}`;
    }
    return "";
  };
  if (channelStatusValues.length) {
    const channelClauses = channelStatusValues.map((value) => channelStatusClause(value)).filter(Boolean);
    if (channelClauses.length) where.push(`(${channelClauses.join(" or ")})`);
  }
  const channelStatusAllValues = splitFilterValues(filters.channelStatusAll).map((value) => value.toLowerCase());
  if (channelStatusAllValues.length) {
    const channelClauses = channelStatusAllValues.map((value) => channelStatusClause(value)).filter(Boolean);
    for (const clause of channelClauses) where.push(`(${clause})`);
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const countResult = await client.query(`select count(*)::int as total from products ${whereSql}`, params);
  params.push(limit, offset);
  const result = await client.query(`
    select *
    from products
    ${whereSql}
    order by sku
    limit $${params.length - 1} offset $${params.length}
  `, params);
  const inventory = await hydrateProductsWithShopifyStatuses(result.rows.map(productRowToState));
  return {
    inventory,
    total: countResult.rows[0]?.total || 0,
    page,
    limit
  };
}

async function productFacets() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const [suppliers, brands, categories, shopifyStatuses, ebayStatuses, shopifyLiveCounts] = await Promise.all([
    client.query("select supplier as value, count(*)::int as count from products where coalesce(supplier, '') <> '' group by supplier order by supplier limit 500"),
    client.query("select brand as value, count(*)::int as count from products where coalesce(brand, '') <> '' group by brand order by brand limit 1000"),
    client.query("select category as value, count(*)::int as count from products where coalesce(category, '') <> '' group by category order by category limit 2000"),
    client.query(`
      select value
      from (
        select shopify_status as value from shopify_product_statuses where coalesce(shopify_status, '') <> ''
        union
        select raw ->> 'shopifyStatus' as value from products where coalesce(raw ->> 'shopifyStatus', '') <> ''
      ) statuses
      where coalesce(value, '') <> ''
      order by value
      limit 100
    `),
    client.query(`
      select distinct coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') as value
      from products
      where coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') <> ''
      order by value
      limit 100
    `),
    client.query(`
      select
        count(distinct nullif(shopify_id, ''))::int as live_products,
        count(*) filter (where coalesce(shopify_variant_id, '') <> '')::int as live_variants
      from shopify_product_statuses
      where coalesce(shopify_id, '') <> ''
        and lower(coalesce(shopify_status, '')) = 'active'
        and coalesce(shopify_published, false) = true
        and lower(coalesce(sync_source, '')) in ('shopify-api-sku-map', 'graphql')
    `)
  ]);
  return {
    suppliers: suppliers.rows.map((row) => row.value),
    brands: brands.rows.map((row) => row.value),
    categories: categories.rows.map((row) => row.value),
    stockStatuses: [],
    shopifyStatuses: shopifyStatuses.rows.map((row) => row.value),
    ebayStatuses: ebayStatuses.rows.map((row) => row.value),
    shopifyLiveProducts: Number(shopifyLiveCounts.rows[0]?.live_products || 0),
    shopifyLiveVariants: Number(shopifyLiveCounts.rows[0]?.live_variants || 0)
  };
}

async function hydrateProductsWithShopifyStatuses(items = []) {
  const client = getPool();
  const skus = [...new Set((Array.isArray(items) ? items : []).map((item) => nullableString(item.sku)?.toLowerCase()).filter(Boolean))];
  if (!client || !skus.length) return items;
  const result = await client.query(`
    select sku, status_payload
    from shopify_product_statuses
    where lower(sku) = any($1)
  `, [skus]);
  const bySku = new Map(result.rows.map((row) => [String(row.sku || "").toLowerCase(), row.status_payload || {}]));
  return items.map((item) => {
    const status = bySku.get(String(item.sku || "").toLowerCase());
    return status ? { ...item, ...status } : item;
  });
}

async function listCategoryProductStats() {
  const client = getPool();
  if (!client) return [];
  await initRelationalSchema();
  const result = await client.query(`
    with saved_main_categories_raw as (
      select distinct
        coalesce(row ->> 'name', row ->> 'category', '') as category_name,
        lower(coalesce(row ->> 'name', row ->> 'category', '')) as category_key
      from state_documents doc,
        jsonb_array_elements(case when jsonb_typeof(doc.data) = 'array' then doc.data else '[]'::jsonb end) row
      where doc.doc_key = 'categorySettings'
        and coalesce(row ->> 'name', row ->> 'category', '') <> ''
      union
      select distinct
        coalesce(data ->> 'name', data ->> 'category', '') as category_name,
        lower(coalesce(data ->> 'name', data ->> 'category', '')) as category_key
      from entity_documents
      where collection = 'categorySettings'
        and coalesce(data ->> 'name', data ->> 'category', '') <> ''
    ),
    saved_main_categories as (
      select
        min(category_name) as category_name,
        category_key
      from saved_main_categories_raw
      where category_key <> ''
      group by category_key
    ),
    true_value_source_categories as (
      select
        coalesce(nullif(source_category, ''), nullif(category, ''), 'Uncategorized') as category_name,
        lower(coalesce(nullif(source_category, ''), nullif(category, ''), 'Uncategorized')) as category_key,
        count(*)::int as source_product_count
      from vendor_catalog_items
      where vendor_id = 'trv'
        and coalesce(nullif(source_category, ''), nullif(category, '')) is not null
      group by 1, 2
    ),
    product_categories as (
      select
        *,
        (
          lower(coalesce(supplier, raw ->> 'supplier', raw ->> 'vendor', '')) like '%true value%'
          or lower(coalesce(supplier_code, raw ->> 'supplierCode', raw ->> 'defaultSupplier', '')) = 'trv'
        ) as is_true_value_supplier,
        coalesce(nullif(source_category, ''), nullif(raw ->> 'vendorCategory', ''), nullif(raw -> 'productManagerFields' ->> 'category', '')) as vendor_category_name,
        coalesce(nullif(category, ''), nullif(main_category, '')) as verified_category_name
      from products
    ),
    true_value_categories as (
      select distinct lower(vendor_category_name) as category_key
      from product_categories
      where is_true_value_supplier = true
        and vendor_category_name is not null
      union
      select category_key
      from true_value_source_categories
      where category_key <> ''
      union
      select category_key
      from saved_main_categories
      where category_key <> ''
    ),
    categorized as (
      select
        case
          when is_true_value_supplier = true and vendor_category_name is not null
          then vendor_category_name
          when lower(coalesce(raw ->> 'categoryVerified', 'false')) in ('true', '1', 'yes', 'y')
            and verified_category_name is not null
            and lower(verified_category_name) in (select category_key from true_value_categories)
          then verified_category_name
          else 'Uncategorized'
        end as category_name,
        coalesce(active, true) as active,
        coalesce(qty, 0) as qty,
        lower(coalesce(raw ->> 'hazardous', 'false')) in ('true', '1', 'yes', 'y') as hazardous
      from product_categories
    ),
    product_category_stats as (
      select
        category_name as name,
        lower(category_name) as category_key,
        count(*)::int as "productCount",
        count(*) filter (where active = true)::int as "activeProductCount",
        count(*) filter (where qty > 0)::int as "stockProductCount",
        count(*) filter (where hazardous = true)::int as "hazardousProductCount"
      from categorized
      group by category_name
    ),
    canonical_categories as (
      select category_name as name, category_key, source_product_count as "sourceCatalogProductCount"
      from true_value_source_categories
      union
      select category_name as name, category_key, 0::int as "sourceCatalogProductCount"
      from saved_main_categories
      where category_key <> ''
    )
    select
      coalesce(stats.name, canonical.name) as name,
      coalesce(stats."productCount", 0)::int as "productCount",
      coalesce(stats."activeProductCount", 0)::int as "activeProductCount",
      coalesce(stats."stockProductCount", 0)::int as "stockProductCount",
      coalesce(stats."hazardousProductCount", 0)::int as "hazardousProductCount",
      coalesce(canonical."sourceCatalogProductCount", 0)::int as "sourceCatalogProductCount",
      case when canonical.category_key is not null then 'system:true-value-source' else '' end as "createdSource"
    from product_category_stats stats
    full join canonical_categories canonical on canonical.category_key = stats.category_key
    order by coalesce(stats."productCount", 0) desc, coalesce(canonical."sourceCatalogProductCount", 0) desc, coalesce(stats.name, canonical.name)
  `);
  return result.rows;
}

async function listUncategorizedProducts(options = {}) {
  const client = getPool();
  if (!client) return [];
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(50000, Number(options.limit || 25000)));
  const result = await client.query(`
    select
      sku,
      coalesce(marketplace_title, title, '') as title,
      supplier,
      coalesce(source_category, raw ->> 'vendorCategory', '') as "vendorCategory",
      coalesce(category, main_category, '') as category,
      coalesce(active, true) as active
    from products
    where not (
      lower(coalesce(raw ->> 'categoryVerified', 'false')) in ('true', '1', 'yes', 'y')
      and coalesce(nullif(category, ''), nullif(main_category, '')) is not null
    )
    order by sku
    limit $1
  `, [limit]);
  return result.rows.map((row) => ({
    sku: row.sku || "",
    title: row.title || "",
    supplier: row.supplier || "",
    vendor_category: row.vendorCategory || "",
    current_main_category: row.category || "",
    active: row.active !== false ? "true" : "false"
  }));
}

async function countProducts(options = {}) {
  const client = getPool();
  if (!client) return 0;
  await initRelationalSchema();
  const result = await listProducts({ ...options, page: 1, limit: 1 });
  return result?.total || 0;
}

async function countShopifyVariantStatuses(options = {}) {
  const client = getPool();
  if (!client) return 0;
  await initRelationalSchema();
  const params = [];
  const where = ["coalesce(shopify_variant_id, '') <> ''"];
  const skus = [...new Set((Array.isArray(options.skus) ? options.skus : [])
    .map((sku) => nullableString(sku)?.toLowerCase())
    .filter(Boolean))];
  if (skus.length) {
    params.push(skus);
    where.push(`lower(sku) = any($${params.length})`);
  }
  if (options.liveOnly) {
    where.push("coalesce(shopify_id, '') <> ''");
    where.push("lower(coalesce(shopify_status, '')) = 'active'");
    where.push("coalesce(shopify_published, false) = true");
    where.push("lower(coalesce(sync_source, '')) in ('shopify-api-sku-map', 'graphql')");
  }
  const result = await client.query(`
    select count(*)::int as total
    from shopify_product_statuses
    where ${where.join(" and ")}
  `, params);
  return Number(result.rows[0]?.total || 0) || 0;
}

function keyedObjectRows(map = {}) {
  return Object.entries(map || {})
    .map(([key, value]) => {
      const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const sku = String(payload.sku || key || "").trim();
      return sku ? { key: sku.toLowerCase(), sku, payload } : null;
    })
    .filter(Boolean);
}

async function readProductSourceEnrichmentMap() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const result = await client.query("select sku, source_payload from product_source_enrichments order by sku");
  return Object.fromEntries(result.rows.map((row) => [String(row.sku || "").toLowerCase(), row.source_payload || {}]));
}

async function upsertProductSourceEnrichmentMap(enrichmentMap = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const rows = keyedObjectRows(enrichmentMap);
  if (!rows.length) return true;
  await client.query("begin");
  try {
    for (const row of rows) {
      const payload = row.payload || {};
      await client.query(`
        insert into product_source_enrichments (
          sku, product_id, supplier, vendor_sku, source_sku, source_payload, enriched_at, updated_at
        )
        values (
          $1,
          (select product_id from products where lower(sku) = lower($1) limit 1),
          $2, $3, $4, $5::jsonb, now(), now()
        )
        on conflict (sku) do update set
          product_id = coalesce(excluded.product_id, product_source_enrichments.product_id),
          supplier = excluded.supplier,
          vendor_sku = excluded.vendor_sku,
          source_sku = excluded.source_sku,
          source_payload = excluded.source_payload,
          updated_at = now()
      `, [
        row.sku,
        payload.supplier || payload.vendor || "",
        payload.vendorSku || payload.vendor_sku || "",
        payload.sources?.catalog || payload.sku || row.sku,
        JSON.stringify(payload)
      ]);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function readShopifyStatusMap() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const result = await client.query("select sku, status_payload from shopify_product_statuses order by lower(sku), updated_at asc");
  const map = {};
  for (const row of result.rows) {
    const key = String(row.sku || "").trim().toLowerCase();
    if (key) map[key] = row.status_payload || {};
  }
  return map;
}

async function upsertShopifyStatusMap(statusMap = {}) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  const rows = keyedObjectRows(statusMap);
  if (!rows.length) return true;
  await client.query("begin");
  try {
    for (const row of rows) {
      const payload = row.payload || {};
      const skuKey = row.key || String(row.sku || "").trim().toLowerCase();
      await client.query("delete from shopify_product_statuses where lower(sku) = $1 and sku <> $1", [skuKey]);
      await client.query(`
        insert into shopify_product_statuses (
          sku, product_id, shopify_id, shopify_variant_id, shopify_handle, shopify_status,
          shopify_published, shopify_synced_at, sync_source, status_payload, updated_at
        )
        values (
          $1,
          (select product_id from products where lower(sku) = lower($1) limit 1),
          $2, $3, $4, $5, $6,
          case when $7 = '' then null else $7::timestamptz end,
          $8, $9::jsonb, now()
        )
        on conflict (sku) do update set
          product_id = coalesce(excluded.product_id, shopify_product_statuses.product_id),
          shopify_id = excluded.shopify_id,
          shopify_variant_id = excluded.shopify_variant_id,
          shopify_handle = excluded.shopify_handle,
          shopify_status = excluded.shopify_status,
          shopify_published = excluded.shopify_published,
          shopify_synced_at = excluded.shopify_synced_at,
          sync_source = excluded.sync_source,
          status_payload = excluded.status_payload,
          updated_at = now()
      `, [
        skuKey,
        payload.shopifyId || "",
        payload.shopifyVariantId || "",
        payload.shopifyHandle || "",
        payload.shopifyStatus || "",
        payload.shopifyPublished === undefined ? null : Boolean(payload.shopifyPublished),
        payload.shopifySyncedAt || "",
        payload.shopifySyncSource || payload.syncSource || "",
        JSON.stringify(payload)
      ]);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function replaceProductQualityRows(rows = []) {
  const client = getPool();
  if (!client) return false;
  await initRelationalSchema();
  await client.query("begin");
  try {
    await client.query("truncate table product_quality_rows");
    for (const row of rows || []) {
      const sku = nullableString(row.sku);
      if (!sku) continue;
      await client.query(`
        insert into product_quality_rows (
          sku, product_score, shopify_score, ebay_score, issue_count, issue_types,
          shopify_ready, shopify_live, to_be_discontinued, quality_payload, scanned_at
        )
        values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10::jsonb, now())
      `, [
        sku,
        row.productScore ?? null,
        row.shopifyScore ?? null,
        row.ebayScore ?? null,
        Array.isArray(row.issues) ? row.issues.length : 0,
        Array.isArray(row.issueTypes) ? row.issueTypes.map(String) : [],
        Boolean(row.shopifyReady),
        Boolean(row.shopifyLive),
        Boolean(row.toBeDiscontinued),
        JSON.stringify(row)
      ]);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function listCategoryProductSamples({ scope = "main", category = "", limit = 5 } = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const normalizedScope = nullableString(scope).toLowerCase() === "source" ? "source" : "main";
  const categoryName = nullableString(category);
  const sampleLimit = Math.max(1, Math.min(25, Number(limit || 5)));
  if (!categoryName) return { scope: normalizedScope, category: "", items: [], total: 0, limit: sampleLimit };

  if (normalizedScope === "source") {
    const lowerCategory = categoryName.toLowerCase();
    const params = [lowerCategory, sampleLimit];
    let rows = await client.query(`
      select source_sku, title, brand, vendor_id, qty, price
      from vendor_catalog_items
      where lower(coalesce(category, '')) = $1
      order by source_sku
      limit $2
    `, params);
    if (!rows.rows.length) {
      rows = await client.query(`
        select source_sku, title, brand, vendor_id, qty, price
        from vendor_catalog_items
        where lower(coalesce(source_category, '')) = $1
        order by source_sku
        limit $2
      `, params);
    }
    const total = await client.query(`
      select coalesce((data ->> 'productCount')::int, 0) as total
      from category_summary_index
      where scope = 'source'
        and lower(coalesce(data ->> 'name', '')) = $1
      limit 1
    `, [lowerCategory]).catch(() => ({ rows: [] }));
    return {
      scope: normalizedScope,
      category: categoryName,
      items: rows.rows.map((row) => ({
        sku: row.source_sku || "",
        title: row.title || "",
        brand: row.brand || "",
        supplier: row.vendor_id || "",
        qty: row.qty,
        price: row.price
      })),
      total: total.rows[0]?.total || rows.rows.length,
      limit: sampleLimit
    };
  }

  const params = [categoryName.toLowerCase(), sampleLimit];
  const [rows, total] = await Promise.all([
    client.query(`
      select sku, title, brand, supplier, qty, price
      from products
      where lower(coalesce(category, main_category, '')) = $1
      order by sku
      limit $2
    `, params),
    client.query(`
      select count(*)::int as total
      from products
      where lower(coalesce(category, main_category, '')) = $1
    `, [params[0]])
  ]);
  return {
    scope: normalizedScope,
    category: categoryName,
    items: rows.rows.map((row) => ({
      sku: row.sku || "",
      title: row.title || "",
      brand: row.brand || "",
      supplier: row.supplier || "",
      qty: row.qty,
      price: row.price
    })),
    total: total.rows[0]?.total || 0,
    limit: sampleLimit
  };
}

async function readProductQualityRows(options = {}) {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const limit = Math.max(1, Math.min(100000, Number(options.limit || 100000)));
  const page = Math.max(1, Number(options.page || 1));
  const offset = Math.max(0, Number(options.offset ?? ((page - 1) * limit)) || 0);
  const q = nullableString(options.q);
  const issue = nullableString(options.issue);
  const type = nullableString(options.type);
  const channel = nullableString(options.channel);
  const status = nullableString(options.status);
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(sku) like $${params.length}
      or lower(coalesce(quality_payload ->> 'title', '')) like $${params.length}
      or lower(coalesce(quality_payload ->> 'brand', '')) like $${params.length}
      or lower(coalesce(quality_payload ->> 'vendor', '')) like $${params.length}
      or lower(coalesce(quality_payload ->> 'category', '')) like $${params.length}
    )`);
  }
  if (issue) {
    params.push(issue.toLowerCase());
    where.push(`exists (
      select 1 from jsonb_array_elements_text(coalesce(quality_payload -> 'issueKeys', '[]'::jsonb)) value
      where lower(value) = $${params.length}
    )`);
  }
  if (type) {
    params.push(type.toLowerCase());
    where.push(`exists (
      select 1 from unnest(issue_types) value
      where lower(value) = $${params.length}
    )`);
  }
  if (channel === "shopify") where.push(`jsonb_array_length(coalesce(quality_payload -> 'issues', '[]'::jsonb)) > 0 and exists (select 1 from jsonb_array_elements_text(coalesce(quality_payload -> 'issueTypes', '[]'::jsonb)) value where value = 'shopify')`);
  if (channel === "ebay") where.push(`jsonb_array_length(coalesce(quality_payload -> 'issues', '[]'::jsonb)) > 0 and exists (select 1 from jsonb_array_elements_text(coalesce(quality_payload -> 'issueTypes', '[]'::jsonb)) value where value = 'ebay')`);
  if (status === "ready") where.push(`coalesce((quality_payload ->> 'ready')::boolean, false) = true`);
  if (status === "needs-work") where.push(`coalesce((quality_payload ->> 'ready')::boolean, false) = false`);
  if (status === "shopify-ready") where.push(`shopify_ready = true`);
  if (status === "shopify-live") where.push(`shopify_live = true`);
  if (status === "closeout") where.push(`to_be_discontinued = true`);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const skipCount = options.skipCount === true;
  const countResult = skipCount ? null : await client.query(`
    select count(*)::int as total
    from product_quality_rows
    ${whereSql}
  `, params);
  params.push(limit, offset);
  const result = await client.query(`
    select quality_payload
    from product_quality_rows
    ${whereSql}
    order by issue_count desc, sku
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return {
    rows: result.rows.map((row) => row.quality_payload || {}),
    total: skipCount ? null : countResult.rows[0]?.total || 0,
    page,
    limit,
    offset
  };
}

async function readProductQualitySummary() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const [summaryResult, issueResult, typeResult, sampleResult, savedSummary] = await Promise.all([
    client.query(`
      select
        max(scanned_at) as generated_at,
        count(*)::int as total,
        count(*) filter (where coalesce((quality_payload ->> 'ready')::boolean, false) = true)::int as product_ready,
        count(*) filter (where coalesce((quality_payload ->> 'ready')::boolean, false) = false)::int as needs_work,
        count(*) filter (where shopify_ready = true)::int as shopify_ready,
        count(*) filter (where shopify_live = true)::int as shopify_live,
        count(*) filter (where coalesce((quality_payload ->> 'ebayReady')::boolean, false) = true)::int as ebay_ready,
        count(*) filter (where coalesce((quality_payload ->> 'ebayLive')::boolean, false) = true)::int as ebay_live,
        count(*) filter (
          where coalesce(nullif(quality_payload ->> 'staleDays', ''), '0') ~ '^[0-9]+$'
            and (quality_payload ->> 'staleDays')::int > 7
        )::int as stale_shopify,
        count(*) filter (where to_be_discontinued = true)::int as closeouts
      from product_quality_rows
    `),
    client.query(`
      select issue, count(*)::int as count
      from product_quality_rows,
        lateral jsonb_array_elements_text(coalesce(quality_payload -> 'issues', '[]'::jsonb)) issue
      group by issue
      order by count(*) desc, issue
    `),
    client.query(`
      select issue_type, count(*)::int as count
      from product_quality_rows,
        lateral unnest(issue_types) issue_type
      group by issue_type
      order by issue_type
    `),
    client.query(`
      select quality_payload
      from product_quality_rows
      order by issue_count desc, sku
      limit 25
    `),
    client.query("select data from state_documents where doc_key = 'dataQualitySummary' limit 1")
  ]);
  const row = summaryResult.rows[0] || {};
  if (!Number(row.total || 0)) return null;
  const saved = savedSummary.rows[0]?.data || {};
  const issueCounts = Object.fromEntries(issueResult.rows.map((item) => [item.issue, item.count]));
  const typeCounts = Object.fromEntries(typeResult.rows.map((item) => [item.issue_type, item.count]));
  return {
    summary: {
      ...saved,
      generatedAt: row.generated_at?.toISOString?.() || saved.generatedAt || "",
      total: Number(row.total || 0),
      productReady: Number(row.product_ready || 0),
      needsWork: Number(row.needs_work || 0),
      shopifyReady: Number(row.shopify_ready || 0),
      shopifyLive: Number(row.shopify_live || 0),
      ebayReady: Number(row.ebay_ready || 0),
      ebayLive: Number(row.ebay_live || 0),
      staleShopify: Number(row.stale_shopify || 0),
      closeouts: Number(row.closeouts || 0),
      issueCounts,
      typeCounts,
      storage: "postgres"
    },
    sample: sampleResult.rows.map((item) => item.quality_payload || {})
  };
}

async function readOperationalSummary() {
  const client = getPool();
  if (!client) return null;
  await initRelationalSchema();
  const result = await client.query(`
    with product_summary as (
      select
        count(*)::int as inventory_count,
        coalesce(sum(
          case
            when coalesce(qty, 0) - (
              case when coalesce(raw ->> 'reserved', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                then (raw ->> 'reserved')::numeric
                else 0
              end
            ) <= (
              case when coalesce(raw ->> 'reorderPoint', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                then (raw ->> 'reorderPoint')::numeric
                else 0
              end
            )
            then 1
            else 0
          end
        ), 0)::int as low_stock,
        coalesce(sum(
          case when coalesce(raw ->> 'reserved', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            then (raw ->> 'reserved')::numeric
            else 0
          end
        ), 0) as reserved
      from products
    ),
    order_summary as (
      select
        count(*) filter (
          where reportable = true
            and lower(coalesce(status, '')) not in ('confirmed', 'complete', 'completed', 'done', 'shipped', 'delivered')
        )::int as open_orders,
        coalesce(sum(total) filter (where reportable = true), 0) as sales,
        coalesce(sum(
          coalesce(total, 0)
          - coalesce(product_cost, 0)
          - coalesce(marketplace_fees, 0)
          - coalesce(shipping_cost, 0)
          - coalesce(refund_amount, 0)
        ) filter (where reportable = true), 0) as profit
      from order_records
    ),
    customer_summary as (
      select
        count(*)::int as customer_count,
        count(*) filter (
          where lower(coalesce(data ->> 'repeatCustomer', 'false')) in ('true', '1', 'yes', 'y')
        )::int as repeat_customers
      from entity_documents
      where collection = 'customers'
    ),
    po_summary as (
      select
        count(*)::int as purchase_order_count,
        count(*) filter (
          where reportable = true
            and lower(coalesce(status, '')) in ('draft', 'submitted', 'partially_received')
        )::int as open_purchase_orders
      from purchase_order_records
    )
    select
      product_summary.inventory_count as "inventoryCount",
      order_summary.open_orders as "openOrders",
      product_summary.low_stock as "lowStock",
      product_summary.reserved,
      order_summary.sales,
      order_summary.profit,
      customer_summary.customer_count as "customerCount",
      customer_summary.repeat_customers as "repeatCustomers",
      po_summary.purchase_order_count as "purchaseOrderCount",
      po_summary.open_purchase_orders as "openPurchaseOrders"
    from product_summary, order_summary, customer_summary, po_summary
  `);
  const row = result.rows[0] || {};
  return {
    inventoryCount: Number(row.inventoryCount || 0),
    openOrders: Number(row.openOrders || 0),
    lowStock: Number(row.lowStock || 0),
    reserved: Number(row.reserved || 0),
    sales: Number(row.sales || 0),
    profit: Number(row.profit || 0),
    customerCount: Number(row.customerCount || 0),
    repeatCustomers: Number(row.repeatCustomers || 0),
    purchaseOrderCount: Number(row.purchaseOrderCount || 0),
    openPurchaseOrders: Number(row.openPurchaseOrders || 0)
  };
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
  relationalSchemaReady = false;
}

module.exports = {
  closePool,
  databaseHealth,
  getDatabaseUrl,
  initDatabase,
  initRelationalSchema,
  cleanupLegacyMigratedVendorOffers,
  deleteProductsByIds,
  createVendorFeedRun,
  finishVendorFeedRun,
  buildSourceCatalogPerformanceIndexes,
  buildSourceCatalogSearchIndex,
  collectVendorCatalogItems,
  exportProductChangeEventsCsv,
  listProductChangeEvents,
  readCategoryState,
  readVendorCatalogItemsBySkus,
  sourceCatalogSearchIndexStatus,
  readOperationJobs,
  deleteOperationArtifactsForJob,
  readStateDocuments,
  claimQueuedOperationJob,
  createPostgresBackup,
  readChannelApiLogs,
  pruneChannelApiLogs,
  readOperationalSummary,
  listOrders,
  listPurchaseOrders,
  readOrderByKey,
  readProductByKey,
  readProductByShopifyGid,
  readProductQualitySummary,
  readProductQualityRows,
  readProductSourceEnrichmentMap,
  readProductsByKeys,
  readPurchaseOrderByKey,
  readShopifyStatusMap,
  countShopifyVariantStatuses,
  readRelationalState,
  readAllProducts,
  listShopifyLinkedProducts,
  countProducts,
  listCategoryProductSamples,
  readCategorySummaryIndex,
  replaceCategorySummaryIndex,
  listCategoryProductStats,
  listUncategorizedProducts,
  listProducts,
  productFacets,
  listVendorCatalogItems,
  listVendorCategoryMappingSources,
  applyVendorCategoryMainMapping,
  vendorCatalogFacets,
  refreshVendorCatalogFacets,
  isPostgresEnabled,
  readState,
  readStateField,
  readUserTablePreferences,
  upsertCategoryChannelMappingsFromState,
  upsertUserTablePreference,
  upsertProductSourceEnrichmentMap,
  upsertOperationArtifact,
  upsertOperationJob,
  insertChannelApiLog,
  upsertInventoryLevelsFromProducts,
  upsertProductAliasesFromState,
  upsertProductsFromState,
  upsertShopifyStatusMap,
  replaceProductQualityRows,
  saveOrder,
  savePurchaseOrder,
  upsertVendorCatalogItemsFromProducts,
  upsertOrdersFromState,
  upsertPurchaseOrdersFromState,
  writeRelationalState,
  writeStateDocuments,
  writeLegacyState,
  writeStateField,
  writeState
};
