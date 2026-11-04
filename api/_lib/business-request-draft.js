'use strict';

const crypto = require('crypto');
const { READ_PERMISSION, assertWriteDenied } = require('./shadow-draft-adapter');

const SCHEMA_VERSION = 'business-request-draft.v1';
const REVIEW_STATUSES = Object.freeze(['taslak', 'incelemede', 'reddedildi', 'onaylandi']);
const GOREV_DURUMLARI = Object.freeze(['Açık', 'Devam', 'Bitti', 'İptal']);
const REQUEST_CATEGORIES = Object.freeze(['teklif', 'teknik', 'genel']);
const TRANSACTION_STEPS = Object.freeze(['yetki', 'idempotency', 'gorev', 'denetim']);
const LIVE_WRITES_ENABLED = false;
const AUDIT_SOURCE = 'is_talepleri';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const FIRMA_KOD = /^(TM|BM|DV)$/;
const PII_KEYS = new Set([
  'email', 'e_posta', 'eposta', 'from', 'sender', 'gonderen',
  'subject', 'body', 'raw', 'message', 'ad', 'soyad', 'telefon', 'phone', 'adres',
]);

function liveCommit() {
  if (LIVE_WRITES_ENABLED) {
    throw new Error('yazma kapali ihlali');
  }
  return { ok: false, status: 503, code: 'yazma_kapali', committed: false };
}

function createLedger() {
  return {
    drafts: [],
    gorevler: [],
    denetim: [],
    counters: {},
    locks: new Map(),
  };
}

function withLock(ledger, key, fn) {
  const prev = ledger.locks.get(key) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  ledger.locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function listTokens(value, label) {
  if (value == null) return { value: [] };
  if (!Array.isArray(value)) return { error: label };
  if (value.length > 20) return { error: label };
  const out = [];
  for (const item of value) {
    const text = String(item);
    if (!TOKEN.test(text)) return { error: label };
    if (!out.includes(text)) out.push(text);
  }
  out.sort();
  return { value: out };
}

function canonical(record) {
  return JSON.stringify({
    schema_version: record.schema_version,
    source_message_ref: record.source_message_ref,
    correlation_id: record.correlation_id,
    request_category: record.request_category,
    missing_information: record.missing_information,
    evidence_refs: record.evidence_refs,
  });
}

function contentHash(record) {
  return crypto.createHash('sha256').update(canonical(record)).digest('hex');
}

function serverContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 403, code: 'baglam_yok' };
  }
  const denied = assertWriteDenied(input.permission);
  if (denied) return denied;
  if (input.actorKind === 'shadow' || input.permission === READ_PERMISSION) {
    return { ok: false, status: 403, code: 'shadow_read_yazamaz', committed: false };
  }
  if (input.actorKind && input.actorKind !== 'human') {
    return { ok: false, status: 403, code: 'aktor_degil' };
  }
  const actorAuthId = String(input.actorAuthId || '');
  const firmaId = String(input.firmaId || '');
  const firmaKod = String(input.firmaKod || '');
  const firmaIds = Array.isArray(input.firmaIds) ? input.firmaIds.map(String) : [];
  if (!UUID.test(actorAuthId) || !UUID.test(firmaId) || !FIRMA_KOD.test(firmaKod)) {
    return { ok: false, status: 403, code: 'baglam_eksik' };
  }
  if (!firmaIds.includes(firmaId)) {
    return { ok: false, status: 403, code: 'uye_degil' };
  }
  return { ok: true, actorAuthId, firmaId, firmaKod, firmaIds, actorKind: 'human' };
}

function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'govde' };
  }
  if (body.schema_version !== SCHEMA_VERSION) {
    return { ok: false, status: 400, code: 'schema_version' };
  }
  const idempotencyKey = String(body.idempotency_key || '');
  const sourceRef = String(body.source_message_ref || '');
  const correlationId = String(body.correlation_id || '');
  if (!KEY.test(idempotencyKey) || !KEY.test(sourceRef) || !KEY.test(correlationId)) {
    return { ok: false, status: 400, code: 'anahtar' };
  }
  if (!REQUEST_CATEGORIES.includes(body.request_category)) {
    return { ok: false, status: 400, code: 'request_category' };
  }
  const missing = listTokens(body.missing_information, 'missing_information');
  if (missing.error) return { ok: false, status: 400, code: missing.error };
  const evidence = listTokens(body.evidence_refs, 'evidence_refs');
  if (evidence.error) return { ok: false, status: 400, code: evidence.error };
  if (body.review_status != null && !REVIEW_STATUSES.includes(body.review_status)) {
    return { ok: false, status: 400, code: 'review_status' };
  }
  if (body.review_status === 'onaylandi' || body.review_status === 'reddedildi') {
    return { ok: false, status: 403, code: 'durum_govdeden_olmaz' };
  }
  const claimedFirma = body.firma_id == null || body.firma_id === '' ? '' : String(body.firma_id);
  return {
    ok: true,
    claimedFirma,
    record: {
      schema_version: SCHEMA_VERSION,
      source_message_ref: sourceRef,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      request_category: body.request_category,
      missing_information: missing.value,
      evidence_refs: evidence.value,
    },
  };
}

