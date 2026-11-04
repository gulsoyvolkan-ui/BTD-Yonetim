'use strict';

const { header, keysMatch, bearerToken, rateLimit, audit } = require('./_lib/guard');
const { resolveMembership, firmaAllowed } = require('./_lib/membership');
const {
  AUDIENCE,
  SERVICE_SUBJECT,
  FIELDS,
  ORDER_COLUMNS,
  WORK_ORDER_COLUMNS,
  TASK_COLUMNS,
  classifyFreshness,
  projectFields,
  inspectUserConsent,
  verifyUserConsent,
  inspectServiceIdentity,
  verifyServiceIdentity,
  securityPrerequisite,
  assertReadOnly,
  summarizeOperational,
} = require('./_lib/shadow');
const replayLib = require('./_lib/shadow-replay');

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

function unavailable(res, identity, extra) {
  return send(res, 200, Object.assign({
    contract: AUDIENCE,
    writes: false,
    freshness: 'UNAVAILABLE',
    fields: FIELDS,
    data: null,
    identity,
  }, extra || {}));
}

function identityFailure(res, verified) {
  if (verified && verified.reason === 'replay_unverified') {
    return send(res, 503, {
      error: 'ortam değişkeni eksik',
      missing: ['BTD_SHADOW_REPLAY_DATABASE_URL'],
      writes: false,
    });
  }
  const denied = verified && verified.reason === 'firma';
  return send(res, denied ? 403 : 401, {
    contract: AUDIENCE,
    writes: false,
    freshness: denied ? 'PERMISSION_DENIED' : undefined,
    error: denied ? 'erişim yok' : 'kimlik doğrulanamadı',
  });
}

function serviceOptions() {
  const version = process.env.BTD_SHADOW_SERVICE_KEY_VERSION;
  const previousSecret = String(process.env.BTD_SHADOW_SERVICE_VERIFY_KEY_PREV || '').trim();
  const options = {
    keyVersion: version == null || version === '' ? 1 : Number(version),
  };
  if (previousSecret) {
    options.previous = {
      secret: previousSecret,
      version: Number(process.env.BTD_SHADOW_SERVICE_KEY_VERSION_PREV),
    };
  }
  return options;
}

function ensureReplayFromEnv() {
  if (replayLib.getReplayStore()) return;
  const raw = String(process.env.BTD_SHADOW_REPLAY_DATABASE_URL || '').trim();
  const decision = replayLib.replayUrlDecision(raw);
  if (!decision.ok) return;
  const query = (sql, params) => replayLib.databaseQuery(raw, sql, params);
  replayLib.setReplayStore(replayLib.createPostgresReplayStore(query));
  if (!replayLib.getRegistry()) replayLib.setRegistry(replayLib.createPostgresRegistry(query));
}

function copyOperational(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.siparis_ozet)) return null;
  if (!Number.isInteger(data.geciken_is_emri_adet) || data.geciken_is_emri_adet < 0) return null;
  if (!Number.isInteger(data.acik_gorev_adet) || data.acik_gorev_adet < 0) return null;
  return {
    kaynak_id: data.kaynak_id === 'btd-operasyon' ? data.kaynak_id : 'btd-operasyon',
    guncellendi: data.guncellendi == null ? null : data.guncellendi,
    siparis_ozet: data.siparis_ozet.map((row) => projectFields(row)),
    geciken_is_emri_adet: data.geciken_is_emri_adet,
    acik_gorev_adet: data.acik_gorev_adet,
  };
}

function serviceDenial(reason) {
  if (reason === 'firma') return 403;
  if (reason === 'revoked' || reason === 'disabled' || reason === 'expired' || reason === 'key' || reason === 'scope' || reason === 'unknown') {
    return 401;
  }
  return 0;
}

