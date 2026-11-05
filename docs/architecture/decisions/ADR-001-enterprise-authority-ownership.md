# ADR-001 — Enterprise Authority and Record Ownership

**Durum:** PROPOSED / OWNER APPROVAL PENDING  
**Tarih:** 2026-11-05  
**Hazırlayan:** BTD Core Proje Geliştirme Ekibi  
**Uygulayıcı sınırı:** BTD Core Cursor, yalnız bu depodaki belge değişikliği  
**Kaynak SHA:** `gulsoyvolkan-ui/BTD-Yonetim@eeedcabd7895d7995efe731b09af24e696c88a9d` (`git fetch origin main`, 2026-11-05)  
**Bağlı taslaklar:** D01, D02, D03, D06, D10; O3, O8; ADR-002, ADR-003, ADR-004, ADR-005, ADR-006  
**Bu belge:** Kabul edilmiş mimari karar, API sözleşmesi, SQL, enum veya üretim durumu değildir. Yeni tablo yaratmaz. O3 ve O8 APPROVED değildir.

## Problem ve bağlam

BTD Core, SHADOW ve BTD TWIN aynı işletme nesnelerini farklı amaçlarla göstermeye hazırlanıyor. Tek veri sahipliği kurulmazsa bir sistemin ara durumu diğerinin resmi kaydı sanılabilir. Özellikle bir TWIN sürüklemesi fiziksel makine transferi, bir SHADOW yürütme tamamlanması da BTD görev kapanışı değildir.

Bu ayrım bugün bir sözleşme olarak yayınlanmış değildir. Aşağıdaki satırlar, adı geçen kaynaktaki dosya içeriğidir. Canlı katalog, RLS ve grant bu belgede doğrulanmış sayılmaz.

## Kaynak kanıtı (repo dosyası, üretim kataloğu değil)

| Alan | Repoda görülen kaynak | Sınır |
|---|---|---|
| Firma ve üyelik | `supabase/001_schema.sql`: `firmalar`, `kullanicilar`, `kullanici_firmalar`, `kullanici_yetkileri`. Üyelik fonksiyonları `supabase/013_auth_membership.sql` içinde `btd_firma_erisir` ve `btd_oturum_baglami`. İlgili okuma yardımcıları `api/_lib/membership.js`. | `013` başlığı, o dosyanın yazıldığı PR sırasında canlı veritabanında çalıştırılmadığını söyler. Üretim RLS/grant kataloğu bu turda okunmadı. |
| Atölye ve makine | `001_schema.sql`: `atolyeler(id, ad)`, `atolye_firmalar(atolye_id, firma_id)`, `makineler(id, atolye_id, ad, alt_bilgi, ikon, aktif)`. `is_emirleri` aynı dosyada tanımlıdır. | `makineler` içinde `firma_id` kolonu yoktur. Firma ilişkisi dosyada atölye-firma bağından gider. Bunun canlıda böyle durduğu ayrıca kanıtlanmadı. |
| Resmi görev satırı | `supabase/010_gorevler.sql`: `gorevler(id, firma_id, kod, baslik, aciklama, atanan, termin, durum, ...)`. | `atanan` tipi `TEXT`. Kurumsal ajan foreign key'i değildir. Dosyadaki `durum` CHECK değerleri (`Açık`, `Devam`, `Bitti`, `İptal`) bu belgenin önerdiği yaşam döngüsü değildir ve üretimde uygulandığı iddia edilmez. |
| SHADOW dar okuma | `api/shadow-read.js`, `api/_lib/shadow.js`. İzin sabiti `shadow.read`. İzleyici `shadow-btd-read-v1` / servis izleyici `btd-shadow-service-v1`. Üst süre 300 saniye. | Bu sabitler dar okuma kodudur. TWIN servisine veya göreve yazma yetkisi değildir. |
| SHADOW'dan taslak | `api/_lib/mail-intake-map.js`, `api/_lib/business-request-draft.js`. `LIVE_WRITES_ENABLED = false`. `serverContext` `shadow` aktörünü ve `shadow.read` iznini reddeder. | Bellek taslağıdır. Gerçek görev oluşturmaz. `approve()` yolu canlı commit yapmaz. |
| Taslak SQL | `supabase/drafts/is_talebi_taslak_v1.sql` ilk korumada durur. | Üretim migration'ı değildir. Bu ADR onu çalıştırmaz. |

SHADOW Agent Office ve TWIN layout depoları bu repoda değildir. Onlar hakkında bu belge resmi görev veya sahne otoritesi kurmaz.

## Önerilen karar (owner onayı yok)

İlke önerisi: tek resmi yazar ve ayrık veri otoritesi.

| Kaynak veya işlem | Önerilen resmi yazar | Diğerlerinin önerilen rolü |
|---|---|---|
| Firma, insan üyeliği, kurumsal ajan profili ve kurumsal iş yetkisi | BTD Core | SHADOW ve TWIN, ileride ancak firma kapsamlı ve izinli projeksiyon tüketir. Bu projeksiyonun API'si bugün yoktur. |
| Ticari kayıt, iş emri, stok, kalite, operasyonel görev, kurumsal onay ve gerçek commit | BTD Core | SHADOW önerir veya koordine eder. TWIN görüntüler veya talep sunar. |
| Ajan uzman tanımı, model ve araç yönlendirmesi, tekil yürütme ve yürütme kanıtı | SHADOW | BTD, resmi iş kararı için ancak doğrulanmış kanıt referansını değerlendirir. TWIN görünüm sunabilir. |
| Sahne, kat, obje koordinatı, yayınlanmış layout revizyonu ve görsel bağ | BTD TWIN (hedef, O3 bekliyor) | BTD gerçek varlık, firma kapsamı ve erişim hakkını doğrular. Rakip bir binding ana tablosu bu belgeyle açılmaz. |
| Ham sensör veya PLC gözlemi ve emniyet-kritik hareket | Yetkili OT saha sistemi | BTD yetkili operasyonel sonuç veya özet tutabilir. SHADOW ve TWIN LLM veya tarayıcı üzerinden hareket komutu vermez. |

