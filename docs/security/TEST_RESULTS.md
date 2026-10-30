# Test sonucu ve engeller

Tarih: 2026-10-30. Dal: `cursor/btd-security-hardening-phase1-4d61`. Üretim veritabanı yok. SHADOW yok.

## Geçen

`node api/_lib/security.test.js`

- 54 doğrulama geçti.
- Ardından SHADOW HTTP kontrolü geçti: yazma 405, okuma `UNAVAILABLE`, dış host çağrılmadı, sır yanıtta yok.

`node api/_lib/selfcheck.js`

- 85 doğrulama geçti.
- Kapsam: 401 anahtarsız ve jetonsuz, 403 üyelik dışı firma, `select` yıldız değil, gizli sunucu anahtarı başlıkta yok, hız sınırı 429, denetim kaydı sır içermiyor.

Sentetik konular: istemci rolü yok sayılır, kullanıcı adı yönetici yapmaz, parola ve `tc_no` oturuma girmez, kiosk yönetici düşer, tazelik beş değeri, imza izleyici ve süre, SQL’de `USING`/`WITH CHECK`, `015` anon geri alımı bayraklı, `013` toplu kullanıcı güncellemez.

## Geçti denmeyen

İzole Postgres yok. `013`–`016` çalıştırılmadı. Canlı RLS, `auth_user_id` doluluğu ve politika kataloğu doğrulanmadı. Bu dosyalar “RLS üretimde açık” kanıtı değildir.

Tarayıcıda masaüstü ve kiosk akışı tıklanarak doğrulanmadı. Uçta hazır tarayıcı aracı yoktu. Kontrol, dosya içeriği ve Node testleridir.

## Engeller

- Aktif hesaplar e-posta Auth’a tek tek bağlanmadan `015` çalıştırılamaz. Kullanıcı adı yolu jeton taşımaz.
- `SUPABASE_ANON_KEY` ve `BTD_SHADOW_SIGNING_KEY` Vercel’de bu dal tarafından yazılmadı. İkisi de boşsa ilgili uç 503 döner. SPA anon anahtarını kendi dosyasından okur.
- Hız sınırı süreç içidir.
- Legacy kullanıcı adı yolu `sifre_hash` kolonunu hâlâ okur. Değeri oturuma ve loga koymaz. Kapanışı, hesap bağlandıktan sonra insan adımıdır.
