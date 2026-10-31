'use strict';

const crypto = require('crypto');
const replayStore = require('./shadow-replay');

const AUDIENCE = 'shadow-btd-read-v1';
const ISSUER = 'btd';
const CONSENT_SUBJECT = 'user-consent';
const SERVICE_ISSUER = 'shadow';
const SERVICE_AUDIENCE = 'btd-shadow-service-v1';
const SERVICE_SUBJECT = 'shadow-service';
const PERMISSION = 'shadow.read';
const MAX_TTL_SEC = 300;
const FRESH_MS = 5 * 60 * 1000;
const FIELDS = ['ref', 'durum', 'adet', 'guncellendi', 'kaynak_id'];
const SOURCE_ID = 'btd-operasyon';
const ORDER_STATUSES = Object.freeze(['Onaylandı', 'Revize Edildi', 'Üretimde', 'Tamamlandı', 'İptal']);
const WORK_ORDER_STATUSES = Object.freeze(['Aktif', 'Tamamlandı', 'İptal Edildi']);
const TASK_STATUSES = Object.freeze(['Açık', 'Devam', 'Bitti', 'İptal']);
const OPEN_TASK_STATUSES = Object.freeze(['Açık', 'Devam']);
const ORDER_COLUMNS = Object.freeze(['id', 'durum', 'updated_at', 'teslim_tarihi']);
const WORK_ORDER_COLUMNS = Object.freeze(['id', 'durum', 'siparis_id', 'updated_at']);
const TASK_COLUMNS = Object.freeze(['id', 'durum', 'updated_at']);
const CLOSED_ORDER_STATUSES = Object.freeze(['Tamamlandı', 'İptal']);

function classifyFreshness({ permission, upstream, observedAt, now, clockTrusted }) {
  if (permission === false) return 'PERMISSION_DENIED';
  if (!upstream || upstream === 'down' || upstream === 'unconfigured') return 'UNAVAILABLE';
  if (!clockTrusted || observedAt == null || now == null) return 'UNKNOWN';
  const age = Number(now) - Number(observedAt);
  if (!Number.isFinite(age) || age < 0) return 'UNKNOWN';
  if (age > FRESH_MS) return 'STALE';
  return 'FRESH';
}

