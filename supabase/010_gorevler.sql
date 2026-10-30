-- Firma bazlı iç görev listesi (atanan, termin, durum).
-- Teklif fiyatlarına ve iş emri tablolarına dokunmaz.
--
-- SUPABASE SQL EDITOR:
--   1) Dashboard → SQL Editor → New query
--   2) Bu dosyanın tamamını yapıştır → Run
--   3) Table Editor: public.gorevler görünmeli
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- 001_schema.sql daha önce uygulanmış olmalı (firmalar, set_updated_at).

CREATE TABLE IF NOT EXISTS public.gorevler (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id    UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kod         TEXT NOT NULL,
  baslik      TEXT NOT NULL,
  aciklama    TEXT,
  atanan      TEXT,
  termin      DATE,
  durum       TEXT NOT NULL DEFAULT 'Açık'
                CHECK (durum IN ('Açık', 'Devam', 'Bitti', 'İptal')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, kod)
);
CREATE INDEX IF NOT EXISTS idx_gorevler_firma ON public.gorevler(firma_id);
CREATE INDEX IF NOT EXISTS idx_gorevler_termin ON public.gorevler(firma_id, termin);

DROP TRIGGER IF EXISTS trg_gorevler_updated_at ON public.gorevler;
CREATE TRIGGER trg_gorevler_updated_at
BEFORE UPDATE ON public.gorevler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.gorevler ENABLE ROW LEVEL SECURITY;

-- demo_all_access ve anon GRANT bu dosyadan çıkarıldı.
-- Yeniden çalıştırmak anon okumayı açmaz. Politika 017/015 ile düşer.
