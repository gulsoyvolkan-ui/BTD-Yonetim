'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const shadow = require('./shadow');
const shadowRead = require('../shadow-read');
const { resetGuards } = require('./guard');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const SECRET = 'super-secret-value';
const PRICE = 'FIYATMARKER';
const TC = 'TCMARKER';
const root = path.join(__dirname, '..', '..');

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

function serviceToken(firmaId, opts = {}) {
  const nowSec = opts.nowSec == null ? Math.floor(Date.now() / 1000) : opts.nowSec;
  const signed = shadow.signIdentity({
    sub: opts.sub || 'shadow-reader',
    firmaId,
    secret: 'ornek-imza-anahtari',
    nowSec,
    ttlSec: opts.ttlSec || 120,
  });
  return signed && signed.token;
}

const orders = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    durum: 'Üretimde',
    updated_at: '2026-10-30T08:00:00Z',
    teslim_tarihi: '2020-01-01',
    birim_fiyat: PRICE,
    tc_no: TC,
    musteri_unvan: 'Gizli Unvan',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    durum: 'Tamamlandı',
    updated_at: '2026-10-29T08:00:00Z',
    teslim_tarihi: '2020-01-01',
  },
];
const workOrders = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    durum: 'Aktif',
    siparis_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    updated_at: '2026-10-30T09:00:00Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    durum: 'Aktif',
    siparis_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    updated_at: '2026-10-30T09:00:00Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    durum: 'Tamamlandı',
    siparis_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    updated_at: '2026-10-30T09:00:00Z',
  },
];
const tasks = [
  { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', durum: 'Açık', updated_at: '2026-10-30T10:00:00Z' },
  { id: '99999999-9999-4999-8999-999999999999', durum: 'Devam', updated_at: '2026-10-30T10:00:00Z' },
  { id: '88888888-8888-4888-8888-888888888888', durum: 'Bitti', updated_at: '2026-10-30T10:00:00Z' },
];

let mode = 'empty';
let memberFirms = [FIRMA];
const seen = [];

function rangeFor(rows) {
  if (mode === 'truncated') return '0-1/9';
  if (!rows.length) return '*/0';
  return `0-${rows.length - 1}/${rows.length}`;
}

function tableResponse(rows) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-range' ? rangeFor(rows) : '') },
    async text() { return JSON.stringify(rows); },
  };
}

