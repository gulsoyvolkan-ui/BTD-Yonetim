-- Ürün şekli alan adları: Levha/Sac Genişlik·Yükseklik·Uzunluk; Boru Çeper
-- 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.
UPDATE public.urun_sekilleri
SET alanlar = ARRAY['Genişlik', 'Yükseklik', 'Uzunluk']::text[]
WHERE kod IN ('levha', 'sac', 'lama', 'yassi');

UPDATE public.urun_sekilleri
SET alanlar = ARRAY['Dış Çap', 'Çeper', 'Uzunluk']::text[]
WHERE kod IN ('boru', 'tube');
