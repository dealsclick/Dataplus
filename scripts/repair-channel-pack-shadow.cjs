const crypto = require('node:crypto');
const postgres = require('../db');
const { normalizeShadowSku, productEachUnitCost } = require('../server');

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : fallback;
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function orderLines(order = {}) {
  return Array.isArray(order.items) ? order.items : [];
}

function aliasValue(alias = {}) {
  return String(alias.aliasSku || alias.sku || '').trim();
}

function shadowAliasValues(product = {}, shadow = {}, marketplace = '', unitsPerPack = 1) {
  const shadowId = String(shadow.id || '').trim();
  const channel = normalized(marketplace);
  const packQty = Math.max(1, Math.floor(Number(unitsPerPack || 1)));
  return [...new Set((Array.isArray(product.aliases) ? product.aliases : [])
    .filter((alias) => alias.active !== false)
    .filter((alias) => {
      const linkedShadowId = String(alias.shadowId || '').trim();
      if (shadowId && linkedShadowId) return linkedShadowId === shadowId;
      return normalized(alias.type) === 'shadow'
        && (!channel || normalized(alias.marketplace || alias.source) === channel)
        && Math.max(1, Math.floor(Number(alias.unitsPerPack || alias.inventoryMultiplier || alias.uomQty || 1))) === packQty;
    })
    .map(aliasValue)
    .filter(Boolean))];
}

