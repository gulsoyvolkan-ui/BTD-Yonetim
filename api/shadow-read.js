'use strict';

const { header, keysMatch, bearerToken, rateLimit, audit } = require('./_lib/guard');
const { resolveMembership, firmaAllowed } = require('./_lib/membership');
const {
  AUDIENCE,
  FIELDS,
  ORDER_COLUMNS,
  WORK_ORDER_COLUMNS,
  TASK_COLUMNS,
  classifyFreshness,
  verifyUserConsent,
  verifyServiceIdentity,
  assertReadOnly,
  summarizeOperational,
} = require('./_lib/shadow');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function readConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const apiKey = String(process.env.BTD_API_KEY || '').trim();
  const signingKey = String(process.env.BTD_SHADOW_SIGNING_KEY || '').trim();
  const verifyKey = String(process.env.BTD_SHADOW_SERVICE_VERIFY_KEY || '').trim();
  return { url, anonKey, apiKey, signingKey, verifyKey };
}

function missingBase(config) {
  const missing = [];
  if (!config.url) missing.push('SUPABASE_URL');
  if (!config.anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.apiKey) missing.push('BTD_API_KEY');
  return missing;
}

function contentRangeTotal(value, rowCount) {
  const match = String(value || '').match(/\/(\d+|\*)$/);
  if (!match) return { ok: rowCount < 1000, total: rowCount };
  if (match[1] === '*') return { ok: true, total: rowCount };
  const total = Number(match[1]);
  return { ok: Number.isFinite(total) && total === rowCount, total };
}

async function readScoped(config, accessToken, table, select, firmaId) {
  const endpoint = new URL(`${config.url}/rest/v1/${table}`);
  endpoint.searchParams.set('select', select);
  endpoint.searchParams.set('firma_id', `eq.${firmaId}`);
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
      Range: '0-999',
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, denied: true };
  }
  if (!response.ok || !Array.isArray(payload)) {
    return { ok: false, denied: false };
  }
  const rangeHeader = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-range')
    : '';
  const ranged = contentRangeTotal(rangeHeader, payload.length);
  if (!ranged.ok) return { ok: false, denied: false };
  return { ok: true, rows: payload };
}

function queryValue(req, name) {
  const raw = req.query ? req.query[name] : undefined;
  if (Array.isArray(raw)) return { error: `${name} bir kez verilmeli` };
  if (raw == null || raw === '') return { value: '' };
  return { value: String(raw).trim() };
}

function identityView(claims) {
  return {
    iss: claims.iss,
    aud: claims.aud,
    perm: claims.perm,
    firma_id: claims.firma_id,
    exp: claims.exp,
  };
}

function unavailable(res, identity) {
  return send(res, 200, {
    contract: AUDIENCE,
    writes: false,
    freshness: 'UNAVAILABLE',
    fields: FIELDS,
    data: null,
    identity,
  });
}

async function readOperational(req, res, config, accessToken, firmaId, membership, identity) {
  const method = String(req.method || 'GET').toUpperCase();
  let orders;
  let workOrders;
  let tasks;
  try {
    orders = await readScoped(config, accessToken, 'siparisler', ORDER_COLUMNS.join(','), firmaId);
    workOrders = await readScoped(config, accessToken, 'is_emirleri', WORK_ORDER_COLUMNS.join(','), firmaId);
    tasks = await readScoped(config, accessToken, 'gorevler', TASK_COLUMNS.join(','), firmaId);
  } catch {
    orders = { ok: false, denied: false };
  }
  const denied = [orders, workOrders, tasks].some((item) => item && item.denied);
  if (denied || !orders || !orders.ok || !workOrders || !workOrders.ok || !tasks || !tasks.ok) {
    const status = denied ? 403 : 200;
    audit({
      event: denied ? 'shadow_denied' : 'shadow_unavailable',
      table: 'shadow',
      method,
      firmaId,
      actor: membership.actor,
      status,
    });
    if (denied) {
      return send(res, 403, {
        contract: AUDIENCE,
        writes: false,
        freshness: 'PERMISSION_DENIED',
        fields: FIELDS,
        data: null,
        identity,
      });
    }
    return unavailable(res, identity);
  }
  const summary = summarizeOperational({
    orders: orders.rows,
    workOrders: workOrders.rows,
    tasks: tasks.rows,
    today: new Date().toISOString().slice(0, 10),
  });
  if (!summary.ok) {
    audit({
      event: 'shadow_unavailable',
      table: 'shadow',
      method,
      firmaId,
      actor: membership.actor,
      status: 200,
    });
    return unavailable(res, identity);
  }
  const observedAt = Date.now();
  const freshness = classifyFreshness({
    permission: true,
    upstream: 'up',
    observedAt,
    now: observedAt,
    clockTrusted: true,
  });
  audit({
    event: 'shadow_read',
    table: 'shadow',
    method,
    firmaId,
    actor: membership.actor,
    status: 200,
  });
  return send(res, 200, {
    contract: AUDIENCE,
    writes: false,
    freshness,
    fields: FIELDS,
    data: summary.data,
    identity,
  });
}

