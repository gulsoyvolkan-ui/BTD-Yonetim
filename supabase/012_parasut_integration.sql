-- Paraşüt entegrasyon: firma bazlı bağlantı + eşleme tabloları
-- Supabase SQL Editor'de çalıştırın (010/011'den sonra).
-- client_secret burada TUTULMAZ → Edge Function Secrets / Vault.

CREATE TABLE IF NOT EXISTS public.parasut_baglantilar (
  firma_id UUID PRIMARY KEY REFERENCES public.firmalar(id) ON DELETE CASCADE,
  parasut_company_id TEXT,
  durum TEXT NOT NULL DEFAULT 'bekliyor',
  -- bekliyor | hazir | bagli | hata
  son_senkron TIMESTAMPTZ,
  son_hata TEXT,
  baglandi_at TIMESTAMPTZ,
  notlar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.parasut_cari_eslesme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  party_key TEXT,
  musteri_id UUID REFERENCES public.musteriler(id) ON DELETE SET NULL,
  tedarikci_id UUID REFERENCES public.tedarikciler(id) ON DELETE SET NULL,
  parasut_contact_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, parasut_contact_id)
);
CREATE INDEX IF NOT EXISTS idx_parasut_cari_party ON public.parasut_cari_eslesme(firma_id, party_key);

CREATE TABLE IF NOT EXISTS public.parasut_fatura_eslesme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  yerel_fatura_no TEXT,
  siparis_belge_no TEXT,
  parasut_sales_invoice_id TEXT NOT NULL,
  e_belge_tipi TEXT,
  e_belge_durum TEXT,
  son_hata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, parasut_sales_invoice_id)
);

COMMENT ON TABLE public.parasut_baglantilar IS 'BTD firma ↔ Paraşüt company_id bağlantı durumu (secret yok)';
COMMENT ON COLUMN public.parasut_baglantilar.durum IS 'bekliyor|hazir|bagli|hata';