function shadowIdentityValues(product = {}, shadow = {}, input = {}) {
  return [...new Set([
    input.parentSku, input.shadowSku, input.merchantSku, input.marketplaceSku, input.channelSku,
    shadow.shadowSku, shadow.merchantSku, shadow.marketplaceSku, shadow.channelSku,
    ...shadowAliasValues(product, shadow, input.marketplace, input.unitsPerPack)
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function matchingLineIndexes(order, values) {
  const wanted = new Set(values.map(normalized).filter(Boolean));
  const matches = [];
  orderLines(order).forEach((line, index) => {
    const lineValues = [
      line.sku, line.originalSku, line.sourceSku, line.shadowSku, line.merchantSku,
      line.marketplaceSku, line.channelSku, line.externalSku, line.mappedSku, line.parentSku
    ].map(normalized).filter(Boolean);
    if (lineValues.some((value) => wanted.has(value))) matches.push(index);
  });
  return matches;
}

function matchingParentShadowLineIndexes(order, values) {
  const wanted = new Set(values.map(normalized).filter(Boolean));
  const matches = [];
  orderLines(order).forEach((line, index) => {
    const lineValues = [line.sku, line.parentSku, line.shadowSku, line.merchantSku]
      .map(normalized)
      .filter(Boolean);
    if (lineValues.some((value) => wanted.has(value))) matches.push(index);
  });
  return matches;
}

function numbersDiffer(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) > 0.00001;
}

function lineNeedsShadowRepair(line, product, shadow, packCost) {
  const channelSku = shadow.channelSku || line.channelSku || line.originalSku || '';
  return normalized(line.sku) !== normalized(product.sku)
    || normalized(line.parentSku) !== normalized(product.sku)
    || normalized(line.shadowSku) !== normalized(shadow.shadowSku)
    || String(line.shadowId || '') !== String(shadow.id)
    || normalized(line.merchantSku) !== normalized(shadow.merchantSku)
    || normalized(line.marketplaceSku) !== normalized(shadow.marketplaceSku)
    || normalized(line.channelSku) !== normalized(channelSku)
    || Number(line.inventoryMultiplier || 0) !== Number(shadow.unitsPerPack)
    || Number(line.unitsPerPack || 0) !== Number(shadow.unitsPerPack)
    || numbersDiffer(line.unitCost ?? line.cost, packCost)
    || numbersDiffer(line.cost, packCost)
    || line.costSource !== 'shadow_parent_piece_cost'
    || line.costStatus !== 'estimated'
    || normalized(line.costProductSku) !== normalized(product.sku);
}

function applyShadowToLine(line, product, shadow, packCost, now) {
  line.sku = product.sku;
  line.parentSku = product.sku;
  line.shadowSku = shadow.shadowSku;
  line.shadowId = shadow.id;
  line.merchantSku = shadow.merchantSku;
  line.marketplaceSku = shadow.marketplaceSku;
  line.channelSku = shadow.channelSku || line.channelSku || line.originalSku || '';
  line.inventoryMultiplier = shadow.unitsPerPack;
  line.unitsPerPack = shadow.unitsPerPack;
  line.unitCost = packCost;
  line.cost = packCost;
  line.costSource = 'shadow_parent_piece_cost';
  line.costStatus = 'estimated';
  line.costEstimatedAt = now;
  line.costProductSku = product.sku;
}

function upsertShadowAlias(product, aliasSku, shadow, marketplace, now) {
  const value = String(aliasSku || '').trim();
  if (!value || normalized(value) === normalized(product.sku)) return;
  product.aliases = Array.isArray(product.aliases) ? product.aliases : [];
  const existing = product.aliases.find((alias) => normalized(aliasValue(alias)) === normalized(value));
  const next = {
    id: existing?.id || crypto.randomUUID(),
    aliasSku: value,
    parentSku: product.sku,
    source: marketplace,
    marketplace,
    type: 'shadow',
    active: true,
    shadowId: shadow.id,
    uomQty: shadow.unitsPerPack,
    unitsPerPack: shadow.unitsPerPack,
    inventoryMultiplier: shadow.unitsPerPack,
    notes: shadow.notes,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (existing) Object.assign(existing, next);
  else product.aliases.push(next);
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const input = {
    parentSku: option('parent'),
    shadowSku: option('shadow'),
    merchantSku: option('merchant'),
    marketplaceSku: option('marketplace-sku'),
    channelSku: option('channel-sku'),
    marketplace: option('marketplace', 'Temu'),
    unitsPerPack: Number(option('units', '1')),
    orderKey: option('order'),
    from: option('from'),
    note: option('note', 'Marketplace multipack shares the parent piece inventory and inherited piece cost.'),
    user: option('user', 'Channel pack shadow repair')
  };
  if (!input.parentSku || !input.shadowSku || !input.marketplaceSku) {
    throw new Error('--parent, --shadow, and --marketplace-sku are required.');
  }
  if (!Number.isInteger(input.unitsPerPack) || input.unitsPerPack < 1) {
    throw new Error('--units must be a whole number of at least 1.');
  }
  if (input.from && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) {
    throw new Error('--from must use YYYY-MM-DD format.');
  }
  input.merchantSku = input.merchantSku || input.shadowSku;
  const allOrders = process.argv.includes('--all-orders');
  if (allOrders && input.orderKey) throw new Error('--all-orders and --order cannot be used together.');
  const apply = process.argv.includes('--apply');
  const now = new Date().toISOString();
  const product = await postgres.readProductByKey(input.parentSku);
  if (!product || normalized(product.sku) !== normalized(input.parentSku)) {
    throw new Error(`Parent SKU ${input.parentSku} was not found as a primary product.`);
  }
  const requestedOrder = input.orderKey ? await postgres.readOrderByKey(input.orderKey) : null;
  if (input.orderKey && !requestedOrder) throw new Error(`Order ${input.orderKey} was not found.`);
  const existingShadow = (product.shadowSkus || []).find((shadow) => [
    shadow.shadowSku, shadow.merchantSku, shadow.marketplaceSku, shadow.channelSku
  ].some((value) => [input.shadowSku, input.merchantSku, input.marketplaceSku, input.channelSku]
    .some((candidate) => candidate && normalized(value) === normalized(candidate))));
  let orders = requestedOrder ? [requestedOrder] : [];
  if (allOrders) {
    const exactIdentifiers = shadowIdentityValues(product, existingShadow || {}, input).map(normalized);
    const matches = await postgres.getPool().query(`
      select distinct o.order_id, o.order_number, coalesce(o.order_date, o.created_at) as sort_at
      from order_records o
      join order_line_items line on line.order_id = o.order_id
      where lower(concat_ws(' ', o.source, o.channel_source, o.raw->>'source', o.raw->>'channel', o.raw->>'channelSource')) like $1
        and ($3::date is null or coalesce(o.order_date, o.created_at) >= $3::date)
        and (
          lower(coalesce(line.sku, '')) = any($2::text[])
          or lower(coalesce(line.mapped_sku, '')) = any($2::text[])
          or lower(coalesce(line.raw->>'parentSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'shadowSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'merchantSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'marketplaceSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'channelSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'originalSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'sourceSku', '')) = any($2::text[])
          or lower(coalesce(line.raw->>'externalSku', '')) = any($2::text[])
        )
      order by sort_at, o.order_number, o.order_id
    `, [`%${normalized(input.marketplace)}%`, exactIdentifiers, input.from || null]);
    const orderIds = matches.rows.map((row) => row.order_id);
    const loaded = await postgres.readOrdersByIds(orderIds);
    const orderRank = new Map(orderIds.map((id, index) => [id, index]));
    orders = loaded.sort((left, right) => (orderRank.get(left.id) ?? 0) - (orderRank.get(right.id) ?? 0));
  }
  const exactLineValues = shadowIdentityValues(product, existingShadow || {}, input);
  const broadLineValues = [
    ...exactLineValues, input.marketplaceSku, input.channelSku,
    existingShadow?.marketplaceSku, existingShadow?.channelSku
  ];
  const lineIndexesByOrderId = new Map(orders.map((order) => [
    order.id,
    allOrders
      ? matchingLineIndexes(order, exactLineValues)
      : matchingLineIndexes(order, broadLineValues)
  ]));
  if (requestedOrder && !(lineIndexesByOrderId.get(requestedOrder.id) || []).length) {
    throw new Error(`Order ${input.orderKey} has no line for ${input.parentSku}.`);
  }
  const lineIdentifiers = orders.flatMap((order) => (lineIndexesByOrderId.get(order.id) || []).flatMap((index) => {
    const line = orderLines(order)[index];
    return [line.originalSku, line.sourceSku, line.marketplaceSku, line.channelSku, line.externalSku].filter(Boolean);
  }));
  const channelSku = input.channelSku || lineIdentifiers[0] || existingShadow?.channelSku || '';
  const shadow = normalizeShadowSku({
    ...(existingShadow || {}),
    id: existingShadow?.id || crypto.randomUUID(),
    parentSku: product.sku,
    shadowSku: input.shadowSku,
    merchantSku: input.merchantSku,
    marketplaceSku: input.marketplaceSku,
    channelSku,
    marketplace: input.marketplace,
    unitsPerPack: input.unitsPerPack,
    inventoryMultiplier: input.unitsPerPack,
    inventoryPolicy: 'Share parent inventory',
    persistence: { inventory: 'parent', cost: 'parent-piece', content: 'parent' },
    status: 'Active',
    notes: input.note,
    updatedAt: now
  }, product);
  const eachCost = Number(productEachUnitCost(product, null) || 0);
  const packCost = Math.round(eachCost * input.unitsPerPack * 10000) / 10000;
  const preview = {
    apply,
    product: product.sku,
    shadow: {
      id: shadow.id,
      shadowSku: shadow.shadowSku,
      merchantSku: shadow.merchantSku,
      marketplaceSku: shadow.marketplaceSku,
      channelSku: shadow.channelSku,
      marketplace: shadow.marketplace,
      unitsPerPack: shadow.unitsPerPack,
      persistence: shadow.persistence,
      parentEachCost: eachCost,
      packCost
    },
    order: requestedOrder ? {
      id: requestedOrder.id,
      orderNumber: requestedOrder.orderNumber,
      lineIndexes: lineIndexesByOrderId.get(requestedOrder.id) || []
    } : null,
    orders: allOrders ? {
      mode: 'all',
      from: input.from || null,
      identifiers: exactLineValues,
      count: orders.length,
      lineCount: [...lineIndexesByOrderId.values()].reduce((sum, indexes) => sum + indexes.length, 0),
      firstOrderNumber: orders[0]?.orderNumber || '',
      lastOrderNumber: orders[orders.length - 1]?.orderNumber || ''
    } : null,
    retainedIdentifiers: [...new Set([existingShadow?.marketplaceSku, existingShadow?.channelSku, ...lineIdentifiers].filter(Boolean))]
  };
  const matchingLines = orders.flatMap((order) => (lineIndexesByOrderId.get(order.id) || []).map((index) => orderLines(order)[index]));
  preview.costs = {
    correctBefore: matchingLines.filter((line) => !numbersDiffer(line.unitCost ?? line.cost, packCost)).length,
    needUpdate: matchingLines.filter((line) => numbersDiffer(line.unitCost ?? line.cost, packCost)).length
  };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  product.shadowSkus = (Array.isArray(product.shadowSkus) ? product.shadowSkus : [])
    .filter((entry) => String(entry.id || '') !== String(shadow.id));
  product.shadowSkus.push(shadow);
  product.inventoryTrackingMode = 'piece';
  product.inventoryBaseUnit = 'each';
  product.updatedAt = now;
  for (const aliasSku of [shadow.shadowSku, shadow.merchantSku, shadow.channelSku, ...preview.retainedIdentifiers]) {
    upsertShadowAlias(product, aliasSku, shadow, input.marketplace, now);
  }
  await postgres.upsertProductsFromState([product]);

  const changedOrders = [];
  let costsUpdated = 0;
  for (const order of orders) {
    const lineIndexes = lineIndexesByOrderId.get(order.id) || [];
    let changed = false;
    for (const index of lineIndexes) {
      const line = orderLines(order)[index];
      if (numbersDiffer(line.unitCost ?? line.cost, packCost)) costsUpdated += 1;
      if (lineNeedsShadowRepair(line, product, shadow, packCost)) changed = true;
      applyShadowToLine(line, product, shadow, packCost, now);
    }
    for (const route of Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []) {
      if (!lineIndexes.includes(Number(route.lineIndex))) continue;
      const inventoryQty = Number(route.qty || 0) * shadow.unitsPerPack;
      if (normalized(route.sku) !== normalized(product.sku)
        || Number(route.inventoryMultiplier || 0) !== Number(shadow.unitsPerPack)
        || numbersDiffer(route.inventoryQty, inventoryQty)) changed = true;
      route.sku = product.sku;
      route.inventoryMultiplier = shadow.unitsPerPack;
      route.inventoryQty = inventoryQty;
    }
    const productCost = orderLines(order).reduce((sum, line) => (
      sum + Math.max(0, Number(line.qty ?? line.quantity ?? 0)) * Math.max(0, Number(line.unitCost ?? line.cost ?? 0))
    ), 0);
    if (numbersDiffer(order.productCost, productCost) || order.productCostStatus !== 'estimated') changed = true;
    if (!changed) continue;
    order.productCost = productCost;
    order.productCostStatus = 'estimated';
    order.productCostEstimatedAt = now;
    order.updatedAt = now;
    order.timeline = Array.isArray(order.timeline) ? order.timeline : [];
    order.timeline.unshift({
      id: crypto.randomUUID(),
      type: 'sku',
      title: 'Channel pack shadow corrected',
      message: `${shadow.merchantSku} now maps ${input.marketplace} SKU ${shadow.marketplaceSku} to ${shadow.unitsPerPack} pieces of ${product.sku}.`,
      user: input.user,
      createdAt: now
    });
    changedOrders.push(order);
  }
  if (changedOrders.length) await postgres.upsertOrdersFromState(changedOrders, { batchSize: 250 });

  const verifiedProduct = await postgres.readProductByKey(input.parentSku);
  const verifiedOrder = requestedOrder ? await postgres.readOrderByKey(requestedOrder.id) : null;
  let bulkVerification = null;
  if (allOrders && orders.length) {
    const orderIds = orders.map((order) => order.id);
    const verification = await postgres.getPool().query(`
      select count(*)::int as line_count,
        count(*) filter (where abs(coalesce(line.cost, 0) - $2::numeric) > 0.00001)::int as incorrect_cost_count,
        count(*) filter (where lower(coalesce(line.raw->>'merchantSku', '')) = lower($3))::int as merchant_sku_count,
        count(*) filter (where lower(coalesce(line.raw->>'marketplaceSku', '')) = lower($4))::int as marketplace_sku_count
      from order_line_items line
      where line.order_id = any($1::text[])
        and (
          lower(coalesce(line.sku, '')) = lower($5)
          or lower(coalesce(line.mapped_sku, '')) = lower($5)
          or lower(coalesce(line.raw->>'parentSku', '')) = lower($5)
          or lower(coalesce(line.raw->>'shadowSku', '')) = lower($6)
          or lower(coalesce(line.raw->>'merchantSku', '')) = lower($3)
        )
    `, [orderIds, packCost, shadow.merchantSku, shadow.marketplaceSku, product.sku, shadow.shadowSku]);
    bulkVerification = verification.rows[0] || null;
  }
  console.log(JSON.stringify({
    ...preview,
    applied: true,
    ordersUpdated: changedOrders.length,
    costsUpdated,
    bulkVerification,
    verifiedShadow: (verifiedProduct?.shadowSkus || []).find((entry) => String(entry.id) === String(shadow.id)) || null,
    verifiedOrderLines: verifiedOrder
      ? (lineIndexesByOrderId.get(verifiedOrder.id) || []).map((index) => orderLines(verifiedOrder)[index])
      : []
  }, null, 2));
}

if (require.main === module) {
  main()
    .then(() => postgres.closePool())
    .catch(async (error) => {
      console.error(error.stack || error.message || error);
      await postgres.closePool().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  matchingLineIndexes,
  shadowAliasValues,
  shadowIdentityValues
};
