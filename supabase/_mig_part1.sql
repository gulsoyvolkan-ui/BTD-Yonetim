-- =============================================================================
-- BTD Yönetim MES Core 4.0 · Supabase / PostgreSQL (EU Frankfurt)
-- =============================================================================
-- Vizyon: Multi-entity (Technomac / Bluemac / Devorias) · veriler firma_id ile izole
-- UI: HTML + Tailwind + Vanilla JS (Clean-UI, lacivert/gri)
-- Bu dosya: arayüzdeki tüm operasyonel modüllerin ilişkisel omurgası
--
-- SUPABASE'E UYGULAMA (temiz proje varsayımı):
--   1) Dashboard → SQL Editor → New query
--   2) Bu dosyanın tamamını yapıştır → Run
--   3) Alttaki "DOĞRULAMA" bloğunu ayrıca çalıştır
--   4) Table Editor'de `firmalar` satırlarını kontrol et (3 kayıt)
--
-- Not: İkinci kez çalıştırırsanız CREATE TABLE hata verir (tablolar zaten var).
--      Seed INSERT'leri ON CONFLICT ile güvenlidir.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Ortak yardımcı: updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1) MULTI-ENTITY · FİRMALAR
-- =============================================================================
CREATE TABLE public.firmalar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kod             TEXT NOT NULL UNIQUE,          -- TM / BM / DV
  ad              TEXT NOT NULL UNIQUE,          -- Technomac / Bluemac / Devorias
  unvan           TEXT NOT NULL,                 -- yasal ünvan
  logo_url        TEXT,
  adres           TEXT,
  vergi_dairesi   TEXT,
  vergi_no        TEXT,
  telefon         TEXT,
  website         TEXT,
  eposta          TEXT,
  imza_yetkilisi  TEXT,
  teslim_yeri     TEXT,
  garanti_metni   TEXT,
  varsayilan_odeme TEXT,
  aktif           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_firmalar_updated_at
