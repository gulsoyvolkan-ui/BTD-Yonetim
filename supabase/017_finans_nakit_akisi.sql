-- Finans & Nakit Akışı (çoklu şirket + kişisel)
-- Supabase SQL Editor'de çalıştırın.
-- Varlıklar: Technomac, Bluemac, Devorias, BTD Core, Kişisel (Volkan)
-- Mevcut firmalar tablosuna zorunlu bağımlılık yok; isteğe bağlı firma_id eşlemesi vardır.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) finans_varliklar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finans_varliklar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kod             TEXT NOT NULL UNIQUE,
  ad              TEXT NOT NULL,
  tip             TEXT NOT NULL DEFAULT 'sirket'
                  CHECK (tip IN ('sirket', 'grup', 'kisisel')),
  firma_id        UUID REFERENCES public.firmalar(id) ON DELETE SET NULL,
  aktif           BOOLEAN NOT NULL DEFAULT TRUE,
  sira            INTEGER NOT NULL DEFAULT 100,
  aciklama        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finans_varliklar_aktif ON public.finans_varliklar(aktif, sira);

-- ---------------------------------------------------------------------------
-- 2) finans_kategoriler
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finans_kategoriler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  varlik_id       UUID REFERENCES public.finans_varliklar(id) ON DELETE CASCADE,
  -- NULL varlik_id = tüm varlıklar için genel kategori
  ad              TEXT NOT NULL,
  islem_yonu      TEXT NOT NULL DEFAULT 'BOTH'
                  CHECK (islem_yonu IN ('GELIR', 'GIDER', 'BOTH')),
  aktif           BOOLEAN NOT NULL DEFAULT TRUE,
  sira            INTEGER NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (varlik_id, ad)
);

CREATE INDEX IF NOT EXISTS idx_finans_kategoriler_varlik ON public.finans_kategoriler(varlik_id);

-- ---------------------------------------------------------------------------
-- 3) finans_hareketler
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finans_hareketler (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  varlik_id           UUID NOT NULL REFERENCES public.finans_varliklar(id) ON DELETE RESTRICT,
  islem_tipi          TEXT NOT NULL CHECK (islem_tipi IN ('GELIR', 'GIDER')),
  kategori_id         UUID REFERENCES public.finans_kategoriler(id) ON DELETE SET NULL,
  tutar               NUMERIC(18, 2) NOT NULL CHECK (tutar > 0),
  para_birimi         TEXT NOT NULL DEFAULT 'TRY'
                      CHECK (para_birimi IN ('TRY', 'USD', 'EUR')),
  islem_tarihi        DATE NOT NULL DEFAULT CURRENT_DATE,
  vade_tarihi         DATE,
  odeme_yontemi       TEXT NOT NULL DEFAULT 'Havale/EFT'
                      CHECK (odeme_yontemi IN (
                        'Nakit',
                        'Havale/EFT',
                        'Kredi Karti',
                        'Cek',
                        'Senet',
                        'Kredi Taksiti'
                      )),
  durum               TEXT NOT NULL DEFAULT 'Bekliyor'
                      CHECK (durum IN ('Bekliyor', 'Odendi', 'Tahsil Edildi', 'Iptal')),
  tekrar_eden         BOOLEAN NOT NULL DEFAULT FALSE,
  tekrar_periyodu     TEXT
                      CHECK (
                        tekrar_periyodu IS NULL
                        OR tekrar_periyodu IN ('Gunluk', 'Haftalik', 'Aylik', 'Uc Aylik', 'Yillik')
                      ),
  aciklama            TEXT,
  bagli_is_emri_id    UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finans_hareketler_varlik ON public.finans_hareketler(varlik_id);
CREATE INDEX IF NOT EXISTS idx_finans_hareketler_tarih ON public.finans_hareketler(islem_tarihi DESC);
CREATE INDEX IF NOT EXISTS idx_finans_hareketler_vade ON public.finans_hareketler(vade_tarihi)
  WHERE vade_tarihi IS NOT NULL AND durum = 'Bekliyor';
CREATE INDEX IF NOT EXISTS idx_finans_hareketler_durum ON public.finans_hareketler(durum);
CREATE INDEX IF NOT EXISTS idx_finans_hareketler_tip ON public.finans_hareketler(islem_tipi);

-- updated_at tetikleyicileri
CREATE OR REPLACE FUNCTION public.finans_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finans_varliklar_updated_at ON public.finans_varliklar;
CREATE TRIGGER trg_finans_varliklar_updated_at
  BEFORE UPDATE ON public.finans_varliklar
  FOR EACH ROW EXECUTE FUNCTION public.finans_set_updated_at();

DROP TRIGGER IF EXISTS trg_finans_kategoriler_updated_at ON public.finans_kategoriler;
CREATE TRIGGER trg_finans_kategoriler_updated_at
  BEFORE UPDATE ON public.finans_kategoriler
  FOR EACH ROW EXECUTE FUNCTION public.finans_set_updated_at();

DROP TRIGGER IF EXISTS trg_finans_hareketler_updated_at ON public.finans_hareketler;
CREATE TRIGGER trg_finans_hareketler_updated_at
  BEFORE UPDATE ON public.finans_hareketler
  FOR EACH ROW EXECUTE FUNCTION public.finans_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) VIEW: aylık net kar/zarar (varlık bazlı)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_finans_aylik_net
