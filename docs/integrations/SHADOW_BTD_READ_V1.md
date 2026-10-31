# SHADOW okuma sözleşmesi v1

BTD’nin sözleşmesidir. SHADOW deposuna bağlanılmaz, yazılmaz, çağrılmaz. SHADOW kapalıyken BTD açılır. Bu uç BTD ekranının açılışına bağlı değildir.

Yazma kapalıdır. `POST`, `PATCH`, `PUT`, `DELETE` → 405, `writes: false`, `freshness: PERMISSION_DENIED`.

## Uç

`GET /api/shadow-read?firma_id=<üyelik uuid>`

İki akış birbirine karışmaz. Aynı dize iki başlıkta durursa 401. Eski `x-btd-service-identity` başlığı 401 döner. Service role anahtarı bu başlıkların hiçbirine konmaz. `SUPABASE_SECRET_KEY` okunmaz. BTD ekranları bu ucu çağırmaz. Canlı okuma bu sözleşmeyle açılmaz.

### Kullanıcı onayı

BTD kısa ömürlü onayı kendisi üretir (`POST /api/shadow-consent`). SHADOW onayı `x-btd-user-consent` başlığında taşır ve yeniden imzalamaz.

| Başlık | Rol |
|---|---|
| `x-api-key` | Kapı. Kimlik değildir. Tek başına 401. |
| `Authorization: Bearer` | Kullanıcının Supabase erişim jetonu. RLS bu jetonla uygulanır. |
| `x-btd-user-consent` | BTD’nin imzaladığı onay. |

HMAC-SHA256. Gövde `base64url(json).base64url(imza)`. Yayıncı `btd`. İzleyici `shadow-btd-read-v1`. Konu `user-consent`. İzin `shadow.read`. Alanlar: `firma_id`, `jti`, `iat`, `exp`. Süre en fazla 300 saniyedir. `firma_id` sorgu ile aynı olmalıdır. Süre dolmuş veya aynı `jti` ikinci kez gelirse 401. Görülen `jti` süreç belleğindedir; kopyalar arasında paylaşılmaz. Ham jeton yanıtta dönmez. İmza anahtarının adı `BTD_SHADOW_SIGNING_KEY`. Değeri bu nota yazılmaz ve SHADOW’a verilmez.

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

### Servis kimliği

SHADOW yalnız `iss=shadow` imzalar. BTD bu imzayı `x-shadow-service-identity` başlığında, imza anahtarından ayrı `BTD_SHADOW_SERVICE_VERIFY_KEY` ile doğrular. İki anahtar aynıysa çağrı reddedilir. Bu çağrıda `Authorization`, `x-btd-user-consent` ve `x-btd-service-identity` yoktur.

İzleyici `btd-shadow-service-v1`. Konu `shadow-service`. İzin `shadow.read`. Süre en fazla 300 saniye. Süre dolması ve aynı `jti` 401 döner. Firma uyuşmazlığı 403. Doğrulama satır uydurmaz: kullanıcı jetonu olmadığı için tablo okunmaz, yanıt 200, `data: null`, `freshness: UNAVAILABLE` olur. Bu bir iş hatası değildir.

```json
{
  "iss": "shadow",
  "aud": "btd-shadow-service-v1",
  "sub": "shadow-service",
  "firma_id": "11111111-1111-4111-8111-111111111111",
  "perm": "shadow.read",
  "jti": "00000000-0000-4000-8000-000000000002",
  "iat": 1000,
  "exp": 1120
}
```

## Kiracı

`firma_id` sorgu parametresidir ve UUID olmak zorundadır. Onayın veya servis kimliğinin `firma_id` değeri sorgu ile aynı olmalıdır. Kullanıcı jetonunun `btd_oturum_baglami` listesinde bu firma yoksa 403 ve `PERMISSION_DENIED`. Satır uydurulmaz. Kullanıcı akışında okuma `firma_id=eq.<uuid>` süzgeci ve kullanıcının jetonu ile gider.

## İzinli alanlar

Yanıtta yalnız şunlar vardır: `ref`, `durum`, `adet`, `guncellendi`, `kaynak_id`. Maliyet, fiyat, unvan, parola, `tc_no`, `teslim_tarihi` ve satır kimliği yanıta girmez.

`adet` sipariş özetinde sipariş sayısıdır. Kalem miktarı değildir.

Sipariş durumları, `public.siparisler.durum` kontrolünden: `Onaylandı`, `Revize Edildi`, `Üretimde`, `Tamamlandı`, `İptal`.

İş emri durumları, `public.is_emirleri.durum` kontrolünden: `Aktif`, `Tamamlandı`, `İptal Edildi`.

Görev durumları, `public.gorevler.durum` kontrolünden: `Açık`, `Devam`, `Bitti`, `İptal`. Açık veya süren görev `Açık` ve `Devam` sayılır.

Geciken iş emri: `durum = Aktif`, `siparis_id` dolu, bağlı sipariş `Tamamlandı` veya `İptal` değil, `siparisler.teslim_tarihi` bugünden önce. İş emri tablosunda termin kolonu yoktur. Bağı olmayan iş emri gecikmiş sayılmaz.

Liste dışı bir durum gelirse yanıt `data: null` ve `freshness: UNAVAILABLE` olur. Kısmi sayım dönmez.

Sentetik özet:

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

Boş tablolar da 200 ve `FRESH` döner. `siparis_ozet` boş dizi, sayılar 0, `guncellendi` null olur. Bu bir iş hatası değildir ve kaynağın kapalı olduğu anlamına gelmez. `data: null` ile `UNAVAILABLE` da iş hatası değildir.

## Tazelik

| Değer | Anlam |
|---|---|
| `FRESH` | Üç okuma da durdu, gözlem 5 dakikadan yeni, saat güvenilir |
| `STALE` | Gözlem 5 dakikadan eski |
| `UNKNOWN` | Saat veya gözlem zamanı yok |
| `UNAVAILABLE` | Okuma yok, kesik, bilinmeyen durum, sayım kesildi veya doğrulanmış servis kimliği tablo okumadı. `data` null. İş hatası değil |
| `PERMISSION_DENIED` | Üyelik yok, firma uyuşmuyor veya yazma denemesi |

## Hatalar

| Durum | Sonuç |
|---|---|
| Yazma yöntemi | 405 |
| Anahtar yok, onay veya servis kimliği yok, süresi geçmiş, aynı `jti`, imza bozuk, eski başlık, iki kimlik bir arada | 401 |
| Firma üyeliği yok veya onayın/servis kimliğinin firması başka | 403 `PERMISSION_DENIED` |
| `firma_id` UUID değil | 400 |
| Kaynak okunamadı | 200 `UNAVAILABLE`, `data: null` |

Okuma `GET` ile `siparisler`, `is_emirleri` ve `gorevler` tablolarının izinli kolonlarına gider. Yazma, güncelleme ve silme yoktur.
