CREATE TEMP TABLE btd_ids AS
SELECT
  (SELECT id FROM public.firmalar WHERE kod = 'ZA') AS za,
  (SELECT id FROM public.firmalar WHERE kod = 'ZB') AS zb,
  (SELECT id FROM public.kullanicilar WHERE kullanici_adi = 'ada') AS ada,
  (SELECT id FROM public.kullanicilar WHERE kullanici_adi = 'volkan') AS volkan,
  (SELECT id FROM public.kullanicilar WHERE kullanici_adi = 'yeni') AS yeni,
  (SELECT m.id FROM public.musteriler m JOIN public.firmalar f ON f.id = m.firma_id WHERE f.kod = 'ZB' LIMIT 1) AS musteri_b;

DO $$
BEGIN
  IF (SELECT za FROM btd_ids) IS NULL OR (SELECT musteri_b FROM btd_ids) IS NULL THEN
    RAISE EXCEPTION 'fixture';
  END IF;
END $$;

GRANT SELECT ON btd_ids TO authenticated;

SET ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.siparisler LIMIT 1;
  RAISE EXCEPTION 'anon still reads';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
DECLARE
  n int;
  ids record;
  audits int;
BEGIN
  SELECT * INTO ids FROM btd_ids;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  SELECT count(*) INTO n FROM public.siparisler;
  IF n <> 1 THEN RAISE EXCEPTION 'ada orders %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.siparisler WHERE belge_no = 'SYN-ZB') THEN
    RAISE EXCEPTION 'ada saw other firm';
  END IF;
  BEGIN
    INSERT INTO public.siparisler (firma_id, belge_no, musteri_unvan) VALUES (ids.zb, 'SYN-HACK', 'X');
    RAISE EXCEPTION 'ada inserted other firm';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.musteri_kisiler (musteri_id, ad_soyad) VALUES (ids.musteri_b, 'X');
    RAISE EXCEPTION 'ada inserted other child';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  DELETE FROM public.siparisler WHERE belge_no = 'SYN-ZB';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ada deleted %', n; END IF;
  BEGIN
    UPDATE public.kullanicilar SET is_god = true WHERE id = ids.ada;
    RAISE EXCEPTION 'ada set god';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM sifre_hash FROM public.kullanicilar;
    RAISE EXCEPTION 'hash readable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.revoke_user_access(ids.volkan, 'yanlis kapsam');
    RAISE EXCEPTION 'ada revoked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revoke_rejected' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
  SELECT count(*) INTO n FROM public.siparisler WHERE belge_no = 'SYN-ZA';
  IF n <> 0 THEN RAISE EXCEPTION 'username god saw other firm'; END IF;
  SELECT count(*) INTO n FROM public.siparisler WHERE belge_no = 'SYN-ZB';
  IF n <> 1 THEN RAISE EXCEPTION 'volkan own %', n; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', true);
  BEGIN
    PERFORM public.link_my_auth();
    RAISE EXCEPTION 'attacker linked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'link_rejected' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f1', true);
  BEGIN
    PERFORM public.link_my_auth();
    RAISE EXCEPTION 'duplicate email linked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'link_rejected' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f2', true);
  BEGIN
    PERFORM public.link_my_auth();
    RAISE EXCEPTION 'unconfirmed linked';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'link_rejected' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d1', true);
  PERFORM public.link_my_auth();
  SELECT count(*) INTO n FROM public.kullanicilar WHERE id = ids.yeni AND auth_user_id = '00000000-0000-4000-8000-0000000000d1';
  IF n <> 1 THEN RAISE EXCEPTION 'yeni not linked'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  PERFORM public.revoke_user_access(ids.volkan, 'test');
  SELECT count(*) INTO n FROM public.kullanici_firmalar WHERE kullanici_id = ids.volkan;
  IF n <> 1 THEN RAISE EXCEPTION 'membership dropped'; END IF;
  SELECT count(*) INTO audits FROM public.guvenlik_olaylari WHERE olay = 'revoke' AND hedef_kullanici_id = ids.volkan;
  IF audits < 1 THEN RAISE EXCEPTION 'audit missing'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
  SELECT count(*) INTO n FROM public.siparisler;
  IF n <> 0 THEN RAISE EXCEPTION 'revoked still reads %', n; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
  PERFORM public.restore_user_access(ids.volkan, 'test');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
  SELECT count(*) INTO n FROM public.siparisler WHERE belge_no = 'SYN-ZB';
  IF n <> 1 THEN RAISE EXCEPTION 'restore failed'; END IF;
  SELECT count(*) INTO n FROM public.siparisler WHERE belge_no = 'SYN-ZA';
  IF n <> 0 THEN RAISE EXCEPTION 'restore widened'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  god boolean;
  aktif_mi boolean;
  orders int;
  linked int;
  members int;
BEGIN
  SELECT k.is_god, k.aktif INTO god, aktif_mi FROM public.kullanicilar k WHERE k.kullanici_adi = 'volkan';
  IF god IS NOT TRUE OR aktif_mi IS NOT TRUE THEN
    RAISE EXCEPTION 'account flags changed';
  END IF;
  SELECT count(*) INTO members FROM public.kullanici_firmalar kf
  JOIN public.kullanicilar u ON u.id = kf.kullanici_id
  WHERE u.kullanici_adi = 'volkan';
  IF members <> 1 THEN RAISE EXCEPTION 'membership changed'; END IF;
  SELECT count(*) INTO orders FROM public.siparisler WHERE belge_no LIKE 'SYN-%';
  IF orders <> 2 THEN RAISE EXCEPTION 'orders changed %', orders; END IF;
  SELECT count(*) INTO linked FROM public.kullanicilar WHERE kullanici_adi = 'yeni' AND auth_user_id IS NOT NULL;
  IF linked <> 1 THEN RAISE EXCEPTION 'link missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.kullanicilar WHERE kullanici_adi IN ('dup1', 'dup2', 'plain') AND auth_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'rejected link wrote auth';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'demo_all_access') THEN
    RAISE EXCEPTION 'demo policy remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'anon grant remains';
  END IF;
END $$;