async function serviceOperational(claims) {
  const raw = String(process.env.BTD_SHADOW_READER_DATABASE_URL || '').trim();
  const decision = replayLib.replayUrlDecision(raw);
  if (!decision.ok) return { blocked: true };
  let rows;
  try {
    rows = await replayLib.databaseQuery(
      raw,
      'SELECT public.btd_shadow_operasyon_ozet($1, $2::uuid, $3::int) AS payload',
      [SERVICE_SUBJECT, claims.firma_id, Number(claims.kv)]
    );
  } catch (err) {
    if (err && err.reason === 'bridge') return { blocked: true };
    return { unavailable: true };
  }
  let payload = rows && rows[0] && rows[0].payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return { unavailable: true };
    }
  }
  if (!payload || payload.ok !== true) {
    const denied = serviceDenial(payload && payload.reason);
    if (denied) return { denied, reason: payload.reason };
    return { unavailable: true };
  }
  const data = copyOperational(payload.data);
  if (!data) return { unavailable: true };
  return { data };
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
  ensureReplayFromEnv();
  if (serviceToken) {
    if (!config.verifyKey) {
      return send(res, 503, { error: 'ortam değişkeni eksik', missing: ['BTD_SHADOW_SERVICE_VERIFY_KEY'], writes: false });
    }
    const options = serviceOptions();
    const preview = inspectServiceIdentity(serviceToken, config.verifyKey, nowSec, firma.value, config.signingKey, options);
    if (!preview.ok) return identityFailure(res, preview);
    const gate = securityPrerequisite('service');
    if (!gate.ok) {
      return send(res, 503, { error: 'ortam değişkeni eksik', missing: gate.missing, writes: false });
    }
    const verified = await verifyServiceIdentity(serviceToken, config.verifyKey, nowSec, firma.value, config.signingKey, options);
    if (!verified.ok) return identityFailure(res, verified);
    if (verified.finish) {
      try { await verified.finish(); } catch { /* acik kayit yeniden kullanimi kapatir */ }
    }
    const operational = await serviceOperational(verified.claims);
    if (operational && operational.denied) {
      audit({
        event: operational.denied === 403 ? 'shadow_denied' : 'shadow_service_rejected',
        table: 'shadow',
        method,
        firmaId: firma.value,
        status: operational.denied,
      });
      return send(res, operational.denied, {
        contract: AUDIENCE,
        writes: false,
        freshness: operational.denied === 403 ? 'PERMISSION_DENIED' : undefined,
        error: operational.denied === 403 ? 'erişim yok' : 'kimlik doğrulanamadı',
      });
    }
    if (operational && operational.data) {
      const observedAt = Date.now();
      audit({
        event: 'shadow_service_read',
        table: 'shadow',
        method,
        firmaId: firma.value,
        status: 200,
      });
      return send(res, 200, {
        contract: AUDIENCE,
        writes: false,
        freshness: classifyFreshness({
          permission: true,
          upstream: 'up',
          observedAt,
          now: observedAt,
          clockTrusted: true,
        }),
        fields: FIELDS,
        data: operational.data,
        identity: identityView(verified.claims),
      });
    }
    audit({
      event: operational && operational.blocked ? 'shadow_service_blocked' : 'shadow_service_unavailable',
      table: 'shadow',
      method,
      firmaId: firma.value,
      status: 200,
    });
    return unavailable(res, identityView(verified.claims), operational && operational.blocked ? { read: 'BLOCKED' } : {});
  }

  if (!consent || !accessToken) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }
  if (!config.signingKey) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: ['BTD_SHADOW_SIGNING_KEY'], writes: false });
  }
  const preview = inspectUserConsent(consent, config.signingKey, nowSec, firma.value);
  if (!preview.ok) return identityFailure(res, preview);
  const gate = securityPrerequisite('user');
  if (!gate.ok) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: gate.missing, writes: false });
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
  const verified = await verifyUserConsent(consent, config.signingKey, nowSec, firma.value);
  if (!verified.ok) return identityFailure(res, verified);

  let sent;
  try {
    sent = await readOperational(req, res, config, accessToken, firma.value, membership, identityView(verified.claims));
  } catch {
    if (verified.cancel) await verified.cancel();
    return unavailable(res, identityView(verified.claims));
  }
  if (verified.finish) {
    try { await verified.finish(); } catch { /* acik kayit ikinci sunumu kapatir */ }
  }
  return sent;
}

module.exports = handle;
module.exports.handle = handle;
