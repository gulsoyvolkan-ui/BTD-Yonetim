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

-- =============================================================================
-- 6) TEKLİF / SİPARİŞ
-- =============================================================================
CREATE TABLE public.teklifler (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id          UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no          TEXT NOT NULL,               -- TM-0038-2026
  musteri_id        UUID REFERENCES public.musteriler(id) ON DELETE SET NULL,
  musteri_unvan     TEXT NOT NULL,
  ilgili_kisi       TEXT,
  tarih             DATE NOT NULL DEFAULT CURRENT_DATE,
  para_birimi       TEXT NOT NULL DEFAULT 'EUR',
  termin_gun        INT NOT NULL DEFAULT 15,
  odeme_vadesi      TEXT,
  odeme_tipi        TEXT,
  imalat_tipi       TEXT,
  teslim_yeri       TEXT,
  garanti           TEXT,
  kosullar          TEXT,
  kdv_orani         NUMERIC(6,2) NOT NULL DEFAULT 20,
  gecerlilik_gun    INT DEFAULT 15,
  durum             TEXT NOT NULL DEFAULT 'Taslak'
                      CHECK (durum IN ('Taslak','Gönderildi','Onaylandı','Reddedildi','Bekliyor')),
  maliyet_id        UUID REFERENCES public.maliyet_analizleri(id) ON DELETE SET NULL,
  qr_payload        TEXT,
  gonderim_eposta   BOOLEAN NOT NULL DEFAULT FALSE,
  gonderim_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  banka_mod         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE INDEX idx_teklifler_firma ON public.teklifler(firma_id);
CREATE TRIGGER trg_teklifler_updated_at
BEFORE UPDATE ON public.teklifler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maliyet_analizleri
  ADD CONSTRAINT fk_maliyet_teklif
  FOREIGN KEY (teklif_id) REFERENCES public.teklifler(id) ON DELETE SET NULL;

CREATE TABLE public.teklif_kalemleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teklif_id       UUID NOT NULL REFERENCES public.teklifler(id) ON DELETE CASCADE,
  sira            INT NOT NULL DEFAULT 1,
  parca_no        TEXT,
  aciklama        TEXT,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  birim_fiyat     NUMERIC(14,4) NOT NULL DEFAULT 0,
  iskonto_pct     NUMERIC(8,2) NOT NULL DEFAULT 0,
  not_metni       TEXT
);
CREATE INDEX idx_teklif_kalem_ust ON public.teklif_kalemleri(teklif_id);

CREATE TABLE public.teklif_banka_hesaplari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teklif_id       UUID NOT NULL REFERENCES public.teklifler(id) ON DELETE CASCADE,
  para_birimi     TEXT,
  etiket          TEXT,
  hesap_unvani    TEXT,
  banka_adi       TEXT,
  sube            TEXT,
  iban            TEXT
);

CREATE TABLE public.siparisler (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id          UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no          TEXT NOT NULL,
  teklif_id         UUID REFERENCES public.teklifler(id) ON DELETE SET NULL,
  musteri_id        UUID REFERENCES public.musteriler(id) ON DELETE SET NULL,
  musteri_unvan     TEXT NOT NULL,
  ilgili_kisi       TEXT,
  po_no             TEXT,
  para_birimi       TEXT NOT NULL DEFAULT 'EUR',
  onay_tarihi       DATE NOT NULL DEFAULT CURRENT_DATE,
  termin_gun        INT NOT NULL DEFAULT 15,
  teslim_tarihi     DATE,
  kosullar          TEXT,
  durum             TEXT NOT NULL DEFAULT 'Onaylandı'
                      CHECK (durum IN ('Onaylandı','Revize Edildi','Üretimde','Tamamlandı','İptal')),
  revizyon_no       INT NOT NULL DEFAULT 0,
  beklenmeyen_toplam NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE INDEX idx_siparisler_firma ON public.siparisler(firma_id);
CREATE INDEX idx_siparisler_teklif ON public.siparisler(teklif_id);
CREATE TRIGGER trg_siparisler_updated_at
BEFORE UPDATE ON public.siparisler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.siparis_kalemleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siparis_id      UUID NOT NULL REFERENCES public.siparisler(id) ON DELETE CASCADE,
  sira            INT NOT NULL DEFAULT 1,
  parca_no        TEXT,
  aciklama        TEXT,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  birim_fiyat     NUMERIC(14,4) NOT NULL DEFAULT 0,
  iskonto_pct     NUMERIC(8,2) NOT NULL DEFAULT 0,
  ek_gider        NUMERIC(14,4) NOT NULL DEFAULT 0,  -- beklenmeyen pay
  not_metni       TEXT
);
CREATE INDEX idx_siparis_kalem_ust ON public.siparis_kalemleri(siparis_id);

