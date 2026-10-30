# Test sonucu

Tarih: 2026-10-30. Üretim veritabanı yok. Staging veritabanı yok. Postgres yok. SHADOW deposu değişmedi.

## Geçen

`node api/_lib/security.test.js`

- 72 doğrulama.
- SHADOW HTTP: yazma 405, okuma `UNAVAILABLE`, dış host yok.
- Oturumsuz bulut açılışı istemci açmaz. Oturumlu açılış yerel satır yazmaz.

`node api/_lib/selfcheck.js`

- 85 doğrulama.
- Anahtar var, Bearer yok: 401. Üyelik dışı firma: 403, tablo okunmaz.

On madde `docs/security/GUVENLIK_TOPARLAMA.md` içindedir. Kod maddeleri geçti. Canlı RLS, `017`–`019` çalıştırması ve tarayıcı tıklaması blocked.

## Geçti denmeyen

İzole Postgres olmadığı için SQL dosyaları çalıştırılmadı. Staging başarısı yoktur. Canlı politika kataloğu okunmadı; kimlik yoktu. Tarayıcı aracı kullanılmadı.
