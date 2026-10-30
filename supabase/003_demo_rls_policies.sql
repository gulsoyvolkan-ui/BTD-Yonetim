-- Demo RLS kapatıldı.
-- Eski sürüm her public tabloda demo_all_access (USING true / WITH CHECK true) yazıyordu.
-- O politika bu dosyada yeniden oluşturulmaz. Git geçmişindeki kopya yeniden çalıştırılmaz.
-- Kapatma dosyaları: 017 (personel ve firma), ardından 015 (kalan anon).

DO $guard$
BEGIN
  RAISE EXCEPTION 'Durdu: 003 demo_all_access kapalı. Anon politika yazılmadı. Değişiklik yok.';
END
$guard$;
