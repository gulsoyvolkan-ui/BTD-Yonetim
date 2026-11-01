'use strict';

// Faz 12. Yerel PostgreSQL 16, sentetik BM/TM, 030 sonra 031.
// BTD HTTP süreci 127.0.0.1 dinler. İstemci ayrı OS sürecidir.
// Bu dosya SHADOW deposundan gelmez. SHADOW istemcisi burada üretilmez.
// Uzak host, üretim projesi ve btdcore.com açılmaz.

const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const migration030 = path.join(root, 'supabase/030_shadow_kimlik.sql');
const migration031 = path.join(root, 'supabase/031_shadow_kopru.sql');
const rollback030 = path.join(root, 'supabase/030_shadow_kimlik_rollback.sql');
const rollback031 = path.join(root, 'supabase/031_shadow_kopru_rollback.sql');
const BM = '11111111-1111-4111-8111-111111111111';
const TM = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';
const BAD = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const SIGNING = 'ornek-imza-anahtari';
const VERIFY = 'ornek-dogrulama-anahtari';
const MARKERS = ['FIYATMARKER', 'TCMARKER', 'Gizli Unvan', '1999-01-02'];
const secrets = [];
const buckets = { sql: 0, rollback: 0, http: 0 };

function skip(reason) {
  console.log(`faz12: NOT TESTED ${reason}`);
  process.exit(0);
}

function redact(text) {
  let out = String(text || '');
  for (const secret of secrets) {
    if (secret) out = out.split(String(secret)).join('[gizli]');
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
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') skip('refused non-local database');
}

function psql(database, args, input) {
  try {
    const out = execFileSync('sudo', [
      '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database, ...args,
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
  if (result.code !== 0) throw new Error(redact(result.err || result.out || 'psql'));
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
  const wrapper = writeSql(dir, `${path.basename(file)}.${process.hrtime.bigint()}.apply.sql`, `SELECT set_config('btd.allow_shadow_kimlik', 'on', false);\n\\i ${file}\n`);
  const result = psql(database, ['-f', wrapper]);
  if (result.code !== 0) throw new Error(redact(result.err || result.out));
}

function localUrl(user, password, database, port) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
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

function ok(cond, message, bucket) {
  if (!cond) {
    console.error(`faz12 failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  buckets[bucket] += 1;
}

function businessTables() {
  return `
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
}

function digest(database) {
  return query(database, `
    SELECT
      (SELECT count(*) FROM public.siparisler)::text || '|' ||
      (SELECT count(*) FROM public.is_emirleri)::text || '|' ||
      (SELECT count(*) FROM public.gorevler)::text || '|' ||
      (SELECT coalesce(md5(string_agg(id::text || ':' || durum, ',' ORDER BY id::text)), '') FROM public.siparisler) || '|' ||
      (SELECT coalesce(md5(string_agg(id::text || ':' || durum, ',' ORDER BY id::text)), '') FROM public.is_emirleri) || '|' ||
      (SELECT coalesce(md5(string_agg(id::text || ':' || durum, ',' ORDER BY id::text)), '') FROM public.gorevler)
  `);
}

function pgLogSize() {
  const result = spawnSync('sudo', ['stat', '-c', '%s', '/var/log/postgresql/postgresql-16-main.log'], { encoding: 'utf8' });
  if (result.status !== 0) return -1;
  return Number(String(result.stdout || '').trim());
}

function pgLogFrom(offset) {
  if (offset < 0) return '';
  const result = spawnSync('sudo', ['tail', '-c', `+${offset + 1}`, '/var/log/postgresql/postgresql-16-main.log'], { encoding: 'utf8' });
  return result.stdout || '';
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address);
    });
  });
}

function queryObject(url) {
  const query = {};
  for (const [key, value] of new URL(url, 'http://127.0.0.1').searchParams) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const current = query[key];
      query[key] = Array.isArray(current) ? current.concat(value) : [current, value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

function guardServeEnv() {
  if (process.env.SHADOW_BTD_LIVE) {
    console.error('refused live flag');
    process.exit(2);
  }
  const target = String(process.env.BTD_SHADOW_DB_TARGET || '').trim().toLowerCase();
  if (target === 'staging' || target === 'production') {
    console.error('refused remote target');
    process.exit(2);
  }
  for (const key of ['BTD_SHADOW_REPLAY_DATABASE_URL', 'BTD_SHADOW_READER_DATABASE_URL']) {
    const raw = String(process.env[key] || '');
    if (!raw) continue;
    if (/btdcore\.com|jramfrqlndfjxyhszvup/i.test(raw)) {
      console.error('refused production host');
      process.exit(2);
    }
    let host = '';
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      console.error('refused malformed database url');
      process.exit(2);
    }
    const loop = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (key === 'BTD_SHADOW_REPLAY_DATABASE_URL' && !loop) {
      console.error('refused remote replay');
      process.exit(2);
    }
    if (!loop && process.env.FAZ12_ALLOW_BLOCKED_READER !== '1') {
      console.error('refused remote reader');
      process.exit(2);
    }
  }
}

async function serve() {
  guardServeEnv();
  const shadowRead = require('../shadow-read');
  const shadowConsent = require('../shadow-consent');
  const health = require('../health');
  const accessLog = process.env.FAZ12_ACCESS_LOG;
  const fetchLog = process.env.FAZ12_FETCH_LOG;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (fetchLog) {
      let pathname = '/';
      try { pathname = new URL(url).pathname; } catch { pathname = '/'; }
      fs.appendFileSync(fetchLog, `${pathname}\n`);
    }
    return originalFetch(url, options);
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const fakeReq = {
      method: req.method,
      headers: req.headers,
      query: queryObject(req.url),
    };
    let statusCode = 200;
    const fakeRes = {
      setHeader() { return this; },
      status(code) { statusCode = code; return this; },
      json(payload) {
        const text = JSON.stringify(payload);
        if (!res.headersSent) {
          res.writeHead(statusCode, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
        }
        res.end(text);
        if (accessLog) fs.appendFileSync(accessLog, `${req.method} ${url.pathname} ${statusCode}\n`);
        return this;
      },
    };
    const handler = url.pathname === '/api/health'
      ? health
      : url.pathname === '/api/shadow-consent'
        ? shadowConsent
        : url.pathname === '/api/shadow-read'
          ? shadowRead
          : null;
    if (!handler) {
      fakeRes.status(404).json({ error: 'yok', writes: false });
      return;
    }
    Promise.resolve(handler(fakeReq, fakeRes)).catch(() => {
      if (!res.headersSent) fakeRes.status(500).json({ error: 'sunucu', writes: false });
    });
  });
  const address = await listen(server);
  if (process.env.FAZ12_PID_FILE) fs.writeFileSync(process.env.FAZ12_PID_FILE, String(process.pid));
  process.stdout.write(`ready ${address.address} ${address.port}\n`);
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 300).unref();
  });
}

