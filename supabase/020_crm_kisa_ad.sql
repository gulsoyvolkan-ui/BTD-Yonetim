-- CRM: müşteri / tedarikçi kısa ad (Excel & dış sistem eşlemesi)
-- 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.
ALTER TABLE public.musteriler
  ADD COLUMN IF NOT EXISTS kisa_ad TEXT;

ALTER TABLE public.tedarikciler
  ADD COLUMN IF NOT EXISTS kisa_ad TEXT;

COMMENT ON COLUMN public.musteriler.kisa_ad IS 'Excel/Paraşüt vb. eşleme için kısa ad veya ; ile ayrılmış takma adlar';
COMMENT ON COLUMN public.tedarikciler.kisa_ad IS 'Excel/Paraşüt vb. eşleme için kısa ad veya ; ile ayrılmış takma adlar';
