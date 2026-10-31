# SHADOW ajanına teslim

Bu not BTD tarafındadır. SHADOW deposuna dosya eklenmedi. Canlı veritabanı sorgulanmadı. Aşağıdaki JSON sentetiktir. Üretim anahtarı, kullanıcı jetonu ve personel verisi yoktur.

## 1. Uç

`GET /api/shadow-read?firma_id=<uuid>`

Yalnız GET ve HEAD kabul edilir. POST, PATCH, PUT ve DELETE 405 döner. Gövde yazılmaz.

## 2. Sentetik JSON

```json
{
  "contract": "shadow-btd-read-v1",
  "writes": false,
  "freshness": "FRESH",
  "fields": ["ref", "durum", "adet", "guncellendi", "kaynak_id"],
  "data": {
    "kaynak_id": "btd-operasyon",
    "guncellendi": "2026-10-30T10:00:00Z",
    "siparis_ozet": [
      {
        "ref": "siparisler",
        "durum": "Üretimde",
        "adet": 1,
        "guncellendi": "2026-10-30T08:00:00Z",
        "kaynak_id": "siparisler"
      }
    ],
    "geciken_is_emri_adet": 1,
    "acik_gorev_adet": 2
  },
  "identity": {
    "iss": "btd",
    "aud": "shadow-btd-read-v1",
    "perm": "shadow.read",
    "firma_id": "11111111-1111-4111-8111-111111111111",
    "exp": 1120
  }
}
```

`adet` sipariş sayısıdır. Fiyat, unvan, `tc_no` ve termin tarihi bu gövdede yoktur. Boş firma da 200 döner: özet `[]`, sayılar 0, `guncellendi` null, `freshness` `FRESH`.

## 3. Kimlik

İki akış vardır. Aynı dize iki başlıkta durursa 401. Eski `x-btd-service-identity` kabul edilmez. SHADOW `iss=btd` imzalamaz. BTD imza anahtarı SHADOW ile paylaşılmaz.

Kullanıcı onayı:

- `x-api-key` kapıdır. Kimlik sayılmaz. Tek başına 401.
- `Authorization: Bearer` kullanıcının Supabase erişim jetonudur. Satırlar bu jetonla ve anon anahtarla okunur. Service role kullanılmaz.
- `x-btd-user-consent` BTD’nin ürettiği onayı taşır. SHADOW yeniden imzalamaz.

Onay: HMAC-SHA256, `base64url(json).base64url(imza)`. Yayıncı `btd`, izleyici `shadow-btd-read-v1`, konu `user-consent`, izin `shadow.read`, `jti` vardır, süre en fazla 300 saniye. Onay tek kullanımlıktır. Süre dolması ve aynı `jti` 401 döner. Tüketim Postgres’tedir. Depo doğrulanamazsa 503, tablo okunmaz.

```json
{
  "iss": "btd",
  "aud": "shadow-btd-read-v1",
  "sub": "user-consent",
  "firma_id": "11111111-1111-4111-8111-111111111111",
  "perm": "shadow.read",
  "jti": "00000000-0000-4000-8000-000000000001",
  "iat": 1000,
  "exp": 1120
}
```

Servis kimliği ayrıdır. SHADOW `iss=shadow` imzalar. Başlık `x-shadow-service-identity`. İzleyici `btd-shadow-service-v1`, konu `shadow-service`. BTD bunu imza anahtarından başka bir doğrulama anahtarıyla kontrol eder. Gövde `kv` anahtar sürümünü taşır. `use` yoksa jeton kısa tekrarlıdır; süre içinde aynı `jti` ikinci okumayı düşürmez. `use: "once"` tek kullanımlıktır. Bu çağrıda `Authorization` ve `x-btd-user-consent` yoktur.

Firma listesi imzadan okunmaz. BTD `btd_servis_kayit` satırına bakar. Kayıt firmayı içermiyorsa 403. İptal, kapalı kayıt, süre ve anahtar sürümü 401 döner; bunlar `UNAVAILABLE` değildir. Dar okuma `btd_shadow_okuyucu` rolündedir ve bu rol `NOLOGIN`dir. SHADOW Postgres bağlantısı almaz. BTD kendi `btd_shadow_kopru` girişi yoksa, uzaksa veya kanıtlanmazsa yanıt `data: null`, `freshness: UNAVAILABLE`, `read: BLOCKED` olur. Bağlantı koparsa `data: null` ve `UNAVAILABLE` döner; sayı 0 uydurulmaz. Bu sıfır toplam değildir ve iş hatası değildir. `service_role` bu okumayı çalıştıramaz.

İmza anahtarının adı `BTD_SHADOW_SIGNING_KEY`. Doğrulama anahtarının adı `BTD_SHADOW_SERVICE_VERIFY_KEY`. Sürüm adı `BTD_SHADOW_SERVICE_KEY_VERSION`. Değerler bu nota yazılmaz. İkisi aynı olamaz. Supabase service role bu anahtarların yerine geçmez.

