'use strict';

const assert = require('assert');
const { handle, TABLES } = require('./crud');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function setEnv({ url = 'https://example.supabase.co', secret = 'secret-key', apiKey = 'gate' } = {}) {
  if (url) process.env.SUPABASE_URL = url;
  else delete process.env.SUPABASE_URL;
  if (secret) process.env.SUPABASE_SECRET_KEY = secret;
  else delete process.env.SUPABASE_SECRET_KEY;
  if (apiKey) process.env.BTD_API_KEY = apiKey;
  else delete process.env.BTD_API_KEY;
}

async function call(table, method, { query = {}, body, headers, env } = {}) {
  setEnv(env);
  const res = mockRes();
  await handle({
    method,
    query,
    body,
    headers: headers || { 'x-api-key': 'gate' },
  }, res, table);
  return res;
}

async function main() {
  const realFetch = global.fetch;
  let next = { status: 200, json: [{ id: ID, firma_id: FIRMA, unvan: 'ACME' }] };
  let seen = null;
  global.fetch = async (url, opts) => {
    seen = { url: String(url), opts };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      async text() {
        if (next.raw != null) return next.raw;
        return JSON.stringify(next.json);
      },
    };
  };

  try {
    let res = await call('musteriler', 'GET', { env: { url: '' } });
    ok(res.statusCode === 503 && res.body.missing.includes('SUPABASE_URL'), 'missing url');
    ok(seen === null, 'missing url does not call fetch');

    res = await call('musteriler', 'GET', { env: { secret: '' } });
    ok(res.statusCode === 503 && res.body.missing.includes('SUPABASE_SECRET_KEY'), 'missing secret');

    res = await call('musteriler', 'GET', { env: { apiKey: '' } });
    ok(res.statusCode === 503 && res.body.missing.includes('BTD_API_KEY'), 'missing gate');

    res = await call('musteriler', 'GET', { query: { firma_id: FIRMA }, headers: { 'X-Api-Key': 'nope' } });
    ok(res.statusCode === 401, 'bad key');
    ok(seen === null, 'bad key does not call fetch');

    res = await call('musteriler', 'GET', { query: {} });
    ok(res.statusCode === 400, 'firma required');

    res = await call('musteriler', 'GET', { query: { firma_id: 'not-a-uuid' } });
    ok(res.statusCode === 400, 'firma uuid');

    res = await call('musteriler', 'PUT', { query: { firma_id: FIRMA } });
    ok(res.statusCode === 405 && res.headers.Allow.includes('PATCH'), 'method');

    for (const table of Object.keys(TABLES)) {
      seen = null;
      next = { status: 200, json: [{ id: ID, firma_id: FIRMA }] };
      res = await call(table, 'GET', { query: { firma_id: FIRMA } });
      const url = new URL(seen.url);
      ok(res.statusCode === 200 && Array.isArray(res.body.data), `${table} list`);
      ok(url.pathname === `/rest/v1/${table}`, `${table} path`);
      ok(url.searchParams.get('firma_id') === `eq.${FIRMA}`, `${table} scope`);
      ok(url.searchParams.get('select') === '*', `${table} select`);
      ok(seen.opts.headers.apikey === 'secret-key', `${table} apikey`);
      ok(seen.opts.headers.Authorization === 'Bearer secret-key', `${table} bearer`);
      ok(!seen.opts.headers.Prefer, `${table} get has no write prefer`);
      ok(res.headers['Cache-Control'] === 'no-store', `${table} no-store`);
    }

    next = { status: 200, json: [] };
    res = await call('urunler', 'GET', { query: { firma_id: FIRMA, id: ID } });
    ok(res.statusCode === 404, 'missing one');
    ok(new URL(seen.url).searchParams.get('id') === `eq.${ID}`, 'id filter');

    seen = null;
    res = await call('musteriler', 'POST', {
      query: { firma_id: FIRMA },
      body: { firma_id: OTHER, unvan: 'ACME', ekstra: 'yok', id: ID },
    });
    ok(res.statusCode === 400 && seen === null, 'firma mismatch');

    next = { status: 201, json: [{ id: ID, firma_id: FIRMA, unvan: 'ACME' }] };
    res = await call('musteriler', 'POST', {
      query: { firma_id: FIRMA },
      body: JSON.stringify({ unvan: 'ACME', telefon: null, not_secret: 'x' }),
    });
    const created = JSON.parse(seen.opts.body);
    ok(res.statusCode === 201 && res.body.data.unvan === 'ACME', 'create');
    ok(created.firma_id === FIRMA && created.unvan === 'ACME' && created.telefon === null, 'create row');
    ok(!Object.prototype.hasOwnProperty.call(created, 'id'), 'create strips id');
    ok(!Object.prototype.hasOwnProperty.call(created, 'not_secret'), 'create strips unknown');
    ok(seen.opts.method === 'POST' && seen.opts.headers.Prefer === 'return=representation', 'create prefer');

    res = await call('siparisler', 'POST', { query: { firma_id: FIRMA }, body: { belge_no: 'S-1' } });
    ok(res.statusCode === 400, 'order needs customer');

    res = await call('fasoncular', 'POST', { query: { firma_id: FIRMA }, body: { unvan: 'Isil' } });
    ok(JSON.parse(seen.opts.body).unvan === 'Isil', 'subcontractor create');

    res = await call('urunler', 'POST', { query: { firma_id: FIRMA }, body: { kod: 'DV-1', ad: 'Parça', birim_fiyat: 12.5, aktif: true } });
    const product = JSON.parse(seen.opts.body);
    ok(product.kod === 'DV-1' && product.birim_fiyat === 12.5 && product.aktif === true, 'product fields');

    seen = null;
    res = await call('siparisler', 'PATCH', { query: { firma_id: FIRMA }, body: { durum: 'Üretimde' } });
    ok(res.statusCode === 400 && seen === null, 'patch needs id');

    res = await call('siparisler', 'PATCH', { query: { firma_id: FIRMA, id: ID }, body: {} });
    ok(res.statusCode === 400, 'patch needs fields');

    next = { status: 200, json: [{ id: ID, durum: 'Üretimde' }] };
    res = await call('siparisler', 'PATCH', {
      query: { firma_id: FIRMA, id: ID },
      body: { durum: 'Üretimde', firma_id: FIRMA, musteri_id: 'nope' },
    });
    ok(res.statusCode === 400, 'bad uuid field');

    res = await call('siparisler', 'PATCH', {
      query: { firma_id: FIRMA, id: ID },
      body: { durum: 'Üretimde', firma_id: FIRMA },
    });
    const patched = JSON.parse(seen.opts.body);
    const patchUrl = new URL(seen.url);
    ok(res.statusCode === 200 && patched.durum === 'Üretimde' && !patched.firma_id, 'patch body');
    ok(patchUrl.searchParams.get('firma_id') === `eq.${FIRMA}` && patchUrl.searchParams.get('id') === `eq.${ID}`, 'patch scope');

    seen = null;
    res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA } });
    ok(res.statusCode === 400 && seen === null, 'delete needs id');

    next = { status: 200, json: [] };
    res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA, id: ID } });
    ok(res.statusCode === 404, 'delete miss');

    next = { status: 200, json: [{ id: ID }] };
    res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA, id: ID } });
    ok(res.statusCode === 200 && seen.opts.method === 'DELETE' && !seen.opts.body, 'delete');

    next = { status: 409, json: { message: 'duplicate key value' } };
    res = await call('musteriler', 'POST', { query: { firma_id: FIRMA }, body: { unvan: 'ACME' } });
    ok(res.statusCode === 409 && res.body.error === 'duplicate key value', 'db error');
    ok(!JSON.stringify(res.body).includes('secret-key'), 'error hides key');

    next = { status: 500, raw: '<html>nope</html>' };
    res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
    ok(res.statusCode === 500 && res.body.error.includes('nope'), 'non json error');

    global.fetch = async () => { throw new Error('https://example.supabase.co/rest/v1/musteriler?apikey=secret-key'); };
    res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
    ok(res.statusCode === 502 && res.body.error === 'veritabanına ulaşılamadı', 'network');
    ok(!JSON.stringify(res.body).includes('secret-key'), 'network hides key');

    global.fetch = async (url, opts) => {
      seen = { url: String(url), opts };
      return { ok: true, status: 200, async text() { return JSON.stringify([{ id: ID, firma_id: FIRMA }]); } };
    };
    for (const name of Object.keys(TABLES)) {
      const fn = require(`../${name}`);
      ok(typeof fn === 'function', `${name} export`);
      const routed = mockRes();
      await fn({
        method: 'GET',
        query: { firma_id: FIRMA },
        headers: { 'x-api-key': 'gate' },
      }, routed);
      ok(routed.statusCode === 200 && new URL(seen.url).pathname === `/rest/v1/${name}`, `${name} route`);
    }

    console.log(`selfcheck: ${calls} passed`);
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.BTD_API_KEY;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
