-- Faz 2 canlı katalog kontrolü. Yalnız SELECT.
-- Bu dosya bu dalda çalıştırılmadı. Ajan çalıştırmaz.
-- INSERT, UPDATE, DELETE, GRANT, ALTER ve fonksiyon çağrısı yoktur.
-- Sonuç üretim GO değildir. Personel satırı seçilmez.

-- RLS açık mı
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- Politikalar
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- demo_all_access duruyor mu
SELECT n.nspname AS schema_name, c.relname AS table_name, p.polname AS policy_name
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE p.polname = 'demo_all_access';

-- anon rolünün tablo yetkileri
SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_schema = 'public'
ORDER BY table_name, privilege_type;

-- Üyelik ve hassas kolon fonksiyonları var mı
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'btd_oturum_baglami',
    'btd_firma_erisir',
    'btd_personel_hassas_liste',
    'btd_personel_hassas_yaz'
  )
ORDER BY p.proname;

-- personel.tc_no ve personel.maas kolon yetkisi
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'personel'
  AND column_name IN ('tc_no', 'maas')
ORDER BY grantee, column_name, privilege_type;
