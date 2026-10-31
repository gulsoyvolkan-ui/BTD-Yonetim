-- BTD Faz 8. JTI tüketimi ve servis kaydı.
-- Canlıda bu dosya ÇALIŞTIRILMADI. Üretim geçiş sırasına eklenmedi.
-- service_role ile RLS aşılmaz. İstemcinin firma_id iddiasına güvenen politika yoktur.
-- Anahtar değeri bu dosyada yoktur.
-- SECURITY DEFINER search_path pg_catalog, public, pg_temp şeklindedir.
-- pg_temp sonda durur; oturumun geçici now() fonksiyonu süre kontrolünün yerine geçmez.
--
-- Önkoşul: public.siparisler, public.is_emirleri, public.gorevler (001 ve 010).
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_shadow_kimlik', 'on', false);
-- Bayrak yoksa durur. Değişiklik yok.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_shadow_kimlik', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_shadow_kimlik'', ''on'', false); aynı oturumda yok. Değişiklik yok.';
  END IF;
END
$guard$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu') THEN
    CREATE ROLE btd_shadow_okuyucu NOLOGIN NOINHERIT;
  END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS public.btd_servis_kayit (
  servis_kod text PRIMARY KEY,
  ad text NOT NULL,
  izinli_firma_ids uuid[] NOT NULL DEFAULT '{}',
  kapsam text[] NOT NULL DEFAULT '{}',
  anahtar_surum integer NOT NULL,
  onceki_anahtar_surum integer NULL,
  etkin boolean NOT NULL DEFAULT false,
  iptal_zamani timestamptz NULL,
  gecerlilik_sonu timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT btd_servis_kayit_surum CHECK (anahtar_surum >= 1),
  CONSTRAINT btd_servis_kayit_onceki CHECK (onceki_anahtar_surum IS NULL OR onceki_anahtar_surum >= 1),
  CONSTRAINT btd_servis_kayit_kapsam CHECK (kapsam <@ ARRAY['shadow.read']::text[])
);

