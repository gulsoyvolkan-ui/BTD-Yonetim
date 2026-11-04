'use strict';

// İzole yerel Postgres. Uzak adres reddedilir. Üretim ve staging aranmaz.
// Sentetik BM ve TM bu sürecin kendi veritabanındadır. Mock sayılmaz.
// Bağlantı veya pg sürücüsü yoksa NOT TESTED. Bu sonuç staging GO değildir.

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const migration030 = path.join(root, 'supabase/030_shadow_kimlik.sql');
const migration031 = path.join(root, 'supabase/031_shadow_kopru.sql');
const rollback031 = path.join(root, 'supabase/031_shadow_kopru_rollback.sql');
const BM = '11111111-1111-4111-8111-111111111111';
const TM = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';
const BAD = '44444444-4444-4444-8444-444444444444';
const SIGNING = 'ornek-imza-anahtari';
const VERIFY = 'ornek-dogrulama-anahtari';
const secrets = [];

function skip(reason) {
  console.log(`shadow kopru: NOT TESTED ${reason}`);
  process.exit(0);
}

function redact(text) {
  let out = String(text || '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[gizli]');
  }
  return out;
}

function refuseRemote() {
  const raw = String(process.env.BTD_RLS_TEST_DATABASE_URL || '').trim();
  if (!raw) return;
  let host = '';
  try {
    host = new URL(raw).hostname;
  } catch {
    host = 'malformed';
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    skip('refused non-local database');
  }
}

function psql(database, args, input) {
  try {
    const out = execFileSync('sudo', [
      '-u', 'postgres',
      'psql',
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-d', database,
      ...args,
    ], {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PGCLIENTENCODING: 'UTF8' }),
    });
    return { code: 0, out, err: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      out: redact(err.stdout || ''),
      err: redact(err.stderr || err.message || ''),
    };
  }
}

function queryLines(database, sql) {
  const result = psql(database, ['-tA', '-c', sql]);
  if (result.code !== 0) {
    throw new Error(redact(result.err || result.out || 'psql'));
  }
  return result.out.split('\n').map((item) => item.trim()).filter(Boolean);
}

function query(database, sql) {
  const lines = queryLines(database, sql);
  return lines.length ? lines[lines.length - 1] : '';
}

function jsonQuery(database, sql) {
  const result = psql(database, ['-tA', '-c', sql]);
  if (result.code !== 0) throw new Error(redact(result.err || 'json psql'));
  const line = result.out.split('\n').map((item) => item.trim()).find((item) => item.startsWith('{'));
  if (!line) throw new Error(`json yok: ${redact(result.out).slice(0, 180)}`);
  return JSON.parse(line);
}

function writeSql(dir, name, contents) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  fs.chmodSync(file, 0o644);
  return file;
}

function applyFile(database, dir, file) {
  const wrapper = writeSql(dir, `${path.basename(file)}.apply.sql`, `SELECT set_config('btd.allow_shadow_kimlik', 'on', false);\n\\i ${file}\n`);
  const result = psql(database, ['-f', wrapper]);
  if (result.code !== 0) throw new Error(redact(result.err || result.out));
}

