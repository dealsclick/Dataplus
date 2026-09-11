const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Shared data volume, matching Shopify/eBay runtime credentials. Never channel settings.
function createWalmartCredentials({ directory, env = process.env }) {
  const file = path.join(directory, 'walmart-runtime-credentials.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Walmart credential storage could not be read.'); }
  }
  function get(environment = 'production') {
    const saved = read()[environment];
    const prefix = environment === 'sandbox' ? 'WALMART_SANDBOX_' : 'WALMART_';
    return saved || { clientId: env[`${prefix}CLIENT_ID`] || '', clientSecret: env[`${prefix}CLIENT_SECRET`] || '', channelType: env.WALMART_CHANNEL_TYPE ? 'assigned' : 'direct', channelTypeId: env.WALMART_CHANNEL_TYPE || '' };
  }
  function fingerprint(environment) { const c = get(environment); return crypto.createHash('sha256').update(JSON.stringify([environment,c.clientId,c.clientSecret,c.channelType,c.channelTypeId])).digest('hex'); }
  function status(environment) {
    const c = get(environment);
    return { clientId: c.clientId, secretConfigured: Boolean(c.clientSecret), configured: Boolean(c.clientId && c.clientSecret), channelType: c.channelType || 'direct', channelTypeId: c.channelTypeId || '', updatedAt: c.updatedAt || '' };
  }
  function save(environment, patch) {
    if (!['production','sandbox'].includes(environment)) throw new Error('Select production or sandbox.');
    const current = get(environment);
    const clientId = String(patch.clientId || '').trim();
    const clientSecret = String(patch.clientSecret || '').trim() || current.clientSecret;
    if (!clientId || !clientSecret) throw new Error('Client ID and client secret are required.');
    if (clientId !== current.clientId && !String(patch.clientSecret || '').trim()) throw new Error('Enter the matching client secret when changing client ID.');
    if (clientId.length > 512 || clientSecret.length > 4096 || /[\r\n]/.test(clientId + clientSecret)) throw new Error('Invalid Walmart credentials.');
    if (!['direct','assigned'].includes(patch.channelType)) throw new Error('Select a Walmart channel type.');
    const channelTypeId = patch.channelType === 'assigned' ? String(patch.channelTypeId || '').trim() : '';
    if (patch.channelType === 'assigned' && !/^[a-zA-Z0-9-]{1,128}$/.test(channelTypeId)) throw new Error('Enter the channel ID assigned by Walmart during onboarding.');
    const next = { ...read(), [environment]: { clientId, clientSecret, channelType: patch.channelType, channelTypeId, updatedAt: new Date().toISOString() } };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return status(environment);
  }
  return { get, status, save, fingerprint };
}
module.exports = { createWalmartCredentials };
