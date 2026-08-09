-- CRM: çift yönlü cari bağlantısı (müşteri ↔ tedarikçi) + Paraşüt / vergi alanları
-- Supabase SQL Editor'de çalıştırın.

ALTER TABLE public.tedarikciler
  ADD COLUMN IF NOT EXISTS vergi_no TEXT,
  ADD COLUMN IF NOT EXISTS vergi_dairesi TEXT,
  ADD COLUMN IF NOT EXISTS party_key TEXT,
  ADD COLUMN IF NOT EXISTS intercompany BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kaynak TEXT,
  ADD COLUMN IF NOT EXISTS linked_musteri_id UUID REFERENCES public.musteriler(id) ON DELETE SET NULL;

ALTER TABLE public.musteriler
  ADD COLUMN IF NOT EXISTS party_key TEXT,
  ADD COLUMN IF NOT EXISTS intercompany BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kaynak TEXT,
  ADD COLUMN IF NOT EXISTS linked_tedarikci_id UUID REFERENCES public.tedarikciler(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_musteriler_party_key ON public.musteriler(firma_id, party_key);
CREATE INDEX IF NOT EXISTS idx_tedarikciler_party_key ON public.tedarikciler(firma_id, party_key);
CREATE INDEX IF NOT EXISTS idx_tedarikciler_vergi ON public.tedarikciler(firma_id, vergi_no);

COMMENT ON COLUMN public.musteriler.party_key IS 'VN:verginNo veya NM:normalizeUnvan — cari karışmasını önler';
COMMENT ON COLUMN public.tedarikciler.party_key IS 'VN:verginNo veya NM:normalizeUnvan — cari karışmasını önler';
COMMENT ON COLUMN public.musteriler.intercompany IS 'Grup içi firma (Technomac/Bluemac/Devorias) carisi';
COMMENT ON COLUMN public.tedarikciler.intercompany IS 'Grup içi firma (Technomac/Bluemac/Devorias) carisi';
