-- AE-BTD-25B. Business Request Draft v1 TASLAK.
-- UYGULANMADI. Calistirma yok. Canli, uretim ve Supabase SQL Editor hedef degildir.
-- Kalici idempotency ve transaction yalniz bu tasarimdadir.
-- Node bellek simulasyonu bu dosyayi calistirmaz ve veritabani kaniti degildir.
-- Bayrak yoktur. Ilk ifade her zaman durur; alttaki DDL bu PR'da erisilmez.
-- saveTask, nextCode, public.gorevler, public.denetim_olaylari, public.firmalar,
-- public.kullanicilar ve mevcut RLS politikalari bu dosyada degistirilmez.
--
-- Uyumluluk (mevcut sema ve RLS):
-- 001 public.firmalar(id, kod) ve public.set_updated_at durur. belge_sayaclari'na tip eklenmez.
-- 010 public.gorevler.durum yalniz Acik, Devam, Bitti, Iptal. Bu dosya o kumeye deger eklemez.
-- 010 UNIQUE (firma_id, kod) durur. Yeni tekillik is_talepleri uzerinde iki ayri UNIQUE:
-- (tenant_id, provider, mailbox, firma_id, idempotency_key) ve
-- (tenant_id, provider, mailbox, firma_id, source_message_ref).
-- Ikisi tek UNIQUE icinde birlestirilmez. Ayni mesaj baska anahtarla ikinci satir acmaz.
-- 013 public.denetim_olaylari kolonlari ayni kalir: firma_id, actor_auth_id, olay, kaynak, durum.
-- 013 btd_denetim_yaz: actor_auth_id = auth.uid() ve btd_firma_erisir(firma_id).
--     Aktör gövdeden, e-postadan veya fonksiyon parametresinden secilmez.
-- 014 ve 017 gorevler politikasi btd_tenant_all / btd_firma_erisir. Bu dosya onu dusurmez.
-- Yeni tablolarda INSERT politikasi yoktur. Yazma yalniz asagidaki fonksiyonlardadir
-- ve her iki fonksiyon da ilk satirda 'yazma kapali' firlatir.
-- Firma, JSON govdesindeki firma_id alanindan alinmaz. Govde alani yok sayilir.
-- Guvenilir baglam auth.uid() ve public.btd_firma_erisir ile kurulur.
-- Idempotency: ayni firma, tenant, provider ve mailbox icinde ayni anahtar,
-- ayni source_message_ref ve ayni content_hash mevcut satiri dondurur.
-- Ayni anahtar ve farkli content_hash veya farkli source_message_ref cakismadir.
-- Ayni source_message_ref ve farkli idempotency_key cakismadir.
-- Iki ayri UNIQUE. ON CONFLICT DO NOTHING ikisini de karsilar.
-- is_talepleri satirinda ON CONFLICT DO UPDATE yoktur. UNIQUE ihlali satiri guncellemez.
-- source_message_ref, correlation_id ve idempotency_key ayri kolonlardir.
-- tenant_id, provider, mailbox ve firma_id JSON govdesinden alinmaz.
-- Firma, tenant, provider ve ic posta kutusu kimligi sunucu baglamindandir.
-- Gorev kodu is_talebi_sayaclari satir kilidi ile uretilir. Tarayici nextCode kullanilmaz.
-- Onay tek transaction tasarimidir: yetki, idempotency, gorev, denetim.
-- Biri basarisizsa hepsi rollback. Bu PR'da fonksiyon o yazmayi yapmaz.
-- Denetim satirina ham e-posta, ileti govdesi, eksik alan metni ve kanit icerigi kopyalanmaz.
-- Geri alma tasarimi (uygulanmaz): is_talepleri ve is_talebi_sayaclari DROP,
-- iki fonksiyon DROP. public.gorevler ve public.denetim_olaylari DROP edilmez.

DO $closed$
BEGIN
  RAISE EXCEPTION 'AE-BTD-25B taslak uygulanmaz. Yazma kapali. Degisiklik yok.';
