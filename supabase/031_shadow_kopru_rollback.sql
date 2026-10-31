-- BTD Faz 9 köprü geri alma.
-- Canlıda ÇALIŞTIRILMADI. Jti tablosu, servis kaydı ve btd_shadow_okuyucu silinmez.
-- anon, authenticated ve service_role silinmez.
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_shadow_kimlik', 'on', false);

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_shadow_kimlik', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_shadow_kimlik'', ''on'', false); aynı oturumda yok. Değişiklik yok.';
  END IF;
END
$guard$;

DO $drop_bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btd_shadow_kopru') THEN
    IF EXISTS (
      SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid AND granted.rolname = 'btd_shadow_okuyucu'
      JOIN pg_roles member ON member.oid = m.member AND member.rolname = 'btd_shadow_kopru'
    ) THEN
      REVOKE btd_shadow_okuyucu FROM btd_shadow_kopru;
    END IF;
    DROP ROLE btd_shadow_kopru;
  END IF;
END
$drop_bridge$;
