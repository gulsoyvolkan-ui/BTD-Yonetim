-- Ürün kartı (urunler) + fasoncu ana listesi (fasoncular)
-- Sipariş kalemi, varsa ürün kartına bağlanır (urun_id). Fason iş takibi (fason_isler) değişmez.
--
-- SUPABASE SQL EDITOR:
--   1) Dashboard → SQL Editor → New query
--   2) Bu dosyanın tamamını yapıştır → Run
--   3) Table Editor: public.urunler ve public.fasoncular görünmeli
--   4) siparis_kalemleri içinde urun_id sütunu görünmeli
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- 001_schema.sql daha önce uygulanmış olmalı (firmalar, set_updated_at).

CREATE TABLE IF NOT EXISTS public.urunler (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kod           TEXT NOT NULL,
  ad            TEXT NOT NULL,
  birim         TEXT NOT NULL DEFAULT 'adet',
  birim_fiyat   NUMERIC(14,4) NOT NULL DEFAULT 0,
  para_birimi   TEXT NOT NULL DEFAULT 'EUR',
  aciklama      TEXT,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, kod)
);
CREATE INDEX IF NOT EXISTS idx_urunler_firma ON public.urunler(firma_id);

DROP TRIGGER IF EXISTS trg_urunler_updated_at ON public.urunler;
CREATE TRIGGER trg_urunler_updated_at
BEFORE UPDATE ON public.urunler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.fasoncular (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  unvan         TEXT NOT NULL,
  hizmet        TEXT,
  iletisim      TEXT,
  telefon       TEXT,
  whatsapp      TEXT,
  eposta        TEXT,
  adres         TEXT,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, unvan)
);
CREATE INDEX IF NOT EXISTS idx_fasoncular_firma ON public.fasoncular(firma_id);

DROP TRIGGER IF EXISTS trg_fasoncular_updated_at ON public.fasoncular;
CREATE TRIGGER trg_fasoncular_updated_at
BEFORE UPDATE ON public.fasoncular
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.siparis_kalemleri
  ADD COLUMN IF NOT EXISTS urun_id UUID REFERENCES public.urunler(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_siparis_kalem_urun ON public.siparis_kalemleri(urun_id);

ALTER TABLE public.urunler ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fasoncular ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_all_access ON public.urunler;
CREATE POLICY demo_all_access ON public.urunler
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS demo_all_access ON public.fasoncular;
CREATE POLICY demo_all_access ON public.fasoncular
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.urunler TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fasoncular TO anon, authenticated;
