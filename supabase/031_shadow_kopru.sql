-- BTD Faz 9. Köprü bağlantı kimliği.
-- Canlıda bu dosya ÇALIŞTIRILMADI. Üretim geçiş sırasına eklenmedi.
-- Parola, anahtar ve bağlantı dizesi bu dosyada yoktur.
-- btd_shadow_okuyucu NOLOGIN kalır. SHADOW bu role bağlanmaz.
-- service_role, postgres ve RLS bypass normal okumada kullanılmaz.
--
-- Önkoşul: supabase/030_shadow_kimlik.sql aynı veritabanında uygulanmış olmalı.
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_shadow_kimlik', 'on', false);
-- Bayrak yoksa durur. Satır değişmez.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_shadow_kimlik', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_shadow_kimlik'', ''on'', false); aynı oturumda yok. Değişiklik yok.';
  END IF;
  IF to_regprocedure('public.btd_shadow_operasyon_ozet(text,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Durdu: 030_shadow_kimlik.sql uygulanmamış. Değişiklik yok.';
  END IF;
END
$guard$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu') THEN
    CREATE ROLE btd_shadow_okuyucu NOLOGIN NOINHERIT;
  END IF;
  ALTER ROLE btd_shadow_okuyucu NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btd_shadow_kopru') THEN
    CREATE ROLE btd_shadow_kopru LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
  END IF;
  ALTER ROLE btd_shadow_kopru LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
END
$roles$;

DO $membership$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid AND granted.rolname = 'btd_shadow_okuyucu'
    JOIN pg_roles member ON member.oid = m.member AND member.rolname = 'btd_shadow_kopru'
  ) THEN
    REVOKE btd_shadow_okuyucu FROM btd_shadow_kopru;
  END IF;
END
$membership$;

GRANT btd_shadow_okuyucu TO btd_shadow_kopru WITH INHERIT FALSE, SET TRUE;

ALTER ROLE btd_shadow_kopru SET search_path = pg_catalog;
ALTER ROLE btd_shadow_kopru SET statement_timeout = '3s';
ALTER ROLE btd_shadow_kopru SET lock_timeout = '2s';
ALTER ROLE btd_shadow_kopru SET idle_in_transaction_session_timeout = '5s';

GRANT USAGE ON SCHEMA public TO btd_shadow_okuyucu;
REVOKE CREATE ON SCHEMA public FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.btd_servis_kayit FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.btd_servis_denetim FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.btd_shadow_jti FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.siparisler FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.is_emirleri FROM btd_shadow_okuyucu, btd_shadow_kopru;
REVOKE ALL ON TABLE public.gorevler FROM btd_shadow_okuyucu, btd_shadow_kopru;

ALTER FUNCTION public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_shadow_jti_tamamla(text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_shadow_jti_geri_al(text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_shadow_jti_iptal(text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_shadow_jti_temizle(timestamptz) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_servis_yetki(text, uuid, text, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_tamamla(text, text) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_geri_al(text, text) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_iptal(text, text) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_shadow_jti_temizle(timestamptz) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_servis_yetki(text, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;
REVOKE ALL ON FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role, btd_shadow_kopru;

GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_tamamla(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_geri_al(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_iptal(text, text) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_jti_temizle(timestamptz) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_servis_yetki(text, uuid, text, integer) TO btd_shadow_okuyucu;
GRANT EXECUTE ON FUNCTION public.btd_shadow_operasyon_ozet(text, uuid, integer) TO btd_shadow_okuyucu;
