-- CRM: müşteri / tedarikçi kısa ad (Excel & dış sistem eşlemesi)
ALTER TABLE public.musteriler
  ADD COLUMN IF NOT EXISTS kisa_ad TEXT;

ALTER TABLE public.tedarikciler
  ADD COLUMN IF NOT EXISTS kisa_ad TEXT;

COMMENT ON COLUMN public.musteriler.kisa_ad IS 'Excel/Paraşüt vb. eşleme için kısa ad veya ; ile ayrılmış takma adlar';
COMMENT ON COLUMN public.tedarikciler.kisa_ad IS 'Excel/Paraşüt vb. eşleme için kısa ad veya ; ile ayrılmış takma adlar';
