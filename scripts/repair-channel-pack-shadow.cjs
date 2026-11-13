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
    note: option('note', 'Marketplace multipack shares the parent piece inventory and inherited piece cost.'),
    user: option('user', 'Channel pack shadow repair')
  };
  if (!input.parentSku || !input.shadowSku || !input.marketplaceSku) {
    throw new Error('--parent, --shadow, and --marketplace-sku are required.');
  }
  if (!Number.isInteger(input.unitsPerPack) || input.unitsPerPack < 1) {
    throw new Error('--units must be a whole number of at least 1.');
  }
  input.merchantSku = input.merchantSku || input.shadowSku;
  const apply = process.argv.includes('--apply');
  const now = new Date().toISOString();
  const product = await postgres.readProductByKey(input.parentSku);
  if (!product || normalized(product.sku) !== normalized(input.parentSku)) {
    throw new Error(`Parent SKU ${input.parentSku} was not found as a primary product.`);
  }
  const order = input.orderKey ? await postgres.readOrderByKey(input.orderKey) : null;
  if (input.orderKey && !order) throw new Error(`Order ${input.orderKey} was not found.`);
  const existingShadow = (product.shadowSkus || []).find((shadow) => [
    shadow.shadowSku, shadow.merchantSku, shadow.marketplaceSku, shadow.channelSku
  ].some((value) => [input.shadowSku, input.merchantSku, input.marketplaceSku, input.channelSku]
    .some((candidate) => candidate && normalized(value) === normalized(candidate))));
  const lineIndexes = order ? matchingLineIndexes(order, [
    input.parentSku, input.shadowSku, input.merchantSku, input.marketplaceSku, input.channelSku,
    existingShadow?.shadowSku, existingShadow?.merchantSku, existingShadow?.marketplaceSku, existingShadow?.channelSku
  ]) : [];
  if (order && !lineIndexes.length) throw new Error(`Order ${input.orderKey} has no line for ${input.parentSku}.`);
  const lineIdentifiers = order ? lineIndexes.flatMap((index) => {
    const line = orderLines(order)[index];
    return [line.originalSku, line.sourceSku, line.marketplaceSku, line.channelSku, line.externalSku].filter(Boolean);
  }) : [];
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
    order: order ? { id: order.id, orderNumber: order.orderNumber, lineIndexes } : null,
    retainedIdentifiers: [...new Set([existingShadow?.marketplaceSku, existingShadow?.channelSku, ...lineIdentifiers].filter(Boolean))]
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

  if (order) {
    for (const index of lineIndexes) {
      const line = orderLines(order)[index];
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
    for (const route of Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []) {
      if (!lineIndexes.includes(Number(route.lineIndex))) continue;
      route.sku = product.sku;
      route.inventoryMultiplier = shadow.unitsPerPack;
      route.inventoryQty = Number(route.qty || 0) * shadow.unitsPerPack;
    }
    order.productCost = orderLines(order).reduce((sum, line) => (
      sum + Math.max(0, Number(line.qty ?? line.quantity ?? 0)) * Math.max(0, Number(line.unitCost ?? line.cost ?? 0))
    ), 0);
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
    await postgres.saveOrder(order);
  }

  const verifiedProduct = await postgres.readProductByKey(input.parentSku);
  const verifiedOrder = order ? await postgres.readOrderByKey(order.id) : null;
  console.log(JSON.stringify({
    ...preview,
    applied: true,
    verifiedShadow: (verifiedProduct?.shadowSkus || []).find((entry) => String(entry.id) === String(shadow.id)) || null,
    verifiedOrderLines: verifiedOrder ? lineIndexes.map((index) => orderLines(verifiedOrder)[index]) : []
  }, null, 2));
}

main()
  .then(() => postgres.closePool())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await postgres.closePool().catch(() => {});
    process.exitCode = 1;
  });