function reviewFor(record) {
  return record.missing_information.length ? 'incelemede' : 'taslak';
}

function publicDraft(row) {
  return {
    id: row.id,
    schema_version: row.schema_version,
    source_message_ref: row.source_message_ref,
    correlation_id: row.correlation_id,
    idempotency_key: row.idempotency_key,
    request_category: row.request_category,
    missing_information: row.missing_information.slice(),
    evidence_refs: row.evidence_refs.slice(),
    review_status: row.review_status,
    firma_id: row.firma_id,
  };
}

function auditRow(context, olay, durum) {
  return {
    firma_id: context.firmaId,
    actor_auth_id: context.actorAuthId,
    olay,
    kaynak: AUDIT_SOURCE,
    durum,
  };
}

function cloneState(ledger) {
  return {
    drafts: ledger.drafts.map((row) => ({
      ...row,
      missing_information: row.missing_information.slice(),
      evidence_refs: row.evidence_refs.slice(),
    })),
    gorevler: ledger.gorevler.map((row) => ({ ...row })),
    denetim: ledger.denetim.map((row) => ({ ...row })),
    counters: { ...ledger.counters },
  };
}

function restoreState(ledger, snap) {
  ledger.drafts = snap.drafts;
  ledger.gorevler = snap.gorevler;
  ledger.denetim = snap.denetim;
  ledger.counters = snap.counters;
}

function findDraft(ledger, firmaId, idempotencyKey) {
  return ledger.drafts.find((row) => row.firma_id === firmaId && row.idempotency_key === idempotencyKey) || null;
}

function acceptDraft(ledger, body, contextInput) {
  const context = serverContext(contextInput);
  if (!context.ok) {
    return Promise.resolve({
      ok: false,
      status: context.status,
      code: context.code,
      committed: false,
      gorevler: ledger.gorevler.length,
    });
  }
  const parsed = parseBody(body);
  if (!parsed.ok) {
    return Promise.resolve({
      ok: false,
      status: parsed.status,
      code: parsed.code,
      committed: false,
      gorevler: ledger.gorevler.length,
    });
  }
  if (parsed.claimedFirma && parsed.claimedFirma !== context.firmaId) {
    return Promise.resolve({
      ok: false,
      status: 403,
      code: 'firma_govdeden_olmaz',
      committed: false,
      gorevler: ledger.gorevler.length,
    });
  }
  const record = parsed.record;
  const hash = contentHash(record);
  return withLock(ledger, `idem:${context.firmaId}:${record.idempotency_key}`, () => {
    const existing = findDraft(ledger, context.firmaId, record.idempotency_key);
    if (existing) {
      if (existing.content_hash !== hash) {
        return {
          ok: false,
          status: 409,
          code: 'idempotency_conflict',
          draftId: existing.id,
          committed: false,
          gorevler: ledger.gorevler.length,
        };
      }
      return {
        ok: true,
        status: 200,
        created: false,
        draft: publicDraft(existing),
        committed: false,
        gorevler: ledger.gorevler.length,
      };
    }
    const before = ledger.gorevler.length;
    const snap = cloneState(ledger);
    const draft = {
      id: crypto.randomUUID(),
      firma_id: context.firmaId,
      actor_auth_id: context.actorAuthId,
      ...record,
      content_hash: hash,
      review_status: reviewFor(record),
      gorev_kod: '',
    };
    try {
      ledger.drafts.push(draft);
      ledger.denetim.push(auditRow(
        context,
        draft.review_status === 'incelemede' ? 'inceleme' : 'taslak',
        201,
      ));
    } catch (err) {
      restoreState(ledger, snap);
      return { ok: false, status: 500, code: 'taslak_geri', rolledBack: true, gorevler: ledger.gorevler.length };
    }
    return {
      ok: true,
      status: 201,
      created: true,
      draft: publicDraft(draft),
      committed: false,
      gorevler: ledger.gorevler.length,
      gorevUnchanged: ledger.gorevler.length === before,
    };
  });
}

function draftById(ledger, id) {
  return ledger.drafts.find((row) => row.id === id) || null;
}

