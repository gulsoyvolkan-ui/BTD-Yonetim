-- Yazma ve silme olayını auth.uid() ile denetim_olaylari tablosuna yazar.
-- Satır gövdesi, tc_no, maas ve parola yazılmaz. İstemci actor alanını seçemez.
-- Denetim tablosunun kendisine tetik takılmaz.
--
-- Önkoşul: 013 (denetim_olaylari).
-- Aynı oturumda, dosyadan önce:
--   SELECT set_config('btd.allow_audit_trigger', 'on', true);
-- Canlıda bu PR sırasında ÇALIŞTIRILMADI.

DO $guard$
BEGIN
  IF coalesce(current_setting('btd.allow_audit_trigger', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Durdu: SELECT set_config(''btd.allow_audit_trigger'', ''on'', true); aynı oturumda yok. Tetik yok. Değişiklik yok.';
  END IF;
  IF to_regclass('public.denetim_olaylari') IS NULL THEN
    RAISE EXCEPTION 'Durdu: denetim_olaylari yok. Önce 013. Değişiklik yok.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.btd_denetim_satir()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fid UUID;
BEGIN
  fid := NULL;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      fid := OLD.firma_id;
    ELSE
      fid := NEW.firma_id;
    END IF;
  EXCEPTION
    WHEN undefined_column THEN
      fid := NULL;
  END;

  BEGIN
    INSERT INTO public.denetim_olaylari (firma_id, actor_auth_id, olay, kaynak, durum)
    VALUES (fid, auth.uid(), TG_OP, TG_TABLE_NAME, 200);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'btd denetim yazılamadı: %', TG_TABLE_NAME;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.btd_denetim_satir() FROM PUBLIC, anon, authenticated;

DO $attach$
DECLARE
  rec TEXT;
  tables TEXT[] := ARRAY[
    'firma_banka_hesaplari', 'belge_sayaclari', 'personel', 'personel_devam', 'personel_izin',
    'musteriler', 'tedarikciler', 'tedarikci_grup_oncelikleri', 'maliyet_analizleri', 'teklifler',
    'siparisler', 'bildirim_loglari', 'is_emirleri', 'rfq_paketleri', 'tedarik_kalemleri',
    'yeniden_tedarik_talepleri', 'beklenmeyen_giderler', 'fason_isler', 'kalite_kayitlari',
    'sevkiyatlar', 'faturalar', 'stok_kartlari', 'stok_hareketleri', 'urunler', 'fasoncular',
    'gorevler', 'atolye_firmalar', 'musteri_kisiler', 'tedarikci_kisiler',
    'tedarikci_malzeme_gruplari', 'tedarikci_fason_hizmetleri', 'maliyet_kalemleri',
    'teklif_kalemleri', 'teklif_banka_hesaplari', 'siparis_kalemleri', 'siparis_revizyonlari',
    'is_emri_parcalari', 'is_emri_cam_adimlari', 'rfq_gruplari', 'rfq_grup_kalemleri',
    'rfq_grup_tedarikcileri', 'rfq_yanitlari', 'beklenmeyen_gider_dagilimlari', 'fason_log',
    'firmalar', 'makineler', 'kullanicilar', 'kullanici_firmalar', 'kullanici_yetkileri'
  ];
BEGIN
  FOREACH rec IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', rec)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS btd_denetim_trg ON public.%I', rec);
    EXECUTE format(
      'CREATE TRIGGER btd_denetim_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.btd_denetim_satir()',
      rec
    );
  END LOOP;
END
$attach$;
