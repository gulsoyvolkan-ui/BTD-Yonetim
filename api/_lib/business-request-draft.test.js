'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const draft = require('./business-request-draft');
const { createMockAdapter, READ_PERMISSION } = require('./shadow-draft-adapter');

const root = path.join(__dirname, '..', '..');
const FIRMA = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const EMAIL = 'synthetic-sender@example.test';
const SECRET = 'HAM-ILETI-MARKER';

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function member(extra) {
  return {
    actorKind: 'human',
    actorAuthId: ACTOR,
    firmaId: FIRMA,
    firmaKod: 'TM',
    firmaIds: [FIRMA],
    ...extra,
  };
}

function envelope(extra) {
  return {
    schema_version: draft.SCHEMA_VERSION,
    source_message_ref: 'synthetic-msg-001',
    correlation_id: 'synthetic-corr-001',
    idempotency_key: 'synthetic-idem-001',
    request_category: 'teklif',
    missing_information: [],
    evidence_refs: ['synthetic-ref-001'],
    ...extra,
  };
}

function counts(ledger) {
  return {
    drafts: ledger.drafts.length,
    gorevler: ledger.gorevler.length,
    denetim: ledger.denetim.length,
  };
}

async function main() {
  ok(draft.LIVE_WRITES_ENABLED === false, 'canli yazma kapali');
  ok(draft.MEMORY_IS_DATABASE_PROOF === false, 'bellek simulasyonu veritabani kaniti degildir');
  ok(draft.PERSISTENT_IDEMPOTENCY === 'design-only', 'kalici idempotency sql tasariminda');
  ok(draft.REVIEW_STATUSES.every((item) => !draft.GOREV_DURUMLARI.includes(item)), 'inceleme durumlari gorev durumundan ayri');
  ok(draft.GOREV_DURUMLARI.join('|') === 'Açık|Devam|Bitti|İptal', 'gorev durum kumesi ayni');

  const ledger = draft.createLedger();
  const created = await draft.acceptDraft(ledger, envelope(), member());
  ok(created.status === 201 && created.created === true && created.gorevUnchanged === true, 'onaysiz taslak gorevler kaydi olusturmaz');
  ok(ledger.gorevler.length === 0 && ledger.drafts.length === 1, 'taslak gorev satiri acmaz');
  ok(created.draft.review_status === 'taslak', 'eksiksiz talep taslak kalir');
  ok(created.draft.firma_id === FIRMA, 'firma sunucu baglamindan yazilir');
  ok(ledger.denetim[0].actor_auth_id === ACTOR && ledger.denetim[0].olay === 'taslak', 'taslak denetimi yetkili aktoru saklar');
  ok(!JSON.stringify(ledger.denetim).includes(EMAIL) && !JSON.stringify(ledger.denetim).includes(SECRET), 'denetimde ham icerik yok');

  const again = await draft.acceptDraft(ledger, envelope({ email: EMAIL, message: SECRET }), member());
  ok(again.status === 200 && again.created === false && again.draft.id === created.draft.id, 'ayni idempotency_key ikinci taslak olusturmaz');
  ok(ledger.drafts.length === 1 && ledger.gorevler.length === 0, 'tekrar gorev acmaz');

  const clash = await draft.acceptDraft(ledger, envelope({ correlation_id: 'synthetic-corr-002' }), member());
  ok(clash.status === 409 && clash.code === 'idempotency_conflict', 'ayni anahtar farkli icerik sessiz kabul degil');
  ok(ledger.drafts.length === 1 && ledger.drafts[0].correlation_id === 'synthetic-corr-001', 'cakisma mevcut satiri degistirmez');
  ok(ledger.gorevler.length === 0, 'cakisma gorev acmaz');

  const raceLedger = draft.createLedger();
  const raced = await Promise.all([
    draft.acceptDraft(raceLedger, envelope(), member()),
    draft.acceptDraft(raceLedger, envelope(), member()),
  ]);
  ok(raced.every((item) => item.ok) && raced[0].draft.id === raced[1].draft.id, 'eszamanli talepler tekil sonuc');
  ok(raceLedger.drafts.length === 1 && raceLedger.gorevler.length === 0, 'eszamanli cagri tek taslak birakir');

  const foreign = await draft.acceptDraft(ledger, envelope({ idempotency_key: 'synthetic-idem-009', firma_id: OTHER }), member());
  ok(foreign.status === 403 && foreign.code === 'firma_govdeden_olmaz', 'baska firma adina talep 403');
  ok(ledger.drafts.length === 1 && ledger.gorevler.length === 0, 'yabanci firma satiri yok');

  const mailed = await draft.acceptDraft(draft.createLedger(), envelope({
    firma_id: FIRMA,
    email: EMAIL,
    from: EMAIL,
    message: SECRET,
  }), { email: EMAIL, actorKind: 'human' });
  ok(mailed.status === 403 && mailed.gorevler === 0, 'gonderen e-posta yetki sayilmaz');

  const shadowLedger = draft.createLedger();
  const shadowTry = await draft.acceptDraft(shadowLedger, envelope(), {
    ...member(),
    permission: READ_PERMISSION,
    actorKind: 'shadow',
  });
  ok(shadowTry.status === 403 && shadowTry.code === 'shadow_read_yazamaz', 'shadow.read talep yazamaz');
  const adapter = createMockAdapter();
  const summary = adapter.read();
  const write = adapter.writeTask(shadowLedger);
  ok(summary.ok === true && summary.writes === false && adapter.mode === 'mock', 'shadow mock okur');
  ok(write.status === 403 && write.committed === false && shadowLedger.gorevler.length === 0, 'shadow.read gorev yazamaz');

  const stranger = draft.approve(ledger, created.draft.id, {
    actorKind: 'human',
    actorAuthId: STRANGER,
    firmaId: OTHER,
    firmaKod: 'BM',
    firmaIds: [OTHER],
  });
  ok(stranger.status === 403 && stranger.committed === false, 'yetkisiz insan onay veremez');
  ok(ledger.gorevler.length === 0 && ledger.drafts[0].review_status === 'taslak', 'yetkisiz onay taslagi degistirmez');

  const reviewLedger = draft.createLedger();
  const held = await draft.acceptDraft(reviewLedger, envelope({
    idempotency_key: 'synthetic-idem-010',
    missing_information: ['olcu', 'malzeme'],
  }), member());
  ok(held.status === 201 && held.draft.review_status === 'incelemede', 'eksik teknik bilgi incelemede kalir');
  ok(held.draft.missing_information.join(',') === 'malzeme,olcu', 'eksik alan sirasi sunucuda sabitlenir');
  const blocked = draft.approve(reviewLedger, held.draft.id, member());
  ok(blocked.status === 409 && blocked.code === 'eksik_bilgi' && blocked.review_status === 'incelemede', 'eksik talep onaylanmaz');
  ok(reviewLedger.gorevler.length === 0, 'inceleme gorev acmaz');
  ok(!JSON.stringify(reviewLedger.denetim).includes('malzeme'), 'eksik alan denetimine kopyalanmaz');

  const ready = await draft.acceptDraft(reviewLedger, envelope({
    idempotency_key: 'synthetic-idem-011',
    correlation_id: 'synthetic-corr-011',
    source_message_ref: 'synthetic-msg-011',
  }), member());
  const closed = draft.approve(reviewLedger, ready.draft.id, member());
  const liveReady = reviewLedger.drafts.find((row) => row.id === ready.draft.id);
  ok(closed.status === 503 && closed.code === 'yazma_kapali' && closed.committed === false, 'onay yazma yolu kapali');
  ok(!draft.approve.toString().includes('commitDesignedTransaction'), 'kapali onay tasarim transactionini calistirmaz');
  ok(reviewLedger.gorevler.length === 0 && liveReady.review_status === 'taslak', 'kapali onay gorev ve durum yazmaz');

  const before = counts(reviewLedger);
  const rolled = await draft.commitDesignedTransaction(reviewLedger, ready.draft.id, member(), { failAt: 'denetim' });
  ok(rolled.ok === false && rolled.rolledBack === true && rolled.committed === false, 'denetim hatasi geri alinir');
  ok(counts(reviewLedger).gorevler === before.gorevler && counts(reviewLedger).denetim === before.denetim, 'gorev ve audit birlikte geri alinir');
  ok(reviewLedger.drafts.find((row) => row.id === ready.draft.id).review_status === 'taslak', 'geri alinan onay durumu bozmaz');

  const taskFail = await draft.commitDesignedTransaction(reviewLedger, ready.draft.id, member(), { failAt: 'gorev' });
  ok(taskFail.rolledBack === true && counts(reviewLedger).gorevler === before.gorevler, 'gorev hatasi audit birakmaz');

  const done = await draft.commitDesignedTransaction(reviewLedger, ready.draft.id, member());
  ok(done.ok === true && done.kod === 'GV-TM-0001' && done.actor_auth_id === ACTOR, 'tasarim transaction gorev kodunu sunucuda uretir');
  ok(done.database_proof === false && done.persistence === 'memory-simulation', 'onay simulasyonu veritabani kaniti degildir');
  ok(reviewLedger.gorevler.length === before.gorevler + 1 && reviewLedger.denetim.length === before.denetim + 1, 'gorev ve audit birlikte basarili');
  const gorev = reviewLedger.gorevler[reviewLedger.gorevler.length - 1];
  const onay = reviewLedger.denetim[reviewLedger.denetim.length - 1];
  ok(gorev.durum === 'Açık' && gorev.firma_id === FIRMA && gorev.kod === done.kod, 'yeni gorev mevcut durum kumesiyle acilir');
  ok(onay.olay === 'onay' && onay.actor_auth_id === ACTOR && onay.kaynak === 'is_talepleri', 'onay denetimi yetkili aktordur');
  ok(!JSON.stringify(onay).includes(EMAIL) && !JSON.stringify(gorev).includes(SECRET), 'basarili audit hassas icerik tasimaz');
  const replay = await draft.commitDesignedTransaction(reviewLedger, ready.draft.id, member());
  ok(replay.created === false && replay.kod === done.kod && reviewLedger.gorevler.length === before.gorevler + 1, 'ikinci onay ikinci gorev acmaz');

  const rejected = draft.rejectDraft(ledger, created.draft.id, member());
  ok(rejected.review_status === 'reddedildi' && rejected.gorevUnchanged === true, 'ret gorev acmaz');

  const tasksJs = readFile('js/btd-tasks.js');
  const cloudJs = readFile('js/btd-cloud.js');
  const gorevSql = readFile('supabase/010_gorevler.sql');
  const self = readFile('api/_lib/business-request-draft.js');
  const adapterSrc = readFile('api/_lib/shadow-draft-adapter.js');
  ok(tasksJs.includes("const STATUSES = ['Açık', 'Devam', 'Bitti', 'İptal']"), 'mevcut gorev ekrani durum kumesi durur');
  ok(tasksJs.includes('function nextCode(company)') && tasksJs.includes('id: nextCode(firm)'), 'tarayici nextCode gorev ekraninda durur');
  ok(cloudJs.includes('async function saveTask(task, companies)'), 'saveTask durur');
  ok(cloudJs.includes("onConflict: 'firma_id,kod'"), 'saveTask catisma anahtari ayni');
  ok(cloudJs.includes("const TASK_STATUSES = new Set(['Açık', 'Devam', 'Bitti', 'İptal'])"), 'saveTask durum kumesi ayni');
  ok(!self.includes('saveTask') && !self.includes('nextCode'), 'taslak yolu saveTask ve nextCode kullanmaz');
  ok(!self.includes('SHADOW_BTD_LIVE') && !adapterSrc.includes('SHADOW_BTD_LIVE'), 'canli shadow bayragi yok');
  ok(gorevSql.includes("CHECK (durum IN ('Açık', 'Devam', 'Bitti', 'İptal'))"), 'gorevler durum kisiti ayni');

  const sql = readFile('supabase/drafts/is_talebi_taslak_v1.sql');
  const raiseAt = sql.indexOf('RAISE EXCEPTION');
  const createAt = sql.indexOf('CREATE TABLE');
  ok(raiseAt !== -1 && createAt !== -1 && raiseAt < createAt, 'taslak sql ilk ifadede durur');
  ok(sql.includes('UYGULANMADI') && sql.includes('UNIQUE (tenant_id, provider, mailbox, firma_id, idempotency_key)'), 'taslak tekillik tasarimi durur');
  ok(sql.includes('veritabani kaniti degildir'), 'sql bellek testini kanit saymaz');
  ok(!sql.includes('ALTER TABLE public.gorevler') && !sql.includes('ALTER TABLE public.denetim_olaylari'), 'mevcut tablolar degistirilmez');
  let cursor = 0;
  for (const step of draft.TRANSACTION_STEPS) {
    const at = sql.indexOf(`-- adim:${step}`, cursor);
    ok(at > cursor, `transaction adimi ${step}`);
    cursor = at;
  }
  const fnAt = sql.indexOf('FUNCTION public.btd_is_talebi_onayla');
  const fnBody = sql.slice(fnAt, sql.indexOf('$$;', fnAt) + 3);
  ok(fnBody.includes("RAISE EXCEPTION 'yazma kapali'") && !fnBody.includes('INSERT INTO public.gorevler'), 'onay fonksiyonu yazmaz');
  ok(sql.includes('actor_auth_id = auth.uid()') && sql.includes('btd_firma_erisir'), 'denetim ve firma mevcut fonksiyonla baglanir');
  ok(sql.includes('FORCE ROW LEVEL SECURITY') && sql.includes('GRANT SELECT ON public.is_talepleri TO authenticated'), 'taslak rls tasarimi okumaya dar');
  ok(!sql.includes('INSERT INTO public.gorevler'), 'tasarim inserti calisan govdede yok');

  console.log(`business request draft: ${calls} passed (memory and design, not live postgres)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
