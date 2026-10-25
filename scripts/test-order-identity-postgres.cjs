const test = require("node:test");
const assert = require("node:assert/strict");
const postgres = require("../db");

const connectionString = process.env.ORDER_IDENTITY_TEST_DATABASE_URL;

test("company-channel order identities are enforced transactionally", { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_order_identity_test"),
    "Use an isolated local order identity test database only."
  );
  process.env.DATABASE_URL = connectionString;
  try {
    await postgres.initDatabase();
    const common = { source: "eBay", marketplaceOrderId: "123", status: "paid", total: 10 };
    await postgres.upsertOrdersFromState([{
      ...common,
      id: "linq-order",
      tenantId: "organization-default",
      workspaceCompanyId: "linq-usa",
      companyNumber: 100
    }]);
    await postgres.upsertOrdersFromState([{
      ...common,
      id: "second-company-order",
      tenantId: "organization-default",
      workspaceCompanyId: "second-company",
      companyNumber: 205
    }]);
    await postgres.upsertOrdersFromState([{
      ...common,
      id: "linq-walmart-order",
      source: "Walmart",
      tenantId: "organization-default",
      workspaceCompanyId: "linq-usa",
      companyNumber: 100
    }]);
    await assert.rejects(
      postgres.upsertOrdersFromState([{
        ...common,
        id: "linq-collision",
        tenantId: "organization-default",
        workspaceCompanyId: "linq-usa",
        companyNumber: 100
      }]),
      (error) => error.code === "CHANNEL_ORDER_IDENTITY_CONFLICT"
    );
    await postgres.getPool().query(`
      insert into order_records (
        order_id, tenant_id, company_id, company_number, channel_key, channel_number,
        channel_order_id, channel_order_identity, marketplace_order_id, source, status, raw
      ) values (
        'historical-duplicate', 'organization-default', 'linq-usa', 100, 'ebay', 1,
        '123', '100+ebay+123', '123', 'eBay', 'paid',
        '{"id":"historical-duplicate","source":"eBay","marketplaceOrderId":"123"}'::jsonb
      )
    `);
    await postgres.upsertOrdersFromState([{
      ...common,
      id: "historical-duplicate",
      tenantId: "organization-default",
      workspaceCompanyId: "linq-usa",
      companyNumber: 100,
      buyer: "Legacy duplicate remains updateable"
    }]);
    const claims = await postgres.getPool().query("select identity_key, order_id from order_channel_identities order by identity_key");
    assert.deepEqual(claims.rows, [
      { identity_key: "100+ebay+123", order_id: "linq-order" },
      { identity_key: "100+walmart+123", order_id: "linq-walmart-order" },
      { identity_key: "205+ebay+123", order_id: "second-company-order" }
    ]);
  } finally {
    await postgres.closePool();
  }
});
