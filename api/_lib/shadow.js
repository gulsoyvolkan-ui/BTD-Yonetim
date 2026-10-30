'use strict';

const crypto = require('crypto');

const AUDIENCE = 'shadow-btd-read-v1';
const MAX_TTL_SEC = 300;
const FRESH_MS = 5 * 60 * 1000;
const FIELDS = ['ref', 'durum', 'adet', 'guncellendi'];

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

function signIdentity({ sub, firmaId, secret, nowSec, ttlSec }) {
  const ttl = Number(ttlSec);
  const now = Number(nowSec);
  if (!sub || !firmaId || !secret) return null;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SEC) return null;
  if (!Number.isFinite(now)) return null;
  const payload = {
    aud: AUDIENCE,
    sub: String(sub),
    firma_id: String(firmaId),
    iat: now,
    exp: now + ttl,
  };
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', String(secret)).update(body).digest();
  return { token: `${body}.${b64url(mac)}`, claims: payload };
}

function verifyIdentity(token, secret, nowSec, expectedFirmaId) {
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
  if (!claims || claims.aud !== AUDIENCE) return { ok: false, reason: 'audience' };
  if (expectedFirmaId && claims.firma_id !== expectedFirmaId) return { ok: false, reason: 'firma' };
  const now = Number(nowSec);
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || !Number.isFinite(now)) {
    return { ok: false, reason: 'time' };
  }
  if (claims.exp - claims.iat > MAX_TTL_SEC || claims.exp <= now || claims.iat > now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claims };
}

function assertReadOnly(method) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return { ok: true, method: verb };
  return { ok: false, status: 405, error: 'yazma kapalı', freshness: 'PERMISSION_DENIED' };
}

module.exports = {
  AUDIENCE,
  MAX_TTL_SEC,
  FRESH_MS,
  FIELDS,
  classifyFreshness,
  projectFields,
  signIdentity,
  verifyIdentity,
  assertReadOnly,
};
