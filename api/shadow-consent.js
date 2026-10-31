'use strict';

const { header, keysMatch, bearerToken, rateLimit, audit } = require('./_lib/guard');
const { resolveMembership, firmaAllowed } = require('./_lib/membership');
const { AUDIENCE, signUserConsent } = require('./_lib/shadow');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSENT_TTL_SEC = 120;

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function readConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const apiKey = String(process.env.BTD_API_KEY || '').trim();
  const signingKey = String(process.env.BTD_SHADOW_SIGNING_KEY || '').trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!apiKey) missing.push('BTD_API_KEY');
  if (!signingKey) missing.push('BTD_SHADOW_SIGNING_KEY');
  return { url, anonKey, apiKey, signingKey, missing };
}

function queryValue(req, name) {
  const raw = req.query ? req.query[name] : undefined;
  if (Array.isArray(raw)) return { error: `${name} bir kez verilmeli` };
  if (raw == null || raw === '') return { value: '' };
  return { value: String(raw).trim() };
}

async function handle(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    return send(res, 405, { contract: AUDIENCE, writes: false, error: 'yazma kapalı' });
  }
  const config = readConfig();
  if (config.missing.length) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: config.missing, writes: false });
  }
  if (!keysMatch(header(req, 'x-api-key'), config.apiKey)) {
    return send(res, 401, { error: 'yetkisiz', writes: false });
  }
  const limited = rateLimit(req);
  if (!limited.ok) return send(res, 429, { error: limited.error, writes: false });
  const accessToken = bearerToken(req);
  if (!accessToken) return send(res, 401, { error: 'yetkisiz', writes: false });

  const firma = queryValue(req, 'firma_id');
  if (firma.error || !UUID.test(firma.value)) {
    return send(res, 400, { error: 'firma_id uuid olmalı', writes: false });
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

  const nowSec = Math.floor(Date.now() / 1000);
  const signed = signUserConsent({
    firmaId: firma.value,
    secret: config.signingKey,
    nowSec,
    ttlSec: CONSENT_TTL_SEC,
  });
  if (!signed) return send(res, 503, { error: 'onay üretilemedi', writes: false });
  audit({
    event: 'shadow_consent',
    table: 'shadow',
    method,
    firmaId: firma.value,
    actor: membership.actor,
    status: 200,
  });
  return send(res, 200, {
    contract: AUDIENCE,
    writes: false,
    firma_id: firma.value,
    exp: signed.claims.exp,
    consent: signed.token,
  });
}

module.exports = handle;
module.exports.handle = handle;
