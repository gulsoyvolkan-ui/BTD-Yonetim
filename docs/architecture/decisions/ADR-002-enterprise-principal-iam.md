# ADR-002 — Enterprise Principal, Agent Identity and IAM

**Durum:** PROPOSED / OWNER APPROVAL PENDING  
**Tarih:** 2026-11-05  
**Lider:** BTD Core Proje Geliştirme Ekibi. SHADOW ve BTD TWIN teknik danışmadır. Bu PR onların deposuna yazmaz.  
**Kaynak SHA:** `gulsoyvolkan-ui/BTD-Yonetim@eeedcabd7895d7995efe731b09af24e696c88a9d` (`git fetch origin main`, 2026-11-05)  
**Bağlı taslaklar:** D04, D09, O8, O9, ADR-001, ADR-003, ADR-005, ADR-006  
**Kısıt:** Bu belge SQL migration, scope kabulü, enum kabulü veya gerçek kullanıcı ve servis açılışı değildir. O8 ve O9 APPROVED değildir. Tablo yaratılmaz.

## Problem

BTD, kurumsal gerçek kişiyi, hesabı, fiziksel personeli, dijital ajan kimliğini, servis kimlik bilgisini, SHADOW uzman tanımını ve her çalıştırma örneğini tek nesne gibi kullanamaz. Mevcut `gorevler.atanan TEXT`, bir departman adı veya imzalı bir servis jetonu insan ya da ajan yetkisini kanıtlamaz.

## Kod ve şema kanıtı

Aşağısı `eeedcabd7895d7995efe731b09af24e696c88a9d` dosya içeriğidir. Canlı Supabase kataloğu okunmadı. Dosyada duran CHECK veya rol adı üretimde uygulanmış sayılmaz.

| Kavram | Şu anki kaynak | Kısıt |
|---|---|---|
| Fiziksel personel | `supabase/001_schema.sql` `personel(id, firma_id, personel_kodu, ad_soyad, departman, yaka, ise_baslama, maas, durum, tc_no, telefon, eposta, adres, ...)`. `firma_id` `firmalar`'a bağlıdır. | `maas` ve `tc_no` hassas kişisel veridir. Dijital ajana personel veya bordro kartı açılmaz. Bu belge örnek kişi verisi taşımaz. |
| İnsan hesabı | `kullanicilar(id, auth_user_id, kullanici_adi, ad_soyad, sifre_hash, rol, kapsam, tum_grup, is_god, erisim_kritik, yaka, personel_id, tc_no, telefon, eposta, adres, aktif, ...)`. `auth_user_id` boş olabilir. `personel_id` boş olabilir. | `rol` metni ve boolean bayraklar `kullanici_firmalar` üyeliğinin yerine geçmez. `013` içinde `btd_firma_erisir`, `tum_grup` tek başına yetmez der. Fonksiyonun canlıda kurulu olduğu bu turda kanıtlanmadı. |
| Firma üyeliği | `kullanici_firmalar(kullanici_id, firma_id)` bileşik birincil anahtar. Başka kolon yoktur. | Rol, scope, süre veya iptal kolonu yoktur. Kurumsal ajan ataması bu tablo değildir. |
| Modül izinleri | `kullanici_yetkileri(kullanici_id, modul, gorebilir, duzenleyebilir, silebilir, aktarabilir)`. | İnsan modül bayraklarıdır. Servis scope'u değildir. |
| Üyelik SQL dosyası | `supabase/013_auth_membership.sql`: `denetim_olaylari`, `btd_oturum_baglami`, `btd_firma_erisir`. Dosya başlığı, o PR sırasında canlıda çalıştırılmadığını yazar. `auth_user_id` boşsa oturum bağlamı uydurulmaz. | Üretim RLS durumu repo dosyasından çıkmaz. |
| Servis kayıt taslağı | `supabase/030_shadow_kimlik.sql`: `btd_servis_kayit(servis_kod, ad, izinli_firma_ids, kapsam, anahtar_surum, onceki_anahtar_surum, etkin, iptal_zamani, gecerlilik_sonu, ...)`. Kapsam CHECK'i yalnız `shadow.read` içerir. `etkin` varsayılanı `false`. Aynı dosyada `btd_shadow_jti` ve `btd_servis_denetim` vardır. | Dosya başlığı canlıda çalıştırılmadığını ve üretim sırasına eklenmediğini söyler. Anahtar değeri dosyada yoktur. `twin.read` ve yazma kapsamı yoktur. Guard olmadan dosya durur. |
| Servis imzası | `api/_lib/shadow.js`: HMAC, kitle (`aud`), konu (`sub`), en fazla 300 saniye, JTI ve anahtar sürümü tasarımı. İzin sabiti `shadow.read`. | İmzalı claim ve tek servis kaydı ortak IAM veya üçlü SSO değildir. |
| Kimlikli dar okuma | `api/shadow-read.js`, `api/_lib/membership.js`. | Okuma özetidir. Uçtan uca staging veya gerçek RLS kabulü bu belge değildir. `api/_lib/shadow-read.rls.test.js` canlı Postgres yoksa `NOT TESTED` yazıp çıkar. Çıkış 0, RLS PASS değildir. |
| Sentetik iş talebi | `api/_lib/business-request-draft.js`: `LIVE_WRITES_ENABLED = false`. `serverContext` yalnız insan aktörünü içeri alır. `shadow` ve `shadow.read` ret kodu `shadow_read_yazamaz`. | `approve()` canlı yazmaz. Servis ajanına yazma izni yoktur. Bellek defteri veritabanı kanıtı değildir. |
| Görev atananı | `supabase/010_gorevler.sql` `atanan TEXT`. | Enterprise principal foreign key'i yoktur. Görünen ad ile yetki ilişkisi kurulamaz. |
| Kurumsal ajan kimliği | Bu depoda doğrulanmış tablo veya rol modeli yoktur. | D04 ve O8 bekler. Bu PR tablo açmaz. |
| SHADOW uzmanı ve yürütme | SHADOW deposunun kendi kayıtları. Bu PR o depoya yazmaz. | İşletme principal'ı değildir. Eşleme ve denetim ayrıca gerekir. |