## 4. Kiracı

`firma_id` sorgu parametresidir. Onaydaki veya servis kimliğindeki `firma_id` ile aynı olmak zorundadır. Kullanıcı akışında `btd_oturum_baglami` firmaları arasında yoksa 403 ve `PERMISSION_DENIED`. Okuyucu başka firmanın satırını doldurmaz. Süzgeç sunucudadır: `firma_id=eq.<uuid>`.

## 5. Hatalar

| Durum | HTTP | Gövde |
|---|---|---|
| Yazma | 405 | `writes: false`, `freshness: PERMISSION_DENIED` |
| Anahtar, kullanıcı jetonu veya onay eksik; süre dolmuş; tek kullanımlık `jti`; iptal; imza bozuk; eski başlık; anahtar sürümü uymuyor | 401 | `yetkisiz` veya `kimlik doğrulanamadı` |
| Jti deposu veya servis kaydı doğrulanamıyor | 503 | `writes: false`, tablo okunmaz |
| Firma üyeliği yok, onay başka firma veya servis kaydı firmayı içermiyor | 403 | `freshness: PERMISSION_DENIED` |
| `firma_id` UUID değil | 400 | |
| Kaynak kesik, bağlantı koptu, bilinmeyen durum, sayım 1000 satırda kesildi veya servis okuması `BLOCKED` | 200 | `freshness: UNAVAILABLE`, `data: null`. Bağlantı kopmasında sayı 0 yoktur. 401 ve 403 bu satıra girmez |

Kısmi sayım dönmez. Hata gövdesine jeton, anahtar veya satır yazılmaz.

## 6. Tazelik

`FRESH`: üç tablo okundu, gözlem 5 dakikadan yeni. `STALE`: gözlem daha eski. `UNKNOWN`: saat yok. `UNAVAILABLE`: kaynak yok, sonuç güvenilmez veya servis okuması `BLOCKED`; `data` null. `PERMISSION_DENIED`: yetki yok veya yazma denendi.

`guncellendi`, okunan satırlardaki `updated_at` alanının en yenisidir. Boş sonuçta null olur. Tazelik bundan ayrıdır: tazelik gözlem anıdır.

Geciken iş emri tanımı: `is_emirleri.durum = Aktif`, `siparis_id` dolu, bağlı `siparisler.teslim_tarihi` bugünden önce ve sipariş durumu `Tamamlandı` veya `İptal` değil. İş emrinde termin kolonu yoktur. Açık görev: `gorevler.durum` değeri `Açık` veya `Devam`.

## 7. SHADOW tarafında değişecekler

Bu depoda SHADOW kodu yoktur. `btd-read.ts` eklenmedi. SHADOW sunucusundaki service role istemcisi bu okumanın yolu değildir.

SHADOW tarafının yapması gerekenler:

1. BTD tablosunu service role ile okumamak.
2. `iss=btd` imzalamamak ve BTD imza anahtarını istememek.
3. Kullanıcı onayını `x-btd-user-consent` içinde taşımak, yeniden imzalamamak.
4. Servis çağrısında yalnız `iss=shadow` ve `x-shadow-service-identity` kullanmak. Kullanıcı jetonu ve onayı bu çağrıya koymamak.
5. Yalnız `GET /api/shadow-read` çağırmak. Yazma yöntemi göndermemek.
6. Kullanıcı akışında `firma_id` değerini üyelik listesinden seçmek. Servis akışında firma iznini imzaya yazmak yetki doğurmaz; BTD kaydı karar verir.
7. Boş 200 yanıtını, `data: null` ile `UNAVAILABLE` değerini ve `read: BLOCKED` değerini iş hatası veya sıfır toplam saymamak. `PERMISSION_DENIED`, 401 ve 403 ile karıştırmamak. Bağlantı kopmasında gelen `data: null` değeri sıfır iş değildir.
8. Ham HMAC, Bearer ve API anahtarını loglamamak. Postgres bağlantı dizesi, `btd_shadow_kopru` parolası ve BTD imza anahtarı istenmez.
9. Servis jetonuna `kv` koymak. Kısa tekrarlı jetonu süre içinde yeniden göndermek serbesttir. Tek kullanımlık onayın aynı `jti` değeri ikinci kez gönderilmez.
10. BTD tablosuna, `service_role` anahtarına ve Supabase’e SHADOW tarafından bağlanmamak. `SHADOW_BTD_LIVE` açmamak.

## 8. BTD bağımsızlığı

BTD ekranı bu ucu çağırmaz. `GET /api/health` SHADOW’a bağlanmaz; SHADOW kapalıyken `{ ok: true, shadowRequired: false }` döner. SHADOW ulaşılamaz veya 401 dönerse BTD açılışı ve bulut senkronu sürer. Okuma sözleşmesi BTD’nin çalışması için gerekli değildir.
