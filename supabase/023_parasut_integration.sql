-- Paraşüt entegrasyon: firma bazlı bağlantı + eşleme tabloları
-- 021'den sonra. 009–019 güvenlik dosyalarının yerine geçmez.
-- client_secret burada TUTULMAZ → Edge Function Secrets / Vault.
-- demo_all_access yazılmaz. anon rolüne GRANT verilmez.

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

-- RLS açık, politika yok: anon okuyamaz. demo_all_access yok.
ALTER TABLE public.parasut_baglantilar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parasut_cari_eslesme ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parasut_fatura_eslesme ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_all_access ON public.parasut_baglantilar;
DROP POLICY IF EXISTS demo_all_access ON public.parasut_cari_eslesme;
DROP POLICY IF EXISTS demo_all_access ON public.parasut_fatura_eslesme;
REVOKE ALL ON TABLE public.parasut_baglantilar FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.parasut_cari_eslesme FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.parasut_fatura_eslesme FROM PUBLIC, anon;