function projectFields(row) {
  const out = {};
  if (!row || typeof row !== 'object') return out;
  for (const key of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signClaims(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', String(secret)).update(body).digest();
  return { token: `${body}.${b64url(mac)}`, claims: payload };
}

function signUserConsent({ firmaId, secret, nowSec, ttlSec, jti }) {
  const ttl = Number(ttlSec);
  const now = Number(nowSec);
  const id = jti == null || jti === '' ? crypto.randomUUID() : String(jti);
  if (!firmaId || !secret) return null;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SEC) return null;
  if (!Number.isFinite(now)) return null;
  if (!id || id.length > 128 || /\s/.test(id)) return null;
  return signClaims({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: CONSENT_SUBJECT,
    firma_id: String(firmaId),
    perm: PERMISSION,
    jti: id,
    iat: now,
    exp: now + ttl,
  }, secret);
}

function resetReplay() {
  replayStore.resetMockReplay();
}

function jtiShape(value) {
  const jti = value == null ? '' : String(value);
  if (!jti || jti.length > 128 || /\s/.test(jti)) return '';
  return jti;
}

function releaseFor(replay, claims, sinif) {
  const input = {
    iss: claims.iss,
    jti: claims.jti,
    sinif,
    firmaId: claims.firma_id,
    exp: claims.exp,
    kv: claims.kv == null ? null : claims.kv,
  };
  return {
    async finish() {
      try {
        return await replay.complete(input);
      } catch {
        return { ok: false, reason: 'replay_unverified' };
      }
    },
    async cancel() {
      try {
        return await replay.rollback(input);
      } catch {
        return { ok: false, reason: 'replay_unverified' };
      }
    },
  };
}

async function consumeJti(replay, claims, sinif, nowSec) {
  if (!replay || typeof replay.consume !== 'function') return { ok: false, reason: 'replay_unverified' };
  let consumed;
  try {
    consumed = await replay.consume({
      iss: claims.iss,
      jti: claims.jti,
      sinif,
      firmaId: claims.firma_id,
      exp: claims.exp,
      nowSec,
      kv: claims.kv == null ? null : claims.kv,
    });
  } catch {
    return { ok: false, reason: 'replay_unverified' };
  }
  if (!consumed || consumed.ok !== true) {
    return { ok: false, reason: (consumed && consumed.reason) || 'replay_unverified' };
  }
  return { ok: true, reason: 'ok', ...releaseFor(replay, claims, sinif) };
}

function readSigned(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !secret) return { ok: false, reason: 'malformed' };
  const mac = crypto.createHmac('sha256', String(secret)).update(parts[0]).digest();
  let given;
  try {
    given = Buffer.from(parts[1], 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (given.length !== mac.length || !crypto.timingSafeEqual(given, mac)) {
    return { ok: false, reason: 'signature' };
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };
  return { ok: true, claims };
}

function checkLifetime(claims, nowSec) {
  const now = Number(nowSec);
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || !Number.isFinite(now)) {
    return { ok: false, reason: 'time' };
  }
  if (claims.exp - claims.iat < 1 || claims.exp - claims.iat > MAX_TTL_SEC || claims.exp <= now || claims.iat > now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

function inspectUserConsent(token, secret, nowSec, expectedFirmaId) {
  const read = readSigned(token, secret);
  if (!read.ok) return read;
  const claims = read.claims;
  if (claims.iss !== ISSUER) return { ok: false, reason: 'issuer' };
  if (claims.aud !== AUDIENCE) return { ok: false, reason: 'audience' };
  if (claims.perm !== PERMISSION) return { ok: false, reason: 'permission' };
  if (claims.sub !== CONSENT_SUBJECT) return { ok: false, reason: 'subject' };
  if (claims.use != null && claims.use !== 'once') return { ok: false, reason: 'sinif' };
  const life = checkLifetime(claims, nowSec);
  if (!life.ok) return life;
  if (!jtiShape(claims.jti)) return { ok: false, reason: 'jti' };
  if (expectedFirmaId && claims.firma_id !== expectedFirmaId) return { ok: false, reason: 'firma' };
  return { ok: true, claims };
}

async function verifyUserConsent(token, secret, nowSec, expectedFirmaId) {
  const preview = inspectUserConsent(token, secret, nowSec, expectedFirmaId);
  if (!preview.ok) return preview;
  const replay = replayStore.authoritativeReplay();
  if (!replay) return { ok: false, reason: 'replay_unverified' };
  const consumed = await consumeJti(replay, preview.claims, replayStore.SINGLE_USE, nowSec);
  if (!consumed.ok) return consumed;
  return { ok: true, claims: preview.claims, finish: consumed.finish, cancel: consumed.cancel };
}

function integerVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) return null;
  return version;
}

function serviceKeyRing(verifyKey, signingKey, options) {
  const opts = options || {};
  const currentSecret = String(verifyKey || '');
  const currentVersion = integerVersion(opts.keyVersion == null ? 1 : opts.keyVersion);
  if (!currentSecret || !currentVersion) return { ok: false, reason: 'malformed' };
  if (signingKey && sameSecret(currentSecret, signingKey)) return { ok: false, reason: 'key' };
  let previous = null;
  if (opts.previous && opts.previous.secret) {
    const previousVersion = integerVersion(opts.previous.version);
    if (!previousVersion || previousVersion === currentVersion) return { ok: false, reason: 'key' };
    if (signingKey && sameSecret(opts.previous.secret, signingKey)) return { ok: false, reason: 'key' };
    previous = { version: previousVersion, secret: String(opts.previous.secret) };
  }
  return { ok: true, current: { version: currentVersion, secret: currentSecret }, previous };
}

function secretForVersion(ring, version) {
  if (version === ring.current.version) return ring.current.secret;
  if (ring.previous && version === ring.previous.version) return ring.previous.secret;
  return '';
}

function serviceUse(claims) {
  if (claims.use == null || claims.use === 'read') return replayStore.REUSABLE;
  if (claims.use === 'once') return replayStore.SINGLE_USE;
  return '';
}

function inspectServiceIdentity(token, verifyKey, nowSec, expectedFirmaId, signingKey, options) {
  const ring = serviceKeyRing(verifyKey, signingKey, options);
  if (!ring.ok) return ring;
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  let unverified;
  try {
    unverified = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const version = integerVersion(unverified && unverified.kv);
  if (!version) return { ok: false, reason: 'key' };
  const secret = secretForVersion(ring, version);
  if (!secret) return { ok: false, reason: 'key' };
  const read = readSigned(token, secret);
  if (!read.ok) return read;
  const claims = read.claims;
  if (integerVersion(claims.kv) !== version) return { ok: false, reason: 'key' };
  if (claims.iss !== SERVICE_ISSUER) return { ok: false, reason: 'issuer' };
  if (claims.aud !== SERVICE_AUDIENCE) return { ok: false, reason: 'audience' };
  if (claims.perm !== PERMISSION) return { ok: false, reason: 'permission' };
  if (claims.sub !== SERVICE_SUBJECT) return { ok: false, reason: 'subject' };
  const sinif = serviceUse(claims);
  if (!sinif) return { ok: false, reason: 'sinif' };
  const life = checkLifetime(claims, nowSec);
  if (!life.ok) return life;
  if (!jtiShape(claims.jti)) return { ok: false, reason: 'jti' };
  if (expectedFirmaId && claims.firma_id !== expectedFirmaId) return { ok: false, reason: 'firma' };
  return { ok: true, claims, sinif };
}

async function verifyServiceIdentity(token, verifyKey, nowSec, expectedFirmaId, signingKey, options) {
  const preview = inspectServiceIdentity(token, verifyKey, nowSec, expectedFirmaId, signingKey, options);
  if (!preview.ok) return preview;
  const registry = replayStore.authoritativeRegistry();
  const replay = replayStore.authoritativeReplay();
  if (!registry || !replay) return { ok: false, reason: 'replay_unverified' };
  let decision;
  try {
    decision = await registry.authorize({
      servisKod: SERVICE_SUBJECT,
      firmaId: preview.claims.firma_id,
      scope: PERMISSION,
      kv: integerVersion(preview.claims.kv),
      nowSec,
    });
  } catch {
    return { ok: false, reason: 'replay_unverified' };
  }
  if (!decision || decision.ok !== true) {
    return { ok: false, reason: (decision && decision.reason) || 'replay_unverified' };
  }
  const consumed = await consumeJti(replay, preview.claims, preview.sinif, nowSec);
  if (!consumed.ok) return consumed;
  return {
    ok: true,
    claims: preview.claims,
    sinif: preview.sinif,
    finish: consumed.finish,
    cancel: consumed.cancel,
  };
}

function securityPrerequisite(kind) {
  const missing = [];
  if (!replayStore.authoritativeReplay()) missing.push('BTD_SHADOW_REPLAY_DATABASE_URL');
  if (kind === 'service' && !replayStore.authoritativeRegistry()) missing.push('BTD_SERVIS_KAYIT');
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

function stampOk(value) {
  if (value == null || value === '') return { ok: true, ms: null };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, ms };
}

function maxStamp(values) {
  let best = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const parsed = stampOk(value);
    if (!parsed.ok) return { ok: false };
    if (parsed.ms == null) continue;
    if (parsed.ms >= bestMs) {
      bestMs = parsed.ms;
      best = value;
    }
  }
  return { ok: true, value: best };
}

function summarizeOperational({ orders, workOrders, tasks, today }) {
  if (!Array.isArray(orders) || !Array.isArray(workOrders) || !Array.isArray(tasks)) {
    return { ok: false, reason: 'shape' };
  }
  const day = String(today || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, reason: 'today' };
  const stamps = [];
  const buckets = new Map();
  const ordersById = new Map();
  for (const row of orders) {
    if (!row || typeof row !== 'object' || !ORDER_STATUSES.includes(row.durum)) {
      return { ok: false, reason: 'status' };
    }
    const bucket = buckets.get(row.durum) || { adet: 0, stamps: [] };
    bucket.adet += 1;
    if (row.updated_at) bucket.stamps.push(row.updated_at);
    buckets.set(row.durum, bucket);
    if (row.updated_at) stamps.push(row.updated_at);
    if (row.id) ordersById.set(row.id, row);
  }
  const siparisOzet = [];
  for (const durum of ORDER_STATUSES) {
    const bucket = buckets.get(durum);
    if (!bucket || !bucket.adet) continue;
    const updated = maxStamp(bucket.stamps);
    if (!updated.ok) return { ok: false, reason: 'time' };
    siparisOzet.push({
      ref: 'siparisler',
      durum,
      adet: bucket.adet,
      guncellendi: updated.value,
      kaynak_id: 'siparisler',
    });
  }
  let geciken = 0;
  for (const row of workOrders) {
    if (!row || typeof row !== 'object' || !WORK_ORDER_STATUSES.includes(row.durum)) {
      return { ok: false, reason: 'status' };
    }
    if (row.updated_at) stamps.push(row.updated_at);
    if (row.durum !== 'Aktif' || !row.siparis_id) continue;
    const order = ordersById.get(row.siparis_id);
    if (!order || CLOSED_ORDER_STATUSES.includes(order.durum) || !order.teslim_tarihi) continue;
    const due = String(order.teslim_tarihi).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, reason: 'time' };
    if (due < day) geciken += 1;
  }
  let acikGorev = 0;
  for (const row of tasks) {
    if (!row || typeof row !== 'object' || !TASK_STATUSES.includes(row.durum)) {
      return { ok: false, reason: 'status' };
    }
    if (row.updated_at) stamps.push(row.updated_at);
    if (OPEN_TASK_STATUSES.includes(row.durum)) acikGorev += 1;
  }
  const updated = maxStamp(stamps);
  if (!updated.ok) return { ok: false, reason: 'time' };
  return {
    ok: true,
    data: {
      kaynak_id: SOURCE_ID,
      guncellendi: updated.value,
      siparis_ozet: siparisOzet,
      geciken_is_emri_adet: geciken,
      acik_gorev_adet: acikGorev,
    },
  };
}

function assertReadOnly(method) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return { ok: true, method: verb };
  return { ok: false, status: 405, error: 'yazma kapalı', freshness: 'PERMISSION_DENIED' };
}

module.exports = {
  AUDIENCE,
  ISSUER,
  CONSENT_SUBJECT,
  SERVICE_ISSUER,
  SERVICE_AUDIENCE,
  SERVICE_SUBJECT,
  PERMISSION,
  MAX_TTL_SEC,
  FRESH_MS,
  FIELDS,
  SOURCE_ID,
  ORDER_STATUSES,
  WORK_ORDER_STATUSES,
  TASK_STATUSES,
  OPEN_TASK_STATUSES,
  ORDER_COLUMNS,
  WORK_ORDER_COLUMNS,
  TASK_COLUMNS,
  classifyFreshness,
  projectFields,
  summarizeOperational,
  sameSecret,
  signUserConsent,
  inspectUserConsent,
  verifyUserConsent,
  inspectServiceIdentity,
  verifyServiceIdentity,
  securityPrerequisite,
  resetReplay,
  assertReadOnly,
  serviceKeyRing,
};
