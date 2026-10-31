'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const shadow = require('./shadow');
const replayLib = require('./shadow-replay');
const shadowRead = require('../shadow-read');
const shadowConsent = require('../shadow-consent');
const health = require('../health');
const { resetGuards } = require('./guard');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const SECRET = 'super-secret-value';
const SIGNING = 'ornek-imza-anahtari';
const VERIFY = 'ornek-dogrulama-anahtari';
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

function consentToken(firmaId, opts = {}) {
  const nowSec = opts.nowSec == null ? Math.floor(Date.now() / 1000) : opts.nowSec;
  const signed = shadow.signUserConsent({
    firmaId,
    secret: opts.secret || SIGNING,
    nowSec,
    ttlSec: opts.ttlSec || 120,
    jti: opts.jti,
  });
  return signed && signed.token;
}

function serviceToken(firmaId, opts = {}) {
  const nowSec = opts.nowSec == null ? Math.floor(Date.now() / 1000) : opts.nowSec;
  const ttl = opts.ttlSec == null ? 120 : opts.ttlSec;
  const payload = Object.assign({
    iss: 'shadow',
    aud: 'btd-shadow-service-v1',
    sub: 'shadow-service',
    firma_id: String(firmaId),
    perm: 'shadow.read',
    jti: opts.jti || crypto.randomUUID(),
    kv: opts.kv == null ? 1 : opts.kv,
    iat: nowSec,
    exp: nowSec + ttl,
  }, opts.claims || {});
  if (opts.use) payload.use = opts.use;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', opts.secret || VERIFY).update(body).digest('base64url');
  return `${body}.${mac}`;
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
    'x-btd-user-consent': consentToken(FIRMA),
  }, extra);
}

function applyEnv(opts = {}) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.BTD_API_KEY = 'gate';
  process.env.BTD_SHADOW_SIGNING_KEY = opts.signingKey === undefined ? SIGNING : opts.signingKey;
  process.env.BTD_SHADOW_SERVICE_VERIFY_KEY = opts.verifyKey === undefined ? VERIFY : opts.verifyKey;
  process.env.BTD_SHADOW_SERVICE_KEY_VERSION = opts.keyVersion == null ? '1' : String(opts.keyVersion);
  process.env.BTD_RATE_LIMIT = '500';
  process.env.SUPABASE_SECRET_KEY = SECRET;
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  delete process.env.BTD_SHADOW_REPLAY_DATABASE_URL;
  delete process.env.BTD_SHADOW_READER_DATABASE_URL;
  delete process.env.BTD_SHADOW_DB_TARGET;
  delete process.env.BTD_SHADOW_STAGING_HOST_ALLOWLIST;
  delete process.env.BTD_SHADOW_SERVICE_VERIFY_KEY_PREV;
  delete process.env.BTD_SHADOW_SERVICE_KEY_VERSION_PREV;
  if (opts.signingKey === '') delete process.env.BTD_SHADOW_SIGNING_KEY;
  if (opts.verifyKey === '') delete process.env.BTD_SHADOW_SERVICE_VERIFY_KEY;
  if (opts.previousKey) {
    process.env.BTD_SHADOW_SERVICE_VERIFY_KEY_PREV = opts.previousKey;
    process.env.BTD_SHADOW_SERVICE_KEY_VERSION_PREV = String(opts.previousVersion);
  }
  if (opts.replayUrl) process.env.BTD_SHADOW_REPLAY_DATABASE_URL = opts.replayUrl;
  if (opts.readerUrl) process.env.BTD_SHADOW_READER_DATABASE_URL = opts.readerUrl;
  if (opts.noMock) delete process.env.BTD_SHADOW_REPLAY_MOCK;
}

async function call(method, query, extraHeaders, opts = {}) {
  resetGuards();
  applyEnv(opts);
  if (opts.detach || opts.noMock) {
    replayLib.detachSecurity();
  } else {
    if (!opts.keepReplay) shadow.resetReplay();
    if (opts.registry) replayLib.setMockRegistry(opts.registry);
    else if (!replayLib.getRegistry()) replayLib.setMockRegistry({ firms: [FIRMA], keyVersion: 1 });
  }
  const res = mockRes();
  await shadowRead({
    method,
    query: query || { firma_id: FIRMA },
    headers: extraHeaders || headers(),
  }, res);
  return res;
}

