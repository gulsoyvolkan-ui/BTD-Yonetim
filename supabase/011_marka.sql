-- Marka kimliği: teklif ve iş emri hangi marka antetiyle basılır.
-- Değerler js/btd-brands.js anahtarlarıdır: technomac, bluemac, teca, devorias.
-- NULL kayıt çıktıda müşteri ve ürüne göre tahmin edilir.
--
-- SUPABASE SQL EDITOR (BTD projesi):
--   1) Dashboard → SQL Editor → New query
--   2) Bu dosyanın tamamını yapıştır → Run
--   3) Table Editor: teklifler ve is_emirleri içinde marka sütunu görünmeli
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).
-- RLS ve giriş tablolarına dokunmaz.

ALTER TABLE public.teklifler ADD COLUMN IF NOT EXISTS marka TEXT;
ALTER TABLE public.is_emirleri ADD COLUMN IF NOT EXISTS marka TEXT;

ALTER TABLE public.teklifler DROP CONSTRAINT IF EXISTS teklifler_marka_check;
ALTER TABLE public.teklifler ADD CONSTRAINT teklifler_marka_check
  CHECK (marka IS NULL OR marka IN ('technomac', 'bluemac', 'teca', 'devorias'));

ALTER TABLE public.is_emirleri DROP CONSTRAINT IF EXISTS is_emirleri_marka_check;
ALTER TABLE public.is_emirleri ADD CONSTRAINT is_emirleri_marka_check
  CHECK (marka IS NULL OR marka IN ('technomac', 'bluemac', 'teca', 'devorias'));

NOTIFY pgrst, 'reload schema';
