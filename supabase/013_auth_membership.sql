-- BTD üyelik fonksiyonları ve denetim tablosu.
-- Bu dosya demo_all_access politikasını düşürmez, anon yetkisini almaz,
-- kullanicilar satırlarını toplu güncellemez.
-- auth_user_id boş olabilir. Boşsa btd_oturum_baglami NULL döner; rol uydurulmaz.
--
-- Supabase SQL Editor: dosyanın tamamını yapıştırıp Run.
-- Tekrar çalıştırmak güvenlidir.
-- Canlı veritabanında bu PR sırasında ÇALIŞTIRILMADI.

CREATE TABLE IF NOT EXISTS public.denetim_olaylari (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id       UUID REFERENCES public.firmalar(id) ON DELETE SET NULL,
  actor_auth_id  UUID,
  olay           TEXT NOT NULL,
  kaynak         TEXT NOT NULL,
  durum          INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.denetim_olaylari FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.denetim_olaylari TO authenticated;

CREATE OR REPLACE FUNCTION public.btd_aktif_kullanici_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id
  FROM public.kullanicilar k
  WHERE k.auth_user_id = auth.uid()
    AND k.aktif = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.btd_grup_yoneticisi()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.kullanicilar k
    WHERE k.auth_user_id = auth.uid()
      AND k.aktif = TRUE
      AND k.rol = 'Yönetici'
      AND k.tum_grup = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_firma_erisir(p_firma UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- tum_grup tek başına yetmez; firma kullanici_firmalar satırında olmalıdır.
  SELECT p_firma IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.kullanicilar k
    JOIN public.kullanici_firmalar kf ON kf.kullanici_id = k.id
    WHERE k.auth_user_id = auth.uid()
      AND k.aktif = TRUE
      AND kf.firma_id = p_firma
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_oturum_baglami()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.kullanicilar%ROWTYPE;
  firms JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO rec
  FROM public.kullanicilar k
  WHERE k.auth_user_id = auth.uid()
    AND k.aktif = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', f.id, 'kod', f.kod, 'ad', f.ad) ORDER BY f.kod),
    '[]'::jsonb
  )
  INTO firms
  FROM public.kullanici_firmalar kf
  JOIN public.firmalar f ON f.id = kf.firma_id
  WHERE kf.kullanici_id = rec.id;

  RETURN jsonb_build_object(
    'kullanici_id', rec.id,
    'auth_user_id', rec.auth_user_id,
    'kullanici_adi', rec.kullanici_adi,
    'ad_soyad', rec.ad_soyad,
    'rol', rec.rol,
    'yaka', rec.yaka,
    'erisim_kritik', rec.erisim_kritik,
    'tum_grup', (rec.tum_grup AND rec.rol = 'Yönetici'),
    'firmalar', firms
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_musteri_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.musteriler m
    WHERE m.id = p_id AND public.btd_firma_erisir(m.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_tedarikci_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tedarikciler t
    WHERE t.id = p_id AND public.btd_firma_erisir(t.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_maliyet_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.maliyet_analizleri m
    WHERE m.id = p_id AND public.btd_firma_erisir(m.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_teklif_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teklifler t
    WHERE t.id = p_id AND public.btd_firma_erisir(t.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_siparis_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.siparisler s
    WHERE s.id = p_id AND public.btd_firma_erisir(s.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_isemri_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.is_emirleri e
    WHERE e.id = p_id AND public.btd_firma_erisir(e.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_parca_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.is_emri_parcalari p
    WHERE p.id = p_id AND public.btd_isemri_firma(p.is_emri_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_rfq_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rfq_paketleri r
    WHERE r.id = p_id AND public.btd_firma_erisir(r.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_rfq_grup_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rfq_gruplari g
    WHERE g.id = p_id AND public.btd_rfq_firma(g.rfq_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_fason_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fason_isler f
    WHERE f.id = p_id AND public.btd_firma_erisir(f.firma_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.btd_gider_firma(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.beklenmeyen_giderler g
    WHERE g.id = p_id AND public.btd_firma_erisir(g.firma_id)
  );
$$;

REVOKE ALL ON FUNCTION public.btd_aktif_kullanici_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_grup_yoneticisi() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_firma_erisir(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_oturum_baglami() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_musteri_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_tedarikci_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_maliyet_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_teklif_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_siparis_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_isemri_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_parca_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_rfq_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_rfq_grup_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_fason_firma(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.btd_gider_firma(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.btd_aktif_kullanici_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_grup_yoneticisi() TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_firma_erisir(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_oturum_baglami() TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_musteri_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_tedarikci_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_maliyet_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_teklif_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_siparis_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_isemri_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_parca_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_rfq_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_rfq_grup_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_fason_firma(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btd_gider_firma(UUID) TO authenticated;

ALTER TABLE public.denetim_olaylari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS btd_denetim_oku ON public.denetim_olaylari;
CREATE POLICY btd_denetim_oku ON public.denetim_olaylari
  FOR SELECT TO authenticated
  USING (
    actor_auth_id = auth.uid()
    OR public.btd_firma_erisir(firma_id)
  );

DROP POLICY IF EXISTS btd_denetim_yaz ON public.denetim_olaylari;
CREATE POLICY btd_denetim_yaz ON public.denetim_olaylari
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_auth_id = auth.uid()
    AND (firma_id IS NULL OR public.btd_firma_erisir(firma_id))
  );
