'use strict';

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

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function header(req, name) {
  const headers = req.headers || {};
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  if (!key) return '';
  const value = headers[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function readConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  return { url, anonKey, missing };
}

function tokenRole(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return json && typeof json.role === 'string' ? json.role : '';
  } catch {
    return '';
  }
}

function userToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(header(req, 'authorization'));
  return match ? match[1] : '';
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
  const row = {};
  for (const key of spec.fields) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (!isScalar(value)) return { error: `${key} geçersiz` };
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

async function rest(config, token, method, table, { firmaId, id, row }) {
  const endpoint = new URL(`${config.url}/rest/v1/${table}`);
  endpoint.searchParams.set('firma_id', `eq.${firmaId}`);
  if (id) endpoint.searchParams.set('id', `eq.${id}`);
  if (method === 'GET') endpoint.searchParams.set('select', '*');
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
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
      payload = { message: text.slice(0, 400) };
    }
  }
  if (!response.ok) {
    const message = payload && (payload.message || payload.error || payload.msg);
    return {
      ok: false,
      status: response.status,
      error: String(message || 'veritabanı hatası').slice(0, 400),
    };
  }
  const rows = Array.isArray(payload) ? payload : [];
  return { ok: true, rows };
}

async function handle(req, res, table) {
  const spec = TABLES[table];
  if (!spec) return send(res, 404, { error: 'kaynak yok' });

  const config = readConfig();
  if (config.missing.length) {
    return send(res, 503, { error: 'ortam değişkeni eksik', missing: config.missing });
  }
  const token = userToken(req);
  if (!token || tokenRole(token) !== 'authenticated') {
    return send(res, 401, { error: 'yetkisiz' });
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return send(res, 405, { error: 'yöntem desteklenmiyor' });
  }

  const firma = queryValue(req, 'firma_id');
  if (firma.error) return send(res, 400, { error: firma.error });
  if (!UUID.test(firma.value)) return send(res, 400, { error: 'firma_id uuid olmalı' });

  const idq = queryValue(req, 'id');
  if (idq.error) return send(res, 400, { error: idq.error });
  if (idq.value && !UUID.test(idq.value)) return send(res, 400, { error: 'id uuid olmalı' });

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

  let result;
  try {
    result = await rest(config, token, method, table, {
      firmaId: firma.value,
      id: method === 'POST' ? '' : idq.value,
      row: method === 'DELETE' || method === 'GET' ? null : row,
    });
  } catch {
    return send(res, 502, { error: 'veritabanına ulaşılamadı' });
  }
  if (!result.ok) return send(res, result.status, { error: result.error });

  if (method === 'GET' && !idq.value) return send(res, 200, { data: result.rows });
  const one = result.rows[0];
  if (!one) return send(res, 404, { error: 'kayıt yok' });
  return send(res, method === 'POST' ? 201 : 200, { data: one });
}

module.exports = { handle, TABLES };
