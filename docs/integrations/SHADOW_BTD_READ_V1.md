# SHADOW okuma sözleşmesi v1

BTD’nin sözleşmesidir. SHADOW deposuna bağlanılmaz, yazılmaz, çağrılmaz. SHADOW kapalıyken BTD açılır. Bu uç BTD ekranının açılışına bağlı değildir.

Yazma kapalıdır. `POST`, `PATCH`, `PUT`, `DELETE` → 405, `writes: false`, `freshness: PERMISSION_DENIED`.

## Uç

`GET /api/shadow-read?firma_id=<üyelik uuid>`

Başlıklar:

| Başlık | Rol |
|---|---|
| `x-api-key` | Kapı. Kimlik değildir. Tek başına 401. |
| `Authorization: Bearer` | Kullanıcının Supabase erişim jetonu. RLS bu jetonla uygulanır. |
| `x-btd-service-identity` | Kısa ömürlü makine kimliği. Kullanıcı jetonundan ayrıdır. |

İkisi aynı dizeyse 401. Service role anahtarı bu başlıkların hiçbirine konmaz. `SUPABASE_SECRET_KEY` okunmaz.

## Kimlik

HMAC-SHA256. Gövde `base64url(json).base64url(imza)`. İzleyici `shadow-btd-read-v1`. Yayıncı `btd`. İzin `shadow.read`. Süre en fazla 300 saniye. `sub` nokta içermez; kullanıcı jetonu buraya yazılmaz. `firma_id` sorgu ile aynı olmalıdır. Ham jeton yanıtta dönmez.

Örnek claim. Anahtar sözcüğü `ornek-imza-anahtari` yalnızca örnektir:

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

## Kiracı

`firma_id` sorgu parametresidir ve UUID olmak zorundadır. Makine kimliğinin `firma_id` değeri sorgu ile aynı olmalıdır. Kullanıcı jetonunun `btd_oturum_baglami` listesinde bu firma yoksa 403 ve `PERMISSION_DENIED`. Satır uydurulmaz. Okuma `firma_id=eq.<uuid>` süzgeci ve kullanıcının jetonu ile gider.

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

Boş tablolar da 200 ve `FRESH` döner. `siparis_ozet` boş dizi, sayılar 0, `guncellendi` null olur. Bu, kaynağın kapalı olduğu anlamına gelmez.

## Tazelik

| Değer | Anlam |
|---|---|
| `FRESH` | Üç okuma da durdu, gözlem 5 dakikadan yeni, saat güvenilir |
| `STALE` | Gözlem 5 dakikadan eski |
| `UNKNOWN` | Saat veya gözlem zamanı yok |
| `UNAVAILABLE` | Okuma yok, kesik, bilinmeyen durum veya sayım kesildi. `data` null |
| `PERMISSION_DENIED` | Üyelik yok, firma uyuşmuyor veya yazma denemesi |

## Hatalar

| Durum | Sonuç |
|---|---|
| Yazma yöntemi | 405 |
| Anahtar, kullanıcı jetonu veya makine kimliği yok, süresi geçmiş, imza bozuk | 401 |
| Firma üyeliği yok veya makine kimliğinin firması başka | 403 `PERMISSION_DENIED` |
| `firma_id` UUID değil | 400 |
| Kaynak okunamadı | 200 `UNAVAILABLE`, `data: null` |

Okuma `GET` ile `siparisler`, `is_emirleri` ve `gorevler` tablolarının izinli kolonlarına gider. Yazma, güncelleme ve silme yoktur.
