const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const instant = value => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : null; };

function importProgress(job = {}) {
  const status = String(job.status || '').toLowerCase();
  const payload = job.workerPayload || {};
  const message = String(job.message || '');
  const window = message.match(/Temu update window (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
  const counts = message.match(/([\d,]+) scanned, ([\d,]+) new, ([\d,]+) updated, ([\d,]+) skipped/);
  const parsed = counts?.slice(1).map(value => Number(value.replaceAll(',', '')));
  const scanned = number(job.processedRows) ?? parsed?.[0] ?? 0;
  const created = number(job.created) ?? parsed?.[1] ?? null;
  const updated = created !== null && number(job.changed) !== null ? Math.max(0, Number(job.changed) - created) : parsed?.[2] ?? null;
  const skipped = number(job.skipped) ?? (job.workerTask === 'temu-order-import' ? number(job.missingCount) : null) ?? parsed?.[3] ?? null;
  const total = number(job.totalRows);
  let percent = null, basis = 'unknown', label = 'Total not available';
  if (['success', 'completed', 'done', 'ok'].includes(status) || (['warning', 'done_with_warnings'].includes(status) && job.phase === 'complete')) {
    percent = 100; basis = 'complete'; label = 'Import complete';
  } else if (window && payload.startDate && job.startedAt && payload.forceLookback !== false) {
    const end = instant(job.startedAt), configuredStart = instant(payload.startDate);
    const days = Math.max(1, Math.min(365, number(payload.lookbackDays) || 30));
    const start = configuredStart === null || end === null ? null : Math.max(configuredStart, end - days * 86400000);
    const completedThrough = instant(window[1]);
    if (start !== null && end > start && completedThrough !== null) {
      percent = Math.max(0, Math.min(99, Math.floor(100 * (completedThrough - start) / (end - start))));
      basis = 'date_coverage'; label = 'Estimated date-range coverage';
    }
  } else if (total > 0) {
    percent = Math.max(0, Math.min(99, Math.floor(scanned / total * 100))); basis = 'rows'; label = 'Reported row target';
  } else if (number(job.progressPercent) > 0) {
    percent = Math.min(99, Number(job.progressPercent)); basis = 'reported'; label = 'Worker-reported progress';
  }
  return { percent, basis, label, scanned, created, updated, skipped, total: total > 0 ? total : null,
    window: window ? `${window[1]} to ${window[2]}` : null,
    lastActivityAt: job.lastProgressAt || job.updatedAt || job.startedAt || job.createdAt || null,
    errorCount: number(job.errorCount) ?? (Array.isArray(job.errors) ? job.errors.length : 0) };
}
module.exports = { importProgress };
