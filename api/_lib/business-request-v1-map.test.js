'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const draft = require('./business-request-draft');
const map = require('./mail-intake-map');
const { validateDraft2020 } = require('./json-schema-draft-2020');

const FIRMA = '11111111-1111-4111-8111-111111111111';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const SHADOW_FIRMA = '067c529f-8f0e-5774-84bd-12d746c1968c';
const BLUEMAC = '902ba314-5372-5610-8f16-782c182d9846';
const MSG = '<quote-cust-316@local>';
const MSG_B = '<quote-cust-316-b@local>';
const KEY = 'mail-quote-cust-316';
const KEY_DUP = 'mail-quote-cust-dup';
const CORR = 'e8273131-80bb-5de0-9276-bc3410929886';
const MAILBOX_ADDRESS = 'teklif@technomac.example';

const EXPECTED_IDS = [
  'customer_rfq',
  'repeat_delivery',
  'same_source_id_different_idempotency_key',
  'same_idempotency_key_different_message_id',
  'payload_conflict',
  'mail_intake_same_store_replay_and_conflict',
  'wrong_company',
  'invalid_human_actor',
  'missing_sales_adapter',
  'different_mailbox',
  'different_company_scope',
  'concurrent_workers',
  'lease_lost_held_recovered',
  'postgres_claim_finish_fail_rows',
  'postgres_rollback',
  'btd_business_request_draft_v1',
];

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function server(extra) {
  return Object.assign({
    actorKind: 'human',
    actorAuthId: ACTOR,
    firmaId: FIRMA,
    firmaKod: 'TM',
    firmaIds: [FIRMA],
    tenantId: 'mock-tenant',
    provider: 'fixture',
    mailbox: 'mb-teklif',
  }, extra || {});
}

function sourceDraft(extra) {
  return Object.assign({
    schema_version: 'business-request.v1',
    firma_id: SHADOW_FIRMA,
    source_type: 'email',
    source_message_ref: MSG,
    correlation_id: CORR,
    idempotency_key: KEY,
    request_category: 'customer_quotation',
    suggested_department: 'salesDirector',
    requested_action: 'structured_intake',
    missing_information: [
      'ölçü',
      'tolerans',
      'teknik resim doğrulanmadı',
      'termin',
      'teslim yeri',
      'ödeme',
      'para birimi',
    ],
    evidence_refs: ['ref-cb1765f96f147e7e'],
    review_status: 'accepted',
  }, extra || {});
}

