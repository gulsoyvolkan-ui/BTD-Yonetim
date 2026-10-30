INSERT INTO public.firmalar (kod, ad, unvan)
VALUES ('ZA', 'Sentetik A', 'Sentetik A'), ('ZB', 'Sentetik B', 'Sentetik B')
ON CONFLICT (kod) DO NOTHING;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'ada@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'volkan@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000c1', 'revoker@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000d1', 'yeni@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000e1', 'attacker@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000f1', 'dup@synth.test', now()),
  ('00000000-0000-4000-8000-0000000000f2', 'plain@synth.test', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.kullanicilar (kullanici_adi, ad_soyad, sifre_hash, rol, eposta, erisim_kritik, is_god, aktif, auth_user_id)
VALUES
  ('ada', 'Ada', 'synthetic-hash', 'Operatör', 'ada@synth.test', false, false, true, '00000000-0000-4000-8000-0000000000a1'),
  ('volkan', 'Volkan Adi', 'synthetic-hash', 'Yönetici', 'volkan@synth.test', false, true, true, '00000000-0000-4000-8000-0000000000b1'),
  ('revoker', 'Revoker', 'synthetic-hash', 'Yönetici', 'revoker@synth.test', true, false, true, '00000000-0000-4000-8000-0000000000c1'),
  ('yeni', 'Yeni', 'synthetic-hash', 'Operatör', 'yeni@synth.test', false, false, true, NULL),
  ('dup1', 'Dup Bir', 'synthetic-hash', 'Operatör', 'dup@synth.test', false, false, true, NULL),
  ('dup2', 'Dup Iki', 'synthetic-hash', 'Operatör', 'dup@synth.test', false, false, true, NULL),
  ('plain', 'Plain', 'synthetic-hash', 'Operatör', 'plain@synth.test', false, false, true, NULL)
ON CONFLICT (kullanici_adi) DO NOTHING;

INSERT INTO public.kullanici_firmalar (kullanici_id, firma_id)
SELECT u.id, f.id
FROM public.kullanicilar u
JOIN public.firmalar f ON (
  (u.kullanici_adi = 'ada' AND f.kod = 'ZA')
  OR (u.kullanici_adi = 'volkan' AND f.kod = 'ZB')
  OR (u.kullanici_adi = 'revoker' AND f.kod IN ('ZA', 'ZB'))
  OR (u.kullanici_adi = 'yeni' AND f.kod = 'ZA')
)
ON CONFLICT DO NOTHING;

INSERT INTO public.siparisler (firma_id, belge_no, musteri_unvan)
SELECT f.id, 'SYN-' || f.kod, 'Sentetik Musteri'
FROM public.firmalar f
WHERE f.kod IN ('ZA', 'ZB')
ON CONFLICT (firma_id, belge_no) DO NOTHING;

INSERT INTO public.musteriler (firma_id, unvan)
SELECT f.id, 'Sentetik Musteri ' || f.kod
FROM public.firmalar f
WHERE f.kod IN ('ZA', 'ZB')
ON CONFLICT (firma_id, unvan) DO NOTHING;
