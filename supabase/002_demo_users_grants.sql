-- Demo grant ve demo kullanıcı yazımı kapatıldı.
-- Eski sürüm anon rolüne şema genelinde yazma veriyor ve yerel hesap ekliyordu.
-- O komutlar bu dosyadan çıkarıldı. Git geçmişindeki kopya yeniden çalıştırılmaz.
-- Üretim sırası: 013, hesap bağlama, 017, kod dağıtımı, 018, 019, 014, 015.
-- Bu dosya hiçbir GRANT ve hiçbir INSERT çalıştırmaz.

DO $guard$
BEGIN
  RAISE EXCEPTION 'Durdu: 002 demo grant kapalı. anon yetkisi ve demo kullanıcı yazılmadı. Değişiklik yok.';
END
$guard$;
