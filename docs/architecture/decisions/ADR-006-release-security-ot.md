# ADR-006 — Release, Security and OT Safety Gates

**Durum:** PROPOSED / OWNER APPROVAL PENDING  
**Tarih:** 2026-11-05  
**Lider:** Proje sahibi ve üç proje geliştirme ekibi. Bu belgenin uygulama sınırı BTD Core deposudur.  
**Kaynak SHA:** `gulsoyvolkan-ui/BTD-Yonetim@eeedcabd7895d7995efe731b09af24e696c88a9d` (`git fetch origin main`, 2026-11-05)  
**Bağlı taslaklar:** D09–D12, O7, O9, ADR-001, ADR-002, ADR-003, ADR-004, ADR-005  
**Bu belge:** Kabul edilmiş yayın prosedürü, API, SQL, enum veya üretim durumu değildir. O7 ve O9 APPROVED değildir. Merge ve deploy izni vermez.

## Neden gerekli

GitHub PR merge, GitHub Actions Test yeşili, Vercel üretim dağıtımı, Supabase SQL uygulanması, production secret değişimi ve canlı BTD, SHADOW veya OT bağlantısı farklı yetki ve farklı geri dönüş ister. Bunları tek bir merge GO altında birleştirmek güvenli değildir.

## 2026-11-05 kaynak tabanı

`git fetch origin main` sonrası `origin/main` `eeedcabd7895d7995efe731b09af24e696c88a9d` olarak kaldı. PR #25 bu uca birleşmiştir. O PR, yazması kapalı iş talebi taslağı ve yerel Postgres denemesidir. Canlı yazma değildir.

### Açık PR'lar ve dosya çakışması

Salt okunur `gh pr view` (2026-11-05). Bu belge dallarına commit veya rebase yapılmaz.

