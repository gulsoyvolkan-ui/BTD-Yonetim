'use strict';

// AE-BTD-25E. Atılan yerel veritabanı. Üretim adresi yok.
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
const REF_OTHER = '<rfq-synthetic-002@local>';
const REF_RACE = '<rfq-synthetic-race@local>';
const KEY_OTHER = 'synthetic-mail-rfq-002';
const MAILBOX_OTHER = 'mb-finans';
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

function callSql(role, hashOrOpts, key) {
  if (role !== 'btd_talep_a' && role !== 'btd_talep_b') fail('untrusted role');
  const opts = hashOrOpts && typeof hashOrOpts === 'object' ? hashOrOpts : {};
  const hash = opts.hash || (typeof hashOrOpts === 'string' ? hashOrOpts : HASH);
  const idem = opts.key || key || KEY;
  const ref = opts.ref || REF;
  const corr = opts.corr || CORR;
  const tenant = opts.tenant || 'mock-tenant';
  const provider = opts.provider || 'mock-provider';
  const mailbox = opts.mailbox || 'mock-mailbox';
  for (const value of [hash, idem, ref, corr, tenant, provider, mailbox]) {
    if (String(value).includes("'")) fail('quote');
  }
  return `
SET ROLE ${role};
SELECT public.btd_talep_kaydet_test(
  '${idem}',
  '${hash}',
  '${ref}',
  '${corr}',
  '${tenant}',
  '${provider}',
  '${mailbox}'
);
`;
}

function draftId(result) {
  const lines = String(result.out || '').split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-f-]{36}$/i.test(line));
  return lines.length ? lines[lines.length - 1] : '';
}