function serviceToken(firmaId, opts = {}) {
  const nowSec = opts.nowSec == null ? Math.floor(Date.now() / 1000) : opts.nowSec;
  const ttl = opts.ttlSec == null ? 120 : opts.ttlSec;
  const payload = {
    iss: 'shadow',
    aud: 'btd-shadow-service-v1',
    sub: 'shadow-service',
    firma_id: String(firmaId),
    perm: 'shadow.read',
    jti: opts.jti || crypto.randomUUID(),
    kv: opts.kv == null ? 1 : opts.kv,
    iat: nowSec,
    exp: nowSec + ttl,
  };
  if (opts.use) payload.use = opts.use;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', opts.secret || VERIFY).update(body).digest('base64url');
  return `${body}.${mac}`;
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

function localUrl(user, password, database, port) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

async function main() {
  refuseRemote();
  try {
    execFileSync('pg_isready', ['-h', '/var/run/postgresql'], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync('pg_isready', ['-h', '127.0.0.1'], { stdio: 'ignore' });
    } catch {
      skip('local socket');
    }
  }
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    skip('pg driver');
  }
  try {
    query('postgres', 'SELECT 1');
  } catch {
    skip('local peer');
  }

  const replayLib = require('./shadow-replay');
  const shadowRead = require('../shadow-read');
  const { resetGuards } = require('./guard');
  const db = `btd_faz9_${Date.now().toString(36)}`;
  const password = crypto.randomBytes(24).toString('hex');
  const otherPassword = crypto.randomBytes(18).toString('hex');
  const superPassword = crypto.randomBytes(18).toString('hex');
  secrets.push(password, otherPassword, superPassword);
  const before = new Set(queryLines('postgres', 'SELECT rolname FROM pg_roles'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btd-faz9-'));
  fs.chmodSync(dir, 0o755);
  const copy030 = writeSql(dir, '030.sql', fs.readFileSync(migration030));
  const copy031 = writeSql(dir, '031.sql', fs.readFileSync(migration031));
  const copyRollback = writeSql(dir, '031-rollback.sql', fs.readFileSync(rollback031));
  let passed = 0;
  const httpCounts = { fresh: 0, denied: 0, unavailable: 0, blocked: 0, rejected: 0 };
  function ok(cond, message) {
    if (!cond) {
      console.error(`shadow kopru failed: ${message}`);
      process.exitCode = 1;
      throw new Error(message);
    }
    passed += 1;
  }

  let restCalls = 0;
  global.fetch = async () => {
    restCalls += 1;
    throw new Error('rest');
  };

  function arm(replayUrl, readerUrl) {
    replayLib.detachSecurity();
    replayLib.setDatabaseConnector(null);
    delete process.env.BTD_SHADOW_REPLAY_MOCK;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SHADOW_BTD_LIVE;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.BTD_API_KEY = 'gate';
    process.env.BTD_SHADOW_SIGNING_KEY = SIGNING;
    process.env.BTD_SHADOW_SERVICE_VERIFY_KEY = VERIFY;
    process.env.BTD_SHADOW_SERVICE_KEY_VERSION = '1';
    process.env.BTD_RATE_LIMIT = '500';
    if (replayUrl) process.env.BTD_SHADOW_REPLAY_DATABASE_URL = replayUrl;
    else delete process.env.BTD_SHADOW_REPLAY_DATABASE_URL;
    if (readerUrl) process.env.BTD_SHADOW_READER_DATABASE_URL = readerUrl;
    else delete process.env.BTD_SHADOW_READER_DATABASE_URL;
    resetGuards();
  }

  async function call(token, firmaId) {
    const res = mockRes();
    await shadowRead({
      method: 'GET',
      query: { firma_id: firmaId || BM },
      headers: {
        'x-api-key': 'gate',
        'x-shadow-service-identity': token,
      },
    }, res);
    return res;
  }

  function reads() {
    return query(db, "SELECT count(*) FROM public.btd_servis_denetim WHERE olay = 'okuma' AND sonuc = 'ok'");
  }

  try {
    query('postgres', `CREATE DATABASE ${db}`);
    psql(db, ['-c', `
      CREATE TABLE public.siparisler (
        id uuid PRIMARY KEY,
        firma_id uuid NOT NULL,
        durum text NOT NULL,
        teslim_tarihi date,
        updated_at timestamptz,
        birim_fiyat text,
        tc_no text,
        musteri_unvan text
      );
      CREATE TABLE public.is_emirleri (
        id uuid PRIMARY KEY,
        firma_id uuid NOT NULL,
        durum text NOT NULL,
        siparis_id uuid,
        updated_at timestamptz
      );
      CREATE TABLE public.gorevler (
        id uuid PRIMARY KEY,
        firma_id uuid NOT NULL,
        durum text NOT NULL,
        updated_at timestamptz
      );
    `]);
    const unguarded = psql(db, ['-f', copy031]);
    ok(unguarded.code !== 0 && unguarded.err.includes('Durdu'), '031 refuses to run without the session flag');

    applyFile(db, dir, copy030);
    applyFile(db, dir, copy031);
    applyFile(db, dir, copy031);
    ok(query(db, "SELECT rolcanlogin::text || ':' || rolinherit::text || ':' || rolsuper::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu'") === 'false:false:false:false', 'reader stays nologin without inherit, superuser, or bypass');
    ok(query(db, "SELECT rolcanlogin::text || ':' || rolinherit::text || ':' || rolsuper::text || ':' || rolbypassrls::text || ':' || rolconnlimit::text FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === 'true:false:false:false:8', 'bridge is a bounded nologin-inherit login');
    ok(query(db, `SELECT m.inherit_option::text || ':' || m.set_option::text || ':' || m.admin_option::text
      FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid AND g.rolname = 'btd_shadow_okuyucu'
      JOIN pg_roles r ON r.oid = m.member AND r.rolname = 'btd_shadow_kopru'`) === 'false:true:false', 'bridge can set role and does not inherit it');

    const configs = query(db, `SELECT string_agg(proname || '=' || coalesce(array_to_string(proconfig, ','), ''), ' ')
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'btd_%'`);
    ok((configs.match(/search_path=pg_catalog, public, pg_temp/g) || []).length === 7, 'seven definer functions pin search_path');
    ok(query(db, "SELECT count(*) FROM pg_policies WHERE tablename IN ('btd_shadow_jti', 'btd_servis_kayit', 'btd_servis_denetim')") === '0', 'no client firma policy');
    ok(query(db, `SELECT string_agg(relname || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text, ',' ORDER BY relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('btd_servis_denetim', 'btd_servis_kayit', 'btd_shadow_jti')`)
      === 'btd_servis_denetim:true:true,btd_servis_kayit:true:true,btd_shadow_jti:true:true', 'shadow tables force row level security');

    const fn = 'public.btd_shadow_operasyon_ozet(text,uuid,integer)';
    ok(query(db, `SELECT has_function_privilege('btd_shadow_okuyucu', '${fn}', 'EXECUTE')::text`) === 'true', 'reader can execute');
    ok(query(db, `SELECT has_function_privilege('btd_shadow_kopru', '${fn}', 'EXECUTE')::text`) === 'false', 'bridge cannot execute without set role');
    ok(query(db, `SELECT has_function_privilege('anon', '${fn}', 'EXECUTE')::text`) === 'false', 'anon cannot execute');
    ok(query(db, `SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE')::text`) === 'false', 'authenticated cannot execute');
    ok(query(db, `SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE')::text`) === 'false', 'service_role cannot execute');
    ok(query(db, `SELECT count(*) FROM information_schema.routine_privileges WHERE routine_name = 'btd_shadow_operasyon_ozet' AND grantee = 'PUBLIC'`) === '0', 'public cannot execute');
    ok(query(db, "SELECT has_table_privilege('btd_shadow_kopru', 'public.siparisler', 'SELECT')::text") === 'false', 'bridge cannot select orders');
    ok(query(db, "SELECT has_table_privilege('btd_shadow_okuyucu', 'public.btd_shadow_jti', 'SELECT')::text") === 'false', 'reader cannot select the jti table');
    ok(query(db, "SELECT has_table_privilege('btd_shadow_kopru', 'public.btd_servis_kayit', 'SELECT')::text") === 'false', 'bridge cannot select the service registry');

    psql(db, ['-c', `
      INSERT INTO public.btd_servis_kayit
        (servis_kod, ad, izinli_firma_ids, kapsam, anahtar_surum, etkin, gecerlilik_sonu)
      VALUES
        ('shadow-service', 'shadow', ARRAY['${BM}','${EMPTY}','${BAD}']::uuid[], ARRAY['shadow.read'], 1, true, now() + interval '1 day');
      INSERT INTO public.siparisler (id, firma_id, durum, teslim_tarihi, updated_at, birim_fiyat, tc_no, musteri_unvan)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BM}', 'Üretimde', DATE '1999-01-02', '2026-10-30 08:00:00+00', 'FIYATMARKER', 'TCMARKER', 'Gizli Unvan'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${BM}', 'Tamamlandı', DATE '1999-01-02', '2026-10-29 08:00:00+00', NULL, NULL, NULL);
      INSERT INTO public.is_emirleri (id, firma_id, durum, siparis_id, updated_at)
      VALUES
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${BM}', 'Aktif', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-30 09:00:00+00'),
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${BM}', 'Aktif', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-10-30 09:00:00+00'),
        ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${BM}', 'Aktif', NULL, '2026-10-30 09:00:00+00');
      INSERT INTO public.gorevler (id, firma_id, durum, updated_at)
      VALUES
        ('ffffffff-ffff-4fff-8fff-ffffffffffff', '${BM}', 'Açık', '2026-10-30 10:00:00+00'),
        ('99999999-9999-4999-8999-999999999999', '${BM}', 'Devam', '2026-10-30 10:00:00+00'),
        ('88888888-8888-4888-8888-888888888888', '${BM}', 'Bitti', '2026-10-30 10:00:00+00');
      INSERT INTO public.siparisler (id, firma_id, durum, teslim_tarihi, updated_at)
      SELECT gen_random_uuid(), '${TM}', 'Üretimde', DATE '1999-01-02', '2026-10-30 08:00:00+00'
      FROM generate_series(1, 4);
      INSERT INTO public.is_emirleri (id, firma_id, durum, siparis_id, updated_at)
      SELECT gen_random_uuid(), '${TM}', 'Aktif', s.id, '2026-10-30 09:00:00+00'
      FROM public.siparisler s WHERE s.firma_id = '${TM}';
      INSERT INTO public.gorevler (id, firma_id, durum, updated_at)
      SELECT gen_random_uuid(), '${TM}', 'Açık', '2026-10-30 11:00:00+00'
      FROM generate_series(1, 7);
      INSERT INTO public.siparisler (id, firma_id, durum, teslim_tarihi, updated_at)
      VALUES ('12121212-1212-4212-8212-121212121212', '${BAD}', 'Uydurma', DATE '1999-01-02', '2026-10-30 08:00:00+00');
    `]);

    const direct = psql(db, ['-c', `SET ROLE btd_shadow_kopru; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1);`]);
    ok(direct.code !== 0, 'bridge login cannot execute the function');
    const switched = jsonQuery(db, `SET ROLE btd_shadow_kopru; SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1)::text; RESET ROLE;`);
    ok(switched.ok === true && switched.data.geciken_is_emri_adet === 1 && switched.data.acik_gorev_adet === 2, 'set role reader returns the synthetic summary');
    const anonCall = psql(db, ['-c', `SET ROLE anon; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1);`]);
    ok(anonCall.code !== 0, 'anon execution is denied');
    const serviceCall = psql(db, ['-c', `SET ROLE service_role; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1);`]);
    ok(serviceCall.code !== 0, 'service_role execution is denied');
    const tableCall = psql(db, ['-c', 'SET ROLE btd_shadow_okuyucu; SELECT birim_fiyat FROM public.siparisler;']);
    ok(tableCall.code !== 0, 'reader cannot select price rows');

    const tempFile = writeSql(dir, 'temp-now.sql', `
      CREATE FUNCTION pg_temp.now() RETURNS timestamptz
      LANGUAGE sql AS $$ SELECT timestamptz '1999-01-01 00:00:00+00' $$;
      SET ROLE btd_shadow_okuyucu;
      SELECT public.btd_shadow_jti_tuket('btd', 'temp-now-jti', 'tek_kullanim', '${BM}', timestamptz '2000-01-01 00:00:00+00', NULL);
    `);
    const temp = psql(db, ['-tA', '-f', tempFile]);
    ok(temp.code === 0 && temp.out.split('\n').map((item) => item.trim()).includes('expired'), 'temp now() does not extend an expired jti');
    ok(query(db, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'temp-now-jti'") === '0', 'shadowed clock did not insert a jti');

    query(db, `ALTER ROLE btd_shadow_kopru PASSWORD '${password}'`);
    query(db, `CREATE ROLE btd_faz9_yabanci LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${otherPassword}'`);
    query(db, `CREATE ROLE btd_faz9_super LOGIN SUPERUSER PASSWORD '${superPassword}'`);
    const kopruUrl = localUrl('btd_shadow_kopru', password, db, 5432);
    async function setRoleDenied(roleName) {
      const client = new Client({ connectionString: kopruUrl, connectionTimeoutMillis: 2000 });
      await client.connect();
      try {
        await client.query(`SET ROLE ${roleName}`);
        return false;
      } catch {
        return true;
      } finally {
        try { await client.end(); } catch { /* kapali */ }
      }
    }
    ok(await setRoleDenied('service_role'), 'bridge connection cannot become service_role');
    ok(await setRoleDenied('postgres'), 'bridge connection cannot become postgres');
    const foreignUrl = localUrl('btd_faz9_yabanci', otherPassword, db, 5432);
    const superUrl = localUrl('btd_faz9_super', superPassword, db, 5432);
    secrets.push(kopruUrl, foreignUrl, superUrl);

    const consumed = await replayLib.databaseQuery(
      kopruUrl,
      "SELECT public.btd_shadow_jti_tuket('btd', 'user-bridge', 'tek_kullanim', $1::uuid, now() + interval '120 seconds', NULL) AS durum",
      [BM]
    );
    ok(consumed[0] && consumed[0].durum === 'ok', 'bridge connection consumes one user jti');
    const replayed = await replayLib.databaseQuery(
      kopruUrl,
      "SELECT public.btd_shadow_jti_tuket('btd', 'user-bridge', 'tek_kullanim', $1::uuid, now() + interval '120 seconds', NULL) AS durum",
      [BM]
    );
    ok(replayed[0] && replayed[0].durum === 'replay', 'the same user jti replays from postgres');

    let foreignBridge = false;
    try {
      await replayLib.databaseQuery(foreignUrl, 'SELECT public.btd_shadow_operasyon_ozet($1, $2::uuid, $3::int) AS payload', ['shadow-service', BM, 1]);
    } catch (err) {
      foreignBridge = err && err.reason === 'bridge';
    }
    ok(foreignBridge, 'foreign login fails the bridge proof');
    let superBridge = false;
    const readsBeforeSuper = reads();
    try {
      await replayLib.databaseQuery(superUrl, 'SELECT public.btd_shadow_operasyon_ozet($1, $2::uuid, $3::int) AS payload', ['shadow-service', BM, 1]);
    } catch (err) {
      superBridge = err && err.reason === 'bridge';
    }
    ok(superBridge && reads() === readsBeforeSuper, 'superuser url does not run the read');

    const sleeper = new Client({ connectionString: kopruUrl, application_name: 'btd-kopru-kes', connectionTimeoutMillis: 2000 });
    await sleeper.connect();
    await sleeper.query('BEGIN');
    await sleeper.query('SET LOCAL ROLE btd_shadow_okuyucu');
    const pending = sleeper.query(
      "SELECT public.btd_shadow_jti_tuket('btd', 'jti-kes', 'tek_kullanim', $1::uuid, now() + interval '120 seconds', NULL), pg_sleep(2)",
      [BM]
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const terminated = query(db, "SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'btd-kopru-kes' AND pid <> pg_backend_pid()) s");
    let dropped = false;
    try {
      await pending;
    } catch {
      dropped = true;
    }
    try { await sleeper.end(); } catch { /* kopuk */ }
    ok(terminated === '1' && dropped, 'dropping the session aborts the open transaction');
    ok(query(db, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'jti-kes'") === '0', 'aborted consume leaves no jti');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', 'jti-kes', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'ok', 'the same jti can succeed after the abort');

    arm(kopruUrl, kopruUrl);
    let res = await call(serviceToken(BM, { jti: 'http-bm' }));
    const bmText = JSON.stringify(res.body);
    ok(res.statusCode === 200 && res.body.freshness === 'FRESH' && res.body.data && res.body.data.geciken_is_emri_adet === 1 && res.body.data.acik_gorev_adet === 2, 'authorized BM service read');
    ok(res.body.data.siparis_ozet.length === 2, 'BM order status counts');
    ok(res.body.writes === false && res.body.identity.iss === 'shadow' && res.body.read !== 'BLOCKED', 'BM response is a service read');
    ok(!bmText.includes('FIYATMARKER') && !bmText.includes('TCMARKER') && !bmText.includes('Gizli Unvan') && !bmText.includes('1999-01-02'), 'BM response drops price, identity, and due date');
    ok(String(res.body.data.guncellendi).startsWith('2026-10-30T10:00:00'), 'BM stamp is the newest updated_at');
    httpCounts.fresh += 1;

    res = await call(serviceToken(EMPTY, { jti: 'http-empty' }), EMPTY);
    ok(res.statusCode === 200 && res.body.freshness === 'FRESH' && res.body.data.siparis_ozet.length === 0 && res.body.data.geciken_is_emri_adet === 0 && res.body.data.acik_gorev_adet === 0 && res.body.data.guncellendi === null, 'empty firm is a real zero');
    httpCounts.fresh += 1;

    res = await call(serviceToken(BAD, { jti: 'http-bad' }), BAD);
    ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null && res.body.read !== 'BLOCKED', 'unknown status is unavailable');
    ok(!JSON.stringify(res.body).includes('geciken_is_emri_adet') && !JSON.stringify(res.body).includes('acik_gorev_adet'), 'unknown status has no partial count');
    httpCounts.unavailable += 1;

    res = await call(serviceToken(TM, { jti: 'http-tm' }), TM);
    ok(res.statusCode === 403 && res.body.freshness === 'PERMISSION_DENIED' && res.body.data == null, 'TM outside the registry is 403');
    ok(!JSON.stringify(res.body).includes('acik_gorev_adet') && !JSON.stringify(res.body).includes('geciken_is_emri_adet'), 'TM denial has no counts');
    httpCounts.denied += 1;

    const reusable = serviceToken(BM, { jti: 'http-tekrar' });
    const first = await call(reusable);
    const second = await call(reusable);
    ok(first.statusCode === 200 && second.statusCode === 200 && first.body.data.geciken_is_emri_adet === 1 && second.body.data.acik_gorev_adet === 2, 'reusable jti reads the same totals twice');
    ok(query(db, "SELECT kullanim::text FROM public.btd_shadow_jti WHERE jti = 'http-tekrar'") === '2', 'reusable jti recorded two uses');
    httpCounts.fresh += 2;

    const once = serviceToken(BM, { jti: 'http-once', use: 'once' });
    res = await call(once);
    ok(res.statusCode === 200 && res.body.data.geciken_is_emri_adet === 1, 'single-use service read succeeds once');
    httpCounts.fresh += 1;
    res = await call(once);
    ok(res.statusCode === 401 && res.body.freshness !== 'UNAVAILABLE' && res.body.data == null, 'repeated single-use jti is 401');
    httpCounts.rejected += 1;

    arm(kopruUrl, kopruUrl);
    const raced = serviceToken(BM, { jti: 'http-yaris', use: 'once' });
    const pair = await Promise.all([call(raced), call(raced)]);
    const statuses = pair.map((item) => item.statusCode).sort();
    ok(statuses[0] === 200 && statuses[1] === 401, 'parallel single-use requests yield one read and one 401');
    ok(pair.filter((item) => item.statusCode === 200)[0].body.data.acik_gorev_adet === 2, 'the winning parallel read is the BM total');
    ok(query(db, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'http-yaris'") === '1', 'parallel race stored one jti');
    httpCounts.fresh += 1;
    httpCounts.rejected += 1;

    const closed = localUrl('btd_shadow_kopru', password, db, 1);
    secrets.push(closed);
    arm(kopruUrl, closed);
    const cut = serviceToken(BM, { jti: 'http-kopuk', use: 'once' });
    res = await call(cut);
    ok(res.statusCode === 200 && res.body.freshness === 'UNAVAILABLE' && res.body.data === null && res.body.read !== 'BLOCKED', 'closed reader port is unavailable');
    ok(!JSON.stringify(res.body).includes('geciken_is_emri_adet') && !JSON.stringify(res.body).includes('"adet":0'), 'closed port does not invent a zero');
    httpCounts.unavailable += 1;
    res = await call(cut);
    ok(res.statusCode === 401, 'single-use jti stays consumed after the failed read');
    ok(query(db, "SELECT durum FROM public.btd_shadow_jti WHERE jti = 'http-kopuk'") === 'tuketildi', 'failed read left the single-use jti completed');
    httpCounts.rejected += 1;

    arm(kopruUrl, superUrl);
    const beforeBlocked = reads();
    res = await call(serviceToken(BM, { jti: 'http-super' }));
    ok(res.statusCode === 200 && res.body.read === 'BLOCKED' && res.body.data === null && reads() === beforeBlocked, 'superuser reader url stays blocked and does not read');
    httpCounts.blocked += 1;
    arm(kopruUrl, foreignUrl);
    res = await call(serviceToken(BM, { jti: 'http-yabanci' }));
    ok(res.statusCode === 200 && res.body.read === 'BLOCKED' && res.body.data === null, 'foreign reader url stays blocked');
    httpCounts.blocked += 1;

    arm(kopruUrl, kopruUrl);
    const beforeReject = reads();
    res = await call('baslik.bozuk');
    ok(res.statusCode === 401 && res.body.freshness !== 'UNAVAILABLE' && reads() === beforeReject, 'bad signature is 401 and does not read');
    httpCounts.rejected += 1;
    res = await call(serviceToken(BM, { jti: 'http-sure', nowSec: Math.floor(Date.now() / 1000) - 400, ttlSec: 30 }));
    ok(res.statusCode === 401 && res.body.freshness !== 'UNAVAILABLE', 'expired service token is 401');
    httpCounts.rejected += 1;

    query(db, "UPDATE public.btd_servis_kayit SET iptal_zamani = now() WHERE servis_kod = 'shadow-service'");
    res = await call(serviceToken(BM, { jti: 'http-iptal' }));
    ok(res.statusCode === 401 && res.body.data == null && res.body.freshness !== 'UNAVAILABLE', 'revoked service registry is 401');
    httpCounts.rejected += 1;
    query(db, "UPDATE public.btd_servis_kayit SET iptal_zamani = NULL, etkin = false WHERE servis_kod = 'shadow-service'");
    res = await call(serviceToken(BM, { jti: 'http-kapali' }));
    ok(res.statusCode === 401, 'disabled service registry is 401');
    httpCounts.rejected += 1;
    query(db, "UPDATE public.btd_servis_kayit SET etkin = true, gecerlilik_sonu = now() - interval '1 minute' WHERE servis_kod = 'shadow-service'");
    res = await call(serviceToken(BM, { jti: 'http-kayit-sure' }));
    ok(res.statusCode === 401, 'expired service registry is 401');
    httpCounts.rejected += 1;
    query(db, "UPDATE public.btd_servis_kayit SET gecerlilik_sonu = now() + interval '1 day', anahtar_surum = 9 WHERE servis_kod = 'shadow-service'");
    res = await call(serviceToken(BM, { jti: 'http-kv' }));
    ok(res.statusCode === 401, 'wrong key version is 401');
    httpCounts.rejected += 1;
    query(db, "UPDATE public.btd_servis_kayit SET anahtar_surum = 1 WHERE servis_kod = 'shadow-service'");

    ok(restCalls === 0, 'service handler did not call supabase rest');
    ok(!JSON.stringify(res.body).includes(password), 'responses do not echo the bridge secret');

    applyFile(db, dir, copyRollback);
    ok(query(db, "SELECT count(*) FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === '0', '031 rollback drops the bridge login');
    ok(query(db, "SELECT rolcanlogin::text FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu'") === 'false', '031 rollback keeps the reader nologin');
    ok(query(db, "SELECT (to_regprocedure('public.btd_shadow_operasyon_ozet(text,uuid,integer)') IS NOT NULL)::text") === 'true', '031 rollback keeps the functions');
    const still = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1)::text; RESET ROLE;`);
    ok(still.ok === true && still.data.geciken_is_emri_adet === 1, 'reader function still answers after the bridge rollback');
  } catch (err) {
    if (!process.exitCode) {
      console.error(redact(err && err.stack ? err.stack : err));
      process.exitCode = 1;
    }
  } finally {
    delete process.env.BTD_SHADOW_REPLAY_DATABASE_URL;
    delete process.env.BTD_SHADOW_READER_DATABASE_URL;
    try { replayLib.detachSecurity(); } catch { /* modul yuklenmedi */ }
    try {
      query('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()`);
    } catch { /* kapanis */ }
    try {
      query('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    } catch {
      try { query('postgres', `DROP DATABASE IF EXISTS ${db}`); } catch { /* yerel temizlik */ }
    }
    for (const role of ['btd_faz9_super', 'btd_faz9_yabanci', 'btd_shadow_kopru']) {
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* rol kullaniliyor olabilir */ }
    }
    for (const role of ['btd_shadow_okuyucu', 'anon', 'authenticated', 'service_role']) {
      if (before.has(role)) continue;
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* rol kullaniliyor olabilir */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (process.exitCode) process.exit(process.exitCode);
  console.log(`shadow kopru: ${passed} passed (local postgres 127.0.0.1, synthetic BM/TM, not staging, not production)`);
  console.log(`shadow kopru http: fresh ${httpCounts.fresh}, denied ${httpCounts.denied}, unavailable ${httpCounts.unavailable}, blocked ${httpCounts.blocked}, rejected ${httpCounts.rejected}`);
}

main().catch((err) => {
  console.error(redact(err && err.stack ? err.stack : err));
  process.exit(1);
});
