/**
 * BTD Yönetim · Supabase sync katmanı (CRM + belgeler + kataloglar)
 * Dual-ID: UI id/belge_no korunur; UUID → dbId.
 * Hata asla UI'ya fırlatılmaz → { ok:false } + console.warn
 */
(function (global) {
  'use strict';

  const CURRENCY_TO_DB = { '₺': 'TRY', '€': 'EUR', '$': 'USD', '£': 'GBP', TRY: 'TRY', EUR: 'EUR', USD: 'USD', GBP: 'GBP' };
  const CURRENCY_TO_UI = { TRY: '₺', EUR: '€', USD: '$', GBP: '£', '₺': '₺', '€': '€', '$': '$', '£': '£' };
  const PROTECTED_USERS = new Set(['volkan', 'ahmet']);
  const SEED_FLAG = 'btd_cloud_seeded_v1';

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function alreadySeeded() {
    try { return localStorage.getItem(SEED_FLAG) === '1'; } catch (_) { return false; }
  }
  function markSeeded() {
    try { localStorage.setItem(SEED_FLAG, '1'); } catch (_) { /* ignore */ }
  }
  function currencyToDb(sym) {
    if (!sym) return 'EUR';
    return CURRENCY_TO_DB[sym] || CURRENCY_TO_DB[String(sym).toUpperCase()] || String(sym).toUpperCase();
  }
  function currencyToUi(code) {
    if (!code) return '€';
    return CURRENCY_TO_UI[code] || CURRENCY_TO_UI[String(code).toUpperCase()] || code;
  }
  function firmaId(companies, name) {
    if (!companies || !name) return null;
    return companies[name]?.dbId || null;
  }
  function sb() {
    try {
      return global.BtdSupabase?.getClient?.() || null;
    } catch (e) {
      console.warn('[BtdCloud] sb()', e);
      return null;
    }
  }
  function progress(ctx, msg) {
    try { ctx?.onProgress?.(msg); } catch (_) { /* ignore */ }
    console.info('[BtdCloud]', msg);
  }
  function fail(err, label) {
    const msg = err?.message || String(err);
    console.warn(`[BtdCloud] ${label || 'hata'}:`, msg);
    return { ok: false, reason: msg };
  }
  function ok(extra) {
    return Object.assign({ ok: true }, extra || {});
  }
  function replaceArray(target, rows) {
    if (!Array.isArray(target)) return;
    target.length = 0;
    (rows || []).forEach((r) => target.push(r));
  }
  /**
   * İlk seed sonrası boş tabloları tekrar demo veriyle doldurmayı engeller.
   * Diziyi silmez — yerel/cache kayıtları (yeni eklenen, henüz buluta yazılamayan) korunur.
   */
  function blockReseed(/* arr */) {
    return alreadySeeded();
  }
  async function deleteBelgeRow(table, entity, companies, label) {
    try {
      const client = sb();
      if (!client || !entity) return fail('no-client', label);
      if (entity.dbId) {
        const { error } = await client.from(table).delete().eq('id', entity.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, entity.company);
      if (fid && entity.id) {
        const { error } = await client.from(table).delete().eq('firma_id', fid).eq('belge_no', entity.id);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', label);
    } catch (e) {
      return fail(e, label);
    }
  }
  function assignObject(target, src) {
    if (!target || !src || typeof target !== 'object') return;
    Object.keys(target).forEach((k) => { delete target[k]; });
    Object.assign(target, src);
  }
  function companyNameById(companies, id) {
    if (!companies || !id) return null;
    for (const [name, c] of Object.entries(companies)) {
      if (c?.dbId === id) return name;
    }
    return null;
  }
  function collarToDb(c) {
    if (c === 'blue' || c === 'mavi') return 'blue';
    if (c === 'manager' || c === 'yonetici' || c === 'yönetici') return 'manager';
    return 'white';
  }
  function collarToUi(c) {
    if (c === 'blue' || c === 'mavi') return 'blue';
    if (c === 'manager' || c === 'yonetici' || c === 'yönetici') return 'manager';
    return 'white';
  }
  async function countTable(client, table) {
    const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  }
  async function selectAll(client, table, select, orderCol) {
    let q = client.from(table).select(select || '*');
    if (orderCol) q = q.order(orderCol);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // ─── Material group cache ──────────────────────────────────────────────────
  let _groupCache = null; // { name → id }
  async function ensureMaterialGroups(client, names) {
    if (!_groupCache) {
      const rows = await selectAll(client, 'malzeme_gruplari', 'id, ad');
      _groupCache = {};
      rows.forEach((r) => { _groupCache[r.ad] = r.id; });
    }
    const missing = (names || []).filter((n) => n && !_groupCache[n]);
    if (missing.length) {
      const { data, error } = await client
        .from('malzeme_gruplari')
        .upsert(missing.map((ad, i) => ({ ad, sira: Object.keys(_groupCache).length + i })), { onConflict: 'ad' })
        .select('id, ad');
      if (error) throw error;
      (data || []).forEach((r) => { _groupCache[r.ad] = r.id; });
    }
    return _groupCache;
  }
  function groupId(name) {
    return (_groupCache && name) ? _groupCache[name] || null : null;
  }

  // ─── CRM · Customers ───────────────────────────────────────────────────────
  function customerToRow(c, fid) {
    return {
      firma_id: fid,
      unvan: c.name,
      kisa_ad: c.shortName || null,
      adres: c.address || null,
      telefon: c.phone || null,
      vergi_no: c.taxNo || null,
      vergi_dairesi: c.taxOffice || null,
      para_birimi: currencyToDb(c.currency),
      odeme_vadesi: c.paymentTerms || null,
      termin_gun: Number(c.leadTimeDays) || 15,
      imalat_tipi: c.manufacturingType || null,
      teklif_kosullari: c.quoteTerms || null,
      notify_whatsapp: !!(c.notifyPrefs?.whatsapp ?? true),
      notify_eposta: !!(c.notifyPrefs?.email ?? true),
      party_key: c.partyKey || null,
      intercompany: !!c.intercompany,
      kaynak: c.source || null,
      linked_tedarikci_id: c.linkedSupplierDbId || null,
      tl_bakiye: c.tlBalance == null || c.tlBalance === '' ? null : Number(c.tlBalance),
      cari_rol: c.cariRole || null,
    };
  }
  function customerFromRow(r, companies) {
    return {
      dbId: r.id,
      company: companyNameById(companies, r.firma_id) || '',
      name: r.unvan,
      shortName: r.kisa_ad || '',
      address: r.adres || '',
      phone: r.telefon || '',
      taxNo: r.vergi_no || '',
      taxOffice: r.vergi_dairesi || '',
      currency: currencyToUi(r.para_birimi),
      paymentTerms: r.odeme_vadesi || '30 gün',
      leadTimeDays: r.termin_gun ?? 15,
      manufacturingType: r.imalat_tipi || 'Malzemeli',
      quoteTerms: r.teklif_kosullari || '',
      notifyPrefs: { whatsapp: !!r.notify_whatsapp, email: !!r.notify_eposta },
      partyKey: r.party_key || '',
      intercompany: !!r.intercompany,
      source: r.kaynak || '',
      linkedSupplierDbId: r.linked_tedarikci_id || null,
      tlBalance: r.tl_bakiye == null ? null : Number(r.tl_bakiye),
      cariRole: r.cari_rol || '',
      contacts: (r.musteri_kisiler || []).map((k) => {
        const mobile = k.whatsapp || k.telefon || '';
        return {
          dbId: k.id,
          name: k.ad_soyad,
          department: k.departman || '',
          phone: mobile,
          email: k.eposta || '',
          whatsapp: mobile,
        };
      }),
    };
  }
  async function saveCustomer(c, companies) {
    try {
      const client = sb();
      if (!client || !c) return fail('no-client', 'saveCustomer');
      const fid = firmaId(companies, c.company);
      if (!fid) return fail('firma_id yok', 'saveCustomer');
      const row = customerToRow(c, fid);
      let dbId = c.dbId;
      if (dbId) {
        const { error } = await client.from('musteriler').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('musteriler')
          .upsert(row, { onConflict: 'firma_id,unvan' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        c.dbId = dbId;
      }
      await client.from('musteri_kisiler').delete().eq('musteri_id', dbId);
      const contacts = (c.contacts || []).filter((x) => x.name);
      if (contacts.length) {
        const { error: cErr } = await client.from('musteri_kisiler').insert(
          contacts.map((k, i) => {
            const mobile = k.whatsapp || k.phone || null;
            return {
              musteri_id: dbId,
              ad_soyad: k.name,
              departman: k.department || null,
              telefon: mobile,
              eposta: k.email || null,
              whatsapp: mobile,
              birincil: i === 0,
            };
          })
        );
        if (cErr) throw cErr;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveCustomer'); }
  }
  async function deleteCustomer(c, companies) {
    try {
      const client = sb();
      if (!client || !c) return fail('no-client', 'deleteCustomer');
      if (c.dbId) {
        const { error } = await client.from('musteriler').delete().eq('id', c.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, c.company);
      if (fid && c.name) {
        const { error } = await client.from('musteriler').delete().eq('firma_id', fid).eq('unvan', c.name);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deleteCustomer');
    } catch (e) { return fail(e, 'deleteCustomer'); }
  }
  async function hydrateCustomers(ctx) {
    const client = sb();
    if (!client || !ctx.customers) return;
    const n = await countTable(client, 'musteriler');
    if (!n) {
      if (blockReseed(ctx.customers)) return;
      if (ctx.customers.length) {
        progress(ctx, `Müşteriler seed (${ctx.customers.length})…`);
        for (const c of ctx.customers) await saveCustomer(c, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Müşteriler hydrate…');
    const rows = await selectAll(client, 'musteriler', '*, musteri_kisiler(*)');
    replaceArray(ctx.customers, rows.map((r) => customerFromRow(r, ctx.companies)));
  }

  // ─── CRM · Suppliers ───────────────────────────────────────────────────────
  function supplierToRow(s, fid) {
    return {
      firma_id: fid,
      unvan: s.name,
      kisa_ad: s.shortName || null,
      kategori: s.category || 'Hammadde',
      iletisim: s.contact || null,
      telefon: s.phone || null,
      whatsapp: s.whatsapp || null,
      eposta: s.email || null,
      adres: s.address || null,
      banka: s.bank || null,
      iban: s.iban || null,
      vergi_no: s.taxNo || null,
      vergi_dairesi: s.taxOffice || null,
      party_key: s.partyKey || null,
      intercompany: !!s.intercompany,
      kaynak: s.source || null,
      linked_musteri_id: s.linkedCustomerDbId || null,
      tl_bakiye: s.tlBalance == null || s.tlBalance === '' ? null : Number(s.tlBalance),
      cari_rol: s.cariRole || null,
    };
  }
  function supplierFromRow(r, companies) {
    return {
      dbId: r.id,
      company: companyNameById(companies, r.firma_id) || '',
      name: r.unvan,
      shortName: r.kisa_ad || '',
      category: r.kategori || 'Hammadde',
      contact: r.iletisim || '',
      phone: r.telefon || '',
      whatsapp: r.whatsapp || '',
      email: r.eposta || '',
      address: r.adres || '',
      bank: r.banka || '',
      iban: r.iban || '',
      taxNo: r.vergi_no || '',
      taxOffice: r.vergi_dairesi || '',
      partyKey: r.party_key || '',
      intercompany: !!r.intercompany,
      source: r.kaynak || '',
      linkedCustomerDbId: r.linked_musteri_id || null,
      tlBalance: r.tl_bakiye == null ? null : Number(r.tl_bakiye),
      cariRole: r.cari_rol || '',
      materialGroups: (r.tedarikci_malzeme_gruplari || [])
        .map((x) => x.malzeme_gruplari?.ad)
        .filter(Boolean),
      fasonServices: (r.tedarikci_fason_hizmetleri || [])
        .filter((x) => (x.hizmet_tipi || 'dis') !== 'imalat')
        .map((x) => x.hizmet_adi)
        .filter(Boolean),
      fasonMfgServices: (r.tedarikci_fason_hizmetleri || [])
        .filter((x) => x.hizmet_tipi === 'imalat')
        .map((x) => x.hizmet_adi)
        .filter(Boolean),
      contacts: (r.tedarikci_kisiler || []).map((k) => {
        const mobile = k.whatsapp || k.telefon || '';
        return {
          dbId: k.id,
          name: k.ad_soyad,
          department: k.departman || '',
          phone: mobile,
          email: k.eposta || '',
          whatsapp: mobile,
        };
      }),
    };
  }
  async function saveSupplier(s, companies) {
    try {
      const client = sb();
      if (!client || !s) return fail('no-client', 'saveSupplier');
      const fid = firmaId(companies, s.company);
      if (!fid) return fail('firma_id yok', 'saveSupplier');
      const groups = await ensureMaterialGroups(client, s.materialGroups || []);
      const row = supplierToRow(s, fid);
      let dbId = s.dbId;
      if (dbId) {
        const { error } = await client.from('tedarikciler').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('tedarikciler')
          .upsert(row, { onConflict: 'firma_id,unvan' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        s.dbId = dbId;
      }
      await client.from('tedarikci_kisiler').delete().eq('tedarikci_id', dbId);
      await client.from('tedarikci_malzeme_gruplari').delete().eq('tedarikci_id', dbId);
      await client.from('tedarikci_fason_hizmetleri').delete().eq('tedarikci_id', dbId);
      const contacts = (s.contacts || []).filter((x) => x.name);
      if (contacts.length) {
        const { error } = await client.from('tedarikci_kisiler').insert(
          contacts.map((k, i) => {
            const mobile = k.whatsapp || k.phone || null;
            return {
              tedarikci_id: dbId,
              ad_soyad: k.name,
              departman: k.department || null,
              telefon: mobile,
              eposta: k.email || null,
              whatsapp: mobile,
              birincil: i === 0,
            };
          })
        );
        if (error) throw error;
      }
      const mgs = (s.materialGroups || []).map((n) => groups[n]).filter(Boolean);
      if (mgs.length) {
        const { error } = await client.from('tedarikci_malzeme_gruplari').insert(
          mgs.map((gid) => ({ tedarikci_id: dbId, malzeme_grup_id: gid }))
        );
        if (error) throw error;
      }
      const services = [
        ...(s.fasonServices || []).filter(Boolean).map((h) => ({ tedarikci_id: dbId, hizmet_adi: h, hizmet_tipi: 'dis' })),
        ...(s.fasonMfgServices || []).filter(Boolean).map((h) => ({ tedarikci_id: dbId, hizmet_adi: h, hizmet_tipi: 'imalat' })),
      ];
      if (services.length) {
        const { error } = await client.from('tedarikci_fason_hizmetleri').insert(services);
        if (error) throw error;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveSupplier'); }
  }
  async function deleteSupplier(s, companies) {
    try {
      const client = sb();
      if (!client || !s) return fail('no-client', 'deleteSupplier');
      if (s.dbId) {
        const { error } = await client.from('tedarikciler').delete().eq('id', s.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, s.company);
      if (fid && s.name) {
        const { error } = await client.from('tedarikciler').delete().eq('firma_id', fid).eq('unvan', s.name);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deleteSupplier');
    } catch (e) { return fail(e, 'deleteSupplier'); }
  }
  async function hydrateSuppliers(ctx) {
    const client = sb();
    if (!client || !ctx.suppliers) return;
    await ensureMaterialGroups(client, []);
    const n = await countTable(client, 'tedarikciler');
    if (!n) {
      if (blockReseed(ctx.suppliers)) return;
      if (ctx.suppliers.length) {
        progress(ctx, `Tedarikçiler seed (${ctx.suppliers.length})…`);
        for (const s of ctx.suppliers) await saveSupplier(s, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Tedarikçiler hydrate…');
    const rows = await selectAll(
      client,
      'tedarikciler',
      '*, tedarikci_kisiler(*), tedarikci_fason_hizmetleri(*), tedarikci_malzeme_gruplari(malzeme_grup_id, malzeme_gruplari(ad))'
    );
    replaceArray(ctx.suppliers, rows.map((r) => supplierFromRow(r, ctx.companies)));
  }

  async function saveSupplierGroupPriorities(company, prioritiesObj, companies, suppliers) {
    try {
      const client = sb();
      if (!client) return fail('no-client', 'saveSupplierGroupPriorities');
      const fid = firmaId(companies, company);
      if (!fid) return fail('firma_id yok', 'saveSupplierGroupPriorities');
      const groupNames = Object.keys(prioritiesObj || {});
      const groups = await ensureMaterialGroups(client, groupNames);
      await client.from('tedarikci_grup_oncelikleri').delete().eq('firma_id', fid);
      const rows = [];
      for (const [gName, list] of Object.entries(prioritiesObj || {})) {
        const gid = groups[gName];
        if (!gid) continue;
        for (const entry of list || []) {
          const s = (suppliers || []).find((x) => x.company === company && x.name === entry.name);
          let tid = s?.dbId;
          if (!tid && s) {
            const r = await saveSupplier(s, companies);
            tid = r.dbId || s.dbId;
          }
          if (!tid) continue;
          rows.push({
            firma_id: fid,
            malzeme_grup_id: gid,
            tedarikci_id: tid,
            oncelik: Number(entry.priority) || 1,
          });
        }
      }
      if (rows.length) {
        const { error } = await client.from('tedarikci_grup_oncelikleri').insert(rows);
        if (error) throw error;
      }
      return ok({ count: rows.length });
    } catch (e) { return fail(e, 'saveSupplierGroupPriorities'); }
  }
  async function hydrateSupplierGroupPriorities(ctx) {
    const client = sb();
    if (!client || !ctx.supplierGroupPriorities) return;
    const { count, error: cErr } = await client
      .from('tedarikci_grup_oncelikleri')
      .select('id', { count: 'exact', head: true });
    if (cErr) throw cErr;
    if (!count) {
      for (const company of Object.keys(ctx.supplierGroupPriorities)) {
        await saveSupplierGroupPriorities(
          company,
          ctx.supplierGroupPriorities[company],
          ctx.companies,
          ctx.suppliers
        );
      }
      return;
    }
    progress(ctx, 'Tedarikçi öncelikleri hydrate…');
    await ensureMaterialGroups(client, []);
    const rows = await selectAll(
      client,
      'tedarikci_grup_oncelikleri',
      'firma_id, oncelik, malzeme_gruplari(ad), tedarikciler(unvan)'
    );
    const out = {};
    rows.forEach((r) => {
      const company = companyNameById(ctx.companies, r.firma_id);
      const g = r.malzeme_gruplari?.ad;
      const name = r.tedarikciler?.unvan;
      if (!company || !g || !name) return;
      (out[company] ||= {})[g] ||= [];
      out[company][g].push({ name, priority: r.oncelik });
    });
    Object.values(out).forEach((byG) => {
      Object.keys(byG).forEach((g) => byG[g].sort((a, b) => a.priority - b.priority));
    });
    assignObject(ctx.supplierGroupPriorities, out);
  }

  // ─── Personnel / Users ─────────────────────────────────────────────────────
  async function savePersonnel(p, companies) {
    try {
      const client = sb();
      if (!client || !p) return fail('no-client', 'savePersonnel');
      const fid = firmaId(companies, p.company);
      if (!fid) return fail('firma_id yok', 'savePersonnel');
      const row = {
        firma_id: fid,
        personel_kodu: p.id || null,
        ad_soyad: p.name,
        departman: p.dept || null,
        yaka: collarToDb(p.collar),
        ise_baslama: p.startDate || null,
        maas: p.salary != null ? Number(p.salary) : null,
        durum: p.status || 'Aktif',
        tc_no: p.tcNo || null,
        telefon: p.phone || p.whatsapp || null,
        whatsapp: p.whatsapp || p.phone || null,
        eposta: p.email || null,
        adres: p.address || null,
        yillik_izin_hakedis: p.leaveEntitle != null ? Number(p.leaveEntitle) : 14,
        yillik_planlanan_izin: p.leavePlanned != null ? Number(p.leavePlanned) : 0,
        foto: p.photo || null,
      };
      if (p.dbId) {
        const { error } = await client.from('personel').update(row).eq('id', p.dbId);
        if (error) throw error;
        return ok({ dbId: p.dbId });
      }
      const { data, error } = await client.from('personel').insert(row).select('id').single();
      if (error) throw error;
      p.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'savePersonnel'); }
  }
  async function deletePersonnel(p, companies) {
    try {
      const client = sb();
      if (!client || !p) return fail('no-client', 'deletePersonnel');
      if (p.dbId) {
        const { error } = await client.from('personel').delete().eq('id', p.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, p.company);
      if (fid && p.id) {
        const { error } = await client.from('personel').delete().eq('firma_id', fid).eq('personel_kodu', p.id);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deletePersonnel');
    } catch (e) { return fail(e, 'deletePersonnel'); }
  }
  async function hydratePersonnel(ctx) {
    const client = sb();
    if (!client || !ctx.personnel) return;
    const n = await countTable(client, 'personel');
    if (!n) {
      if (blockReseed(ctx.personnel)) return;
      if (ctx.personnel.length) {
        progress(ctx, `Personel seed (${ctx.personnel.length})…`);
        for (const p of ctx.personnel) await savePersonnel(p, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Personel hydrate…');
    const rows = await selectAll(client, 'personel', '*');
    replaceArray(ctx.personnel, rows.map((r) => {
      const mobile = r.whatsapp || r.telefon || '';
      return {
        dbId: r.id,
        id: r.personel_kodu || r.id,
        company: companyNameById(ctx.companies, r.firma_id) || '',
        name: r.ad_soyad,
        dept: r.departman || '',
        collar: collarToUi(r.yaka),
        startDate: r.ise_baslama || '',
        salary: Number(r.maas) || 0,
        status: r.durum || 'Aktif',
        tcNo: r.tc_no || '',
        phone: mobile,
        whatsapp: mobile,
        email: r.eposta || '',
        address: r.adres || '',
        leaveEntitle: r.yillik_izin_hakedis != null ? Number(r.yillik_izin_hakedis) : 14,
        leavePlanned: r.yillik_planlanan_izin != null ? Number(r.yillik_planlanan_izin) : 0,
        photo: r.foto || '',
        userId: null,
      };
    }));
  }
  async function hydrateAttendanceLeave(ctx) {
    const client = sb();
    if (!client) return;
    if (ctx.attendanceLogs) {
      const { count } = await client.from('personel_devam').select('id', { count: 'exact', head: true });
      if (!count && ctx.attendanceLogs.length) {
        if (blockReseed(ctx.attendanceLogs)) {
          /* canlı kurulumda boş tabloya demo devam yazma */
        } else {
        progress(ctx, 'Devam seed…');
        const byCode = Object.fromEntries((ctx.personnel || []).map((p) => [p.id, p.dbId]));
        const rows = ctx.attendanceLogs
          .map((a) => {
            const pid = byCode[a.personnelId] || a.dbPersonnelId;
            const fid = firmaId(ctx.companies, a.company);
            if (!pid || !fid) return null;
            return {
              firma_id: fid,
              personel_id: pid,
              tarih: a.date,
              giris: a.checkIn || null,
              cikis: a.checkOut || null,
              calisma_saat: a.workedHours ?? null,
              mesai_tipi: a.overtimeType || 'none',
              mesai_saat: a.overtimeHours || 0,
              zamaninda: a.onTime !== false,
            };
          })
          .filter(Boolean);
        if (rows.length) await client.from('personel_devam').upsert(rows, { onConflict: 'personel_id,tarih' });
        }
      } else if (count) {
        const rows = await selectAll(client, 'personel_devam', '*');
        const byDb = Object.fromEntries((ctx.personnel || []).map((p) => [p.dbId, p]));
        replaceArray(ctx.attendanceLogs, rows.map((r) => ({
          dbId: r.id,
          id: `A-${r.id.slice(0, 8)}`,
          personnelId: byDb[r.personel_id]?.id || r.personel_id,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          date: r.tarih,
          checkIn: r.giris || '',
          checkOut: r.cikis || '',
          workedHours: Number(r.calisma_saat) || 0,
          overtimeType: r.mesai_tipi || 'none',
          overtimeHours: Number(r.mesai_saat) || 0,
          onTime: r.zamaninda !== false,
        })));
      }
    }
    if (ctx.leaveRequests) {
      const { count } = await client.from('personel_izin').select('id', { count: 'exact', head: true });
      if (!count && ctx.leaveRequests.length) {
        if (blockReseed(ctx.leaveRequests)) {
          /* canlı kurulumda boş tabloya demo izin yazma */
        } else {
        progress(ctx, 'İzin seed…');
        const byCode = Object.fromEntries((ctx.personnel || []).map((p) => [p.id, p.dbId]));
        const rows = ctx.leaveRequests
          .map((l) => {
            const pid = byCode[l.personnelId];
            const fid = firmaId(ctx.companies, l.company);
            if (!pid || !fid) return null;
            return {
              firma_id: fid,
              personel_id: pid,
              tip: l.type,
              gun: l.days || 1,
              ay: l.month,
              durum: l.status || 'Bekliyor',
            };
          })
          .filter(Boolean);
        if (rows.length) await client.from('personel_izin').insert(rows);
        }
      } else if (count) {
        const rows = await selectAll(client, 'personel_izin', '*');
        const byDb = Object.fromEntries((ctx.personnel || []).map((p) => [p.dbId, p]));
        replaceArray(ctx.leaveRequests, rows.map((r) => ({
          dbId: r.id,
          id: `L-${r.id.slice(0, 8)}`,
          personnelId: byDb[r.personel_id]?.id || r.personel_id,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          type: r.tip,
          days: Number(r.gun) || 1,
          month: r.ay,
          status: r.durum || 'Bekliyor',
        })));
      }
    }
  }

  async function saveUser(u, companies) {
    try {
      const client = sb();
      if (!client || !u) return fail('no-client', 'saveUser');
      const uname = (u.username || '').toLowerCase();
      const row = {
        kullanici_adi: uname,
        ad_soyad: u.name || uname,
        sifre_hash: u.password || null,
        rol: u.role || 'Operatör',
        kapsam: u.scope || 'Firma',
        tum_grup: !!(u.isGod || u.scope === 'Tüm Grup'),
        is_god: !!u.isGod,
        erisim_kritik: !!u.accessCritical,
        yaka: collarToDb(u.collar),
        tc_no: u.tcNo || null,
        telefon: u.phone || null,
        eposta: u.email || null,
        adres: u.address || null,
        aktif: true,
      };
      let dbId = u.dbId;
      if (dbId) {
        const { error } = await client.from('kullanicilar').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('kullanicilar')
          .upsert(row, { onConflict: 'kullanici_adi' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        u.dbId = dbId;
      }
      await client.from('kullanici_firmalar').delete().eq('kullanici_id', dbId);
      const firmNames = u.isGod || u.scope === 'Tüm Grup'
        ? Object.keys(companies || {})
        : (u.companies || []);
      const links = firmNames
        .map((n) => firmaId(companies, n))
        .filter(Boolean)
        .map((fid) => ({ kullanici_id: dbId, firma_id: fid }));
      if (links.length) {
        const { error } = await client.from('kullanici_firmalar').insert(links);
        if (error) throw error;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveUser'); }
  }
  async function deleteUser(u) {
    try {
      const client = sb();
      if (!client || !u) return fail('no-client', 'deleteUser');
      const uname = (u.username || '').toLowerCase();
      if (PROTECTED_USERS.has(uname)) return fail('Korumalı kullanıcı silinemez', 'deleteUser');
      if (u.dbId) {
        const { error } = await client.from('kullanicilar').delete().eq('id', u.dbId);
        if (error) throw error;
        return ok();
      }
      if (uname) {
        const { error } = await client.from('kullanicilar').delete().eq('kullanici_adi', uname);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deleteUser');
    } catch (e) { return fail(e, 'deleteUser'); }
  }
  async function hydrateUsers(ctx) {
    const client = sb();
    if (!client || !ctx.users) return;
    const n = await countTable(client, 'kullanicilar');
    if (!n) {
      if (blockReseed(ctx.users)) return;
      if (ctx.users.length) {
        progress(ctx, `Kullanıcılar seed (${ctx.users.length})…`);
        for (const u of ctx.users) await saveUser(u, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Kullanıcılar hydrate…');
    const rows = await selectAll(
      client,
      'kullanicilar',
      '*, kullanici_firmalar(firma_id, firmalar(ad))'
    );
    const localByUser = Object.fromEntries((ctx.users || []).map((u) => [(u.username || '').toLowerCase(), u]));
    const mapped = rows.map((r) => {
      const uname = (r.kullanici_adi || '').toLowerCase();
      const prev = localByUser[uname];
      const firmNames = (r.kullanici_firmalar || []).map((kf) => kf.firmalar?.ad).filter(Boolean);
      return {
        dbId: r.id,
        username: r.kullanici_adi,
        name: r.ad_soyad,
        password: r.sifre_hash || (prev?.password || ''),
        role: r.rol || 'Operatör',
        scope: (r.tum_grup || r.kapsam === 'Tüm Grup') ? 'Tüm Grup' : (r.kapsam || firmNames[0] || 'Firma'),
        companies: firmNames,
        isGod: !!(r.is_god || r.tum_grup),
        accessCritical: !!r.erisim_kritik,
        collar: collarToUi(r.yaka),
        email: r.eposta || '',
        phone: r.telefon || '',
        tcNo: r.tc_no || '',
        address: r.adres || '',
        dept: prev?.dept || '',
        personnelId: prev?.personnelId || null,
        perms: prev?.perms,
      };
    });
    // Korunan demo kullanıcıları: kaybolmasın + şifre/yetki bozulmasın
    PROTECTED_USERS.forEach((uname) => {
      const local = localByUser[uname];
      if (!local) return;
      const idx = mapped.findIndex((u) => (u.username || '').toLowerCase() === uname);
      if (idx < 0) {
        mapped.push({ ...local });
        return;
      }
      const row = mapped[idx];
      if (local.password) row.password = local.password;
      if (local.isGod) {
        row.isGod = true;
        row.scope = 'Tüm Grup';
        row.role = local.role || row.role || 'Yönetici';
        row.accessCritical = true;
        if (!row.companies || row.companies.length < (local.companies || []).length) {
          row.companies = (local.companies || []).slice();
        }
      }
      if (local.personnelId && !row.personnelId) row.personnelId = local.personnelId;
      if (local.collar) row.collar = local.collar;
      if (local.perms) row.perms = local.perms;
    });
    replaceArray(ctx.users, mapped);
  }

  // ─── Cost analyses ─────────────────────────────────────────────────────────
  function costItemToRow(it, maliyetId, sira) {
    const mfg = { ...(it.mfgDims || {}) };
    if (it.excelAllInUnit != null || it.source || it.excelSplitNote || it.excelSupplier) {
      mfg.__btd = {
        excelAllInUnit: it.excelAllInUnit,
        source: it.source || null,
        excelSplitNote: it.excelSplitNote || null,
        excelSupplier: it.excelSupplier || null,
        vatExcluded: it.vatExcluded !== false,
      };
    }
    return {
      maliyet_id: maliyetId,
      sira,
      parca_no: it.partNo || null,
      aciklama: it.desc || null,
      adet: it.qty ?? 1,
      malzeme: it.material || null,
      alacim: it.alloy || null,
      sekil_kodu: it.shapeId || null,
      sekil_adi: it.shapeName || null,
      imalat_olculeri: mfg,
      siparis_olculeri: it.ordDims || {},
      ozkutle: it.density ?? null,
      birim_kg: it.unitKg ?? null,
      toplam_kg: it.totalKg ?? null,
      imalat_birim_kg: it.mfgUnitKg ?? null,
      imalat_toplam_kg: it.mfgTotalKg ?? null,
      fiyat_eur_kg: it.priceEurPerKg ?? it.pricePerKg ?? null,
      malzeme_birim: it.materialUnit ?? it.matUnit ?? 0,
      malzeme_toplam: it.materialTotal ?? it.matTotal ?? 0,
      iscilik_birim: it.laborUnit ?? 0,
      iscilik_toplam: it.laborTotal ?? 0,
      isil_tip: it.heatType || null,
      isil_mod: it.heatMode || null,
      isil_eur: it.heatEurRate ?? it.heatEur ?? 0,
      isil_tutar: it.heat ?? it.heatAmt ?? 0,
      kaplama_tip: it.coatingType || it.coatType || null,
      kaplama_mod: it.coatingMode || it.coatMode || null,
      kaplama_eur: it.coatingEurRate ?? it.coatEur ?? 0,
      kaplama_tutar: (() => {
        const c2 = Number(it.coating2 ?? it.coat2Amt) || 0;
        const cAll = Number(it.coating ?? it.coatAmt) || 0;
        return Math.max(0, cAll - c2);
      })(),
      kaplama2_tip: it.coatingType2 || it.coat2Type || null,
      kaplama2_mod: it.coating2Mode || it.coat2Mode || null,
      kaplama2_eur: it.coating2EurRate ?? it.coat2Eur ?? 0,
      kaplama2_tutar: it.coating2 ?? it.coat2Amt ?? 0,
      nakliye: it.shipping ?? 0,
      maliyet_ara: it.costSubtotal ?? 0,
      birim_toplam: it.unitTotal ?? 0,
      kar_orani: it.profitPct ?? null,
      kar_tutari: it.profitAmt ?? 0,
      teklif_birim: it.quoteUnit ?? 0,
      teklif_toplam: it.quoteTotal ?? 0,
    };
  }
  function costItemFromRow(r) {
    const mfgRaw = { ...(r.imalat_olculeri || {}) };
    const meta = mfgRaw.__btd || {};
    delete mfgRaw.__btd;
    const coat1 = Number(r.kaplama_tutar) || 0;
    const coat2 = Number(r.kaplama2_tutar) || 0;
    return {
      partNo: r.parca_no || '',
      desc: r.aciklama || '',
      qty: Number(r.adet) || 1,
      material: r.malzeme || '',
      alloy: r.alacim || '',
      shapeId: r.sekil_kodu || '',
      shapeName: r.sekil_adi || '',
      mfgDims: mfgRaw,
      ordDims: r.siparis_olculeri || {},
      density: Number(r.ozkutle) || 0,
      unitKg: Number(r.birim_kg) || 0,
      totalKg: Number(r.toplam_kg) || 0,
      mfgUnitKg: Number(r.imalat_birim_kg) || 0,
      mfgTotalKg: Number(r.imalat_toplam_kg) || 0,
      pricePerKg: Number(r.fiyat_eur_kg) || 0,
      priceEurPerKg: Number(r.fiyat_eur_kg) || 0,
      materialUnit: Number(r.malzeme_birim) || 0,
      materialTotal: Number(r.malzeme_toplam) || 0,
      laborUnit: Number(r.iscilik_birim) || 0,
      laborTotal: Number(r.iscilik_toplam) || 0,
      heatType: r.isil_tip || '',
      heatMode: r.isil_mod || '',
      heatEurRate: Number(r.isil_eur) || 0,
      heat: Number(r.isil_tutar) || 0,
      coatingType: r.kaplama_tip || '',
      coatingMode: r.kaplama_mod || '',
      coatingEurRate: Number(r.kaplama_eur) || 0,
      coatingType2: r.kaplama2_tip || '',
      coating2Mode: r.kaplama2_mod || '',
      coating2EurRate: Number(r.kaplama2_eur) || 0,
      coating2: coat2,
      coating: coat1 + coat2,
      shipping: Number(r.nakliye) || 0,
      costSubtotal: Number(r.maliyet_ara) || 0,
      unitTotal: Number(r.birim_toplam) || 0,
      profitPct: Number(r.kar_orani) || 0,
      profitAmt: Number(r.kar_tutari) || 0,
      quoteUnit: Number(r.teklif_birim) || 0,
      quoteTotal: Number(r.teklif_toplam) || 0,
      excelAllInUnit: meta.excelAllInUnit != null ? Number(meta.excelAllInUnit) : null,
      excelSplitNote: meta.excelSplitNote || '',
      excelSupplier: meta.excelSupplier || '',
      source: meta.source || '',
      vatExcluded: meta.vatExcluded !== false,
    };
  }
  async function saveCostAnalysis(a, companies) {
    try {
      const client = sb();
      if (!client || !a) return fail('no-client', 'saveCostAnalysis');
      const fid = firmaId(companies, a.company);
      if (!fid) return fail('firma_id yok', 'saveCostAnalysis');
      const row = {
        firma_id: fid,
        belge_no: a.id,
        musteri_unvan: a.customer || null,
        ilgili_kisi: a.contact || null,
        para_birimi: currencyToDb(a.currency),
        kar_orani: a.profitPct ?? 25,
        nakliye: a.shipping ?? 0,
        tarih: a.date || new Date().toISOString().slice(0, 10),
        termin_gun: a.leadTimeDays ?? 15,
        finansal_ozet: a.financials || {},
      };
      let dbId = a.dbId;
      if (dbId) {
        const { error } = await client.from('maliyet_analizleri').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('maliyet_analizleri')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        a.dbId = dbId;
      }
      await client.from('maliyet_kalemleri').delete().eq('maliyet_id', dbId);
      const items = (a.items || []).map((it, i) => costItemToRow(it, dbId, i + 1));
      if (items.length) {
        const { error } = await client.from('maliyet_kalemleri').insert(items);
        if (error) throw error;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveCostAnalysis'); }
  }
  async function deleteCostAnalysis(a, companies) {
    try {
      const client = sb();
      if (!client || !a) return fail('no-client', 'deleteCostAnalysis');
      if (a.dbId) {
        const { error } = await client.from('maliyet_analizleri').delete().eq('id', a.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, a.company);
      if (fid && a.id) {
        const { error } = await client.from('maliyet_analizleri').delete().eq('firma_id', fid).eq('belge_no', a.id);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deleteCostAnalysis');
    } catch (e) { return fail(e, 'deleteCostAnalysis'); }
  }
  async function hydrateCostAnalyses(ctx) {
    const client = sb();
    if (!client || !ctx.costAnalyses) return;
    const n = await countTable(client, 'maliyet_analizleri');
    if (!n) {
      if (blockReseed(ctx.costAnalyses)) return;
      if (ctx.costAnalyses.length) {
        progress(ctx, `Maliyet seed (${ctx.costAnalyses.length})…`);
        for (const a of ctx.costAnalyses) await saveCostAnalysis(a, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Maliyet hydrate…');
    const rows = await selectAll(client, 'maliyet_analizleri', '*, maliyet_kalemleri(*)');
    replaceArray(ctx.costAnalyses, rows.map((r) => ({
      dbId: r.id,
      id: r.belge_no,
      company: companyNameById(ctx.companies, r.firma_id) || '',
      customer: r.musteri_unvan || '',
      contact: r.ilgili_kisi || '',
      currency: currencyToUi(r.para_birimi),
      profitPct: Number(r.kar_orani) || 0,
      shipping: Number(r.nakliye) || 0,
      date: r.tarih,
      leadTimeDays: r.termin_gun ?? 15,
      financials: r.finansal_ozet || {},
      quoteId: null,
      items: (r.maliyet_kalemleri || [])
        .sort((a, b) => (a.sira || 0) - (b.sira || 0))
        .map(costItemFromRow),
    })));
  }

  // ─── Quotes ────────────────────────────────────────────────────────────────
  async function lookupMaliyetId(client, fid, belgeNo) {
    if (!belgeNo) return null;
    const { data } = await client
      .from('maliyet_analizleri')
      .select('id')
      .eq('firma_id', fid)
      .eq('belge_no', belgeNo)
      .maybeSingle();
    return data?.id || null;
  }
  async function saveQuote(q, companies) {
    try {
      const client = sb();
      if (!client || !q) return fail('no-client', 'saveQuote');
      const fid = firmaId(companies, q.company);
      if (!fid) return fail('firma_id yok', 'saveQuote');
      const maliyetId = q.costAnalysisDbId
        || (await lookupMaliyetId(client, fid, q.costAnalysisId));
      const row = {
        firma_id: fid,
        belge_no: q.id,
        musteri_unvan: q.customer,
        ilgili_kisi: q.contact || null,
        tarih: q.date || new Date().toISOString().slice(0, 10),
        para_birimi: currencyToDb(q.currency),
        termin_gun: q.leadTimeDays ?? 15,
        odeme_vadesi: q.paymentTerms || null,
        odeme_tipi: q.paymentType || null,
        imalat_tipi: q.manufacturingType || null,
        teslim_yeri: q.deliveryPlace || null,
        garanti: q.warranty || null,
        kosullar: q.terms || null,
        kdv_orani: q.vatRate ?? 20,
        gecerlilik_gun: q.validityDays ?? 15,
        durum: q.status || 'Taslak',
        maliyet_id: maliyetId,
        qr_payload: q.qrPayload || null,
        gonderim_eposta: !!(q.sentChannels?.email),
        gonderim_whatsapp: !!(q.sentChannels?.whatsapp),
        banka_mod: q.quoteBankMode || null,
      };
      let dbId = q.dbId;
      if (dbId) {
        const { error } = await client.from('teklifler').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('teklifler')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        q.dbId = dbId;
      }
      await client.from('teklif_kalemleri').delete().eq('teklif_id', dbId);
      const items = (q.items || []).map((it, i) => ({
        teklif_id: dbId,
        sira: i + 1,
        parca_no: it.partNo || null,
        aciklama: it.desc || null,
        adet: it.qty ?? 1,
        birim_fiyat: it.unitPrice ?? 0,
        iskonto_pct: it.discountPct ?? 0,
        not_metni: it.note || null,
      }));
      if (items.length) {
        const { error } = await client.from('teklif_kalemleri').insert(items);
        if (error) throw error;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveQuote'); }
  }
  async function deleteQuote(q, companies) {
    try {
      const client = sb();
      if (!client || !q) return fail('no-client', 'deleteQuote');
      if (q.dbId) {
        const { error } = await client.from('teklifler').delete().eq('id', q.dbId);
        if (error) throw error;
        return ok();
      }
      const fid = firmaId(companies, q.company);
      if (fid && q.id) {
        const { error } = await client.from('teklifler').delete().eq('firma_id', fid).eq('belge_no', q.id);
        if (error) throw error;
        return ok();
      }
      return fail('no-id', 'deleteQuote');
    } catch (e) { return fail(e, 'deleteQuote'); }
  }
  async function hydrateQuotes(ctx) {
    const client = sb();
    if (!client || !ctx.quotes) return;
    const n = await countTable(client, 'teklifler');
    if (!n) {
      if (blockReseed(ctx.quotes)) return;
      if (ctx.quotes.length) {
        progress(ctx, `Teklifler seed (${ctx.quotes.length})…`);
        for (const q of ctx.quotes) await saveQuote(q, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Teklifler hydrate…');
    const rows = await selectAll(client, 'teklifler', '*, teklif_kalemleri(*)');
    // maliyet belge_no: maliyet_id üzerinden ayrı (teklif↔maliyet çift FK belirsizliği)
    const maliyetIds = [...new Set(rows.map((r) => r.maliyet_id).filter(Boolean))];
    let maliyetBelge = {};
    if (maliyetIds.length) {
      const { data: mrows, error: mErr } = await client
        .from('maliyet_analizleri')
        .select('id, belge_no')
        .in('id', maliyetIds);
      if (mErr) throw mErr;
      (mrows || []).forEach((m) => { maliyetBelge[m.id] = m.belge_no; });
    }
    replaceArray(ctx.quotes, rows.map((r) => ({
      dbId: r.id,
      id: r.belge_no,
      company: companyNameById(ctx.companies, r.firma_id) || '',
      customer: r.musteri_unvan,
      contact: r.ilgili_kisi || '',
      date: r.tarih,
      currency: currencyToUi(r.para_birimi),
      leadTimeDays: r.termin_gun ?? 15,
      paymentTerms: r.odeme_vadesi || '',
      paymentType: r.odeme_tipi || '',
      manufacturingType: r.imalat_tipi || '',
      deliveryPlace: r.teslim_yeri || '',
      warranty: r.garanti || '',
      terms: r.kosullar || '',
      vatRate: Number(r.kdv_orani) || 20,
      validityDays: r.gecerlilik_gun ?? 15,
      status: r.durum || 'Taslak',
      costAnalysisId: (r.maliyet_id && maliyetBelge[r.maliyet_id]) || null,
      costAnalysisDbId: r.maliyet_id || null,
      qrPayload: r.qr_payload || null,
      sentChannels: { email: !!r.gonderim_eposta, whatsapp: !!r.gonderim_whatsapp },
      quoteBankMode: r.banka_mod || null,
      items: (r.teklif_kalemleri || [])
        .sort((a, b) => (a.sira || 0) - (b.sira || 0))
        .map((it) => ({
          partNo: it.parca_no || '',
          desc: it.aciklama || '',
          qty: Number(it.adet) || 1,
          unitPrice: Number(it.birim_fiyat) || 0,
          discountPct: Number(it.iskonto_pct) || 0,
        })),
    })));
  }

  // ─── Orders ────────────────────────────────────────────────────────────────
  async function lookupTeklifId(client, fid, belgeNo) {
    if (!belgeNo) return null;
    const { data } = await client
      .from('teklifler')
      .select('id')
      .eq('firma_id', fid)
      .eq('belge_no', belgeNo)
      .maybeSingle();
    return data?.id || null;
  }
  async function saveOrder(o, companies) {
    try {
      const client = sb();
      if (!client || !o) return fail('no-client', 'saveOrder');
      const fid = firmaId(companies, o.company);
      if (!fid) return fail('firma_id yok', 'saveOrder');
      const teklifId = o.quoteDbId || (await lookupTeklifId(client, fid, o.quoteId || o.id));
      const row = {
        firma_id: fid,
        belge_no: o.id,
        teklif_id: teklifId,
        musteri_unvan: o.customer,
        ilgili_kisi: o.contact || null,
        po_no: o.poNumber || null,
        para_birimi: currencyToDb(o.currency),
        onay_tarihi: o.approvalDate || new Date().toISOString().slice(0, 10),
        termin_gun: o.leadTimeDays ?? 15,
        teslim_tarihi: o.deliveryDate || null,
        kosullar: o.terms || null,
        durum: o.status || 'Onaylandı',
        revizyon_no: o.revisionNo ?? 0,
        beklenmeyen_toplam: o.unforeseenTotal ?? 0,
      };
      let dbId = o.dbId;
      if (dbId) {
        const { error } = await client.from('siparisler').update(row).eq('id', dbId);
        if (error) throw error;
      } else {
        const { data, error } = await client
          .from('siparisler')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        o.dbId = dbId;
      }
      await client.from('siparis_kalemleri').delete().eq('siparis_id', dbId);
      const itemsFull = (o.items || []).map((it, i) => ({
        siparis_id: dbId,
        sira: i + 1,
        parca_no: it.partNo || null,
        aciklama: it.desc || null,
        adet: it.qty ?? 1,
        birim_fiyat: it.unitPrice ?? 0,
        iskonto_pct: it.discountPct ?? 0,
        ek_gider: it.extraCost ?? 0,
        teknik_resim: it.techDrawing || null,
        qr_anahtar: it.qrKey || null,
      }));
      if (itemsFull.length) {
        let { error } = await client.from('siparis_kalemleri').insert(itemsFull);
        if (error && /teknik_resim|qr_anahtar/i.test(error.message || '')) {
          const itemsBasic = itemsFull.map(({ teknik_resim, qr_anahtar, ...rest }) => rest);
          ({ error } = await client.from('siparis_kalemleri').insert(itemsBasic));
        }
        if (error) throw error;
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveOrder'); }
  }
  async function deleteOrder(o, companies) {
    return deleteBelgeRow('siparisler', o, companies, 'deleteOrder');
  }
  async function hydrateOrders(ctx) {
    const client = sb();
    if (!client || !ctx.orders) return;
    const n = await countTable(client, 'siparisler');
    if (!n) {
      if (blockReseed(ctx.orders)) return;
      if (ctx.orders.length) {
        progress(ctx, `Siparişler seed (${ctx.orders.length})…`);
        for (const o of ctx.orders) await saveOrder(o, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Siparişler hydrate…');
    const rows = await selectAll(
      client,
      'siparisler',
      '*, siparis_kalemleri(*), siparis_revizyonlari(*), teklifler(belge_no)'
    );
    const revLog = {};
    const mapped = rows.map((r) => {
      const id = r.belge_no;
      const revs = (r.siparis_revizyonlari || []).map((x) => ({ date: x.tarih, note: x.not_metni || '' }));
      if (revs.length) revLog[id] = revs;
      return {
        dbId: r.id,
        id,
        quoteId: r.teklifler?.belge_no || id,
        company: companyNameById(ctx.companies, r.firma_id) || '',
        customer: r.musteri_unvan,
        contact: r.ilgili_kisi || '',
        poNumber: r.po_no || '',
        currency: currencyToUi(r.para_birimi),
        approvalDate: r.onay_tarihi,
        leadTimeDays: r.termin_gun ?? 15,
        deliveryDate: r.teslim_tarihi || '',
        terms: r.kosullar || '',
        status: r.durum || 'Onaylandı',
        revisionNo: r.revizyon_no || 0,
        unforeseenTotal: Number(r.beklenmeyen_toplam) || 0,
        notifyLog: [],
        items: (r.siparis_kalemleri || [])
          .sort((a, b) => (a.sira || 0) - (b.sira || 0))
          .map((it) => ({
            partNo: it.parca_no || '',
            desc: it.aciklama || '',
            qty: Number(it.adet) || 1,
            unitPrice: Number(it.birim_fiyat) || 0,
            discountPct: Number(it.iskonto_pct) || 0,
            extraCost: Number(it.ek_gider) || 0,
            techDrawing: it.teknik_resim || '',
            qrKey: it.qr_anahtar || '',
          })),
      };
    });
    replaceArray(ctx.orders, mapped);
    if (ctx.orderRevisionLog) assignObject(ctx.orderRevisionLog, revLog);
  }

  // ─── Work orders ───────────────────────────────────────────────────────────
  async function saveWorkOrder(wo, companies) {
    try {
      const client = sb();
      if (!client || !wo) return fail('no-client', 'saveWorkOrder');
      const fid = firmaId(companies, wo.company);
      if (!fid) return fail('firma_id yok', 'saveWorkOrder');
      const siparisId = wo.orderDbId || (wo.orderId
        ? (await client.from('siparisler').select('id').eq('firma_id', fid).eq('belge_no', wo.orderId).maybeSingle()).data?.id
        : null);
      const teklifId = wo.quoteDbId || (wo.quoteId
        ? await lookupTeklifId(client, fid, wo.quoteId)
        : null);
      const row = {
        firma_id: fid,
        belge_no: wo.id,
        musteri_unvan: wo.customer || null,
        ilgili_kisi: wo.contactPerson || null,
        acilis_tarihi: wo.openedAt || new Date().toISOString().slice(0, 10),
        kapanis_tarihi: wo.closedAt || null,
        durum: wo.status || 'Aktif',
        siparis_id: siparisId || null,
        teklif_id: teklifId || null,
        qr_payload: wo.qrPayload || null,
        tedarikten: !!wo.fromProcurement,
      };
      let dbId = wo.dbId;
      if (dbId) {
        const { error } = await client.from('is_emirleri').update(row).eq('id', dbId);
        if (error) throw error;
        await client.from('is_emri_parcalari').delete().eq('is_emri_id', dbId);
      } else {
        const { data, error } = await client
          .from('is_emirleri')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        wo.dbId = dbId;
        await client.from('is_emri_parcalari').delete().eq('is_emri_id', dbId);
      }
      for (const part of wo.parts || []) {
        const partPayload = {
          is_emri_id: dbId,
          parca_no: Number(part.no) || 1,
          ad: part.name || '',
          malzeme: part.material || null,
          operator_adi: part.operator || null,
          aktif_cam: part.activeCam ?? 0,
          teknik_resim: part.techDrawing || null,
          qr_anahtar: part.qrKey || null,
        };
        let { data: pRow, error: pErr } = await client
          .from('is_emri_parcalari')
          .insert(partPayload)
          .select('id')
          .single();
        if (pErr && /teknik_resim|qr_anahtar/i.test(pErr.message || '')) {
          const { teknik_resim, qr_anahtar, ...basic } = partPayload;
          ({ data: pRow, error: pErr } = await client
            .from('is_emri_parcalari')
            .insert(basic)
            .select('id')
            .single());
        }
        if (pErr) throw pErr;
        const cams = (part.cam || []).map((c, i) => ({
          parca_id: pRow.id,
          sira: i,
          etiket: c.label || `Adım ${i + 1}`,
          makine_adi: c.machine || null,
          planlanan_makine: c.plannedMachine || c.completedMachine || null,
          baslangic_at: c.startedAt || null,
          bitis_at: c.finishedAt || c.endedAt || null,
          baslangic_nfc: c.startNfc || null,
          bitis_nfc: c.endNfc || null,
          sure_dk: c.durationMin != null ? Number(c.durationMin) : null,
        }));
        if (cams.length) {
          const { error } = await client.from('is_emri_cam_adimlari').insert(cams);
          if (error) throw error;
        }
      }
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveWorkOrder'); }
  }
  async function deleteWorkOrder(wo, companies) {
    return deleteBelgeRow('is_emirleri', wo, companies, 'deleteWorkOrder');
  }
  async function hydrateWorkOrders(ctx) {
    const client = sb();
    if (!client || !ctx.workOrders) return;
    const n = await countTable(client, 'is_emirleri');
    if (!n) {
      if (blockReseed(ctx.workOrders)) return;
      if (ctx.workOrders.length) {
        progress(ctx, `İş emirleri seed (${ctx.workOrders.length})…`);
        for (const wo of ctx.workOrders) await saveWorkOrder(wo, ctx.companies);
      }
      return;
    }
    progress(ctx, 'İş emirleri hydrate…');
    const rows = await selectAll(
      client,
      'is_emirleri',
      '*, is_emri_parcalari(*, is_emri_cam_adimlari(*)), siparisler(belge_no), teklifler(belge_no)'
    );
    replaceArray(ctx.workOrders, rows.map((r) => ({
      dbId: r.id,
      id: r.belge_no,
      company: companyNameById(ctx.companies, r.firma_id) || '',
      customer: r.musteri_unvan || '',
      openedAt: r.acilis_tarihi,
      closedAt: r.kapanis_tarihi || undefined,
      status: r.durum || 'Aktif',
      orderId: r.siparisler?.belge_no || null,
      quoteId: r.teklifler?.belge_no || null,
      qrPayload: r.qr_payload || null,
      notifyLog: [],
      parts: (r.is_emri_parcalari || [])
        .sort((a, b) => (a.parca_no || 0) - (b.parca_no || 0))
        .map((p) => ({
          dbId: p.id,
          no: p.parca_no,
          name: p.ad,
          material: p.malzeme || '',
          operator: p.operator_adi || '',
          activeCam: p.aktif_cam || 0,
          techDrawing: p.teknik_resim || '',
          qrKey: p.qr_anahtar || '',
          cam: (p.is_emri_cam_adimlari || [])
            .sort((a, b) => (a.sira || 0) - (b.sira || 0))
            .map((c) => ({
              label: c.etiket,
              machine: c.makine_adi || null,
              plannedMachine: c.planlanan_makine || null,
              startedAt: c.baslangic_at || null,
              finishedAt: c.bitis_at || null,
              endedAt: c.bitis_at || null,
              startNfc: c.baslangic_nfc || null,
              endNfc: c.bitis_nfc || null,
              durationMin: c.sure_dk != null ? Number(c.sure_dk) : null,
              completedMachine: (!c.makine_adi && c.planlanan_makine && c.bitis_at) ? c.planlanan_makine : null,
            })),
        })),
    })));
    (ctx.workOrders || []).forEach((wo) => {
      if (typeof window.normalizeWorkOrderCam === 'function') window.normalizeWorkOrderCam(wo);
      else {
        (wo.parts || []).forEach((part) => {
          (part.cam || []).forEach((step) => {
            if (!step.plannedMachine && step.machine && !step.startedAt) {
              step.plannedMachine = step.machine;
              step.machine = null;
            }
          });
        });
      }
    });
  }

  // ─── Procurement / RFQ / Reproc / Unforeseen ────────────────────────────────
  async function saveProcurementItem(item, companies) {
    try {
      const client = sb();
      if (!client || !item) return fail('no-client', 'saveProcurementItem');
      const fid = firmaId(companies, item.company);
      if (!fid) return fail('firma_id yok', 'saveProcurementItem');
      const woDb = item.woId
        ? (await client.from('is_emirleri').select('id').eq('firma_id', fid).eq('belge_no', item.woId).maybeSingle()).data?.id
        : null;
      const row = {
        firma_id: fid,
        belge_no: item.id,
        parca: item.part || null,
        malzeme: item.material || null,
        alacim: item.alloy || null,
        sekil_adi: item.shapeName || null,
        imalat_olculeri: item.mfgDims || {},
        siparis_olculeri: item.ordDims || {},
        adet: item.qty ?? 1,
        birim_kg: item.unitKg ?? null,
        toplam_kg: item.totalKg ?? null,
        ozkutle: item.density ?? null,
        is_emri_id: woDb || null,
        parca_no: item.partNo != null ? String(item.partNo) : null,
        tedarikci_unvan: item.supplier || null,
        siparis_tarihi: item.orderDate || null,
        termin_tarihi: item.dueDate || null,
        durum: item.status || 'Bekliyor',
        malzeme_grup: item.materialGroup || null,
        rfq_oncelik: item.rfqPriority ?? null,
      };
      if (item.dbId) {
        const { error } = await client.from('tedarik_kalemleri').update(row).eq('id', item.dbId);
        if (error) throw error;
        return ok({ dbId: item.dbId });
      }
      const { data, error } = await client
        .from('tedarik_kalemleri')
        .upsert(row, { onConflict: 'firma_id,belge_no' })
        .select('id')
        .single();
      if (error) throw error;
      item.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveProcurementItem'); }
  }
  async function deleteProcurementItem(item, companies) {
    return deleteBelgeRow('tedarik_kalemleri', item, companies, 'deleteProcurementItem');
  }
  async function hydrateProcurement(ctx) {
    const client = sb();
    if (!client || !ctx.procurementItems) return;
    const n = await countTable(client, 'tedarik_kalemleri');
    if (!n) {
      if (blockReseed(ctx.procurementItems)) return;
      if (ctx.procurementItems.length) {
        progress(ctx, `Tedarik seed (${ctx.procurementItems.length})…`);
        for (const it of ctx.procurementItems) await saveProcurementItem(it, ctx.companies);
      }
      return;
    }
    progress(ctx, 'Tedarik hydrate…');
    const rows = await selectAll(client, 'tedarik_kalemleri', '*, is_emirleri(belge_no)');
    replaceArray(ctx.procurementItems, rows.map((r) => ({
      dbId: r.id,
      id: r.belge_no,
      company: companyNameById(ctx.companies, r.firma_id) || '',
      part: r.parca || '',
      material: r.malzeme || '',
      alloy: r.alacim || '',
      shapeName: r.sekil_adi || '',
      mfgDims: r.imalat_olculeri || {},
      ordDims: r.siparis_olculeri || {},
      qty: Number(r.adet) || 1,
      unitKg: Number(r.birim_kg) || 0,
      totalKg: Number(r.toplam_kg) || 0,
      density: Number(r.ozkutle) || 0,
      woId: r.is_emirleri?.belge_no || null,
      partNo: r.parca_no,
      supplier: r.tedarikci_unvan || '',
      orderDate: r.siparis_tarihi || '',
      dueDate: r.termin_tarihi || '',
      status: r.durum || 'Bekliyor',
      materialGroup: r.malzeme_grup || '',
      rfqPriority: r.rfq_oncelik,
    })));
  }

  async function saveMaterialRfq(rfq, companies) {
    try {
      const client = sb();
      if (!client || !rfq) return fail('no-client', 'saveMaterialRfq');
      const fid = firmaId(companies, rfq.company);
      if (!fid) return fail('firma_id yok', 'saveMaterialRfq');
      const srcMap = { cost: 'cost', order: 'order', reproc: 'reproc', maliyet: 'maliyet', siparis: 'siparis' };
      const row = {
        firma_id: fid,
        belge_no: rfq.id,
        kaynak: srcMap[rfq.source] || 'cost',
        ref_etiket: rfq.refLabel || null,
        musteri_unvan: rfq.customer || null,
        durum: rfq.status || 'Taslak',
        form_meta: rfq.form || {},
      };
      let dbId = rfq.dbId;
      if (dbId) {
        const { error } = await client.from('rfq_paketleri').update(row).eq('id', dbId);
        if (error) throw error;
        await client.from('rfq_gruplari').delete().eq('rfq_id', dbId);
        await client.from('rfq_yanitlari').delete().eq('rfq_id', dbId);
      } else {
        const { data, error } = await client
          .from('rfq_paketleri')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        rfq.dbId = dbId;
        await client.from('rfq_gruplari').delete().eq('rfq_id', dbId);
        await client.from('rfq_yanitlari').delete().eq('rfq_id', dbId);
      }
      await ensureMaterialGroups(client, (rfq.groups || []).map((g) => g.groupName));
      for (let gi = 0; gi < (rfq.groups || []).length; gi++) {
        const g = rfq.groups[gi];
        const { data: gRow, error: gErr } = await client
          .from('rfq_gruplari')
          .insert({
            rfq_id: dbId,
            malzeme_grup_id: groupId(g.groupName),
            grup_adi: g.groupName,
            sira: gi + 1,
          })
          .select('id')
          .single();
        if (gErr) throw gErr;
        const items = (g.items || []).map((it) => ({
          rfq_grup_id: gRow.id,
          parca: it.part || it.desc || null,
          malzeme: it.material || null,
          alacim: it.alloy || null,
          sekil_adi: it.shapeName || null,
          adet: it.qty ?? 1,
          birim_kg: it.unitKg ?? null,
          toplam_kg: it.totalKg ?? null,
          olculer: it.dims || it.mfgDims || {},
          parca_no: it.partNo || null,
        }));
        if (items.length) await client.from('rfq_grup_kalemleri').insert(items);
        const suppliers = (g.suppliers || []).map((s, i) => ({
          rfq_grup_id: gRow.id,
          tedarikci_unvan: typeof s === 'string' ? s : (s.name || s.unvan || ''),
          oncelik: (typeof s === 'object' ? s.priority : null) || i + 1,
          secili: typeof s === 'object' ? (s.selected !== false) : true,
          iletisim: typeof s === 'object' ? (s.contact || {}) : {},
        })).filter((s) => s.tedarikci_unvan);
        if (suppliers.length) await client.from('rfq_grup_tedarikcileri').insert(suppliers);
      }
      const quotes = (rfq.quotes || []).map((q) => ({
        rfq_id: dbId,
        grup_adi: q.groupName || null,
        tedarikci_unvan: q.supplier || q.vendor || '',
        durum: q.status || 'Teklif Bekleniyor',
        tutar: q.amount ?? null,
        not_metni: q.note || null,
        oncelik: q.priority ?? null,
        yanit_tarihi: q.date || null,
      })).filter((q) => q.tedarikci_unvan);
      if (quotes.length) await client.from('rfq_yanitlari').insert(quotes);
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveMaterialRfq'); }
  }
  async function hydrateMaterialRfqs(ctx) {
    const client = sb();
    if (!client || !ctx.materialRfqs) return;
    const n = await countTable(client, 'rfq_paketleri');
    if (!n) {
      if (blockReseed(ctx.materialRfqs)) return;
      if (ctx.materialRfqs.length) {
        progress(ctx, `RFQ seed (${ctx.materialRfqs.length})…`);
        for (const r of ctx.materialRfqs) await saveMaterialRfq(r, ctx.companies);
      }
      return;
    }
    progress(ctx, 'RFQ hydrate…');
    const rows = await selectAll(
      client,
      'rfq_paketleri',
      '*, rfq_gruplari(*, rfq_grup_kalemleri(*), rfq_grup_tedarikcileri(*)), rfq_yanitlari(*)'
    );
    replaceArray(ctx.materialRfqs, rows.map((r) => ({
      dbId: r.id,
      id: r.belge_no,
      company: companyNameById(ctx.companies, r.firma_id) || '',
      source: r.kaynak,
      sourceId: null,
      refLabel: r.ref_etiket || '',
      customer: r.musteri_unvan || '',
      status: r.durum || 'Taslak',
      createdAt: r.created_at,
      form: r.form_meta || {},
      groups: (r.rfq_gruplari || [])
        .sort((a, b) => (a.sira || 0) - (b.sira || 0))
        .map((g) => ({
          groupName: g.grup_adi,
          items: (g.rfq_grup_kalemleri || []).map((it) => ({
            part: it.parca || '',
            material: it.malzeme || '',
            alloy: it.alacim || '',
            shapeName: it.sekil_adi || '',
            qty: Number(it.adet) || 1,
            unitKg: Number(it.birim_kg) || 0,
            totalKg: Number(it.toplam_kg) || 0,
            dims: it.olculer || {},
            partNo: it.parca_no || '',
          })),
          suppliers: (g.rfq_grup_tedarikcileri || []).map((s) => ({
            name: s.tedarikci_unvan,
            priority: s.oncelik,
            selected: s.secili !== false,
          })),
        })),
      quotes: (r.rfq_yanitlari || []).map((q) => ({
        groupName: q.grup_adi || '',
        supplier: q.tedarikci_unvan,
        status: q.durum,
        amount: q.tutar,
        note: q.not_metni || '',
        priority: q.oncelik,
        date: q.yanit_tarihi,
      })),
    })));
  }

  async function saveReproc(r, companies) {
    try {
      const client = sb();
      if (!client || !r) return fail('no-client', 'saveReproc');
      const fid = firmaId(companies, r.company);
      if (!fid) return fail('firma_id yok', 'saveReproc');
      const row = {
        firma_id: fid,
        belge_no: r.id,
        parca_no: r.partNo ?? null,
        parca_adi: r.partName || r.part || null,
        malzeme: r.material || null,
        malzeme_grup: r.materialGroup || null,
        neden: r.reason || null,
        adet: r.qty ?? 1,
        tahmin_tutar: r.estAmount ?? 0,
        durum: r.status || 'Onay Bekliyor',
        talep_eden: r.requestedBy || null,
        onaylayan: r.approvedBy || null,
      };
      if (r.dbId) {
        const { error } = await client.from('yeniden_tedarik_talepleri').update(row).eq('id', r.dbId);
        if (error) throw error;
        return ok({ dbId: r.dbId });
      }
      const { data, error } = await client
        .from('yeniden_tedarik_talepleri')
        .upsert(row, { onConflict: 'firma_id,belge_no' })
        .select('id')
        .single();
      if (error) throw error;
      r.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveReproc'); }
  }
  async function saveUnforeseen(u, companies) {
    try {
      const client = sb();
      if (!client || !u) return fail('no-client', 'saveUnforeseen');
      const fid = firmaId(companies, u.company);
      if (!fid) return fail('firma_id yok', 'saveUnforeseen');
      const row = {
        firma_id: fid,
        belge_no: u.id,
        parca_no: u.partNo ?? null,
        tutar: u.amount ?? 0,
        para_birimi: currencyToDb(u.currency || '€'),
        neden: u.reason || null,
        kaynak: u.source || 'reproc',
        dagitildi: !!u.distributed,
      };
      if (u.dbId) {
        const { error } = await client.from('beklenmeyen_giderler').update(row).eq('id', u.dbId);
        if (error) throw error;
        return ok({ dbId: u.dbId });
      }
      const { data, error } = await client
        .from('beklenmeyen_giderler')
        .upsert(row, { onConflict: 'firma_id,belge_no' })
        .select('id')
        .single();
      if (error) throw error;
      u.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveUnforeseen'); }
  }
  async function hydrateReprocUnforeseen(ctx) {
    const client = sb();
    if (!client) return;
    if (ctx.reprocRequests) {
      const n = await countTable(client, 'yeniden_tedarik_talepleri');
      if (!n && ctx.reprocRequests.length) {
        if (!blockReseed(ctx.reprocRequests)) {
          for (const r of ctx.reprocRequests) await saveReproc(r, ctx.companies);
        }
      } else if (n) {
        const rows = await selectAll(client, 'yeniden_tedarik_talepleri', '*');
        replaceArray(ctx.reprocRequests, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          partNo: r.parca_no,
          partName: r.parca_adi || '',
          material: r.malzeme || '',
          materialGroup: r.malzeme_grup || '',
          reason: r.neden || '',
          qty: Number(r.adet) || 1,
          estAmount: Number(r.tahmin_tutar) || 0,
          status: r.durum,
          requestedBy: r.talep_eden || '',
          approvedBy: r.onaylayan || '',
        })));
      }
    }
    if (ctx.unforeseenCosts) {
      const n = await countTable(client, 'beklenmeyen_giderler');
      if (!n && ctx.unforeseenCosts.length) {
        if (!blockReseed(ctx.unforeseenCosts)) {
          for (const u of ctx.unforeseenCosts) await saveUnforeseen(u, ctx.companies);
        }
      } else if (n) {
        const rows = await selectAll(client, 'beklenmeyen_giderler', '*');
        replaceArray(ctx.unforeseenCosts, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          partNo: r.parca_no,
          amount: Number(r.tutar) || 0,
          currency: currencyToUi(r.para_birimi),
          reason: r.neden || '',
          source: r.kaynak || 'reproc',
          distributed: !!r.dagitildi,
        })));
      }
    }
  }

  // ─── Fason / QC / Ship / Invoice / Stock ───────────────────────────────────
  async function saveFason(f, companies) {
    try {
      const client = sb();
      if (!client || !f) return fail('no-client', 'saveFason');
      const fid = firmaId(companies, f.company);
      if (!fid) return fail('firma_id yok', 'saveFason');
      const row = {
        firma_id: fid,
        belge_no: f.id,
        is_emri_ref: f.woRef || null,
        parca: f.part || null,
        seri_no: f.serial || null,
        adet: f.qty ?? 1,
        proses: f.process || 'Isıl İşlem',
        proses_detay: f.processDetail || null,
        tedarikci_unvan: f.vendor || null,
        ilgili_kisi: f.contact || null,
        telefon: f.phone || null,
        gonderim_tarihi: f.sentDate || null,
        termin_tarihi: f.dueDate || null,
        donus_tarihi: f.returnDate || null,
        durum: f.status || 'Taslak',
        not_metni: f.note || null,
      };
      let dbId = f.dbId;
      if (dbId) {
        const { error } = await client.from('fason_isler').update(row).eq('id', dbId);
        if (error) throw error;
        await client.from('fason_log').delete().eq('fason_id', dbId);
      } else {
        const { data, error } = await client
          .from('fason_isler')
          .upsert(row, { onConflict: 'firma_id,belge_no' })
          .select('id')
          .single();
        if (error) throw error;
        dbId = data.id;
        f.dbId = dbId;
        await client.from('fason_log').delete().eq('fason_id', dbId);
      }
      const logs = (f.log || []).map((l) => ({
        fason_id: dbId,
        tarih: l.at || new Date().toISOString().slice(0, 10),
        metin: l.text || '',
      }));
      if (logs.length) await client.from('fason_log').insert(logs);
      return ok({ dbId });
    } catch (e) { return fail(e, 'saveFason'); }
  }
  async function deleteFason(f, companies) {
    return deleteBelgeRow('fason_isler', f, companies, 'deleteFason');
  }
  async function saveQc(r, companies) {
    try {
      const client = sb();
      if (!client || !r) return fail('no-client', 'saveQc');
      const fid = firmaId(companies, r.company);
      if (!fid) return fail('firma_id yok', 'saveQc');
      const row = {
        firma_id: fid,
        belge_no: r.id,
        parca_etiket: r.partLabel || null,
        nfc: r.nfc || null,
        not_metni: r.note || null,
        sonuc: r.result || 'Onaylandı',
        tarih: r.date || new Date().toISOString().slice(0, 10),
      };
      if (r.dbId) {
        const { error } = await client.from('kalite_kayitlari').update(row).eq('id', r.dbId);
        if (error) throw error;
        return ok({ dbId: r.dbId });
      }
      const { data, error } = await client
        .from('kalite_kayitlari')
        .upsert(row, { onConflict: 'firma_id,belge_no' })
        .select('id')
        .single();
      if (error) throw error;
      r.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveQc'); }
  }
  async function deleteQc(r, companies) {
    return deleteBelgeRow('kalite_kayitlari', r, companies, 'deleteQc');
  }
  async function saveShipment(s, companies) {
    try {
      const client = sb();
      if (!client || !s) return fail('no-client', 'saveShipment');
      const fid = firmaId(companies, s.company);
      if (!fid) return fail('firma_id yok', 'saveShipment');
      const orderDb = s.orderId
        ? (await client.from('siparisler').select('id').eq('firma_id', fid).eq('belge_no', s.orderId).maybeSingle()).data?.id
        : null;
      const row = {
        firma_id: fid,
        belge_no: s.id || s.orderId || null,
        siparis_id: orderDb || null,
        musteri_unvan: s.customer || null,
        tasiyici: s.carrier || null,
        irsaliye_no: s.waybill || null,
        tarih: s.date || new Date().toISOString().slice(0, 10),
        durum: s.status || 'Hazırlanıyor',
        teslim_yontemi: s.deliveryMethod || null,
        teslim_at: s.deliveredAt || null,
        not_metni: s.note || null,
      };
      if (s.dbId) {
        const { error } = await client.from('sevkiyatlar').update(row).eq('id', s.dbId);
        if (error) throw error;
        return ok({ dbId: s.dbId });
      }
      const { data, error } = await client.from('sevkiyatlar').insert(row).select('id').single();
      if (error) throw error;
      s.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveShipment'); }
  }
  async function deleteShipment(s, companies) {
    return deleteBelgeRow('sevkiyatlar', s, companies, 'deleteShipment');
  }
  async function saveInvoice(inv, companies) {
    try {
      const client = sb();
      if (!client || !inv) return fail('no-client', 'saveInvoice');
      const fid = firmaId(companies, inv.company);
      if (!fid) return fail('firma_id yok', 'saveInvoice');
      const orderDb = inv.orderId
        ? (await client.from('siparisler').select('id').eq('firma_id', fid).eq('belge_no', inv.orderId).maybeSingle()).data?.id
        : null;
      const costDb = inv.costAnalysisId
        ? await lookupMaliyetId(client, fid, inv.costAnalysisId)
        : null;
      const salesNet = inv.salesNet ?? 0;
      const vat = inv.vat ?? 20;
      const row = {
        firma_id: fid,
        belge_no: inv.id,
        siparis_id: orderDb || null,
        musteri_unvan: inv.customer || null,
        para_birimi: currencyToDb(inv.currency),
        tarih: inv.date || new Date().toISOString().slice(0, 10),
        kdv_orani: vat,
        ara_toplam: salesNet,
        kdv_tutar: salesNet * (vat / 100),
        genel_toplam: inv.totalWithVat ?? salesNet * (1 + vat / 100),
        satis_net: salesNet,
        maliyet_gider: inv.costExpenses ?? 0,
        vergi_oncesi: inv.profitBeforeTax ?? 0,
        gelir_vergisi_pct: inv.incomeTaxPct ?? 0,
        gelir_vergisi: inv.incomeTax ?? 0,
        net_kar: inv.netProfit ?? 0,
        maliyet_id: costDb,
        durum: inv.status || 'Kesildi',
      };
      if (inv.dbId) {
        const { error } = await client.from('faturalar').update(row).eq('id', inv.dbId);
        if (error) throw error;
        return ok({ dbId: inv.dbId });
      }
      const { data, error } = await client
        .from('faturalar')
        .upsert(row, { onConflict: 'firma_id,belge_no' })
        .select('id')
        .single();
      if (error) throw error;
      inv.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveInvoice'); }
  }
  async function deleteInvoice(inv, companies) {
    return deleteBelgeRow('faturalar', inv, companies, 'deleteInvoice');
  }
  async function saveStockItem(item, companies) {
    try {
      const client = sb();
      if (!client || !item) return fail('no-client', 'saveStockItem');
      const fid = firmaId(companies, item.company);
      if (!fid) return fail('firma_id yok', 'saveStockItem');
      const row = {
        firma_id: fid,
        sku: item.sku || item.id,
        ad: item.name,
        kategori: item.category || null,
        miktar: item.qty ?? 0,
        birim: item.unit || 'adet',
        min_miktar: item.minQty ?? 0,
        tedarikci_unvan: item.supplier || null,
        lokasyon: item.location || null,
        qr_payload: item.qrPayload || null,
      };
      if (item.dbId) {
        const { error } = await client.from('stok_kartlari').update(row).eq('id', item.dbId);
        if (error) throw error;
        return ok({ dbId: item.dbId });
      }
      const { data, error } = await client
        .from('stok_kartlari')
        .upsert(row, { onConflict: 'firma_id,sku' })
        .select('id')
        .single();
      if (error) throw error;
      item.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveStockItem'); }
  }
  async function saveStockMove(m, companies) {
    try {
      const client = sb();
      if (!client || !m) return fail('no-client', 'saveStockMove');
      const fid = firmaId(companies, m.company);
      if (!fid) return fail('firma_id yok', 'saveStockMove');
      const row = {
        firma_id: fid,
        sku: m.sku,
        tip: m.type || 'Giriş',
        miktar: m.qty ?? 0,
        birim: m.unit || null,
        not_metni: m.note || null,
        tarih: m.date || new Date().toISOString().slice(0, 10),
        referans: m.ref || null,
      };
      if (m.dbId) {
        const { error } = await client.from('stok_hareketleri').update(row).eq('id', m.dbId);
        if (error) throw error;
        return ok({ dbId: m.dbId });
      }
      const { data, error } = await client.from('stok_hareketleri').insert(row).select('id').single();
      if (error) throw error;
      m.dbId = data.id;
      return ok({ dbId: data.id });
    } catch (e) { return fail(e, 'saveStockMove'); }
  }

  async function hydrateFasonQcShipInvoiceStock(ctx) {
    const client = sb();
    if (!client) return;

    if (ctx.fasonJobs) {
      const n = await countTable(client, 'fason_isler');
      if (!n) {
        if (!blockReseed(ctx.fasonJobs) && ctx.fasonJobs.length) {
          progress(ctx, `Fason seed (${ctx.fasonJobs.length})…`);
          for (const f of ctx.fasonJobs) await saveFason(f, ctx.companies);
        }
      } else if (n) {
        progress(ctx, 'Fason hydrate…');
        const rows = await selectAll(client, 'fason_isler', '*, fason_log(*)');
        replaceArray(ctx.fasonJobs, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          woRef: r.is_emri_ref || '',
          part: r.parca || '',
          serial: r.seri_no || '',
          qty: Number(r.adet) || 1,
          process: r.proses,
          processDetail: r.proses_detay || '',
          vendor: r.tedarikci_unvan || '',
          contact: r.ilgili_kisi || '',
          phone: r.telefon || '',
          sentDate: r.gonderim_tarihi || '',
          dueDate: r.termin_tarihi || '',
          returnDate: r.donus_tarihi || null,
          status: r.durum || 'Taslak',
          note: r.not_metni || '',
          log: (r.fason_log || []).map((l) => ({ at: l.tarih, text: l.metin })),
        })));
      }
    }

    if (ctx.qcRecords) {
      const n = await countTable(client, 'kalite_kayitlari');
      if (!n) {
        if (!blockReseed(ctx.qcRecords) && ctx.qcRecords.length) {
          for (const r of ctx.qcRecords) await saveQc(r, ctx.companies);
        }
      } else if (n) {
        const rows = await selectAll(client, 'kalite_kayitlari', '*');
        replaceArray(ctx.qcRecords, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          partLabel: r.parca_etiket || '',
          nfc: r.nfc || '',
          note: r.not_metni || '',
          result: r.sonuc,
          date: r.tarih,
        })));
      }
    }

    if (ctx.shipments) {
      const { count } = await client.from('sevkiyatlar').select('id', { count: 'exact', head: true });
      if (!count) {
        if (!blockReseed(ctx.shipments) && ctx.shipments.length) {
          for (const s of ctx.shipments) await saveShipment(s, ctx.companies);
        }
      } else if (count) {
        const rows = await selectAll(client, 'sevkiyatlar', '*, siparisler(belge_no)');
        replaceArray(ctx.shipments, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no || r.id,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          orderId: r.siparisler?.belge_no || '',
          customer: r.musteri_unvan || '',
          carrier: r.tasiyici || '',
          waybill: r.irsaliye_no || '',
          date: r.tarih,
          status: r.durum,
          deliveryMethod: r.teslim_yontemi || null,
          deliveredAt: r.teslim_at || null,
          note: r.not_metni || '',
        })));
      }
    }

    if (ctx.invoices) {
      const n = await countTable(client, 'faturalar');
      if (!n) {
        if (!blockReseed(ctx.invoices) && ctx.invoices.length) {
          for (const inv of ctx.invoices) await saveInvoice(inv, ctx.companies);
        }
      } else if (n) {
        const rows = await selectAll(client, 'faturalar', '*, siparisler(belge_no), maliyet_analizleri(belge_no)');
        replaceArray(ctx.invoices, rows.map((r) => ({
          dbId: r.id,
          id: r.belge_no,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          orderId: r.siparisler?.belge_no || '',
          customer: r.musteri_unvan || '',
          currency: currencyToUi(r.para_birimi),
          date: r.tarih,
          vat: Number(r.kdv_orani) || 20,
          totalWithVat: Number(r.genel_toplam) || 0,
          salesNet: Number(r.satis_net) || 0,
          costExpenses: Number(r.maliyet_gider) || 0,
          profitBeforeTax: Number(r.vergi_oncesi) || 0,
          incomeTaxPct: Number(r.gelir_vergisi_pct) || 0,
          incomeTax: Number(r.gelir_vergisi) || 0,
          netProfit: Number(r.net_kar) || 0,
          costAnalysisId: r.maliyet_analizleri?.belge_no || null,
          status: r.durum,
        })));
      }
    }

    if (ctx.stockItems) {
      const n = await countTable(client, 'stok_kartlari');
      if (!n) {
        if (!blockReseed(ctx.stockItems) && ctx.stockItems.length) {
          progress(ctx, `Stok seed (${ctx.stockItems.length})…`);
          for (const it of ctx.stockItems) await saveStockItem(it, ctx.companies);
        }
      } else if (n) {
        progress(ctx, 'Stok hydrate…');
        const rows = await selectAll(client, 'stok_kartlari', '*');
        replaceArray(ctx.stockItems, rows.map((r) => ({
          dbId: r.id,
          id: r.sku,
          sku: r.sku,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          name: r.ad,
          category: r.kategori || '',
          qty: Number(r.miktar) || 0,
          unit: r.birim || 'adet',
          minQty: Number(r.min_miktar) || 0,
          supplier: r.tedarikci_unvan || '',
          location: r.lokasyon || '',
          linkedWoId: '',
          linkedQuoteId: '',
          qrPayload: r.qr_payload || '',
          updatedAt: (r.updated_at || '').slice(0, 10),
        })));
      }
    }

    if (ctx.stockMoves) {
      const { count } = await client.from('stok_hareketleri').select('id', { count: 'exact', head: true });
      if (!count && ctx.stockMoves.length) {
        for (const m of ctx.stockMoves) await saveStockMove(m, ctx.companies);
      } else if (count) {
        const rows = await selectAll(client, 'stok_hareketleri', '*');
        replaceArray(ctx.stockMoves, rows.map((r) => ({
          dbId: r.id,
          id: `MV-${r.id.slice(0, 8)}`,
          company: companyNameById(ctx.companies, r.firma_id) || '',
          sku: r.sku,
          type: r.tip,
          qty: Number(r.miktar) || 0,
          unit: r.birim || '',
          note: r.not_metni || '',
          date: r.tarih,
          ref: r.referans || '',
        })));
      }
    }
  }

  // ─── Catalogs (persist) ────────────────────────────────────────────────────
  /** Materyal kataloğunu Supabase'e yazar (grup + alaşım ekle/güncelle/sil). */
  async function saveMaterialCatalog(catalog) {
    try {
      const client = sb();
      if (!client || !catalog || typeof catalog !== 'object') return fail('no-client', 'saveMaterialCatalog');
      const groupNames = Object.keys(catalog);
      const groups = await ensureMaterialGroups(client, groupNames);
      const existing = await selectAll(client, 'malzemeler', 'id');
      const keepIds = new Set();

      for (const [gName, alloys] of Object.entries(catalog)) {
        const gid = groups[gName];
        if (!gid) continue;
        for (const a of alloys || []) {
          if (!a?.name) continue;
          const row = {
            malzeme_grup_id: gid,
            ad: a.name,
            ozkutle: a.density ?? 0,
            fiyat_eur_kg: a.priceEurPerKg ?? 0,
            aktif: true,
          };
          if (a.dbId) {
            const { error } = await client.from('malzemeler').update(row).eq('id', a.dbId);
            if (error) throw error;
            keepIds.add(a.dbId);
          } else {
            const { data, error } = await client
              .from('malzemeler')
              .upsert(row, { onConflict: 'malzeme_grup_id,ad' })
              .select('id')
              .single();
            if (error) throw error;
            a.dbId = data.id;
            keepIds.add(data.id);
          }
        }
      }

      const toDelete = (existing || []).map((r) => r.id).filter((id) => !keepIds.has(id));
      if (toDelete.length) {
        const { error } = await client.from('malzemeler').delete().in('id', toDelete);
        if (error) throw error;
      }
      return ok({ saved: keepIds.size, deleted: toDelete.length });
    } catch (e) {
      return fail(e, 'saveMaterialCatalog');
    }
  }

  async function saveNamedPriceCatalog(table, arr, label) {
    try {
      const client = sb();
      if (!client || !Array.isArray(arr)) return fail('no-client', label);
      const existing = await selectAll(client, table, 'id');
      const keepIds = new Set();
      for (const h of arr) {
        if (!h?.name) continue;
        const row = {
          ad: h.name,
          fiyat_eur_kg: h.priceEurPerKg || 0,
          fiyat_eur_adet: h.priceEurPerPcs || 0,
          aktif: true,
        };
        if (h.dbId) {
          const { error } = await client.from(table).update(row).eq('id', h.dbId);
          if (error) throw error;
          keepIds.add(h.dbId);
        } else {
          const { data, error } = await client
            .from(table)
            .upsert(row, { onConflict: 'ad' })
            .select('id')
            .single();
          if (error) throw error;
          h.dbId = data.id;
          keepIds.add(data.id);
        }
      }
      const toDelete = (existing || []).map((r) => r.id).filter((id) => !keepIds.has(id));
      if (toDelete.length) {
        const { error } = await client.from(table).delete().in('id', toDelete);
        if (error) throw error;
      }
      return ok({ saved: keepIds.size, deleted: toDelete.length });
    } catch (e) {
      return fail(e, label);
    }
  }

  async function saveHeatTreatmentCatalog(arr) {
    return saveNamedPriceCatalog('isil_islem_katalogu', arr, 'saveHeatTreatmentCatalog');
  }
  async function saveCoatingCatalog(arr) {
    return saveNamedPriceCatalog('kaplama_katalogu', arr, 'saveCoatingCatalog');
  }
  async function saveFasonMfgCatalog(arr) {
    try {
      const client = sb();
      const label = 'saveFasonMfgCatalog';
      if (!client || !Array.isArray(arr)) return fail('no-client', label);
      let existing = [];
      try {
        existing = await selectAll(client, 'fason_imalat_katalogu', 'id');
      } catch (e) {
        return fail(e?.message || e || 'fason_imalat_katalogu tablosu yok — SQL 016 çalıştırın', label);
      }
      const keepIds = new Set();
      for (const h of arr) {
        if (!h?.name) continue;
        const row = {
          ad: h.name,
          fiyat_eur_saat: h.priceEurPerHour || 0,
          fiyat_eur_adet: h.priceEurPerPcs || 0,
          aktif: true,
        };
        if (h.dbId) {
          const { error } = await client.from('fason_imalat_katalogu').update(row).eq('id', h.dbId);
          if (error) throw error;
          keepIds.add(h.dbId);
        } else {
          const { data, error } = await client
            .from('fason_imalat_katalogu')
            .upsert(row, { onConflict: 'ad' })
            .select('id')
            .single();
          if (error) throw error;
          h.dbId = data.id;
          keepIds.add(data.id);
        }
      }
      const toDelete = (existing || []).map((r) => r.id).filter((id) => !keepIds.has(id));
      if (toDelete.length) {
        const { error } = await client.from('fason_imalat_katalogu').delete().in('id', toDelete);
        if (error) throw error;
      }
      return ok({ saved: keepIds.size, deleted: toDelete.length });
    } catch (e) {
      return fail(e, 'saveFasonMfgCatalog');
    }
  }

  async function upsertMachineRow(client, row, dbId) {
    const withFns = { ...row };
    if (dbId) {
      let { error } = await client.from('makineler').update(withFns).eq('id', dbId);
      if (error && /fonksiyonlar/i.test(error.message || '')) {
        delete withFns.fonksiyonlar;
        ({ error } = await client.from('makineler').update(withFns).eq('id', dbId));
      }
      if (error) throw error;
      return dbId;
    }
    let { data, error } = await client.from('makineler').insert(withFns).select('id').single();
    if (error && /fonksiyonlar/i.test(error.message || '')) {
      delete withFns.fonksiyonlar;
      ({ data, error } = await client.from('makineler').insert(withFns).select('id').single());
    }
    if (error) throw error;
    return data.id;
  }

  /** Makine parkı tam senkron: atölye + firma paylaşımı + makineler */
  async function saveMachinePark(park, companies) {
    try {
      const client = sb();
      if (!client || !Array.isArray(park)) return fail('no-client', 'saveMachinePark');
      const existingWs = await selectAll(client, 'atolyeler', 'id');
      const keepWsIds = new Set();

      for (const ws of park) {
        if (!ws?.workshop) continue;
        let atId = ws.dbId || null;
        if (atId) {
          const { error } = await client.from('atolyeler').update({ ad: ws.workshop }).eq('id', atId);
          if (error) throw error;
        } else {
          const { data, error } = await client
            .from('atolyeler')
            .upsert({ ad: ws.workshop }, { onConflict: 'ad' })
            .select('id')
            .single();
          if (error) throw error;
          atId = data.id;
          ws.dbId = atId;
        }
        keepWsIds.add(atId);

        await client.from('atolye_firmalar').delete().eq('atolye_id', atId);
        const links = (ws.companies || [])
          .map((n) => firmaId(companies, n))
          .filter(Boolean)
          .map((fid) => ({ atolye_id: atId, firma_id: fid }));
        if (links.length) {
          const { error } = await client.from('atolye_firmalar').upsert(links);
          if (error) throw error;
        }

        const { data: exM, error: exErr } = await client
          .from('makineler')
          .select('id')
          .eq('atolye_id', atId);
        if (exErr) throw exErr;
        const keepM = new Set();
        for (const m of (ws.machines || [])) {
          if (!m?.name) continue;
          const row = {
            atolye_id: atId,
            ad: m.name,
            alt_bilgi: m.sub || null,
            ikon: m.icon || 'mill',
            aktif: true,
            fonksiyonlar: Array.isArray(m.functions) ? m.functions : [],
          };
          const id = await upsertMachineRow(client, row, m.dbId || null);
          m.dbId = id;
          keepM.add(id);
        }
        const toDelM = (exM || []).map((r) => r.id).filter((id) => !keepM.has(id));
        if (toDelM.length) {
          const { error } = await client.from('makineler').delete().in('id', toDelM);
          if (error) throw error;
        }
      }

      const toDelWs = (existingWs || []).map((r) => r.id).filter((id) => !keepWsIds.has(id));
      if (toDelWs.length) {
        const { error } = await client.from('atolyeler').delete().in('id', toDelWs);
        if (error) throw error;
      }
      return ok({ workshops: keepWsIds.size, deletedWorkshops: toDelWs.length });
    } catch (e) {
      return fail(e, 'saveMachinePark');
    }
  }

  // ─── Catalogs ──────────────────────────────────────────────────────────────
  async function hydrateCatalogs(ctx) {
    const client = sb();
    if (!client) return;

    // Malzeme katalogu
    if (ctx.procMaterialCatalog) {
      const n = await countTable(client, 'malzemeler');
      if (!n) {
        if (alreadySeeded()) {
          assignObject(ctx.procMaterialCatalog, {});
        } else {
        progress(ctx, 'Malzeme katalogu seed…');
        const groups = await ensureMaterialGroups(client, Object.keys(ctx.procMaterialCatalog));
        const rows = [];
        Object.entries(ctx.procMaterialCatalog).forEach(([gName, alloys]) => {
          const gid = groups[gName];
          if (!gid) return;
          (alloys || []).forEach((a) => {
            rows.push({
              malzeme_grup_id: gid,
              ad: a.name,
              ozkutle: a.density ?? 0,
              fiyat_eur_kg: a.priceEurPerKg ?? 0,
            });
          });
        });
        if (rows.length) await client.from('malzemeler').upsert(rows, { onConflict: 'malzeme_grup_id,ad' });
        }
      } else {
        progress(ctx, 'Malzeme katalogu hydrate…');
        await ensureMaterialGroups(client, []);
        const rows = await selectAll(client, 'malzemeler', '*, malzeme_gruplari(ad)');
        const cat = {};
        rows.forEach((r) => {
          const g = r.malzeme_gruplari?.ad || 'Diğer';
          (cat[g] ||= []).push({
            name: r.ad,
            density: Number(r.ozkutle) || 0,
            priceEurPerKg: Number(r.fiyat_eur_kg) || 0,
            dbId: r.id,
          });
        });
        assignObject(ctx.procMaterialCatalog, cat);
      }
    }

    // Ürün şekilleri (volume fn yerel kalır — sadece meta sync)
    if (ctx.productShapes && Array.isArray(ctx.productShapes)) {
      const n = await countTable(client, 'urun_sekilleri');
      if (!n) {
        progress(ctx, 'Ürün şekilleri seed…');
        const rows = ctx.productShapes.map((s) => ({
          kod: s.id,
          ad: s.name,
          alanlar: s.fields || [],
        }));
        if (rows.length) await client.from('urun_sekilleri').upsert(rows, { onConflict: 'kod' });
      } else {
        progress(ctx, 'Ürün şekilleri hydrate…');
        const rows = await selectAll(client, 'urun_sekilleri', '*');
        const byKod = Object.fromEntries(ctx.productShapes.map((s) => [s.id, s]));
        const merged = rows.map((r) => {
          const prev = byKod[r.kod];
          // Alan adları ve hacim formülü istemcide kaynak: eski DB alanlar[] uyumsuz kalırsa kg=0 olmasın
          return {
            id: r.kod,
            name: prev?.name || r.ad,
            fields: (prev?.fields && prev.fields.length) ? prev.fields : (r.alanlar || []),
            dbId: r.id,
            volumeMm3: prev?.volumeMm3 || (() => 0),
          };
        });
        // Yerelde olup bulutta olmayan şekilleri koru (volume fn)
        ctx.productShapes.forEach((s) => {
          if (!merged.some((m) => m.id === s.id)) merged.push(s);
        });
        replaceArray(ctx.productShapes, merged);
      }
    }

    // Isıl / kaplama / fason imalat
    // NOT: alreadySeeded + boş tablo → diziyi silme (yeni eklenen tablolarda veri kaybı yapıyordu).
    // Boşsa mevcut yerel diziyi seed et; tablo yoksa yerel dizi korunur.
    async function syncNamedCatalog(table, arr, mapTo, mapFrom) {
      if (!arr) return;
      let n = 0;
      try {
        n = await countTable(client, table);
      } catch (e) {
        console.warn(`[BtdCloud] katalog okunamadı (${table}) — yerel dizi korunuyor:`, e?.message || e);
        return;
      }
      if (!n) {
        if (!arr.length) return;
        const { error } = await client.from(table).upsert(arr.map(mapTo), { onConflict: 'ad' });
        if (error) {
          console.warn(`[BtdCloud] katalog seed başarısız (${table}):`, error.message || error);
          return;
        }
        try {
          const rows = await selectAll(client, table, '*');
          if (rows.length) replaceArray(arr, rows.map(mapFrom));
        } catch (_) { /* ids sonra save ile gelir */ }
        return;
      }
      const rows = await selectAll(client, table, '*');
      replaceArray(arr, rows.map(mapFrom));
    }
    await syncNamedCatalog(
      'isil_islem_katalogu',
      ctx.heatTreatmentCatalog,
      (h) => ({ ad: h.name, fiyat_eur_kg: h.priceEurPerKg || 0, fiyat_eur_adet: h.priceEurPerPcs || 0 }),
      (r) => ({ dbId: r.id, name: r.ad, priceEurPerKg: Number(r.fiyat_eur_kg) || 0, priceEurPerPcs: Number(r.fiyat_eur_adet) || 0 })
    );
    await syncNamedCatalog(
      'kaplama_katalogu',
      ctx.coatingCatalog,
      (h) => ({ ad: h.name, fiyat_eur_kg: h.priceEurPerKg || 0, fiyat_eur_adet: h.priceEurPerPcs || 0 }),
      (r) => ({ dbId: r.id, name: r.ad, priceEurPerKg: Number(r.fiyat_eur_kg) || 0, priceEurPerPcs: Number(r.fiyat_eur_adet) || 0 })
    );
    await syncNamedCatalog(
      'fason_imalat_katalogu',
      ctx.fasonMfgCatalog,
      (h) => ({ ad: h.name, fiyat_eur_saat: h.priceEurPerHour || 0, fiyat_eur_adet: h.priceEurPerPcs || 0 }),
      (r) => ({ dbId: r.id, name: r.ad, priceEurPerHour: Number(r.fiyat_eur_saat) || 0, priceEurPerPcs: Number(r.fiyat_eur_adet) || 0 })
    );

    // Operasyon katalogu
    if (ctx.operationCatalog && Array.isArray(ctx.operationCatalog)) {
      const n = await countTable(client, 'operasyon_kategorileri');
      if (!n) {
        progress(ctx, 'Operasyon katalogu seed…');
        for (let i = 0; i < ctx.operationCatalog.length; i++) {
          const cat = ctx.operationCatalog[i];
          const { data, error } = await client
            .from('operasyon_kategorileri')
            .upsert({ ad: cat.name, renk: cat.color || null, sira: i }, { onConflict: 'ad' })
            .select('id')
            .single();
          if (error) throw error;
          const steps = (cat.steps || []).map((ad, si) => ({ kategori_id: data.id, ad, sira: si }));
          if (steps.length) await client.from('operasyon_adimlari').upsert(steps, { onConflict: 'kategori_id,ad' });
        }
      } else {
        progress(ctx, 'Operasyon katalogu hydrate…');
        const rows = await selectAll(client, 'operasyon_kategorileri', '*, operasyon_adimlari(*)');
        replaceArray(ctx.operationCatalog, rows
          .sort((a, b) => (a.sira || 0) - (b.sira || 0))
          .map((r) => ({
            dbId: r.id,
            name: r.ad,
            color: r.renk || 'sky',
            steps: (r.operasyon_adimlari || [])
              .sort((a, b) => (a.sira || 0) - (b.sira || 0))
              .map((s) => s.ad),
          })));
      }
    }

    // Makine parkı
    if (ctx.machinePark && Array.isArray(ctx.machinePark)) {
      const n = await countTable(client, 'atolyeler');
      if (!n) {
        progress(ctx, 'Makine parkı seed…');
        for (const ws of ctx.machinePark) {
          const { data: at, error } = await client
            .from('atolyeler')
            .upsert({ ad: ws.workshop }, { onConflict: 'ad' })
            .select('id')
            .single();
          if (error) throw error;
          const links = (ws.companies || [])
            .map((n) => firmaId(ctx.companies, n))
            .filter(Boolean)
            .map((fid) => ({ atolye_id: at.id, firma_id: fid }));
          if (links.length) await client.from('atolye_firmalar').upsert(links);
          const machines = (ws.machines || []).map((m) => ({
            atolye_id: at.id,
            ad: m.name,
            alt_bilgi: m.sub || null,
            ikon: m.icon || null,
            fonksiyonlar: Array.isArray(m.functions) ? m.functions : [],
          }));
          if (machines.length) await client.from('makineler').insert(machines);
        }
      } else {
        progress(ctx, 'Makine parkı hydrate…');
        const rows = await selectAll(
          client,
          'atolyeler',
          '*, makineler(*), atolye_firmalar(firma_id, firmalar(ad))'
        );
        replaceArray(ctx.machinePark, rows.map((r) => ({
          dbId: r.id,
          workshop: r.ad,
          companies: (r.atolye_firmalar || []).map((af) => af.firmalar?.ad).filter(Boolean),
          machines: (r.makineler || [])
            .filter((m) => m.aktif !== false)
            .map((m) => ({
              dbId: m.id,
              name: m.ad,
              sub: m.alt_bilgi || '',
              icon: m.ikon || 'mill',
              functions: Array.isArray(m.fonksiyonlar) ? m.fonksiyonlar : [],
            })),
        })));
      }
    }

    // Döviz
    if (ctx.fxRates) {
      const { data: fxRows } = await client.from('doviz_kurlari').select('*').order('tarih', { ascending: false }).limit(1);
      if (!fxRows?.length) {
        const d = (ctx.fxRates.date || '').replace(/[^\d-]/g, '').slice(0, 10)
          || new Date().toISOString().slice(0, 10);
        await client.from('doviz_kurlari').upsert({
          tarih: d,
          eur_try: ctx.fxRates.EURTRY || 0,
          usd_try: ctx.fxRates.USDTRY || 0,
          eur_usd: ctx.fxRates.EURUSD || null,
          manuel: !!(String(ctx.fxRates.date || '').includes('Manuel')),
        }, { onConflict: 'tarih' });
      } else {
        const r = fxRows[0];
        Object.assign(ctx.fxRates, {
          date: r.tarih,
          EURTRY: Number(r.eur_try),
          USDTRY: Number(r.usd_try),
          EURUSD: Number(r.eur_usd) || (Number(r.eur_try) / Number(r.usd_try)),
        });
      }
    }

    // Resmi tatiller
    if (ctx.turkishHolidays2026 && (ctx.turkishHolidays2026 instanceof Set || Array.isArray(ctx.turkishHolidays2026))) {
      const { count } = await client.from('resmi_tatiller').select('tarih', { count: 'exact', head: true });
      const localDates = ctx.turkishHolidays2026 instanceof Set
        ? [...ctx.turkishHolidays2026]
        : [...ctx.turkishHolidays2026];
      if (!count && localDates.length) {
        await client.from('resmi_tatiller').upsert(
          localDates.map((d) => ({ tarih: d, aciklama: null })),
          { onConflict: 'tarih' }
        );
      } else if (count) {
        const rows = await selectAll(client, 'resmi_tatiller', 'tarih');
        const set = new Set(rows.map((r) => r.tarih));
        if (ctx.turkishHolidays2026 instanceof Set) {
          ctx.turkishHolidays2026.clear();
          set.forEach((d) => ctx.turkishHolidays2026.add(d));
        }
      }
    }
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  async function boot(ctx) {
    const client = sb();
    if (!client) {
      console.warn('[BtdCloud] boot: Supabase istemcisi yok — yerel veri kullanılacak');
      return { ok: false, reason: 'no-client' };
    }
    if (!ctx?.companies) {
      return fail('companies gerekli', 'boot');
    }
    const hasFirma = Object.values(ctx.companies).some((c) => c?.dbId);
    if (!hasFirma) {
      console.warn('[BtdCloud] boot: firma dbId yok — önce BtdSupabase.hydrateCompanies çalıştırın');
      return { ok: false, reason: 'no-firma-ids' };
    }

    progress(ctx, 'Bulut senkron başlıyor…');
    const steps = [
      ['kataloglar', () => hydrateCatalogs(ctx)],
      ['müşteriler', () => hydrateCustomers(ctx)],
      ['tedarikçiler', () => hydrateSuppliers(ctx)],
      ['öncelikler', () => hydrateSupplierGroupPriorities(ctx)],
      ['personel', () => hydratePersonnel(ctx)],
      ['devam/izin', () => hydrateAttendanceLeave(ctx)],
      ['kullanıcılar', () => hydrateUsers(ctx)],
      ['maliyet', () => hydrateCostAnalyses(ctx)],
      ['teklifler', () => hydrateQuotes(ctx)],
      ['siparişler', () => hydrateOrders(ctx)],
      ['iş emirleri', () => hydrateWorkOrders(ctx)],
      ['tedarik', () => hydrateProcurement(ctx)],
      ['rfq', () => hydrateMaterialRfqs(ctx)],
      ['yeniden/beklenmeyen', () => hydrateReprocUnforeseen(ctx)],
      ['fason/qc/sevkiyat/fatura/stok', () => hydrateFasonQcShipInvoiceStock(ctx)],
    ];

    const results = {};
    for (const [name, fn] of steps) {
      try {
        await fn();
        results[name] = 'ok';
      } catch (e) {
        results[name] = e?.message || String(e);
        console.warn(`[BtdCloud] boot adımı başarısız (${name}):`, results[name]);
      }
    }
    progress(ctx, 'Bulut senkron tamamlandı');
    markSeeded();
    return ok({ results });
  }

  // ─── Export ────────────────────────────────────────────────────────────────
  global.BtdCloud = {
    currencyToDb,
    currencyToUi,
    firmaId,
    sb,
    boot,
    saveCustomer,
    deleteCustomer,
    saveSupplier,
    deleteSupplier,
    savePersonnel,
    deletePersonnel,
    saveUser,
    deleteUser,
    saveCostAnalysis,
    deleteCostAnalysis,
    saveQuote,
    deleteQuote,
    saveOrder,
    deleteOrder,
    saveWorkOrder,
    deleteWorkOrder,
    saveProcurementItem,
    deleteProcurementItem,
    saveMaterialRfq,
    saveReproc,
    saveUnforeseen,
    saveFason,
    deleteFason,
    saveQc,
    deleteQc,
    saveShipment,
    deleteShipment,
    saveInvoice,
    deleteInvoice,
    saveStockItem,
    saveStockMove,
    saveSupplierGroupPriorities,
    saveMaterialCatalog,
    saveHeatTreatmentCatalog,
    saveCoatingCatalog,
    saveFasonMfgCatalog,
    saveMachinePark,
  };
})(typeof window !== 'undefined' ? window : globalThis);
