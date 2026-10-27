const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value : [];
const number = value => {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
};

function money(value) {
  if (value && typeof value === 'object') return number(value.amount ?? value.value);
  return number(value);
}

function normalizeTikTokLiveSession(raw = {}, accountType = '') {
  const sales = raw.sales || raw.sales_performance || raw.performance?.sales || {};
  const traffic = raw.traffic || raw.traffic_performance || raw.performance?.traffic || {};
  const interaction = raw.interactions || raw.interaction_performance || raw.performance?.interactions || {};
  const creator = raw.creator || {};
  const liveId = text(raw.id || raw.live_id || raw.live_room_id);
  return {
    liveId,
    title: text(raw.title || raw.live_title),
    creatorUsername: text(raw.username || creator.user_name || creator.username || creator.nick_name),
    creatorOpenId: text(creator.open_id),
    accountType: text(raw.account_type || creator.author_type || accountType),
    startTime: iso(raw.start_time),
    endTime: iso(raw.end_time),
    gmv: money(sales.live_attributed_gmv ?? sales.live_gmv ?? sales.gmv ?? sales.amount ?? raw.gmv),
    currency: text(sales.live_attributed_gmv?.currency || sales.live_gmv?.currency || sales.gmv?.currency || sales.currency || raw.currency),
    skuOrders: number(sales.live_attributed_sku_orders ?? sales.attributed_sku_orders ?? sales.sku_orders ?? raw.sku_orders),
    mainOrders: number(sales.main_orders ?? sales.orders ?? raw.main_orders),
    itemsSold: number(sales.live_attributed_items_sold ?? sales.attributed_items_sold ?? sales.items_sold ?? raw.items_sold),
    customers: number(sales.attributed_customers ?? sales.customers ?? raw.customers),
    productsAdded: number(traffic.products_added ?? sales.products_added ?? raw.products_added),
    differentProductsSold: number(sales.products_sold ?? sales.different_products_sold ?? raw.different_products_sold),
    views: number(traffic.views ?? interaction.views ?? raw.views),
    viewers: number(traffic.viewers ?? interaction.viewers ?? raw.viewers),
    productClicks: number(traffic.product_clicks ?? interaction.product_clicks ?? raw.product_clicks),
    comments: number(interaction.comments ?? raw.comments),
    likes: number(interaction.likes ?? raw.likes),
    shares: number(interaction.shares ?? raw.shares),
    raw
  };
}

function normalizeTikTokLiveProduct(raw = {}) {
  const sales = raw.sales || raw.sales_performance || {};
  const traffic = raw.traffic || raw.traffic_performance || {};
  return {
    productId: text(raw.id || raw.product_id),
    name: text(raw.name || raw.title || raw.product_name),
    gmv: money(sales.gmv ?? sales.direct_gmv ?? sales.amount),
    currency: text(sales.gmv?.currency || sales.direct_gmv?.currency || sales.currency),
    skuOrders: number(sales.sku_orders ?? sales.created_sku_orders),
    mainOrders: number(sales.main_orders),
    itemsSold: number(sales.items_sold ?? sales.units_sold),
    customers: number(sales.customers),
    productImpressions: number(traffic.product_impressions),
    productClicks: number(traffic.product_clicks ?? traffic.produt_clicks),
    raw
  };
}

function normalizeTikTokLiveAttribution(raw = {}) {
  const lines = array(raw.skus).map(line => ({
    productId: text(line.product_id),
    contentType: text(line.content_type).toUpperCase(),
    contentId: text(line.content_id),
    creatorUsername: text(line.creator_username),
    quantity: Math.max(0, number(line.quantity)),
    refundedQuantity: Math.max(0, number(line.refunded_quantity)),
    returnedQuantity: Math.max(0, number(line.returned_quantity)),
    campaignId: text(line.campaign_id),
    openCollaborationId: text(line.open_collaboration_id),
    targetCollaborationId: text(line.target_collaboration_id),
    commissionRate: text(line.commission_rate),
    estimatedPaidCommission: money(line.estimated_paid_commission),
    actualPaidCommission: money(line.actual_paid_commission),
    currency: text(line.actual_paid_commission?.currency || line.estimated_paid_commission?.currency || line.price?.currency)
  }));
  const liveLines = lines.filter(line => ['LIVE', 'PRE_LIVE'].includes(line.contentType));
  return {
    orderId: text(raw.id || raw.order_id),
    status: text(raw.status),
    createTime: iso(raw.create_time),
    deliveryTime: iso(raw.delivery_time),
    isLive: liveLines.length > 0,
    contentTypes: [...new Set(liveLines.map(line => line.contentType))],
    contentIds: [...new Set(liveLines.map(line => line.contentId).filter(Boolean))],
    creators: [...new Set(liveLines.map(line => line.creatorUsername).filter(Boolean))],
    lines: liveLines,
    raw
  };
}

function applyTikTokLiveAttribution(order = {}, attribution = {}) {
  if (!attribution.isLive) return order;
  const lineByProductId = new Map(array(attribution.lines).map(line => [text(line.productId), line]).filter(([key]) => key));
  const items = array(order.items).map(item => {
    const live = lineByProductId.get(text(item.productId));
    return live ? { ...item, isTikTokLive: true, tiktokLiveContentType: live.contentType, tiktokLiveContentId: live.contentId, tiktokLiveCreator: live.creatorUsername } : item;
  });
  const live = {
    isLive: true,
    contentTypes: array(attribution.contentTypes),
    contentIds: array(attribution.contentIds),
    creators: array(attribution.creators),
    source: 'TikTok affiliate order attribution',
    checkedAt: new Date().toISOString(),
    lines: array(attribution.lines)
  };
  return {
    ...order,
    items,
    salesOrigin: 'tiktok_live',
    isTikTokLive: true,
    tiktokLive: live,
    external: {
      ...(order.external || {}),
      salesOrigin: 'tiktok_live',
      isTikTokLive: true,
      tiktokLive: live
    }
  };
}

function summarizeTikTokLiveSessions(sessions = []) {
  return array(sessions).reduce((summary, session) => ({
    sessionCount: summary.sessionCount + 1,
    gmv: summary.gmv + number(session.gmv),
    skuOrders: summary.skuOrders + number(session.skuOrders),
    mainOrders: summary.mainOrders + number(session.mainOrders),
    itemsSold: summary.itemsSold + number(session.itemsSold),
    views: summary.views + number(session.views),
    productClicks: summary.productClicks + number(session.productClicks)
  }), { sessionCount: 0, gmv: 0, skuOrders: 0, mainOrders: 0, itemsSold: 0, views: 0, productClicks: 0 });
}

module.exports = {
  applyTikTokLiveAttribution,
  normalizeTikTokLiveAttribution,
  normalizeTikTokLiveProduct,
  normalizeTikTokLiveSession,
  summarizeTikTokLiveSessions
};
