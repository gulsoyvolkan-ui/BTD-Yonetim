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
    const storage = global.sessionStorage;
    client = global.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: !!storage,
        autoRefreshToken: !!storage,
        detectSessionInUrl: false,
        storage: storage,
      },
    });
    ready = true;
    return client;
  }

  function mapCurrency(code) {
    return CURRENCY_UI[code] || code || '₺';
  }

  function safeError(err) {
    return String(err?.message || err || '')
      .replace(/sifre_hash|tc_no|password|bearer\s+\S+/gi, '[gizli]')
      .slice(0, 200);
  }

  function mapCollar(yaka) {
    if (yaka === 'blue' || yaka === 'mavi') return 'blue';
    if (yaka === 'manager' || yaka === 'yonetici' || yaka === 'yönetici') return 'manager';
    return 'white';
  }

  /** 64 karakterlik SHA-256 hex özeti. Büyük/küçük harf fark etmez. */
  function isPasswordHash(value) {
    return /^[0-9a-f]{64}$/i.test(String(value || '').trim());
  }

  /**
   * Giriş karşılaştırması: kırpılmış düz metnin UTF-8 SHA-256 özeti (küçük harf hex).
   * Girdi zaten özet gibi görünse bile yeniden özetlenir; özeti yapıştırmak giriş sayılmaz.
   */
  async function digestPassword(plain) {
    const text = String(plain ?? '').trim();
    if (!text) return '';
    if (!global.crypto?.subtle?.digest) {
      throw new Error('Web Crypto SHA-256 kullanılamıyor');
    }
    const data = new TextEncoder().encode(text);
    const buf = await global.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  /** Kayıt: özet ise olduğu gibi (küçük harf), değilse digestPassword. Çift özet yazılmaz. */
  async function passwordForStorage(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (isPasswordHash(text)) return text.toLowerCase();
    return digestPassword(text);
  }

  async function hasUserSession() {
    const sb = getClient();
    if (!sb?.auth?.getSession) return false;
    try {
      const session = await sb.auth.getSession();
      return !!(session && session.data && session.data.session && session.data.session.access_token);
    } catch (err) {
      return false;
    }
  }

  /**
   * firmalar + banka hesaplarını mevcut `companies` nesnesine merge eder.
   * Oturum yoksa anon anahtarla firma satırı okunmaz. Yerel kart kalır.
   */
  async function hydrateCompanies(companies) {
    const sb = getClient();
    if (!sb || !companies) return { ok: false, reason: lastError || 'no-client' };
    if (!(await hasUserSession())) return { ok: false, reason: 'no-auth-session' };

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
      lastError = safeError(err);
      console.warn('[BTD] Firma hydrate başarısız, yerel veri kullanılıyor:', lastError);
      return { ok: false, reason: lastError };
    }
  }

  /** Eski istemci parola karşılaştırması kapatıldı. Kimlik Supabase Auth'tadır. */
  async function fetchUserForLogin() {
    return null;
  }

  global.BtdSupabase = {
    getClient,
    isReady: () => ready && !!getClient(),
    getLastError: () => lastError,
    hasUserSession,
    hydrateCompanies,
    fetchUserForLogin,
    isPasswordHash,
    digestPassword,
    passwordForStorage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