`api/_lib/shadow-kimlik.pg.test.js` yerel Postgres denemesidir. Güncel `.github/workflows/test.yml` bu dosyayı çağırmaz. Çağrılmaması bu belgede PASS veya FAIL sayılmaz. Bu PR test iş akışını değiştirmez.

## Önerilen ayrık mantıksal nesneler

İsimler şema önerisidir. Uygulanmış tablo, kolon veya enum değildir.

1. **Human identity / account.** Supabase Auth hesabı ve BTD `kullanicilar`. `personel` isteğe bağlı iş ilişkisidir. Kişisel veriler sınırlı kalır.
2. **Corporate digital agent profile.** BTD'de kurumsal tanım, önerilen yaşam sözcükleri (`proposed`, `enabled`, `suspended`, `revoked`), sahip ve denetim. İlgili gerçek kişi veya yönetici ayrıca gerekir. Bordro kaydı değildir.
3. **Firm-specific agent assignment / grant.** Ajan profiline firma, site, rol, capability ve scope, geçerlilik ve iptal. Tek global profilin birden fazla firmaya bağlanması mümkün olabilir. Bu O8 kararıdır.
4. **Technical service principal.** SHADOW veya TWIN servis uygulamasının makine kimliği ve kimlik bilgisi. Ajan profili ile aynı kimlik değildir. Bir servis birçok uzmanı teknik olarak taşıyabilir.
5. **SHADOW specialist definition / version.** Araç, model, sorumluluk ve kabiliyet manifestosu. Otorite SHADOW'dur.
6. **Execution instance / evidence.** Somut yürütme, yürütme kimliği, sonuç, kanıt referansı, kaynak ve zaman. SHADOW yürütür. BTD ancak doğrulanmış referansı tüketir.
7. **Human approval / delegation event.** Hangi yetkili insanın, neyi, hangi şirket için, hangi sürümde ve ne kadar süreyle onayladığı. `on_behalf_of` iddiası salt ajan gövdesinden alınamaz.

Önerilen bağlar: kurumsal ajan profili, firma ataması ve grant üzerinden BTD `firmalar` ile konuşur. Firma ataması, SHADOW uzman tanımının kimlik ve sürümüne eşlenebilir. Yürütme örneği SHADOW'a aittir ve ileride BTD iş olayı veya resmi görev referansıyla ilişkilendirilebilir. Bu cümleler tablo tanımı değildir.

## Güvenlik kararları (öneri)

- **Varsayılan ret.** Yeni kurumsal ajan için başlangıçta hiçbir operasyon yazma yetkisi yoktur. Okuma kapsamı da servise ayrı ve açık grant ister.
- **Kiracı sınırı.** `firma_id` istek gövdesinden, kaynak e-postadan, SHADOW fixture kimliğinden veya TWIN `btdId` ifadesinden yetki türetilmez. Sunucu üyeliği, servis kaydı ve veritabanı politikası doğrular. Bu politikaların canlıda kurulu olduğu iddia edilmez.
- **Kapsam ayrımı.** Dosyada ve kodda görülen `shadow.read` yalnız mevcut dar okuma sabitidir. `twin.read` ve `business_request.draft.submit` yalnız ad önerisidir. Var olmayan kapsam üretime eklenmez. Okuma, yazmaya yükselmez.
- **Servis ayrımı.** SHADOW ve TWIN farklı principal, kitle, anahtar dönüşümü, iptal ve denetim tutar. SHADOW servis jetonu TWIN'e kopyalanmaz ve tarayıcıya verilmez.
- **İnsan onayı.** Servis kimlik bilgisi veya ajan karar önerisi insan onayı sayılmaz. Onay kaydı BTD'ye aittir. Süre, sürüm ve izin referansı zorunlu olmalıdır.
- **Kanıt ayrımı.** Kayıtlı olmak, çalıştırılabilir olmak, çalışıyor olmak, tamamlanmış olmak ve taze olmak aynı şey değildir. SHADOW etiketi resmi BTD görevini kapatmaz.
- **İptal.** Askıya alınan ajan, servis veya yetki yeni iş ve yeni jeton üretimini kesmelidir. Tamamlanmış tarihi denetim kaydı silinmez.
- **Gizlilik.** Bordro, TCKN, özel finans ve biyometrik kamera alanları varsayılan SHADOW veya TWIN projeksiyonuna girmez.