### Birbirine dönüşmeyen durum sözcükleri

Aşağıdaki adlar önerilen sözlüktür. Veritabanı CHECK'i, API enum'u veya üretim durumu değildir. Mevcut `gorevler.durum` dosya CHECK'i bu listeyle değiştirilmez.

- `proposed`: değişiklik isteği. Yetki veya iş kaydı değildir.
- `accepted_for_review`: incelemeye alındı. Onay değildir. SHADOW tarafındaki bir inceleme etiketi, BTD görev satırını kendiliğinden `incelemede` yapmaz.
- `approved`: yetkili insan veya politika onayı. Veritabanı commit'i olmayabilir.
- `committed`: BTD'nin atomik ve denetlenebilir işlem sonucu. Resmi görev satırı ancak bu sınıfta düşünülür. Bu sınıf bugün uygulanmış bir transaction değildir.
- `execution_completed`: SHADOW yürütmesinin kanıtlı sonucu. BTD resmi görev kapanışı değildir.
- `published_layout`: TWIN sahne revizyonu. Fiziksel transfer, görev veya bakım kaydı değildir.

### Komut ve olay ayrımı

1. TWIN veya SHADOW bir iş önerisi üretirse, ileride ayrıca onaylanacak bir BTD uç noktasına öneri olarak sunar. Bu uç bugün yoktur ve bu belge onu tanımlamaz.
2. BTD kurumsal aktörü, firma ve varlığı, kaynak revizyonunu, onayı ve mükerrerliği sunucu ve veritabanı sınırında kontrol eder. İstek gövdesindeki `firma_id` yetki kaynağı değildir.
3. İş kaydı, denetim ve outbox aynı işlem içinde commit edildikten sonra diğer sistemler doğrulanmış durumu tüketebilir. Bu transaction ADR-005 ve ayrı bir uygulama GO olmadan yazılmaz.
4. `correlation_id` taşımak veya animasyon üretmek commit değildir.

## Kabul edilebilir alternatifler

- **A, önerilen:** Üç ayrı depo, ayrı veri sahipleri, dar ve sürümlü DTO ve olaylar, BTD merkezi operasyon otoritesi. Sistemler bağımsız kalır. Entegrasyon ve olay gözlemi ayrıca gerekir.
- **B, reddedilmesi önerilen:** Aynı veritabanı rolünü veya ortak görev tablosunu üç sisteme yazdırmak. Yetki ve kiracı sınırı zayıflar.
- **C, geçici:** Tamamen sentetik fixture ve ağsız, yazmasız test. Gerçek bağlantı yetkisi yaratmaz.

## Owner kararları

Hiçbiri bu belgeyle APPROVED edilmez.

1. **O3, OWNER-PENDING:** TWIN kurumsal sahne ve binding için tek yazar olsun mu? BTD yalnız yetkili varlık doğrulayıcısı mı kalsın?
2. **O8, OWNER-PENDING:** Kurumsal ajan kimliği global profil ve firma ataması olarak mı kurulsun? ADR-002 kesinleşmeden uygulama yok.
3. Makineyi görme ile bir iş emrinde makine kullanma veya atama ayrı izinler mi olsun? Atölye birden fazla firmaya bağlı olabilir. Kaynak dosyada `atolye_firmalar` çoklu firma bağını taşır. Canlı veri doğrulanmadı.
4. `proposed`, `approved`, `committed` ve yürütme tamamlanması arasındaki işlem sözleşmesini kim yayınlayacak? ADR-005'e bağlıdır.
5. Ayrı sistem erişilemezse son doğrulanmış veriyi `STALE` veya `UNAVAILABLE` göstermek zorunlu mu? Öneri evettir. `api/_lib/shadow.js` içinde `classifyFreshness` bugün dar okuma için `STALE`, `UNAVAILABLE`, `UNKNOWN`, `FRESH` ve `PERMISSION_DENIED` üretir. Bu fonksiyon kurumsal outage sözleşmesi değildir.

## Doğrulanabilir kabul düşünceleri

Bunlar ileride yazılacak testlerin yönüdür. Bu PR'da test, SQL veya runtime eklenmez. Bugün geçtiği iddia edilmez.

- SHADOW yürütme tamamlandı bilgisi `gorevler` satırını değiştirmez.
- TWIN layout sürükleme veya boyut değiştirme BTD makine, yerleşim veya iş emri kaydını değiştirmez.
- Aynı `btdId` yetkili bir fixture'da doğrulanmadıysa `BOUND` veya `REAL` gösterilmez.
- Çapraz firma varlık erişimi, üyelik dışı aktör ve doğrulanmamış atölye-firma ilişkisi kapalı kalır.
- SHADOW veya TWIN geçici olarak yokken BTD görev ve iş emri ekranları kendi verisiyle açılır.
- Geçici veya sentetik görev kimliği ve `correlation_id` resmi görev kimliği gibi sunulmaz.

## Release ve bağımlılık

**ADR taslağı GO.** Canlı entegrasyon, yeni API, SQL, merge, deploy ve OT **NO-GO**. ADR-002 ve ADR-006 bu belgeyle birlikte erken taslaktır. ADR-003 ve ADR-004 bundan sonra uyumlu sözleşme tasarlar. Transaction ve outbox, ADR-005 gerçek yazmadan önce kesinleşmelidir.
