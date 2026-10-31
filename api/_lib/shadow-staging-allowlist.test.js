'use strict';

// Staging host kapısı. Soket açılmaz. Üretim ve btdcore.com aranmaz.
// Karar fonksiyonu ve sahte bağlayıcı. Gerçek HTTP ağı bu dosya değildir.

const fs = require('fs');
const path = require('path');
const replay = require('./shadow-replay');

const HOST = 'db.staging-synthetic.invalid';
const PRODUCTION_REF = 'jramfrqlndfjxyhszvup';
const PRODUCTION_HOST = `db.${PRODUCTION_REF}.supabase.co`;
const MARK = 'parola-degil';
const KEYS = ['BTD_SHADOW_DB_TARGET', 'BTD_SHADOW_STAGING_HOST_ALLOWLIST', 'VERCEL_ENV', 'SUPABASE_URL'];

let passed = 0;

function ok(cond, message) {
  if (!cond) {
    console.error(`staging allowlist failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  passed += 1;
}

function url(host, extra) {
  const opts = extra || {};
  const user = opts.user == null ? 'btd_shadow_kopru' : opts.user;
  const port = opts.port == null ? '5432' : opts.port;
  const password = opts.password == null ? MARK : opts.password;
  const ssl = opts.sslmode == null ? 'require' : opts.sslmode;
  const auth = password === '' ? user : `${user}:${password}`;
  const query = ssl === '' ? '' : `?sslmode=${ssl}`;
  return `postgresql://${auth}@${host}:${port}/btd_staging${query}`;
}

async function withEnv(values, fn) {
  const saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  try {
    for (const key of KEYS) {
      if (values[key] == null) delete process.env[key];
      else process.env[key] = values[key];
    }
    return await fn();
  } finally {
    for (const key of KEYS) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
    replay.setDatabaseConnector(null);
  }
}

async function expectClosed(values, raw, reason) {
  await withEnv(values, async () => {
    const decision = replay.replayUrlDecision(raw);
    ok(decision.ok === false && decision.reason === reason, `${reason} stays closed`);
    ok(!JSON.stringify(decision).includes(MARK), 'closed decision does not echo the fixture');
    let hits = 0;
    replay.setDatabaseConnector(async () => {
      hits += 1;
      throw new Error('socket');
    });
    let caught = null;
    try {
      await replay.databaseQuery(raw, 'select 1', []);
    } catch (err) {
      caught = err;
    }
    ok(caught && caught.reason === reason && hits === 0, `${reason} does not open a socket`);
  });
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'shadow-replay.js'), 'utf8');
  ok(!source.includes('SHADOW_BTD_LIVE'), 'live flag is not read');
  ok(source.includes('rejectUnauthorized: true'), 'staging tls verifies the server');
  ok(source.includes(PRODUCTION_REF) && source.includes('btdcore.com'), 'production markers stay in the gate');

  const base = {
    SUPABASE_URL: 'https://example.supabase.co',
    BTD_SHADOW_DB_TARGET: null,
    BTD_SHADOW_STAGING_HOST_ALLOWLIST: null,
    VERCEL_ENV: null,
  };
  const open = {
    SUPABASE_URL: 'https://example.supabase.co',
    BTD_SHADOW_DB_TARGET: 'staging',
    BTD_SHADOW_STAGING_HOST_ALLOWLIST: HOST,
    VERCEL_ENV: null,
  };

  await withEnv(base, async () => {
    const local = replay.replayUrlDecision('postgresql://btd_shadow_kopru@127.0.0.1:5432/btd_local');
    ok(local.ok === true && local.staging === false && local.host === '127.0.0.1', 'loopback stays open without a staging target');
  });

  await expectClosed(base, url('db.proj.supabase.co'), 'remote');
  await expectClosed(open, url(PRODUCTION_HOST), 'production');
  await expectClosed(open, url('db.btdcore.com'), 'production');
  await expectClosed(Object.assign({}, open, { VERCEL_ENV: 'production' }), url(HOST), 'production');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_DB_TARGET: 'production' }), url(HOST), 'production');
  await expectClosed(Object.assign({}, open, {
    SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
  }), url(HOST), 'production');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_DB_TARGET: null }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_STAGING_HOST_ALLOWLIST: '' }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_STAGING_HOST_ALLOWLIST: '*' }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_STAGING_HOST_ALLOWLIST: '*.supabase.co' }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, {
    BTD_SHADOW_STAGING_HOST_ALLOWLIST: `${HOST},${PRODUCTION_HOST}`,
  }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_STAGING_HOST_ALLOWLIST: '10.1.2.3' }), url('10.1.2.3'), 'remote');
  await expectClosed(Object.assign({}, open, { BTD_SHADOW_STAGING_HOST_ALLOWLIST: `${HOST}, other.invalid` }), url(HOST), 'remote');
  await expectClosed(Object.assign({}, open, {
    BTD_SHADOW_STAGING_HOST_ALLOWLIST: [HOST, 'a.invalid', 'b.invalid', 'c.invalid', 'd.invalid'].join(','),
  }), url(HOST), 'remote');
  await expectClosed(open, url(HOST, { sslmode: '' }), 'remote');
  await expectClosed(open, url(HOST, { sslmode: 'disable' }), 'remote');
  await expectClosed(open, url(HOST, { sslmode: 'prefer' }), 'remote');
  await expectClosed(open, url(HOST, { port: '6543' }), 'remote');
  await expectClosed(open, `postgresql://btd_shadow_kopru:${MARK}@${HOST}/btd_staging?sslmode=require`, 'remote');
  await expectClosed(open, `${url(HOST)}&sslmode=disable`, 'remote');
  await expectClosed(open, url(HOST, { user: 'postgres' }), 'remote');
  await expectClosed(open, url(HOST, { user: 'btd_shadow_okuyucu' }), 'remote');
  await expectClosed(open, url(HOST, { password: '' }), 'remote');

  await withEnv(Object.assign({}, open, { VERCEL_ENV: 'production' }), async () => {
    const local = replay.replayUrlDecision('postgresql://btd_shadow_kopru@127.0.0.1:5432/btd_local');
    ok(local.ok === true && local.staging === false, 'production process still allows loopback');
  });

  await withEnv(open, async () => {
    const decision = replay.replayUrlDecision(url(HOST));
    ok(decision.ok === true && decision.staging === true && decision.host === HOST, 'exact staging host is the only remote opening');
    ok(!JSON.stringify(decision).includes(MARK) && decision.password == null, 'open decision does not carry the fixture');
    const verified = replay.replayUrlDecision(url(HOST, { sslmode: 'verify-full' }));
    ok(verified.ok === true && verified.staging === true, 'verify-full is accepted');
    process.env.BTD_SHADOW_STAGING_HOST_ALLOWLIST = [HOST, 'a.invalid', 'b.invalid', 'c.invalid'].join(',');
    const four = replay.replayUrlDecision(url(HOST));
    ok(four.ok === true && four.host === HOST, 'four exact hosts stay open');
    let hits = 0;
    replay.setDatabaseConnector(async () => {
      hits += 1;
      return [{ ok: true }];
    });
    const rows = await replay.databaseQuery(url(HOST), 'select 1', []);
    ok(hits === 1 && rows && rows[0] && rows[0].ok === true, 'allowlisted url reaches the stub connector');
  });

  console.log(`staging allowlist: ${passed} passed (decision only, no socket, not staging, not production)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
