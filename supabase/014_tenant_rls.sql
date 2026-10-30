-- Kiracı RLS politikaları. demo_all_access bu dosyada silinmez.
-- Postgres politikaları OR ile birleşir. demo_all_access dururken bu dosya
-- anon erişimini kapatmaz. Kapatma adımı 015_revoke_anon_demo.sql dosyasındadır.
--
-- Yedek alınmadan çalıştırmayın. Aynı oturumda önce:
--   SELECT set_config('btd.allow_rls', 'on', true);
-- Bayrak yoksa dosya hiçbir tabloyu değiştirmez.
-- Tablo yoksa o politika atlanır. Tekrar çalıştırmak güvenlidir.
-- Canlı veritabanında bu PR sırasında ÇALIŞTIRILMADI. Üretim RLS doğrulanmış değildir.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_rls', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_rls'', ''on'', true); aynı oturumda yok. Yedek alınmadan RLS açılmaz. Değişiklik yok.';
  END IF;
END
$guard$;

CREATE OR REPLACE PROCEDURE public._btd_apply_tenant_all(p_table text, p_expr text)
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RAISE NOTICE 'btd: tablo yok, atlandı: %', p_table;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS btd_tenant_all ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY btd_tenant_all ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
    p_table, p_expr, p_expr
  );
END;
$$;

REVOKE ALL ON PROCEDURE public._btd_apply_tenant_all(text, text) FROM PUBLIC, anon, authenticated;

