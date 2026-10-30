-- CRM: Paraşüt / cari bakiye + rol grubu (müşteri / tedarikçi / çift yönlü)
-- 021'den sonra. 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.

ALTER TABLE public.musteriler
  ADD COLUMN IF NOT EXISTS tl_bakiye NUMERIC,
  ADD COLUMN IF NOT EXISTS cari_rol TEXT;

ALTER TABLE public.tedarikciler
  ADD COLUMN IF NOT EXISTS tl_bakiye NUMERIC,
  ADD COLUMN IF NOT EXISTS cari_rol TEXT;

COMMENT ON COLUMN public.musteriler.tl_bakiye IS 'Paraşüt / finans TL bakiye (sıralama için)';
COMMENT ON COLUMN public.tedarikciler.tl_bakiye IS 'Paraşüt / finans TL bakiye (sıralama için)';
COMMENT ON COLUMN public.musteriler.cari_rol IS 'customer | supplier | both';
COMMENT ON COLUMN public.tedarikciler.cari_rol IS 'customer | supplier | both';
