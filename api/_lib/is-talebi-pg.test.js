'use strict';

// AE-BTD-25C. Atılan yerel veritabanı. Üretim adresi yok.
// supabase/drafts/is_talebi_taslak_v1.sql uygulanmaz; yazma engeli durur.
// Bu dosya bellek simülasyonu değildir. Postgres yoksa PASS yazmaz.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const draft = require('./business-request-draft');

const root = path.join(__dirname, '..', '..');
const harnessPath = path.join(__dirname, 'is-talebi-pg.harness.sql');
const draftPath = path.join(root, 'supabase/drafts/is_talebi_taslak_v1.sql');
const FIRMA_A = '11111111-1111-4111-8111-111111111111';
const FIRMA_B = '33333333-3333-4333-8333-333333333333';
const KEY = 'synthetic-mail-rfq-001';
const HASH = 'hash-same';
const OTHER_HASH = 'hash-other';
const REF = '<rfq-synthetic-001@local>';
const CORR = '5a2446b4-6e18-451c-85d1-54e34684737a';

function fail(reason) {
  console.error(`is talebi postgres: FAIL ${reason}`);
  process.exit(1);
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
    fail('refused non-local database');
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

function runFile(database, file) {
  return new Promise((resolve) => {
    const child = spawn('sudo', [
      '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-tA', '-f', file,
    ], { env: Object.assign({}, process.env, { PGCLIENTENCODING: 'UTF8' }) });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function callSql(role, hash, key) {
  return `
SET ROLE ${role};
SELECT public.btd_talep_kaydet_test(
  '${key || KEY}',
  '${hash}',
  '${REF}',
  '${CORR}',
  'mock-tenant',
  'mock-provider',
  'mock-mailbox'
);
`;
}

async function main() {
  refuseRemote();
  if (draft.LIVE_WRITES_ENABLED !== false) fail('live writes must stay closed');
  const draftSql = fs.readFileSync(draftPath, 'utf8');
  const raiseAt = draftSql.indexOf('RAISE EXCEPTION');
  const createAt = draftSql.indexOf('CREATE TABLE');
  if (raiseAt < 0 || createAt < 0 || raiseAt > createAt) fail('draft write block missing');
  if (!draftSql.includes('Yazma kapali')) fail('draft guard text missing');

  try {
    execFileSync('pg_isready', ['-h', '/var/run/postgresql'], { stdio: 'ignore' });
    query('postgres', 'SELECT 1');
  } catch {
    fail('local postgres socket');
  }

  const db = `btd_talep_${Date.now().toString(36)}`;
  const before = new Set(psql('postgres', ['-tA', '-c', 'SELECT rolname FROM pg_roles']).split('\n').map((item) => item.trim()).filter(Boolean));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btd-talep-'));
  fs.chmodSync(dir, 0o755);
  function writeSql(name, contents) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    fs.chmodSync(file, 0o644);
    return file;
  }
  const draftCopy = writeSql('draft.sql', draftSql);
  const harnessCopy = writeSql('harness.sql', fs.readFileSync(harnessPath));
  let passed = 0;
  function ok(cond, message) {
    if (!cond) {
      console.error(`is talebi postgres: FAIL ${message}`);
      throw new Error(message);
    }
    passed += 1;
    console.log(`ok ${message}`);
  }

  try {
    query('postgres', `CREATE DATABASE ${db}`);
    let blocked = false;
    try {
      psql(db, ['-f', draftCopy]);
    } catch (err) {
      blocked = String(err.stderr || err.message).includes('Yazma kapali')
        || String(err.stderr || err.message).includes('uygulanmaz');
    }
    ok(blocked, 'draft sql still stops before changes');
    ok(query(db, "SELECT to_regclass('public.is_talepleri') IS NULL") === 't', 'draft sql creates no table');

    psql(db, ['-f', harnessCopy]);
    ok(query(db, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'btd_talep_a'") === 'f|f', 'role a is not superuser and does not bypass rls');
    ok(query(db, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'btd_talep_b'") === 'f|f', 'role b is not superuser and does not bypass rls');
    ok(query(db, "SELECT prosecdef FROM pg_proc WHERE proname = 'btd_talep_kaydet_test'") === 'f', 'insert function is security invoker');
    ok(query(db, "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'is_talepleri'") === 't|t', 'draft table forces row security');

    psql(db, ['-c', `
      INSERT INTO public.talep_uyelik (rolname, firma_id) VALUES
        ('btd_talep_a', '${FIRMA_A}'),
        ('btd_talep_b', '${FIRMA_B}');
    `]);

    const roleLine = query(db, `
      SET ROLE btd_talep_a;
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user;
    `);
    ok(roleLine === 'btd_talep_a|f|f', 'session role is the limited role');

    const files = [];
    for (let i = 0; i < 8; i += 1) {
      files.push(writeSql(`race-${i}.sql`, callSql('btd_talep_a', HASH)));
    }
    const raced = await Promise.all(files.map((file) => runFile(db, file)));
    const ids = raced.flatMap((item) => item.out.split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-f-]{36}$/i.test(line)));
    ok(raced.every((item) => item.code === 0), 'concurrent calls commit');
    ok(ids.length === 8 && new Set(ids).size === 1, 'concurrent same key returns one id');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND idempotency_key = '${KEY}'`) === '1', 'concurrent same firm and key is one row');
    ok(query(db, 'SELECT count(*) FROM public.gorevler') === '0', 'intake does not create a gorev');
    ok(query(db, `SELECT review_status || '|' || source_message_ref || '|' || idempotency_key || '|' || correlation_id FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}'`) === `incelemede|${REF}|${KEY}|${CORR}`, 'message id and idempotency key stay separate');

    const conflictFile = writeSql('conflict.sql', callSql('btd_talep_a', OTHER_HASH));
    const conflict = await runFile(db, conflictFile);
    ok(conflict.code !== 0 && conflict.err.includes('idempotency_conflict'), 'changed payload is a conflict');
    ok(query(db, `SELECT content_hash FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND idempotency_key = '${KEY}'`) === HASH, 'conflict does not overwrite');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}'`) === '1', 'conflict does not add a row');

    ok(query(db, `SET ROLE btd_talep_b; SELECT count(*) FROM public.is_talepleri;`) === '0', 'other firm sees no rows');
    let crossInsert = false;
    try {
      query(db, `
        SET ROLE btd_talep_b;
        INSERT INTO public.is_talepleri (
          firma_id, tenant_id, provider, mailbox, actor_rol,
          source_message_ref, correlation_id, idempotency_key, content_hash, review_status
        ) VALUES (
          '${FIRMA_A}', 'mock-tenant', 'mock-provider', 'mock-mailbox', 'btd_talep_b',
          'x', 'y', 'foreign-key', 'h', 'incelemede'
        );
      `);
    } catch {
      crossInsert = true;
    }
    ok(crossInsert, 'other firm cannot insert into the first firm');
    let taskInsert = false;
    try {
      query(db, `SET ROLE btd_talep_a; INSERT INTO public.gorevler (firma_id, durum) VALUES ('${FIRMA_A}', 'Açık');`);
    } catch {
      taskInsert = true;
    }
    ok(taskInsert, 'limited role cannot insert a gorev');
    ok(query(db, 'SELECT count(*) FROM public.gorevler') === '0', 'gorev table stays empty');

    const own = query(db, callSql('btd_talep_b', HASH).replace(/\n/g, ' '));
    ok(/^[0-9a-f-]{36}$/i.test(own), 'second firm can store its own draft');
    ok(query(db, `SET ROLE btd_talep_a; SELECT count(*) FROM public.is_talepleri;`) === '1', 'first firm still sees only itself');
    ok(query(db, 'SELECT count(*) FROM public.is_talepleri') === '2', 'superuser count is not the isolation proof');

    console.log(`is talebi postgres: ${passed} passed (local cluster, synthetic firms, not production, not memory)`);
  } finally {
    try {
      query('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    } catch {
      try { query('postgres', `DROP DATABASE IF EXISTS ${db}`); } catch { /* cleanup */ }
    }
    for (const role of ['btd_talep_a', 'btd_talep_b']) {
      if (before.has(role)) continue;
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* cleanup */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
