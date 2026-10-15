function text(value = '') { return String(value ?? '').trim(); }
function number(value) { const parsed = Number(String(value ?? '').replace(/[$,]/g, '')); return Number.isFinite(parsed) ? parsed : null; }

function isoDate(value) {
  const raw = text(value).replace(/^"+|"+$/g, '');
  if (!raw) return null;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function walmartReportDates(payload) {
  const found = new Set();
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') return Object.values(value).forEach(visit);
    const raw = text(value);
    const compact = raw.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    const dashed = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    const match = compact || dashed;
    if (match) found.add(`${match[1]}${match[2]}${match[3]}`);
  };
  visit(payload);
  return [...found].sort();
}

function walmartFeeRows(rows = []) {
  return rows.flatMap((raw, index) => {
    const amountType = text(raw['Amount Type'] ?? raw.amountType);
    if (!/(commission|referral|marketplace fee|adjustment fee|advertising fee)/i.test(amountType)) return [];
    const amount = number(raw.Amount ?? raw.amount);
    if (amount == null || amount === 0) return [];
    const transactionType = text(raw['Transaction Type'] ?? raw.transactionType).toUpperCase();
    const feeAmount = /REFUND/.test(transactionType) ? -Math.abs(amount) : transactionType === 'ADJMNT' ? -amount : Math.abs(amount);
    const transactionKey = text(raw['Transaction Key'] ?? raw.transactionKey) || `row-${index + 1}`;
    const orderReference = text(raw['Purchase Order #'] ?? raw.purchaseOrderNumber ?? raw['Customer Order #'] ?? raw.customerOrderNumber);
    return [{
      externalLineId: `${transactionKey}:${amountType}:${index + 1}`,
      orderReference,
      transactionType: transactionType || 'FEE', feeType: amountType || 'marketplace_fee',
      description: text(raw['Transaction Description'] ?? raw.transactionDescription), feeAmount,
      grossAmount: number(raw['Total Payable'] ?? raw.totalPayable), currency: text(raw.Currency ?? raw.currency) || 'USD',
      transactionAt: text(raw['Transaction Posted Timestamp'] ?? raw.transactionPostedTimestamp) || null, raw
    }];
  });
}

function ebayFeeRows(transactions = []) {
  return transactions.flatMap(transaction => (Array.isArray(transaction.orderLineItems) ? transaction.orderLineItems : []).flatMap((item, itemIndex) => {
    const fees = Array.isArray(item.marketplaceFees) ? item.marketplaceFees : Array.isArray(item.fees) ? item.fees : [];
    return fees.flatMap((fee, feeIndex) => {
      const amount = number(fee.amount?.value ?? fee.amount);
      if (amount == null || amount === 0) return [];
      const transactionType = text(transaction.transactionType) || 'SALE';
      return [{
        externalLineId: `${text(transaction.transactionId)}:${text(item.orderLineItemId || item.lineItemId) || itemIndex}:${text(fee.feeType) || feeIndex}`,
        orderReference: text(transaction.orderId || transaction.salesRecordReference),
        transactionType, feeType: text(fee.feeType) || 'marketplace_fee',
        description: text(transaction.transactionMemo), feeAmount: /REFUND|CREDIT/i.test(transactionType) ? -Math.abs(amount) : Math.abs(amount),
        grossAmount: number(item.feeBasisAmount?.value), netAmount: number(transaction.amount?.value),
        currency: text(fee.amount?.currency || item.feeBasisAmount?.currency || transaction.amount?.currency) || 'USD',
        transactionAt: text(transaction.transactionDate) || null, raw: { transaction, item, fee }
      }];
    });
  }));
}

module.exports = { isoDate, walmartReportDates, walmartFeeRows, ebayFeeRows };
