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

Üç başlık birlikte gerekir.

- `x-api-key` kapıdır. Kimlik sayılmaz. Tek başına 401.
- `Authorization: Bearer` kullanıcının Supabase erişim jetonudur. Satırlar bu jetonla ve anon anahtarla okunur. Service role kullanılmaz.
- `x-btd-service-identity` makine kimliğidir. HMAC-SHA256, `base64url(json).base64url(imza)`. Yayıncı `btd`, izleyici `shadow-btd-read-v1`, izin `shadow.read`, süre en fazla 300 saniye. `sub` noktasız bir makine adıdır (`shadow-reader`). Kullanıcı jetonu bu alana veya bu başlığa kopyalanmaz. İki başlık aynı dizeyse 401.

Örnek claim, anahtar sözcüğü `ornek-imza-anahtari` ile, üretim anahtarı değildir:

```json
{
  "iss": "btd",
  "aud": "shadow-btd-read-v1",
  "sub": "shadow-reader",
  "firma_id": "11111111-1111-4111-8111-111111111111",
  "perm": "shadow.read",
  "iat": 1000,
  "exp": 1120
}
```

Paylaşılan imza anahtarının adı `BTD_SHADOW_SIGNING_KEY`. Değeri bu nota yazılmaz. Supabase service role bu anahtarın yerine geçmez.

## 4. Kiracı

`firma_id` sorgu parametresidir. Makine kimliğindeki `firma_id` ile aynı olmak zorundadır. Kullanıcının `btd_oturum_baglami` firmaları arasında yoksa 403 ve `PERMISSION_DENIED`. Okuyucu başka firmanın satırını doldurmaz. Süzgeç sunucudadır: `firma_id=eq.<uuid>`.

## 5. Hatalar

| Durum | HTTP | Gövde |
|---|---|---|
| Yazma | 405 | `writes: false`, `freshness: PERMISSION_DENIED` |
| Anahtar, kullanıcı jetonu veya makine kimliği eksik, süresi dolmuş, imza bozuk | 401 | `yetkisiz` veya `kimlik doğrulanamadı` |
| Firma üyeliği yok, makine kimliği başka firma | 403 | `freshness: PERMISSION_DENIED` |
| `firma_id` UUID değil | 400 | |
| Kaynak kesik, bilinmeyen durum, sayım 1000 satırda kesildi | 200 | `freshness: UNAVAILABLE`, `data: null` |

Kısmi sayım dönmez. Hata gövdesine jeton, anahtar veya satır yazılmaz.

## 6. Tazelik

`FRESH`: üç tablo okundu, gözlem 5 dakikadan yeni. `STALE`: gözlem daha eski. `UNKNOWN`: saat yok. `UNAVAILABLE`: kaynak yok veya sonuç güvenilmez; `data` null. `PERMISSION_DENIED`: yetki yok veya yazma denendi.

`guncellendi`, okunan satırlardaki `updated_at` alanının en yenisidir. Boş sonuçta null olur. Tazelik bundan ayrıdır: tazelik gözlem anıdır.

Geciken iş emri tanımı: `is_emirleri.durum = Aktif`, `siparis_id` dolu, bağlı `siparisler.teslim_tarihi` bugünden önce ve sipariş durumu `Tamamlandı` veya `İptal` değil. İş emrinde termin kolonu yoktur. Açık görev: `gorevler.durum` değeri `Açık` veya `Devam`.

## 7. SHADOW tarafında değişecekler

Bu depoda SHADOW kodu yoktur. `btd-read.ts` eklenmedi. SHADOW sunucusundaki service role istemcisi bu okumanın yolu değildir.

SHADOW tarafının yapması gerekenler:

1. BTD tablosunu service role ile okumamak.
2. Yalnız `GET /api/shadow-read` çağırmak. Yazma yöntemi göndermemek.
3. `x-api-key`, kullanıcı Bearer jetonu ve `x-btd-service-identity` başlıklarını ayrı tutmak.
4. `firma_id` değerini, jetonu alınan kullanıcının üyelik listesinden seçmek.
5. `data: null` ve `UNAVAILABLE` değerini iş hatası saymamak. `PERMISSION_DENIED` ile karıştırmamak.
6. Ham HMAC, Bearer ve API anahtarını loglamamak.

## 8. BTD bağımsızlığı

BTD ekranı bu ucu çağırmaz. SHADOW kapalı, ulaşılamaz veya 401 dönerse BTD açılışı ve bulut senkronu sürer. Okuma sözleşmesi BTD’nin çalışması için gerekli değildir.
