const CHANNELS = Object.freeze([
  { key: 'walmart', label: 'Walmart', pattern: /walmart/i },
  { key: 'shopify', label: 'Shopify', pattern: /shopify/i },
  { key: 'ebay', label: 'eBay', pattern: /ebay/i },
  { key: 'temu', label: 'Temu', pattern: /temu/i },
  { key: 'tiktok', label: 'TikTok Shop', pattern: /tiktok/i },
  { key: 'whatnot', label: 'Whatnot', pattern: /whatnot/i },
  { key: 'amazon', label: 'Amazon', pattern: /amazon/i },
]);

function jobClassificationText(job = {}) {
  const payload = job.workerPayload && typeof job.workerPayload === 'object' ? job.workerPayload : {};
  return [
    job.jobChannel,
    job.apiChannel,
    job.channel,
    job.workerTask,
    job.operation,
    job.name,
    job.fileName,
    job.source,
    payload.channelId,
    payload.channel,
    payload.marketplace,
    payload.source,
  ].filter(Boolean).join(' ');
}

function operationJobChannel(job = {}) {
  const text = jobClassificationText(job);
  return CHANNELS.find(channel => channel.pattern.test(text))?.label || 'Internal';
}

function operationJobChannelKey(job = {}) {
  const label = operationJobChannel(job);
  return CHANNELS.find(channel => channel.label === label)?.key || 'internal';
}

function operationJobTrigger(job = {}) {
  const explicit = String(job.jobTrigger || '').toLowerCase();
  if (explicit === 'manual') return 'manual';
  if (['automated', 'scheduled', 'system'].includes(explicit)) return 'automated';
  const payload = job.workerPayload && typeof job.workerPayload === 'object' ? job.workerPayload : {};
  const trigger = String(job.trigger || payload.trigger || '').toLowerCase();
  const actor = String(job.actor || payload.actor || '').toLowerCase();
  if (
    job.scheduled === true
    || payload.scheduled === true
    || Boolean(payload.scheduleKey)
    || Boolean(payload.sourceJobId)
    || /^scheduled\b/i.test(String(job.operation || job.name || ''))
    || ['automatic', 'automation', 'scheduled', 'schedule', 'system', 'webhook'].includes(trigger)
    || actor.startsWith('system:')
  ) return 'automated';
  return 'manual';
}

const JOB_CLASSIFICATION_TEXT_SQL = `lower(concat_ws(' ',
  coalesce(raw->>'jobChannel',''),
  coalesce(raw->>'apiChannel',''),
  coalesce(raw->>'channel',''),
  coalesce(raw->>'workerTask',''),
  coalesce(name,''),
  coalesce(raw->>'operation',''),
  coalesce(raw->>'fileName',''),
  coalesce(source,''),
  coalesce(raw->'workerPayload'->>'channelId',''),
  coalesce(raw->'workerPayload'->>'channel',''),
  coalesce(raw->'workerPayload'->>'marketplace',''),
  coalesce(raw->'workerPayload'->>'source','')
))`;

const JOB_CHANNEL_KEY_SQL = `case
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%walmart%' then 'walmart'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%shopify%' then 'shopify'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%ebay%' then 'ebay'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%temu%' then 'temu'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%tiktok%' then 'tiktok'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%whatnot%' then 'whatnot'
  when ${JOB_CLASSIFICATION_TEXT_SQL} like '%amazon%' then 'amazon'
  else 'internal'
end`;

const JOB_CHANNEL_LABEL_SQL = `case (${JOB_CHANNEL_KEY_SQL})
  when 'walmart' then 'Walmart'
  when 'shopify' then 'Shopify'
  when 'ebay' then 'eBay'
  when 'temu' then 'Temu'
  when 'tiktok' then 'TikTok Shop'
  when 'whatnot' then 'Whatnot'
  when 'amazon' then 'Amazon'
  else 'Internal'
end`;

const JOB_AUTOMATED_SQL = `case
  when lower(coalesce(raw->>'jobTrigger','')) = 'manual' then false
  when lower(coalesce(raw->>'jobTrigger','')) in ('automated','scheduled','system') then true
  when lower(coalesce(raw->>'scheduled','false')) = 'true' then true
  when lower(coalesce(raw->'workerPayload'->>'scheduled','false')) = 'true' then true
  when coalesce(raw->'workerPayload'->>'scheduleKey','') <> '' then true
  when coalesce(raw->'workerPayload'->>'sourceJobId','') <> '' then true
  when lower(coalesce(name,'')) like 'scheduled %' then true
  when lower(coalesce(raw->>'trigger', raw->'workerPayload'->>'trigger','')) in ('automatic','automation','scheduled','schedule','system','webhook') then true
  when lower(coalesce(raw->>'actor', raw->'workerPayload'->>'actor','')) like 'system:%' then true
  else false
end`;

const JOB_TRIGGER_SQL = `case when (${JOB_AUTOMATED_SQL}) then 'automated' else 'manual' end`;

module.exports = {
  CHANNELS,
  JOB_AUTOMATED_SQL,
  JOB_CHANNEL_KEY_SQL,
  JOB_CHANNEL_LABEL_SQL,
  JOB_TRIGGER_SQL,
  operationJobChannel,
  operationJobChannelKey,
  operationJobTrigger,
};
