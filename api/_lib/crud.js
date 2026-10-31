'use strict';

const { header, keysMatch, bearerToken, rateLimit, publicError, audit } = require('./guard');
const { resolveMembership, firmaAllowed } = require('./membership');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLES = {
  musteriler: {
    requiredOnCreate: ['unvan'],
    fields: [
      'unvan', 'adres', 'telefon', 'vergi_no', 'vergi_dairesi', 'para_birimi',
      'odeme_vadesi', 'termin_gun', 'imalat_tipi', 'teklif_kosullari',
      'notify_whatsapp', 'notify_eposta',
    ],
  },
  siparisler: {
    requiredOnCreate: ['belge_no', 'musteri_unvan'],
    fields: [
      'belge_no', 'teklif_id', 'musteri_id', 'musteri_unvan', 'ilgili_kisi', 'po_no',
      'para_birimi', 'onay_tarihi', 'termin_gun', 'teslim_tarihi', 'kosullar',
      'durum', 'revizyon_no', 'beklenmeyen_toplam',
    ],
  },
  urunler: {
    requiredOnCreate: ['kod', 'ad'],
    fields: ['kod', 'ad', 'birim', 'birim_fiyat', 'para_birimi', 'aciklama', 'aktif'],
  },
  fasoncular: {
    requiredOnCreate: ['unvan'],
    fields: ['unvan', 'hizmet', 'iletisim', 'telefon', 'whatsapp', 'eposta', 'adres', 'aktif'],
  },
};

const UUID_FIELDS = new Set(['teklif_id', 'musteri_id']);
const REJECTED_KEYS = new Set([
  'sifre_hash', 'password', 'tc_no', 'tcNo', 'rol', 'role', 'is_god', 'isGod', 'tum_grup',
]);

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function readConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const apiKey = String(process.env.BTD_API_KEY || '').trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!apiKey) missing.push('BTD_API_KEY');
  return { url, anonKey, apiKey, missing };
}

function queryValue(req, name) {
  const raw = req.query ? req.query[name] : undefined;
  if (Array.isArray(raw)) return { error: `${name} bir kez verilmeli` };
  if (raw == null || raw === '') return { value: '' };
  return { value: String(raw).trim() };
}

function isScalar(value) {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function pick(body, spec, create) {
  for (const key of Object.keys(body)) {
    if (REJECTED_KEYS.has(key)) return { error: 'alan kabul edilmiyor' };
  }
  const row = {};
  for (const key of spec.fields) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (!isScalar(value)) return { error: `${key} geçersiz` };
    if (typeof value === 'string' && value.length > 2000) return { error: `${key} çok uzun` };
    if (UUID_FIELDS.has(key) && value !== null && (typeof value !== 'string' || !UUID.test(value))) {
      return { error: `${key} uuid olmalı` };
    }
    row[key] = value;
  }
  if (create) {
    for (const key of spec.requiredOnCreate) {
      if (typeof row[key] !== 'string' || !row[key].trim()) return { error: `${key} gerekli` };
    }
  } else if (!Object.keys(row).length) {
    return { error: 'güncellenecek alan yok' };
  }
  return { row };
}

function readJson(req) {
  const body = req.body;
  if (body == null || body === '') return { body: {} };
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'JSON nesne gerekli' };
      return { body: parsed };
    } catch {
      return { error: 'JSON gövde gerekli' };
    }
  }
  if (typeof body !== 'object' || Array.isArray(body)) return { error: 'JSON nesne gerekli' };
  return { body };
}

function selectList(spec) {
  return ['id', 'firma_id'].concat(spec.fields).join(',');
}

async function rest(config, accessToken, method, table, spec, { firmaId, id, row }) {
  const endpoint = new URL(`${config.url}/rest/v1/${table}`);
  endpoint.searchParams.set('firma_id', `eq.${firmaId}`);
  if (id) endpoint.searchParams.set('id', `eq.${id}`);
  if (method === 'GET') endpoint.searchParams.set('select', selectList(spec));
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (method !== 'GET') headers.Prefer = 'return=representation';
  if (row) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(row);
  }
  const response = await fetch(endpoint, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const message = payload && (payload.message || payload.error || payload.msg);
    return { ok: false, status: response.status, error: publicError(message) };
  }
  const rows = Array.isArray(payload) ? payload : [];
  return { ok: true, rows };
}

