'use strict';

// SHADOW ilk etap: yalnız mock. Okuma izni görev yazmaz.
// Canlı bağlantı, ortam bayrağı ve görev insert'i yoktur.

const READ_PERMISSION = 'shadow.read';

function createMockAdapter() {
  const calls = [];
  return {
    mode: 'mock',
    permission: READ_PERMISSION,
    writesEnabled: false,
    calls,
    read() {
      calls.push('read');
      return {
        ok: true,
        status: 200,
        mode: 'mock',
        permission: READ_PERMISSION,
        rows: [],
        writes: false,
      };
    },
    writeTask(ledger) {
      calls.push('write');
      const gorevler = ledger && Array.isArray(ledger.gorevler) ? ledger.gorevler.length : 0;
      return {
        ok: false,
        status: 403,
        code: 'shadow_read_yazamaz',
        committed: false,
        gorevler,
      };
    },
  };
}

function assertWriteDenied(permission) {
  if (permission === READ_PERMISSION) {
    return { ok: false, status: 403, code: 'shadow_read_yazamaz', committed: false };
  }
  return null;
}

module.exports = {
  READ_PERMISSION,
  createMockAdapter,
  assertWriteDenied,
};
