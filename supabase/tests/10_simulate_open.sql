-- Yalnız regresyon. Üretimde çalıştırmayın.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE POLICY demo_all_access ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      r.tablename
    );
  END LOOP;
END $$;