function approve(ledger, draftId, contextInput) {
  const context = serverContext(contextInput);
  if (!context.ok) {
    return { ok: false, status: context.status, code: context.code, committed: false };
  }
  const draft = draftById(ledger, draftId);
  if (!draft || draft.firma_id !== context.firmaId) {
    return { ok: false, status: 403, code: 'uye_degil', committed: false };
  }
  if (draft.missing_information.length || draft.review_status === 'incelemede') {
    return {
      ok: false,
      status: 409,
      code: 'eksik_bilgi',
      review_status: draft.review_status,
      committed: false,
    };
  }
  const closed = liveCommit();
  return { ...closed, review_status: draft.review_status, gorev_kod: draft.gorev_kod };
}

function rejectDraft(ledger, draftId, contextInput) {
  const context = serverContext(contextInput);
  if (!context.ok) {
    return { ok: false, status: context.status, code: context.code, committed: false };
  }
  const draft = draftById(ledger, draftId);
  if (!draft || draft.firma_id !== context.firmaId) {
    return { ok: false, status: 403, code: 'uye_degil', committed: false };
  }
  if (draft.review_status === 'onaylandi') {
    return { ok: false, status: 409, code: 'onay_geri_alinmaz', committed: false };
  }
  const before = ledger.gorevler.length;
  draft.review_status = 'reddedildi';
  ledger.denetim.push(auditRow(context, 'ret', 200));
  return {
    ok: true,
    status: 200,
    review_status: draft.review_status,
    committed: false,
    gorevler: ledger.gorevler.length,
    gorevUnchanged: ledger.gorevler.length === before,
  };
}

function mintCode(ledger, context) {
  const next = (ledger.counters[context.firmaId] || 0) + 1;
  ledger.counters[context.firmaId] = next;
  return `GV-${context.firmaKod}-${String(next).padStart(4, '0')}`;
}

function fail(status, code) {
  const err = new Error(code);
  err.status = status;
  return err;
}

// Bellek üzerindeki tasarım transaction'ı. Canlı tabloya yazmaz.
// approve() bunu çağırmaz; canlı kapı liveCommit() ile kapalıdır.
function commitDesignedTransaction(ledger, draftId, contextInput, options) {
  const context = serverContext(contextInput);
  if (!context.ok) {
    return Promise.resolve({
      ok: false,
      status: context.status,
      code: context.code,
      rolledBack: true,
      committed: false,
    });
  }
  const opts = options || {};
  return withLock(ledger, `firma:${context.firmaId}`, () => {
    const draft = draftById(ledger, draftId);
    if (!draft || draft.firma_id !== context.firmaId) {
      return { ok: false, status: 403, code: 'uye_degil', rolledBack: true, committed: false };
    }
    if (draft.review_status === 'onaylandi' && draft.gorev_kod) {
      return { ok: true, status: 200, created: false, kod: draft.gorev_kod, committed: false, rolledBack: false };
    }
    if (draft.missing_information.length || draft.review_status !== 'taslak') {
      return {
        ok: false,
        status: 409,
        code: 'eksik_bilgi',
        review_status: draft.review_status,
        rolledBack: true,
        committed: false,
      };
    }
    const snap = cloneState(ledger);
    const steps = [];
    try {
      steps.push('yetki');
      if (opts.failAt === 'yetki') throw fail(403, 'yetki');
      steps.push('idempotency');
      if (draft.approval_hash && draft.approval_hash !== draft.content_hash) {
        throw fail(409, 'idempotency_conflict');
      }
      if (opts.failAt === 'idempotency') throw fail(409, 'idempotency_conflict');
      const kod = mintCode(ledger, context);
      steps.push('gorev');
      if (opts.failAt === 'gorev') throw fail(500, 'gorev');
      const gorev = {
        id: crypto.randomUUID(),
        firma_id: context.firmaId,
        kod,
        baslik: draft.request_category,
        durum: 'Açık',
        talep_id: draft.id,
      };
      ledger.gorevler.push(gorev);
      steps.push('denetim');
      if (opts.failAt === 'denetim') throw fail(500, 'denetim');
      ledger.denetim.push(auditRow(context, 'onay', 200));
      draft.review_status = 'onaylandi';
      draft.gorev_kod = kod;
      draft.approval_hash = draft.content_hash;
      return {
        ok: true,
        status: 200,
        created: true,
        kod,
        gorevId: gorev.id,
        steps,
        rolledBack: false,
        committed: false,
        actor_auth_id: context.actorAuthId,
      };
    } catch (err) {
      restoreState(ledger, snap);
      return {
        ok: false,
        status: err.status || 500,
        code: err.message,
        steps,
        rolledBack: true,
        committed: false,
      };
    }
  });
}

module.exports = {
  SCHEMA_VERSION,
  REVIEW_STATUSES,
  GOREV_DURUMLARI,
  REQUEST_CATEGORIES,
  TRANSACTION_STEPS,
  LIVE_WRITES_ENABLED,
  AUDIT_SOURCE,
  contentHash,
  createLedger,
  acceptDraft,
  approve,
  rejectDraft,
  commitDesignedTransaction,
  liveCommit,
  serverContext,
};
