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

