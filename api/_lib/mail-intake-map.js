'use strict';

const crypto = require('crypto');
const { firmaAllowed } = require('./membership');
const { audit } = require('./guard');
const { validateDraft2020 } = require('./json-schema-draft-2020');
const schema = require('./mail-intake.candidate.schema.json');
const {
  SCHEMA_VERSION,
  LIVE_WRITES_ENABLED,
  acceptDraft,
  approve,
  serverContext,
} = require('./business-request-draft');
const {
  CATEGORY_MAP,
  SHADOW_ENUM_EXPORT,
  SHADOW_TYPE_EXPORT,
} = require('./shadow-draft-adapter');

const MAX_BYTES = 16384;
const MAX_TEXT = 200;
const MAX_ARRAY = 20;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const GOVERNANCE = Object.freeze({
  review_required: true,
  outbound_allowed: false,
  btd_write_allowed: false,
});

function limits(value) {
  let raw = '';
  try {
    raw = JSON.stringify(value);
  } catch (err) {
    return { ok: false, status: 400, code: 'boyut', authorization: false };
  }
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    return { ok: false, status: 400, code: 'boyut', authorization: false };
  }
  const problems = [];
  walk(value, problems);
  if (problems.length) return { ok: false, status: 400, code: 'olcu', authorization: false };
  return { ok: true };
}

function walk(value, problems) {
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT) problems.push('metin');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) problems.push('kontrol');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) problems.push('dizi');
    value.forEach((item) => walk(item, problems));
    return;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => walk(value[key], problems));
  }
}

function normalizeToken(value) {
  const text = String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return TOKEN.test(text) ? text : '';
}

function governanceHolds(envelope) {
  const governance = envelope && envelope.governance;
  const identity = envelope && envelope.identity;
  return envelope
    && envelope.data_origin === 'MOCK'
    && identity
    && identity.authorized_firma_id === null
    && governance
    && governance.review_required === GOVERNANCE.review_required
    && governance.outbound_allowed === GOVERNANCE.outbound_allowed
    && governance.btd_write_allowed === GOVERNANCE.btd_write_allowed;
}

function fingerprint(envelope) {
  return crypto.createHash('sha256').update(JSON.stringify({
    source_message_id: envelope.source.source_message_id,
    correlation_id: envelope.trace.correlation_id,
    category: envelope.classification.category,
    subject: envelope.source.subject,
    items: envelope.extraction.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
    })),
    missing_information: envelope.extraction.missing_information,
    evidence_refs: envelope.evidence_refs,
  })).digest('hex');
}

function mapToDraft(envelope) {
  const missing = [];
  for (const item of envelope.extraction.missing_information) {
    const token = normalizeToken(item);
    if (token && !missing.includes(token)) missing.push(token);
  }
  if (!missing.includes('insan-inceleme')) missing.push('insan-inceleme');
  if (envelope.classification.category == null) missing.push('kategori-yok');
  const evidence = [];
  for (const item of envelope.evidence_refs) {
    const token = normalizeToken(item);
    if (!token) return { ok: false, status: 400, code: 'olcu', authorization: false };
    if (!evidence.includes(token)) evidence.push(token);
  }
  const category = CATEGORY_MAP[envelope.classification.category] || 'genel';
  return {
    ok: true,
    body: {
      schema_version: SCHEMA_VERSION,
      source_message_ref: envelope.source.source_message_id,
      correlation_id: envelope.trace.correlation_id,
      idempotency_key: envelope.trace.idempotency_key,
      request_category: category,
      missing_information: missing,
      evidence_refs: evidence,
      detail_fingerprint: fingerprint(envelope),
    },
  };
}

function ack(envelope, result) {
  return {
    ok: result.ok === true,
    status: result.status,
    code: result.code || '',
    mode: 'MOCK',
    accepted: result.ok === true,
    draft_ref: result.draft ? result.draft.id : null,
    task_id: null,
    correlation_id: envelope.trace.correlation_id,
    source_message_id: envelope.source.source_message_id,
    idempotency_key: envelope.trace.idempotency_key,
    requires_human_review: true,
    committed_to_btd: false,
    data_origin: 'MOCK',
    authorized_firma_id: null,
    governance: {
      review_required: GOVERNANCE.review_required,
      outbound_allowed: GOVERNANCE.outbound_allowed,
      btd_write_allowed: GOVERNANCE.btd_write_allowed,
    },
    created: result.created === true,
    draft: result.draft || null,
    gorevler: result.gorevler,
    persistence: 'memory-simulation',
    database_proof: false,
    type_export: SHADOW_TYPE_EXPORT,
    enum_export: SHADOW_ENUM_EXPORT,
    authorization: false,
  };
}

function deny(status, code, gorevler) {
  return {
    ok: false,
    status,
    code,
    mode: 'MOCK',
    accepted: false,
    draft_ref: null,
    task_id: null,
    requires_human_review: true,
    committed_to_btd: false,
    data_origin: 'MOCK',
    authorized_firma_id: null,
    governance: {
      review_required: GOVERNANCE.review_required,
      outbound_allowed: GOVERNANCE.outbound_allowed,
      btd_write_allowed: GOVERNANCE.btd_write_allowed,
    },
    gorevler: gorevler || 0,
    persistence: 'memory-simulation',
    database_proof: false,
    authorization: false,
  };
}

function acceptCandidate(ledger, envelope, serverInput) {
  if (LIVE_WRITES_ENABLED) return Promise.resolve(deny(503, 'yazma_kapali', 0));
  const bounded = limits(envelope);
  if (!bounded.ok) return Promise.resolve(deny(bounded.status, bounded.code, ledger.gorevler.length));
  const checked = validateDraft2020(schema, envelope);
  if (!checked.ok || checked.authorization !== false) {
    return Promise.resolve(deny(400, 'sema', ledger.gorevler.length));
  }
  if (!governanceHolds(envelope)) return Promise.resolve(deny(400, 'yonetisim', ledger.gorevler.length));
  const context = serverContext(serverInput);
  if (!context.ok) return Promise.resolve(deny(context.status, context.code, ledger.gorevler.length));
  if (!context.intakeScope) return Promise.resolve(deny(403, 'posta_baglami', ledger.gorevler.length));
  const membership = { status: 200, firmaIds: context.firmaIds };
  if (!firmaAllowed(membership, context.firmaId)) {
    return Promise.resolve(deny(403, 'uye_degil', ledger.gorevler.length));
  }
  const mapped = mapToDraft(envelope);
  if (!mapped.ok) return Promise.resolve(deny(mapped.status, mapped.code, ledger.gorevler.length));
  if (mapped.body.source_message_ref === mapped.body.idempotency_key) {
    return Promise.resolve(deny(400, 'kimlik_ayri', ledger.gorevler.length));
  }
  return acceptDraft(ledger, mapped.body, serverInput).then((result) => {
    audit({
      event: result.ok ? 'intake_taslak' : 'intake_red',
      table: 'is_talepleri',
      method: 'POST',
      firmaId: context.firmaId,
      actor: context.actorAuthId,
      status: result.status,
    });
    const response = ack(envelope, result);
    if (result.draft) response.draft_ref = result.draft.id;
    return response;
  });
}

module.exports = {
  MAX_BYTES,
  MAX_TEXT,
  MAX_ARRAY,
  GOVERNANCE,
  schema,
  limits,
  acceptCandidate,
  approve,
};