async function auth() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(\S+)$/i);
    const token = match ? match[1] : '';
    const firms = token === 'bm-uye' ? [BM] : token === 'tm-uye' ? [TM] : token === 'uyesiz' ? [] : null;
    let status = 404;
    let body = { message: 'yok' };
    if (url.pathname === '/auth/v1/user') {
      if (!firms) {
        status = 401;
        body = { message: 'yetkisiz' };
      } else {
        status = 200;
        body = { id: ACTOR };
      }
    } else if (url.pathname === '/rest/v1/rpc/btd_oturum_baglami') {
      if (!firms) {
        status = 401;
        body = { message: 'yetkisiz' };
      } else {
        status = 200;
        body = { kullanici_id: ACTOR, firmalar: firms.map((id) => ({ id })) };
      }
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  });
  const address = await listen(server);
  process.stdout.write(`ready ${address.address} ${address.port}\n`);
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 300).unref();
  });
}

function safeBody(id, status, body) {
  const raw = JSON.stringify(body || {});
  const leaked = MARKERS.some((marker) => raw.includes(marker)) || raw.includes('postgresql://');
  const data = body && body.data && typeof body.data === 'object' ? body.data : null;
  return {
    id,
    status,
    freshness: body && body.freshness ? body.freshness : null,
    read: body && body.read ? body.read : null,
    writes: body ? body.writes : null,
    error: body && body.error ? body.error : null,
    iss: body && body.identity && body.identity.iss ? body.identity.iss : null,
    perm: body && body.identity && body.identity.perm ? body.identity.perm : null,
    geciken: data && Object.prototype.hasOwnProperty.call(data, 'geciken_is_emri_adet') ? data.geciken_is_emri_adet : null,
    acik: data && Object.prototype.hasOwnProperty.call(data, 'acik_gorev_adet') ? data.acik_gorev_adet : null,
    guncellendi: data && Object.prototype.hasOwnProperty.call(data, 'guncellendi') ? data.guncellendi : null,
    ozet: data && Array.isArray(data.siparis_ozet) ? data.siparis_ozet.map((row) => ({ durum: row.durum, adet: row.adet })) : null,
    healthOk: Boolean(body && body.ok === true),
    shadowRequired: body && Object.prototype.hasOwnProperty.call(body, 'shadowRequired') ? body.shadowRequired : null,
    hadConsent: Boolean(body && body.consent),
    leaked,
  };
}

