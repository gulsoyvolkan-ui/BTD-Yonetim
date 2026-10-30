/**
 * BTD · Paraşüt istemci iskeleti (tarayıcı)
 * Secret yok — Edge Function + Ayarlar company_id kullanır.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'btd_parasut_cfg_v1';

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }
  function saveAll(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj || {}));
    } catch (_) { /* ignore */ }
  }

  function getConfig(companyName) {
    const all = loadAll();
    return all[companyName] || { parasutCompanyId: '', status: 'bekliyor', note: '', lastCheckAt: null };
  }
  function setConfig(companyName, patch) {
    const all = loadAll();
    all[companyName] = Object.assign({}, getConfig(companyName), patch || {}, { updatedAt: new Date().toISOString() });
    saveAll(all);
    return all[companyName];
  }

  async function edgeStatus() {
    const base = global.BTD_SUPABASE?.url;
    const key = global.BTD_SUPABASE?.anonKey;
    if (!base || !key) return { ok: false, reason: 'no-supabase', configured: false };
    try {
      const res = await fetch(`${base}/functions/v1/parasut-oauth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
        body: JSON.stringify({ action: 'status' }),
      });
      const json = await res.json().catch(() => ({}));
      return Object.assign({ http: res.status }, json);
    } catch (e) {
      return { ok: false, configured: false, reason: e?.message || String(e) };
    }
  }

  global.BtdParasut = {
    getConfig,
    setConfig,
    edgeStatus,
    STORAGE_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
