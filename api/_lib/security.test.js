'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auth = require('../../js/btd-auth');
const kiosk = require('../../js/btd-kiosk');
const shadow = require('./shadow');
const shadowRead = require('../shadow-read');

const root = path.join(__dirname, '..', '..');
let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

const known = ['Technomac', 'Bluemac', 'Devorias'];
const marker = 'HASHMARKER';
const tc = 'TCMARKER';

function volkan() {
  return {
    username: 'volkan',
    name: 'Volkan',
    password: marker,
    sifre_hash: marker,
    tcNo: tc,
    role: 'Yönetici',
    scope: 'Tüm Grup',
    companies: known.slice(),
    isGod: true,
    perms: { Maliyet: { view: true } },
  };
}

function ahmet() {
  return {
    username: 'ahmet',
    name: 'Ahmet',
    password: marker,
    tc_no: tc,
    role: 'Operatör',
    scope: 'Technomac',
    companies: ['Technomac'],
    isGod: false,
    collar: 'blue',
  };
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

async function main() {
  const session = auth.buildSession(volkan(), 'Devorias', { knownCompanies: known, requestedRole: 'Operatör' });
  ok(session.company === 'Devorias', 'group member can open own firm');
  ok(session.role === 'Yönetici', 'client role is ignored');
  ok(session.isGod === true, 'group scope stays group on desktop');
  ok(!JSON.stringify(session).includes(marker), 'session drops password marker');
  ok(!JSON.stringify(session).includes(tc), 'session drops tc marker');
  ok(!Object.prototype.hasOwnProperty.call(session, 'password'), 'no password key');
  ok(!Object.prototype.hasOwnProperty.call(session, 'sifre_hash'), 'no hash key');
  ok(!Object.prototype.hasOwnProperty.call(session, 'tcNo'), 'no tc key');

  const named = auth.buildSession({
    username: 'volkan',
    name: 'Volkan',
    role: 'Operatör',
    scope: 'Technomac',
    companies: ['Technomac'],
    isGod: true,
  }, 'Devorias', { knownCompanies: known });
  ok(named.role === 'Operatör' && named.isGod === false, 'username is not an admin bypass');
  ok(named.company === 'Technomac', 'foreign firm is not granted');

  const moved = auth.buildSession(ahmet(), 'Bluemac', { knownCompanies: known });
  ok(moved.company === 'Technomac' && moved.isGod === false, 'operator stays on membership firm');
  ok(moved.collar === 'blue', 'collar kept');

  const server = auth.buildSession({
    kullanici_adi: 'pilot',
    ad_soyad: 'Pilot',
    rol: 'Yönetici',
    tum_grup: true,
    firmalar: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ad: 'Technomac' }],
    sifre_hash: marker,
  }, 'Devorias', { knownCompanies: known });
  ok(server.company === 'Technomac', 'server membership limits group firms');
  ok(!JSON.stringify(server).includes(marker), 'server payload secrets dropped');

  const kioskSession = auth.buildSession(volkan(), 'Bluemac', { portal: 'kiosk', knownCompanies: known });
  ok(kioskSession.kiosk === true && kioskSession.isGod === false, 'kiosk has no admin');
  ok(kioskSession.role === 'Operatör' && kioskSession.companies.length === 1, 'kiosk is one operator');
  ok(kioskSession.accessCritical === false, 'kiosk has no critical access');
  ok(kioskSession.perms.Maliyet.delete === false, 'kiosk cannot delete');

  const dirty = auth.sanitizeSession({ username: 'a', password: marker, tc_no: tc, role: 'Operatör' });
  ok(dirty.username === 'a' && !JSON.stringify(dirty).includes(marker), 'sanitize allowlist');

  ok(kiosk.detectPortal('?portal=kiosk') === 'kiosk', 'kiosk query');
  ok(kiosk.detectPortal('') === 'desktop', 'desktop default');
  ok(kiosk.idleMs('desktop') === 2 * 60 * 60 * 1000, 'desktop idle unchanged');
  ok(kiosk.idleMs('kiosk') === 5 * 60 * 1000, 'kiosk idle');
  ok(kiosk.allowsRemember('desktop') === true && kiosk.allowsRemember('kiosk') === false, 'kiosk does not remember');
  ok(kiosk.allowsSavedPassword() === false, 'passwords are not saved');

  const now = 1_700_000_000_000;
  ok(shadow.classifyFreshness({ permission: false, upstream: 'up', observedAt: now, now, clockTrusted: true }) === 'PERMISSION_DENIED', 'denied');
  ok(shadow.classifyFreshness({ permission: true, upstream: 'unconfigured', observedAt: now, now, clockTrusted: true }) === 'UNAVAILABLE', 'unavailable');
  ok(shadow.classifyFreshness({ permission: true, upstream: 'up', observedAt: null, now, clockTrusted: true }) === 'UNKNOWN', 'unknown');
  ok(shadow.classifyFreshness({ permission: true, upstream: 'up', observedAt: now - 60_000, now, clockTrusted: true }) === 'FRESH', 'fresh');
  ok(shadow.classifyFreshness({ permission: true, upstream: 'up', observedAt: now - 6 * 60_000, now, clockTrusted: true }) === 'STALE', 'stale');
  const projected = shadow.projectFields({ ref: 'S-1', durum: 'Açık', adet: 2, guncellendi: '2026-11-02', maliyet: 99, tc_no: tc });
  ok(projected.ref === 'S-1' && projected.maliyet === undefined && projected.tc_no === undefined, 'allowlist');
  ok(shadow.assertReadOnly('POST').ok === false, 'writes disabled');

  const firma = '11111111-1111-4111-8111-111111111111';
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  shadow.resetReplay();
  const signed = shadow.signUserConsent({ firmaId: firma, secret: 'ornek-imza-anahtari', nowSec: 1000, ttlSec: 120, jti: 'jti-1' });
  ok(signed.claims.aud === 'shadow-btd-read-v1', 'audience');
  ok(signed.claims.iss === 'btd' && signed.claims.sub === 'user-consent' && signed.claims.perm === 'shadow.read', 'user consent scope');
  ok((await shadow.verifyUserConsent(signed.token, 'ornek-imza-anahtari', 1100, firma)).ok, 'signature');
  ok(!(await shadow.verifyUserConsent(signed.token, 'baska', 1100, firma)).ok, 'wrong key');
  ok((await shadow.verifyUserConsent(signed.token, 'ornek-imza-anahtari', 2000, firma)).reason === 'expired', 'expired');
  ok(shadow.signUserConsent({ firmaId: firma, secret: 'ornek-imza-anahtari', nowSec: 1000, ttlSec: 900 }) === null, 'ttl cap');

  const sql013 = read('supabase/013_auth_membership.sql');
  const sql014 = read('supabase/014_tenant_rls.sql');
  const sql015 = read('supabase/015_revoke_anon_demo.sql');
  const sql016 = read('supabase/016_rollback_demo_access.sql');
  const sql017 = read('supabase/017_emergency_anon_containment.sql');
  const sql018 = read('supabase/018_sensitive_columns.sql');
  const sql002 = read('supabase/002_demo_users_grants.sql');
  const sql003 = read('supabase/003_demo_rls_policies.sql');
  ok(!/UPDATE\s+public\.kullanicilar/i.test(sql013), 'no bulk account update');
  ok(sql013.includes('auth.uid()') && sql013.includes('btd_oturum_baglami'), 'membership from auth uid');
  ok(!sql013.includes('sifre_hash') || sql013.indexOf('sifre_hash') === -1, 'context function omits hash');
  ok(sql014.includes('USING') && sql014.includes('WITH CHECK'), 'tenant policies have both clauses');
  ok(!sql014.includes('DROP POLICY IF EXISTS demo_all_access'), '014 does not revoke demo');
  ok(sql014.includes("btd.allow_rls"), '014 is gated');
  ok(sql015.includes('demo_all_access') && sql015.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon'), '015 revokes anon');
  ok(sql015.includes('btd.allow_anon_revoke'), '015 is gated');
  ok(!/GRANT SELECT \(\s*id[\s\S]*sifre_hash/.test(sql015), 'column grant omits hash');
  ok(sql016.includes('anon geniş yetki geri açılmaz'), 'rollback refuses anon restore');
  ok(!/CREATE POLICY demo_all_access/i.test(sql016), 'rollback does not create demo policy');
  ok(!/GRANT[\s\S]*TO anon/i.test(sql016), 'rollback does not grant anon');
  const policyAt = sql017.indexOf('CREATE POLICY btd_tenant_all');
  const dropAt = sql017.indexOf('DROP POLICY IF EXISTS demo_all_access');
  ok(policyAt !== -1 && dropAt !== -1 && policyAt < dropAt, 'authenticated policy before demo drop');
  ok(!/GRANT[\s\S]{0,80}TO anon/i.test(sql017), '017 does not grant anon');
  ok(sql017.includes('personel') && sql017.includes('tc_no'), '017 covers personnel identity column');
  ok(!/UPDATE\s+public\.kullanicilar/i.test(sql017), '017 does not bulk-link accounts');
  ok(sql018.includes('btd_personel_hassas_liste') && sql018.includes('NOT IN (\'tc_no\', \'maas\')'), '018 hides sensitive columns');
  ok(sql002.includes('Durdu') && !/GRANT[\s\S]*TO anon/i.test(sql002), '002 cannot reopen anon');
  ok(sql003.includes('Durdu') && !/CREATE POLICY demo_all_access/i.test(sql003), '003 cannot recreate demo policy');
  ok(auth.acceptStoredSession({ v: 2, authSource: 'supabase-auth', username: 'a' }), 'v2 auth session accepted');
  ok(!auth.acceptStoredSession({ v: 1, authSource: 'local', username: 'volkan', isGod: true }), 'legacy session rejected');
  ok(!auth.acceptStoredSession({ v: 2, authSource: 'supabase-auth', tc_no: tc }), 'session with tc rejected');
  ok(!auth.PERSONNEL_COLUMNS.includes('tc_no') && !auth.PERSONNEL_COLUMNS.includes('maas'), 'personnel select omits sensitive columns');
  ok(auth.canReadSensitive({ role: 'Operatör', kiosk: true, accessCritical: true }) === false, 'kiosk cannot read sensitive');
  ok(auth.canReadSensitive({ role: 'Yönetici', authSource: 'supabase-auth' }) === true, 'manager can read sensitive');

  const accessFn = read('index.html').slice(read('index.html').indexOf('function userCanAccessPage'), read('index.html').indexOf('function applyPriceVisibility'));
  ok(!accessFn.includes("if (user.isGod || user.role === 'Yönetici') return true"), 'manager view flag is enforced');
  ok(accessFn.includes('moduleViewAllowed(user, page)'), 'page access uses the view flag');
  const restoreFn = read('index.html').slice(read('index.html').indexOf('async function tryRestoreAuthSession'), read('index.html').indexOf("document.getElementById('loginTogglePw')"));
  ok(restoreFn.includes('endSupabaseSession'), 'kiosk restore clears the supabase session');
  ok(read('index.html').includes("btdPortal() === 'kiosk' && !currentUser"), 'kiosk does not boot before login');
  ok(!read('index.html').includes('shadow-read') && !read('js/btd-cloud.js').includes('shadow-read'), 'btd boots without the shadow read');

  const html = read('index.html');
  ok(!html.includes('şifre 123456'), 'login hint has no demo password');
  ok(!html.includes('8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'), 'client has no demo password hash');
  ok(/function applyDemoLoginOverrides\(user\) \{\s*return user \|\| null;\s*\}/.test(html), 'demo override does not elevate');
  const authFn = html.slice(html.indexOf('async function authenticateLoginAsync'), html.indexOf('loginForm.addEventListener'));
  ok(authFn.includes('signInWithSupabase') && !authFn.includes('digestPassword') && !authFn.includes('fetchUserForLogin'), 'login is supabase auth only');
  ok(!read('js/btd-cloud.js').includes('row.isGod = true'), 'hydrate does not force god');
  ok(!read('js/btd-cloud.js').includes('PROTECTED_USERS'), 'no privileged username list');
  ok(!read('js/btd-supabase.js').includes("from('kullanicilar')"), 'client login does not read password column');

  const crud = read('api/_lib/crud.js');
  const shadowSrc = read('api/shadow-read.js');
  ok(!crud.includes('SUPABASE_SECRET_KEY') && !shadowSrc.includes('SUPABASE_SECRET_KEY'), 'ordinary reads do not use the secret key');
  ok(!shadowSrc.includes('fetch(') || shadowSrc.includes('resolveMembership'), 'shadow handler has no own upstream fetch');
  ok(!/https?:\/\/(?!example)/.test(shadowSrc), 'shadow source has no external url');
  ok(!shadowSrc.includes('SHADOW_BTD_LIVE') && !read('api/_lib/shadow.js').includes('SHADOW_BTD_LIVE'), 'live flag is not read');

  const catalog = read('docs/security/FAZ2_CANLI_KATALOG_KONTROL.sql');
  const catalogSql = catalog.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
  ok(catalog.includes('execute_acl') && catalog.includes('security_definer'), 'catalog reads function acl');
  ok(!/\b(insert|update|delete|grant|revoke|alter|drop|truncate|call|copy)\b/i.test(catalogSql), 'catalog statements stay read only');

  console.log(`security: ${calls} passed`);
}

async function shadowHttp() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.BTD_API_KEY = 'gate';
  process.env.BTD_SHADOW_SIGNING_KEY = 'ornek-imza-anahtari';
  process.env.BTD_SHADOW_SERVICE_VERIFY_KEY = 'ornek-dogrulama-anahtari';
  process.env.BTD_SHADOW_SERVICE_KEY_VERSION = '1';
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  delete process.env.BTD_SHADOW_REPLAY_DATABASE_URL;
  delete process.env.BTD_SHADOW_READER_DATABASE_URL;
  process.env.BTD_RATE_LIMIT = '20';
  process.env.SUPABASE_SECRET_KEY = 'super-secret-value';
  const firma = '11111111-1111-4111-8111-111111111111';
  shadow.resetReplay();
  const service = shadow.signUserConsent({
    firmaId: firma,
    secret: 'ornek-imza-anahtari',
    nowSec: Math.floor(Date.now() / 1000),
    ttlSec: 120,
  });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ id: '44444444-4444-4444-8444-444444444444' }); } };
    }
    if (String(url).includes('/rpc/btd_oturum_baglami')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ kullanici_id: 'k1', firmalar: [{ id: firma, ad: 'Bluemac' }] }); } };
    }
    throw new Error('unexpected upstream');
  };
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await shadowRead({
    method: 'POST',
    query: { firma_id: firma },
    headers: { 'x-api-key': 'gate', authorization: 'Bearer good-token' },
  }, res);
  ok(res.statusCode === 405 && res.body.writes === false, 'http write blocked');

  const okRes = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await shadowRead({
    method: 'GET',
    query: { firma_id: firma },
    headers: {
      'x-api-key': 'gate',
      authorization: 'Bearer good-token',
      'x-btd-user-consent': service.token,
    },
  }, okRes);
  ok(okRes.statusCode === 200 && okRes.body.freshness === 'UNAVAILABLE', 'shadow down is unavailable');
  ok(okRes.body.data === null && okRes.body.writes === false, 'no shadow rows');
  ok(!Object.prototype.hasOwnProperty.call(okRes.body, 'error') && okRes.body.businessError !== true, 'unavailable is not a business error');
  ok(okRes.body.identity.aud === 'shadow-btd-read-v1' && okRes.body.identity.iss === 'btd', 'http audience');
  ok(!JSON.stringify(okRes.body).includes('super-secret-value'), 'response hides secret');
  ok(urls.every((url) => url.startsWith('https://example.supabase.co/')), 'no shadow host called');
  ok(!okRes.body.identity.token, 'raw token is not returned');
}

