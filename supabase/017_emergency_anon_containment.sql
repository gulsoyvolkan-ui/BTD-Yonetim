-- Acil kapatma: anon, personel (tc_no dahil) ve firma verisini okuyamaz.
-- Bu dosya üretimde bu PR sırasında ÇALIŞTIRILMADI. Sahip onayı olmadan yapıştırmayın.
--
-- Önkoşul: supabase/013_auth_membership.sql aynı veritabanında uygulanmış olmalı.
-- 013 fonksiyonları anon yetkisini açmaz.
--
-- Sıra bu dosyanın içinde sabittir:
--   1) authenticated için USING ve WITH CHECK politikası yazılır
--   2) ancak ondan sonra demo_all_access düşer
--   3) anon tablo yetkisi alınır
-- Arada anon'a GRANT yoktur. demo_all_access yeniden yazılmaz.
-- Katalog tabloları (malzeme, döviz, tatil) bu dosyada yoktur; onlar 015'e kalır.
-- auth_user_id toplu doldurulmaz. İş satırı silinmez.
--
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_anon_containment', 'on', true);
-- Bayrak yoksa hiçbir tablo değişmez.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_anon_containment', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_anon_containment'', ''on'', true); aynı oturumda yok. anon kapatılmadı. Değişiklik yok.';
  END IF;
  IF to_regprocedure('public.btd_firma_erisir(uuid)') IS NULL
     OR to_regprocedure('public.btd_grup_yoneticisi()') IS NULL
     OR to_regprocedure('public.btd_aktif_kullanici_id()') IS NULL THEN
    RAISE EXCEPTION 'Durdu: 013 fonksiyonları yok. 017 çalışmadı. Değişiklik yok.';
  END IF;
END
$guard$;

CREATE OR REPLACE PROCEDURE public._btd_contain_table(p_table text, p_expr text)
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
  EXECUTE format('DROP POLICY IF EXISTS demo_all_access ON public.%I', p_table);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', p_table);
END;
$$;

REVOKE ALL ON PROCEDURE public._btd_contain_table(text, text) FROM PUBLIC, anon, authenticated;

CALL public._btd_contain_table('firma_banka_hesaplari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('belge_sayaclari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('personel', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('personel_devam', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('personel_izin', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('musteriler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('tedarikciler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('tedarikci_grup_oncelikleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('maliyet_analizleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('teklifler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('siparisler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('bildirim_loglari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('is_emirleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('rfq_paketleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('tedarik_kalemleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('yeniden_tedarik_talepleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('beklenmeyen_giderler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('fason_isler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('kalite_kayitlari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('sevkiyatlar', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('faturalar', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('stok_kartlari', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('stok_hareketleri', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('urunler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('fasoncular', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('gorevler', 'public.btd_firma_erisir(firma_id)');
CALL public._btd_contain_table('atolye_firmalar', 'public.btd_firma_erisir(firma_id)');

CALL public._btd_contain_table('musteri_kisiler', 'public.btd_musteri_firma(musteri_id)');
CALL public._btd_contain_table('tedarikci_kisiler', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_contain_table('tedarikci_malzeme_gruplari', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_contain_table('tedarikci_fason_hizmetleri', 'public.btd_tedarikci_firma(tedarikci_id)');
CALL public._btd_contain_table('maliyet_kalemleri', 'public.btd_maliyet_firma(maliyet_id)');
CALL public._btd_contain_table('teklif_kalemleri', 'public.btd_teklif_firma(teklif_id)');
CALL public._btd_contain_table('teklif_banka_hesaplari', 'public.btd_teklif_firma(teklif_id)');
CALL public._btd_contain_table('siparis_kalemleri', 'public.btd_siparis_firma(siparis_id)');
CALL public._btd_contain_table('siparis_revizyonlari', 'public.btd_siparis_firma(siparis_id)');
CALL public._btd_contain_table('is_emri_parcalari', 'public.btd_isemri_firma(is_emri_id)');
CALL public._btd_contain_table('is_emri_cam_adimlari', 'public.btd_parca_firma(parca_id)');
CALL public._btd_contain_table('rfq_gruplari', 'public.btd_rfq_firma(rfq_id)');
CALL public._btd_contain_table('rfq_grup_kalemleri', 'public.btd_rfq_grup_firma(rfq_grup_id)');
CALL public._btd_contain_table('rfq_grup_tedarikcileri', 'public.btd_rfq_grup_firma(rfq_grup_id)');
CALL public._btd_contain_table('rfq_yanitlari', 'public.btd_rfq_firma(rfq_id)');
CALL public._btd_contain_table('beklenmeyen_gider_dagilimlari', 'public.btd_gider_firma(beklenmeyen_gider_id)');
CALL public._btd_contain_table('fason_log', 'public.btd_fason_firma(fason_id)');

DROP PROCEDURE IF EXISTS public._btd_contain_table(text, text);

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
  DROP POLICY IF EXISTS demo_all_access ON public.firmalar;
  REVOKE ALL ON TABLE public.firmalar FROM anon;
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
  DROP POLICY IF EXISTS demo_all_access ON public.makineler;
  REVOKE ALL ON TABLE public.makineler FROM anon;
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
  DROP POLICY IF EXISTS demo_all_access ON public.kullanicilar;
  REVOKE ALL ON TABLE public.kullanicilar FROM anon;

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
    DROP POLICY IF EXISTS demo_all_access ON public.kullanici_firmalar;
    REVOKE ALL ON TABLE public.kullanici_firmalar FROM anon;
  END IF;

  IF to_regclass('public.kullanici_yetkileri') IS NOT NULL THEN
    ALTER TABLE public.kullanici_yetkileri ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS btd_yetki_oku ON public.kullanici_yetkileri;
    CREATE POLICY btd_yetki_oku ON public.kullanici_yetkileri
      FOR SELECT TO authenticated
      USING (kullanici_id = public.btd_aktif_kullanici_id() OR public.btd_grup_yoneticisi());
    DROP POLICY IF EXISTS demo_all_access ON public.kullanici_yetkileri;
    REVOKE ALL ON TABLE public.kullanici_yetkileri FROM anon;
  END IF;
END
$kimlik$;

-- Tablo yetkisi kalmış olsa bile anon bu kolonları seçemesin.
-- Tablo düzeyinde GRANT SELECT, kolon REVOKE'u ezebilir; asıl kapatma yukarıdaki REVOKE ALL'dur.
DO $cols$
BEGIN
  IF to_regclass('public.personel') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'personel' AND column_name = 'tc_no'
    ) THEN
      EXECUTE 'REVOKE ALL (tc_no) ON TABLE public.personel FROM PUBLIC, anon';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'personel' AND column_name = 'maas'
    ) THEN
      EXECUTE 'REVOKE ALL (maas) ON TABLE public.personel FROM PUBLIC, anon';
    END IF;
  END IF;
  IF to_regclass('public.kullanicilar') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kullanicilar' AND column_name = 'tc_no'
    ) THEN
      EXECUTE 'REVOKE ALL (tc_no) ON TABLE public.kullanicilar FROM PUBLIC, anon';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kullanicilar' AND column_name = 'sifre_hash'
    ) THEN
      EXECUTE 'REVOKE ALL (sifre_hash) ON TABLE public.kullanicilar FROM PUBLIC, anon';
    END IF;
  END IF;
END
$cols$;
