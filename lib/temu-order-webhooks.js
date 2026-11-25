async function acceptTemuOrderEvent({
  db,
  eventId,
  eventType,
  orderIds = [],
  accountIds = [],
  seen,
  remember,
  queue
}) {
  const channel = (db.connections || []).find((row) => String(row.name || '').trim().toLowerCase() === 'temu');
  const settings = channel?.settings || {};
  if (!channel || settings.channelEnabled === false || !settings.temuWebhookEnabled
    || settings.orderDownloadEnabled === false || !settings.temuOrderImportEnabled) {
    return { disposition: 'disabled', jobIds: [], message: 'Temu webhook processing or order imports are disabled.' };
  }
  if (eventId && await seen(eventId)) {
    return { disposition: 'duplicate', jobIds: [], message: 'Duplicate Temu webhook ignored.' };
  }
  const ids = [...new Set(orderIds.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 250);
  if (!ids.length) {
    return {
      disposition: 'no_order_id',
      jobIds: [],
      message: 'Temu event has no order identifier; no order scan was started. Check the webhook subscription payload.'
    };
  }
  const shops = [...new Set(accountIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!shops.length) throw new Error('Temu webhook order reconciliation needs at least one connected shop.');

  const jobs = [];
  for (const accountId of shops) {
    const result = await queue(db, {
      accountId,
      mode: 'status',
      lookbackDays: 1,
      limit: ids.length,
      includeCanceled: true,
      parentOrderSnList: ids,
      webhookEventId: eventId
    }, {
      accountId,
      operation: 'Temu webhook order reconciliation',
      forceLookback: false,
      allowQueuedTargeted: true
    });
    jobs.push(result.job);
  }

  if (eventId) {
    await remember(eventId, {
      receivedAt: new Date().toISOString(),
      eventType,
      orderIds: ids,
      jobIds: jobs.map((job) => job?.id).filter(Boolean)
    });
  }
  return {
    disposition: 'queued',
    jobIds: jobs.map((job) => job?.id).filter(Boolean),
    message: `Queued targeted status refresh for ${ids.length} Temu order${ids.length === 1 ? '' : 's'} across ${shops.length} shop${shops.length === 1 ? '' : 's'}.`
  };
}

module.exports = { acceptTemuOrderEvent };
