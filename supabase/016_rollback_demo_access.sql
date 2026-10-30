-- Acil geri dönüş: anon tablo yetkisini ve demo_all_access politikasını yeniden açar.
-- İş satırlarını silmez. auth_user_id bağını çözmez. Hesap geri dönüşü runbooktadır.
-- Aynı oturumda önce:
--   SELECT set_config('btd.allow_demo_restore', 'on', true);
-- Bayrak yoksa hiçbir yetki değişmez.
-- Bu dosya üretimi yeniden demo açıklığına alır. Kalıcı çözüm değildir.
-- Canlı veritabanında bu PR sırasında ÇALIŞTIRILMADI.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_demo_restore', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_demo_restore'', ''on'', true); aynı oturumda yok. Geri dönüş uygulanmadı.';
  END IF;
END
$guard$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

DO $demo$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tablename);
    EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', rec.tablename);
    EXECUTE format(
      'CREATE POLICY demo_all_access ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      rec.tablename
    );
  END LOOP;
END
$demo$;