WITH (security_invoker = true)
AS
SELECT
  v.id AS varlik_id,
  v.kod AS varlik_kod,
  v.ad AS varlik_ad,
  date_trunc('month', h.islem_tarihi)::date AS ay_basi,
  to_char(date_trunc('month', h.islem_tarihi), 'YYYY-MM') AS ay_kod,
  h.para_birimi,
  COALESCE(SUM(CASE WHEN h.islem_tipi = 'GELIR' AND h.durum IN ('Tahsil Edildi', 'Odendi') THEN h.tutar ELSE 0 END), 0) AS gelir,
  COALESCE(SUM(CASE WHEN h.islem_tipi = 'GIDER' AND h.durum IN ('Odendi', 'Tahsil Edildi') THEN h.tutar ELSE 0 END), 0) AS gider,
  COALESCE(SUM(CASE WHEN h.islem_tipi = 'GELIR' AND h.durum IN ('Tahsil Edildi', 'Odendi') THEN h.tutar ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN h.islem_tipi = 'GIDER' AND h.durum IN ('Odendi', 'Tahsil Edildi') THEN h.tutar ELSE 0 END), 0) AS net,
  COUNT(*)::integer AS hareket_sayisi
FROM public.finans_varliklar v
JOIN public.finans_hareketler h ON h.varlik_id = v.id
WHERE h.durum <> 'Iptal'
GROUP BY v.id, v.kod, v.ad, date_trunc('month', h.islem_tarihi), h.para_birimi;

COMMENT ON VIEW public.v_finans_aylik_net IS
  'Varlık bazlı aylık gelir/gider/net (iptal hariç; gerçekleşen durumlar)';

-- ---------------------------------------------------------------------------
-- 5) VIEW: yaklaşan çek / senet / vadeli ödemeler
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_finans_yaklasan_vadeler
WITH (security_invoker = true)
AS
SELECT
  h.id AS hareket_id,
  v.id AS varlik_id,
  v.kod AS varlik_kod,
  v.ad AS varlik_ad,
  h.islem_tipi,
  h.tutar,
  h.para_birimi,
  h.islem_tarihi,
  h.vade_tarihi,
  h.odeme_yontemi,
  h.durum,
  h.aciklama,
  k.ad AS kategori_ad,
  (h.vade_tarihi - CURRENT_DATE) AS kalan_gun,
  CASE
    WHEN h.vade_tarihi < CURRENT_DATE THEN 'gecikmis'
    WHEN h.vade_tarihi <= CURRENT_DATE + 7 THEN 'kritik'
    WHEN h.vade_tarihi <= CURRENT_DATE + 30 THEN 'yakin'
    ELSE 'ileri'
  END AS risk_seviyesi
