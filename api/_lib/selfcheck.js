'use strict';

const assert = require('assert');
const { handle, TABLES, selectList } = require('./crud');
const { resetGuards, recentAudits } = require('./guard');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ID = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'good-token';
const ANON = 'anon-key';
const SECRET = 'super-secret-value';

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

function setEnv(extra = {}) {
  process.env.SUPABASE_URL = extra.url === undefined ? 'https://example.supabase.co' : extra.url;
  process.env.SUPABASE_ANON_KEY = extra.anonKey === undefined ? ANON : extra.anonKey;
  process.env.BTD_API_KEY = extra.apiKey === undefined ? 'gate' : extra.apiKey;
  process.env.BTD_RATE_LIMIT = extra.rate === undefined ? '500' : String(extra.rate);
  process.env.SUPABASE_SECRET_KEY = SECRET;
  if (extra.url === '') delete process.env.SUPABASE_URL;
  if (extra.anonKey === '') delete process.env.SUPABASE_ANON_KEY;
  if (extra.apiKey === '') delete process.env.BTD_API_KEY;
}

function memberBody() {
  return { kullanici_id: ID, firmalar: [{ id: FIRMA, ad: 'Bluemac' }] };
}

let tableResponse = { status: 200, json: [{ id: ID, firma_id: FIRMA, unvan: 'ACME' }] };
let userStatus = 200;
const seen = [];

function installFetch() {
  global.fetch = async (url, opts) => {
    const href = String(url);
    seen.push({ url: href, opts });
    if (href.includes('/auth/v1/user')) {
      return {
        ok: userStatus === 200,
        status: userStatus,
        async text() { return JSON.stringify(userStatus === 200 ? { id: ACTOR } : { message: 'nope' }); },
      };
    }
    if (href.includes('/rpc/btd_oturum_baglami')) {
      return { ok: true, status: 200, async text() { return JSON.stringify(memberBody()); } };
    }
    if (href.includes('/denetim_olaylari')) {
      return { ok: true, status: 201, async text() { return ''; } };
    }
    return {
      ok: tableResponse.status >= 200 && tableResponse.status < 300,
      status: tableResponse.status,
      async text() {
        if (tableResponse.raw != null) return tableResponse.raw;
        return JSON.stringify(tableResponse.json);
      },
    };
  };
}

function tableCall() {
  return seen.filter((item) => /\/rest\/v1\/(musteriler|siparisler|urunler|fasoncular)\?/.test(item.url)).pop() || null;
}

async function call(table, method, { query = {}, body, headers, env } = {}) {
  setEnv(env || {});
  const res = mockRes();
  await handle({
    method,
    query,
    body,
    headers: headers || { 'x-api-key': 'gate', authorization: `Bearer ${TOKEN}` },
  }, res, table);
  return res;
}

function noSecret(value) {
  return !JSON.stringify(value).includes(SECRET) && !JSON.stringify(value).includes(TOKEN);
}

