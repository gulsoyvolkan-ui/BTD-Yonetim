'use strict';

const crypto = require('crypto');

const AUDIENCE = 'shadow-btd-read-v1';
const ISSUER = 'btd';
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

function signIdentity({ sub, firmaId, secret, nowSec, ttlSec }) {
  const ttl = Number(ttlSec);
  const now = Number(nowSec);
  if (!sub || !firmaId || !secret) return null;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SEC) return null;
  if (!Number.isFinite(now)) return null;
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: String(sub),
    firma_id: String(firmaId),
    perm: PERMISSION,
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
  if (!claims || claims.iss !== ISSUER) return { ok: false, reason: 'issuer' };
  if (claims.aud !== AUDIENCE) return { ok: false, reason: 'audience' };
  if (claims.perm !== PERMISSION) return { ok: false, reason: 'permission' };
  if (!claims.sub || String(claims.sub).includes('.')) return { ok: false, reason: 'subject' };
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
  signIdentity,
  verifyIdentity,
  assertReadOnly,
};