FROM public.finans_hareketler h
JOIN public.finans_varliklar v ON v.id = h.varlik_id
LEFT JOIN public.finans_kategoriler k ON k.id = h.kategori_id
WHERE h.durum = 'Bekliyor'
  AND h.vade_tarihi IS NOT NULL
  AND h.odeme_yontemi IN ('Cek', 'Senet', 'Kredi Taksiti', 'Havale/EFT', 'Kredi Karti', 'Nakit')
ORDER BY h.vade_tarihi ASC;

COMMENT ON VIEW public.v_finans_yaklasan_vadeler IS
  'Bekleyen vadeli hareketler (çek/senet/kredi vb.) risk seviyesi ile';

-- ---------------------------------------------------------------------------
-- 6) Seed: varlıklar
-- ---------------------------------------------------------------------------
INSERT INTO public.finans_varliklar (kod, ad, tip, firma_id, sira, aciklama)
SELECT
  x.kod,
  x.ad,
  x.tip,
  f.id,
  x.sira,
  x.aciklama
FROM (
  VALUES
    ('technomac', 'Technomac', 'sirket', 'Technomac', 10, 'Technomac Makine şirket kasası'),
    ('bluemac', 'Bluemac', 'sirket', 'Bluemac', 20, 'Bluemac Makine şirket kasası'),
    ('devorias', 'Devorias', 'sirket', 'Devorias', 30, 'Devorias şirket kasası'),
    ('btd_core', 'BTD Core', 'grup', NULL, 40, 'Grup / BTD Core ortak kasa'),
    ('kisisel_volkan', 'Kisisel (Volkan)', 'kisisel', NULL, 50, 'Kişisel nakit akışı')
) AS x(kod, ad, tip, firma_ad, sira, aciklama)
LEFT JOIN public.firmalar f ON f.ad = x.firma_ad
ON CONFLICT (kod) DO UPDATE
SET
  ad = EXCLUDED.ad,
  tip = EXCLUDED.tip,
  firma_id = COALESCE(EXCLUDED.firma_id, public.finans_varliklar.firma_id),
  sira = EXCLUDED.sira,
  aciklama = EXCLUDED.aciklama,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 7) Seed: genel kategoriler (varlik_id NULL)
-- ---------------------------------------------------------------------------
INSERT INTO public.finans_kategoriler (varlik_id, ad, islem_yonu, sira)
SELECT NULL, x.ad, x.yon, x.sira
FROM (
  VALUES
    ('Uretim', 'BOTH', 10),
    ('Sabit Gider', 'GIDER', 20),
    ('Kredi', 'GIDER', 30),
    ('Cek/Senet', 'BOTH', 40),
    ('Yatirim', 'BOTH', 50),
    ('Kisisel Harcama', 'GIDER', 60),
    ('Satis Geliri', 'GELIR', 70),
    ('Hizmet Geliri', 'GELIR', 80),
    ('Personel', 'GIDER', 90),
    ('Vergi/SGK', 'GIDER', 100),
    ('Kira', 'GIDER', 110),
    ('Diger', 'BOTH', 200)
) AS x(ad, yon, sira)
WHERE NOT EXISTS (
  SELECT 1 FROM public.finans_kategoriler k
  WHERE k.varlik_id IS NULL AND k.ad = x.ad
);

-- ---------------------------------------------------------------------------
-- 8) RLS (mevcut demo politikası ile uyumlu)
-- ---------------------------------------------------------------------------
ALTER TABLE public.finans_varliklar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finans_kategoriler ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finans_hareketler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_all_access ON public.finans_varliklar;
CREATE POLICY demo_all_access ON public.finans_varliklar
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS demo_all_access ON public.finans_kategoriler;
CREATE POLICY demo_all_access ON public.finans_kategoriler
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS demo_all_access ON public.finans_hareketler;
CREATE POLICY demo_all_access ON public.finans_hareketler
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finans_varliklar TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finans_kategoriler TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finans_hareketler TO anon, authenticated;
GRANT SELECT ON public.v_finans_aylik_net TO anon, authenticated;
GRANT SELECT ON public.v_finans_yaklasan_vadeler TO anon, authenticated;