END
$closed$;

CREATE TABLE public.is_talepleri (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id             UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  tenant_id            TEXT NOT NULL,
  provider             TEXT NOT NULL,
  mailbox              TEXT NOT NULL,
  actor_auth_id        UUID NOT NULL,
  schema_version       TEXT NOT NULL CHECK (schema_version = 'business-request-draft.v1'),
  source_message_ref   TEXT NOT NULL,
  correlation_id       TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  request_category     TEXT NOT NULL CHECK (request_category IN ('teklif', 'teknik', 'genel')),
  missing_information  JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash         TEXT NOT NULL,
  review_status        TEXT NOT NULL CHECK (review_status IN ('taslak', 'incelemede', 'reddedildi', 'onaylandi')),
  gorev_id             UUID NULL REFERENCES public.gorevler(id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT is_talepleri_idempotency_uq
    UNIQUE (tenant_id, provider, mailbox, firma_id, idempotency_key),
  CONSTRAINT is_talepleri_source_message_uq
    UNIQUE (tenant_id, provider, mailbox, firma_id, source_message_ref)
);

CREATE TABLE public.is_talebi_sayaclari (
  firma_id  UUID PRIMARY KEY REFERENCES public.firmalar(id) ON DELETE RESTRICT,
  son_no    INT NOT NULL DEFAULT 0 CHECK (son_no >= 0)
);

DROP TRIGGER IF EXISTS trg_is_talepleri_updated_at ON public.is_talepleri;
CREATE TRIGGER trg_is_talepleri_updated_at
BEFORE UPDATE ON public.is_talepleri
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.is_talepleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.is_talepleri FORCE ROW LEVEL SECURITY;
ALTER TABLE public.is_talebi_sayaclari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.is_talebi_sayaclari FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.is_talepleri FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.is_talebi_sayaclari FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.is_talepleri TO authenticated;

DROP POLICY IF EXISTS btd_is_talebi_oku ON public.is_talepleri;
CREATE POLICY btd_is_talebi_oku ON public.is_talepleri
  FOR SELECT TO authenticated
  USING (public.btd_firma_erisir(firma_id));

-- adim:yetki
-- auth.uid() bos ise dur. public.btd_firma_erisir(talep.firma_id) yoksa dur.
-- JSON govde firma_id, gonderen adresi ve istemci aktör alani okunmaz.
-- adim:idempotency
-- Talep satiri FOR UPDATE. content_hash farkliysa RAISE 'idempotency_conflict'.
-- Ayni hash ikinci gorev acmaz.
-- Kayit tekilligi iki ayri UNIQUE kisittir. Ihlal is_talepleri satirini guncellemez.
-- adim:gorev
-- INSERT INTO is_talebi_sayaclari (firma_id, son_no) VALUES (fid, 1)
-- ON CONFLICT (firma_id) DO UPDATE SET son_no = is_talebi_sayaclari.son_no + 1
-- RETURNING son_no. Kod GV-{firmalar.kod}-NNNN. Durum yalniz Acik.
-- review_status gorevler.durum kolonuna yazilmaz.
-- adim:denetim
-- INSERT INTO public.denetim_olaylari (firma_id, actor_auth_id, olay, kaynak, durum)
-- VALUES (fid, auth.uid(), 'onay', 'is_talepleri', 200).
-- Hata olursa transaction rollback. Gorev ve denetim birlikte kalir veya birlikte gider.

CREATE OR REPLACE FUNCTION public.btd_is_talebi_kaydet(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'yazma kapali';
END;
$$;

CREATE OR REPLACE FUNCTION public.btd_is_talebi_onayla(p_talep uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'yazma kapali';
END;
$$;

REVOKE ALL ON FUNCTION public.btd_is_talebi_kaydet(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btd_is_talebi_onayla(uuid) FROM PUBLIC, anon, authenticated;