async function client() {
  const specPath = process.argv[3];
  const outPath = process.argv[4];
  const handoff = process.argv[5] || '';
  const waitFile = process.env.FAZ12_WAIT_FILE;
  if (waitFile) {
    const start = Date.now();
    while (!fs.existsSync(waitFile)) {
      if (Date.now() - start > 5000) process.exit(3);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const tokens = new Map();
  function resolveHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (value && typeof value === 'object' && value.keep) out[key] = tokens.get(value.keep) || '';
      else if (value && typeof value === 'object' && value.handoff) out[key] = handoff ? fs.readFileSync(handoff, 'utf8') : '';
      else out[key] = String(value);
    }
    return out;
  }
  async function once(item) {
    const response = await fetch(`${spec.base}${item.path}`, {
      method: item.method || 'GET',
      headers: resolveHeaders(item.headers),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    if (item.keep && body && body.consent) tokens.set(item.keep, body.consent);
    if (item.saveHandoff && body && body.consent && handoff) {
      fs.writeFileSync(handoff, body.consent, { mode: 0o600 });
    }
    return safeBody(item.id, response.status, body);
  }
  const results = [];
  for (const item of spec.cases) {
    if (item.parallel) {
      const rows = await Promise.all(item.parallel.map((entry) => once(entry)));
      results.push({ id: item.id, parallel: true, rows });
    } else {
      results.push(await once(item));
    }
  }
  fs.writeFileSync(outPath, JSON.stringify({ pid: process.pid, results }));
}

function baseEnv() {
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: 'C.UTF-8',
    NODE_PATH: process.env.NODE_PATH || '',
  };
}

function waitReady(child) {
  let buf = '';
  let stderr = '';
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`ready timeout ${redact(stderr).slice(0, 240)}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const match = buf.match(/ready (\S+) (\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ host: match[1], port: Number(match[2]) });
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`process exit ${code} ${redact(stderr).slice(0, 240)}`));
    });
  });
}

function waitExit(child) {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', resolve));
}

async function runClient(spec, files) {
  const specPath = files.spec;
  const outPath = files.out;
  const waitFile = `${outPath}.wait`;
  fs.writeFileSync(specPath, JSON.stringify(spec), { mode: 0o600 });
  const specText = fs.readFileSync(specPath, 'utf8');
  ok(!specText.includes(secrets[0] || '___missing___'), 'spec has no bridge secret', 'http');
  ok(!specText.includes(SIGNING) && !specText.includes(VERIFY), 'spec has no signing material', 'http');
  ok(!specText.includes('postgresql://'), 'spec has no database url', 'http');
  const child = spawn(process.execPath, [__filename, 'client', specPath, outPath, files.handoff || ''], {
    env: Object.assign(baseEnv(), { FAZ12_WAIT_FILE: waitFile }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  files.children.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  while (!fs.existsSync(`/proc/${child.pid}/environ`)) {
    if (child.exitCode != null || Date.now() - started > 3000) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  if (fs.existsSync(`/proc/${child.pid}/environ`)) {
    const names = fs.readFileSync(`/proc/${child.pid}/environ`).toString('utf8').split('\0').map((item) => item.split('=')[0]);
    const blob = fs.readFileSync(`/proc/${child.pid}/environ`).toString('utf8');
    for (const name of [
      'BTD_SHADOW_REPLAY_DATABASE_URL',
      'BTD_SHADOW_READER_DATABASE_URL',
      'BTD_SHADOW_SIGNING_KEY',
      'BTD_SHADOW_SERVICE_VERIFY_KEY',
      'SHADOW_BTD_LIVE',
      'SUPABASE_SECRET_KEY',
    ]) {
      ok(!names.includes(name), `client env has no ${name}`, 'http');
    }
    ok(!blob.includes('postgresql://') && !blob.includes(SIGNING) && !blob.includes(VERIFY), 'client env has no database url or key', 'http');
  } else {
    ok(false, 'client env was not visible', 'http');
  }
  fs.writeFileSync(waitFile, 'go');
  const code = await waitExit(child);
  ok(code === 0, `client exit ${code} ${redact(stderr).slice(0, 180)}`, 'http');
  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const rawOut = fs.readFileSync(outPath, 'utf8');
  ok(!rawOut.includes('postgresql://') && !rawOut.includes(SIGNING) && !rawOut.includes(VERIFY), 'client output has no secret', 'http');
  ok(!MARKERS.some((marker) => rawOut.includes(marker)), 'client output has no business marker', 'http');
  fs.rmSync(specPath, { force: true });
  fs.rmSync(waitFile, { force: true });
  return parsed;
}

async function startMode(mode, env, files) {
  const child = spawn(process.execPath, [__filename, mode], {
    env: Object.assign(baseEnv(), env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  files.children.push(child);
  const ready = await waitReady(child);
  ok(ready.host === '127.0.0.1', 'listener is loopback', 'http');
  return { child, port: ready.port };
}

function stopChild(child) {
  if (!child || child.exitCode != null || child.killed) return;
  child.kill('SIGTERM');
}

async function orchestrate() {
  refuseRemote();
  try {
    execFileSync('pg_isready', ['-h', '127.0.0.1'], { stdio: 'ignore' });
  } catch {
    skip('local postgres');
  }
  try {
    require('pg');
  } catch {
    skip('pg driver');
  }
  try {
    query('postgres', 'SELECT 1');
  } catch {
    skip('local peer');
  }
  ok(Number(query('postgres', 'SHOW server_version_num')) >= 160000, 'postgres 16', 'sql');

  const stamp = Date.now().toString(36);
  const lossDb = `btd_faz12_loss_${stamp}`;
  const httpDb = `btd_faz12_http_${stamp}`;
  const databases = [lossDb, httpDb];
  const password = crypto.randomBytes(24).toString('hex');
  const otherPassword = crypto.randomBytes(18).toString('hex');
  const superPassword = crypto.randomBytes(18).toString('hex');
  secrets.push(password, otherPassword, superPassword);
  const before = new Set(queryLines('postgres', 'SELECT rolname FROM pg_roles'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btd-faz12-'));
  fs.chmodSync(dir, 0o755);
  const copy030 = writeSql(dir, '030.sql', fs.readFileSync(migration030));
  const copy031 = writeSql(dir, '031.sql', fs.readFileSync(migration031));
  const copyBack030 = writeSql(dir, '030-rollback.sql', fs.readFileSync(rollback030));
  const copyBack031 = writeSql(dir, '031-rollback.sql', fs.readFileSync(rollback031));
  const files = { children: [], dir, handoff: path.join(dir, 'handoff') };
  const summary = {
    owner: '',
    chain: 'FAILED',
    shadowClient: 'BLOCKED',
    remoteOpened: false,
    businessBefore: '',
    businessAfter: '',
    userPgFunctionCounts: 0,
    servicePg: null,
  };

  try {
    query('postgres', 'ALTER SYSTEM SET log_connections = on');
    query('postgres', 'ALTER SYSTEM SET log_disconnections = on');
    query('postgres', 'SELECT pg_reload_conf()');

    query('postgres', `CREATE DATABASE ${lossDb}`);
    psql(lossDb, ['-c', businessTables()]);
    psql(lossDb, ['-c', `
      INSERT INTO public.siparisler (id, firma_id, durum, teslim_tarihi, updated_at)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${BM}', 'Üretimde', DATE '1999-01-02', '2026-10-30 08:00:00+00'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${BM}', 'Tamamlandı', DATE '1999-01-02', '2026-10-29 08:00:00+00');
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
    `]);
    const digest0 = digest(lossDb);
    ok(digest0.startsWith('2|3|3|'), 'loss seed is 2 orders, 3 work orders, 3 tasks', 'rollback');
    const bare030 = psql(lossDb, ['-f', copy030]);
    ok(bare030.code !== 0 && bare030.err.includes('Durdu'), '030 refuses without the session flag', 'rollback');
    ok(digest(lossDb) === digest0, 'refused 030 keeps business rows', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'btd_shadow_jti'") === '0', 'refused 030 creates no jti table', 'rollback');
    applyFile(lossDb, dir, copy030);
    ok(digest(lossDb) === digest0, '030 keeps business rows', 'rollback');
    ok(query(lossDb, "SELECT public.btd_shadow_jti_tuket('btd', 'loss-jti', 'tek_kullanim', '" + BM + "', now() + interval '120 seconds', NULL)") === 'ok', '030 can store one jti', 'rollback');
    const bare031 = psql(lossDb, ['-f', copy031]);
    ok(bare031.code !== 0 && bare031.err.includes('Durdu'), '031 refuses without the session flag', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === '0', 'refused 031 creates no bridge role', 'rollback');
    applyFile(lossDb, dir, copy031);
    ok(digest(lossDb) === digest0, '031 keeps business rows', 'rollback');
    psql(lossDb, ['-c', `INSERT INTO public.gorevler (id, firma_id, durum, updated_at) VALUES ('77777777-7777-4777-8777-777777777777', '${BM}', 'Açık', '2026-10-30 12:00:00+00')`]);
    const digest1 = digest(lossDb);
    ok(digest1.startsWith('2|3|4|') && digest1 !== digest0, 'one task inserted after migration', 'rollback');
    const bareBack031 = psql(lossDb, ['-f', copyBack031]);
    ok(bareBack031.code !== 0 && bareBack031.err.includes('Durdu'), '031 rollback refuses without the flag', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === '1', 'unguarded 031 rollback keeps the bridge', 'rollback');
    applyFile(lossDb, dir, copyBack031);
    ok(digest(lossDb) === digest1, '031 rollback keeps business rows', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === '0', '031 rollback drops the bridge login', 'rollback');
    ok(query(lossDb, "SELECT (to_regclass('public.btd_shadow_jti') IS NOT NULL)::text") === 'true', '031 rollback keeps the jti table', 'rollback');
    ok(query(lossDb, "SELECT (to_regprocedure('public.btd_shadow_operasyon_ozet(text,uuid,integer)') IS NOT NULL)::text") === 'true', '031 rollback keeps the function', 'rollback');
    ok(query(lossDb, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_jti_tuket('btd', 'loss-jti', 'tek_kullanim', '${BM}', now() + interval '120 seconds', NULL);`) === 'replay', 'reader still executes after 031 rollback', 'rollback');
    const bareBack030 = psql(lossDb, ['-f', copyBack030]);
    ok(bareBack030.code !== 0 && bareBack030.err.includes('Durdu'), '030 rollback refuses without the flag', 'rollback');
    ok(query(lossDb, "SELECT (to_regclass('public.btd_shadow_jti') IS NOT NULL)::text") === 'true', 'unguarded 030 rollback keeps the jti table', 'rollback');
    applyFile(lossDb, dir, copyBack030);
    ok(digest(lossDb) === digest1, '030 rollback keeps business rows including the late task', 'rollback');
    ok(query(lossDb, "SELECT to_regclass('public.btd_shadow_jti') IS NULL AND to_regclass('public.btd_servis_kayit') IS NULL AND to_regclass('public.btd_servis_denetim') IS NULL") === 't', '030 rollback drops shadow tables', 'rollback');
    ok(query(lossDb, "SELECT to_regprocedure('public.btd_shadow_operasyon_ozet(text,uuid,integer)') IS NULL") === 't', '030 rollback drops the function', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')") === '3', '030 rollback keeps anon, authenticated, and service_role', 'rollback');
    ok(query(lossDb, "SELECT count(*) FROM pg_roles WHERE rolname IN ('btd_shadow_okuyucu', 'btd_shadow_kopru')") === '0', '030 rollback drops reader and bridge roles', 'rollback');
    summary.businessBefore = '2|3|3';
    summary.businessAfter = '2|3|4';

    query('postgres', `CREATE DATABASE ${httpDb}`);
    psql(httpDb, ['-c', businessTables()]);
    applyFile(httpDb, dir, copy030);
    applyFile(httpDb, dir, copy031);
    applyFile(httpDb, dir, copy031);
    const owners = queryLines(httpDb, `
      SELECT DISTINCT pg_get_userbyid(p.proowner)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'btd\\_%'
    `);
    ok(owners.length === 1 && owners[0] !== 'btd_shadow_kopru' && owners[0] !== 'btd_shadow_okuyucu', 'definer owner is neither bridge nor reader', 'sql');
    summary.owner = query(httpDb, `
      SELECT pg_get_userbyid(p.proowner) || ':' || r.rolsuper::text || ':' || r.rolbypassrls::text
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'btd_shadow_operasyon_ozet'
    `);
    ok(summary.owner.startsWith(`${owners[0]}:`), 'owner flags were read', 'sql');
    ok((query(httpDb, `SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'btd\\_%' AND prosecdef`).toString()) === '7', 'seven functions are security definer', 'sql');
    const paths = query(httpDb, `SELECT string_agg(array_to_string(proconfig, ','), ' ') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'btd\\_%'`);
    ok((paths.match(/search_path=pg_catalog, public, pg_temp/g) || []).length === 7, 'seven functions pin search_path', 'sql');
    ok(query(httpDb, "SELECT rolcanlogin::text || ':' || rolinherit::text || ':' || rolsuper::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu'") === 'false:false:false:false', 'reader has no login, inherit, superuser, or bypass', 'sql');
    ok(query(httpDb, "SELECT rolcanlogin::text || ':' || rolinherit::text || ':' || rolsuper::text || ':' || rolbypassrls::text || ':' || rolconnlimit::text FROM pg_roles WHERE rolname = 'btd_shadow_kopru'") === 'true:false:false:false:8', 'bridge login cannot bypass rls', 'sql');
    ok(query(httpDb, `SELECT m.inherit_option::text || ':' || m.set_option::text FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid AND g.rolname = 'btd_shadow_okuyucu'
      JOIN pg_roles r ON r.oid = m.member AND r.rolname = 'btd_shadow_kopru'`) === 'false:true', 'bridge may set reader and does not inherit it', 'sql');
    const fn = 'public.btd_shadow_operasyon_ozet(text,uuid,integer)';
    ok(query(httpDb, `SELECT has_function_privilege('btd_shadow_okuyucu', '${fn}', 'EXECUTE')::text`) === 'true', 'reader can execute', 'sql');
    for (const role of ['btd_shadow_kopru', 'anon', 'authenticated', 'service_role']) {
      ok(query(httpDb, `SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')::text`) === 'false', `${role} cannot execute`, 'sql');
    }
    ok(query(httpDb, "SELECT count(*) FROM information_schema.routine_privileges WHERE routine_name = 'btd_shadow_operasyon_ozet' AND grantee = 'PUBLIC'") === '0', 'public cannot execute', 'sql');
    ok(query(httpDb, `SELECT string_agg(relname || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text, ',' ORDER BY relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('btd_servis_denetim', 'btd_servis_kayit', 'btd_shadow_jti')`)
      === 'btd_servis_denetim:true:true,btd_servis_kayit:true:true,btd_shadow_jti:true:true', 'shadow tables force row level security', 'sql');
    ok(query(httpDb, "SELECT count(*) FROM pg_policies WHERE tablename IN ('btd_shadow_jti', 'btd_servis_kayit', 'btd_servis_denetim', 'siparisler', 'is_emirleri', 'gorevler')") === '0', 'no policy on shadow or business tables', 'sql');
    ok(query(httpDb, `SELECT string_agg(relname || ':' || relrowsecurity::text, ',' ORDER BY relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('gorevler', 'is_emirleri', 'siparisler')`)
      === 'gorevler:false,is_emirleri:false,siparisler:false', 'business tables have no row level security in this database', 'sql');
    ok(query(httpDb, "SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'service_role'") === 'true', 'locally created service_role has bypassrls', 'sql');

    psql(httpDb, ['-c', `
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

    const tempFile = writeSql(dir, 'temp-now.sql', `
      CREATE FUNCTION pg_temp.now() RETURNS timestamptz
      LANGUAGE sql AS $$ SELECT timestamptz '1999-01-01 00:00:00+00' $$;
      SET ROLE btd_shadow_okuyucu;
      SELECT public.btd_shadow_jti_tuket('btd', 'temp-now-jti', 'tek_kullanim', '${BM}', timestamptz '2000-01-01 00:00:00+00', NULL);
    `);
    const temp = psql(httpDb, ['-tA', '-f', tempFile]);
    ok(temp.code === 0 && temp.out.split('\n').map((item) => item.trim()).includes('expired'), 'temp now() does not extend an expired jti', 'sql');
    ok(query(httpDb, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'temp-now-jti'") === '0', 'shadowed clock did not insert a jti', 'sql');

    const pwFile = writeSql(dir, 'pw.sql', `
      ALTER ROLE btd_shadow_kopru PASSWORD '${password}';
      CREATE ROLE btd_faz12_yabanci LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${otherPassword}';
      CREATE ROLE btd_faz12_super LOGIN SUPERUSER PASSWORD '${superPassword}';
    `);
    psql(httpDb, ['-f', pwFile]);
    fs.rmSync(pwFile, { force: true });
    const kopruUrl = localUrl('btd_shadow_kopru', password, httpDb, 5432);
    const foreignUrl = localUrl('btd_faz12_yabanci', otherPassword, httpDb, 5432);
    const superUrl = localUrl('btd_faz12_super', superPassword, httpDb, 5432);
    secrets.push(kopruUrl, foreignUrl, superUrl);

    const { Client } = require('pg');
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
    ok(await setRoleDenied('service_role'), 'bridge connection cannot become service_role', 'sql');
    ok(await setRoleDenied('postgres'), 'bridge connection cannot become postgres', 'sql');
    ok(await setRoleDenied('btd_faz12_super'), 'bridge connection cannot become the local superuser', 'sql');

    const fixture = jsonQuery(httpDb, `SET ROLE btd_shadow_okuyucu; SELECT public.btd_shadow_operasyon_ozet('shadow-service', '${BM}', 1)::text; RESET ROLE;`);
    ok(fixture.ok === true && fixture.data.geciken_is_emri_adet === 1 && fixture.data.acik_gorev_adet === 2, 'sql fixture matches the synthetic bm totals', 'sql');
    const uretim = fixture.data.siparis_ozet.find((row) => row.durum === 'Üretimde');
    ok(uretim && uretim.adet === 1, 'sql fixture in-production count is 1', 'sql');
    ok(fixture.data.geciken_is_emri_adet !== 4 && fixture.data.acik_gorev_adet !== 7, 'sql fixture is not the tm total', 'sql');

    function reads() {
      return query(httpDb, "SELECT count(*) FROM public.btd_servis_denetim WHERE olay = 'okuma' AND sonuc = 'ok'");
    }
    function userJti() {
      return query(httpDb, "SELECT count(*) FROM public.btd_shadow_jti WHERE iss = 'btd'");
    }

    const authProc = await startMode('auth', {}, files);
    const authUrl = `http://127.0.0.1:${authProc.port}`;
    const httpCounts = { fresh: 0, denied: 0, unavailable: 0, blocked: 0, rejected: 0, health: 0 };

    async function boot(name, extra) {
      const access = path.join(dir, `${name}.access`);
      const fetchLog = path.join(dir, `${name}.fetch`);
      const pidFile = path.join(dir, `${name}.pid`);
      const env = {
        SUPABASE_URL: authUrl,
        SUPABASE_ANON_KEY: 'local-anon',
        BTD_API_KEY: 'gate',
        BTD_SHADOW_SIGNING_KEY: extra.signing || SIGNING,
        BTD_SHADOW_SERVICE_VERIFY_KEY: extra.verify || VERIFY,
        BTD_SHADOW_SERVICE_KEY_VERSION: '1',
        BTD_RATE_LIMIT: '500',
        BTD_SHADOW_REPLAY_DATABASE_URL: kopruUrl,
        FAZ12_ACCESS_LOG: access,
        FAZ12_FETCH_LOG: fetchLog,
        FAZ12_PID_FILE: pidFile,
      };
      if (extra.reader) env.BTD_SHADOW_READER_DATABASE_URL = extra.reader;
      if (extra.allowBlocked) env.FAZ12_ALLOW_BLOCKED_READER = '1';
      const started = await startMode('serve', env, files);
      return { name, access, fetchLog, pidFile, port: started.port, child: started.child, base: `http://127.0.0.1:${started.port}` };
    }

    function findResult(payload, id) {
      return payload.results.find((item) => item.id === id);
    }

    const chain = await boot('chain', { reader: kopruUrl });
    const beforeChain = reads();
    const logAt = pgLogSize();
    const chainRun = await runClient({
      base: chain.base,
      cases: [{
        id: 'svc-bm',
        method: 'GET',
        path: `/api/shadow-read?firma_id=${BM}`,
        headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-bm' }) },
      }],
    }, { spec: path.join(dir, 'chain.spec.json'), out: path.join(dir, 'chain.out.json'), children: files.children });
    const chainRow = findResult(chainRun, 'svc-bm');
    const serverPid = fs.readFileSync(chain.pidFile, 'utf8').trim();
    ok(chainRow && chainRow.status === 200 && chainRow.freshness === 'FRESH', 'chain status is fresh', 'http');
    ok(chainRow.geciken === 1 && chainRow.acik === 2, 'chain counts come from the same totals as the sql function', 'http');
    ok(chainRow.ozet && chainRow.ozet.some((row) => row.durum === 'Üretimde' && row.adet === 1), 'chain in-production count is 1', 'http');
    ok(chainRow.iss === 'shadow' && chainRow.perm === 'shadow.read' && chainRow.read !== 'BLOCKED' && chainRow.leaked === false, 'chain identity is the service read', 'http');
    ok(String(chainRow.guncellendi).startsWith('2026-10-30T10:00:00'), 'chain stamp is the newest updated_at', 'http');
    ok(reads() === String(Number(beforeChain) + 1), 'chain inserted one postgres read audit row', 'http');
    ok(query(httpDb, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'http-bm' AND iss = 'shadow'") === '1', 'chain stored the service jti in postgres', 'http');
    const access = fs.readFileSync(chain.access, 'utf8').trim();
    ok(access === 'GET /api/shadow-read 200', 'chain access log is method path status', 'http');
    ok(!access.includes(password) && !access.includes(SIGNING) && !access.includes('postgresql://'), 'chain access log has no secret', 'http');
    const fetchText = fs.existsSync(chain.fetchLog) ? fs.readFileSync(chain.fetchLog, 'utf8') : '';
    ok(fetchText.trim() === '', 'service chain did not call the catalog stub', 'http');
    ok(serverPid !== String(chainRun.pid) && serverPid !== String(process.pid) && String(chainRun.pid) !== String(process.pid), 'chain uses three distinct pids', 'http');
    const logged = pgLogFrom(logAt);
    ok(logged.includes('application_name=btd-shadow-kopru'), 'postgres log shows the bridge connection during the request', 'http');
    ok(!logged.includes('btdcore.com') && !logged.includes('jramfrqlndfjxyhszvup'), 'postgres log has no production host', 'http');
    summary.chain = 'CONFIRMED';
    summary.servicePg = { geciken: 1, acik: 2, uretimde: 1 };
    httpCounts.fresh += 1;
    stopChild(chain.child);

    const main = await boot('main', { reader: kopruUrl });
    const health = await runClient({
      base: main.base,
      cases: [{ id: 'health', method: 'GET', path: '/api/health' }],
    }, { spec: path.join(dir, 'health.spec.json'), out: path.join(dir, 'health.out.json'), children: files.children });
    const healthRow = findResult(health, 'health');
    ok(healthRow.status === 200 && healthRow.healthOk === true && healthRow.shadowRequired === false, 'health stays up without shadow', 'http');
    httpCounts.health += 1;

    const reusable = serviceToken(BM, { jti: 'http-tekrar' });
    const once = serviceToken(BM, { jti: 'http-once', use: 'once' });
    const raced = serviceToken(BM, { jti: 'http-yaris', use: 'once' });
    const batch = await runClient({
      base: main.base,
      cases: [
        { id: 'empty', method: 'GET', path: `/api/shadow-read?firma_id=${EMPTY}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(EMPTY, { jti: 'http-empty' }) } },
        { id: 'bad', method: 'GET', path: `/api/shadow-read?firma_id=${BAD}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BAD, { jti: 'http-bad' }) } },
        { id: 'tm', method: 'GET', path: `/api/shadow-read?firma_id=${TM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(TM, { jti: 'http-tm' }) } },
        { id: 'reuse-1', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': reusable } },
        { id: 'reuse-2', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': reusable } },
        { id: 'once-1', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': once } },
        { id: 'once-2', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': once } },
        { id: 'race', parallel: [
          { id: 'race-a', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': raced } },
          { id: 'race-b', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': raced } },
        ] },
        { id: 'bad-sig', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': 'baslik.bozuk' } },
        { id: 'expired', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-sure', nowSec: Math.floor(Date.now() / 1000) - 400, ttlSec: 30 }) } },
        { id: 'post', method: 'POST', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-post' }) } },
        { id: 'legacy', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-btd-service-identity': serviceToken(BM, { jti: 'http-eski' }) } },
        { id: 'both', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-iki' }) } },
        { id: 'same', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': 'gate' } },
      ],
    }, { spec: path.join(dir, 'batch.spec.json'), out: path.join(dir, 'batch.out.json'), children: files.children });

    const empty = findResult(batch, 'empty');
    ok(empty.status === 200 && empty.freshness === 'FRESH' && empty.geciken === 0 && empty.acik === 0 && empty.ozet && empty.ozet.length === 0 && empty.guncellendi === null, 'empty firm is a real zero from postgres', 'http');
    httpCounts.fresh += 1;
    const bad = findResult(batch, 'bad');
    ok(bad.status === 200 && bad.freshness === 'UNAVAILABLE' && bad.geciken === null && bad.read !== 'BLOCKED', 'unknown status is unavailable and has no count', 'http');
    httpCounts.unavailable += 1;
    const tm = findResult(batch, 'tm');
    ok(tm.status === 403 && tm.freshness === 'PERMISSION_DENIED' && tm.geciken === null && tm.acik === null, 'tm outside the registry is 403 without counts', 'http');
    httpCounts.denied += 1;
    const reuse1 = findResult(batch, 'reuse-1');
    const reuse2 = findResult(batch, 'reuse-2');
    ok(reuse1.status === 200 && reuse2.status === 200 && reuse1.geciken === 1 && reuse2.acik === 2, 'reusable jti reads the postgres totals twice', 'http');
    ok(query(httpDb, "SELECT kullanim::text FROM public.btd_shadow_jti WHERE jti = 'http-tekrar'") === '2', 'reusable jti recorded two uses', 'http');
    httpCounts.fresh += 2;
    const once1 = findResult(batch, 'once-1');
    const once2 = findResult(batch, 'once-2');
    ok(once1.status === 200 && once1.geciken === 1 && once2.status === 401 && once2.freshness !== 'UNAVAILABLE' && once2.geciken === null, 'single-use replay is 401', 'http');
    httpCounts.fresh += 1;
    httpCounts.rejected += 1;
    const race = findResult(batch, 'race');
    const raceStatuses = race.rows.map((row) => row.status).sort();
    ok(raceStatuses[0] === 200 && raceStatuses[1] === 401, 'parallel single-use yields one read and one 401', 'http');
    ok(race.rows.some((row) => row.status === 200 && row.acik === 2), 'winning parallel read is the bm total', 'http');
    ok(query(httpDb, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'http-yaris'") === '1', 'parallel race stored one jti', 'http');
    httpCounts.fresh += 1;
    httpCounts.rejected += 1;
    for (const id of ['bad-sig', 'expired', 'legacy', 'both', 'same']) {
      const row = findResult(batch, id);
      ok(row.status === 401 && row.freshness !== 'UNAVAILABLE' && row.geciken === null, `${id} is 401 without counts`, 'http');
      httpCounts.rejected += 1;
    }
    const post = findResult(batch, 'post');
    ok(post.status === 405 && post.geciken === null, 'service write is 405', 'http');
    ok(query(httpDb, "SELECT count(*) FROM public.btd_shadow_jti WHERE jti = 'http-post'") === '0', 'rejected write did not store a jti', 'http');

    const beforeRejectRead = reads();
    query(httpDb, "UPDATE public.btd_servis_kayit SET iptal_zamani = now() WHERE servis_kod = 'shadow-service'");
    const revoked = await runClient({
      base: main.base,
      cases: [{ id: 'revoked', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-iptal' }) } }],
    }, { spec: path.join(dir, 'revoked.spec.json'), out: path.join(dir, 'revoked.out.json'), children: files.children });
    ok(findResult(revoked, 'revoked').status === 401 && findResult(revoked, 'revoked').freshness !== 'UNAVAILABLE', 'revoked registry is 401', 'http');
    httpCounts.rejected += 1;
    query(httpDb, "UPDATE public.btd_servis_kayit SET iptal_zamani = NULL, etkin = false WHERE servis_kod = 'shadow-service'");
    const disabled = await runClient({
      base: main.base,
      cases: [{ id: 'disabled', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-kapali' }) } }],
    }, { spec: path.join(dir, 'disabled.spec.json'), out: path.join(dir, 'disabled.out.json'), children: files.children });
    ok(findResult(disabled, 'disabled').status === 401, 'disabled registry is 401', 'http');
    httpCounts.rejected += 1;
    query(httpDb, "UPDATE public.btd_servis_kayit SET etkin = true, gecerlilik_sonu = now() - interval '1 minute' WHERE servis_kod = 'shadow-service'");
    const registryExpired = await runClient({
      base: main.base,
      cases: [{ id: 'registry-expired', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-kayit-sure' }) } }],
    }, { spec: path.join(dir, 'registry.spec.json'), out: path.join(dir, 'registry.out.json'), children: files.children });
    ok(findResult(registryExpired, 'registry-expired').status === 401, 'expired registry is 401', 'http');
    httpCounts.rejected += 1;
    query(httpDb, "UPDATE public.btd_servis_kayit SET gecerlilik_sonu = now() + interval '1 day', anahtar_surum = 9 WHERE servis_kod = 'shadow-service'");
    const wrongKv = await runClient({
      base: main.base,
      cases: [{ id: 'kv', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-kv' }) } }],
    }, { spec: path.join(dir, 'kv.spec.json'), out: path.join(dir, 'kv.out.json'), children: files.children });
    ok(findResult(wrongKv, 'kv').status === 401, 'wrong key version is 401', 'http');
    httpCounts.rejected += 1;
    ok(reads() === beforeRejectRead, 'rejected service states did not read', 'http');
    query(httpDb, "UPDATE public.btd_servis_kayit SET anahtar_surum = 1, etkin = true, iptal_zamani = NULL, gecerlilik_sonu = now() + interval '1 day' WHERE servis_kod = 'shadow-service'");

    const { signUserConsent } = require('./shadow');
    const expiredConsent = signUserConsent({
      firmaId: BM,
      secret: SIGNING,
      nowSec: Math.floor(Date.now() / 1000) - 400,
      ttlSec: 30,
      jti: 'user-expired',
    });
    ok(expiredConsent && expiredConsent.token, 'btd code minted an expired consent', 'http');
    const userBefore = userJti();
    const readBefore = reads();
    const userRun = await runClient({
      base: main.base,
      cases: [
        { id: 'consent', method: 'POST', path: `/api/shadow-consent?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye' }, keep: 'consent', saveHandoff: true },
        { id: 'read', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': { keep: 'consent' } } },
        { id: 'replay', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': { keep: 'consent' } } },
        { id: 'tm-consent', method: 'POST', path: `/api/shadow-consent?firma_id=${TM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye' } },
        { id: 'cross-consent', method: 'POST', path: `/api/shadow-consent?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye' }, keep: 'cross' },
        { id: 'cross', method: 'GET', path: `/api/shadow-read?firma_id=${TM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': { keep: 'cross' } } },
        { id: 'none', method: 'POST', path: `/api/shadow-consent?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer uyesiz' } },
        { id: 'expired', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': expiredConsent.token } },
        { id: 'write', method: 'POST', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': { keep: 'consent' } } },
      ],
    }, { spec: path.join(dir, 'user.spec.json'), out: path.join(dir, 'user.out.json'), handoff: files.handoff, children: files.children });
    const consent = findResult(userRun, 'consent');
    const userRead = findResult(userRun, 'read');
    const userReplay = findResult(userRun, 'replay');
    ok(consent.status === 200 && consent.hadConsent === true, 'btd http process minted the consent', 'http');
    ok(userRead.status === 200 && userRead.freshness === 'UNAVAILABLE' && userRead.geciken === null && userRead.read !== 'BLOCKED', 'user read has no mock catalog and no pg count', 'http');
    ok(userReplay.status === 401 && userReplay.freshness !== 'UNAVAILABLE', 'same consent is 401 on the second send', 'http');
    ok(findResult(userRun, 'tm-consent').status === 403 && findResult(userRun, 'tm-consent').hadConsent === false, 'tm consent is denied for the bm membership', 'http');
    ok(findResult(userRun, 'cross').status === 403 && findResult(userRun, 'cross').geciken === null, 'bm consent cannot query tm', 'http');
    ok(findResult(userRun, 'none').status === 403, 'missing membership is 403', 'http');
    ok(findResult(userRun, 'expired').status === 401 && findResult(userRun, 'expired').freshness !== 'UNAVAILABLE', 'expired consent is 401', 'http');
    ok(findResult(userRun, 'write').status === 405, 'user write is 405', 'http');
    ok(userJti() === String(Number(userBefore) + 1), 'user flow stored one consent jti', 'http');
    ok(reads() === readBefore, 'user flow did not call the service read function', 'http');
    summary.userPgFunctionCounts = 0;
    const fresh = await runClient({
      base: main.base,
      cases: [{ id: 'fresh', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', authorization: 'Bearer bm-uye', 'x-btd-user-consent': { handoff: true } } }],
    }, { spec: path.join(dir, 'fresh.spec.json'), out: path.join(dir, 'fresh.out.json'), handoff: files.handoff, children: files.children });
    ok(findResult(fresh, 'fresh').status === 401, 'a second process with the same consent is 401', 'http');
    fs.rmSync(files.handoff, { force: true });
    const userFetch = fs.readFileSync(main.fetchLog, 'utf8');
    ok(userRead.iss === 'btd', 'user read issuer is btd', 'http');
    ok(userFetch.includes('/auth/v1/user') && userFetch.includes('/rest/v1/rpc/btd_oturum_baglami'), 'user flow called membership', 'http');
    ok(!userFetch.split('\n').some((line) => line && line !== '/auth/v1/user' && line !== '/rest/v1/rpc/btd_oturum_baglami' && !line.startsWith('/rest/v1/')), 'user fetch stayed on auth or rest', 'http');
    const restTables = userFetch.split('\n').filter((line) => line.startsWith('/rest/v1/') && line !== '/rest/v1/rpc/btd_oturum_baglami');
    ok(restTables.length > 0, 'user read attempted the rest tables', 'http');
    ok(restTables.every((line) => line === '/rest/v1/siparisler' || line === '/rest/v1/is_emirleri' || line === '/rest/v1/gorevler'), 'user read did not open another catalog', 'http');
    stopChild(main.child);

    const missing = await boot('missing', {});
    const missingRun = await runClient({
      base: missing.base,
      cases: [{ id: 'blocked', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-missing' }) } }],
    }, { spec: path.join(dir, 'missing.spec.json'), out: path.join(dir, 'missing.out.json'), children: files.children });
    const missingRow = findResult(missingRun, 'blocked');
    ok(missingRow.status === 200 && missingRow.read === 'BLOCKED' && missingRow.freshness === 'UNAVAILABLE' && missingRow.geciken === null, 'missing reader url is blocked and has no count', 'http');
    httpCounts.blocked += 1;
    stopChild(missing.child);

    const remoteReader = `postgresql://btd_shadow_kopru:${encodeURIComponent(password)}@blocked.invalid:5432/${httpDb}?sslmode=require`;
    secrets.push(remoteReader);
    const remote = await boot('remote', { reader: remoteReader, allowBlocked: true });
    const remoteBefore = reads();
    const remoteLog = pgLogSize();
    const remoteRun = await runClient({
      base: remote.base,
      cases: [{ id: 'remote', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-remote' }) } }],
    }, { spec: path.join(dir, 'remote.spec.json'), out: path.join(dir, 'remote.out.json'), children: files.children });
    const remoteRow = findResult(remoteRun, 'remote');
    ok(remoteRow.status === 200 && remoteRow.read === 'BLOCKED' && remoteRow.geciken === null, 'remote reader without staging target is blocked', 'http');
    ok(reads() === remoteBefore, 'remote reader did not execute the read function', 'http');
    const remoteLogged = pgLogFrom(remoteLog);
    ok(!remoteLogged.includes('blocked.invalid') && !remoteLogged.includes('btdcore.com'), 'remote host was not opened', 'http');
    summary.remoteOpened = false;
    httpCounts.blocked += 1;
    stopChild(remote.child);

    const closedReader = localUrl('btd_shadow_kopru', password, httpDb, 1);
    secrets.push(closedReader);
    const closed = await boot('closed', { reader: closedReader });
    const closedToken = serviceToken(BM, { jti: 'http-kopuk', use: 'once' });
    const closedRun = await runClient({
      base: closed.base,
      cases: [
        { id: 'cut', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': closedToken } },
        { id: 'again', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': closedToken } },
      ],
    }, { spec: path.join(dir, 'closed.spec.json'), out: path.join(dir, 'closed.out.json'), children: files.children });
    const cut = findResult(closedRun, 'cut');
    ok(cut.status === 200 && cut.freshness === 'UNAVAILABLE' && cut.read !== 'BLOCKED' && cut.geciken === null, 'closed reader port is unavailable and not a zero', 'http');
    ok(findResult(closedRun, 'again').status === 401, 'single-use jti stays consumed after the failed read', 'http');
    ok(query(httpDb, "SELECT durum FROM public.btd_shadow_jti WHERE jti = 'http-kopuk'") === 'tuketildi', 'failed read left the single-use jti completed', 'http');
    httpCounts.unavailable += 1;
    httpCounts.rejected += 1;
    stopChild(closed.child);

    const superServer = await boot('super', { reader: superUrl });
    const superBefore = reads();
    const superRun = await runClient({
      base: superServer.base,
      cases: [{ id: 'super', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-super' }) } }],
    }, { spec: path.join(dir, 'super.spec.json'), out: path.join(dir, 'super.out.json'), children: files.children });
    ok(findResult(superRun, 'super').read === 'BLOCKED' && findResult(superRun, 'super').geciken === null && reads() === superBefore, 'superuser reader url stays blocked', 'http');
    httpCounts.blocked += 1;
    stopChild(superServer.child);

    const foreignServer = await boot('foreign', { reader: foreignUrl });
    const foreignRun = await runClient({
      base: foreignServer.base,
      cases: [{ id: 'foreign', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-yabanci' }) } }],
    }, { spec: path.join(dir, 'foreign.spec.json'), out: path.join(dir, 'foreign.out.json'), children: files.children });
    ok(findResult(foreignRun, 'foreign').read === 'BLOCKED' && findResult(foreignRun, 'foreign').geciken === null, 'foreign reader url stays blocked', 'http');
    httpCounts.blocked += 1;
    stopChild(foreignServer.child);

    const sameKey = await boot('samekey', { reader: kopruUrl, signing: 'ayni-anahtar', verify: 'ayni-anahtar' });
    const sameRun = await runClient({
      base: sameKey.base,
      cases: [{ id: 'samekey', method: 'GET', path: `/api/shadow-read?firma_id=${BM}`, headers: { 'x-api-key': 'gate', 'x-shadow-service-identity': serviceToken(BM, { jti: 'http-ayni', secret: 'ayni-anahtar' }) } }],
    }, { spec: path.join(dir, 'samekey.spec.json'), out: path.join(dir, 'samekey.out.json'), children: files.children });
    ok(findResult(sameRun, 'samekey').status === 401 && findResult(sameRun, 'samekey').geciken === null, 'identical signing and verify keys are 401', 'http');
    secrets.push('ayni-anahtar');
    httpCounts.rejected += 1;
    stopChild(sameKey.child);

    const healthAfter = await boot('health2', { reader: kopruUrl });
    const health2 = await runClient({
      base: healthAfter.base,
      cases: [{ id: 'health2', method: 'GET', path: '/api/health' }],
    }, { spec: path.join(dir, 'health2.spec.json'), out: path.join(dir, 'health2.out.json'), children: files.children });
    ok(findResult(health2, 'health2').status === 200 && findResult(health2, 'health2').shadowRequired === false, 'health still does not require shadow', 'http');
    httpCounts.health += 1;
    stopChild(healthAfter.child);
    stopChild(authProc.child);

    summary.httpCounts = httpCounts;
    const total = buckets.sql + buckets.rollback + buckets.http;
    console.log(`faz12: ${total} passed (local postgres 16, 127.0.0.1, synthetic BM/TM)`);
    console.log(`faz12 buckets: sql ${buckets.sql}, rollback ${buckets.rollback}, http ${buckets.http}`);
    console.log(`faz12 chain: ${summary.chain}`);
    console.log(`faz12 shadow-client: ${summary.shadowClient}`);
    console.log(`faz12 owner: ${summary.owner}`);
    console.log(`faz12 business rollback: ${summary.businessBefore} -> ${summary.businessAfter} unchanged by 030/031 rollback`);
    console.log(`faz12 service pg counts: geciken ${summary.servicePg.geciken}, acik ${summary.servicePg.acik}, uretimde ${summary.servicePg.uretimde}`);
    console.log(`faz12 user pg function counts: ${summary.userPgFunctionCounts}`);
    console.log(`faz12 http tallies: fresh ${httpCounts.fresh}, denied ${httpCounts.denied}, unavailable ${httpCounts.unavailable}, blocked ${httpCounts.blocked}, rejected ${httpCounts.rejected}, health ${httpCounts.health}`);
    console.log('faz12 remote opened: false');
    console.log('faz12 live rls: NOT TESTED');
  } catch (err) {
    if (!process.exitCode) {
      console.error(redact(err && err.stack ? err.stack : err));
      process.exitCode = 1;
    }
  } finally {
    for (const child of files.children) stopChild(child);
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const child of files.children) {
      if (child.exitCode == null && !child.killed) child.kill('SIGKILL');
    }
    delete process.env.BTD_SHADOW_REPLAY_DATABASE_URL;
    delete process.env.BTD_SHADOW_READER_DATABASE_URL;
    for (const database of databases) {
      try {
        query('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`);
      } catch { /* kapanis */ }
      try {
        query('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      } catch {
        try { query('postgres', `DROP DATABASE IF EXISTS ${database}`); } catch { /* yerel temizlik */ }
      }
    }
    for (const role of ['btd_faz12_super', 'btd_faz12_yabanci', 'btd_shadow_kopru']) {
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* rol kullaniliyor olabilir */ }
    }
    for (const role of ['btd_shadow_okuyucu', 'anon', 'authenticated', 'service_role']) {
      if (before.has(role)) continue;
      try { query('postgres', `DROP ROLE IF EXISTS ${role}`); } catch { /* rol kullaniliyor olabilir */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (process.exitCode) process.exit(process.exitCode);
}

const mode = process.argv[2];
if (mode === 'serve') {
  serve().catch((err) => {
    console.error(redact(err && err.stack ? err.stack : err));
    process.exit(1);
  });
} else if (mode === 'auth') {
  auth().catch((err) => {
    console.error(redact(err && err.stack ? err.stack : err));
    process.exit(1);
  });
} else if (mode === 'client') {
  client().catch((err) => {
    console.error(redact(err && err.stack ? err.stack : err));
    process.exit(1);
  });
} else {
  orchestrate().catch((err) => {
    console.error(redact(err && err.stack ? err.stack : err));
    process.exit(1);
  });
}
