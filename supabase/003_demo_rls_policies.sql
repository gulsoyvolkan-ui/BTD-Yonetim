-- Demo RLS: anon/authenticated için tüm public tablolarda izin
-- Uygulandı (MCP): demo_rls_allow_all_policies
-- 012_auth_rls.sql uygulandıktan sonra bu dosyayı yeniden çalıştırmayın.

DO $$
BEGIN
  IF to_regprocedure('public.can_firma(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '003 retired after 012_auth_rls.sql';
  END IF;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE POLICY demo_all_access ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      r.tablename
    );
  END LOOP;
END $$;
