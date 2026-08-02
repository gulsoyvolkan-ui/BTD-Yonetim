-- Demo: anon/authenticated erişim + volkan/ahmet kullanıcı seed
-- Uygulandı (MCP): demo_users_and_anon_grants

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

INSERT INTO public.kullanicilar (kullanici_adi, ad_soyad, sifre_hash, rol, kapsam, tum_grup, is_god, erisim_kritik, yaka, eposta)
VALUES
  ('volkan', 'Volkan', '123456', 'Yönetici', 'Tüm Grup', TRUE, TRUE, TRUE, 'white', 'volkan@btd.com.tr'),
  ('ahmet', 'Ahmet Yıldız', '123456', 'Operatör', 'Firma', FALSE, FALSE, FALSE, 'blue', 'ahmet.yildiz@technomac.com.tr')
ON CONFLICT (kullanici_adi) DO UPDATE SET
  ad_soyad = EXCLUDED.ad_soyad,
  sifre_hash = EXCLUDED.sifre_hash,
  rol = EXCLUDED.rol,
  kapsam = EXCLUDED.kapsam,
  tum_grup = EXCLUDED.tum_grup,
  is_god = EXCLUDED.is_god,
  erisim_kritik = EXCLUDED.erisim_kritik,
  yaka = EXCLUDED.yaka,
  eposta = EXCLUDED.eposta;

INSERT INTO public.kullanici_firmalar (kullanici_id, firma_id)
SELECT u.id, f.id
FROM public.kullanicilar u
CROSS JOIN public.firmalar f
WHERE u.kullanici_adi = 'volkan'
ON CONFLICT DO NOTHING;

INSERT INTO public.kullanici_firmalar (kullanici_id, firma_id)
SELECT u.id, f.id
FROM public.kullanicilar u
JOIN public.firmalar f ON f.kod = 'TM'
WHERE u.kullanici_adi = 'ahmet'
ON CONFLICT DO NOTHING;