function firmRows(db, firma) {
  return query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${firma}'`);
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
    const defs = psql(db, ['-tA', '-c', "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.is_talepleri'::regclass AND contype = 'u' ORDER BY 1"]).trim();
    ok(defs.split('\n').filter(Boolean).length === 2, 'two separate unique constraints');
    ok(defs.includes('UNIQUE (tenant_id, provider, mailbox, firma_id, idempotency_key)'), 'unique idempotency scope');
    ok(defs.includes('UNIQUE (tenant_id, provider, mailbox, firma_id, source_message_ref)'), 'unique source message scope');
    ok(!defs.includes('idempotency_key, source_message_ref'), 'columns are not one combined unique');
    const fnSrc = psql(db, ['-tA', '-c', "SELECT prosrc FROM pg_proc WHERE proname = 'btd_talep_kaydet_test'"]);
    ok(fnSrc.includes('ON CONFLICT DO NOTHING') && !fnSrc.includes('DO UPDATE') && !fnSrc.includes('UPDATE public.is_talepleri'), 'on conflict handles both uniques without updating');
    ok(query(db, `SELECT has_table_privilege('btd_talep_a', 'public.is_talepleri', 'SELECT')::text || '|' || has_table_privilege('btd_talep_a', 'public.is_talepleri', 'INSERT')::text || '|' || has_table_privilege('btd_talep_a', 'public.is_talepleri', 'UPDATE')::text || '|' || has_table_privilege('btd_talep_a', 'public.is_talepleri', 'DELETE')::text`) === 'true|true|false|false', 'role a can read and insert but not update or delete');
    ok(query(db, `SELECT has_table_privilege('btd_talep_b', 'public.is_talepleri', 'SELECT')::text || '|' || has_table_privilege('btd_talep_b', 'public.is_talepleri', 'INSERT')::text || '|' || has_table_privilege('btd_talep_b', 'public.is_talepleri', 'UPDATE')::text || '|' || has_table_privilege('btd_talep_b', 'public.is_talepleri', 'DELETE')::text`) === 'true|true|false|false', 'role b can read and insert but not update or delete');
    ok(query(db, `SELECT has_table_privilege('btd_talep_a', 'public.gorevler', 'INSERT')::text || '|' || has_table_privilege('btd_talep_b', 'public.gorevler', 'INSERT')::text`) === 'false|false', 'neither role can insert a gorev');
    ok(query(db, `SELECT has_table_privilege('btd_talep_a', 'public.talep_uyelik', 'INSERT')::text`) === 'false', 'role cannot grant itself another firm');

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

    const replay = await runFile(db, writeSql('replay.sql', callSql('btd_talep_a', HASH)));
    ok(replay.code === 0 && draftId(replay) === ids[0], 'same source and same key keeps one draft');
    ok(firmRows(db, FIRMA_A) === '1', 'replay does not add a draft');

    const otherKey = await runFile(db, writeSql('other-key.sql', callSql('btd_talep_a', { key: KEY_OTHER, hash: HASH, ref: REF })));
    ok(otherKey.code !== 0 && otherKey.err.includes('kaynak_mesaj_ayri_anahtar'), 'same source and different key is a 409 conflict');
    ok(firmRows(db, FIRMA_A) === '1', 'different key leaves one draft');
    ok(query(db, `SELECT idempotency_key FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND source_message_ref = '${REF}'`) === KEY, 'different key does not replace the stored key');

    const otherRef = await runFile(db, writeSql('other-ref.sql', callSql('btd_talep_a', { key: KEY, hash: HASH, ref: REF_OTHER })));
    ok(otherRef.code !== 0 && otherRef.err.includes('idempotency_conflict'), 'different source and same key is a 409 conflict');
    ok(firmRows(db, FIRMA_A) === '1', 'different source leaves one draft');
    ok(query(db, `SELECT source_message_ref FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND idempotency_key = '${KEY}'`) === REF, 'different source does not replace the stored message');

    const conflictFile = writeSql('conflict.sql', callSql('btd_talep_a', OTHER_HASH));
    const conflict = await runFile(db, conflictFile);
    ok(conflict.code !== 0 && conflict.err.includes('idempotency_conflict'), 'changed payload is a conflict');
    ok(query(db, `SELECT content_hash FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND idempotency_key = '${KEY}'`) === HASH, 'conflict does not overwrite');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}'`) === '1', 'conflict does not add a row');
    ok(query(db, `SELECT idempotency_key || '|' || source_message_ref || '|' || content_hash FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}'`) === `${KEY}|${REF}|${HASH}`, 'conflict does not change key message or hash');

    let rawSource = '';
    try {
      query(db, `
        SET ROLE btd_talep_a;
        INSERT INTO public.is_talepleri (
          firma_id, tenant_id, provider, mailbox, actor_rol,
          source_message_ref, correlation_id, idempotency_key, content_hash, review_status
        ) VALUES (
          '${FIRMA_A}', 'mock-tenant', 'mock-provider', 'mock-mailbox', 'btd_talep_a',
          '${REF}', '${CORR}', '${KEY_OTHER}', '${HASH}', 'incelemede'
        );
      `);
    } catch (err) {
      rawSource = String(err.stderr || err.message);
    }
    ok(rawSource.includes('is_talepleri_source_message_uq'), 'unique constraint rejects the same source with a different key');
    let rawKey = '';
    try {
      query(db, `
        SET ROLE btd_talep_a;
        INSERT INTO public.is_talepleri (
          firma_id, tenant_id, provider, mailbox, actor_rol,
          source_message_ref, correlation_id, idempotency_key, content_hash, review_status
        ) VALUES (
          '${FIRMA_A}', 'mock-tenant', 'mock-provider', 'mock-mailbox', 'btd_talep_a',
          '${REF_OTHER}', '${CORR}', '${KEY}', '${HASH}', 'incelemede'
        );
      `);
    } catch (err) {
      rawKey = String(err.stderr || err.message);
    }
    ok(rawKey.includes('is_talepleri_idempotency_uq'), 'unique constraint rejects the same key with a different source');
    ok(firmRows(db, FIRMA_A) === '1', 'raw unique violations leave one draft');

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
    ok(query(db, 'SELECT count(*) FROM public.is_talepleri') === '2', 'different firms keep independent rows');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE source_message_ref = '${REF}' AND idempotency_key = '${KEY}' AND mailbox = 'mock-mailbox'`) === '2', 'same key and source in two firms are two rows');

    const raceKeys = [];
    for (let i = 0; i < 8; i += 1) {
      raceKeys.push(writeSql(`race-key-${i}.sql`, callSql('btd_talep_a', {
        key: `synthetic-key-race-${i}`,
        hash: HASH,
        ref: REF_RACE,
      })));
    }
    const racedKeys = await Promise.all(raceKeys.map((file) => runFile(db, file)));
    const raceWins = racedKeys.filter((item) => item.code === 0);
    const raceStops = racedKeys.filter((item) => item.code !== 0);
    ok(raceWins.length === 1 && raceStops.length === 7, 'concurrent different keys and same source accept one call');
    ok(raceStops.every((item) => item.err.includes('kaynak_mesaj_ayri_anahtar')), 'losing keys are conflicts and do not update');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE source_message_ref = '${REF_RACE}'`) === '1', 'concurrent different keys leave one draft');
    ok(query(db, `SELECT content_hash FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND source_message_ref = '${REF}'`) === HASH, 'key race does not overwrite the first draft');

    const otherBox = await runFile(db, writeSql('other-box.sql', callSql('btd_talep_a', {
      key: KEY,
      hash: HASH,
      ref: REF,
      mailbox: MAILBOX_OTHER,
    })));
    ok(otherBox.code === 0 && /^[0-9a-f-]{36}$/i.test(draftId(otherBox)) && draftId(otherBox) !== ids[0], 'different mailbox is a separate scope');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND mailbox = 'mock-mailbox' AND idempotency_key = '${KEY}' AND source_message_ref = '${REF}'`) === '1', 'original mailbox row stays');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE firma_id = '${FIRMA_A}' AND mailbox = '${MAILBOX_OTHER}' AND idempotency_key = '${KEY}' AND source_message_ref = '${REF}'`) === '1', 'second mailbox has its own draft');

    const emailBox = await runFile(db, writeSql('email-box.sql', callSql('btd_talep_a', {
      key: KEY,
      hash: HASH,
      ref: REF,
      mailbox: 'teklif@technomac.example',
    })));
    ok(emailBox.code !== 0 && emailBox.err.includes('posta_baglami'), 'email address is not an internal mailbox id');
    ok(query(db, `SELECT count(*) FROM public.is_talepleri WHERE mailbox LIKE '%@%'`) === '0', 'email mailbox creates no row');

    ok(query(db, `SET ROLE btd_talep_a; SELECT count(*) FROM public.is_talepleri;`) === '3', 'first firm sees only its own drafts');
    ok(query(db, `SET ROLE btd_talep_b; SELECT count(*) FROM public.is_talepleri;`) === '1', 'second firm cannot read the first firm');
    ok(query(db, `SET ROLE btd_talep_b; SELECT count(*) FROM public.is_talepleri WHERE id = '${ids[0]}';`) === '0', 'second firm cannot read the first draft by id');
    let crossUpdate = '';
    try {
      query(db, `SET ROLE btd_talep_b; UPDATE public.is_talepleri SET content_hash = 'overwritten' WHERE id = '${ids[0]}';`);
    } catch (err) {
      crossUpdate = String(err.stderr || err.message);
    }
    ok(crossUpdate.includes('permission denied'), 'unauthorized role cannot update another firm');
    ok(query(db, `SELECT content_hash FROM public.is_talepleri WHERE id = '${ids[0]}'`) === HASH, 'denied update does not change the draft');
    let ownUpdate = '';
    try {
      query(db, `SET ROLE btd_talep_a; UPDATE public.is_talepleri SET content_hash = 'overwritten' WHERE id = '${ids[0]}';`);
    } catch (err) {
      ownUpdate = String(err.stderr || err.message);
    }
    ok(ownUpdate.includes('permission denied'), 'limited role cannot update its own draft');
    ok(query(db, 'SELECT count(*) FROM public.gorevler') === '0', 'gorev count stays zero');
    ok(query(db, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'is_talepleri'`) === 't|t', 'row security still forced after writes');
    ok(query(db, `SELECT has_table_privilege('btd_talep_a', 'public.is_talepleri', 'UPDATE')::text || '|' || has_table_privilege('btd_talep_b', 'public.is_talepleri', 'DELETE')::text`) === 'false|false', 'write grants stay closed to update and delete');

    console.log(`local database ${db}`);
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
    const leftDb = query('postgres', `SELECT count(*) FROM pg_database WHERE datname = '${db}'`);
    const leftRoles = query('postgres', "SELECT count(*) FROM pg_roles WHERE rolname IN ('btd_talep_a', 'btd_talep_b')");
    if (leftDb !== '0' || leftRoles !== '0') {
      throw new Error(`cleanup left database ${leftDb} roles ${leftRoles}`);
    }
    console.log(`local database ${db} dropped`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
