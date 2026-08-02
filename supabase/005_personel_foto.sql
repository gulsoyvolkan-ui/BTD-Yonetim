-- Personel kimlik kartı fotoğrafı (base64 / data URL)
ALTER TABLE public.personel ADD COLUMN IF NOT EXISTS foto TEXT;