async function consentCall(query, extraHeaders, opts = {}) {
  resetGuards();
  applyEnv(opts);
  const res = mockRes();
  await shadowConsent({
    method: opts.method || 'POST',
    query: query || { firma_id: FIRMA },
    headers: extraHeaders || { 'x-api-key': 'gate', authorization: 'Bearer user-token' },
  }, res);
  return res;
}

function tableCalls() {
  return seen.filter((item) => /\/rest\/v1\/(siparisler|is_emirleri|gorevler)/.test(item.url));
}

async function main() {
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  replayLib.useMockHarness({ firms: [FIRMA], keyVersion: 1 });
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

  shadow.resetReplay();
  const minted = shadow.signUserConsent({ firmaId: FIRMA, secret: SIGNING, nowSec: 1000, ttlSec: 120, jti: 'consent-1' });
  ok(minted.claims.iss === 'btd' && minted.claims.sub === 'user-consent' && minted.claims.jti === 'consent-1', 'btd mints user consent');
  ok(minted.claims.aud === 'shadow-btd-read-v1' && minted.claims.exp - minted.claims.iat === 120, 'consent lifetime');
  ok(shadow.signUserConsent({ firmaId: FIRMA, secret: SIGNING, nowSec: 1000, ttlSec: 301 }) === null, 'consent ttl cap');
  ok((await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA)).ok, 'mock consent verifies with signing key');
  ok((await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA)).reason === 'replay', 'mock consent jti replay');
  ok(!(await shadow.verifyUserConsent(minted.token, VERIFY, 1100, FIRMA)).ok, 'verify key cannot mint consent');
  shadow.resetReplay();
  ok((await shadow.verifyUserConsent(minted.token, SIGNING, 2000, FIRMA)).reason === 'expired', 'consent expiry');
  const shadowSignedConsent = serviceToken(FIRMA, { secret: VERIFY, claims: { iss: 'btd', aud: 'shadow-btd-read-v1', sub: 'user-consent' } });
  ok((await shadow.verifyUserConsent(shadowSignedConsent, SIGNING, Math.floor(Date.now() / 1000), FIRMA)).reason === 'signature', 'shadow signature is not a btd consent');

  shadow.resetReplay();
  const rolled = await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA);
  ok(rolled.ok, 'mock single-use consume');
  ok((await rolled.cancel()).reason === 'ok', 'mock rollback');
  const rolledAgain = await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA);
  ok(rolledAgain.ok, 'mock rollback allows one later success');
  await rolledAgain.finish();
  ok((await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA)).reason === 'replay', 'mock completed jti stays consumed');
  ok((await rolledAgain.cancel()).reason === 'committed', 'mock rollback does not reopen a completed jti');

  shadow.resetReplay();
  const service = serviceToken(FIRMA, { jti: 'svc-1', nowSec: 1000 });
  ok((await shadow.verifyServiceIdentity(service, VERIFY, 1100, FIRMA, SIGNING)).ok, 'mock service identity verifies with the other key');
  ok((await shadow.verifyServiceIdentity(service, VERIFY, 1100, FIRMA, SIGNING)).ok, 'mock reusable service read repeats');
  const once = serviceToken(FIRMA, { jti: 'svc-once-unit', nowSec: 1000, use: 'once' });
  ok((await shadow.verifyServiceIdentity(once, VERIFY, 1100, FIRMA, SIGNING)).ok, 'mock single-use service token');
  ok((await shadow.verifyServiceIdentity(once, VERIFY, 1100, FIRMA, SIGNING)).reason === 'replay', 'mock single-use service replay');
  shadow.resetReplay();
  ok((await shadow.verifyServiceIdentity(service, VERIFY, 2000, FIRMA, SIGNING)).reason === 'expired', 'service expiry');
  ok((await shadow.verifyServiceIdentity(service, SIGNING, 1100, FIRMA, SIGNING)).reason === 'key', 'signing key is not the service verifier');
  ok((await shadow.verifyServiceIdentity(serviceToken(FIRMA, { secret: SIGNING }), VERIFY, Math.floor(Date.now() / 1000), FIRMA, SIGNING)).reason === 'signature', 'btd signing key does not authenticate shadow');
  const btdOnServiceHeader = serviceToken(FIRMA, { claims: { iss: 'btd', sub: 'shadow-reader', aud: 'shadow-btd-read-v1' } });
  ok((await shadow.verifyServiceIdentity(btdOnServiceHeader, VERIFY, Math.floor(Date.now() / 1000), FIRMA, SIGNING)).reason === 'issuer', 'service header rejects iss=btd');
  ok(typeof shadow.signServiceIdentity !== 'function' && typeof shadow.signIdentity !== 'function', 'btd does not sign for shadow');
  delete process.env.BTD_SHADOW_REPLAY_MOCK;
  replayLib.detachSecurity();
  ok((await shadow.verifyUserConsent(minted.token, SIGNING, 1100, FIRMA)).reason === 'replay_unverified', 'missing replay store fails closed');
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  replayLib.useMockHarness({ firms: [FIRMA], keyVersion: 1 });
  const raceToken = consentToken(FIRMA, { jti: 'race', nowSec: 1000 });
  const race = await Promise.all([
    shadow.verifyUserConsent(raceToken, SIGNING, 1100, FIRMA),
    shadow.verifyUserConsent(raceToken, SIGNING, 1100, FIRMA),
  ]);
  ok(race.filter((item) => item.ok).length === 1, 'mock single-use race allows one success');

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

  const lone = consentToken(FIRMA);
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-btd-user-consent': lone });
  ok(res.statusCode === 401, '401 consent without user bearer');
  ok(seen.length === 0, 'consent without bearer does not read');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ authorization: `Bearer ${lone}`, 'x-btd-user-consent': lone }));
  ok(res.statusCode === 401, '401 identical user and consent tokens');
  ok(seen.length === 0, 'identical tokens do not call upstream');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': consentToken(FIRMA, { nowSec: 1000 }) }));
  ok(res.statusCode === 401, '401 expired consent');
  ok(seen.length === 0, 'expired consent does not read');

  const tampered = `${consentToken(FIRMA)}x`;
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': tampered }));
  ok(res.statusCode === 401, '401 invalid consent');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': consentToken(OTHER) }));
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED', '403 cross-company consent');
  ok(seen.length === 0, 'cross-company consent does not read');

  const replayConsent = consentToken(FIRMA, { jti: 'once' });
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': replayConsent }));
  ok(res.statusCode === 200, 'first consent presentation reads');
  const afterFirst = tableCalls().length;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': replayConsent }), { keepReplay: true });
  ok(res.statusCode === 401 && res.body.error === 'kimlik doğrulanamadı', 'replayed consent is rejected');
  ok(tableCalls().length === afterFirst, 'replay does not read again');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-service-identity': consentToken(FIRMA) }));
  ok(res.statusCode === 401, 'legacy iss=btd service header is rejected');
  ok(seen.length === 0, 'legacy header does not read');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-shadow-service-identity': serviceToken(FIRMA) }));
  ok(res.statusCode === 401, 'both identity headers are rejected');
  ok(seen.length === 0, 'mixed identities do not read');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    authorization: 'Bearer user-token',
    'x-shadow-service-identity': serviceToken(FIRMA),
  });
  ok(res.statusCode === 401 && seen.length === 0, 'service identity with a user bearer is rejected');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA) });
  ok(res.statusCode === 200 && res.body.data === null && res.body.freshness === 'UNAVAILABLE' && res.body.read === 'BLOCKED', 'verified service read is blocked without a reader role');
  ok(!Object.prototype.hasOwnProperty.call(res.body, 'error') && res.body.businessError !== true, 'service unavailable is not a business error');
  ok(res.body.identity.iss === 'shadow' && res.body.identity.aud === 'btd-shadow-service-v1', 'service identity claims');
  ok(seen.length === 0, 'service identity does not query tables');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(OTHER) });
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED' && seen.length === 0, '403 cross-company service identity');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA, { nowSec: 1000 }) });
  ok(res.statusCode === 401 && seen.length === 0, '401 expired service identity');

  const replayService = serviceToken(FIRMA, { jti: 'svc-repeat' });
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': replayService });
  ok(res.statusCode === 200 && res.body.read === 'BLOCKED' && res.body.data === null, 'first service presentation verifies');
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': replayService }, { keepReplay: true });
  ok(res.statusCode === 200 && res.body.data === null && res.body.read === 'BLOCKED', 'reusable service jti does not invent a second total');
  const onceService = serviceToken(FIRMA, { jti: 'svc-http-once', use: 'once' });
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': onceService });
  ok(res.statusCode === 200, 'single-use service presentation verifies');
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': onceService }, { keepReplay: true });
  ok(res.statusCode === 401, 'replayed single-use service jti is rejected');
  const revoked = serviceToken(FIRMA, { jti: 'svc-revoke' });
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': revoked });
  ok(res.statusCode === 200, 'service token before revocation');
  await replayLib.getReplayStore().revoke({ iss: 'shadow', jti: 'svc-revoke', nowSec: Math.floor(Date.now() / 1000) });
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': revoked }, { keepReplay: true });
  ok(res.statusCode === 401, 'revoked reusable service jti is rejected');
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA) }, {
    registry: { firms: [OTHER], keyVersion: 1 },
  });
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED' && seen.length === 0, 'registry firm wins over the signed claim');
  const previous = serviceToken(FIRMA, { secret: 'onceki-ornek-anahtar', kv: 1 });
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': previous }, {
    keyVersion: 2,
    previousKey: 'onceki-ornek-anahtar',
    previousVersion: 1,
    registry: { firms: [FIRMA], keyVersion: 2, previousKeyVersion: 1 },
  });
  ok(res.statusCode === 200 && res.body.read === 'BLOCKED', 'previous key version still verifies during rotation');
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': previous }, {
    keyVersion: 2,
    registry: { firms: [FIRMA], keyVersion: 2 },
  });
  ok(res.statusCode === 401 && seen.length === 0, 'retired key version is rejected');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA, { secret: SIGNING }) });
  ok(res.statusCode === 401 && seen.length === 0, 'service token signed with the btd key is rejected');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA) }, { verifyKey: SIGNING });
  ok(res.statusCode === 401 && seen.length === 0, 'equal signing and verify keys are rejected');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(FIRMA) }, { verifyKey: '' });
  ok(res.statusCode === 503 && res.body.missing.indexOf('BTD_SHADOW_SERVICE_VERIFY_KEY') !== -1 && seen.length === 0, 'missing verify key does not read');

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
  ok(!res.body.identity.token, 'raw consent token is not returned');
  ok(!Object.prototype.hasOwnProperty.call(res.body, 'error') && res.body.businessError !== true, 'empty data is not a business error');
  ok(tableCalls().length === 3 && tableCalls().every((item) => item.method === 'GET'), 'three read-only gets');
  ok(tableCalls().every((item) => item.opts.headers.apikey === 'anon-key'), 'anon key not service role');
  ok(tableCalls().every((item) => item.opts.headers.Authorization === 'Bearer user-token'), 'user bearer stays distinct');
  ok(!JSON.stringify(tableCalls()).includes(SECRET), 'secret key is not sent');
  ok(tableCalls().every((item) => item.opts.headers.Authorization === 'Bearer user-token'), 'table call is the user bearer');

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
  ok(!Object.prototype.hasOwnProperty.call(res.body, 'error'), 'unknown status is not a business error');

  mode = 'truncated';
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null, 'truncated read fails closed');

  mode = 'down';
  res = await call('GET');
  ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null, 'upstream down is unavailable');
  ok(!Object.prototype.hasOwnProperty.call(res.body, 'error') && res.body.businessError !== true, 'upstream down is not a business error');

  mode = 'empty';
  memberFirms = [OTHER];
  seen.length = 0;
  const foreignMint = await consentCall();
  ok(foreignMint.statusCode === 403 && foreignMint.body.freshness === 'PERMISSION_DENIED' && !foreignMint.body.consent, 'non-member cannot mint consent');
  ok(!seen.some((item) => /\/rest\/v1\/(siparisler|is_emirleri|gorevler)/.test(item.url)), 'non-member mint does not read tables');
  memberFirms = [FIRMA];
  seen.length = 0;
  const mintedHttp = await consentCall();
  ok(mintedHttp.statusCode === 200 && mintedHttp.body.consent && mintedHttp.body.writes === false, 'member mints consent');
  ok(!JSON.stringify(mintedHttp.body).includes(SIGNING) && !JSON.stringify(mintedHttp.body).includes(SECRET), 'mint response hides keys');
  ok(seen.every((item) => item.url.startsWith('https://example.supabase.co/')), 'mint stays on supabase');
  ok(!seen.some((item) => item.url.includes('/rest/v1/siparisler')), 'mint does not read orders');
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': mintedHttp.body.consent }));
  ok(res.statusCode === 200 && res.body.freshness === 'FRESH', 'minted consent is accepted once');
  res = await call('GET', { firma_id: FIRMA }, headers({ 'x-btd-user-consent': mintedHttp.body.consent }), { keepReplay: true });
  ok(res.statusCode === 401, 'minted consent cannot be replayed');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cloud = fs.readFileSync(path.join(root, 'js/btd-cloud.js'), 'utf8');
  ok(!html.includes('shadow-read') && !cloud.includes('shadow-read'), 'btd ui does not depend on shadow read');
  const clientFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html')).concat(
    fs.readdirSync(path.join(root, 'js')).map((name) => path.join('js', name))
  );
  const banned = ['shadow-read', 'shadow-consent', 'x-btd-user-consent', 'x-shadow-service-identity', 'x-btd-service-identity'];
  for (const name of clientFiles) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const word of banned) ok(!text.includes(word), `${name} does not reference ${word}`);
  }
  const bridgeSrc = ['api/shadow-read.js', 'api/shadow-consent.js', 'api/health.js', 'api/_lib/shadow.js', 'api/_lib/shadow-replay.js']
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');
  ok(!bridgeSrc.includes('SHADOW_BTD_LIVE'), 'live flag is not read');
  ok(!bridgeSrc.includes('SUPABASE_SECRET_KEY'), 'bridge does not read the secret key');
  ok(!/iss:\s*SERVICE_ISSUER/.test(fs.readFileSync(path.join(root, 'api/_lib/shadow.js'), 'utf8')), 'btd signer does not emit iss=shadow');
  global.fetch = async () => { throw new Error('shadow down'); };
  const healthRes = mockRes();
  health({ method: 'GET' }, healthRes);
  ok(healthRes.statusCode === 200 && healthRes.body.ok === true && healthRes.body.shadowRequired === false, 'health stays up when shadow is down');
  ok(typeof require('./crud').handle === 'function', 'existing crud module still loads');

  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, headers(), { noMock: true });
  ok(res.statusCode === 503 && res.body.missing.indexOf('BTD_SHADOW_REPLAY_DATABASE_URL') !== -1, 'missing replay store fails closed');
  ok(seen.length === 0, 'missing replay store does not read');
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  replayLib.useMockHarness({ firms: [FIRMA], keyVersion: 1 });

  let remoteHits = 0;
  replayLib.setDatabaseConnector(async () => {
    remoteHits += 1;
    throw new Error('connect');
  });
  const remote = 'postgres://role:parola-degil@db.proj.supabase.co:5432/postgres';
  seen.length = 0;
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA),
  }, { readerUrl: remote, replayUrl: remote });
  ok(remoteHits === 0 && res.statusCode === 200 && res.body.read === 'BLOCKED' && res.body.data === null, 'remote reader url is not contacted');
  ok(!JSON.stringify(res.body).includes('parola-degil') && !JSON.stringify(res.body).includes('supabase.co'), 'remote url is not echoed');
  replayLib.setDatabaseConnector(null);

  let readerHits = 0;
  replayLib.setDatabaseConnector(async () => {
    readerHits += 1;
    const error = new Error('connect ECONNREFUSED');
    throw error;
  });
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA, { jti: 'svc-down' }),
  }, { readerUrl: 'postgres://btd_shadow_kopru@127.0.0.1:5432/btd_local' });
  ok(readerHits === 1 && res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null && res.body.read !== 'BLOCKED', 'reader connection failure is unavailable');
  ok(!JSON.stringify(res.body).includes('geciken_is_emri_adet') && !JSON.stringify(res.body).includes('"adet":0'), 'connection failure does not invent a zero');

  replayLib.setDatabaseConnector(async () => {
    const error = new Error('bridge_unproven');
    error.reason = 'bridge';
    throw error;
  });
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA, { jti: 'svc-bridge' }),
  }, { readerUrl: 'postgres://btd_shadow_kopru@127.0.0.1:5432/btd_local' });
  ok(res.statusCode === 200 && res.body.read === 'BLOCKED' && res.body.data === null && res.body.freshness === 'UNAVAILABLE', 'unproven database role stays blocked');

  replayLib.setDatabaseConnector(async () => [{ payload: { ok: false, reason: 'firma' } }]);
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA, { jti: 'svc-firma-fn' }),
  }, { readerUrl: 'postgres://btd_shadow_kopru@127.0.0.1:5432/btd_local' });
  ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED' && res.body.data == null, 'function firm denial stays 403');

  replayLib.setDatabaseConnector(async () => [{ payload: { ok: false, reason: 'revoked' } }]);
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA, { jti: 'svc-revoked-fn' }),
  }, { readerUrl: 'postgres://btd_shadow_kopru@127.0.0.1:5432/btd_local' });
  ok(res.statusCode === 401 && res.body.freshness !== 'UNAVAILABLE' && res.body.data == null && res.body.read !== 'BLOCKED', 'function revocation stays 401');

  readerHits = 0;
  replayLib.setDatabaseConnector(async () => {
    readerHits += 1;
    return [{ payload: { ok: true, data: { geciken_is_emri_adet: 0, acik_gorev_adet: 0, siparis_ozet: [], guncellendi: null } } }];
  });
  res = await call('GET', { firma_id: FIRMA }, {
    'x-api-key': 'gate',
    'x-shadow-service-identity': serviceToken(FIRMA, { jti: 'svc-expired-token', nowSec: 1000, ttlSec: 30 }),
  }, { readerUrl: 'postgres://btd_shadow_kopru@127.0.0.1:5432/btd_local' });
  ok(readerHits === 0 && res.statusCode === 401 && res.body.freshness !== 'UNAVAILABLE', 'expired service token does not read and is not unavailable');
  replayLib.setDatabaseConnector(null);

  const sql = fs.readFileSync(path.join(root, 'supabase/030_shadow_kimlik.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'supabase/030_shadow_kimlik_rollback.sql'), 'utf8');
  ok(sql.includes('tek_kullanim') && sql.includes('kisa_tekrar'), 'sql defines both jti classes');
  ok(sql.includes('btd_shadow_okuyucu') && sql.includes('service_role'), 'sql names the reader and revokes service role');
  ok(!/CREATE POLICY/i.test(sql), 'sql does not add a client firma policy');
  ok(!sql.includes('SUPABASE_SECRET') && !sql.includes('SHADOW_BTD_LIVE'), 'sql has no secret or live flag');
  ok(rollback.includes('DROP TABLE IF EXISTS public.btd_shadow_jti'), 'rollback drops the jti table');
  ok(!/DROP ROLE (anon|authenticated|service_role)/.test(rollback), 'rollback keeps platform roles');
  ok(sql.includes('search_path = pg_catalog, public, pg_temp'), 'definer search_path pins pg_catalog ahead of temp');
  const bridgeSql = fs.readFileSync(path.join(root, 'supabase/031_shadow_kopru.sql'), 'utf8');
  const bridgeRollback = fs.readFileSync(path.join(root, 'supabase/031_shadow_kopru_rollback.sql'), 'utf8');
  ok(bridgeSql.includes('btd_shadow_kopru') && bridgeSql.includes('NOLOGIN'), 'bridge migration keeps the reader nologin');
  ok(bridgeSql.includes('INHERIT FALSE') && bridgeSql.includes('SET TRUE'), 'bridge membership is set role only');
  ok(!/PASSWORD/i.test(bridgeSql) && !bridgeSql.includes('SHADOW_BTD_LIVE'), 'bridge migration has no password or live flag');
  ok(!/GRANT[\s\S]*TO\s+service_role/i.test(bridgeSql) && !/CREATE\s+ROLE\s+service_role/i.test(bridgeSql), 'bridge migration does not grant service role');
  ok(!/\bBYPASSRLS\b/.test(bridgeSql.replace(/NOBYPASSRLS/g, '')), 'bridge migration does not grant bypassrls');
  ok(bridgeRollback.includes('DROP ROLE btd_shadow_kopru') && !bridgeRollback.includes('DROP TABLE'), 'bridge rollback drops only the login role');
  const shadowSrc = fs.readFileSync(path.join(root, 'api/_lib/shadow.js'), 'utf8');
  ok(!shadowSrc.includes('REPLAY_LIMIT') && !shadowSrc.includes('rememberJti'), 'authoritative replay is not a process map');

  console.log(`shadow contract: ${calls} passed (mock replay, not live postgres)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