async function handle(req, res, table) {
  const spec = TABLES[table];
  if (!spec) return send(res, 404, { error: 'kaynak yok' });

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'yöntem desteklenmiyor' });
  }

  const config = readConfig();
  if (config.missing.length) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: config.missing });
  }
  if (!keysMatch(header(req, 'x-api-key'), config.apiKey)) {
    audit({ event: 'auth_denied', table, method, status: 401 });
    return send(res, 401, { error: 'yetkisiz' });
  }
  const limited = rateLimit(req);
  if (!limited.ok) {
    audit({ event: 'rate_limited', table, method, status: 429 });
    return send(res, 429, { error: limited.error });
  }

  const accessToken = bearerToken(req);
  if (!accessToken) {
    audit({ event: 'auth_denied', table, method, status: 401 });
    return send(res, 401, { error: 'yetkisiz' });
  }

  const firma = queryValue(req, 'firma_id');
  if (firma.error) return send(res, 400, { error: firma.error });
  if (!UUID.test(firma.value)) return send(res, 400, { error: 'firma_id uuid olmalı' });

  const idq = queryValue(req, 'id');
  if (idq.error) return send(res, 400, { error: idq.error });
  if (idq.value && !UUID.test(idq.value)) return send(res, 400, { error: 'id uuid olmalı' });

  let membership;
  try {
    membership = await resolveMembership(config, accessToken);
  } catch {
    audit({ event: 'auth_denied', table, method, firmaId: firma.value, status: 401 });
    return send(res, 401, { error: 'yetkisiz' });
  }
  if (membership.status !== 200) {
    audit({
      event: membership.status === 401 ? 'auth_denied' : 'tenant_denied',
      table,
      method,
      firmaId: firma.value,
      actor: membership.actor || '',
      status: membership.status,
    });
    return send(res, membership.status, { error: membership.error || 'erişim yok' });
  }
  if (!firmaAllowed(membership, firma.value)) {
    audit({
      event: 'tenant_denied',
      table,
      method,
      firmaId: firma.value,
      actor: membership.actor,
      status: 403,
    });
    return send(res, 403, { error: 'erişim yok' });
  }

  let row;
  if (method === 'POST' || method === 'PATCH') {
    const parsed = readJson(req);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    if (Object.prototype.hasOwnProperty.call(parsed.body, 'firma_id') && parsed.body.firma_id !== firma.value) {
      return send(res, 400, { error: 'firma_id gövde ile sorgu uyuşmuyor' });
    }
    const picked = pick(parsed.body, spec, method === 'POST');
    if (picked.error) return send(res, 400, { error: picked.error });
    row = picked.row;
    if (method === 'POST') row.firma_id = firma.value;
  }

  if ((method === 'PATCH' || method === 'DELETE') && !idq.value) {
    return send(res, 400, { error: 'id gerekli' });
  }

  const mutating = method === 'POST' || method === 'PATCH' || method === 'DELETE';
  if (mutating) {
    const wrote = await writeAudit(config, accessToken, {
      firma_id: firma.value,
      actor_auth_id: membership.actor,
      olay: 'yazma',
      kaynak: table,
      durum: method === 'POST' ? 201 : 200,
    });
    if (!wrote) {
      audit({ event: 'audit_failed', table, method, firmaId: firma.value, actor: membership.actor, status: 503 });
      return send(res, 503, { error: 'denetim yazılamadı' });
    }
  }

  let result;
  try {
    result = await rest(config, accessToken, method, table, spec, {
      firmaId: firma.value,
      id: method === 'POST' ? '' : idq.value,
      row: method === 'DELETE' || method === 'GET' ? null : row,
    });
  } catch {
    audit({ event: 'upstream', table, method, firmaId: firma.value, actor: membership.actor, status: 502 });
    return send(res, 502, { error: 'veritabanına ulaşılamadı' });
  }
  if (!result.ok) {
    audit({ event: 'upstream', table, method, firmaId: firma.value, actor: membership.actor, status: result.status });
    return send(res, result.status >= 400 && result.status < 600 ? result.status : 502, { error: result.error });
  }

  if (!mutating) {
    const wrote = await writeAudit(config, accessToken, {
      firma_id: firma.value,
      actor_auth_id: membership.actor,
      olay: 'okuma',
      kaynak: table,
      durum: 200,
    });
    if (!wrote) {
      audit({ event: 'audit_skip', table, method, firmaId: firma.value, actor: membership.actor, status: 200 });
    } else {
      audit({ event: 'ok', table, method, firmaId: firma.value, actor: membership.actor, status: 200 });
    }
  } else {
    audit({ event: 'ok', table, method, firmaId: firma.value, actor: membership.actor, status: method === 'POST' ? 201 : 200 });
  }

  if (method === 'GET' && !idq.value) return send(res, 200, { data: result.rows });
  const one = result.rows[0];
  if (!one) return send(res, 404, { error: 'kayıt yok' });
  return send(res, method === 'POST' ? 201 : 200, { data: one });
}

async function writeAudit(config, accessToken, row) {
  try {
    const response = await fetch(`${config.url}/rest/v1/denetim_olaylari`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { handle, TABLES, selectList };