async function handle(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  const write = assertReadOnly(method);
  if (!write.ok) {
    audit({ event: 'shadow_write_blocked', table: 'shadow', method, status: 405 });
    return send(res, 405, {
      contract: AUDIENCE,
      writes: false,
      freshness: write.freshness,
      error: write.error,
    });
  }

  const config = readConfig();
  const missing = missingBase(config);
  if (missing.length) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing, writes: false });
  }
  if (!keysMatch(header(req, 'x-api-key'), config.apiKey)) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }
  const limited = rateLimit(req);
  if (!limited.ok) return send(res, 429, { error: limited.error, writes: false });

  const accessToken = bearerToken(req);
  const consent = header(req, 'x-btd-user-consent');
  const serviceToken = header(req, 'x-shadow-service-identity');
  const legacy = header(req, 'x-btd-service-identity');
  const apiKey = header(req, 'x-api-key');
  if (legacy || (consent && serviceToken) || (serviceToken && accessToken)) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }
  if ((consent && (consent === accessToken || consent === apiKey)) || (serviceToken && serviceToken === apiKey)) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }

  const firma = queryValue(req, 'firma_id');
  if (firma.error || !UUID.test(firma.value)) {
    return send(res, 400, { error: 'firma_id uuid olmalı', writes: false });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (serviceToken) {
    if (!config.verifyKey) {
      return send(res, 503, { error: 'ortam değişkeni eksik', missing: ['BTD_SHADOW_SERVICE_VERIFY_KEY'], writes: false });
    }
    const verified = verifyServiceIdentity(serviceToken, config.verifyKey, nowSec, firma.value, config.signingKey);
    if (!verified.ok) {
      const denied = verified.reason === 'firma';
      return send(res, denied ? 403 : 401, {
        contract: AUDIENCE,
        writes: false,
        freshness: denied ? 'PERMISSION_DENIED' : undefined,
        error: denied ? 'erişim yok' : 'kimlik doğrulanamadı',
      });
    }
    audit({
      event: 'shadow_service_verified',
      table: 'shadow',
      method,
      firmaId: firma.value,
      status: 200,
    });
    return unavailable(res, identityView(verified.claims));
  }

  if (!consent || !accessToken) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }
  if (!config.signingKey) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: ['BTD_SHADOW_SIGNING_KEY'], writes: false });
  }
  const verified = verifyUserConsent(consent, config.signingKey, nowSec, firma.value);
  if (!verified.ok) {
    const denied = verified.reason === 'firma';
    return send(res, denied ? 403 : 401, {
      contract: AUDIENCE,
      writes: false,
      freshness: denied ? 'PERMISSION_DENIED' : undefined,
      error: denied ? 'erişim yok' : 'kimlik doğrulanamadı',
    });
  }

  const membership = await resolveMembership(config, accessToken);
  if (membership.status !== 200) {
    return send(res, membership.status, { error: membership.error || 'erişim yok', writes: false });
  }
  if (!firmaAllowed(membership, firma.value)) {
    return send(res, 403, {
      contract: AUDIENCE,
      writes: false,
      freshness: 'PERMISSION_DENIED',
      error: 'erişim yok',
    });
  }

  return readOperational(req, res, config, accessToken, firma.value, membership, identityView(verified.claims));
}

module.exports = handle;
module.exports.handle = handle;
