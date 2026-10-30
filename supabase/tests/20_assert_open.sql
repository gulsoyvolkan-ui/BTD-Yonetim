SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.siparisler WHERE belge_no LIKE 'SYN-%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'open anon count %', n;
  END IF;
  PERFORM 1 FROM public.kullanicilar WHERE sifre_hash IS NOT NULL LIMIT 1;
END $$;
RESET ROLE;
