-- anon demo_all_access kapatma. Uygulama bu adımdan sonra anon anahtarla yazamaz.
-- Supabase Auth oturumu ve 013/014 uygulanmadan ÇALIŞTIRMAYIN.
-- Aynı oturumda önce:
--   SELECT set_config('btd.allow_anon_revoke', 'on', true);
-- Bayrak yoksa hiçbir yetki değişmez.
-- İş verisi silinmez. auth_user_id toplu doldurulmaz.
-- Canlı veritabanında bu PR sırasında ÇALIŞTIRILMADI. Üretim RLS doğrulanmış değildir.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_anon_revoke', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_anon_revoke'', ''on'', true); aynı oturumda yok. anon yetkisi alınmadı. Değişiklik yok.';
  END IF;
END
$guard$;

DO $drop_demo$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', rec.tablename);
  END LOOP;
END
$drop_demo$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

REVOKE ALL ON TABLE public.kullanicilar FROM authenticated;
GRANT SELECT (
  id, auth_user_id, kullanici_adi, ad_soyad, rol, kapsam, tum_grup, is_god,
  erisim_kritik, yaka, personel_id, telefon, eposta, adres, aktif, created_at, updated_at
) ON public.kullanicilar TO authenticated;

REVOKE UPDATE, DELETE ON TABLE public.denetim_olaylari FROM authenticated;
