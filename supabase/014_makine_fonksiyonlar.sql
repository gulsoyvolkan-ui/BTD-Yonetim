-- Makine fonksiyonları (etiket listesi)
ALTER TABLE public.makineler
  ADD COLUMN IF NOT EXISTS fonksiyonlar TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.makineler.fonksiyonlar IS 'Makinenin yapabildiği proses/fonksiyon etiketleri';