CREATE TABLE public.siparis_revizyonlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siparis_id      UUID NOT NULL REFERENCES public.siparisler(id) ON DELETE CASCADE,
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  not_metni       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.bildirim_loglari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kayit_tipi      TEXT NOT NULL,                 -- siparis | is_emri | teklif
  kayit_id        UUID NOT NULL,
  kanal           TEXT,                          -- email | whatsapp
  asama           TEXT,                          -- quote|mfg|qc|ship
  metin           TEXT,
  olusturma       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bildirim_kayit ON public.bildirim_loglari(kayit_tipi, kayit_id);

-- =============================================================================
-- 7) İŞ EMRİ / İMALAT
-- =============================================================================
CREATE TABLE public.is_emirleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,                 -- TM-2026-0001
  musteri_id      UUID REFERENCES public.musteriler(id) ON DELETE SET NULL,
  musteri_unvan   TEXT,
  ilgili_kisi     JSONB,                         -- anlık kişi objesi
  acilis_tarihi   DATE NOT NULL DEFAULT CURRENT_DATE,
  kapanis_tarihi  DATE,
  durum           TEXT NOT NULL DEFAULT 'Aktif'
                    CHECK (durum IN ('Aktif','Tamamlandı','İptal Edildi')),
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  teklif_id       UUID REFERENCES public.teklifler(id) ON DELETE SET NULL,
  qr_payload      TEXT,
  tedarikten      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE INDEX idx_is_emirleri_firma ON public.is_emirleri(firma_id);
CREATE TRIGGER trg_is_emirleri_updated_at
BEFORE UPDATE ON public.is_emirleri
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.is_emri_parcalari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_emri_id      UUID NOT NULL REFERENCES public.is_emirleri(id) ON DELETE CASCADE,
  parca_no        INT NOT NULL,
  ad              TEXT NOT NULL,
  malzeme         TEXT,
  operator_adi    TEXT,
  aktif_cam       INT NOT NULL DEFAULT 0,
  UNIQUE (is_emri_id, parca_no)
);

CREATE TABLE public.is_emri_cam_adimlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parca_id        UUID NOT NULL REFERENCES public.is_emri_parcalari(id) ON DELETE CASCADE,
  sira            INT NOT NULL,
  etiket          TEXT NOT NULL,
  makine_adi      TEXT,
  baslangic_at    TIMESTAMPTZ,
  bitis_at        TIMESTAMPTZ,
  baslangic_nfc   TEXT,
  bitis_nfc       TEXT,
  UNIQUE (parca_id, sira)
);

-- =============================================================================
-- 8) RFQ / TEDARİK / YENİDEN TEDARİK / BEKLENMEYEN
-- =============================================================================
CREATE TABLE public.rfq_paketleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  kaynak          TEXT NOT NULL CHECK (kaynak IN ('cost','order','reproc','maliyet','siparis')),
  kaynak_id       UUID,
  ref_etiket      TEXT,
  musteri_unvan   TEXT,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  durum           TEXT NOT NULL DEFAULT 'Taslak',
  form_meta       JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- form_meta: talep_tarihi, teslim_yeri, termin, odeme, gecerlilik, notlar, para_birimi
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE TRIGGER trg_rfq_updated_at
BEFORE UPDATE ON public.rfq_paketleri
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.rfq_gruplari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id          UUID NOT NULL REFERENCES public.rfq_paketleri(id) ON DELETE CASCADE,
  malzeme_grup_id UUID REFERENCES public.malzeme_gruplari(id) ON DELETE SET NULL,
  grup_adi        TEXT NOT NULL,
  sira            INT NOT NULL DEFAULT 1
);