BEFORE UPDATE ON public.firmalar
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.firma_banka_hesaplari (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  hesap_kodu    TEXT,                            -- tm-try vb.
  para_birimi   TEXT NOT NULL CHECK (para_birimi IN ('TRY','EUR','USD','₺','€','$')),
  etiket        TEXT,
  banka_adi     TEXT,
  sube          TEXT,
  iban          TEXT,
  sira          INT NOT NULL DEFAULT 0,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_firma_banka_firma ON public.firma_banka_hesaplari(firma_id);

-- Belge numarası sayaçları (TM-0038-2026, ML-TM-0001 …)
CREATE TABLE public.belge_sayaclari (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  belge_tipi    TEXT NOT NULL,  -- teklif, siparis, is_emri, maliyet, tedarik, rfq, fason, fatura, qc, stok, yeniden_tedarik, beklenmeyen
  yil           INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INT,
  son_no        INT NOT NULL DEFAULT 0,
  UNIQUE (firma_id, belge_tipi, yil)
);

-- =============================================================================
-- 2) KULLANICI / PERSONEL (Auth ayrı; burada uygulama profili)
-- =============================================================================
CREATE TABLE public.personel (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  personel_kodu   TEXT,                          -- P-TM-001 (gösterim)
  ad_soyad        TEXT NOT NULL,
  departman       TEXT,
  yaka            TEXT NOT NULL CHECK (yaka IN ('mavi','beyaz','blue','white')),
  ise_baslama     DATE,
  maas            NUMERIC(14,2),
  durum           TEXT NOT NULL DEFAULT 'Aktif',
  tc_no           TEXT,
  telefon         TEXT,
  eposta          TEXT,
  adres           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_personel_firma ON public.personel(firma_id);
CREATE TRIGGER trg_personel_updated_at
BEFORE UPDATE ON public.personel
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kullanicilar (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      UUID UNIQUE,                 -- auth.users.id (Supabase Auth)
  kullanici_adi     TEXT NOT NULL UNIQUE,
  ad_soyad          TEXT NOT NULL,
  sifre_hash        TEXT,                        -- geçici/demo; üretimde Auth tercih edilir
  rol               TEXT NOT NULL DEFAULT 'Operatör',
  kapsam            TEXT NOT NULL DEFAULT 'Firma', -- 'Tüm Grup' | 'Firma'
  tum_grup          BOOLEAN NOT NULL DEFAULT FALSE,
  is_god            BOOLEAN NOT NULL DEFAULT FALSE,
  erisim_kritik     BOOLEAN NOT NULL DEFAULT FALSE,
  yaka              TEXT CHECK (yaka IN ('mavi','beyaz','blue','white')),
  personel_id       UUID REFERENCES public.personel(id) ON DELETE SET NULL,
  tc_no             TEXT,
  telefon           TEXT,
  eposta            TEXT,
  adres             TEXT,
  aktif             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_kullanicilar_updated_at
BEFORE UPDATE ON public.kullanicilar
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kullanici_firmalar (
  kullanici_id  UUID NOT NULL REFERENCES public.kullanicilar(id) ON DELETE CASCADE,
  firma_id      UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  PRIMARY KEY (kullanici_id, firma_id)
);

CREATE TABLE public.kullanici_yetkileri (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kullanici_id  UUID NOT NULL REFERENCES public.kullanicilar(id) ON DELETE CASCADE,
  modul         TEXT NOT NULL,  -- maliyet, teklifler, siparisler, ...
  gorebilir     BOOLEAN NOT NULL DEFAULT TRUE,
  duzenleyebilir BOOLEAN NOT NULL DEFAULT FALSE,
  silebilir      BOOLEAN NOT NULL DEFAULT FALSE,
  aktarabilir   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (kullanici_id, modul)
);

CREATE TABLE public.personel_devam (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  personel_id     UUID NOT NULL REFERENCES public.personel(id) ON DELETE CASCADE,
  tarih           DATE NOT NULL,
  giris           TIME,
  cikis           TIME,
  calisma_saat    NUMERIC(6,2),
  mesai_tipi      TEXT NOT NULL DEFAULT 'none', -- none|normal|sunday|holiday
  mesai_saat      NUMERIC(6,2) NOT NULL DEFAULT 0,
  zamaninda       BOOLEAN DEFAULT TRUE,
  UNIQUE (personel_id, tarih)
);

CREATE TABLE public.personel_izin (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  personel_id     UUID NOT NULL REFERENCES public.personel(id) ON DELETE CASCADE,
  tip             TEXT NOT NULL,
  gun             NUMERIC(6,2) NOT NULL DEFAULT 1,
  ay              TEXT NOT NULL,                 -- YYYY-MM
  durum           TEXT NOT NULL DEFAULT 'Bekliyor',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3) CRM · MÜŞTERİ / TEDARİKÇİ
-- =============================================================================
CREATE TABLE public.musteriler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  unvan           TEXT NOT NULL,
  adres           TEXT,
  vergi_no        TEXT,
  vergi_dairesi   TEXT,
  para_birimi     TEXT NOT NULL DEFAULT 'EUR',
  odeme_vadesi    TEXT,
  termin_gun      INT DEFAULT 15,
  imalat_tipi     TEXT,
  teklif_kosullari TEXT,
  notify_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  notify_eposta   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, unvan)
);
CREATE INDEX idx_musteriler_firma ON public.musteriler(firma_id);
CREATE TRIGGER trg_musteriler_updated_at
BEFORE UPDATE ON public.musteriler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.musteri_kisiler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  musteri_id      UUID NOT NULL REFERENCES public.musteriler(id) ON DELETE CASCADE,
  ad_soyad        TEXT NOT NULL,
  departman       TEXT,
  telefon         TEXT,
  eposta          TEXT,
  whatsapp        TEXT,
  birincil        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.tedarikciler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  unvan           TEXT NOT NULL,
  kategori        TEXT NOT NULL DEFAULT 'Hammadde',
  iletisim        TEXT,
  telefon         TEXT,
  whatsapp        TEXT,
  eposta          TEXT,
  adres           TEXT,
  banka           TEXT,
  iban            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, unvan)
);
CREATE INDEX idx_tedarikciler_firma ON public.tedarikciler(firma_id);
CREATE TRIGGER trg_tedarikciler_updated_at
BEFORE UPDATE ON public.tedarikciler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tedarikci_kisiler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tedarikci_id    UUID NOT NULL REFERENCES public.tedarikciler(id) ON DELETE CASCADE,
  ad_soyad        TEXT NOT NULL,
  departman       TEXT,
  telefon         TEXT,
  eposta          TEXT,
  whatsapp        TEXT,
  birincil        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.malzeme_gruplari (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad          TEXT NOT NULL UNIQUE,              -- Çelik, Alüminyum, ...
  sira        INT NOT NULL DEFAULT 0
);

