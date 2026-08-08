-- Fason imalat kataloğu: tablo + izinler (veri kaybı / kayıt hatası önlemi)
-- SQL Editor'de çalıştırın.

CREATE TABLE IF NOT EXISTS public.fason_imalat_katalogu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad TEXT NOT NULL UNIQUE,
  fiyat_eur_saat NUMERIC NOT NULL DEFAULT 0,
  fiyat_eur_adet NUMERIC NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fason_imalat_katalogu ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_all_access ON public.fason_imalat_katalogu;
CREATE POLICY demo_all_access ON public.fason_imalat_katalogu
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fason_imalat_katalogu TO anon, authenticated;

COMMENT ON TABLE public.fason_imalat_katalogu IS 'Fason Hizmetler (imalat) fiyat listesi · €/saat + €/adet';
