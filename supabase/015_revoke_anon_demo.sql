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

-- Yukarıdaki "GRANT ... ON ALL TABLES" personel.tc_no ve maas kolonlarını da açar.
-- 018 ile aynı daraltma. 015, 018'den sonra çalışsa bile bu kolonlar tablodan seçilemez.
DO $narrow_personel$
DECLARE
  cols text;
BEGIN
  IF to_regclass('public.personel') IS NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'personel'
    AND column_name NOT IN ('tc_no', 'maas');
  IF cols IS NULL OR cols = '' THEN
    RAISE EXCEPTION 'Durdu: personel kolon listesi boş.';
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE public.personel FROM PUBLIC, anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE format('GRANT UPDATE (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE 'GRANT DELETE ON TABLE public.personel TO authenticated';
END
$narrow_personel$;