CREATE TABLE public.tedarikci_malzeme_gruplari (
  tedarikci_id      UUID NOT NULL REFERENCES public.tedarikciler(id) ON DELETE CASCADE,
  malzeme_grup_id   UUID NOT NULL REFERENCES public.malzeme_gruplari(id) ON DELETE CASCADE,
  PRIMARY KEY (tedarikci_id, malzeme_grup_id)
);

CREATE TABLE public.tedarikci_fason_hizmetleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tedarikci_id    UUID NOT NULL REFERENCES public.tedarikciler(id) ON DELETE CASCADE,
  hizmet_adi      TEXT NOT NULL,
  UNIQUE (tedarikci_id, hizmet_adi)
);

-- Malzeme grubu ↔ tedarikçi öncelik sırası (RFQ)
CREATE TABLE public.tedarikci_grup_oncelikleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  malzeme_grup_id UUID NOT NULL REFERENCES public.malzeme_gruplari(id) ON DELETE CASCADE,
  tedarikci_id    UUID NOT NULL REFERENCES public.tedarikciler(id) ON DELETE CASCADE,
  oncelik         INT NOT NULL DEFAULT 1,
  UNIQUE (firma_id, malzeme_grup_id, tedarikci_id)
);
CREATE INDEX idx_tedarikci_oncelik ON public.tedarikci_grup_oncelikleri(firma_id, malzeme_grup_id, oncelik);

-- =============================================================================
-- 4) KATALOGLAR (referans)
-- =============================================================================
CREATE TABLE public.malzemeler (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  malzeme_grup_id   UUID NOT NULL REFERENCES public.malzeme_gruplari(id) ON DELETE CASCADE,
  ad                TEXT NOT NULL,               -- St37, 6061, ...
  ozkutle           NUMERIC(10,4) NOT NULL,      -- g/cm³
  fiyat_eur_kg      NUMERIC(14,4) NOT NULL DEFAULT 0,
  aktif             BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (malzeme_grup_id, ad)
);

