# Faz 10 staging host kapısı

Uzak host kilidi kalkmaz. Varsayılan yalnız `127.0.0.1`, `localhost` ve `::1` açılır. Başka adres, aşağıdaki koşulların hepsi yoksa aranmaz ve `read: BLOCKED` kalır.

1. `BTD_SHADOW_DB_TARGET` tam olarak `staging`.
2. `VERCEL_ENV` `production` değil. Süreç `BTD_SHADOW_DB_TARGET=production` ise veya `SUPABASE_URL` üretim projesini ya da `btdcore.com` içeriyorsa uzak adres kapalıdır.
3. `BTD_SHADOW_STAGING_HOST_ALLOWLIST` en fazla dört tam host adıdır. Boşluk, joker (`*`), IP, geri besleme adresi, üretim projesi veya `btdcore.com` listeyi bütünüyle kapatır.
4. Bağlantı kullanıcısı `btd_shadow_kopru`, port `5432`, `sslmode` `require` veya `verify-full`. `6543`, `sslmode=disable`, `allow` ve `prefer` kapalıdır. Açılan staging bağlantısı sunucu sertifikasını doğrular.
5. Parola bu depoya yazılmaz. SHADOW Postgres adresi, parola, imza anahtarı ve `service_role` almaz. `SHADOW_BTD_LIVE` yoktur.

Bu kapı staging GO değildir. `030` ve `031` bu dosyayla çalıştırılmaz. Üretim sırasına eklenmez. İnsan adımları `docs/security/FAZ9_STAGING_KOPRU.md` içindedir.
