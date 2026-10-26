const crypto = require('node:crypto');

const API_ORIGIN = 'https://open-api.tiktokglobalshop.com';
const AUTH_ORIGIN = 'https://auth.tiktok-shops.com';
const fail = (message, statusCode = 400, details = {}) => Object.assign(new Error(message), { statusCode, ...details });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function tiktokSignature(path, parameters = {}, body = '', appSecret = '') {
  const entries = Object.entries(parameters)
    .filter(([key]) => !['sign', 'access_token'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right));
  const base = `${path}${entries.map(([key, value]) => `${key}${String(value)}`).join('')}${body || ''}`;
  return crypto.createHmac('sha256', appSecret).update(`${appSecret}${base}${appSecret}`).digest('hex');
}

function createTikTokClient({ channel, credentials, log = () => {}, fetchImpl = fetch, pause = sleep }) {
  let pendingRefresh = null;

  async function context(gate) {
    const current = await channel();
    if (!current || current.settings?.channelEnabled !== true) throw fail('Enable TikTok Shop in Channels first.', 409);
    if (gate && current.settings?.[gate] !== true) throw fail(`Enable ${gate.replace(/^tiktok/, 'TikTok ')} in channel Features first.`, 409);
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const saved = credentials.get(environment);
    if (!saved.appKey || !saved.appSecret || !saved.accessToken) throw fail('Configure the TikTok Shop app key, app secret, and seller access token.', 409);
    return { current, environment, ...saved };
  }

  function tokenNeedsRefresh(ctx) {
    const expires = Date.parse(ctx.accessTokenExpiresAt || '');
    return Boolean(ctx.refreshToken && Number.isFinite(expires) && expires <= Date.now() + 5 * 60_000);
  }

  async function refreshToken(ctx, force = false) {
    if (!ctx.refreshToken) {
      if (force) throw fail('TikTok access token expired and no refresh token is configured. Reauthorize the seller account.', 401);
      return ctx;
    }
    if (!force && !tokenNeedsRefresh(ctx)) return ctx;
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = (async () => {
      const query = new URLSearchParams({
        app_key: ctx.appKey,
        app_secret: ctx.appSecret,
        refresh_token: ctx.refreshToken,
        grant_type: 'refresh_token'
      });
      const response = await fetchImpl(`${AUTH_ORIGIN}/api/v2/token/refresh?${query}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      log({ channel: 'TikTok Shop', transport: 'API', method: 'GET', path: '/api/v2/token/refresh', operation: 'TikTok token refresh', statusCode: response.status, ok: response.ok && Number(data.code || 0) === 0 });
      if (!response.ok || Number(data.code || 0) !== 0 || !data.data?.access_token) {
        throw fail(`TikTok token refresh failed${data.message ? `: ${String(data.message).slice(0, 500)}` : '.'}`, 401);
      }
      credentials.updateTokens(ctx.environment, data.data);
      return { ...ctx, ...credentials.get(ctx.environment) };
    })().finally(() => { pendingRefresh = null; });
    return pendingRefresh;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (!/^\/[a-z_]+\/20\d{4}\//.test(path) || path.includes('://') || path.includes('\\')) throw fail('Invalid TikTok Shop API path.');
    const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
    const retryable = options.retryable === true || method === 'GET' || (method === 'POST' && /\/search$/.test(path));
    const maxAttempts = retryable ? 5 : 2;
    let expectedIdentity = '';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let ctx = await context(options.gate);
      const identity = JSON.stringify([ctx.current.id, ctx.environment, ctx.appKey, ctx.shopCipher, credentials.fingerprint(ctx.environment)]);
      if (expectedIdentity && expectedIdentity !== identity) throw fail('TikTok Shop credentials or selected shop changed during the request.', 409);
      expectedIdentity = identity;
      ctx = await refreshToken(ctx);
      const query = Object.fromEntries(Object.entries(options.query || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
      query.app_key = ctx.appKey;
      query.timestamp = String(Math.floor(Date.now() / 1000));
      if (options.shopScoped !== false) {
        if (!ctx.shopCipher) throw fail('Select an authorized TikTok Shop before running shop operations.', 409);
        query.shop_cipher = ctx.shopCipher;
      }
      query.sign = tiktokSignature(path, query, bodyText, ctx.appSecret);
      let response;
      try {
        response = await fetchImpl(`${API_ORIGIN}${path}?${new URLSearchParams(query)}`, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(Number(options.timeoutMs || 45_000)),
          headers: {
            Accept: options.accept || 'application/json',
            'Content-Type': 'application/json',
            'x-tts-access-token': ctx.accessToken
          },
          ...(bodyText ? { body: bodyText } : {})
        });
      } catch (error) {
        log({ channel: 'TikTok Shop', transport: 'API', method, path, operation: options.operation || 'TikTok Shop API', statusCode: 502, ok: false, jobId: options.jobId, message: 'Network failure.' });
        if (!retryable || attempt >= maxAttempts - 1) throw fail('TikTok Shop network failure. Remote write acceptance is unknown; reconcile before retrying.', 502);
        await pause(Math.min(60_000, 1000 * 2 ** attempt));
        continue;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (options.raw === true && response.ok) {
        log({ channel: 'TikTok Shop', transport: 'API', method, path, operation: options.operation || 'TikTok Shop API', statusCode: response.status, ok: true, jobId: options.jobId });
        return { response, buffer: Buffer.from(await response.arrayBuffer()) };
      }
      const data = contentType.includes('json') ? await response.json().catch(() => ({})) : { message: (await response.text()).slice(0, 1500) };
      const code = Number(data.code || 0);
      const tokenExpired = code === 105002 || (response.status === 401 && attempt === 0);
      log({ channel: 'TikTok Shop', transport: 'API', method, path, operation: options.operation || 'TikTok Shop API', statusCode: response.status, ok: response.ok && code === 0, jobId: options.jobId, message: code ? `TikTok code ${code}` : '' });
      if (tokenExpired && attempt === 0) {
        ctx = await refreshToken(ctx, true);
        expectedIdentity = JSON.stringify([ctx.current.id, ctx.environment, ctx.appKey, ctx.shopCipher, credentials.fingerprint(ctx.environment)]);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && retryable && attempt < maxAttempts - 1) {
        const retryAfter = Number(response.headers.get('retry-after') || 0) * 1000;
        await pause(Math.min(120_000, Math.max(retryAfter || 0, 1000 * 2 ** attempt)));
        continue;
      }
      if (!response.ok || code !== 0) {
        throw fail(`TikTok Shop HTTP ${response.status}${data.message ? `: ${String(data.message).slice(0, 1000)}` : ''}`, response.status === 401 ? 401 : 502, { upstreamStatus: response.status, upstreamCode: code, requestId: data.request_id || '' });
      }
      return data;
    }
    throw fail('TikTok Shop request retry limit reached.', 502);
  }

  return { request, context, refreshToken };
}

module.exports = { API_ORIGIN, AUTH_ORIGIN, createTikTokClient, fail, tiktokSignature };
