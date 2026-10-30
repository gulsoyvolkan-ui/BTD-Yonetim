-- Kişisel finans varlığı: Volkan Gülsoy
-- 028'den sonra. 009–019 güvenlik dosyalarının yerine geçmez.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.
UPDATE public.finans_varliklar
SET
  ad = 'Volkan Gülsoy',
  tip = 'kisisel',
  aciklama = 'Volkan Gülsoy kişisel nakit akışı',
  updated_at = NOW()
WHERE kod = 'kisisel_volkan';