async function main() {
  resetGuards();
  installFetch();
  let res = await call('musteriler', 'GET', { env: { url: '' }, query: { firma_id: FIRMA } });
  ok(res.statusCode === 503 && res.body.missing.includes('SUPABASE_URL'), 'missing url');
  ok(seen.length === 0, 'missing url does not call fetch');

  seen.length = 0;
  res = await call('musteriler', 'GET', { env: { anonKey: '' }, query: { firma_id: FIRMA } });
  ok(res.statusCode === 503 && res.body.missing.includes('SUPABASE_ANON_KEY'), 'missing anon');

  seen.length = 0;
  res = await call('musteriler', 'GET', { env: { apiKey: '' }, query: { firma_id: FIRMA } });
  ok(res.statusCode === 503 && res.body.missing.includes('BTD_API_KEY'), 'missing gate');

  seen.length = 0;
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA }, headers: { 'X-Api-Key': 'nope', authorization: `Bearer ${TOKEN}` } });
  ok(res.statusCode === 401, 'bad key');
  ok(seen.length === 0, 'bad key does not call fetch');

  seen.length = 0;
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA }, headers: { 'x-api-key': 'gate' } });
  ok(res.statusCode === 401, 'missing bearer');
  ok(seen.length === 0, 'missing bearer does not call fetch');

  seen.length = 0;
  userStatus = 401;
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 401, 'bad bearer');
  ok(tableCall() === null, 'bad bearer does not read table');
  userStatus = 200;

  seen.length = 0;
  res = await call('musteriler', 'GET', { query: { firma_id: OTHER } });
  ok(res.statusCode === 403, 'foreign firma');
  ok(tableCall() === null, 'foreign firma does not read table');

  seen.length = 0;
  res = await call('musteriler', 'GET', { query: {} });
  ok(res.statusCode === 400, 'firma required');

  res = await call('musteriler', 'GET', { query: { firma_id: 'not-a-uuid' } });
  ok(res.statusCode === 400, 'firma uuid');

  res = await call('musteriler', 'PUT', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 405 && res.headers.Allow.includes('PATCH'), 'method');

  for (const table of Object.keys(TABLES)) {
    seen.length = 0;
    tableResponse = { status: 200, json: [{ id: ID, firma_id: FIRMA }] };
    res = await call(table, 'GET', { query: { firma_id: FIRMA } });
    const hit = tableCall();
    const url = new URL(hit.url);
    ok(res.statusCode === 200 && Array.isArray(res.body.data), `${table} list`);
    ok(url.pathname === `/rest/v1/${table}`, `${table} path`);
    ok(url.searchParams.get('firma_id') === `eq.${FIRMA}`, `${table} scope`);
    ok(url.searchParams.get('select') === selectList(TABLES[table]), `${table} select`);
    ok(url.searchParams.get('select') !== '*', `${table} not star`);
    ok(hit.opts.headers.apikey === ANON, `${table} anon key`);
    ok(hit.opts.headers.Authorization === `Bearer ${TOKEN}`, `${table} user bearer`);
    ok(!JSON.stringify(hit.opts.headers).includes(SECRET), `${table} no secret header`);
    ok(res.headers['Cache-Control'] === 'no-store', `${table} no-store`);
  }

  tableResponse = { status: 200, json: [] };
  res = await call('urunler', 'GET', { query: { firma_id: FIRMA, id: ID } });
  ok(res.statusCode === 404, 'missing one');
  ok(new URL(tableCall().url).searchParams.get('id') === `eq.${ID}`, 'id filter');

  seen.length = 0;
  res = await call('musteriler', 'POST', {
    query: { firma_id: FIRMA },
    body: { firma_id: OTHER, unvan: 'ACME', ekstra: 'yok', id: ID },
  });
  ok(res.statusCode === 400 && tableCall() === null, 'firma mismatch');

  res = await call('musteriler', 'POST', {
    query: { firma_id: FIRMA },
    body: { unvan: 'ACME', sifre_hash: 'x', rol: 'Yönetici' },
  });
  ok(res.statusCode === 400 && tableCall() === null, 'rejected secret field');

  tableResponse = { status: 201, json: [{ id: ID, firma_id: FIRMA, unvan: 'ACME' }] };
  res = await call('musteriler', 'POST', {
    query: { firma_id: FIRMA },
    body: JSON.stringify({ unvan: 'ACME', telefon: null, not_secret: 'x' }),
  });
  const created = JSON.parse(tableCall().opts.body);
  ok(res.statusCode === 201 && res.body.data.unvan === 'ACME', 'create');
  ok(created.firma_id === FIRMA && created.unvan === 'ACME' && created.telefon === null, 'create row');
  ok(!Object.prototype.hasOwnProperty.call(created, 'id'), 'create strips id');
  ok(!Object.prototype.hasOwnProperty.call(created, 'not_secret'), 'create strips unknown');

  res = await call('siparisler', 'POST', { query: { firma_id: FIRMA }, body: { belge_no: 'S-1' } });
  ok(res.statusCode === 400, 'order needs customer');

  res = await call('fasoncular', 'POST', { query: { firma_id: FIRMA }, body: { unvan: 'Isil' } });
  ok(JSON.parse(tableCall().opts.body).unvan === 'Isil', 'subcontractor create');

  res = await call('urunler', 'POST', { query: { firma_id: FIRMA }, body: { kod: 'DV-1', ad: 'Parça', birim_fiyat: 12.5, aktif: true } });
  const product = JSON.parse(tableCall().opts.body);
  ok(product.kod === 'DV-1' && product.birim_fiyat === 12.5 && product.aktif === true, 'product fields');

  seen.length = 0;
  res = await call('siparisler', 'PATCH', { query: { firma_id: FIRMA }, body: { durum: 'Üretimde' } });
  ok(res.statusCode === 400 && tableCall() === null, 'patch needs id');

  res = await call('siparisler', 'PATCH', { query: { firma_id: FIRMA, id: ID }, body: {} });
  ok(res.statusCode === 400, 'patch needs fields');

  res = await call('siparisler', 'PATCH', {
    query: { firma_id: FIRMA, id: ID },
    body: { durum: 'Üretimde', firma_id: FIRMA, musteri_id: 'nope' },
  });
  ok(res.statusCode === 400, 'bad uuid field');

  tableResponse = { status: 200, json: [{ id: ID, durum: 'Üretimde' }] };
  res = await call('siparisler', 'PATCH', {
    query: { firma_id: FIRMA, id: ID },
    body: { durum: 'Üretimde', firma_id: FIRMA },
  });
  const patched = JSON.parse(tableCall().opts.body);
  const patchUrl = new URL(tableCall().url);
  ok(res.statusCode === 200 && patched.durum === 'Üretimde' && !patched.firma_id, 'patch body');
  ok(patchUrl.searchParams.get('firma_id') === `eq.${FIRMA}` && patchUrl.searchParams.get('id') === `eq.${ID}`, 'patch scope');

  seen.length = 0;
  res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 400 && tableCall() === null, 'delete needs id');

  tableResponse = { status: 200, json: [] };
  res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA, id: ID } });
  ok(res.statusCode === 404, 'delete miss');

  tableResponse = { status: 200, json: [{ id: ID }] };
  res = await call('fasoncular', 'DELETE', { query: { firma_id: FIRMA, id: ID } });
  ok(res.statusCode === 200 && tableCall().opts.method === 'DELETE' && !tableCall().opts.body, 'delete');

  tableResponse = { status: 409, json: { message: 'duplicate key value' } };
  res = await call('musteriler', 'POST', { query: { firma_id: FIRMA }, body: { unvan: 'ACME' } });
  ok(res.statusCode === 409 && res.body.error === 'duplicate key value', 'db error');
  ok(noSecret(res.body), 'error hides secrets');

  tableResponse = { status: 500, raw: '<html>nope</html>' };
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 500 && res.body.error.includes('nope'), 'non json error');

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/auth/v1/user')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ id: ACTOR }); } };
    }
    if (href.includes('/rpc/btd_oturum_baglami')) {
      return { ok: true, status: 200, async text() { return JSON.stringify(memberBody()); } };
    }
    throw new Error(`https://example.supabase.co/rest/v1/musteriler?apikey=${SECRET}`);
  };
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 502 && res.body.error === 'veritabanına ulaşılamadı', 'network');
  ok(noSecret(res.body), 'network hides secret');

  installFetch();
  tableResponse = { status: 200, json: [{ id: ID, firma_id: FIRMA }] };
  for (const name of Object.keys(TABLES)) {
    const fn = require(`../${name}`);
    ok(typeof fn === 'function', `${name} export`);
    const routed = mockRes();
    seen.length = 0;
    await fn({
      method: 'GET',
      query: { firma_id: FIRMA },
      headers: { 'x-api-key': 'gate', authorization: `Bearer ${TOKEN}` },
    }, routed);
    ok(routed.statusCode === 200 && new URL(tableCall().url).pathname === `/rest/v1/${name}`, `${name} route`);
  }

  seen.length = 0;
  global.fetch = async (url) => {
    const href = String(url);
    seen.push({ url: href });
    if (href.includes('/auth/v1/user')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ id: ACTOR }); } };
    }
    if (href.includes('/rpc/btd_oturum_baglami')) {
      return { ok: true, status: 200, async text() { return JSON.stringify(memberBody()); } };
    }
    if (href.includes('/denetim_olaylari')) {
      return { ok: false, status: 500, async text() { return JSON.stringify({ message: 'audit down' }); } };
    }
    return { ok: true, status: 201, async text() { return JSON.stringify([{ id: ID, firma_id: FIRMA, unvan: 'ACME' }]); } };
  };
  res = await call('musteriler', 'POST', { query: { firma_id: FIRMA }, body: { unvan: 'ACME' } });
  ok(res.statusCode === 503 && res.body.error === 'denetim yazılamadı', 'audit failure blocks write');
  ok(tableCall() === null, 'audit failure does not write the table');
  seen.length = 0;
  res = await call('musteriler', 'GET', { query: { firma_id: FIRMA } });
  ok(res.statusCode === 200 && Array.isArray(res.body.data), 'read survives audit failure');
  installFetch();

  resetGuards();
  seen.length = 0;
  const limitedHeaders = { 'x-api-key': 'gate', authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': '203.0.113.9' };
  await call('musteriler', 'GET', { env: { rate: '2' }, query: { firma_id: FIRMA }, headers: limitedHeaders });
  await call('musteriler', 'GET', { env: { rate: '2' }, query: { firma_id: FIRMA }, headers: limitedHeaders });
  res = await call('musteriler', 'GET', { env: { rate: '2' }, query: { firma_id: FIRMA }, headers: limitedHeaders });
  ok(res.statusCode === 429, 'rate limit');

  const leaked = recentAudits().some((row) => JSON.stringify(row).includes(SECRET) || JSON.stringify(row).includes(TOKEN));
  ok(!leaked, 'audit has no secrets');

  console.log(`selfcheck: ${calls} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.BTD_API_KEY;
  delete process.env.BTD_RATE_LIMIT;
  delete process.env.SUPABASE_SECRET_KEY;
});
