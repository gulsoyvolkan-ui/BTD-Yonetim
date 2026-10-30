-- Fason imalat katalogu + tedarikçi hizmet tipi (dış hizmet vs imalatçı)
-- 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.

CREATE TABLE IF NOT EXISTS public.fason_imalat_katalogu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad TEXT NOT NULL UNIQUE,
  fiyat_eur_saat NUMERIC NOT NULL DEFAULT 0,
  fiyat_eur_adet NUMERIC NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tedarikci_fason_hizmetleri
  ADD COLUMN IF NOT EXISTS hizmet_tipi TEXT NOT NULL DEFAULT 'dis';

COMMENT ON COLUMN public.tedarikci_fason_hizmetleri.hizmet_tipi IS 'dis = Fason Dış Hizmet (ısıl/kaplama); imalat = Fason İmalatçı prosesleri';
COMMENT ON TABLE public.fason_imalat_katalogu IS 'Tornalama, Frezeleme vb. · fiyat: €/saat ve €/adet';

ALTER TABLE public.fason_imalat_katalogu ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_all_access ON public.fason_imalat_katalogu;
REVOKE ALL ON TABLE public.fason_imalat_katalogu FROM PUBLIC, anon;