| PR | Durum | Taban | Baş | GitHub mergeable | Bu ADR dosyalarıyla yol çakışması |
|---|---|---|---|---|---|
| [#18](https://github.com/gulsoyvolkan-ui/BTD-Yonetim/pull/18) | OPEN | `main` | `cursor/faz9-veritabani-koprusu-d6a9` | CONFLICTING | Yok. Dokundukları: `.env.example`, `.github/workflows/test.yml`, SHADOW köprü test ve runtime, `docs/integrations/*`, `docs/security/*`, `supabase/030_*`, `supabase/031_*`. |
| [#19](https://github.com/gulsoyvolkan-ui/BTD-Yonetim/pull/19) | OPEN | `cursor/faz9-veritabani-koprusu-d6a9` | `cursor/faz10-staging-hazirlik-5f14` | MERGEABLE (kendi tabanına) | Yok. `.env.example`, `test.yml`, `security.test.js`, köprü ve allowlist testleri, entegrasyon ve güvenlik notları. |
| [#20](https://github.com/gulsoyvolkan-ui/BTD-Yonetim/pull/20) | OPEN | `cursor/faz10-staging-hazirlik-5f14` | `cursor/faz12-pg-http-kabul-3de5` | MERGEABLE (kendi tabanına) | Yok. `api/_lib/faz12-http.pg.test.js`, `030` ve `031` rollback dosyaları. |
| [#21](https://github.com/gulsoyvolkan-ui/BTD-Yonetim/pull/21) | OPEN | `main` | `cursor/release-gate-fail-closed-fda7` | CONFLICTING | Yok. `.github/release-gate.js`, secret scan, `.github/workflows/deploy-vercel.yml`, `.github/workflows/secret-scan.yml`, `test.yml`. |

#19, #18 dalının üzerindedir. #20, #19 dalının üzerindedir. `MERGEABLE` merge kararı değildir. `CONFLICTING` bu ADR dalının işi değildir. Ortak risk, yeni bir test veya workflow PR'ının `test.yml` ve `deploy-vercel.yml` üzerinde #18, #19 ve #21 ile çakışmasıdır. Bu belge PR'ı o dosyalara dokunmaz.

### Test ve SQL dosyaları

- `.github/workflows/test.yml`: `push` yalnız `main`, ayrıca `pull_request` ve `workflow_dispatch`. `permissions: contents: read`. Node adımları security, selfcheck, SHADOW read contract, SHADOW read live RLS, business-request draft, mail intake, business-request v1. Postgres işi yalnız `api/_lib/is-talebi-pg.test.js`. Uzak veritabanı URL'si bu işte reddedilir.
- `api/_lib/shadow-read.rls.test.js` canlı URL yoksa `NOT TESTED` yazar ve çıkış kodu 0 döner. İş akışı adı `SHADOW read live RLS` olsa da çıkış 0, RLS PASS değildir.
- `api/_lib/shadow-kimlik.pg.test.js` yerel harness olarak durur. `test.yml` onu çağırmaz. Bu turda iş akışına eklenmez.
- `docs/security/GUVENLIK_TOPARLAMA.md`, `PRODUCTION_MIGRATION_RUNBOOK.md`, `TENANT_AUTHORIZATION_MATRIX.md` tarihsel kapı notlarıdır. Güncel canlı katalog bu turda okunmadı.
- `supabase/030_shadow_kimlik.sql` guard'lıdır. Başlık, canlıda çalıştırılmadığını söyler. Kapsam CHECK'i `shadow.read` ile sınırlıdır. Bu, üretimde kurulu scope kabulü değildir.
- `supabase/drafts/is_talebi_taslak_v1.sql` baştaki durdurma ile uygulanmayı keser. Üretim migration'ı değildir.
- `docs/security/BTD_SECURITY_BASELINE.md` dağıtımı hâlâ `deploy-vercel.yml` üzerinden `main`/`master` push'una bağlar. Bu cümle 30 Ekim 2026 denetim metnidir. Güncel workflow dosyası onu yapmaz. Eski cümle güncel yayın ayarı sayılmaz.

### Vercel Git davranışı

Repo dosyası tek başına Git entegrasyon ayarını kanıtlamaz.

`.github/workflows/deploy-vercel.yml` yalnız `workflow_dispatch` çalışır, `contents: read` kullanır, Vercel API çağırmaz ve `exit 1` ile biter. `main` push bu işi başlatmaz. `vercel.json` içinde `ignoreCommand` yoktur. Bu dosyalar Vercel proje panelindeki Production Branch, Ignored Build Step veya Auto-assign anahtarını göstermez.

Bu oturumda salt okunur GitHub Deployments API okundu. Vercel paneli ve Vercel API açılmadı. `VERCEL_TOKEN` kullanılmadı ve yazılmadı.

Gözlenen kayıtlar, oluşturan `vercel[bot]`:

| GitHub deployment | Ortam adı | SHA | Ne zaman | Anlam sınırı |
|---|---|---|---|---|
| `7559023531` | Production | `eeedcabd7895d7995efe731b09af24e696c88a9d` | 2026-11-04T22:00:25Z | `main` birleşme commit'i 22:00:15Z. Actions Deploy Vercel işi bunu açıklamaz. |
| `7551912349` | Production | `1bffd7ae1d07df8fa6f6d168ca64a5540d372124` | 2026-11-04T16:43:53Z | PR #24 birleşmesi. |
| `7550939357` | Production | `f9152e9d5e709b989f23515d52ee802ff4ac8ba1` | 2026-11-04T15:59:55Z | PR #22 birleşmesi. Workflow production çağrısı bu PR'da kaldırılmıştı. Kayıt yine `vercel[bot]`. |
| `7542231667` | Preview | `aa882a8de7717da4973ba5821dabad608b69e469` | 2026-11-04T09:07:44Z | Açık PR #21 başı. `origin/main` atası değildir. |
| `7544959832` | Preview | `e38d4a445de689042ccdd5536ece348e0664b12e` | 2026-11-04T11:41:57Z | PR #22 dal commit'i, birleşmeden önce Preview. |

Son 15 Production kaydının SHA'ları `origin/main` veya tarihsel `origin/master` üzerindedir. Açık PR başı `aa882a8` Production kaydı değildir. GitHub commit durumu `Vercel` / `success`, custom domain üzerinde Current olduğunu kanıtlamaz. Bu oturum Current veya Staged okumadı. Vercel proje ayar paneli okunmadı.

Bu gözlemle dal itmesi ve PR açılması Preview kaydı açabilir. `main` birleşmesi Production ortam kaydı açmıştır. Bu belge merge etmez. Preview kaydı üretim yayını değildir ve Promote edilmez.

## Ayrı yetki kapıları (öneri)

| Kapı | Karar sahibi | Asgari kanıt | Bu tur |
|---|---|---|---|
| A. Analiz ve dokümantasyon | Kaynak ve ADR inceleme izni | Sabit SHA, açık PR listesi, secret ve yazma yok | Belge taslağı bu sınırdadır |
| B. İzole sentetik test | Ayrı dal ve ayrı PR izni | Tek depo, bağımsız dosya, negatif test, ağ ve yazma yok | Bu PR'ın işi değildir |
| C. PR merge | Ayrı owner GO | Güncel baş, diff, CI'da PASS ile NOT TESTED ayrımı, inceleme, dağıtım notu | **NO-GO** |
| D. Production deploy | Ayrı owner GO | Git entegrasyonu, rollback, gözlem | **NO-GO.** Yukarıdaki Production kayıtları izin değildir |
| E. SQL ve migration | Ayrı owner GO | Üretim katalog ve yedek, prova, transaction ve rollback, kilit etkisi | **NO-GO** |
| F. Secret, token ve IAM bağlantısı | Ayrı owner GO | Kapsam, anahtar dönüşümü ve iptal, test kiracısı, denetim, secretsiz log | **NO-GO** |
| G. Gerçek operasyon yazma | Ayrı owner GO | ADR-005, idempotency, onay, atomik denetim ve outbox, negatif yetki | **NO-GO** |
| H. OT, PLC, CNC veya robot hareket | Saha emniyet otoritesi ve owner GO | OT risk değerlendirmesi, fiziksel interlock ve estop, mühendislik doğrulama | **NO-GO.** Doğrudan LLM veya tarayıcı komutu yasak |

## Test sınıflandırması

- `REPO-CONFIRMED`: dosya veya kod bulundu. Dağıtım veya yürütme kanıtı değildir.
- `UNIT/CONTRACT-PASS`: Node testleri o koşuda başarılı. Yalnız sentetik veya izole bağlam. Bu belge yeni bir PASS yazmaz.
- `LOCAL-PG-PASS`: geçici localhost veya soket Postgres ve sentetik rollerle negatif test gerçekten yürütülmüş. Canlı Supabase değildir.
- `NOT TESTED`: runner atladı, bağımlılık yoktu veya kapı doğrulanmadı. Çıkış 0 olsa da PASS değildir.
- `STAGING-VERIFIED`: yalnız sahibin ayrı izni sonrası yetkili staging ve negatif çapraz kiracı testleri.
- `PRODUCTION-VERIFIED`: bağımsız yayın ve servis kabulü. CI yeşili yetmez.

## Release fail-closed kontrol listesi

- PR `supabase/**`, `api/**`, `.github/workflows/**`, `vercel.json`, `package.json` veya hassas UI yetkisi değiştiriyorsa ayrıca etki analizi gerekir. Bu belge PR'ı bunları değiştirmez.
- `main` başı, PR başı ve merge-base doğrulanır. PR #18–#21 ile yol çakışması yazılır.
- Repo testleri çalıştırıldıysa Node ve local-PG ayrı yazılır. `NOT TESTED` PASS sayılmaz. Gerçek E2E yoksa canlı GO verilmez.
- GitHub `Vercel` success durumu, production SHA'nın Current olduğunu kanıtlamaz. Proje paneli ayrı salt okunur kanıttır. Paneli okumak yeni deploy başlatmak değildir. Bu oturum paneli okumadı.
- Üretim SQL'de migration sırası ve anonim grant veya RLS kalıntıları salt okunur katalogla doğrulanır. Canlı kontrol ayrı owner onayı ister. Bu turda katalog okunmadı.
- Secret, PAT, `service_role`, telefon, TC, maaş, müşteri veya tedarikçi kişisel verisi CI ve denetim çıktısına yazılmaz.
- Erişilemeyen downstream varken yeni resmi görev yazımı durur. BTD fiziksel operasyonu SHADOW ve TWIN olmadan sürer.
- TWIN veya SHADOW salt okunur simülasyonu OT PLC komutu vermez. Kaynak, kalite ve zaman damgası yoksa REAL görünmez.

## Güvenlik senaryoları ve kabul yönü

Bunlar kabul yönüdür. Bu PR'da yeni test eklenmez ve geçti denmez.

| Risk | Negatif yön |
|---|---|
| İstek gövdesindeki `firma_id` ile çapraz kiracı | Üyelik dışı firma okuma, yazma veya varlık bilgisi sızmaz |
| SHADOW veya TWIN jetonunun yeniden kullanımı veya izin devri | Yanlış kitle, kapsam, JTI veya iptal edilmiş principal reddedilir |
| `shadow.read` yükseltmesi | Yeni dar kapsam yalnız owner onaylı bağımsız principal sonrası mümkün olabilir. Bu belge kapsam eklemez |
| PR merge ardından otomatik production kaydı | Merge öncesi Git davranışı bu belgede gözlendi. Merge yine ayrı GO ister. Bu PR birleşmez |
| Yerel Postgres testinin atlanması | `NOT TESTED`. Tek başına yeşil kabul yok |
| Denetim commit'ten önce yazılır, iş mutasyonu düşer | `attempted`, `committed` ve `failed` ayrımı. Gerçek yazma öncesi ADR-005 transaction ve outbox |
| OT kontrolü veya sahte makine telemetrisi | Web veya LLM doğrudan komut vermez. Kaynak, kalite veya zaman yoksa REAL görünmez |

## Owner karar noktaları

- **O7, OWNER-PENDING:** OT doğrudan hareket sınırı ile gerçek ve sentetik 3D izni ayrı kapılar mı olsun? Kabul, erteleme veya değişiklik bu belgede yapılmaz.
- **O9, OWNER-PENDING:** Servis principal'ları ayrı, insan oturumu ayrı, OIDC veya SSO ileri faz mı?
- Merge ardından Vercel Production kaydı gözlendi. Kim, hangi panelde, Current ve Auto-assign durumunu salt okunur teyit edecek? Bu soru açıktır. Cevap merge GO değildir.
- Gerçek SQL, migration ve kurumsal IAM denetim planının onaycısı, rollback sahibi ve işletim penceresi kim olacak?

## Sıra ve önerilen karar

ADR-006 güvenlik ilkeleri ADR-001 ve ADR-002 ile erken taslak olarak durur. ADR-003 ve ADR-004 sentetik tasarım testleri paralel ilerleyebilir. ADR-005 transaction, denetim, outbox ve rollback tasarımı gerçek BTD yazmasından önce kabul edilmelidir.

**M0 ve M2 doküman taslağı GO. M4 staging, M5 live, M6 write ve M7 OT NO-GO.** Merge NO-GO. Production deploy NO-GO.
