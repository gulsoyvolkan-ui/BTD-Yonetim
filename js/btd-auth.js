/**
 * Yeni giriş: Supabase Auth + sunucu üyeliği.
 * Oturumda sifre_hash, parola veya tc_no tutulmaz.
 * İstemcinin seçtiği rol yok sayılır. Firma, üyelik listesinin dışına çıkamaz.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BtdAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SESSION_KEYS = [
    'username', 'name', 'role', 'scope', 'companies', 'company', 'isGod', 'collar',
    'accessCritical', 'personnelId', 'dept', 'loginPortal', 'perms', 'lastActiveAt',
    'savedAt', 'authSource', 'dbId', 'authUserId', 'kiosk',
  ];

  function roleOf(user) {
    return String((user && (user.rol || user.role)) || 'Operatör');
  }

  function isServerMembership(user) {
    return !!(user && Array.isArray(user.firmalar));
  }

  function firmNames(user) {
    if (!user) return [];
    if (isServerMembership(user)) {
      return user.firmalar.map((firm) => {
        if (!firm) return '';
        return typeof firm === 'object' ? String(firm.ad || '') : String(firm);
      }).filter(Boolean);
    }
    return Array.isArray(user.companies) ? user.companies.filter(Boolean) : [];
  }

  function isGroupAdmin(user) {
    if (!user || roleOf(user) !== 'Yönetici') return false;
    if (isServerMembership(user)) return user.tum_grup === true;
    return user.scope === 'Tüm Grup';
  }

  function allowedCompanies(user, known) {
    const names = firmNames(user).filter((name) => name && name !== 'BTD Yönetim');
    const pool = (known || []).filter((name) => name && name !== 'BTD Yönetim');
    const inPool = (list) => (pool.length ? list.filter((name) => pool.indexOf(name) !== -1) : list);
    if (!isGroupAdmin(user)) return inPool(names);
    if (names.length) return inPool(names);
    return pool;
  }

  function pickCompany(user, requested, known) {
    const allowed = allowedCompanies(user, known);
    if (!allowed.length) return null;
    if (requested && requested !== 'BTD Yönetim' && allowed.indexOf(requested) !== -1) return requested;
    if (isGroupAdmin(user) && allowed.indexOf('Bluemac') !== -1) return 'Bluemac';
    return allowed[0];
  }

  function collarOf(user) {
    const raw = user && (user.collar || user.yaka);
    if (raw === 'blue' || raw === 'mavi') return 'blue';
    if (raw === 'manager' || raw === 'yonetici' || raw === 'yönetici') return 'manager';
    return 'white';
  }

  function shopPerms() {
    const modules = [
      'Maliyet', 'Teklifler', 'Siparişler', 'İş Emirleri', 'Tedarik', 'İmalat',
      'Fason Takip', 'Kalite Kontrol', 'Sevkiyat', 'Faturalandırma', 'Müşteriler',
      'Tedarikçiler', 'Stok',
    ];
    const perms = {};
    modules.forEach((name) => {
      perms[name] = { view: true, edit: false, delete: false, export: false };
    });
    return perms;
  }

  function buildSession(user, requestedCompany, options) {
    const opts = options || {};
    if (!user || typeof user !== 'object') return null;
    const known = Array.isArray(opts.knownCompanies) ? opts.knownCompanies : [];
    const company = pickCompany(user, requestedCompany, known);
    if (!company) return null;
    const group = isGroupAdmin(user);
    const names = group ? allowedCompanies(user, known) : firmNames(user).filter((name) => name === company || allowedCompanies(user, known).indexOf(name) !== -1);
    const session = {
      name: user.ad_soyad || user.name || user.kullanici_adi || user.username || '',
      username: user.kullanici_adi || user.username || '',
      role: roleOf(user),
      scope: group ? 'Tüm Grup' : company,
      companies: names.length ? names : [company],
      company: company,
      isGod: group,
      collar: collarOf(user),
      accessCritical: group || !!(user.erisim_kritik || user.accessCritical),
      personnelId: user.personnelId || null,
      dept: user.dept || '',
      loginPortal: opts.portal === 'kiosk' ? 'kiosk' : 'desktop',
      perms: user.perms && typeof user.perms === 'object' ? user.perms : null,
      dbId: user.kullanici_id || user.dbId || null,
      authUserId: user.auth_user_id || user.authUserId || null,
      kiosk: false,
    };
    if (opts.requestedRole) {
      session.role = roleOf(user);
    }
    if (opts.portal === 'kiosk') {
      session.isGod = false;
      session.scope = company;
      session.companies = [company];
      session.company = company;
      session.accessCritical = false;
      session.role = 'Operatör';
      session.perms = shopPerms();
      session.kiosk = true;
      session.loginPortal = 'kiosk';
    }
    return sanitizeSession(session);
  }

  function sanitizeSession(payload) {
    const source = payload || {};
    const out = {};
    SESSION_KEYS.forEach((key) => {
      if (source[key] !== undefined) out[key] = source[key];
    });
    return out;
  }

  const SESSION_KEY = 'btd_auth_session_v2';
  const LEGACY_SESSION_KEYS = ['btd_auth_session_v1'];
  const PERSONNEL_COLUMNS_BASE = [
    'id', 'firma_id', 'personel_kodu', 'ad_soyad', 'departman', 'yaka',
    'ise_baslama', 'durum', 'telefon', 'eposta', 'adres',
  ].join(',');
  const PERSONNEL_COLUMNS = [
    'id', 'firma_id', 'personel_kodu', 'ad_soyad', 'departman', 'yaka',
    'ise_baslama', 'durum', 'telefon', 'whatsapp', 'eposta', 'adres',
    'yillik_izin_hakedis', 'yillik_planlanan_izin', 'foto',
  ].join(',');
  const USER_WRITE_DENIED = [
    'sifre_hash', 'password', 'tc_no', 'tcNo', 'rol', 'role', 'is_god', 'isGod', 'tum_grup',
  ];

  function acceptStoredSession(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.v !== 2 || raw.authSource !== 'supabase-auth') return false;
    if (raw.password || raw.sifre_hash || raw.tc_no || raw.tcNo) return false;
    return true;
  }

  function canReadSensitive(session) {
    if (!session || session.kiosk) return false;
    if (session.authSource && session.authSource !== 'supabase-auth') return false;
    if (session.role === 'Yönetici') return true;
    return session.accessCritical === true || session.erisim_kritik === true;
  }

  function membershipHasSecrets(membership) {
    if (!membership || typeof membership !== 'object') return false;
    return ['sifre_hash', 'password', 'tc_no', 'tcNo', 'access_token', 'refresh_token']
      .some((key) => Object.prototype.hasOwnProperty.call(membership, key));
  }

  async function signInWithSupabase(identifier, password) {
    const email = String(identifier || '').trim();
    if (!email.includes('@')) return { ok: false, code: 'not-email' };
    const client = globalThis.BtdSupabase && globalThis.BtdSupabase.getClient
      ? globalThis.BtdSupabase.getClient()
      : null;
    if (!client || !client.auth || !client.auth.signInWithPassword) {
      return { ok: false, code: 'unavailable' };
    }
    let result;
    try {
      result = await client.auth.signInWithPassword({ email: email, password: password });
    } catch (err) {
      return { ok: false, code: 'unavailable' };
    }
    if (!result || result.error || !result.data || !result.data.session) {
      const status = result && result.error ? result.error.status : 0;
      if (status >= 500) return { ok: false, code: 'unavailable' };
      return { ok: false, code: 'rejected' };
    }
    let rpc;
    try {
      rpc = await client.rpc('btd_oturum_baglami');
    } catch (err) {
      try { await client.auth.signOut(); } catch (ignore) { /* oturum kapanamadı */ }
      return { ok: false, code: 'unavailable' };
    }
    if (!rpc || rpc.error || !rpc.data || !rpc.data.kullanici_id || membershipHasSecrets(rpc.data)) {
      try { await client.auth.signOut(); } catch (ignore) { /* oturum kapanamadı */ }
      return { ok: false, code: 'unlinked' };
    }
    return { ok: true, membership: rpc.data };
  }

  async function restoreMembership() {
    const client = globalThis.BtdSupabase && globalThis.BtdSupabase.getClient
      ? globalThis.BtdSupabase.getClient()
      : null;
    if (!client || !client.auth || !client.auth.getSession) return null;
    let session;
    try {
      session = await client.auth.getSession();
    } catch (err) {
      return null;
    }
    if (!session || session.error || !session.data || !session.data.session) return null;
    let rpc;
    try {
      rpc = await client.rpc('btd_oturum_baglami');
    } catch (err) {
      return null;
    }
    if (!rpc || rpc.error || !rpc.data || !rpc.data.kullanici_id || membershipHasSecrets(rpc.data)) return null;
    return rpc.data;
  }

  return {
    SESSION_KEYS,
    SESSION_KEY,
    LEGACY_SESSION_KEYS,
    PERSONNEL_COLUMNS,
    PERSONNEL_COLUMNS_BASE,
    USER_WRITE_DENIED,
    acceptStoredSession,
    canReadSensitive,
    buildSession,
    sanitizeSession,
    signInWithSupabase,
    restoreMembership,
    isGroupAdmin,
    pickCompany,
  };
});
