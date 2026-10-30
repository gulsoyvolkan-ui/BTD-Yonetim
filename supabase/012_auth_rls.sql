-- BTD auth + firma RLS. Üretimde elle, yedekten sonra. CI bunu çalıştırmaz.
-- Hesap, üyelik ve iş satırı silinmez. Kullanıcı adından yetki verilmez.
-- Geri alma: 012_auth_rls_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id
  FROM public.kullanicilar k
  WHERE k.auth_user_id = auth.uid()
    AND k.aktif IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_firma(fid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.kullanici_firmalar kf
    WHERE kf.kullanici_id = public.app_user_id()
      AND kf.firma_id = fid
  )
$$;

CREATE OR REPLACE FUNCTION public.shares_user(other_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT other_id IS NOT NULL AND (
    other_id = public.app_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.kullanici_firmalar a
      JOIN public.kullanici_firmalar b ON b.firma_id = a.firma_id
      WHERE a.kullanici_id = public.app_user_id()
        AND b.kullanici_id = other_id
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.caller_can_revoke()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.kullanicilar k
    WHERE k.id = public.app_user_id()
      AND k.erisim_kritik IS TRUE
  )
$$;

CREATE OR REPLACE FUNCTION public.row_firma(kind text, row_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fid uuid;
BEGIN
  IF row_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF kind = 'musteri' THEN
    SELECT m.firma_id INTO fid FROM public.musteriler m WHERE m.id = row_id;
  ELSIF kind = 'tedarikci' THEN
    SELECT t.firma_id INTO fid FROM public.tedarikciler t WHERE t.id = row_id;
  ELSIF kind = 'maliyet' THEN
    SELECT m.firma_id INTO fid FROM public.maliyet_analizleri m WHERE m.id = row_id;
  ELSIF kind = 'teklif' THEN
    SELECT t.firma_id INTO fid FROM public.teklifler t WHERE t.id = row_id;
  ELSIF kind = 'siparis' THEN
    SELECT s.firma_id INTO fid FROM public.siparisler s WHERE s.id = row_id;
  ELSIF kind = 'is_emri' THEN
    SELECT e.firma_id INTO fid FROM public.is_emirleri e WHERE e.id = row_id;
  ELSIF kind = 'is_emri_parca' THEN
    SELECT e.firma_id INTO fid
    FROM public.is_emri_parcalari p
    JOIN public.is_emirleri e ON e.id = p.is_emri_id
    WHERE p.id = row_id;
  ELSIF kind = 'rfq' THEN
    SELECT q.firma_id INTO fid FROM public.rfq_paketleri q WHERE q.id = row_id;
  ELSIF kind = 'rfq_grup' THEN
    SELECT q.firma_id INTO fid
    FROM public.rfq_gruplari g
    JOIN public.rfq_paketleri q ON q.id = g.rfq_id
    WHERE g.id = row_id;
  ELSIF kind = 'beklenmeyen' THEN
    SELECT g.firma_id INTO fid FROM public.beklenmeyen_giderler g WHERE g.id = row_id;
  ELSIF kind = 'fason' THEN
    SELECT f.firma_id INTO fid FROM public.fason_isler f WHERE f.id = row_id;
  END IF;
  RETURN fid;
END;
$$;

CREATE TABLE IF NOT EXISTS public.guvenlik_olaylari (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  olay                text NOT NULL CHECK (olay IN ('link', 'revoke', 'restore')),
  aktor_auth_id       uuid,
  aktor_kullanici_id  uuid,
  hedef_kullanici_id  uuid,
  neden               text
);

CREATE OR REPLACE FUNCTION public.kullanicilar_lock_privilege()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.auth_user_id := OLD.auth_user_id;
  NEW.is_god := OLD.is_god;
  NEW.tum_grup := OLD.tum_grup;
  NEW.erisim_kritik := OLD.erisim_kritik;
  NEW.rol := OLD.rol;
  NEW.kapsam := OLD.kapsam;
  NEW.aktif := OLD.aktif;
  NEW.sifre_hash := OLD.sifre_hash;
  NEW.kullanici_adi := OLD.kullanici_adi;
  NEW.tc_no := OLD.tc_no;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kullanicilar_lock_privilege ON public.kullanicilar;
CREATE TRIGGER trg_kullanicilar_lock_privilege
BEFORE UPDATE ON public.kullanicilar
FOR EACH ROW EXECUTE FUNCTION public.kullanicilar_lock_privilege();

CREATE OR REPLACE FUNCTION public.link_my_auth()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  em text;
  confirmed timestamptz;
  matches int;
  kid uuid;
  existing uuid;
  aktif_mi boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'link_rejected';
  END IF;
  SELECT u.email, u.email_confirmed_at INTO em, confirmed
  FROM auth.users u
  WHERE u.id = uid;
  IF em IS NULL OR btrim(em) = '' OR confirmed IS NULL THEN
    RAISE EXCEPTION 'link_rejected';
  END IF;
  SELECT count(*) INTO matches
  FROM public.kullanicilar k
  WHERE lower(k.eposta) = lower(btrim(em));
  IF matches <> 1 THEN
    RAISE EXCEPTION 'link_rejected';
  END IF;
  SELECT k.id, k.auth_user_id, k.aktif INTO kid, existing, aktif_mi
  FROM public.kullanicilar k
  WHERE lower(k.eposta) = lower(btrim(em));
  IF aktif_mi IS NOT TRUE THEN
    RAISE EXCEPTION 'link_rejected';
  END IF;
  IF existing IS NOT NULL AND existing <> uid THEN
    RAISE EXCEPTION 'link_rejected';
  END IF;
  IF existing = uid THEN
    RETURN kid;
  END IF;
  ALTER TABLE public.kullanicilar DISABLE TRIGGER trg_kullanicilar_lock_privilege;
  UPDATE public.kullanicilar SET auth_user_id = uid WHERE id = kid;
  ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  INSERT INTO public.guvenlik_olaylari (olay, aktor_auth_id, aktor_kullanici_id, hedef_kullanici_id)
  VALUES ('link', uid, kid, kid);
  RETURN kid;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_access(hedef uuid, neden text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := public.app_user_id();
BEGIN
  IF hedef IS NULL OR actor IS NULL OR hedef = actor OR NOT public.caller_can_revoke() OR NOT public.shares_user(hedef) THEN
    RAISE EXCEPTION 'revoke_rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kullanicilar k WHERE k.id = hedef) THEN
    RAISE EXCEPTION 'revoke_rejected';
  END IF;
  ALTER TABLE public.kullanicilar DISABLE TRIGGER trg_kullanicilar_lock_privilege;
  UPDATE public.kullanicilar SET aktif = false WHERE id = hedef;
  ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  INSERT INTO public.guvenlik_olaylari (olay, aktor_auth_id, aktor_kullanici_id, hedef_kullanici_id, neden)
  VALUES ('revoke', auth.uid(), actor, hedef, left(coalesce(neden, ''), 200));
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_user_access(hedef uuid, neden text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := public.app_user_id();
BEGIN
  IF hedef IS NULL OR actor IS NULL OR hedef = actor OR NOT public.caller_can_revoke() OR NOT public.shares_user(hedef) THEN
    RAISE EXCEPTION 'revoke_rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kullanicilar k WHERE k.id = hedef) THEN
    RAISE EXCEPTION 'revoke_rejected';
  END IF;
  ALTER TABLE public.kullanicilar DISABLE TRIGGER trg_kullanicilar_lock_privilege;
  UPDATE public.kullanicilar SET aktif = true WHERE id = hedef;
  ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  INSERT INTO public.guvenlik_olaylari (olay, aktor_auth_id, aktor_kullanici_id, hedef_kullanici_id, neden)
  VALUES ('restore', auth.uid(), actor, hedef, left(coalesce(neden, ''), 200));
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TABLE public.kullanicilar ENABLE TRIGGER trg_kullanicilar_lock_privilege;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA public TO authenticated;

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
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', r.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', r.tablename);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE ALL ON TABLE public.kullanicilar FROM authenticated;
GRANT SELECT (
  id, auth_user_id, kullanici_adi, ad_soyad, rol, kapsam, yaka, personel_id,
  telefon, eposta, adres, aktif, created_at, updated_at
) ON TABLE public.kullanicilar TO authenticated;
GRANT UPDATE (ad_soyad, telefon, eposta, adres, yaka) ON TABLE public.kullanicilar TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.kullanici_firmalar FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.kullanici_yetkileri FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.guvenlik_olaylari FROM authenticated;
REVOKE INSERT, DELETE ON TABLE public.firmalar FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[current_user, 'postgres', 'supabase_admin']
  LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, PUBLIC', role_name);
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'firma_id'
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'kullanici_firmalar'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS btd_firma_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY btd_firma_all ON public.%I FOR ALL TO authenticated USING (public.can_firma(firma_id)) WITH CHECK (public.can_firma(firma_id))',
      t
    );
  END LOOP;
END $$;

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('musteri_kisiler', 'musteri', 'musteri_id'),
      ('tedarikci_kisiler', 'tedarikci', 'tedarikci_id'),
      ('tedarikci_malzeme_gruplari', 'tedarikci', 'tedarikci_id'),
      ('tedarikci_fason_hizmetleri', 'tedarikci', 'tedarikci_id'),
      ('maliyet_kalemleri', 'maliyet', 'maliyet_id'),
      ('teklif_kalemleri', 'teklif', 'teklif_id'),
      ('teklif_banka_hesaplari', 'teklif', 'teklif_id'),
      ('siparis_kalemleri', 'siparis', 'siparis_id'),
      ('siparis_revizyonlari', 'siparis', 'siparis_id'),
      ('is_emri_parcalari', 'is_emri', 'is_emri_id'),
      ('is_emri_cam_adimlari', 'is_emri_parca', 'parca_id'),
      ('rfq_gruplari', 'rfq', 'rfq_id'),
      ('rfq_grup_kalemleri', 'rfq_grup', 'rfq_grup_id'),
      ('rfq_grup_tedarikcileri', 'rfq_grup', 'rfq_grup_id'),
      ('rfq_yanitlari', 'rfq', 'rfq_id'),
      ('beklenmeyen_gider_dagilimlari', 'beklenmeyen', 'beklenmeyen_gider_id'),
      ('fason_log', 'fason', 'fason_id')
    ) AS v(tablename, kind, col)
  LOOP
    IF to_regclass('public.' || spec.tablename) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS btd_parent_all ON public.%I', spec.tablename);
    EXECUTE format(
      'CREATE POLICY btd_parent_all ON public.%I FOR ALL TO authenticated USING (public.can_firma(public.row_firma(%L, %I))) WITH CHECK (public.can_firma(public.row_firma(%L, %I)))',
      spec.tablename, spec.kind, spec.col, spec.kind, spec.col
    );
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'malzeme_gruplari', 'malzemeler', 'urun_sekilleri', 'isil_islem_katalogu', 'kaplama_katalogu',
    'operasyon_kategorileri', 'operasyon_adimlari', 'atolyeler', 'makineler', 'doviz_kurlari', 'resmi_tatiller'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS btd_catalog_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY btd_catalog_all ON public.%I FOR ALL TO authenticated USING (public.app_user_id() IS NOT NULL) WITH CHECK (public.app_user_id() IS NOT NULL)',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS btd_firmalar_select ON public.firmalar;
CREATE POLICY btd_firmalar_select ON public.firmalar
  FOR SELECT TO authenticated
  USING (public.can_firma(id));

DROP POLICY IF EXISTS btd_firmalar_update ON public.firmalar;
CREATE POLICY btd_firmalar_update ON public.firmalar
  FOR UPDATE TO authenticated
  USING (public.can_firma(id))
  WITH CHECK (public.can_firma(id));

DROP POLICY IF EXISTS btd_user_select ON public.kullanicilar;
CREATE POLICY btd_user_select ON public.kullanicilar
  FOR SELECT TO authenticated
  USING (id = public.app_user_id() OR public.shares_user(id));

DROP POLICY IF EXISTS btd_user_update ON public.kullanicilar;
CREATE POLICY btd_user_update ON public.kullanicilar
  FOR UPDATE TO authenticated
  USING (id = public.app_user_id())
  WITH CHECK (id = public.app_user_id());

DROP POLICY IF EXISTS btd_member_select ON public.kullanici_firmalar;
CREATE POLICY btd_member_select ON public.kullanici_firmalar
  FOR SELECT TO authenticated
  USING (kullanici_id = public.app_user_id() OR public.can_firma(firma_id));

DROP POLICY IF EXISTS btd_perm_select ON public.kullanici_yetkileri;
CREATE POLICY btd_perm_select ON public.kullanici_yetkileri
  FOR SELECT TO authenticated
  USING (kullanici_id = public.app_user_id() OR public.shares_user(kullanici_id));

DROP POLICY IF EXISTS btd_audit_select ON public.guvenlik_olaylari;
CREATE POLICY btd_audit_select ON public.guvenlik_olaylari
  FOR SELECT TO authenticated
  USING (
    aktor_kullanici_id = public.app_user_id()
    OR hedef_kullanici_id = public.app_user_id()
    OR (
      public.caller_can_revoke()
      AND hedef_kullanici_id IS NOT NULL
      AND public.shares_user(hedef_kullanici_id)
    )
  );

DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v);
  END LOOP;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_user_id()', 'can_firma(uuid)', 'shares_user(uuid)', 'caller_can_revoke()',
    'row_firma(text,uuid)', 'link_my_auth()', 'revoke_user_access(uuid,text)', 'restore_user_access(uuid,text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.kullanicilar_lock_privilege() FROM PUBLIC, anon, authenticated;
END $$;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS policy missing: %', missing;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
