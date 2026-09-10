/**
 * BTD · Finans & Nakit Akışı
 * Yerel cache + opsiyonel Supabase tabloları (finans_varliklar / kategoriler / hareketler)
 */
(function (global) {
  'use strict';

  const CACHE_KEY = 'btd_finans_cache_v1';

  const DEFAULT_ASSETS = [
    { kod: 'technomac', ad: 'Technomac', tip: 'sirket', sira: 10 },
    { kod: 'bluemac', ad: 'Bluemac', tip: 'sirket', sira: 20 },
    { kod: 'devorias', ad: 'Devorias', tip: 'sirket', sira: 30 },
    { kod: 'btd_core', ad: 'BTD Core', tip: 'grup', sira: 40 },
    { kod: 'kisisel_volkan', ad: 'Kisisel (Volkan)', tip: 'kisisel', sira: 50 },
  ];

  const DEFAULT_CATEGORIES = [
    { ad: 'Uretim', islem_yonu: 'BOTH', sira: 10 },
    { ad: 'Sabit Gider', islem_yonu: 'GIDER', sira: 20 },
    { ad: 'Kredi', islem_yonu: 'GIDER', sira: 30 },
    { ad: 'Cek/Senet', islem_yonu: 'BOTH', sira: 40 },
    { ad: 'Yatirim', islem_yonu: 'BOTH', sira: 50 },
    { ad: 'Kisisel Harcama', islem_yonu: 'GIDER', sira: 60 },
    { ad: 'Satis Geliri', islem_yonu: 'GELIR', sira: 70 },
    { ad: 'Hizmet Geliri', islem_yonu: 'GELIR', sira: 80 },
    { ad: 'Personel', islem_yonu: 'GIDER', sira: 90 },
    { ad: 'Vergi/SGK', islem_yonu: 'GIDER', sira: 100 },
    { ad: 'Kira', islem_yonu: 'GIDER', sira: 110 },
    { ad: 'Diger', islem_yonu: 'BOTH', sira: 200 },
  ];

  const PAY_METHODS = ['Nakit', 'Havale/EFT', 'Kredi Karti', 'Cek', 'Senet', 'Kredi Taksiti'];
  const STATUSES = ['Bekliyor', 'Odendi', 'Tahsil Edildi', 'Iptal'];
  const PERIODS = ['Gunluk', 'Haftalik', 'Aylik', 'Uc Aylik', 'Yillik'];

  function uid(prefix) {
    return `${prefix || 'FN'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') || null;
    } catch (_) {
      return null;
    }
  }

  function saveCache(state) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        at: Date.now(),
        assets: state.assets || [],
        categories: state.categories || [],
        moves: state.moves || [],
      }));
    } catch (_) { /* ignore */ }
  }

  function ensureLocalSeed(state) {
    if (!state.assets.length) {
      state.assets = DEFAULT_ASSETS.map((a) => ({
        id: uid('FA'),
        kod: a.kod,
        ad: a.ad,
        tip: a.tip,
        sira: a.sira,
        aktif: true,
      }));
    }
    if (!state.categories.length) {
      state.categories = DEFAULT_CATEGORIES.map((c) => ({
        id: uid('FK'),
        varlik_id: null,
        ad: c.ad,
        islem_yonu: c.islem_yonu,
        sira: c.sira,
        aktif: true,
      }));
    }
    return state;
  }

  function createStore() {
    const cached = loadCache();
    const state = ensureLocalSeed({
      assets: Array.isArray(cached?.assets) ? cached.assets.slice() : [],
      categories: Array.isArray(cached?.categories) ? cached.categories.slice() : [],
      moves: Array.isArray(cached?.moves) ? cached.moves.slice() : [],
    });
    saveCache(state);
    return state;
  }

  function getClient() {
    try {
      if (global.BtdSupabase && typeof global.BtdSupabase.getClient === 'function') {
        return global.BtdSupabase.getClient();
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  async function hydrateFromCloud(state) {
    const client = getClient();
    if (!client) return { ok: false, reason: 'no-client' };
    try {
      const [a, c, m] = await Promise.all([
        client.from('finans_varliklar').select('*').eq('aktif', true).order('sira'),
        client.from('finans_kategoriler').select('*').eq('aktif', true).order('sira'),
        client.from('finans_hareketler').select('*').order('islem_tarihi', { ascending: false }).limit(2000),
      ]);
      if (a.error && /does not exist|relation/i.test(a.error.message || '')) {
        return { ok: false, reason: 'no-table' };
      }
      if (!a.error && Array.isArray(a.data) && a.data.length) {
        state.assets = a.data.map((row) => ({
          id: row.id,
          kod: row.kod,
          ad: row.ad,
          tip: row.tip,
          sira: row.sira,
          aktif: row.aktif !== false,
          firma_id: row.firma_id || null,
        }));
      }
      if (!c.error && Array.isArray(c.data) && c.data.length) {
        state.categories = c.data.map((row) => ({
          id: row.id,
          varlik_id: row.varlik_id || null,
          ad: row.ad,
          islem_yonu: row.islem_yonu || 'BOTH',
          sira: row.sira,
          aktif: row.aktif !== false,
        }));
      }
      if (!m.error && Array.isArray(m.data)) {
        const byId = new Map(state.moves.map((x) => [x.id, x]));
        m.data.forEach((row) => {
          byId.set(row.id, {
            id: row.id,
            varlik_id: row.varlik_id,
            islem_tipi: row.islem_tipi,
            kategori_id: row.kategori_id,
            tutar: Number(row.tutar) || 0,
            para_birimi: row.para_birimi || 'TRY',
            islem_tarihi: row.islem_tarihi,
            vade_tarihi: row.vade_tarihi || null,
            odeme_yontemi: row.odeme_yontemi || 'Havale/EFT',
            durum: row.durum || 'Bekliyor',
            tekrar_eden: !!row.tekrar_eden,
            tekrar_periyodu: row.tekrar_periyodu || null,
            aciklama: row.aciklama || '',
            bagli_is_emri_id: row.bagli_is_emri_id || null,
          });
        });
        state.moves = Array.from(byId.values());
      }
      ensureLocalSeed(state);
      saveCache(state);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e?.message || String(e) };
    }
  }

  function monthBounds(d) {
    const x = d instanceof Date ? d : new Date();
    const start = new Date(x.getFullYear(), x.getMonth(), 1);
    const end = new Date(x.getFullYear(), x.getMonth() + 1, 0);
    const iso = (dt) => dt.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
  }

  function filterMoves(state, varlikId) {
    return (state.moves || []).filter((m) => {
      if (!m || m.durum === 'Iptal') return false;
      if (varlikId && m.varlik_id !== varlikId) return false;
      return true;
    });
  }

  function kpiForAsset(state, varlikId) {
    const { start, end } = monthBounds(new Date());
    const list = filterMoves(state, varlikId).filter((m) => {
      const t = m.islem_tarihi || '';
      return t >= start && t <= end;
    });
    let gelir = 0;
    let gider = 0;
    list.forEach((m) => {
      const realized = m.durum === 'Odendi' || m.durum === 'Tahsil Edildi' || m.durum === 'Bekliyor';
      // KPI: bu ay kaydı (bekleyen dahil) — net için gerçekleşen ağırlıklı
      if (m.islem_tipi === 'GELIR') gelir += Number(m.tutar) || 0;
      if (m.islem_tipi === 'GIDER') gider += Number(m.tutar) || 0;
      void realized;
    });
    const upcoming = upcomingDue(state, varlikId, 30);
    return {
      gelir,
      gider,
      net: gelir - gider,
      upcomingCount: upcoming.length,
      upcomingTotal: upcoming.reduce((s, m) => s + (Number(m.tutar) || 0), 0),
    };
  }

  function riskLevel(vade) {
    if (!vade) return 'ileri';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(vade + 'T00:00:00');
    const diff = Math.round((d - today) / 86400000);
    if (diff < 0) return 'gecikmis';
    if (diff <= 7) return 'kritik';
    if (diff <= 30) return 'yakin';
    return 'ileri';
  }

  function upcomingDue(state, varlikId, withinDays) {
    const days = withinDays == null ? 45 : withinDays;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + days);
    return filterMoves(state, varlikId)
      .filter((m) => m.durum === 'Bekliyor' && m.vade_tarihi)
      .filter((m) => {
        const d = new Date(m.vade_tarihi + 'T00:00:00');
        return d <= limit;
      })
      .sort((a, b) => String(a.vade_tarihi).localeCompare(String(b.vade_tarihi)))
      .map((m) => Object.assign({}, m, { risk: riskLevel(m.vade_tarihi) }));
  }

  function categoriesFor(state, tip, varlikId) {
    return (state.categories || []).filter((c) => {
      if (!c || c.aktif === false) return false;
      if (c.varlik_id && varlikId && c.varlik_id !== varlikId) return false;
      if (c.varlik_id && !varlikId) return false;
      if (tip === 'GELIR' && c.islem_yonu === 'GIDER') return false;
      if (tip === 'GIDER' && c.islem_yonu === 'GELIR') return false;
      return true;
    }).sort((a, b) => (a.sira || 0) - (b.sira || 0));
  }

  async function addMove(state, payload) {
    const row = {
      id: payload.id || uid('FH'),
      varlik_id: payload.varlik_id,
      islem_tipi: payload.islem_tipi,
      kategori_id: payload.kategori_id || null,
      tutar: Math.abs(Number(payload.tutar) || 0),
      para_birimi: payload.para_birimi || 'TRY',
      islem_tarihi: payload.islem_tarihi || new Date().toISOString().slice(0, 10),
      vade_tarihi: payload.vade_tarihi || null,
      odeme_yontemi: payload.odeme_yontemi || 'Havale/EFT',
      durum: payload.durum || 'Bekliyor',
      tekrar_eden: !!payload.tekrar_eden,
      tekrar_periyodu: payload.tekrar_periyodu || null,
      aciklama: payload.aciklama || '',
      bagli_is_emri_id: payload.bagli_is_emri_id || null,
    };
    if (!row.varlik_id) return { ok: false, reason: 'varlik-zorunlu' };
    if (!row.islem_tipi || !['GELIR', 'GIDER'].includes(row.islem_tipi)) return { ok: false, reason: 'tip-zorunlu' };
    if (!(row.tutar > 0)) return { ok: false, reason: 'tutar-zorunlu' };

    state.moves.unshift(row);
    saveCache(state);

    const client = getClient();
    if (client) {
      try {
        const { error } = await client.from('finans_hareketler').upsert({
          id: row.id,
          varlik_id: row.varlik_id,
          islem_tipi: row.islem_tipi,
          kategori_id: row.kategori_id,
          tutar: row.tutar,
          para_birimi: row.para_birimi,
          islem_tarihi: row.islem_tarihi,
          vade_tarihi: row.vade_tarihi,
          odeme_yontemi: row.odeme_yontemi,
          durum: row.durum,
          tekrar_eden: row.tekrar_eden,
          tekrar_periyodu: row.tekrar_periyodu,
          aciklama: row.aciklama,
          bagli_is_emri_id: row.bagli_is_emri_id,
        });
        if (error) return { ok: true, local: true, cloud: false, reason: error.message, row };
        return { ok: true, local: true, cloud: true, row };
      } catch (e) {
        return { ok: true, local: true, cloud: false, reason: e?.message || String(e), row };
      }
    }
    return { ok: true, local: true, cloud: false, row };
  }

  async function markStatus(state, id, durum) {
    const row = (state.moves || []).find((m) => m.id === id);
    if (!row) return { ok: false, reason: 'not-found' };
    row.durum = durum;
    saveCache(state);
    const client = getClient();
    if (client) {
      try {
        const { error } = await client.from('finans_hareketler').update({ durum }).eq('id', id);
        if (error) return { ok: true, cloud: false, reason: error.message, row };
        return { ok: true, cloud: true, row };
      } catch (e) {
        return { ok: true, cloud: false, reason: e?.message || String(e), row };
      }
    }
    return { ok: true, cloud: false, row };
  }

  function money(n, cur) {
    const v = Number(n) || 0;
    const suffix = cur === 'USD' ? ' $' : cur === 'EUR' ? ' €' : ' ₺';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
  }

  global.BtdFinans = {
    CACHE_KEY,
    PAY_METHODS,
    STATUSES,
    PERIODS,
    DEFAULT_ASSETS,
    createStore,
    hydrateFromCloud,
    saveCache,
    kpiForAsset,
    upcomingDue,
    categoriesFor,
    addMove,
    markStatus,
    filterMoves,
    riskLevel,
    money,
    monthBounds,
  };
})(typeof window !== 'undefined' ? window : globalThis);
