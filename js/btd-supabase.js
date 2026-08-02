/**
 * BTD Yönetim · Supabase veri katmanı (firma + giriş)
 * Yerel mock veriyle yan yana çalışır; bağlantı yoksa sessizce fallback.
 */
(function (global) {
  const CURRENCY_UI = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };
  const BADGE_DEFAULTS = {
    Technomac: { badgeBg: 'bg-navy', logoBoxBg: 'bg-white' },
    Bluemac: { badgeBg: 'bg-sky-600', logoBoxBg: 'bg-white' },
    Devorias: { badgeBg: 'bg-amber-600', logoBoxBg: 'bg-steel-900' },
  };

  let client = null;
  let ready = false;
  let lastError = null;

  function getClient() {
    if (client) return client;
    const cfg = global.BTD_SUPABASE;
    if (!cfg?.url || !cfg?.anonKey || !global.supabase?.createClient) {
      lastError = 'Supabase istemcisi yüklenemedi';
      return null;
    }
    client = global.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ready = true;
    return client;
  }

  function mapCurrency(code) {
    return CURRENCY_UI[code] || code || '₺';
  }

  function mapCollar(yaka) {
    if (yaka === 'blue' || yaka === 'mavi') return 'blue';
    return 'white';
  }

  /**
   * firmalar + banka hesaplarını mevcut `companies` nesnesine merge eder.
   * UI chrome (badgeBg vb.) yerel varsayılanlarla korunur.
   */
  async function hydrateCompanies(companies) {
    const sb = getClient();
    if (!sb || !companies) return { ok: false, reason: lastError || 'no-client' };

    try {
      const { data: firmalar, error: fErr } = await sb
        .from('firmalar')
        .select('id, kod, ad, unvan, logo_url, adres, vergi_dairesi, vergi_no, telefon, website, eposta, imza_yetkilisi, teslim_yeri, garanti_metni, varsayilan_odeme')
        .order('kod');
      if (fErr) throw fErr;
      if (!firmalar?.length) return { ok: false, reason: 'empty' };

      const { data: banks, error: bErr } = await sb
        .from('firma_banka_hesaplari')
        .select('firma_id, hesap_kodu, para_birimi, etiket, banka_adi, sube, iban, sira')
        .order('sira');
      if (bErr) throw bErr;

      const banksByFirma = {};
      (banks || []).forEach((b) => {
        (banksByFirma[b.firma_id] ||= []).push(b);
      });

      firmalar.forEach((f) => {
        const name = f.ad;
        if (!name) return;
        const chrome = BADGE_DEFAULTS[name] || { badgeBg: 'bg-navy', logoBoxBg: 'bg-white' };
        const prev = companies[name] || {};
        const bankRows = banksByFirma[f.id] || [];
        const bankAccounts = bankRows.map((b) => ({
          id: b.hesap_kodu || `${f.kod}-${b.para_birimi}`.toLowerCase(),
          currency: mapCurrency(b.para_birimi),
          label: b.etiket || `${b.para_birimi} Hesabı`,
          bankName: b.banka_adi || '',
          bankBranch: b.sube || '',
          iban: b.iban || '',
        }));
        const selectedIds = bankAccounts.map((a) => a.id);

        companies[name] = {
          ...prev,
          ...chrome,
          dbId: f.id,
          kod: f.kod,
          logo: f.logo_url || prev.logo || '',
          legal: f.unvan || prev.legal || name,
          address: f.adres || prev.address || '',
          taxOffice: f.vergi_dairesi || prev.taxOffice || '',
          taxNo: f.vergi_no || prev.taxNo || '',
          phone: f.telefon || prev.phone || '',
          website: f.website || prev.website || '',
          email: f.eposta || prev.email || '',
          signatory: f.imza_yetkilisi || prev.signatory || '',
          deliveryPlace: f.teslim_yeri || prev.deliveryPlace || '',
          warranty: f.garanti_metni || prev.warranty || '',
          defaultPaymentType: f.varsayilan_odeme || prev.defaultPaymentType || '',
          quoteBankMode: prev.quoteBankMode || 'auto',
          quoteBankSelected: selectedIds.length ? selectedIds : (prev.quoteBankSelected || []),
          bankAccounts: bankAccounts.length ? bankAccounts : (prev.bankAccounts || []),
        };
      });

      console.info('[BTD] Firmalar Supabase\'den yüklendi:', firmalar.map((x) => x.ad).join(', '));
      return { ok: true, count: firmalar.length };
    } catch (err) {
      lastError = err?.message || String(err);
      console.warn('[BTD] Firma hydrate başarısız, yerel veri kullanılıyor:', lastError);
      return { ok: false, reason: lastError };
    }
  }

  /**
   * DB kullanıcısını yerel `users` satır şekline çevirir.
   * permsFactory: (role) => perms object
   */
  async function fetchUserForLogin(username, password) {
    const sb = getClient();
    if (!sb) return null;

    const u = (username || '').trim().toLowerCase();
    const p = (password || '').trim();
    if (!u || !p) return null;

    try {
      const { data: row, error } = await sb
        .from('kullanicilar')
        .select(`
          id, kullanici_adi, ad_soyad, sifre_hash, rol, kapsam, tum_grup, is_god,
          erisim_kritik, yaka, eposta, telefon, tc_no, adres, aktif,
          kullanici_firmalar ( firma_id, firmalar ( ad ) )
        `)
        .ilike('kullanici_adi', u)
        .eq('aktif', true)
        .maybeSingle();

      if (error) throw error;
      if (!row) return null;
      if ((row.sifre_hash || '') !== p) return null;

      const firmNames = (row.kullanici_firmalar || [])
        .map((kf) => kf.firmalar?.ad)
        .filter(Boolean);

      return {
        id: row.id,
        username: row.kullanici_adi,
        name: row.ad_soyad,
        password: row.sifre_hash,
        role: row.rol || 'Operatör',
        scope: (row.tum_grup || row.kapsam === 'Tüm Grup')
          ? 'Tüm Grup'
          : (row.kapsam || firmNames[0] || 'Firma'),
        companies: firmNames,
        isGod: !!(row.is_god || row.tum_grup),
        accessCritical: !!row.erisim_kritik,
        collar: mapCollar(row.yaka),
        email: row.eposta || '',
        phone: row.telefon || '',
        tcNo: row.tc_no || '',
        address: row.adres || '',
        dept: '',
        personnelId: null,
        source: 'supabase',
      };
    } catch (err) {
      lastError = err?.message || String(err);
      console.warn('[BTD] Login sorgusu başarısız:', lastError);
      return null;
    }
  }

  global.BtdSupabase = {
    getClient,
    isReady: () => ready && !!getClient(),
    getLastError: () => lastError,
    hydrateCompanies,
    fetchUserForLogin,
  };
})(typeof window !== 'undefined' ? window : globalThis);
