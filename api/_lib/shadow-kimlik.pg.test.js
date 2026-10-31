'use strict';

// İzole yerel Postgres. Uzak adres reddedilir. Üretim verisi okunmaz.
// Sentetik BM ve TM kiracıları bu sürecin kendi veritabanındadır.
// Mock sayılmaz. Bağlantı kurulamazsa NOT TESTED.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const migration = path.join(root, 'supabase/030_shadow_kimlik.sql');
const rollback = path.join(root, 'supabase/030_shadow_kimlik_rollback.sql');
const BM = '11111111-1111-4111-8111-111111111111';
const TM = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';
const BAD = '44444444-4444-4444-8444-444444444444';

function skip(reason) {
  console.log(`shadow postgres: NOT TESTED ${reason}`);
  process.exit(0);
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
  return execFileSync('sudo', [
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
}

function query(database, sql) {
  const lines = psql(database, ['-tA', '-c', sql]).split('\n').map((item) => item.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function jsonQuery(database, sql) {
  const text = psql(database, ['-tA', '-c', sql]);
  const line = text.split('\n').map((item) => item.trim()).find((item) => item.startsWith('{'));
  if (!line) throw new Error(`json yok: ${text.slice(0, 180)}`);
  return JSON.parse(line);
}

async function main() {
  refuseRemote();
  try {
    execFileSync('pg_isready', ['-h', '/var/run/postgresql'], { stdio: 'ignore' });
  } catch {
    skip('local socket');
  }
  try {
    query('postgres', 'SELECT 1');
  } catch {
    skip('local peer');
  }

  const db = `btd_faz8_${Date.now().toString(36)}`;
  const before = new Set(psql('postgres', ['-tA', '-c', 'SELECT rolname FROM pg_roles']).split('\n').map((item) => item.trim()).filter(Boolean));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btd-faz8-'));
  fs.chmodSync(dir, 0o755);
  function writeSql(name, contents) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    fs.chmodSync(file, 0o644);
    return file;
  }
  const migrationCopy = writeSql('030.sql', fs.readFileSync(migration));
  let passed = 0;
  function ok(cond, message) {
    if (!cond) {
      console.error(`shadow postgres failed: ${message}`);
      process.exitCode = 1;
      throw new Error(message);
    }
    passed += 1;
  }

  try {
    query('postgres', `CREATE DATABASE ${db}`);
    const stub = `
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
    `;
    psql(db, ['-c', stub]);
    let guardError = '';
    try {
      psql(db, ['-f', migrationCopy]);
    } catch (err) {
      guardError = `${err.stderr || ''}`;
    }
    ok(guardError.includes('Durdu'), 'migration refuses to run without the session flag');
    const apply = writeSql('apply.sql', `SELECT set_config('btd.allow_shadow_kimlik', 'on', false);\n\\i ${migrationCopy}\n`);
    psql(db, ['-f', apply]);
    ok(query(db, "SELECT to_regclass('public.btd_shadow_jti')") === 'btd_shadow_jti', 'jti table exists');

    const seed = `
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
    `;
    psql(db, ['-c', seed]);

    const bm = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1)::text; RESET ROLE;`);
    ok(bm.ok === true, 'bm read authorized');
    ok(bm.data.geciken_is_emri_adet === 1, 'bm overdue count');
    ok(bm.data.acik_gorev_adet === 2, 'bm open task count');
    ok(bm.data.siparis_ozet.length === 2, 'bm order statuses');
    const uretim = bm.data.siparis_ozet.find((row) => row.durum === 'Üretimde');
    const bitti = bm.data.siparis_ozet.find((row) => row.durum === 'Tamamlandı');
    ok(uretim && uretim.adet === 1 && uretim.kaynak_id === 'siparisler', 'bm in-production count');
    ok(bitti && bitti.adet === 1, 'bm completed count');
    ok(bm.data.guncellendi && bm.data.guncellendi.startsWith('2026-10-30T10:00:00'), 'bm freshness stamp is the newest updated_at');
    const bmText = JSON.stringify(bm);
    ok(!bmText.includes('FIYATMARKER') && !bmText.includes('TCMARKER') && !bmText.includes('Gizli Unvan'), 'bm payload drops price and personal data');
    ok(!bmText.includes('1999-01-02') && !bmText.includes('teslim_tarihi'), 'bm payload drops the due date');
    ok(bm.data.geciken_is_emri_adet !== 4 && bm.data.acik_gorev_adet !== 7, 'bm payload is not the tm total');

    const tmDenied = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${TM}', 1)::text; RESET ROLE;`);
    ok(tmDenied.ok === false && tmDenied.reason === 'firma', 'tm is outside the registry');
    ok(!JSON.stringify(tmDenied).includes('"acik_gorev_adet"') && !JSON.stringify(tmDenied).includes('"geciken_is_emri_adet"'), 'denied tm read has no counts');

    const empty = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${EMPTY}', 1)::text; RESET ROLE;`);
    ok(empty.ok === true && empty.data.siparis_ozet.length === 0 && empty.data.geciken_is_emri_adet === 0 && empty.data.acik_gorev_adet === 0 && empty.data.guncellendi === null, 'empty firm is a real zero');

    const bad = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BAD}', 1)::text; RESET ROLE;`);
    ok(bad.ok === false && bad.reason === 'status' && !JSON.stringify(bad).includes('adet'), 'unknown status fails closed');

    const again = jsonQuery(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1)::text; RESET ROLE;`);
    ok(again.data.geciken_is_emri_adet === 1 && again.data.acik_gorev_adet === 2, 'repeated read keeps the same counts');

    ok(query(db, "SELECT public.btd_servis_yetki('shadow-service', '" + BM + "', 'shadow.read', 1)") === 'ok', 'current key version');
    psql(db, ['-c', `UPDATE public.btd_servis_kayit SET anahtar_surum = 2, onceki_anahtar_surum = 1 WHERE servis_kod = 'shadow-service'`]);
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_servis_yetki('shadow-service', '${BM}', 'shadow.read', 1);`) === 'ok', 'previous key version during rotation');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_servis_yetki('shadow-service', '${BM}', 'shadow.read', 2);`) === 'ok', 'new key version during rotation');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_servis_yetki('shadow-service', '${BM}', 'shadow.read', 3);`) === 'key', 'unknown key version');
    psql(db, ['-c', `UPDATE public.btd_servis_kayit SET onceki_anahtar_surum = NULL WHERE servis_kod = 'shadow-service'`]);
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_servis_yetki('shadow-service', '${BM}', 'shadow.read', 1);`) === 'key', 'retired key version');
    psql(db, ['-c', `UPDATE public.btd_servis_kayit SET anahtar_surum = 1 WHERE servis_kod = 'shadow-service'`]);

    const jti = 'jti-tek-1';
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', '${jti}', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'ok', 'single-use insert');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', '${jti}', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'replay', 'single-use replay');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_geri_al('btd', '${jti}');`) === 'ok', 'single-use rollback while open');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', '${jti}', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'ok', 'single-use after rollback');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tamamla('btd', '${jti}');`) === 'ok', 'single-use complete');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_geri_al('btd', '${jti}');`) === 'committed', 'completed jti is not rolled back');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', '${jti}', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'replay', 'completed jti replays');

    const reusable = 'jti-tekrar-1';
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('shadow', '${reusable}', 'kisa_tekrar', '${BM}', now() + interval '120 seconds', 1);`) === 'ok', 'reusable first read');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('shadow', '${reusable}', 'kisa_tekrar', '${BM}', now() + interval '120 seconds', 1);`) === 'ok', 'reusable repeated read');
    ok(query(db, `SELECT kullanim FROM public.btd_shadow_jti WHERE jti = '${reusable}'`) === '2', 'reusable use count');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_geri_al('shadow', '${reusable}');`) === 'kept', 'rollback keeps a reusable token');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_iptal('shadow', '${reusable}');`) === 'ok', 'revoke reusable token');
    ok(query(db, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('shadow', '${reusable}', 'kisa_tekrar', '${BM}', now() + interval '120 seconds', 1);`) === 'revoked', 'revoked token fails closed');

    const txFile = writeSql('tx-rollback.sql', `
      BEGIN;
      SELECT public.btd_shadow_jti_tuket('btd', 'jti-tx', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);
      ROLLBACK;
    `);
    psql(db, ['-f', txFile]);
    ok(query(db, `SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'jti-tx'`) === '0', 'transaction rollback drops the jti');
    ok(query(db, `SELECT public.btd_shadow_jti_tuket('btd', 'jti-tx', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL)`) === 'ok', 'jti can succeed after a transaction rollback');

    const live = query(db, `SELECT count(*) FROM public.btd_shadow_jti WHERE jti = '${reusable}'`);
    const removed = query(db, `SELECT public.btd_shadow_jti_temizle(now())`);
    ok(removed === '0', 'cleanup does not delete unexpired rows');
    ok(query(db, `SELECT count(*) FROM public.btd_shadow_jti WHERE jti = '${reusable}'`) === live, 'live jti remains after cleanup');

    let anonDenied = false;
    try {
      query(db, `SET ROLE anon; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1);`);
    } catch {
      anonDenied = true;
    }
    ok(anonDenied, 'anon cannot execute the read');
    let serviceDenied = false;
    try {
      query(db, `SET ROLE service_role; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1);`);
    } catch {
      serviceDenied = true;
    }
    ok(serviceDenied, 'service_role cannot execute the read');
    let tableDenied = false;
    try {
      query(db, `SET ROLE btd_shadow_okuyucu; SELECT birim_fiyat FROM public.siparisler;`);
    } catch {
      tableDenied = true;
    }
    ok(tableDenied, 'reader role cannot select business rows');
    ok(query(db, "SELECT has_function_privilege('service_role', 'public.btd_shadow_operasyon_ozet(text,uuid,integer)', 'EXECUTE')") === 'f', 'service_role execute privilege is false');
    ok(query(db, "SELECT count(*) FROM pg_policies WHERE tablename IN ('btd_shadow_jti', 'btd_servis_kayit', 'btd_servis_denetim')") === '0', 'no client firma policy');

    const race = writeSql('race.sql', `
      BEGIN;
      SELECT public.btd_shadow_jti_tuket('btd', 'jti-yaris', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);
      SELECT pg_sleep(1);
      COMMIT;
    `);
    const waiter = writeSql('waiter.sql', `
      BEGIN;
      SELECT public.btd_shadow_jti_tuket('btd', 'jti-yaris', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);
      COMMIT;
    `);
    const { spawn } = require('child_process');
    function runSql(file) {
      return new Promise((resolve) => {
        const child = spawn('sudo', ['-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-tA', '-f', file]);
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.stderr.on('data', (chunk) => { err += chunk; });
        child.on('close', (code) => resolve({ code, out, err }));
      });
    }
    const holder = runSql(race);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const waiting = await runSql(waiter);
    const held = await holder;
    const lines = `${held.out}\n${waiting.out}`.split('\n').map((item) => item.trim()).filter(Boolean);
    ok(held.code === 0 && waiting.code === 0, 'concurrent sessions commit');
    ok(lines.filter((item) => item === 'ok').length === 1, 'concurrent single-use has one success');
    ok(lines.filter((item) => item === 'replay').length === 1, 'concurrent single-use has one replay');
    ok(query(db, `SELECT public.btd_shadow_jti_tuket('btd', 'jti-yaris', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL)`) === 'replay', 'third single-use attempt replays');
  } catch (err) {
    if (!process.exitCode) {
      console.error(err);
      process.exitCode = 1;
    }
  } finally {
    try {
      query('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    } catch {
      try { query('postgres', `DROP DATABASE IF EXISTS ${db}`); } catch { /* local cleanup */ }
    }
    for (const role of ['btd_shadow_okuyucu', 'anon', 'authenticated', 'service_role']) {
      if (before.has(role)) continue;
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* role may still be in use */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (process.exitCode) process.exit(process.exitCode);
  console.log(`shadow postgres: ${passed} passed (local socket, synthetic BM/TM, not production)`);
  console.log(`shadow postgres bm counts: overdue 1, open tasks 2, order statuses 2`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
