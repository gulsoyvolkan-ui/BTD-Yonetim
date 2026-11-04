-- AE-BTD-25E test harness. Yalnizca atilan yerel veritabaninda calisir.
-- supabase/drafts/is_talebi_taslak_v1.sql dosyasinin yazma engeli burada yoktur
-- ve o dosyadan kaldirilmaz. Bu dosya uretim migration'i degildir.
-- approve() ve canli yazma yolu bu dosyayla acilmaz.
-- Sentetik kimlikler. Gercek posta, musteri ve uretim verisi yok.
-- Firma talep_uyelik satirindan gelir. tenant, provider ve mailbox
-- yalniz testin guvenilir baglamindan parametre olarak gelir.
-- Iki ayri UNIQUE. ON CONFLICT DO NOTHING ikisini de karsilar.
-- Cakisma mevcut satiri guncellemez.

CREATE TABLE public.talep_uyelik (
  rolname   TEXT PRIMARY KEY,
  firma_id  UUID NOT NULL
);

CREATE TABLE public.gorevler (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id  UUID NOT NULL,
  durum     TEXT NOT NULL CHECK (durum IN ('Açık', 'Devam', 'Bitti', 'İptal'))
);

CREATE TABLE public.is_talepleri (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id            UUID NOT NULL,
  tenant_id           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  mailbox             TEXT NOT NULL,
  actor_rol           TEXT NOT NULL,
  source_message_ref  TEXT NOT NULL,
  correlation_id      TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  review_status       TEXT NOT NULL CHECK (review_status IN ('taslak', 'incelemede', 'reddedildi', 'onaylandi')),
  CONSTRAINT is_talepleri_idempotency_uq
    UNIQUE (tenant_id, provider, mailbox, firma_id, idempotency_key),
  CONSTRAINT is_talepleri_source_message_uq
    UNIQUE (tenant_id, provider, mailbox, firma_id, source_message_ref)
);

CREATE ROLE btd_talep_a NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE NOCREATEDB;
CREATE ROLE btd_talep_b NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE NOCREATEDB;

ALTER TABLE public.talep_uyelik ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talep_uyelik FORCE ROW LEVEL SECURITY;
ALTER TABLE public.is_talepleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.is_talepleri FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gorevler ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gorevler FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.talep_uyelik FROM PUBLIC;
REVOKE ALL ON public.is_talepleri FROM PUBLIC;
REVOKE ALL ON public.gorevler FROM PUBLIC;
GRANT SELECT ON public.talep_uyelik TO btd_talep_a, btd_talep_b;
GRANT SELECT, INSERT ON public.is_talepleri TO btd_talep_a, btd_talep_b;

CREATE POLICY btd_uyelik_oku ON public.talep_uyelik
  FOR SELECT TO btd_talep_a, btd_talep_b
  USING (rolname = current_user);

CREATE POLICY btd_talep_uye ON public.is_talepleri
  FOR ALL TO btd_talep_a, btd_talep_b
  USING (
    EXISTS (
      SELECT 1 FROM public.talep_uyelik u
      WHERE u.rolname = current_user
        AND u.firma_id = is_talepleri.firma_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.talep_uyelik u
      WHERE u.rolname = current_user
        AND u.firma_id = is_talepleri.firma_id
    )
  );

CREATE OR REPLACE FUNCTION public.btd_talep_kaydet_test(
  p_idempotency_key text,
  p_content_hash text,
  p_source_message_ref text,
  p_correlation_id text,
  p_tenant text,
  p_provider text,
  p_mailbox text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  fid uuid;
  yeni uuid;
  ayni_anahtar uuid;
  ayni_hash text;
  ayni_ref text;
  ayni_kaynak uuid;
  kaynak_anahtar text;
BEGIN
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rol siniri yok';
  END IF;

  IF p_tenant !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
     OR p_provider !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
     OR p_mailbox !~ '^[a-z0-9][a-z0-9_-]{0,39}$' THEN
    RAISE EXCEPTION 'posta_baglami' USING ERRCODE = '42501';
  END IF;

  SELECT u.firma_id INTO fid
  FROM public.talep_uyelik u
  WHERE u.rolname = current_user
  LIMIT 1;
  IF fid IS NULL THEN
    RAISE EXCEPTION 'uye degil' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.is_talepleri (
    firma_id, tenant_id, provider, mailbox, actor_rol,
    source_message_ref, correlation_id, idempotency_key,
    content_hash, review_status
  ) VALUES (
    fid, p_tenant, p_provider, p_mailbox, current_user,
    p_source_message_ref, p_correlation_id, p_idempotency_key,
    p_content_hash, 'incelemede'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO yeni;

  IF yeni IS NOT NULL THEN
    RETURN yeni;
  END IF;

  SELECT id, content_hash, source_message_ref
    INTO ayni_anahtar, ayni_hash, ayni_ref
  FROM public.is_talepleri
  WHERE tenant_id = p_tenant
    AND provider = p_provider
    AND mailbox = p_mailbox
    AND firma_id = fid
    AND idempotency_key = p_idempotency_key;

  SELECT id, idempotency_key
    INTO ayni_kaynak, kaynak_anahtar
  FROM public.is_talepleri
  WHERE tenant_id = p_tenant
    AND provider = p_provider
    AND mailbox = p_mailbox
    AND firma_id = fid
    AND source_message_ref = p_source_message_ref;

  IF ayni_anahtar IS NOT NULL
     AND ayni_kaynak IS NOT DISTINCT FROM ayni_anahtar
     AND ayni_hash IS NOT DISTINCT FROM p_content_hash
     AND ayni_ref IS NOT DISTINCT FROM p_source_message_ref
     AND kaynak_anahtar IS NOT DISTINCT FROM p_idempotency_key THEN
    RETURN ayni_anahtar;
  END IF;

  IF ayni_kaynak IS NOT NULL AND kaynak_anahtar IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'kaynak_mesaj_ayri_anahtar' USING ERRCODE = '23505';
  END IF;

  RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.btd_talep_kaydet_test(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btd_talep_kaydet_test(text, text, text, text, text, text, text) TO btd_talep_a, btd_talep_b;