async function cloudGate() {
  const vm = require('vm');
  const context = vm.createContext({ console });
  vm.runInContext(read('js/btd-auth.js'), context);
  vm.runInContext(read('js/btd-cloud.js'), context);
  const ops = [];
  context.BtdSupabase = {
    hasUserSession: async () => false,
    getClient() {
      ops.push('client');
      return { from() { ops.push('from'); throw new Error('anon query'); } };
    },
  };
  const blocked = await context.BtdCloud.boot({ companies: { A: { dbId: 'x' } } });
  ok(blocked.ok === false && blocked.reason === 'no-auth-session', 'boot without session does not read');
  ok(ops.length === 0, 'boot without session does not open a client');

  context.BtdSupabase.hasUserSession = async () => true;
  const writes = [];
  context.BtdSupabase.getClient = () => ({
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        eq() { return query; },
        insert() { writes.push(table); return query; },
        upsert() { writes.push(table); return query; },
        update() { writes.push(table); return query; },
        delete() { writes.push(table); return query; },
        single() { return Promise.resolve({ data: [], error: null, count: 1 }); },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null, count: 1 }).then(resolve, reject); },
      };
      return query;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  });
  const session = { role: 'Operatör', authSource: 'supabase-auth', accessCritical: false };
  const booted = await context.BtdCloud.boot({
    session,
    companies: { Technomac: { dbId: '11111111-1111-4111-8111-111111111111' } },
    customers: [{ name: 'yerel' }],
    personnel: [{ name: 'yerel', tcNo: tc }],
    users: [{ username: 'volkan', password: marker, isGod: true }],
  });
  ok(booted.ok === true, 'authenticated boot runs');
  ok(writes.length === 0, 'boot does not write local rows');

  const packaged = [{ company: 'Technomac', name: 'Paketli Firma' }];
  const emptyWrites = [];
  context.BtdSupabase.getClient = () => ({
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        eq() { return query; },
        insert() { emptyWrites.push(table); return query; },
        upsert() { emptyWrites.push(table); return query; },
        update() { emptyWrites.push(table); return query; },
        delete() { emptyWrites.push(table); return query; },
        single() { return Promise.resolve({ data: { id: 'new' }, error: null, count: 0 }); },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject); },
      };
      return query;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  });
  const emptied = await context.BtdCloud.boot({
    session,
    companies: { Technomac: { dbId: '11111111-1111-4111-8111-111111111111' } },
    customers: packaged,
  });
  ok(emptied.ok === true && packaged.length === 0, 'empty cloud drops packaged directory');
  ok(emptyWrites.length === 0, 'empty cloud does not write packaged rows');
  const blockedSave = await context.BtdCloud.saveCustomer(
    { company: 'Technomac', name: 'Paketli Firma' },
    { Technomac: { dbId: '11111111-1111-4111-8111-111111111111' } }
  );
  ok(blockedSave.ok === false && String(blockedSave.reason).includes('packaged-demo-blocked'), 'later save cannot write packaged customer');
  ok(emptyWrites.length === 0, 'blocked save does not call the table');
  const freshSave = await context.BtdCloud.saveCustomer(
    { company: 'Technomac', name: 'Yeni Firma' },
    { Technomac: { dbId: '11111111-1111-4111-8111-111111111111' } }
  );
  ok(freshSave.ok === true && emptyWrites.includes('musteriler'), 'a new customer can still be saved');
}

async function kioskSession() {
  const fallen = [];
  const local = await kiosk.endSupabaseSession({
    async signOut(opts) {
      fallen.push(opts || 'global');
      if (!opts) throw new Error('network');
    },
  });
  ok(local === true && fallen[0] === 'global' && fallen[1] && fallen[1].scope === 'local', 'kiosk falls back to local signOut');
  const cleared = [];
  const gone = await kiosk.endSupabaseSession({
    async signOut() { cleared.push('gone'); },
  });
  ok(gone === true && cleared.length === 1, 'kiosk signOut clears the session');
  const missing = await kiosk.endSupabaseSession(null);
  ok(missing === false, 'kiosk signOut fails closed without a client');
}

main().then(() => shadowHttp()).then(() => cloudGate()).then(() => kioskSession()).then(() => {
  console.log('shadow http checks passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