CREATE TABLE public.urun_sekilleri (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kod         TEXT NOT NULL UNIQUE,              -- round, plate, ...
  ad          TEXT NOT NULL,
  alanlar     JSONB NOT NULL DEFAULT '[]'::JSONB, -- ["Çap","Boy"]
  aktif       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.isil_islem_katalogu (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad                TEXT NOT NULL UNIQUE,
  fiyat_eur_kg      NUMERIC(14,4) NOT NULL DEFAULT 0,
  fiyat_eur_adet    NUMERIC(14,4) NOT NULL DEFAULT 0,
  aktif             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.kaplama_katalogu (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad                TEXT NOT NULL UNIQUE,
  fiyat_eur_kg      NUMERIC(14,4) NOT NULL DEFAULT 0,
  fiyat_eur_adet    NUMERIC(14,4) NOT NULL DEFAULT 0,
  aktif             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.operasyon_kategorileri (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad          TEXT NOT NULL UNIQUE,
  renk        TEXT,
  sira        INT NOT NULL DEFAULT 0
);

CREATE TABLE public.operasyon_adimlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kategori_id     UUID NOT NULL REFERENCES public.operasyon_kategorileri(id) ON DELETE CASCADE,
  ad              TEXT NOT NULL,
  sira            INT NOT NULL DEFAULT 0,
  UNIQUE (kategori_id, ad)
);

CREATE TABLE public.atolyeler (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad          TEXT NOT NULL UNIQUE
);

CREATE TABLE public.atolye_firmalar (
  atolye_id   UUID NOT NULL REFERENCES public.atolyeler(id) ON DELETE CASCADE,
  firma_id    UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  PRIMARY KEY (atolye_id, firma_id)
);

CREATE TABLE public.makineler (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atolye_id   UUID NOT NULL REFERENCES public.atolyeler(id) ON DELETE CASCADE,
  ad          TEXT NOT NULL,
  alt_bilgi   TEXT,
  ikon        TEXT,
  aktif       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.doviz_kurlari (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarih       DATE NOT NULL UNIQUE,
  eur_try     NUMERIC(14,6) NOT NULL,
  usd_try     NUMERIC(14,6) NOT NULL,
  eur_usd     NUMERIC(14,6),
  manuel      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.resmi_tatiller (
  tarih       DATE PRIMARY KEY,
  aciklama    TEXT
);

-- =============================================================================
-- 5) MALİYET
-- =============================================================================
CREATE TABLE public.maliyet_analizleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,                 -- ML-TM-0001
  musteri_id      UUID REFERENCES public.musteriler(id) ON DELETE SET NULL,
  musteri_unvan   TEXT,                          -- denormalize / hızlı görüntü
  ilgili_kisi     TEXT,
  para_birimi     TEXT NOT NULL DEFAULT 'EUR',
  kar_orani       NUMERIC(8,2) NOT NULL DEFAULT 25,
  nakliye         NUMERIC(14,2) NOT NULL DEFAULT 0,
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  termin_gun      INT DEFAULT 15,
  teklif_id       UUID,                          -- sonra FK (circular engeli)
  finansal_ozet   JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE INDEX idx_maliyet_firma ON public.maliyet_analizleri(firma_id);
CREATE TRIGGER trg_maliyet_updated_at
BEFORE UPDATE ON public.maliyet_analizleri
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.maliyet_kalemleri (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maliyet_id          UUID NOT NULL REFERENCES public.maliyet_analizleri(id) ON DELETE CASCADE,
  sira                INT NOT NULL DEFAULT 1,
  parca_no            TEXT,
  aciklama            TEXT,
  adet                NUMERIC(14,3) NOT NULL DEFAULT 1,
  malzeme             TEXT,
  alacim              TEXT,
  sekil_kodu          TEXT,
  sekil_adi           TEXT,
  imalat_olculeri     JSONB NOT NULL DEFAULT '{}'::JSONB,
  siparis_olculeri    JSONB NOT NULL DEFAULT '{}'::JSONB,
  ozkutle             NUMERIC(10,4),
  birim_kg            NUMERIC(14,6),
  toplam_kg           NUMERIC(14,6),
  imalat_birim_kg     NUMERIC(14,6),
  imalat_toplam_kg    NUMERIC(14,6),
  fiyat_eur_kg        NUMERIC(14,4),
  malzeme_birim       NUMERIC(14,4) NOT NULL DEFAULT 0,
  malzeme_toplam      NUMERIC(14,4) NOT NULL DEFAULT 0,
  iscilik_birim       NUMERIC(14,4) NOT NULL DEFAULT 0,
  iscilik_toplam      NUMERIC(14,4) NOT NULL DEFAULT 0,
  isil_tip            TEXT,
  isil_mod            TEXT,
  isil_eur            NUMERIC(14,4) NOT NULL DEFAULT 0,
  isil_tutar          NUMERIC(14,4) NOT NULL DEFAULT 0,
  kaplama_tip         TEXT,
  kaplama_mod         TEXT,
  kaplama_eur         NUMERIC(14,4) NOT NULL DEFAULT 0,
  kaplama_tutar       NUMERIC(14,4) NOT NULL DEFAULT 0,
  kaplama2_tip        TEXT,
  kaplama2_mod        TEXT,
  kaplama2_eur        NUMERIC(14,4) NOT NULL DEFAULT 0,
  kaplama2_tutar      NUMERIC(14,4) NOT NULL DEFAULT 0,
  nakliye             NUMERIC(14,4) NOT NULL DEFAULT 0,
  maliyet_ara         NUMERIC(14,4) NOT NULL DEFAULT 0,
  birim_toplam        NUMERIC(14,4) NOT NULL DEFAULT 0,
  kar_orani           NUMERIC(8,2),
  kar_tutari          NUMERIC(14,4) NOT NULL DEFAULT 0,
  teklif_birim        NUMERIC(14,4) NOT NULL DEFAULT 0,
  teklif_toplam       NUMERIC(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX idx_maliyet_kalem_ust ON public.maliyet_kalemleri(maliyet_id);