CREATE TABLE public.rfq_grup_kalemleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_grup_id     UUID NOT NULL REFERENCES public.rfq_gruplari(id) ON DELETE CASCADE,
  parca           TEXT,
  malzeme         TEXT,
  alacim          TEXT,
  sekil_adi       TEXT,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  birim_kg        NUMERIC(14,6),
  toplam_kg       NUMERIC(14,6),
  olculer         JSONB NOT NULL DEFAULT '{}'::JSONB,
  parca_no        TEXT
);

CREATE TABLE public.rfq_grup_tedarikcileri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_grup_id     UUID NOT NULL REFERENCES public.rfq_gruplari(id) ON DELETE CASCADE,
  tedarikci_id    UUID REFERENCES public.tedarikciler(id) ON DELETE SET NULL,
  tedarikci_unvan TEXT NOT NULL,
  oncelik         INT NOT NULL DEFAULT 1,
  secili          BOOLEAN NOT NULL DEFAULT TRUE,
  iletisim        JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE public.rfq_yanitlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id          UUID NOT NULL REFERENCES public.rfq_paketleri(id) ON DELETE CASCADE,
  grup_adi        TEXT,
  tedarikci_unvan TEXT NOT NULL,
  durum           TEXT NOT NULL DEFAULT 'Teklif Bekleniyor',
  tutar           NUMERIC(14,4),
  not_metni       TEXT,
  oncelik         INT,
  yanit_tarihi    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tedarik_kalemleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  parca           TEXT,
  malzeme         TEXT,
  alacim          TEXT,
  sekil_adi       TEXT,
  imalat_olculeri JSONB NOT NULL DEFAULT '{}'::JSONB,
  siparis_olculeri JSONB NOT NULL DEFAULT '{}'::JSONB,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  birim_kg        NUMERIC(14,6),
  toplam_kg       NUMERIC(14,6),
  ozkutle         NUMERIC(10,4),
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  parca_no        TEXT,
  tedarikci_id    UUID REFERENCES public.tedarikciler(id) ON DELETE SET NULL,
  tedarikci_unvan TEXT,
  siparis_tarihi  DATE,
  termin_tarihi   DATE,
  durum           TEXT NOT NULL DEFAULT 'Bekliyor',
  maliyet_id      UUID REFERENCES public.maliyet_analizleri(id) ON DELETE SET NULL,
  teklif_id       UUID REFERENCES public.teklifler(id) ON DELETE SET NULL,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  rfq_id          UUID REFERENCES public.rfq_paketleri(id) ON DELETE SET NULL,
  malzeme_grup    TEXT,
  rfq_oncelik     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE INDEX idx_tedarik_firma ON public.tedarik_kalemleri(firma_id);
CREATE INDEX idx_tedarik_isemri ON public.tedarik_kalemleri(is_emri_id);
CREATE TRIGGER trg_tedarik_updated_at
BEFORE UPDATE ON public.tedarik_kalemleri
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.yeniden_tedarik_talepleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  parca_no        INT,
  parca_adi       TEXT,
  malzeme         TEXT,
  malzeme_grup    TEXT,
  neden           TEXT,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  tahmin_tutar    NUMERIC(14,4) NOT NULL DEFAULT 0,
  durum           TEXT NOT NULL DEFAULT 'Onay Bekliyor'
                    CHECK (durum IN ('Onay Bekliyor','Onaylandı','Reddedildi')),
  talep_eden      TEXT,
  talep_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onaylayan       TEXT,
  onay_at         TIMESTAMPTZ,
  rfq_id          UUID REFERENCES public.rfq_paketleri(id) ON DELETE SET NULL,
  UNIQUE (firma_id, belge_no)
);

