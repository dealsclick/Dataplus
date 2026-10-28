const { fail } = require('./tiktok-client');

const AUTH_ORIGIN = 'https://auth.tiktok-shops.com';
const SELLER_AUTH_ORIGINS = Object.freeze({
  US: 'https://services.us.tiktokshop.com',
  DEFAULT: 'https://services.tiktokshop.com'
});

const clean = (value, limit = 4096) => String(value ?? '').trim().slice(0, limit);

function sellerAuthorizationUrl({ serviceId, state, region = 'US' } = {}) {
  const id = clean(serviceId, 512);
  const stateToken = clean(state, 512);
  if (!id) throw fail('TikTok Shop Service ID is required before seller authorization.', 409);
  if (!stateToken) throw fail('TikTok Shop authorization state is required.', 500);
  if (/[^A-Za-z0-9_-]/.test(id)) throw fail('TikTok Shop Service ID contains unsupported characters.', 400);
  const origin = clean(region, 16).toUpperCase() === 'US' ? SELLER_AUTH_ORIGINS.US : SELLER_AUTH_ORIGINS.DEFAULT;
  const url = new URL('/open/authorize', origin);
  url.searchParams.set('service_id', id);
  url.searchParams.set('state', stateToken);
  return url.toString();
}

function isTikTokAuthorizationCallbackUrl(value, base = 'http://localhost') {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value || ''), base);
  } catch {
    return false;
  }
  if (url.pathname === '/auth/tiktok/callback') return true;
  const state = clean(url.searchParams.get('state'), 512);
  return url.pathname === '/'
    && /^(?:production|development)\.[A-Za-z0-9_-]+$/.test(state)
    && (url.searchParams.has('code')
      || url.searchParams.has('auth_code')
      || url.searchParams.has('error')
      || url.searchParams.has('error_description'));
}

function normalizeScopes(value) {
  if (Array.isArray(value)) return [...new Set(value.map(scope => clean(scope, 160)).filter(Boolean))];
  return [...new Set(clean(value, 20_000).split(/[\s,]+/).map(scope => clean(scope, 160)).filter(Boolean))];
}

async function exchangeAuthorizationCode({ appKey, appSecret, authCode, fetchImpl = fetch, log = () => {} } = {}) {
  const key = clean(appKey, 512);
  const secret = clean(appSecret, 4096);
  const code = clean(authCode, 4096);
  if (!key || !secret || !code) throw fail('TikTok Shop app credentials and authorization code are required.', 400);
  const query = new URLSearchParams({
    app_key: key,
    app_secret: secret,
    auth_code: code,
    grant_type: 'authorized_code'
  });
  let response;
  try {
    response = await fetchImpl(`${AUTH_ORIGIN}/api/v2/token/get?${query}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json' }
    });
  } catch {
    log({ channel: 'TikTok Shop', transport: 'OAuth', method: 'GET', path: '/api/v2/token/get', operation: 'TikTok seller token exchange', statusCode: 502, ok: false, message: 'Network failure.' });
    throw fail('TikTok Shop token exchange could not reach TikTok. Start seller authorization again.', 502);
  }
  const payload = await response.json().catch(() => ({}));
  const upstreamCode = Number(payload.code ?? -1);
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const ok = response.ok && upstreamCode === 0 && Boolean(data.access_token) && Boolean(data.refresh_token);
  log({
    channel: 'TikTok Shop', transport: 'OAuth', method: 'GET', path: '/api/v2/token/get',
    operation: 'TikTok seller token exchange', statusCode: response.status, ok,
    message: ok ? 'Seller access and refresh tokens generated.' : `TikTok token code ${upstreamCode}.`
  });
  if (!ok) {
    const message = clean(payload.message, 500);
    throw fail(`TikTok Shop token exchange failed${message ? `: ${message}` : '.'}`, response.status >= 400 ? response.status : 502, { upstreamCode });
  }
  if (data.user_type === undefined || Number(data.user_type) !== 0) {
    throw fail('TikTok returned a non-seller token. Authorize the app with the TikTok Shop seller main account.', 409);
  }
  return { ...data, granted_scopes: normalizeScopes(data.granted_scopes) };
}

module.exports = { AUTH_ORIGIN, SELLER_AUTH_ORIGINS, exchangeAuthorizationCode, isTikTokAuthorizationCallbackUrl, sellerAuthorizationUrl };
