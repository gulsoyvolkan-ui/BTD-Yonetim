-- Geri dönüş anon SELECT veya ALL açmaz.
-- Eski sürüm demo_all_access ve anon tablo yetkisini geri yazıyordu. O sürüm kaldırıldı.
-- Bu dosya çalıştırılırsa hiçbir yetki değişmez; işlem durur.
--
-- Kalıcı geri dönüş:
--   1) Uygulama kodunu bir önceki git sürümüne almak (ayrı sahip kararı, birleştirme değil).
--   2) Tek hesap için auth_user_id çözümünü runbook'taki tek satırla yapmak.
--   3) authenticated politikalarını yeniden uygulamak gerekiyorsa 014, anon'a izin vermeden.
-- Geniş anon okuma geri açılmaz. 002 ve 003 de yeniden çalıştırılmaz.

DO $guard$
BEGIN
  RAISE EXCEPTION 'Durdu: anon geniş yetki geri açılmaz. demo_all_access yazılmadı. GRANT anon yok. Değişiklik yok.';
END
$guard$;