async function main() {
  ok(map.FIXTURE_IDS.join() === EXPECTED_IDS.join(), 'fixture id listesi');
  ok(!Object.prototype.hasOwnProperty.call(map, 'FIXTURE_CASE_IDS'), 'case_id yok');
  ok(map.businessRequestSchema.$id === 'business-request.v1', 'kaynak sema');
  ok(map.schema.$id !== map.businessRequestSchema.$id, 'aday sema ayri');
  ok(map.CANDIDATE_SCHEMA_STATUS === 'UNVERIFIED_CANDIDATE', 'aday dogrulanmis degil');
  ok(draft.SCHEMA_VERSION === 'business-request-draft.v1', 'aday ad ayri');
  ok(map.DATABASE_GO === false, 'database go kapali');
  ok(map.MEMORY_IDEMPOTENCY_SCOPE.includes('source_message_ref') && map.MEMORY_IDEMPOTENCY_SCOPE.includes('idempotency_key'), 'bellek anahtar ve kaynak mesaji kapsar');
  ok(map.POSTGRES_UNIQUE_PROPOSAL.includes('source_message_ref') && map.POSTGRES_UNIQUE_PROPOSAL.includes('idempotency_key'), 'onerilen tekillik anahtar ve kaynak mesaji kapsar');
  ok(map.POSTGRES_UNIQUE_PROPOSAL.split('UNIQUE').length === 3, 'iki ayri UNIQUE onerisi');
  ok(!map.POSTGRES_UNIQUE_PROPOSAL.includes('idempotency_key,source_message_ref'), 'tek UNIQUE icine iki kolon konmaz');

  const uniqueKey = 'UNIQUE (tenant_id, provider, mailbox, firma_id, idempotency_key)';
  const uniqueMsg = 'UNIQUE (tenant_id, provider, mailbox, firma_id, source_message_ref)';
  const draftSql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'drafts', 'is_talebi_taslak_v1.sql'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'is-talebi-pg.harness.sql'), 'utf8');
  ok(draftSql.includes(uniqueKey) && harness.includes(uniqueKey), 'anahtar tekilligi');
  ok(draftSql.includes(uniqueMsg) && harness.includes(uniqueMsg), 'kaynak mesaj tekilligi');
  ok(draftSql.indexOf('RAISE EXCEPTION') < draftSql.indexOf('CREATE TABLE'), 'taslak sql ilk ifadede durur');
  ok(harness.includes('ON CONFLICT DO NOTHING') && !harness.includes('DO UPDATE'), 'on conflict satiri guncellemez');
  ok(draftSql.includes("RAISE EXCEPTION 'AE-BTD-25B taslak uygulanmaz"), 'taslak sql kapali');
  for (const id of map.NOT_EXECUTED_IDS) {
    ok(map.FIXTURE_IDS.includes(id), id);
    ok(map.EVIDENCE.SOURCE_EXPECTED_ONLY_NOT_EXECUTED === 'SOURCE_EXPECTED_ONLY_NOT_EXECUTED', id);
  }

  const checked = validateDraft2020(map.businessRequestSchema, sourceDraft());
  ok(checked.ok === true, 'customer_rfq taslagi kaynak semaya uyar');
  ok(map.convertBusinessRequestV1({ schema_version: 'mail-intake.v1' }).code === 'schema_ayri', 'aday zarf kaynak sema degil');
  ok(validateDraft2020(map.businessRequestSchema, { schema_version: 'mail-intake.v1' }).ok === false, 'aday govde kaynak semaya uymaz');
  const converted = map.convertBusinessRequestV1(sourceDraft());
  ok(converted.ok === true && converted.body.schema_version === 'business-request-draft.v1', 'acik donusturucu');
  ok(converted.body.review_status == null && converted.approval_event === false, 'accepted onay olayi degil');
  ok(converted.pilot_decision === 'synthetic', 'sentetik pilot');
  ok(converted.body.firma_id == null && converted.untrusted_firma_id === SHADOW_FIRMA, 'shadow firma yetki degil');
  ok(converted.body.suggested_department == null && converted.body.requested_action == null, 'shadow alani kopyalanmaz');
  ok(map.convertBusinessRequestV1(sourceDraft({ review_status: 'accepted' })).body.request_category === 'teklif', 'kategori donusur');

  const ledger = draft.createLedger();
  const first = await map.acceptBusinessRequest(ledger, sourceDraft(), server());
  ok(first.ok && first.created && first.review_status === 'incelemede', 'customer_rfq incelemede');
  ok(first.review_status !== 'onaylandi' && first.approval_event === false, 'onaylandi yok');
  ok(ledger.gorevler.length === 0 && ledger.drafts[0].firma_id === FIRMA, 'gorev yok, sunucu firmasi');
  ok(ledger.denetim.every((row) => row.olay !== 'onay'), 'onay denetimi yok');

  const replay = await map.acceptBusinessRequest(ledger, sourceDraft(), server());
  ok(replay.ok && replay.created === false && replay.draft_ref === first.draft_ref, 'repeat_delivery');
  ok(ledger.drafts.length === 1, 'mail_intake ayni taslak');

  const otherKey = await map.acceptBusinessRequest(ledger, sourceDraft({ idempotency_key: KEY_DUP }), server());
  ok(otherKey.ok === false && otherKey.code === 'kaynak_mesaj_ayri_anahtar' && otherKey.approval_event === false, 'ayri anahtar');
  ok(ledger.drafts.length === 1, 'ayri anahtar satir acmaz');

  const otherMsg = await map.acceptBusinessRequest(ledger, sourceDraft({ source_message_ref: MSG_B }), server());
  ok(otherMsg.ok === false && otherMsg.code === 'idempotency_conflict', 'ayni anahtar baska mesaj');
  ok(ledger.drafts[0].source_message_ref === MSG, 'ilk mesaj durur');

  const changed = sourceDraft();
  changed.missing_information = changed.missing_information.concat(['ambalaj']);
  const conflict = await map.acceptBusinessRequest(ledger, changed, server());
  ok(conflict.ok === false && conflict.code === 'idempotency_conflict' && ledger.drafts.length === 1, 'payload_conflict');

  const claimed = map.convertBusinessRequestV1(sourceDraft());
  claimed.body.firma_id = BLUEMAC;
  const wrongLedger = draft.createLedger();
  const wrong = await draft.acceptDraft(wrongLedger, claimed.body, server());
  ok(wrong.ok === false && wrong.status === 403 && wrong.code === 'firma_govdeden_olmaz' && wrongLedger.drafts.length === 0, 'wrong_company');

  const actor = await map.acceptBusinessRequest(draft.createLedger(), sourceDraft({
    idempotency_key: 'mail-quote-cust-316b',
    source_message_ref: '<quote-cust-316b@local>',
    correlation_id: '317fbe30-2e7a-5e8d-b9bc-430d0173305c',
  }), server({ actorKind: 'customer', actorAuthId: 'ayse@ornek-musteri.example' }));
  ok(actor.ok === false && actor.status === 403 && actor.approval_event === false, 'invalid_human_actor');

  const salesLedger = draft.createLedger();
  const sales = await map.acceptBusinessRequest(salesLedger, sourceDraft(), server());
  ok(sales.review_status === 'incelemede' && sales.approval_event === false && salesLedger.gorevler.length === 0, 'missing_sales_adapter');
  const closed = draft.approve(salesLedger, sales.draft_ref, server());
  ok(closed.ok === false && closed.code === 'eksik_bilgi' && salesLedger.drafts[0].review_status === 'incelemede', 'approve kapali');

  const address = await map.acceptBusinessRequest(draft.createLedger(), sourceDraft(), server({ mailbox: MAILBOX_ADDRESS }));
  ok(address.ok === false && address.code === 'posta_baglami', 'e-posta kutusu kimligi degil');

  const boxes = draft.createLedger();
  const left = await map.acceptBusinessRequest(boxes, sourceDraft(), server({ mailbox: 'mb-teklif' }));
  const right = await map.acceptBusinessRequest(boxes, sourceDraft(), server({ mailbox: 'mb-finans' }));
  ok(left.created && right.created && boxes.drafts.length === 2, 'different_mailbox');
  ok(boxes.drafts.every((row) => row.review_status !== 'onaylandi' && !row.scope_key.includes('@')), 'kutu adresi degil');
  ok(boxes.gorevler.length === 0, 'iki kutu gorev acmaz');

  const scope = await map.acceptBusinessRequest(draft.createLedger(), sourceDraft(), server({ firmaIds: [] }));
  ok(scope.ok === false && scope.status === 403, 'different_company_scope');
  const empty = await map.acceptBusinessRequest(draft.createLedger(), sourceDraft(), server({ firmaId: '' }));
  ok(empty.ok === false && empty.status === 403, 'bos firma');

  const race = draft.createLedger();
  const pair = await Promise.all([
    map.acceptBusinessRequest(race, sourceDraft(), server()),
    map.acceptBusinessRequest(race, sourceDraft(), server()),
  ]);
  ok(pair.filter((row) => row.created).length === 1 && race.drafts.length === 1, 'concurrent_workers');
  ok(race.gorevler.length === 0, 'yaris gorev acmaz');

  console.log(`business-request.v1 map: ${calls} passed (memory and schema text; postgres fixture ids not executed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