## Karar bekleyen alternatifler

| Konu | A, önerilen | B, risk |
|---|---|---|
| Ajan modeli | Global mantıksal profil, firma bazlı grant, ayrı service principal | Ajan başına `personel` veya tek `kullanicilar` satırı. Bordro, kimlik ve yetki karışır. |
| İnsan kimlik | Bugünkü Supabase Auth doğrulaması korunur. Servis IAM aşamalıdır. OIDC veya SSO ayrı ADR ister. | SHADOW giriş kodunu kurumsal IAM saymak. |
| Servis yetkisi | Ayrı issuer ve audience, BTD kayıt defteri, JTI, iptal, dar veritabanı rolü | Tek başına `x-api-key` veya `service_role` ile tablo erişimi. |
| Kiracı ilişkisi | Kaynak BTD `firmalar` ve yetkili `kullanici_firmalar` veya ilerideki firma grant'i | İstemci `firma_id` veya TWIN objesinden yetki almak. |

## Owner karar defteri

Hepsi OWNER-PENDING. Hiçbiri APPROVED, DEFERRED veya REJECTED yapılmadı. Raporlama sözlüğü bu dört sonucu da taşır. Bu turda değer yalnız beklemedir.

- **O8-A:** Global ajan profili ve firma ataması ilke olarak kabul, erteleme veya değişiklik mi?
- **O8-B:** Aynı SHADOW uzmanı birçok firma ajan profiline atanabilir mi? Hangi şirket sahibi onaylar?
- **O8-C:** Ajanı kim askıya alır veya iptal eder? Aktif yürütmenin iptali ve sonraki denetim politikası nedir?
- **O9-A:** Önce SHADOW ve TWIN için bağımsız dar service principal, kurumsal SSO veya OIDC sonra mı?
- **O9-B:** `on_behalf_of` yetkisinin süresi, tek kullanımlılığı ve insan onayı tanımı nedir?
- **O9-C:** Staging salt okuma için kiracı allowlist'i ve rol veya üyelik matrisini kim onaylar?

## Test ve kabul paketi

Aşağısı istenen negatif yönlerdir. Bu PR onları çalıştırmaz ve yeni test dosyası eklemez. Geçti yazılmaz.

| Negatif yön | Beklenen sonuç, henüz bu PR'ın kanıtı değil |
|---|---|
| İmzasız, bozuk imzalı, yanlış kitle veya issuer, süresi geçmiş servis claim | Ret. Veri ve görev mutasyonu yok. |
| `shadow.read` ile `approve()` veya `gorevler` yazma | Ret. Görev satırı oluşmaz. Kodda `shadow_read_yazamaz` ve `yazma_kapali` yolları vardır. Canlı yazma kapalıdır. Bu cümle yeni bir kabul koşusu değildir. |
| İstemci `firma_id` değiştirme veya yetkisiz site ve makine kimliği | Ret. Çapraz kiracı veri sızıntısı yok. |
| Tekrarlanan tek kullanımlık `jti`, iptal edilmiş servis, eski anahtar sürümü | Ret. Güvenilir denetim gerekir. |
| `personel` kimliği olmayan servis veya uzman kaydı | İnsan personel veya yönetici yetkisi kazanmaz. |
| Yürütme tamamlandı raporu veya TWIN atama tıklaması | BTD `gorevler` kapanışı veya yeni görev oluşmaz. |
| Ajan askısından sonra yeni yürütme veya yazma önerisi | Yeni yetki reddedilir. Eski kanıt korunur. Bu senaryo bugün uygulanmış test değildir. |
| Öneri, onay ve commit ayrımı | Her aşama ayrıdır. Gerçek yazma ADR-005 ve owner GO öncesi yapılamaz. |

Mevcut iş akışı `security.test.js`, `business-request-draft.test.js`, `shadow-read.contract.test.js` ve yerel `is-talebi-pg.test.js` adlarını çağırır. Bu belge o koşuların sonucunu uydurmaz. `shadow-kimlik.pg.test.js` iş akışında yoktur.

## Ön koşullar

**ADR taslak GO.** Şema, migration, secret, gerçek service principal, staging okuma, üretim yazma, merge ve deploy **NO-GO**. Sonraki kod PR'ı ancak O8 ve O9 onayı ve ayrı uygulama talimatıyla hazırlanır. Bu ADR tablo yaratmaz.
