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
  return walmartReportFiles(payload).map(file => file.canonicalDate);
}

function walmartReportFiles(payload) {
  const found = new Map();
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') return Object.values(value).forEach(visit);
    const raw = text(value);
    const yearFirst = raw.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    const monthFirst = raw.match(/\b(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(20\d{2})\b/);
    const dashed = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    const parts = yearFirst || dashed
      ? [String((yearFirst || dashed)[1]), String((yearFirst || dashed)[2]), String((yearFirst || dashed)[3])]
      : monthFirst ? [monthFirst[3], monthFirst[1], monthFirst[2]] : null;
    if (!parts) return;
    const canonicalDate = parts.join('');
    const parsed = Date.parse(`${parts[0]}-${parts[1]}-${parts[2]}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return;
    if (!found.has(canonicalDate)) found.set(canonicalDate, {
      canonicalDate,
      reportDate: yearFirst || monthFirst ? (yearFirst || monthFirst)[0] : dashed[0],
      isoDate: `${parts[0]}-${parts[1]}-${parts[2]}`
    });
  };
  visit(payload);
  return [...found.values()].sort((left, right) => left.canonicalDate.localeCompare(right.canonicalDate));
}

function walmartPayoutSummary(rows = [], reportFile = {}, paymentStatement = {}) {
  const summary = rows.find(raw => /paymentsummary/i.test(text(raw['Transaction Type'] ?? raw.transactionType))) || {};
  const description = text(summary['Transaction Description'] ?? summary.transactionDescription);
  const payoutAmount = number(summary['Total Payable'] ?? summary.totalPayable);
  const payoutDay = isoDate(summary['Transaction Posted Timestamp'] ?? summary.transactionPostedTimestamp);
  const accountSummary = paymentStatement?.payload?.accountSummary || paymentStatement?.accountSummary || {};
  const processor = text(accountSummary.paymentProcessor);
  const deposited = /deposit(?:ed)?|paid\s+to\s+you|payment\s+completed/i.test(description);
  const transactionIds = new Set(rows.map(raw => text(raw['Transaction Key'] ?? raw.transactionKey)).filter(Boolean));
  return {
    payoutAmount,
    payoutDate: payoutDay ? `${payoutDay}T00:00:00.000Z` : null,
    payoutStatus: deposited ? 'SUCCEEDED' : payoutAmount == null ? null : 'REPORTED',
    bankReference: text(summary['Transaction Key'] ?? summary.transactionKey) || null,
    payoutMemo: description || null,
    payoutInstrument: processor ? { instrumentType: 'PAYMENT_PROCESSOR', nickname: processor } : {},
    transactionCount: transactionIds.size,
    raw: { reportFile, paymentSummary: summary, accountSummary: Object.keys(accountSummary).length ? accountSummary : undefined }
  };
}

function walmartFeeRows(rows = []) {
  const transactionTotals = new Map();
  for (const raw of rows) {
    const transactionKey = text(raw['Transaction Key'] ?? raw.transactionKey);
    const orderReference = text(raw['Purchase Order #'] ?? raw.purchaseOrderNumber ?? raw['Customer Order #'] ?? raw.customerOrderNumber);
    const amount = number(raw.Amount ?? raw.amount);
    if (!transactionKey || !orderReference || amount == null) continue;
    const current = transactionTotals.get(transactionKey) || { amount: 0, orderReference, raw };
    current.amount += amount;
    transactionTotals.set(transactionKey, current);
  }
  const feeRows = rows.flatMap((raw, index) => {
    const amountType = text(raw['Amount Type'] ?? raw.amountType);
    const description = text(raw['Transaction Description'] ?? raw.transactionDescription);
    const directFee = /(commission|referral|marketplace fee|adjustment fee|advertising fee)/i.test(amountType);
    const feeReimbursement = /fee\s*\/\s*reimbursement/i.test(amountType) && /(fee|commission|charge)/i.test(description);
    if (!directFee && !feeReimbursement) return [];
    const amount = number(raw.Amount ?? raw.amount);
    if (amount == null || amount === 0) return [];
    const transactionType = text(raw['Transaction Type'] ?? raw.transactionType).toUpperCase();
    const feeAmount = feeReimbursement ? -amount : /REFUND/.test(transactionType) ? -Math.abs(amount) : transactionType === 'ADJMNT' ? -amount : Math.abs(amount);
    const transactionKey = text(raw['Transaction Key'] ?? raw.transactionKey) || `row-${index + 1}`;
    const orderReference = text(raw['Purchase Order #'] ?? raw.purchaseOrderNumber ?? raw['Customer Order #'] ?? raw.customerOrderNumber);
    const transactionAmount = transactionTotals.get(transactionKey)?.amount;
    return [{
      externalLineId: `${transactionKey}:${amountType}:${index + 1}`,
      orderReference,
      transactionType: transactionType || 'FEE', feeType: feeReimbursement ? description : amountType || 'marketplace_fee',
      description, feeAmount,
      grossAmount: number(raw['Total Payable'] ?? raw.totalPayable), netAmount: transactionAmount,
      transactionId: transactionKey, transactionStatus: 'PAYOUT', bookingEntry: Number(transactionAmount || 0) < 0 ? 'DEBIT' : 'CREDIT', transactionAmount,
      currency: text(raw.Currency ?? raw.currency) || 'USD',
      transactionAt: text(raw['Transaction Posted Timestamp'] ?? raw.transactionPostedTimestamp) || null, raw
    }];
  });
  const represented = new Set(feeRows.map(row => row.transactionId));
  for (const [transactionId, transaction] of transactionTotals) {
    if (represented.has(transactionId)) continue;
    const raw = transaction.raw;
    feeRows.push({
      externalLineId: `${transactionId}:payout-evidence`, orderReference: transaction.orderReference,
      transactionType: text(raw['Transaction Type'] ?? raw.transactionType) || 'SALE', feeType: 'PAYOUT_EVIDENCE',
      description: text(raw['Transaction Description'] ?? raw.transactionDescription) || 'Walmart payout transaction evidence',
      feeAmount: 0, netAmount: transaction.amount, transactionId, transactionStatus: 'PAYOUT',
      bookingEntry: transaction.amount < 0 ? 'DEBIT' : 'CREDIT', transactionAmount: transaction.amount,
      currency: text(raw.Currency ?? raw.currency) || 'USD',
      transactionAt: text(raw['Transaction Posted Timestamp'] ?? raw.transactionPostedTimestamp) || null, raw
    });
  }
  return feeRows;
}

function ebayFeeRows(transactions = []) {
  return transactions.flatMap(transaction => {
    const transactionId = text(transaction.transactionId);
    const orderReference = text(transaction.orderId || transaction.salesRecordReference);
    if (!transactionId || !orderReference) return [];
    const transactionType = text(transaction.transactionType) || 'SALE';
    const transactionMetadata = {
      payoutId: text(transaction.payoutId), transactionId,
      transactionStatus: text(transaction.transactionStatus), bookingEntry: text(transaction.bookingEntry),
      transactionAmount: number(transaction.amount?.value ?? transaction.amount)
    };
    const feeRows = (Array.isArray(transaction.orderLineItems) ? transaction.orderLineItems : []).flatMap((item, itemIndex) => {
    const fees = Array.isArray(item.marketplaceFees) ? item.marketplaceFees : Array.isArray(item.fees) ? item.fees : [];
    return fees.flatMap((fee, feeIndex) => {
      const amount = number(fee.amount?.value ?? fee.amount);
      if (amount == null || amount === 0) return [];
      return [{
        externalLineId: `${transactionId}:${text(item.orderLineItemId || item.lineItemId) || itemIndex}:${text(fee.feeType) || feeIndex}`,
        orderReference,
        transactionType, feeType: text(fee.feeType) || 'marketplace_fee',
        description: text(transaction.transactionMemo), feeAmount: /REFUND|CREDIT/i.test(transactionType) ? -Math.abs(amount) : Math.abs(amount),
        grossAmount: number(item.feeBasisAmount?.value), netAmount: number(transaction.amount?.value),
        currency: text(fee.amount?.currency || item.feeBasisAmount?.currency || transaction.amount?.currency) || 'USD',
        transactionAt: text(transaction.transactionDate) || null, ...transactionMetadata, raw: { transaction, item, fee }
      }];
    });
    });
    if (feeRows.length) return feeRows;
    return [{
      externalLineId: `${transactionId}:payout-evidence`, orderReference, transactionType,
      feeType: 'PAYOUT_EVIDENCE', description: text(transaction.transactionMemo) || 'eBay payout transaction evidence',
      feeAmount: 0, grossAmount: number(transaction.totalFeeBasisAmount?.value), netAmount: number(transaction.amount?.value),
      currency: text(transaction.amount?.currency) || 'USD', transactionAt: text(transaction.transactionDate) || null,
      ...transactionMetadata, raw: { transaction }
    }];
  });
}

module.exports = { isoDate, walmartReportDates, walmartReportFiles, walmartPayoutSummary, walmartFeeRows, ebayFeeRows };
