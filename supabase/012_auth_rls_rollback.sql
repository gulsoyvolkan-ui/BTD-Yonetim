-- Acil geri alma. demo_all_access ve anon GRANT geri gelir. Satır, üyelik, auth_user_id ve denetim kaydı silinmez.
-- Açık halde bırakmayın. Yeniden kapatmak için 012_auth_rls.sql.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS btd_firma_all ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_parent_all ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_catalog_all ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_firmalar_select ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_firmalar_update ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_user_select ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_user_update ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_member_select ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_perm_select ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS btd_audit_select ON public.%I', r.tablename);
    IF r.tablename <> 'guvenlik_olaylari' THEN
      EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', r.tablename);
      EXECUTE format(
        'CREATE POLICY demo_all_access ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
        r.tablename
      );
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
REVOKE ALL ON TABLE public.guvenlik_olaylari FROM anon;
DROP POLICY IF EXISTS demo_all_access ON public.guvenlik_olaylari;

DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