CREATE TABLE IF NOT EXISTS public.btd_servis_denetim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servis_kod text NOT NULL,
  firma_id uuid NULL,
  olay text NOT NULL,
  sonuc text NOT NULL,
  anahtar_surum integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT btd_servis_denetim_olay CHECK (olay IN ('yetki', 'okuma', 'iptal')),
  CONSTRAINT btd_servis_denetim_sonuc CHECK (length(sonuc) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS public.btd_shadow_jti (
  iss text NOT NULL,
  jti text NOT NULL,
  sinif text NOT NULL,
  firma_id uuid NOT NULL,
  anahtar_surum integer NULL,
  exp timestamptz NOT NULL,
  durum text NOT NULL,
  kullanim integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (iss, jti),
  CONSTRAINT btd_shadow_jti_iss CHECK (iss IN ('btd', 'shadow')),
  CONSTRAINT btd_shadow_jti_sinif CHECK (sinif IN ('tek_kullanim', 'kisa_tekrar')),
  CONSTRAINT btd_shadow_jti_durum CHECK (durum IN ('acik', 'tuketildi', 'iptal')),
  CONSTRAINT btd_shadow_jti_kullanim CHECK (kullanim >= 0)
);

CREATE INDEX IF NOT EXISTS btd_shadow_jti_exp ON public.btd_shadow_jti (exp);

ALTER TABLE public.btd_servis_kayit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btd_servis_kayit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.btd_servis_denetim ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btd_servis_denetim FORCE ROW LEVEL SECURITY;
ALTER TABLE public.btd_shadow_jti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btd_shadow_jti FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.btd_servis_kayit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.btd_servis_denetim FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.btd_shadow_jti FROM PUBLIC, anon, authenticated, service_role;

-- Tek kullanımlık jti çakışınca güncellenmez. Kısa tekrar, süre ve iptal uygunsa sayacı artırır.
CREATE OR REPLACE FUNCTION public.btd_shadow_jti_tuket(
  p_iss text,
  p_jti text,
  p_sinif text,
  p_firma uuid,
  p_exp timestamptz,
  p_kv integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing public.btd_shadow_jti%ROWTYPE;
  inserted text := NULL;
BEGIN
  IF p_iss NOT IN ('btd', 'shadow') OR p_sinif NOT IN ('tek_kullanim', 'kisa_tekrar') THEN
    RETURN 'sinif';
  END IF;
  IF p_jti IS NULL OR length(p_jti) < 1 OR length(p_jti) > 128 OR p_jti ~ '\s' THEN
    RETURN 'jti';
  END IF;
  IF p_firma IS NULL OR p_exp IS NULL THEN
    RETURN 'malformed';
  END IF;
  IF p_exp <= now() THEN
    RETURN 'expired';
  END IF;

  INSERT INTO public.btd_shadow_jti AS j (iss, jti, sinif, firma_id, anahtar_surum, exp, durum, kullanim)
  VALUES (p_iss, p_jti, p_sinif, p_firma, p_kv, p_exp, 'acik', 1)
  ON CONFLICT (iss, jti) DO UPDATE
  SET kullanim = j.kullanim + 1,
      updated_at = now()
  WHERE j.sinif = 'kisa_tekrar'
    AND EXCLUDED.sinif = 'kisa_tekrar'
    AND j.durum <> 'iptal'
    AND j.exp > now()
    AND j.firma_id = EXCLUDED.firma_id
    AND j.anahtar_surum IS NOT DISTINCT FROM EXCLUDED.anahtar_surum
  RETURNING 'ok' INTO inserted;

  IF inserted = 'ok' THEN
    RETURN 'ok';
  END IF;

  SELECT * INTO existing
  FROM public.btd_shadow_jti
  WHERE iss = p_iss AND jti = p_jti
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'replay_unverified';
  END IF;
  IF existing.durum = 'iptal' THEN
    RETURN 'revoked';
  END IF;
  IF existing.exp <= now() THEN
    RETURN 'expired';
  END IF;
  IF existing.sinif <> p_sinif
     OR existing.firma_id <> p_firma
     OR existing.anahtar_surum IS DISTINCT FROM p_kv THEN
    RETURN 'mismatch';
  END IF;
  RETURN 'replay';
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_shadow_jti_tamamla(p_iss text, p_jti text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing public.btd_shadow_jti%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM public.btd_shadow_jti
  WHERE iss = p_iss AND jti = p_jti
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF existing.sinif = 'kisa_tekrar' THEN
    RETURN 'ok';
  END IF;
  IF existing.durum = 'iptal' THEN
    RETURN 'revoked';
  END IF;
  UPDATE public.btd_shadow_jti
  SET durum = 'tuketildi', updated_at = now()
  WHERE iss = p_iss AND jti = p_jti;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_shadow_jti_geri_al(p_iss text, p_jti text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing public.btd_shadow_jti%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM public.btd_shadow_jti
  WHERE iss = p_iss AND jti = p_jti
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF existing.sinif = 'kisa_tekrar' THEN
    RETURN 'kept';
  END IF;
  IF existing.durum <> 'acik' THEN
    RETURN 'committed';
  END IF;
  DELETE FROM public.btd_shadow_jti WHERE iss = p_iss AND jti = p_jti;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_shadow_jti_iptal(p_iss text, p_jti text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_iss NOT IN ('btd', 'shadow') OR p_jti IS NULL OR length(p_jti) < 1 OR length(p_jti) > 128 THEN
    RETURN 'jti';
  END IF;
  INSERT INTO public.btd_shadow_jti (iss, jti, sinif, firma_id, anahtar_surum, exp, durum, kullanim)
  VALUES (
    p_iss,
    p_jti,
    'tek_kullanim',
    '00000000-0000-0000-0000-000000000000',
    NULL,
    now() + interval '300 seconds',
    'iptal',
    0
  )
  ON CONFLICT (iss, jti) DO UPDATE
  SET durum = 'iptal', updated_at = now();
  INSERT INTO public.btd_servis_denetim (servis_kod, firma_id, olay, sonuc, anahtar_surum)
  VALUES (p_iss, NULL, 'iptal', 'revoked', NULL);
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_shadow_jti_temizle(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n integer := 0;
  cutoff timestamptz;
BEGIN
  IF p_before IS NULL THEN
    RAISE EXCEPTION 'temizle siniri yok';
  END IF;
  cutoff := LEAST(p_before, now() - interval '300 seconds');
  DELETE FROM public.btd_shadow_jti WHERE exp < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_servis_yetki(
  p_servis text,
  p_firma uuid,
  p_kapsam text,
  p_kv integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  rec public.btd_servis_kayit%ROWTYPE;
  sonuc text;
BEGIN
  SELECT * INTO rec FROM public.btd_servis_kayit WHERE servis_kod = p_servis;
  IF NOT FOUND THEN
    sonuc := 'unknown';
  ELSIF NOT rec.etkin THEN
    sonuc := 'disabled';
  ELSIF rec.iptal_zamani IS NOT NULL THEN
    sonuc := 'revoked';
  ELSIF rec.gecerlilik_sonu <= now() THEN
    sonuc := 'expired';
  ELSIF p_kapsam IS DISTINCT FROM 'shadow.read' OR NOT (p_kapsam = ANY (rec.kapsam)) THEN
    sonuc := 'scope';
  ELSIF p_firma IS NULL OR NOT (p_firma = ANY (rec.izinli_firma_ids)) THEN
    sonuc := 'firma';
  ELSIF p_kv IS NULL OR (p_kv <> rec.anahtar_surum AND p_kv IS DISTINCT FROM rec.onceki_anahtar_surum) THEN
    sonuc := 'key';
  ELSE
    sonuc := 'ok';
  END IF;

  INSERT INTO public.btd_servis_denetim (servis_kod, firma_id, olay, sonuc, anahtar_surum)
  VALUES (coalesce(p_servis, ''), p_firma, 'yetki', sonuc, p_kv);
  RETURN sonuc;
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_shadow_operasyon_ozet(
  p_servis text,
  p_firma uuid,
  p_kv integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  yetki text;
  geciken integer;
  acik integer;
  guncel timestamptz;
  ozet jsonb;
  bad boolean;
BEGIN
  yetki := public.btd_servis_yetki(p_servis, p_firma, 'shadow.read', p_kv);
  IF yetki IS DISTINCT FROM 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'reason', yetki);
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.siparisler
      WHERE firma_id = p_firma
        AND durum NOT IN ('Onaylandı', 'Revize Edildi', 'Üretimde', 'Tamamlandı', 'İptal')
    )
    OR EXISTS (
      SELECT 1 FROM public.is_emirleri
      WHERE firma_id = p_firma
        AND durum NOT IN ('Aktif', 'Tamamlandı', 'İptal Edildi')
    )
    OR EXISTS (
      SELECT 1 FROM public.gorevler
      WHERE firma_id = p_firma
        AND durum NOT IN ('Açık', 'Devam', 'Bitti', 'İptal')
    )
  INTO bad;

  IF bad THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'status');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'ref', 'siparisler',
      'durum', durum,
      'adet', adet,
      'guncellendi', guncellendi,
      'kaynak_id', 'siparisler'
    )
    ORDER BY sira
  ), '[]'::jsonb)
  INTO ozet
  FROM (
    SELECT
      durum,
      count(*)::int AS adet,
      max(updated_at) AS guncellendi,
      CASE durum
        WHEN 'Onaylandı' THEN 1
        WHEN 'Revize Edildi' THEN 2
        WHEN 'Üretimde' THEN 3
        WHEN 'Tamamlandı' THEN 4
        WHEN 'İptal' THEN 5
        ELSE 9
      END AS sira
    FROM public.siparisler
    WHERE firma_id = p_firma
    GROUP BY durum
  ) buckets;

  SELECT count(*)::int INTO geciken
  FROM public.is_emirleri e
  JOIN public.siparisler s ON s.id = e.siparis_id AND s.firma_id = e.firma_id
  WHERE e.firma_id = p_firma
    AND e.durum = 'Aktif'
    AND e.siparis_id IS NOT NULL
    AND s.durum NOT IN ('Tamamlandı', 'İptal')
    AND s.teslim_tarihi IS NOT NULL
    AND s.teslim_tarihi < CURRENT_DATE;

  SELECT count(*)::int INTO acik
  FROM public.gorevler
  WHERE firma_id = p_firma
    AND durum IN ('Açık', 'Devam');

  SELECT max(ts) INTO guncel
  FROM (
    SELECT updated_at AS ts FROM public.siparisler WHERE firma_id = p_firma
    UNION ALL
    SELECT updated_at FROM public.is_emirleri WHERE firma_id = p_firma
    UNION ALL
    SELECT updated_at FROM public.gorevler WHERE firma_id = p_firma
  ) stamps;

  INSERT INTO public.btd_servis_denetim (servis_kod, firma_id, olay, sonuc, anahtar_surum)
  VALUES (p_servis, p_firma, 'okuma', 'ok', p_kv);

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'kaynak_id', 'btd-operasyon',
      'guncellendi', guncel,
      'siparis_ozet', coalesce(ozet, '[]'::jsonb),
      'geciken_is_emri_adet', coalesce(geciken, 0),
      'acik_gorev_adet', coalesce(acik, 0)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_tamamla(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_geri_al(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_iptal(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_temizle(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_servis_yetki(text, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_tamamla(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_geri_al(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_iptal(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_temizle(timestamptz) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_servis_yetki(text, uuid, text, integer) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) TO btd_shadow_okuyucu;
