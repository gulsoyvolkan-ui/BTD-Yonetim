'use strict';

const crypto = require('crypto');

const buckets = new Map();
const auditLog = [];

function header(req, name) {
  const headers = req.headers || {};
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  if (!key) return '';
  const value = headers[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function keysMatch(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const raw = header(req, 'authorization');
  const match = raw.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1].trim() : '';
}

function clientKey(req) {
  const fwd = header(req, 'x-forwarded-for').split(',')[0].trim();
  return fwd || header(req, 'x-real-ip') || 'local';
}

function limitPerMinute() {
  const n = Number(process.env.BTD_RATE_LIMIT || 120);
  if (!Number.isFinite(n) || n < 1) return 120;
  return Math.floor(n);
}

function rateLimit(req, now) {
  const key = clientKey(req);
  const windowMs = 60 * 1000;
  const stamp = Number.isFinite(now) ? now : Date.now();
  let bucket = buckets.get(key);
  if (!bucket || stamp - bucket.start >= windowMs) {
    bucket = { start: stamp, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limitPerMinute()) return { ok: false, status: 429, error: 'çok fazla istek' };
  return { ok: true };
}

function resetGuards() {
  buckets.clear();
  auditLog.length = 0;
}

function publicError(message) {
  return String(message || 'veritabanı hatası')
    .replace(/bearer\s+\S+/gi, 'bearer [gizli]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, '[gizli]')
    .slice(0, 180);
}

function audit(event) {
  const safe = {
    ts: new Date().toISOString(),
    event: String(event.event || 'ok').slice(0, 40),
    table: event.table ? String(event.table).slice(0, 40) : '',
    method: event.method ? String(event.method).slice(0, 8) : '',
    firma_id: event.firmaId || '',
    actor: event.actor || '',
    status: event.status || 0,
  };
  auditLog.push(safe);
  if (auditLog.length > 200) auditLog.shift();
  console.info('[btd-audit]', JSON.stringify(safe));
  return safe;
}

function recentAudits() {
  return auditLog.slice();
}

module.exports = {
  header,
  keysMatch,
  bearerToken,
  rateLimit,
  resetGuards,
  publicError,
  audit,
  recentAudits,
};
