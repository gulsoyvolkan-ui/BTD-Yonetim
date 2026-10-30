-- Bu dosyayı Supabase SQL Editor'a yapıştırıp çalıştırın.
-- kullanicilar.sifre_hash içindeki düz metin değerleri, uygulamanın kullandığı
-- SHA-256 özetine çevrilir (UTF-8 baytları, küçük harf hex).
-- Değer zaten 64 karakterlik hex özet ise satır olduğu gibi kalır.
-- Tablo silinmez. Aynı sorgu tekrar çalıştırılabilir; ikinci sefer satır değiştirmez.

DO $$
DECLARE
  fn_schema text;
  digest_sql text;
BEGIN
  SELECT n.nspname
    INTO fn_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'digest'
    AND pg_get_function_identity_arguments(p.oid) = 'bytea, text'
    AND n.nspname IN ('extensions', 'public')
  ORDER BY CASE n.nspname WHEN 'extensions' THEN 0 ELSE 1 END
  LIMIT 1;

  IF fn_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto digest bulunamadı. Supabase SQL Editor içinde pgcrypto açık olmalı; hiçbir tablo değiştirilmedi.';
  END IF;

  digest_sql := format(
    $upd$
      UPDATE public.kullanicilar
      SET sifre_hash = encode(%I.digest(convert_to(sifre_hash, 'UTF8'), 'sha256'), 'hex')
      WHERE sifre_hash IS NOT NULL
        AND btrim(sifre_hash) <> ''
        AND sifre_hash !~* '^[0-9a-f]{64}$'
    $upd$,
    fn_schema
  );

  EXECUTE digest_sql;
END $$;
