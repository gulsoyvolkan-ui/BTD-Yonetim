'use strict';

// SHADOW ilk etap: yalnız mock. Okuma izni görev yazmaz.
// Canlı bağlantı, ortam bayrağı ve görev insert'i yoktur.

const READ_PERMISSION = 'shadow.read';

// shadow-core bu kimlikte okunamadi. Asagidaki listeler aday JSON Schema'dan
// kopyadir. TypeScript export veya enum kaynagi UNKNOWN'dur.
const SHADOW_TYPE_EXPORT = 'UNKNOWN';
const SHADOW_ENUM_EXPORT = 'UNKNOWN';
const CANDIDATE_CATEGORIES = Object.freeze([
  'customer_rfq',
  'supplier_quote',
  'incoming_invoice',
  'account_reconciliation',
  'personnel_request',
  'general_inquiry',
  null,
]);
const CANDIDATE_PATHS = Object.freeze([
  'schema_version',
  'contract_revision',
  'data_origin',
  'source',
  'source.channel',
  'source.source_message_id',
  'source.sender',
  'source.recipient',
  'source.subject',
  'identity',
  'identity.company_candidate',
  'identity.authorized_firma_id',
  'identity.sender_authenticity',
  'classification',
  'classification.category',
  'extraction',
  'extraction.items',
  'extraction.items.description',
  'extraction.items.quantity',
  'extraction.items.unit',
  'extraction.attachments',
  'extraction.attachments.filename',
  'extraction.attachments.mime_type',
  'extraction.attachments.size_bytes',
  'extraction.missing_information',
  'routing',
  'routing.suggested_department',
  'routing.capability_status',
  'routing.execution_id',
  'governance',
  'governance.review_required',
  'governance.outbound_allowed',
  'governance.btd_write_allowed',
  'trace',
  'trace.correlation_id',
  'trace.idempotency_key',
  'evidence_refs',
]);
const CATEGORY_MAP = Object.freeze({
  customer_rfq: 'teklif',
  supplier_quote: 'teklif',
  incoming_invoice: 'genel',
  account_reconciliation: 'genel',
  personnel_request: 'genel',
  general_inquiry: 'genel',
});

function childPaths(schema, prefix) {
  if (!schema || !schema.properties) return [];
  const out = [];
  for (const key of Object.keys(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    const child = schema.properties[key];
    out.push(...childPaths(child, path));
    if (child && child.items) out.push(...childPaths(child.items, path));
  }
  return out;
}

function nullablePaths(schema, prefix) {
  if (!schema || !schema.properties) return [];
  const out = [];
  for (const key of Object.keys(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = schema.properties[key];
    const types = Array.isArray(child.type) ? child.type : child.type ? [child.type] : [];
    if (types.includes('null') || child.type === 'null' || (Array.isArray(child.enum) && child.enum.includes(null))) {
      out.push(path);
    }
    out.push(...nullablePaths(child, path));
    if (child && child.items) out.push(...nullablePaths(child.items, path));
  }
  return out;
}

function compareCandidateSchema(schema) {
  const paths = childPaths(schema, '');
  const missing = paths.filter((path) => CANDIDATE_PATHS.indexOf(path) === -1);
  const extra = CANDIDATE_PATHS.filter((path) => paths.indexOf(path) === -1);
  const category = schema
    && schema.properties
    && schema.properties.classification
    && schema.properties.classification.properties
    && schema.properties.classification.properties.category
    && schema.properties.classification.properties.category.enum;
  const categoryMismatch = !category || category.length !== CANDIDATE_CATEGORIES.length
    || category.some((item, index) => item !== CANDIDATE_CATEGORIES[index]);
  return {
    missing,
    extra,
    nullable: nullablePaths(schema, ''),
    categoryMismatch,
    typeExport: SHADOW_TYPE_EXPORT,
    enumExport: SHADOW_ENUM_EXPORT,
  };
}

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
    acceptIntake(ledger, envelope, serverInput) {
      calls.push('intake');
      const map = require('./mail-intake-map');
      return map.acceptCandidate(ledger, envelope, serverInput);
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
  SHADOW_TYPE_EXPORT,
  SHADOW_ENUM_EXPORT,
  CANDIDATE_CATEGORIES,
  CANDIDATE_PATHS,
  CATEGORY_MAP,
  compareCandidateSchema,
  createMockAdapter,
  assertWriteDenied,
};
