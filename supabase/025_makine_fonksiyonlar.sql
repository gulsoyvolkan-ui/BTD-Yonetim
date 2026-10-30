-- Makine fonksiyonları (etiket listesi)
-- 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.
ALTER TABLE public.makineler
  ADD COLUMN IF NOT EXISTS fonksiyonlar TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.makineler.fonksiyonlar IS 'Makinenin yapabildiği proses/fonksiyon etiketleri';
