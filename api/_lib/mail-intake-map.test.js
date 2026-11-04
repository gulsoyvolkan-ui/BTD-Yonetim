'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const draft = require('./business-request-draft');
const adapter = require('./shadow-draft-adapter');
const map = require('./mail-intake-map');
const { validateDraft2020, DIALECT } = require('./json-schema-draft-2020');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'requester@example.invalid';
const SUBJECT = '316 paslanmaz parça için teklif talebi';

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function server() {
  return {
    actorKind: 'human',
    actorAuthId: ACTOR,
    firmaId: FIRMA,
    firmaKod: 'TM',
    firmaIds: [FIRMA],
    tenantId: 'mock-tenant',
    provider: 'mock-provider',
    mailbox: 'mock-mailbox',
  };
}

function rfq(extra) {
  const base = {
    schema_version: 'mail-intake.v1',
    contract_revision: '1.0.0-draft.1',
    data_origin: 'MOCK',
    source: {
      channel: 'email',
      source_message_id: '<rfq-synthetic-001@local>',
      sender: EMAIL,
      recipient: 'sales@example.invalid',
      subject: SUBJECT,
    },
    identity: {
      company_candidate: null,
      authorized_firma_id: null,
      sender_authenticity: 'unverified',
    },
    classification: { category: 'customer_rfq' },
    extraction: {
      items: [{ description: '316 paslanmaz işlenmiş parça', quantity: 10, unit: 'adet' }],
      attachments: [],
      missing_information: ['teknik resim doğrulaması', 'toleranslar', 'termin', 'teslim yeri'],
    },
    routing: {
      suggested_department: 'sales',
      capability_status: 'missing',
      execution_id: null,
    },
    governance: {
      review_required: true,
      outbound_allowed: false,
      btd_write_allowed: false,
    },
    trace: {
      correlation_id: '5a2446b4-6e18-451c-85d1-54e34684737a',
      idempotency_key: 'synthetic-mail-rfq-001',
    },
    evidence_refs: [],
  };
  return extra ? Object.assign(base, extra) : base;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const repoSchema = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'mail-intake.candidate.schema.json'),
    'utf8',
  ));
  ok(repoSchema.$schema === DIALECT, 'aday sema draft 2020-12');
  ok(repoSchema.title.includes('NOT source-verified'), 'sema dogrulanmis TypeScript export degil');
  ok(adapter.SHADOW_TYPE_EXPORT === 'UNKNOWN' && adapter.SHADOW_ENUM_EXPORT === 'UNKNOWN', 'shadow-core export UNKNOWN');

  const coverage = adapter.compareCandidateSchema(repoSchema);
  ok(coverage.missing.length === 0 && coverage.extra.length === 0, 'adaptör aday semanin alanlarini kapsar');
  ok(coverage.categoryMismatch === false, 'aday kategori enum semayla ayni');
  ok(coverage.nullable.includes('source.sender') && coverage.nullable.includes('identity.authorized_firma_id'), 'nullable alanlar durur');
  ok(coverage.nullable.includes('classification.category') && coverage.nullable.includes('routing.execution_id'), 'kategori ve execution nullable');

  const example = rfq();
  const valid = validateDraft2020(repoSchema, example);
  ok(valid.ok === true && valid.authorization === false, 'sentetik RFQ semaya uyar ve yetki sayilmaz');
  const writeOn = clone(example);
  writeOn.governance = { review_required: true, outbound_allowed: false, btd_write_allowed: true };
  ok(validateDraft2020(repoSchema, writeOn).ok === false, 'btd_write_allowed true sema disi');
  const firm = clone(example);
  firm.identity = { company_candidate: null, authorized_firma_id: FIRMA, sender_authenticity: 'unverified' };
  ok(validateDraft2020(repoSchema, firm).ok === false, 'authorized_firma_id null degilse sema disi');
  const real = clone(example);
  real.data_origin = 'REAL';
  ok(validateDraft2020(repoSchema, real).ok === false, 'REAL sema disi');

  const longId = clone(example);
  longId.source = Object.assign({}, example.source, { source_message_id: `m${'a'.repeat(200)}` });
  ok(validateDraft2020(repoSchema, longId).ok === true, 'uzun mesaj kimligi semada gecer');
  ok(map.limits(longId).ok === false && map.limits(longId).authorization === false, 'sema gecerligi olcu kontrolu degildir');

  const ledger = draft.createLedger();
  const mock = adapter.createMockAdapter();
  const accepted = await mock.acceptIntake(ledger, example, server());
  ok(accepted.accepted === true && accepted.mode === 'MOCK' && accepted.task_id === null, 'mock adaptör taslak kabul eder');
  ok(accepted.committed_to_btd === false && accepted.requires_human_review === true, 'insan incelemesi gorev yazmadan durur');
  ok(accepted.data_origin === 'MOCK' && accepted.authorized_firma_id === null, 'mock kimlik sabitleri korunur');
  ok(accepted.governance.review_required === true && accepted.governance.outbound_allowed === false && accepted.governance.btd_write_allowed === false, 'governance sabitleri korunur');
  ok(accepted.database_proof === false && accepted.persistence === 'memory-simulation', 'kabul bellek simulasyonudur');
  ok(accepted.draft.source_message_ref === example.source.source_message_id, 'source_message_id ayri ref olur');
  ok(accepted.draft.correlation_id === example.trace.correlation_id, 'correlation_id izlemedir');
  ok(accepted.draft.idempotency_key === example.trace.idempotency_key, 'idempotency_key ayri anahtardir');
  ok(accepted.draft.source_message_ref !== accepted.draft.idempotency_key, 'mesaj kimligi ile anahtar ayni alan degil');
  ok(accepted.draft.request_category === 'teklif' && accepted.draft.review_status === 'incelemede', 'RFQ taslagi incelemede kalir');
  ok(accepted.draft.schema_version === 'business-request-draft.v1', 'giris sozlesmesi taslak modelinden ayri');
  ok(ledger.gorevler.length === 0 && ledger.drafts.length === 1, 'onaysiz taslak gorevler kaydi olusturmaz');
  ok(!JSON.stringify(ledger.denetim).includes(EMAIL) && !JSON.stringify(ledger.gorevler).includes(SUBJECT), 'denetim ve gorev ham metin tasimaz');
  ok(!JSON.stringify(ledger.drafts).includes(EMAIL), 'gonderen adresi taslak satira yazilmaz');

  const replay = await mock.acceptIntake(ledger, example, server());
  ok(replay.created === false && replay.draft_ref === accepted.draft_ref && ledger.drafts.length === 1, 'ayni teslim ikinci taslak acmaz');

  const senderOnly = clone(example);
  senderOnly.source = Object.assign({}, example.source, { sender: 'other@example.invalid' });
  const sameBody = await mock.acceptIntake(ledger, senderOnly, server());
  ok(sameBody.created === false && sameBody.draft_ref === accepted.draft_ref, 'gonderen adresi icerik farki degildir');

  const changed = clone(example);
  changed.source = Object.assign({}, example.source, { subject: 'baska parca icin teklif' });
  const conflict = await mock.acceptIntake(ledger, changed, server());
  ok(conflict.status === 409 && conflict.code === 'idempotency_conflict' && conflict.accepted === false, 'ayni anahtar farkli icerik conflict');
  ok(ledger.drafts.length === 1 && ledger.gorevler.length === 0, 'conflict gorev ve ikinci taslak acmaz');

  const raceLedger = draft.createLedger();
  const raced = await Promise.all([
    mock.acceptIntake(raceLedger, example, server()),
    mock.acceptIntake(raceLedger, example, server()),
  ]);
  ok(raced.every((item) => item.accepted) && raced[0].draft_ref === raced[1].draft_ref, 'yarista tek taslak');
  ok(raceLedger.drafts.length === 1 && raceLedger.gorevler.length === 0, 'yaris gorev yazmaz');

  const foreignLedger = draft.createLedger();
  const foreign = await mock.acceptIntake(foreignLedger, example, Object.assign({}, server(), {
    firmaId: OTHER,
    firmaIds: [FIRMA],
  }));
  ok(foreign.status === 403 && foreignLedger.drafts.length === 0 && foreignLedger.gorevler.length === 0, 'yetkisiz firma talep acmaz');

  const closed = draft.approve(ledger, accepted.draft_ref, server());
  ok(closed.committed === false && ledger.gorevler.length === 0, 'onaysiz inceleme gorev yazmaz');
  ok(draft.LIVE_WRITES_ENABLED === false && draft.approve.toString().includes('liveCommit'), 'approve yazma kapali');
  const write = mock.writeTask(ledger);
  ok(write.status === 403 && ledger.gorevler.length === 0, 'shadow.read gorev yazamaz');

  const otherTenant = draft.createLedger();
  await mock.acceptIntake(otherTenant, example, server());
  const isolated = await mock.acceptIntake(otherTenant, example, Object.assign({}, server(), { tenantId: 'mock-tenant-b' }));
  ok(isolated.created === true && otherTenant.drafts.length === 2 && otherTenant.gorevler.length === 0, 'tenant ayrimi ayni anahtari ayirir');

  const nullable = clone(example);
  nullable.trace = {
    correlation_id: '6b3557c5-7f29-462d-96e2-65f45795848b',
    idempotency_key: 'synthetic-mail-rfq-002',
  };
  nullable.source = Object.assign({}, example.source, {
    source_message_id: '<rfq-synthetic-002@local>',
    sender: null,
    recipient: null,
    subject: null,
  });
  nullable.classification = { category: null };
  nullable.extraction = {
    items: [{ description: 'parca', quantity: null, unit: null }],
    attachments: [{ filename: 'cizim.pdf', mime_type: null, size_bytes: null }],
    missing_information: [],
  };
  ok(validateDraft2020(repoSchema, nullable).ok === true, 'nullable aday alanlar semada durur');
  const nullLedger = draft.createLedger();
  const nullAccepted = await mock.acceptIntake(nullLedger, nullable, server());
  ok(nullAccepted.accepted === true && nullAccepted.draft.review_status === 'incelemede' && nullLedger.gorevler.length === 0, 'bos kategori incelemede kalir');

  const tasks = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'btd-tasks.js'), 'utf8');
  const cloud = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'btd-cloud.js'), 'utf8');
  ok(tasks.includes('function nextCode(company)') && cloud.includes('async function saveTask(task, companies)'), 'saveTask ve gorev ekrani ayni');
  ok(!fs.readFileSync(path.join(__dirname, 'mail-intake-map.js'), 'utf8').includes('SHADOW_BTD_LIVE'), 'canli shadow bayragi yok');

  console.log(`mail intake map: ${calls} passed (schema and memory, not live postgres)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
