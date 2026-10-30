-- personel.tc_no ve personel.maas authenticated tablo yetkisinden çıkar.
-- Okuma ve yazma yalnız btd_hassas_gorebilir() (erisim_kritik veya Yönetici) ve firma üyeliği ile,
-- security definer fonksiyonundan geçer. Fonksiyon satır içeriğini hata metnine koymaz.
-- anon bu fonksiyonu çalıştıramaz.
--
-- 015 içindeki "GRANT ... ON ALL TABLES TO authenticated" bu daraltmayı ezer.
-- Bu yüzden aynı daraltma 015 dosyasının sonunda da vardır. 018, 015'ten sonra da çalıştırılabilir.
--
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_sensitive_columns', 'on', true);
-- Canlıda bu PR sırasında ÇALIŞTIRILMADI.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_sensitive_columns', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_sensitive_columns'', ''on'', true); aynı oturumda yok. Kolon daraltması yok. Değişiklik yok.';
  END IF;
  IF to_regprocedure('public.btd_firma_erisir(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Durdu: 013 yok. 018 çalışmadı. Değişiklik yok.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.btd_hassas_gorebilir()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.kullanicilar k
    WHERE k.auth_user_id = auth.uid()
      AND k.aktif = TRUE
      AND (k.erisim_kritik = TRUE OR k.rol = 'Yönetici')
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_personel_hassas_liste()
RETURNS TABLE (id UUID, tc_no TEXT, maas NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.tc_no, p.maas
  FROM public.personel p
  WHERE public.btd_hassas_gorebilir()
    AND public.btd_firma_erisir(p.firma_id);
$$;

CREATE OR REPLACE FUNCTION public.btd_personel_hassas_yaz(p_id UUID, p_tc TEXT, p_maas NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.btd_hassas_gorebilir() THEN
    RAISE EXCEPTION 'erişim yok';
  END IF;
  IF p_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.personel p
    WHERE p.id = p_id AND public.btd_firma_erisir(p.firma_id)
  ) THEN
    RAISE EXCEPTION 'erişim yok';
  END IF;
  UPDATE public.personel
  SET tc_no = p_tc,
      maas = p_maas
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.btd_hassas_gorebilir() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_personel_hassas_liste() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_personel_hassas_yaz(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.btd_hassas_gorebilir() TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_personel_hassas_liste() TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_personel_hassas_yaz(UUID, TEXT, NUMERIC) TO authenticated;

DO $narrow$
DECLARE
  cols text;
BEGIN
  IF to_regclass('public.personel') IS NULL THEN
    RAISE NOTICE 'btd: personel yok, kolon daraltması atlandı';
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'personel'
    AND column_name NOT IN ('tc_no', 'maas');
  IF cols IS NULL OR cols = '' THEN
    RAISE EXCEPTION 'Durdu: personel kolon listesi boş. Değişiklik tamamlanamadı.';
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE public.personel FROM PUBLIC, anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE format('GRANT UPDATE (%s) ON TABLE public.personel TO authenticated', cols);
  EXECUTE 'GRANT DELETE ON TABLE public.personel TO authenticated';
END
$narrow$;
