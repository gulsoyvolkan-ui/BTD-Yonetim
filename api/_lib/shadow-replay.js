'use strict';

const SINGLE_USE = 'tek_kullanim';
const REUSABLE = 'kisa_tekrar';

let replayStore = null;
let registry = null;
let databaseConnector = null;

function replayUrlDecision(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, reason: 'missing' };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const scheme = parsed.protocol.replace(':', '');
  if (scheme !== 'postgres' && scheme !== 'postgresql') return { ok: false, reason: 'scheme' };
  const host = String(parsed.hostname || '').toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return { ok: false, reason: 'remote' };
  }
  return { ok: true, host };
}

function authoritativeReplay() {
  if (!replayStore) return null;
  if (replayStore.kind === 'mock' && process.env.BTD_SHADOW_REPLAY_MOCK !== '1') return null;
  return replayStore;
}

function authoritativeRegistry() {
  if (!registry) return null;
  if (registry.kind === 'mock' && process.env.BTD_SHADOW_REPLAY_MOCK !== '1') return null;
  return registry;
}

function getReplayStore() {
  return replayStore;
}

function setReplayStore(store) {
  replayStore = store || null;
}

function getRegistry() {
  return registry;
}

function setRegistry(store) {
  registry = store || null;
}

function setDatabaseConnector(fn) {
  databaseConnector = typeof fn === 'function' ? fn : null;
}