CREATE TABLE public.beklenmeyen_giderler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  parca_no        INT,
  tutar           NUMERIC(14,4) NOT NULL DEFAULT 0,
  para_birimi     TEXT NOT NULL DEFAULT 'EUR',
  neden           TEXT,
  kaynak          TEXT NOT NULL DEFAULT 'reproc',
  yeniden_tedarik_id UUID REFERENCES public.yeniden_tedarik_talepleri(id) ON DELETE SET NULL,
  dagitildi       BOOLEAN NOT NULL DEFAULT FALSE,
  dagitim_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);

CREATE TABLE public.beklenmeyen_gider_dagilimlari (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beklenmeyen_gider_id  UUID NOT NULL REFERENCES public.beklenmeyen_giderler(id) ON DELETE CASCADE,
  siparis_kalem_id      UUID REFERENCES public.siparis_kalemleri(id) ON DELETE SET NULL,
  kalem_index           INT,
  parca_no              TEXT,
  tutar                 NUMERIC(14,4) NOT NULL DEFAULT 0
);

ALTER TABLE public.yeniden_tedarik_talepleri
  ADD COLUMN beklenmeyen_gider_id UUID REFERENCES public.beklenmeyen_giderler(id) ON DELETE SET NULL;

-- =============================================================================
-- 9) FASON / KALİTE / SEVKİYAT / FATURA / STOK
-- =============================================================================
CREATE TABLE public.fason_isler (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  is_emri_ref     TEXT,
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  parca           TEXT,
  seri_no         TEXT,
  adet            NUMERIC(14,3) NOT NULL DEFAULT 1,
  proses          TEXT NOT NULL,                 -- Isıl İşlem / Kaplama
  proses_detay    TEXT,
  tedarikci_id    UUID REFERENCES public.tedarikciler(id) ON DELETE SET NULL,
  tedarikci_unvan TEXT,
  ilgili_kisi     TEXT,
  telefon         TEXT,
  gonderim_tarihi DATE,
  termin_tarihi   DATE,
  donus_tarihi    DATE,
  durum           TEXT NOT NULL DEFAULT 'Taslak',
  not_metni       TEXT,
  maliyet_id      UUID REFERENCES public.maliyet_analizleri(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);
CREATE TRIGGER trg_fason_updated_at
BEFORE UPDATE ON public.fason_isler
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.fason_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fason_id        UUID NOT NULL REFERENCES public.fason_isler(id) ON DELETE CASCADE,
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  metin           TEXT NOT NULL
);

CREATE TABLE public.kalite_kayitlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  parca_etiket    TEXT,
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  nfc             TEXT,
  not_metni       TEXT,
  sonuc           TEXT NOT NULL DEFAULT 'Onaylandı'
                    CHECK (sonuc IN ('Onaylandı','Şartlı Kabul','Red')),
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);

CREATE TABLE public.sevkiyatlar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  musteri_unvan   TEXT,
  tasiyici        TEXT,
  irsaliye_no     TEXT,
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  durum           TEXT NOT NULL DEFAULT 'Hazırlanıyor'
                    CHECK (durum IN ('Hazırlanıyor','Yolda','Teslim Edildi','İptal')),
  teslim_yontemi  TEXT CHECK (teslim_yontemi IS NULL OR teslim_yontemi IN ('signature','digital','imza','dijital')),
  teslim_at       TIMESTAMPTZ,
  not_metni       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sevkiyat_siparis ON public.sevkiyatlar(siparis_id);

CREATE TABLE public.faturalar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  belge_no        TEXT NOT NULL,
  siparis_id      UUID REFERENCES public.siparisler(id) ON DELETE SET NULL,
  musteri_unvan   TEXT,
  para_birimi     TEXT NOT NULL DEFAULT 'EUR',
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  kdv_orani       NUMERIC(6,2) NOT NULL DEFAULT 20,
  ara_toplam      NUMERIC(14,4) NOT NULL DEFAULT 0,
  kdv_tutar       NUMERIC(14,4) NOT NULL DEFAULT 0,
  genel_toplam    NUMERIC(14,4) NOT NULL DEFAULT 0,
  satis_net       NUMERIC(14,4) NOT NULL DEFAULT 0,
  maliyet_gider   NUMERIC(14,4) NOT NULL DEFAULT 0,
  vergi_oncesi    NUMERIC(14,4) NOT NULL DEFAULT 0,
  gelir_vergisi_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  gelir_vergisi   NUMERIC(14,4) NOT NULL DEFAULT 0,
  net_kar         NUMERIC(14,4) NOT NULL DEFAULT 0,
  maliyet_id      UUID REFERENCES public.maliyet_analizleri(id) ON DELETE SET NULL,
  durum           TEXT NOT NULL DEFAULT 'Kesildi'
                    CHECK (durum IN ('Kesildi','Ödendi','Gecikmiş')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, belge_no)
);

