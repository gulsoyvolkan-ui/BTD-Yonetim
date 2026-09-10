-- Kişisel finans varlığı: Volkan Gülsoy
UPDATE public.finans_varliklar
SET
  ad = 'Volkan Gülsoy',
  tip = 'kisisel',
  aciklama = 'Volkan Gülsoy kişisel nakit akışı',
  updated_at = NOW()
WHERE kod = 'kisisel_volkan';
