-- Teknik resim + kalem bazlı QR anahtarı
ALTER TABLE public.siparis_kalemleri
  ADD COLUMN IF NOT EXISTS teknik_resim TEXT,
  ADD COLUMN IF NOT EXISTS qr_anahtar TEXT;

ALTER TABLE public.is_emri_parcalari
  ADD COLUMN IF NOT EXISTS teknik_resim TEXT,
  ADD COLUMN IF NOT EXISTS qr_anahtar TEXT;