CREATE TABLE public.stok_kartlari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  sku             TEXT NOT NULL,
  ad              TEXT NOT NULL,
  kategori        TEXT,                          -- Hammadde, Takım, Yarı Mamul, Mamul
  miktar          NUMERIC(14,4) NOT NULL DEFAULT 0,
  birim           TEXT NOT NULL DEFAULT 'adet',
  min_miktar      NUMERIC(14,4) NOT NULL DEFAULT 0,
  tedarikci_unvan TEXT,
  lokasyon        TEXT,
  is_emri_id      UUID REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  teklif_id       UUID REFERENCES public.teklifler(id) ON DELETE SET NULL,
  qr_payload      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firma_id, sku)
);
CREATE TRIGGER trg_stok_updated_at
BEFORE UPDATE ON public.stok_kartlari
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.stok_hareketleri (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  stok_id         UUID REFERENCES public.stok_kartlari(id) ON DELETE SET NULL,
  sku             TEXT NOT NULL,
  tip             TEXT NOT NULL CHECK (tip IN ('Giriş','Çıkış')),
  miktar          NUMERIC(14,4) NOT NULL,
  birim           TEXT,
  not_metni       TEXT,
  tarih           DATE NOT NULL DEFAULT CURRENT_DATE,
  referans        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stok_hareket_firma ON public.stok_hareketleri(firma_id, tarih DESC);

-- =============================================================================
-- 10) YARDIMCI VIEW'LAR (rapor / dashboard)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_siparis_toplamlari AS
SELECT
  s.id,
  s.firma_id,
  s.belge_no,
  s.durum,
  COALESCE(SUM(
    (sk.adet * sk.birim_fiyat) * (1 - COALESCE(sk.iskonto_pct,0)/100.0)
    + COALESCE(sk.ek_gider,0)
  ), 0)::NUMERIC(14,4) AS genel_toplam
FROM public.siparisler s
LEFT JOIN public.siparis_kalemleri sk ON sk.siparis_id = s.id
GROUP BY s.id;

CREATE OR REPLACE VIEW public.v_teklif_toplamlari AS
SELECT
  t.id,
  t.firma_id,
  t.belge_no,
  t.durum,
  COALESCE(SUM(
    (tk.adet * tk.birim_fiyat) * (1 - COALESCE(tk.iskonto_pct,0)/100.0)
  ), 0)::NUMERIC(14,4) AS ara_toplam
FROM public.teklifler t
LEFT JOIN public.teklif_kalemleri tk ON tk.teklif_id = t.id
GROUP BY t.id;