function createMockReplayStore() {
  const rows = new Map();
  let tail = Promise.resolve();
  function exclusive(work) {
    const run = tail.then(work, work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }
  function keyOf(iss, jti) {
    return `${iss}\n${jti}`;
  }
  return {
    kind: 'mock',
    label: 'mock',
    consume(input) {
      return exclusive(() => consumeRow(rows, keyOf, input));
    },
    complete(input) {
      return exclusive(() => completeRow(rows, keyOf, input));
    },
    rollback(input) {
      return exclusive(() => rollbackRow(rows, keyOf, input));
    },
    revoke(input) {
      return exclusive(() => revokeRow(rows, keyOf, input));
    },
    cleanup(beforeSec, nowSec) {
      return exclusive(() => cleanupRows(rows, beforeSec, nowSec));
    },
    clear() {
      rows.clear();
    },
  };
}

function consumeRow(rows, keyOf, input) {
  const now = Number(input.nowSec);
  const exp = Number(input.exp);
  const id = keyOf(input.iss, input.jti);
  const existing = rows.get(id);
  if (!existing) {
    rows.set(id, {
      iss: input.iss,
      jti: input.jti,
      sinif: input.sinif,
      firmaId: input.firmaId,
      kv: input.kv == null ? null : Number(input.kv),
      exp,
      durum: 'acik',
      kullanim: 1,
    });
    return { ok: true, reason: 'ok' };
  }
  if (existing.durum === 'iptal') return { ok: false, reason: 'revoked' };
  if (existing.exp <= now) return { ok: false, reason: 'expired' };
  if (existing.sinif !== input.sinif || existing.firmaId !== input.firmaId) {
    return { ok: false, reason: 'mismatch' };
  }
  const left = existing.kv == null ? null : Number(existing.kv);
  const right = input.kv == null ? null : Number(input.kv);
  if (left !== right) return { ok: false, reason: 'mismatch' };
  if (existing.sinif === SINGLE_USE) return { ok: false, reason: 'replay' };
  existing.kullanim += 1;
  return { ok: true, reason: 'ok' };
}

function completeRow(rows, keyOf, input) {
  const existing = rows.get(keyOf(input.iss, input.jti));
  if (!existing) return { ok: false, reason: 'missing' };
  if (existing.sinif === REUSABLE) return { ok: true, reason: 'ok' };
  if (existing.durum === 'iptal') return { ok: false, reason: 'revoked' };
  existing.durum = 'tuketildi';
  return { ok: true, reason: 'ok' };
}

function rollbackRow(rows, keyOf, input) {
  const id = keyOf(input.iss, input.jti);
  const existing = rows.get(id);
  if (!existing) return { ok: false, reason: 'missing' };
  if (existing.sinif === REUSABLE) return { ok: true, reason: 'kept' };
  if (existing.durum !== 'acik') return { ok: false, reason: 'committed' };
  rows.delete(id);
  return { ok: true, reason: 'ok' };
}

function revokeRow(rows, keyOf, input) {
  const id = keyOf(input.iss, input.jti);
  const existing = rows.get(id);
  if (!existing) {
    rows.set(id, {
      iss: input.iss,
      jti: input.jti,
      sinif: input.sinif || SINGLE_USE,
      firmaId: input.firmaId || '00000000-0000-0000-0000-000000000000',
      kv: null,
      exp: Number(input.exp) || Number(input.nowSec) + 300,
      durum: 'iptal',
      kullanim: 0,
    });
    return { ok: true, reason: 'ok' };
  }
  existing.durum = 'iptal';
  return { ok: true, reason: 'ok' };
}

function cleanupRows(rows, beforeSec, nowSec) {
  const before = Number(beforeSec);
  const now = Number(nowSec);
  if (!Number.isFinite(before) || !Number.isFinite(now)) {
    const error = new Error('temizle siniri yok');
    error.reason = 'cleanup';
    throw error;
  }
  const cutoff = Math.min(before, now - 300);
  let removed = 0;
  for (const [id, row] of rows) {
    if (row.exp < cutoff) {
      rows.delete(id);
      removed += 1;
    }
  }
  return { ok: true, removed };
}

function createMockRegistry(options) {
  const row = {
    servisKod: 'shadow-service',
    firms: Array.isArray(options.firms) ? options.firms.slice() : [],
    scopes: ['shadow.read'],
    keyVersion: options.keyVersion == null ? 1 : Number(options.keyVersion),
    previousKeyVersion: options.previousKeyVersion == null ? null : Number(options.previousKeyVersion),
    enabled: options.enabled !== false,
    revoked: options.revoked === true,
    expiresAt: options.expiresAt == null ? null : Number(options.expiresAt),
  };
  const audit = [];
  return {
    kind: 'mock',
    label: 'mock',
    audit,
    async authorize({ servisKod, firmaId, scope, kv, nowSec }) {
      const now = Number(nowSec);
      let reason = 'ok';
      if (servisKod !== row.servisKod) reason = 'unknown';
      else if (!row.enabled) reason = 'disabled';
      else if (row.revoked) reason = 'revoked';
      else if (row.expiresAt != null && row.expiresAt <= now) reason = 'expired';
      else if (scope !== 'shadow.read' || row.scopes.indexOf(scope) === -1) reason = 'scope';
      else if (row.firms.indexOf(firmaId) === -1) reason = 'firma';
      else if (kv !== row.keyVersion && kv !== row.previousKeyVersion) reason = 'key';
      audit.push({
        servisKod,
        firmaId,
        olay: 'yetki',
        sonuc: reason,
        anahtarSurum: kv,
      });
      return { ok: reason === 'ok', reason };
    },
  };
}

function mapDurum(durum) {
  if (durum === 'ok') return { ok: true, reason: 'ok' };
  return { ok: false, reason: durum || 'replay_unverified' };
}

function createPostgresReplayStore(query) {
  return {
    kind: 'postgres',
    label: 'postgres',
    async consume(input) {
      const rows = await query(
        'SELECT public.btd_shadow_jti_tuket($1, $2, $3, $4::uuid, to_timestamp($5), $6::int) AS durum',
        [input.iss, input.jti, input.sinif, input.firmaId, Number(input.exp), input.kv]
      );
      return mapDurum(rows && rows[0] && rows[0].durum);
    },
    async complete(input) {
      const rows = await query(
        'SELECT public.btd_shadow_jti_tamamla($1, $2) AS durum',
        [input.iss, input.jti]
      );
      return mapDurum(rows && rows[0] && rows[0].durum);
    },
    async rollback(input) {
      const rows = await query(
        'SELECT public.btd_shadow_jti_geri_al($1, $2) AS durum',
        [input.iss, input.jti]
      );
      const durum = rows && rows[0] && rows[0].durum;
      if (durum === 'ok' || durum === 'kept') return { ok: true, reason: durum };
      return { ok: false, reason: durum || 'replay_unverified' };
    },
    async revoke(input) {
      const rows = await query(
        'SELECT public.btd_shadow_jti_iptal($1, $2) AS durum',
        [input.iss, input.jti]
      );
      return mapDurum(rows && rows[0] && rows[0].durum);
    },
    async cleanup(beforeSec) {
      const rows = await query(
        'SELECT public.btd_shadow_jti_temizle(to_timestamp($1)) AS n',
        [Number(beforeSec)]
      );
      return { ok: true, removed: Number(rows && rows[0] && rows[0].n) };
    },
  };
}

function createPostgresRegistry(query) {
  return {
    kind: 'postgres',
    label: 'postgres',
    async authorize({ servisKod, firmaId, scope, kv }) {
      const rows = await query(
        'SELECT public.btd_servis_yetki($1, $2::uuid, $3, $4::int) AS durum',
        [servisKod, firmaId, scope, kv]
      );
      const durum = rows && rows[0] && rows[0].durum;
      if (!durum) return { ok: false, reason: 'replay_unverified' };
      return { ok: durum === 'ok', reason: durum };
    },
  };
}

async function databaseQuery(connectionString, sql, params) {
  const decision = replayUrlDecision(connectionString);
  if (!decision.ok) {
    const error = new Error('replay_unverified');
    error.reason = decision.reason;
    throw error;
  }
  if (databaseConnector) return databaseConnector(sql, params);
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    const error = new Error('replay_unverified');
    error.reason = 'driver';
    throw error;
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

function useMockHarness(options) {
  process.env.BTD_SHADOW_REPLAY_MOCK = '1';
  replayStore = createMockReplayStore();
  registry = createMockRegistry(options || {});
  return { replay: replayStore, registry };
}

function resetMockReplay() {
  if (process.env.BTD_SHADOW_REPLAY_MOCK !== '1') {
    replayStore = null;
    registry = null;
    return;
  }
  replayStore = createMockReplayStore();
}

function detachSecurity() {
  replayStore = null;
  registry = null;
}

function setMockRegistry(options) {
  registry = createMockRegistry(options || {});
}

module.exports = {
  SINGLE_USE,
  REUSABLE,
  replayUrlDecision,
  authoritativeReplay,
  authoritativeRegistry,
  getReplayStore,
  setReplayStore,
  getRegistry,
  setRegistry,
  setDatabaseConnector,
  createMockReplayStore,
  createMockRegistry,
  createPostgresReplayStore,
  createPostgresRegistry,
  databaseQuery,
  useMockHarness,
  resetMockReplay,
  detachSecurity,
  setMockRegistry,
};
