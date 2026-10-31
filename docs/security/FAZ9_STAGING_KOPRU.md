# Faz 9 staging köprüsü

Bu dosya insan onayı için prosedürdür. Agent staging veya üretim Supabase’ine bağlanmaz, SQL çalıştırmaz, parola üretip kaydetmez, secret değiştirmez ve dağıtım yapmaz.

Karar: **staging NO-GO**. SHADOW deposu bu işle uyumlu gösterilmedi. `SHADOW_BTD_LIVE` açılmaz. Üretim sırasına `030` ve `031` eklenmez.

## Önkoşul

1. Staging yedeği alınmış ve geri dönüşü bir insan doğrulamış olmalı. Yedek bu depoda durmaz.
2. Staging projesi üretim projesi değildir. Üretim satırı, personel ve firma kopyalanmaz. Yalnız sentetik firma kullanılır.
3. `030_shadow_kimlik.sql` ve `031_shadow_kopru.sql` önce boş bir Postgres’te, bayrakla, bu depodaki testlerle doğrulanmış olmalı. Bayraksız oturum dosyayı reddeder.
4. Köprü parolası depoda, sohbette ve workflow dosyasında durmaz. İnsan parolayı üretir, yalnız secret kasasına yazar, SQL editörüne bir kez yapıştırır.
5. SHADOW’a Postgres adresi, parola, BTD imza anahtarı ve `service_role` verilmez.

## Sıra

Yedekten sonra, staging SQL editöründe, tek oturumda:

1. Oturum bayrağını aç: `btd.allow_shadow_kimlik=on`. Bayrak yoksa her iki dosya da durur.
2. `supabase/030_shadow_kimlik.sql`
3. `supabase/031_shadow_kopru.sql`
4. Aşağıdaki yan etkisiz kontroller. Beklenenle uyuşmazsa `031_shadow_kopru_rollback.sql`, gerekirse ardından `030_shadow_kimlik_rollback.sql`. İş satırı silinmez.
5. Parolayı kasaya yazdıktan sonra rolü `LOGIN` bırakıp parolayı yalnız staging kasasında tut. Bağlantı dizesi `sslmode=require` taşır. Havuz oturum kipidir (doğrudan 5432). İşlem kipi 6543 kullanılmaz; `SET LOCAL ROLE` ve hazırlanmış ifade orada güvenilir değildir.
6. Sunucusuz işlev başına tek kısa bağlantı. Rolün bağlantı tavanı 8’dir. Havuz dolarsa çağrı kapanır, sayı uydurulmaz.

Uzak host kilidi durur. Yalnız `BTD_SHADOW_DB_TARGET=staging`, boşluksuz tam host listesi, port 5432, `sslmode=require` ve kullanıcı `btd_shadow_kopru` birlikteyse uzak adres değerlendirilir. `VERCEL_ENV=production`, üretim projesi ve `btdcore.com` listede yazsa da açılmaz. Joker listeyi kapatır. Ayrıntı `docs/security/FAZ10_STAGING_ALLOWLIST.md`. Bu prosedür production bağlantısı vermez.

## Köprü kimliği

| Rol | Giriş | Kalıtım | İş |
|---|---|---|---|
| `btd_shadow_okuyucu` | `NOLOGIN` | `NOINHERIT` | Yedi fonksiyonun `EXECUTE` sahibi. Tablo `SELECT` yok |
| `btd_shadow_kopru` | `LOGIN` | `NOINHERIT` | Üye olduğu okuyucu rolüne yalnız `SET ROLE` ile geçer. Doğrudan `EXECUTE` yok |

Köprü `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`. `anon`, `authenticated`, `service_role` ve `authenticator` bu role üye edilmez. Köprü onlara üye edilmez.

`SECURITY DEFINER` fonksiyonlar migration sahibinin yetkisiyle çalışır. Supabase’te bu sahip süper kullanıcı olabilir; gövde RLS’i böyle aşar. Köprünün kendi oturumu aşmaz. Gövde firma kaydını ve izinli kolonları kendisi sınırlar. İstemci `firma_id` iddiasına politika yoktur.

`search_path` değeri `pg_catalog, public, pg_temp` şeklindedir. Geçici şema sondadır.

## Yan etkisiz kontrol

Bu sorgular satır yazmaz. Staging’de insan çalıştırır. Agent çalıştırmaz.

```sql
SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolconnlimit
FROM pg_roles
WHERE rolname IN ('btd_shadow_okuyucu', 'btd_shadow_kopru');

SELECT r.rolname AS uye, m.inherit_option, m.set_option, m.admin_option
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid AND g.rolname = 'btd_shadow_okuyucu'
JOIN pg_roles r ON r.oid = m.member;

SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'btd_shadow_jti_tuket', 'btd_shadow_jti_tamamla', 'btd_shadow_jti_geri_al',
    'btd_shadow_jti_iptal', 'btd_shadow_jti_temizle', 'btd_servis_yetki',
    'btd_shadow_operasyon_ozet'
  );

SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'btd_shadow_jti_tuket', 'btd_shadow_jti_tamamla', 'btd_shadow_jti_geri_al',
    'btd_shadow_jti_iptal', 'btd_shadow_jti_temizle', 'btd_servis_yetki',
    'btd_shadow_operasyon_ozet'
  );

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('btd_shadow_jti', 'btd_servis_kayit', 'btd_servis_denetim');

SELECT count(*) AS politika
FROM pg_policies
WHERE tablename IN ('btd_shadow_jti', 'btd_servis_kayit', 'btd_servis_denetim');
```

Beklenen: okuyucu `rolcanlogin=false`. Köprü `rolcanlogin=true`, `rolinherit=false`, `rolsuper=false`, `rolbypassrls=false`. Üyelik tek satır, `inherit_option=false`, `set_option=true`, `admin_option=false`. Yedi fonksiyon `prosecdef=true` ve `search_path` içinde `pg_catalog` ilk, `pg_temp` son. `EXECUTE` grantee yalnız `btd_shadow_okuyucu`. Üç tabloda RLS ve FORCE açık, politika sayısı 0.

## Geri alma

Önce `031_shadow_kopru_rollback.sql`. Jti tablosu ve okuyucu kalır. Tam geri alma için ardından `030_shadow_kimlik_rollback.sql`. `anon`, `authenticated` ve `service_role` silinmez. Her ikisi de aynı bayrak yoksa durur.

## SHADOW

Uyum kanıtı yokken staging GO denmez. SHADOW’un Postgres’e çıkması bu prosedürün parçası değildir.
