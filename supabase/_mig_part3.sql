-- =============================================================================
-- 10) YARDIMCI VIEW'LAR (rapor / dashboard)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_siparis_toplamlari AS
SELECT
  s.id,
  s.firma_id,
  s.belge_no,
  s.durum,
  COALESCE(SUM(
    (sk.adet * sk.birim_fiyat) * (1 - COALESCE(sk.iskonto_pct,0)/100.0)
    + COALESCE(sk.ek_gider,0)
  ), 0)::NUMERIC(14,4) AS genel_toplam
FROM public.siparisler s
LEFT JOIN public.siparis_kalemleri sk ON sk.siparis_id = s.id
GROUP BY s.id;

CREATE OR REPLACE VIEW public.v_teklif_toplamlari AS
SELECT
  t.id,
  t.firma_id,
  t.belge_no,
  t.durum,
  COALESCE(SUM(
    (tk.adet * tk.birim_fiyat) * (1 - COALESCE(tk.iskonto_pct,0)/100.0)
  ), 0)::NUMERIC(14,4) AS ara_toplam
FROM public.teklifler t
LEFT JOIN public.teklif_kalemleri tk ON tk.teklif_id = t.id
GROUP BY t.id;

-- =============================================================================
-- 11) SEED · FİRMALAR (Bluemac, Technomac, Devorias)
-- =============================================================================
INSERT INTO public.firmalar (kod, ad, unvan, logo_url, adres, vergi_dairesi, vergi_no, telefon, website, eposta, imza_yetkilisi, teslim_yeri, garanti_metni, varsayilan_odeme)
VALUES
(
  'TM',
  'Technomac',
  'Technomac Makine Sanayi Ticaret Limited Şirketi',
  'assets/logos/technomac.png',
  'Velibaba Mah. Mimarsinan Cad. Velibaba San Sitesi B2 Blok No:5-6 Pendik / İstanbul',
  'Pendik V.D.',
  '8331201835',
  '+90 (216) 583 13 44',
  'www.technomac.com.tr',
  'info@technomac.com.tr',
  'Volkan Gülsoy',
  'Pendik / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
),
(
  'BM',
  'Bluemac',
  'Bluemac Makine Sanayi Ticaret Limited Şirketi',
  'assets/logos/bluemac.png',
  'Velibaba Mah. Mimarsinan Cad. Velibaba San Sitesi B2 Blok No:5-6 Pendik / İstanbul',
  'Pendik V.D.',
  '5642178930',
  '+90 (216) 583 13 44',
  'www.bluemac.com.tr',
  'info@bluemac.com.tr',
  'Serkan Bulut',
  'Pendik / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
),
(
  'DV',
  'Devorias',
  'Devorias Tasarım ve İnovasyon Sanayi Ticaret Limited Şirketi',
  'assets/logos/devorias.png',
  'Barbaros Mah. İnovasyon Cad. No:22 Ataşehir / İstanbul',
  'Ataşehir V.D.',
  '7415293068',
  '+90 (216) 344 90 21',
  'www.devorias.com',
  'info@devorias.com',
  'Kerem Polat',
  'Ataşehir / İstanbul — Fabrika teslim',
  'İmalatlar 1 yıl garantilidir.',
  '30 gün vadeli — Havale / EFT'
)
ON CONFLICT (kod) DO UPDATE SET
  unvan = EXCLUDED.unvan,
  logo_url = EXCLUDED.logo_url,
  adres = EXCLUDED.adres,
  vergi_dairesi = EXCLUDED.vergi_dairesi,
  vergi_no = EXCLUDED.vergi_no,
  telefon = EXCLUDED.telefon,
  website = EXCLUDED.website,
  eposta = EXCLUDED.eposta,
  imza_yetkilisi = EXCLUDED.imza_yetkilisi,
  teslim_yeri = EXCLUDED.teslim_yeri,
  garanti_metni = EXCLUDED.garanti_metni,
  varsayilan_odeme = EXCLUDED.varsayilan_odeme,
  updated_at = NOW();

-- Banka hesapları (seed) — aynı hesap_kodu varsa atla
INSERT INTO public.firma_banka_hesaplari (firma_id, hesap_kodu, para_birimi, etiket, banka_adi, sube, iban, sira)
SELECT f.id, v.hesap_kodu, v.para_birimi, v.etiket, v.banka_adi, v.sube, v.iban, v.sira
FROM public.firmalar f
JOIN (VALUES
  ('Technomac','tm-try','TRY','TL Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 20',1),
  ('Technomac','tm-usd','USD','Dolar Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 21',2),
  ('Technomac','tm-eur','EUR','Euro Hesabı','Garanti BBVA','Pendik (1233)','TR12 0006 2001 2330 0006 8331 22',3),
  ('Bluemac','bm-try','TRY','TL Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 17',1),
  ('Bluemac','bm-usd','USD','Dolar Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 18',2),
  ('Bluemac','bm-eur','EUR','Euro Hesabı','İş Bankası','Pendik (3421)','TR33 0006 4000 0013 4210 5642 19',3),
  ('Devorias','dv-try','TRY','TL Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 78',1),
  ('Devorias','dv-usd','USD','Dolar Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 79',2),
  ('Devorias','dv-eur','EUR','Euro Hesabı','Yapı Kredi','Ataşehir (2210)','TR55 0006 7010 0000 0012 3456 80',3)
) AS v(firma_ad, hesap_kodu, para_birimi, etiket, banka_adi, sube, iban, sira)
  ON f.ad = v.firma_ad
WHERE NOT EXISTS (
  SELECT 1 FROM public.firma_banka_hesaplari b
  WHERE b.firma_id = f.id AND b.hesap_kodu = v.hesap_kodu
);

-- Malzeme grupları (UI katalog + Titanyum)
INSERT INTO public.malzeme_gruplari (ad, sira) VALUES
  ('Çelik',1),('Paslanmaz',2),('Alüminyum',3),('Pirinç',4),
  ('Bronz',5),('Bakır',6),('Plastik',7),('Filament',8),
  ('Titanyum',9),('Polimer',10)
ON CONFLICT (ad) DO NOTHING;

-- Temel belge sayaçları (2026)
INSERT INTO public.belge_sayaclari (firma_id, belge_tipi, yil, son_no)
SELECT f.id, t.belge_tipi, 2026, 0
FROM public.firmalar f
CROSS JOIN (VALUES
  ('teklif'),('siparis'),('is_emri'),('maliyet'),('tedarik'),
  ('rfq'),('fason'),('fatura'),('qc'),('stok'),
  ('yeniden_tedarik'),('beklenmeyen')
) AS t(belge_tipi)
ON CONFLICT (firma_id, belge_tipi, yil) DO NOTHING;