CALL public._btd_apply_tenant_all('firma_banka_hesaplari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('belge_sayaclari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('personel', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('personel_devam', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('personel_izin', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('musteriler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('tedarikciler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('tedarikci_grup_oncelikleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('maliyet_analizleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('teklifler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('siparisler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('bildirim_loglari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('is_emirleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('rfq_paketleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('tedarik_kalemleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('yeniden_tedarik_talepleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('beklenmeyen_giderler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('fason_isler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('kalite_kayitlari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('sevkiyatlar', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('faturalar', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('stok_kartlari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('stok_hareketleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('urunler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('fasoncular', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('gorevler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_apply_tenant_all('atolye_firmalar', 'public.btd_firma_erisir(firma_id)');

CALL public._btd_apply_tenant_all('musteri_kisiler', 'public.btd_musteri_firma(musteri_id)');
CALL public._btd_apply_tenant_all('tedarikci_kisiler', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_apply_tenant_all('tedarikci_malzeme_gruplari', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_apply_tenant_all('tedarikci_fason_hizmetleri', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_apply_tenant_all('maliyet_kalemleri', 'public.btd_maliyet_firma(maliyet_id)');
CALL public._btd_apply_tenant_all('teklif_kalemleri', 'public.btd_teklif_firma(teklif_id)');
CALL public._btd_apply_tenant_all('teklif_banka_hesaplari', 'public.btd_teklif_firma(teklif_id)');
CALL public._btd_apply_tenant_all('siparis_kalemleri', 'public.btd_siparis_firma(siparis_id)');
CALL public._btd_apply_tenant_all('siparis_revizyonlari', 'public.btd_siparis_firma(siparis_id)');
CALL public._btd_apply_tenant_all('is_emri_parcalari', 'public.btd_isemri_firma(is_emri_id)');
CALL public._btd_apply_tenant_all('is_emri_cam_adimlari', 'public.btd_parca_firma(parca_id)');
CALL public._btd_apply_tenant_all('rfq_gruplari', 'public.btd_rfq_firma(rfq_id)');
CALL public._btd_apply_tenant_all('rfq_grup_kalemleri', 'public.btd_rfq_grup_firma(rfq_grup_id)');
CALL public._btd_apply_tenant_all('rfq_grup_tedarikcileri', 'public.btd_rfq_grup_firma(rfq_grup_id)');
CALL public._btd_apply_tenant_all('rfq_yanitlari', 'public.btd_rfq_firma(rfq_id)');
CALL public._btd_apply_tenant_all('beklenmeyen_gider_dagilimlari', 'public.btd_gider_firma(beklenmeyen_gider_id)');
CALL public._btd_apply_tenant_all('fason_log', 'public.btd_fason_firma(fason_id)');

DROP PROCEDURE IF EXISTS public._btd_apply_tenant_all(text, text);

CREATE OR REPLACE PROCEDURE public._btd_apply_catalog(p_table text)
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RAISE NOTICE 'btd: katalog yok, atlandı: %', p_table;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS btd_katalog_oku ON public.%I', p_table);
  EXECUTE format('DROP POLICY IF EXISTS btd_katalog_ekle ON public.%I', p_table);
  EXECUTE format('DROP POLICY IF EXISTS btd_katalog_guncelle ON public.%I', p_table);
  EXECUTE format('DROP POLICY IF EXISTS btd_katalog_sil ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY btd_katalog_oku ON public.%I FOR SELECT TO authenticated USING (public.btd_aktif_kullanici_id() IS NOT NULL)',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY btd_katalog_ekle ON public.%I FOR INSERT TO authenticated WITH CHECK (public.btd_grup_yoneticisi())',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY btd_katalog_guncelle ON public.%I FOR UPDATE TO authenticated USING (public.btd_grup_yoneticisi()) WITH CHECK (public.btd_grup_yoneticisi())',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY btd_katalog_sil ON public.%I FOR DELETE TO authenticated USING (public.btd_grup_yoneticisi())',
    p_table
  );
END;
$$;

REVOKE ALL ON PROCEDURE public._btd_apply_catalog(text) FROM PUBLIC, anon, authenticated;

CALL public._btd_apply_catalog('malzeme_gruplari');
CALL public._btd_apply_catalog('malzemeler');
CALL public._btd_apply_catalog('urun_sekilleri');
CALL public._btd_apply_catalog('isil_islem_katalogu');
CALL public._btd_apply_catalog('kaplama_katalogu');
CALL public._btd_apply_catalog('operasyon_kategorileri');
CALL public._btd_apply_catalog('operasyon_adimlari');
CALL public._btd_apply_catalog('atolyeler');
CALL public._btd_apply_catalog('doviz_kurlari');
CALL public._btd_apply_catalog('resmi_tatiller');

DROP PROCEDURE IF EXISTS public._btd_apply_catalog(text);

DO $firmalar$
BEGIN
  IF to_regclass('public.firmalar') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.firmalar ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS btd_firma_oku ON public.firmalar;
  DROP POLICY IF EXISTS btd_firma_guncelle ON public.firmalar;
  CREATE POLICY btd_firma_oku ON public.firmalar
    FOR SELECT TO authenticated
    USING (public.btd_firma_erisir(id) OR public.btd_grup_yoneticisi());
  CREATE POLICY btd_firma_guncelle ON public.firmalar
    FOR UPDATE TO authenticated
    USING (public.btd_grup_yoneticisi())
    WITH CHECK (public.btd_grup_yoneticisi());
END
$firmalar$;

DO $makineler$
BEGIN
  IF to_regclass('public.makineler') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.makineler ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS btd_tenant_all ON public.makineler;
  CREATE POLICY btd_tenant_all ON public.makineler
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.atolye_firmalar af
        WHERE af.atolye_id = makineler.atolye_id
          AND public.btd_firma_erisir(af.firma_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.atolye_firmalar af
        WHERE af.atolye_id = makineler.atolye_id
          AND public.btd_firma_erisir(af.firma_id)
      )
    );
END
$makineler$;

DO $kimlik$
BEGIN
  IF to_regclass('public.kullanicilar') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.kullanicilar ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS btd_kullanici_oku ON public.kullanicilar;
  CREATE POLICY btd_kullanici_oku ON public.kullanicilar
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid() OR public.btd_grup_yoneticisi());

  IF to_regclass('public.kullanici_firmalar') IS NOT NULL THEN
    ALTER TABLE public.kullanici_firmalar ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS btd_uyelik_oku ON public.kullanici_firmalar;
    DROP POLICY IF EXISTS btd_uyelik_yaz ON public.kullanici_firmalar;
    CREATE POLICY btd_uyelik_oku ON public.kullanici_firmalar
      FOR SELECT TO authenticated
      USING (kullanici_id = public.btd_aktif_kullanici_id() OR public.btd_grup_yoneticisi());
    CREATE POLICY btd_uyelik_yaz ON public.kullanici_firmalar
      FOR INSERT TO authenticated
      WITH CHECK (public.btd_grup_yoneticisi());
  END IF;

  IF to_regclass('public.kullanici_yetkileri') IS NOT NULL THEN
    ALTER TABLE public.kullanici_yetkileri ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS btd_yetki_oku ON public.kullanici_yetkileri;
    CREATE POLICY btd_yetki_oku ON public.kullanici_yetkileri
      FOR SELECT TO authenticated
      USING (kullanici_id = public.btd_aktif_kullanici_id() OR public.btd_grup_yoneticisi());
  END IF;
END
$kimlik$;
