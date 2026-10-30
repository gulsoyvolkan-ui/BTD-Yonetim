# BTD güvenlik tabanı

30 Ekim 2026 akşamı `origin/main` ucu `2aa351fa759b6196a5141e00b0f80a3ff866d087` (PR #12 birleşmiş). Aşağıdaki `f65b3e3` anlatımı o günden önceki denetimdir. Güncel toparlama `docs/security/GUVENLIK_TOPARLAMA.md` dosyasındadır. Karar NO-GO.

Denetlenen önceki uç: `f65b3e3905bf87ee132f68df38dd2de046860c86` (`f65b3e3`, “Yetki matrisini sayfa açılışına ve kayıt silmeye bağla”). `e81c374` bu uç değildir.

Canlı Supabase’e bağlanılmadı. SQL çalıştırılmadı. `kullanicilar.auth_user_id` dolu varsayılmadı. Bu belge üretim RLS’inin açık olduğunu söylemez.

## Bugünkü mimari

Tarayıcı SPA (`index.html`) ve Vercel fonksiyonları (`api/`). Veri Supabase. Dağıtım `.github/workflows/deploy-vercel.yml` ile yalnız `main`/`master` push’unda üretim hedefine gider. Bu dal o akışı tetiklemez.

İki veri yolu vardır:

1. Tarayıcı, `js/supabase-config.js` içindeki anon anahtarla PostgREST çağırır. Anahtar tarayıcıda görünür. Asıl sınır RLS olmalıdır.
2. `api/*.js` sunucu fonksiyonlarıdır. `f65b3e3` üzerinde ortak `x-api-key` ve gizli sunucu anahtarıyla gider, `firma_id` sorgu parametresini üyeliğe sormadan kabul eder, `select=*` kullanır.

`002_demo_users_grants.sql` anon ve authenticated rollerine şema genelinde yazma verir. `003_demo_rls_policies.sql` `demo_all_access` için `USING (true) WITH CHECK (true)` yazar. Bu dosyaların canlıda uygulanıp uygulanmadığı bu denetimde görülmedi. `008` sıkı RLS’i çalıştırmamayı söyler. `009` ve `010` kendi tablolarında yine demo politika açar.

## Kimlik, f65b3e3

Supabase Auth kullanılmıyordu. Giriş, yerel listedeki SHA-256 özetini veya `kullanicilar.sifre_hash` kolonunu karşılaştırıyordu. `auth_user_id` şemada durur, uygulama okumaz.

`f65b3e3` üzerinde acil yönetici üretimi kapalıdır (`buildEmergencyAdminUser` null). Buna karşılık `applyDemoLoginOverrides` `volkan` ve `admin` adlarını grup yöneticisi yapar. `btd-cloud.js` içindeki korumalı kullanıcı listesi bulut satırının rolünü yerel tohumla ezer. Oturum geri yükleme, liste dışı kullanıcıyı `localStorage` içindeki rol ve `isGod` ile yeniden kurar. Giriş formu firmanın dışındaki şirketi de açan bir yedeğe düşer. Hata metni demo parolayı yazar. `fetchUserForLogin` `sifre_hash` ve `tc_no` seçer.

Sayfa matrisi `f65b3e3` ile menü ve silmeye bağlanmıştır. Bu kontrol tarayıcıdadır. Veritabanı firma sınırını zorlamaz.

## Bu dalın değiştirdiği kontroller

- E-posta ile giriş Supabase Auth `signInWithPassword` çağırır. Parola özete çevrilip `sifre_hash` ile karşılaştırılmaz. Üyelik `btd_oturum_baglami()` RPC’sinden gelir. RPC yoksa veya `auth_user_id` boşsa oturum açılmaz ve hash yoluna düşülmez.
- Oturum allowlist’indedir. `sifre_hash`, parola ve `tc_no` yazılmaz. İstemcinin istediği rol yok sayılır. Firma, üyelik listesinde yoksa açılmaz.
- Kullanıcı adına göre yönetici yükseltmesi kapatıldı. Boş oturum JSON’u rol üretmez.
- Kullanıcı adı (e-posta olmayan) yolu masaüstü demosu için durur. Bu yol hâlâ SHA-256 karşılaştırır ve legacy sorguda `sifre_hash` kolonunu okur. Sonucu oturuma koymaz. Üretim kesimi bu yol kapanmadan `015` çalıştırılamaz.
- API: `x-api-key` yetmez. `Authorization: Bearer` kullanıcı jetonu doğrulanır. `firma_id` üyelik listesinde yoksa 403. Okuma ve yazma anon anahtar + kullanıcı jetonu ile gider. Gizli sunucu anahtarı bu yollarda okunmaz. `select` kolon listesidir. Hız sınırı ve denetim olayı sır içermez.
- SHADOW’a bağlanılmaz. `api/shadow-read.js` yazmayı kapatır ve taze veri yoksa `UNAVAILABLE` döner.
- `?portal=kiosk` kısa oturum, hatırlama kapalı, kiosk yöneticisi yok. Sorgu yoksa masaüstü süre 2 saat kalır.

## Bilinçli olarak yapılmayanlar

- Gerçek hesaplar toplu bağlanmadı.
- `013`–`016` canlıda çalıştırılmadı.
- Üretim ortam değişkeni değiştirilmedi. Dağıtım ve birleştirme yok.
- SHADOW ve başka depolar değişmedi. Yeni sipariş, teklif, iş emri veya görev motoru eklenmedi. `gorevler` BTD görev tablosu olarak kaldı.
- İzole Postgres olmadığı için RLS testleri geçti denmez.

## Kalan risk

Üretimde demo politika duruyorsa anon anahtar bütün satırları okuyabilir. Bunu kapatmak `015` dosyasıdır ve uygulama e-posta Auth oturumuna geçmeden çalıştırılırsa bulut senkronu düşer. Yerel ekran, bulut hata verirse yerel diziyle kalır; SHADOW kapalıyken BTD açılır. Bu, üretimin güvenli olduğu anlamına gelmez.
