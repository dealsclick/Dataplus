async function acceptTemuOrderEvent({ db, eventId, eventType, orderIds, seen, remember, queue }) {
  const channel = (db.connections || []).find(row => String(row.name).toLowerCase() === 'temu');
  const settings = channel?.settings || {};
  if (!channel || settings.channelEnabled === false || !settings.temuWebhookEnabled
    || settings.orderDownloadEnabled === false || !settings.temuOrderImportEnabled) {
    return { disposition: 'disabled', message: 'Temu webhook processing or order imports are disabled.' };
  }
  if (await seen(eventId)) return { disposition: 'duplicate', message: 'Duplicate Temu webhook ignored.' };
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return { disposition: 'no_order_id', message: 'Temu event has no order identifier; no order scan was started. Check the webhook subscription payload.' };
  const result = await queue(db, {
    lookbackDays: 1, limit: ids.length, parentOrderSnList: ids,
    includeCanceled: true, webhookEventId: eventId
  }, { operation: 'Temu webhook order reconciliation', forceLookback: false });
  // Acknowledge/deduplicate only after the targeted job is durably saved.
  await remember(eventId, { receivedAt: new Date().toISOString(), eventType, jobId: result.job.id });
  return { disposition: 'queued', jobId: result.job.id, message: `Queued targeted refresh for ${ids.length} Temu order(s).` };
}
module.exports = { acceptTemuOrderEvent };
