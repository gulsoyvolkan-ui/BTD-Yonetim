-- BTD Faz 8 geri alma.
-- Canlıda ÇALIŞTIRILMADI. anon, authenticated ve service_role rolleri silinmez.
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_shadow_kimlik', 'on', false);

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_shadow_kimlik', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_shadow_kimlik'', ''on'', false); aynı oturumda yok. Değişiklik yok.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.btd_shadow_operasyon_ozet(text, uuid, integer);
DROP FUNCTION IF EXISTS public.btd_servis_yetki(text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.btd_shadow_jti_temizle(timestamptz);
DROP FUNCTION IF EXISTS public.btd_shadow_jti_iptal(text, text);
DROP FUNCTION IF EXISTS public.btd_shadow_jti_geri_al(text, text);
DROP FUNCTION IF EXISTS public.btd_shadow_jti_tamamla(text, text);
DROP FUNCTION IF EXISTS public.btd_shadow_jti_tuket(text, text, text, uuid, timestamptz, integer);

DROP TABLE IF EXISTS public.btd_shadow_jti;
DROP TABLE IF EXISTS public.btd_servis_denetim;
DROP TABLE IF EXISTS public.btd_servis_kayit;

DO $drop_reader$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btd_shadow_okuyucu') THEN
    DROP ROLE btd_shadow_okuyucu;
  END IF;
END
$drop_reader$;
