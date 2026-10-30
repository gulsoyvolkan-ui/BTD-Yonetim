# SHADOW okuma sözleşmesi v1

BTD’nin sözleşmesidir. SHADOW deposuna bağlanılmaz, yazılmaz, çağrılmaz. SHADOW kapalıyken BTD açılır. Bu uç veri dönmez; `freshness` `UNAVAILABLE` olur.

Yazma kapalıdır. `POST`, `PATCH`, `PUT`, `DELETE` → 405 ve `writes: false`.

## Kimlik

Kısa ömürlü HMAC. İzleyici `shadow-btd-read-v1`. Süre en fazla 300 saniye. `firma_id` istemciden değil, sunucu üyelik listesinden gelir. Ham jeton yanıtta dönmez.

Örnek claim (sentetik anahtar `ornek-imza-anahtari`, üretim anahtarı değildir):

```json
{
  "aud": "shadow-btd-read-v1",
  "sub": "44444444-4444-4444-8444-444444444444",
  "firma_id": "11111111-1111-4111-8111-111111111111",
  "iat": 1000,
  "exp": 1120
}
```

## İzinli alanlar

`ref`, `durum`, `adet`, `guncellendi`. Maliyet, parola, `tc_no` ve liste dışı kolon düşer.

Sentetik satır:

```json
{
  "ref": "S-ORNEK-1",
  "durum": "Açık",
  "adet": 2,
  "guncellendi": "2026-11-02T08:00:00Z"
}
```

## Tazelik

| Değer | Anlam |
|---|---|
| `FRESH` | Kaynak ayakta, gözlem 5 dakikadan yeni, saat güvenilir |
| `STALE` | Gözlem 5 dakikadan eski |
| `UNKNOWN` | Saat veya gözlem zamanı yok |
| `UNAVAILABLE` | Kaynak yok veya kapalı. Bugünkü HTTP yanıtı budur |
| `PERMISSION_DENIED` | Üyelik yok veya yazma denemesi |

Bugünkü okuma örneği:

```json
{
  "contract": "shadow-btd-read-v1",
  "writes": false,
  "freshness": "UNAVAILABLE",
  "fields": ["ref", "durum", "adet", "guncellendi"],
  "data": null,
  "identity": {
    "aud": "shadow-btd-read-v1",
    "firma_id": "11111111-1111-4111-8111-111111111111",
    "exp": 1120
  }
}
```

Uç: `GET /api/shadow-read?firma_id=<üyelik uuid>`. `x-api-key` kimlik değildir; `Authorization: Bearer` kullanıcı jetonu da gerekir. İkisi birden yoksa 401. Firma üyelikte yoksa 403 ve `PERMISSION_DENIED`. Bu uç personel, firma satırı veya `tc_no` okumaz. SHADOW tarafına iş verisi yetkisi eklenmez.