-- =============================================================================
-- 11) SEED · FİRMALAR (Bluemac, Technomac, Devorias)
-- =============================================================================
INSERT INTO public.firmalar (kod, ad, unvan, logo_url, adres, vergi_dairesi, vergi_no, telefon, website, eposta, imza_yetkilisi, teslim_yeri, garanti_metni, varsayilan_odeme)
VALUES
(
  'TM',
  'Technomac',
  'Technomac Makine Sanayi Ticaret Limited Şirketi',
  'assets/logos/technomac.png',
  'Velibaba Mah. Mimarsinan Cad. Velibaba San Sitesi B2 Blok No:5-6 Pendik / İstanbul',
  'Pendik V.D.',
  '8331201835',
  '+90 (216) 583 13 44',
  'www.technomac.com.tr',
  'info@technomac.com.tr',
  'Volkan Gülsoy',
  'Pendik / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
),
(
  'BM',
  'Bluemac',
  'Bluemac Makine Sanayi Ticaret Limited Şirketi',
  'assets/logos/bluemac.png',
  'Velibaba Mah. Mimarsinan Cad. Velibaba San Sitesi B2 Blok No:5-6 Pendik / İstanbul',
  'Pendik V.D.',
  '5642178930',
  '+90 (216) 583 13 44',
  'www.bluemac.com.tr',
  'info@bluemac.com.tr',
  'Serkan Bulut',
  'Pendik / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
),
(
  'DV',
  'Devorias',
  'Devorias Tasarım ve İnovasyon Sanayi Ticaret Limited Şirketi',
  'assets/logos/devorias.png',
  'Barbaros Mah. İnovasyon Cad. No:22 Ataşehir / İstanbul',
  'Ataşehir V.D.',
  '7415293068',
  '+90 (216) 344 90 21',
  'www.devorias.com',
  'info@devorias.com',
  'Kerem Polat',
  'Ataşehir / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
)
ON CONFLICT (kod) DO UPDATE SET
  unvan = EXCLUDED.unvan,
  logo_url = EXCLUDED.logo_url,
  adres = EXCLUDED.adres,
  vergi_dairesi = EXCLUDED.vergi_dairesi,
  vergi_no = EXCLUDED.vergi_no,
  telefon = EXCLUDED.telefon,
  website = EXCLUDED.website,
  eposta = EXCLUDED.eposta,
  imza_yetkilisi = EXCLUDED.imza_yetkilisi,
  teslim_yeri = EXCLUDED.teslim_yeri,
  garanti_metni = EXCLUDED.garanti_metni,
  varsayilan_odeme = EXCLUDED.varsayilan_odeme,
  updated_at = NOW();

-- Banka hesapları (seed) — aynı hesap_kodu varsa atla
INSERT INTO public.firma_banka_hesaplari (firma_id, hesap_kodu, para_birimi, etiket, banka_adi, sube, iban, sira)
SELECT f.id, v.hesap_kodu, v.para_birimi, v.etiket, v.banka_adi, v.sube, v.iban, v.sira
FROM public.firmalar f
JOIN (VALUES
  ('Technomac','tm-try','TRY','TL Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 20',1),
  ('Technomac','tm-usd','USD','Dolar Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 21',2),
  ('Technomac','tm-eur','EUR','Euro Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 22',3),
  ('Bluemac','bm-try','TRY','TL Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 17',1),
  ('Bluemac','bm-usd','USD','Dolar Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 18',2),
  ('Bluemac','bm-eur','EUR','Euro Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 19',3),
  ('Devorias','dv-try','TRY','TL Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 78',1),
  ('Devorias','dv-usd','USD','Dolar Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 79',2),
  ('Devorias','dv-eur','EUR','Euro Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 80',3)
) AS v(firma_ad, hesap_kodu, para_birimi, etiket, banka_adi, sube, iban, sira)
  ON f.ad = v.firma_ad
WHERE NOT EXISTS (
  SELECT 1 FROM public.firma_banka_hesaplari b
  WHERE b.firma_id = f.id AND b.hesap_kodu = v.hesap_kodu
);

-- Malzeme grupları (UI katalog + Titanyum)
INSERT INTO public.malzeme_gruplari (ad, sira) VALUES
  ('Çelik',1),('Paslanmaz',2),('Alüminyum',3),('Pirinç',4),
  ('Bronz',5),('Bakır',6),('Plastik',7),('Filament',8),
  ('Titanyum',9),('Polimer',10)
ON CONFLICT (ad) DO NOTHING;

-- Temel belge sayaçları (2026)
INSERT INTO public.belge_sayaclari (firma_id, belge_tipi, yil, son_no)
SELECT f.id, t.belge_tipi, 2026, 0
FROM public.firmalar f
CROSS JOIN (VALUES
  ('teklif'),('siparis'),('is_emri'),('maliyet'),('tedarik'),
  ('rfq'),('fason'),('fatura'),('qc'),('stok'),
  ('yeniden_tedarik'),('beklenmeyen')
) AS t(belge_tipi)
ON CONFLICT (firma_id, belge_tipi, yil) DO NOTHING;
