const test = require('node:test');
const assert = require('node:assert/strict');
const { importTemuReturns, temuReturnRecord, temuReturnResponse } = require('../lib/temu-return-import');
const { returnNeedsAttention, reconcileOrderReturns } = require('../lib/return-workflow');
const { normalizeSourceOrderCompletion } = require('../lib/source-order-completion');

const detail = (id = 'PA1', state = 5) => ({
  parentAfterSalesSn: id, parentOrderSn: 'PO1', parentAfterSalesStatus: state, afterSalesType: 2,
  refundSummary: { buyerTotalRefund: { currency: 'USD', amount: 1299 } },
  afterSalesList: [{ afterSalesSn: `${id}-1`, orderSn: 'ITEM1', applyAfterSalesGoodsNumber: 1, afterSalesReasonDesc: 'Damaged' }]
});

test('Temu success flag is authoritative even with its nonzero success code', () => {
  assert.deepEqual(temuReturnResponse({ success: true, errorCode: 1000000, result: { data: [], total: 0 } }, 'list'), { data: [], total: 0 });
  assert.throws(() => temuReturnResponse({ success: false, errorCode: 130010001, result: {} }, 'list'), /130010001/);
  assert.throws(() => temuReturnResponse({ success: true }, 'list'), /No result/);
});

test('Temu status mappings distinguish processing, closed and channel receipt from local receipt', () => {
  for (let status = 1; status <= 12; status++) {
    const record = temuReturnRecord(detail('PA', status), [], { id: 'O' });
    assert.equal(returnNeedsAttention(record), ![5, 6, 7].includes(status));
    assert.equal(record.receivedAt, undefined);
    assert.equal(record.receivingStatus, undefined);
    assert.equal(record.items[0].receivedQty, 0);
    assert.equal(record.actualRefundAmount, null);
    assert.equal(record.external.detail.refundSummary.buyerTotalRefund.amount, 1299);
  }
});

test('Temu exact order-item linking and deduplicated reverse tracking', () => {
  const tracking = { trackingNumber: 'TRACK', carrierName: 'USPS', returnWarehouseType: 1 };
  const record = temuReturnRecord(detail(), [tracking, tracking], { id: 'O', orderNumber: '2086' }, [{ temuOrderItemId: 'ITEM1', sku: 'CAT1', title: 'Product' }]);
  assert.equal(record.items[0].sku, 'CAT1');
  assert.equal(record.items[0].channelLineId, 'PA1-1');
  assert.equal(record.returnTracking.length, 1);
  assert.equal(record.returnTracking[0].channelWarehouseType, 1);
  assert.equal(temuReturnRecord(detail(), [], null).orderId, '');
  assert.equal(temuReturnRecord(detail(), [], {}, [{ sku: 'WRONG' }]).items[0].sku, '');
});

test('closed Temu return keeps source-shipped order done; reopening requires attention', () => {
  const order = { id: 'O', orderNumber: '1', fulfillmentStatus: 'FULFILLED' };
  const record = temuReturnRecord(detail(), [], order);
  reconcileOrderReturns(order, [record]); normalizeSourceOrderCompletion(order);
  assert.equal(order.operationalStatus, 'completed');
  reconcileOrderReturns(order, [temuReturnRecord(detail('PA1', 10), [], order)]); normalizeSourceOrderCompletion(order);
  assert.equal(order.operationalStatus, 'on_hold');
  assert.equal(order.returns.length, 1);
});

test('Temu pages every time window with no total import cap and deduplicates cases', async () => {
  const calls = [], saved = new Map();
  const result = await importTemuReturns({ since: '2026-01-01', until: Date.parse('2026-01-02T00:00:00Z'), windowSeconds: 86400,
    request: async (type, payload) => {
      calls.push({ type, payload });
      if (type.endsWith('list.get')) return { total: 2, data: [{ parentAfterSalesSn: `PA${payload.pageNo}`, parentOrderSn: 'PO1' }] };
      if (type.endsWith('detail.get')) return detail(payload.parentAfterSalesSn);
      return { logisticsInfoList: [] };
    },
    save: async (source, logistics) => { const record = temuReturnRecord(source, logistics, { id: 'O' }); saved.set(record.id, record); return record; },
    progress: async () => {}
  });
  assert.equal(result.imported, 2); assert.equal(saved.size, 2); assert.equal(result.linked, 2);
  const lists = calls.filter((row) => row.type.endsWith('list.get'));
  assert.equal(lists.length, 4); assert.equal(lists[0].payload.pageSize, 200);
  assert.equal(lists[2].payload.createAtStart, lists[0].payload.createAtEnd + 1);
  assert.ok(calls.every((row) => !/issue|create|upload/.test(row.type)));
});

test('Temu rejects repeated or prematurely empty pages instead of reporting a full import', async () => {
  for (const empty of [false, true]) {
    await assert.rejects(importTemuReturns({ since: '2026-01-01', until: Date.parse('2026-01-01'),
      request: async (type, payload) => type.endsWith('list.get') ? { total: 3, data: payload.pageNo > 1 && empty ? [] : [{ parentAfterSalesSn: 'PA1', parentOrderSn: 'PO1' }] } : type.endsWith('detail.get') ? detail() : { logisticsInfoList: [] },
      save: async () => ({}), progress: async () => {}
    }), /pagination/);
  }
});

test('failed logistics does not overwrite stored tracking; refund-only does not require logistics', async () => {
  let saved = 0;
  const result = await importTemuReturns({ since: '2026-01-01', until: Date.parse('2026-01-01'),
    request: async (type, payload) => {
      if (type.endsWith('list.get')) return { total: 2, data: ['PA1', 'PA2'].map((id) => ({ parentAfterSalesSn: id, parentOrderSn: 'PO1' })) };
      if (type.endsWith('detail.get')) return { ...detail(payload.parentAfterSalesSn), afterSalesType: payload.parentAfterSalesSn === 'PA1' ? 2 : 1 };
      throw new Error('Logistics unavailable');
    }, save: async () => { saved++; return {}; }, progress: async () => {}
  });
  assert.equal(saved, 1); assert.equal(result.errors.length, 1); assert.equal(result.imported, 1);
});
