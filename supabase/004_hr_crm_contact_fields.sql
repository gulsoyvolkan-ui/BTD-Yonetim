-- Mirror of live migration hr_crm_contact_fields
-- Personel: WhatsApp + yıllık izin alanları; yaka = Yönetici
-- Müşteri: firma sabit telefonu

ALTER TABLE public.personel
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS yillik_izin_hakedis NUMERIC DEFAULT 14,
  ADD COLUMN IF NOT EXISTS yillik_planlanan_izin NUMERIC DEFAULT 0;

ALTER TABLE public.musteriler
  ADD COLUMN IF NOT EXISTS telefon TEXT;

ALTER TABLE public.personel DROP CONSTRAINT IF EXISTS personel_yaka_check;
ALTER TABLE public.personel
  ADD CONSTRAINT personel_yaka_check
  CHECK (yaka = ANY (ARRAY['mavi','beyaz','blue','white','manager','yonetici','yönetici']));

ALTER TABLE public.kullanicilar DROP CONSTRAINT IF EXISTS kullanicilar_yaka_check;
ALTER TABLE public.kullanicilar
  ADD CONSTRAINT kullanicilar_yaka_check
  CHECK (yaka IS NULL OR yaka = ANY (ARRAY['mavi','beyaz','blue','white','manager','yonetici','yönetici']));