function install() {
  global.fetch = async (url, opts) => {
    const href = String(url);
    seen.push({ url: href, opts, method: (opts && opts.method) || 'GET' });
    if (href.includes('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        async text() { return JSON.stringify({ id: ACTOR }); },
      };
    }
    if (href.includes('/rpc/btd_oturum_baglami')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        async text() {
          return JSON.stringify({
            kullanici_id: 'k1',
            firmalar: memberFirms.map((id) => ({ id, ad: 'Ornek' })),
          });
        },
      };
    }
    if (mode === 'down') throw new Error('upstream down');
    if (href.includes('/rest/v1/siparisler')) return tableResponse(mode === 'rows' || mode === 'truncated' || mode === 'bad-status' ? (mode === 'bad-status' ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', durum: 'Uydurma', updated_at: '2026-10-30T08:00:00Z', teslim_tarihi: '2020-01-01' }] : orders) : []);
    if (href.includes('/rest/v1/is_emirleri')) return tableResponse(mode === 'rows' ? workOrders : []);
    if (href.includes('/rest/v1/gorevler')) return tableResponse(mode === 'rows' ? tasks : []);
    throw new Error(`unexpected ${href}`);
  };
}

function headers(extra = {}) {
  return Object.assign({
    'x-api-key': 'gate',
    authorization: 'Bearer user-token',
    'x-btd-service-identity': serviceToken(FIRMA),
  }, extra);
}

async function call(method, query, extraHeaders) {
  resetGuards();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.BTD_API_KEY = 'gate';
  process.env.BTD_SHADOW_SIGNING_KEY = 'ornek-imza-anahtari';
  process.env.BTD_RATE_LIMIT = '500';
  process.env.SUPABASE_SECRET_KEY = SECRET;
  const res = mockRes();
  await shadowRead({
    method,
    query: query || { firma_id: FIRMA },
    headers: extraHeaders || headers(),
  }, res);
  return res;
}

function tableCalls() {
  return seen.filter((item) => /\/rest\/v1\/(siparisler|is_emirleri|gorevler)/.test(item.url));
}

async function main() {
  const summary = shadow.summarizeOperational({
    orders,
    workOrders,
    tasks,
    today: '2026-10-30',
  });
  ok(summary.ok && summary.data.geciken_is_emri_adet === 1, 'one overdue active work order');
  ok(summary.data.acik_gorev_adet === 2, 'open and in-progress tasks');
  ok(summary.data.siparis_ozet.length === 2, 'order summary by real status');
  ok(summary.data.kaynak_id === 'btd-operasyon', 'source id');
  ok(!JSON.stringify(summary.data).includes(PRICE) && !JSON.stringify(summary.data).includes(TC), 'summary drops price and tc');
  ok(!shadow.summarizeOperational({ orders: [{ durum: 'Uydurma' }], workOrders: [], tasks: [], today: '2026-10-30' }).ok, 'unknown status fails closed');

  install();
  seen.length = 0;
  mode = 'empty';
  let res = await call('POST');
  ok(res.statusCode === 405 && res.body.writes === false && res.body.freshness === 'PERMISSION_DENIED', '405 write');
  ok(seen.length === 0, '405 does not call upstream');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { authorization: 'Bearer user-token' });
  ok(res.statusCode === 401, '401 without api key');
  ok(seen.length === 0, 'missing key does not call upstream');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate' });
  ok(res.statusCode === 401, '401 api key alone');
  ok(seen.length === 0, 'api key alone does not read');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', authorization: 'Bearer user-token' });
  ok(res.statusCode === 401, '401 user bearer alone');

  const lone = serviceToken(FIRMA);
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-btd-service-identity': lone });
  ok(res.statusCode === 401, '401 service identity alone');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ authorization: `Bearer ${lone}`, 'x-btd-service-identity': lone }));
  ok(res.statusCode === 401, '401 identical user and service tokens');
  ok(seen.length === 0, 'identical tokens do not call upstream');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-service-identity': serviceToken(FIRMA, { nowSec: 1000 }) }));
  ok(res.statusCode === 401, '401 expired service identity');
  ok(seen.length === 0, 'expired identity does not read');

  const tampered = `${serviceToken(FIRMA)}x`;
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-service-identity': tampered }));
  ok(res.statusCode === 401, '401 invalid service identity');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-service-identity': serviceToken(OTHER) }));
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED', '403 cross-company service identity');
  ok(seen.length === 0, 'cross-company identity does not read');

  memberFirms = [OTHER];
  seen.length = 0;
  res = await call('GET');
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED', '403 membership firm mismatch');
  ok(tableCalls().length === 0, 'foreign membership does not read tables');
  memberFirms = [FIRMA];

  mode = 'empty';
  seen.length = 0;
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'FRESH' && res.body.writes === false, '200 empty is fresh');
  ok(res.body.data && res.body.data.siparis_ozet.length === 0, 'empty order summary');
  ok(res.body.data.geciken_is_emri_adet === 0 && res.body.data.acik_gorev_adet === 0, 'empty counts');
  ok(res.body.data.kaynak_id === 'btd-operasyon' && res.body.data.guncellendi === null, 'empty source and time');
  ok(res.body.identity.aud === 'shadow-btd-read-v1' && res.body.identity.iss === 'btd' && res.body.identity.perm === 'shadow.read', 'identity claims');
  ok(!res.body.identity.token, 'raw service token is not returned');
  ok(tableCalls().length === 3 && tableCalls().every((item) => item.method === 'GET'), 'three read-only gets');
  ok(tableCalls().every((item) => item.opts.headers.apikey === 'anon-key'), 'anon key not service role');
  ok(tableCalls().every((item) => item.opts.headers.Authorization === 'Bearer user-token'), 'user bearer stays distinct');
  ok(!JSON.stringify(tableCalls()).includes(SECRET), 'secret key is not sent');
  ok(!tableCalls().some((item) => String(item.opts.headers.Authorization).includes(serviceToken(FIRMA).slice(0, 12)) && item.opts.headers.Authorization === `Bearer ${headers()['x-btd-service-identity']}`), 'table call is not the service token');

  mode = 'rows';
  seen.length = 0;
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'FRESH', '200 operational read');
  ok(res.body.data.geciken_is_emri_adet === 1, 'http overdue count');
  ok(res.body.data.acik_gorev_adet === 2, 'http open task count');
  ok(res.body.data.siparis_ozet.some((row) => row.durum === 'Üretimde' && row.adet === 1 && row.kaynak_id === 'siparisler'), 'order summary row');
  const bodyText = JSON.stringify(res.body);
  ok(!bodyText.includes(PRICE) && !bodyText.includes(TC) && !bodyText.includes('Gizli Unvan'), 'response allowlist');
  ok(!bodyText.includes('teslim_tarihi') && !bodyText.includes('musteri_unvan'), 'due date and customer stay server-side');
  const orderUrl = new URL(tableCalls().find((item) => item.url.includes('siparisler')).url);
  ok(orderUrl.searchParams.get('select') === 'id,durum,updated_at,teslim_tarihi', 'order select allowlist');
  ok(orderUrl.searchParams.get('firma_id') === `eq.${FIRMA}`, 'order tenant filter');

  mode = 'bad-status';
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null, 'unknown status is unavailable');

  mode = 'truncated';
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null, 'truncated read fails closed');

  mode = 'down';
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null, 'upstream down is unavailable');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cloud = fs.readFileSync(path.join(root, 'js/btd-cloud.js'), 'utf8');
  ok(!html.includes('shadow-read') && !cloud.includes('shadow-read'), 'btd ui does not depend on shadow read');
  ok(typeof require('./crud').handle === 'function', 'existing crud module still loads');

  console.log(`shadow contract: ${calls} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
