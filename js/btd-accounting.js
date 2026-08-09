/**
 * BTD · Cari defter / hareket (Paraşüt Excel + elle fiş)
 * Kart kimlik alanlarına yazmaz; eşleşme yalnızca vergi no (firma bazlı).
 */
(function (global) {
  'use strict';

  const DOC_TYPES = {
    invoice_sales: 'Satış faturası',
    invoice_purchase: 'Alış faturası',
    collection: 'Tahsilat',
    payment: 'Ödeme',
    debit: 'Borç fişi',
    credit: 'Alacak fişi',
    opening: 'Açılış / bakiye',
    other: 'Diğer',
  };

  function digitsOnly(s) {
    return String(s == null ? '' : s).replace(/\D/g, '');
  }

  function isCheckableTaxNo(taxNo) {
    const dig = digitsOnly(taxNo);
    return dig.length === 10 || dig.length === 11 ? dig : '';
  }

  function uid(prefix) {
    return `${prefix || 'CM'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseMoney(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    let s = String(v).trim().replace(/\s/g, '').replace(/₺|TL|TRY/gi, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function excelDateToIso(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.toISOString().slice(0, 10);
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Excel serial
      const epoch = Date.UTC(1899, 11, 30);
      const d = new Date(epoch + Math.round(v) * 86400000);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      let yy = m[3];
      if (yy.length === 2) yy = `20${yy}`;
      return `${yy}-${mm}-${dd}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    return '';
  }

  function pickCol(row, aliases) {
    const keys = Object.keys(row || {});
    for (const a of aliases) {
      const hit = keys.find((k) => String(k).trim().toLocaleLowerCase('tr-TR') === a.toLocaleLowerCase('tr-TR'));
      if (hit != null && row[hit] !== undefined && row[hit] !== null && String(row[hit]).trim() !== '') return row[hit];
    }
    for (const a of aliases) {
      const hit = keys.find((k) => String(k).toLocaleLowerCase('tr-TR').includes(a.toLocaleLowerCase('tr-TR')));
      if (hit != null && row[hit] !== undefined && row[hit] !== null && String(row[hit]).trim() !== '') return row[hit];
    }
    return '';
  }

  function buildExternalKey(parts) {
    const raw = [
      parts.company || '',
      parts.taxNo || '',
      parts.date || '',
      parts.docNo || '',
      Number(parts.debit) || 0,
      Number(parts.credit) || 0,
      String(parts.description || '').slice(0, 80),
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    return `px-${Math.abs(h).toString(36)}-${raw.length}`;
  }

  function findPartyByTaxNo(company, taxNo, customers, suppliers) {
    const dig = isCheckableTaxNo(taxNo);
    if (!dig || !company) return { customer: null, supplier: null, dig: '' };
    const customer = (customers || []).find((c) => c && c.company === company && digitsOnly(c.taxNo) === dig) || null;
    const supplier = (suppliers || []).find((s) => s && s.company === company && digitsOnly(s.taxNo) === dig) || null;
    return { customer, supplier, dig };
  }

  function movementNet(m) {
    return (Number(m.debit) || 0) - (Number(m.credit) || 0);
  }

  /** Aynı vergi no + firma için hareket bakiyesi (borç − alacak) */
  function balanceForTaxNo(movements, company, taxNo) {
    const dig = digitsOnly(taxNo);
    if (!dig) return 0;
    return (movements || [])
      .filter((m) =>
        m &&
        m.company === company &&
        digitsOnly(m.taxNo) === dig &&
        m.approvalStatus !== 'orphan_rejected' &&
        m.approvalStatus !== 'pending'
      )
      .reduce((sum, m) => sum + movementNet(m), 0);
  }

  function companyMovementSummary(movements, company) {
    const list = (movements || []).filter((m) => m && m.company === company && m.approvalStatus !== 'orphan_rejected' && m.approvalStatus !== 'pending');
    let debit = 0;
    let credit = 0;
    list.forEach((m) => {
      debit += Number(m.debit) || 0;
      credit += Number(m.credit) || 0;
    });
    return { debit, credit, net: debit - credit, count: list.length };
  }

  function movementsForTaxNo(movements, company, taxNo) {
    const dig = digitsOnly(taxNo);
    return (movements || [])
      .filter((m) => m && m.company === company && digitsOnly(m.taxNo) === dig && m.approvalStatus !== 'orphan_rejected')
      .slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id || '').localeCompare(String(b.id || '')));
  }

  function withRunningBalance(list) {
    let run = 0;
    return list.map((m) => {
      run += movementNet(m);
      return Object.assign({}, m, { balanceAfter: run });
    });
  }

  function buildAccountsIndex(company, customers, suppliers, movements) {
    const byTax = new Map();
    const touch = (party, side) => {
      const dig = isCheckableTaxNo(party.taxNo);
      if (!dig || party.company !== company) return;
      let row = byTax.get(dig);
      if (!row) {
        row = {
          taxNo: dig,
          name: party.name || '',
          side: side,
          customer: null,
          supplier: null,
          balance: 0,
          lastDate: '',
          movementCount: 0,
        };
        byTax.set(dig, row);
      }
      if (side === 'customer') row.customer = party;
      if (side === 'supplier') row.supplier = party;
      if (!row.name && party.name) row.name = party.name;
      if (row.customer && row.supplier) row.side = 'both';
      else if (row.customer) row.side = 'customer';
      else if (row.supplier) row.side = 'supplier';
    };
    (customers || []).filter((c) => c && c.company === company).forEach((c) => touch(c, 'customer'));
    (suppliers || []).filter((s) => s && s.company === company).forEach((s) => touch(s, 'supplier'));

    (movements || [])
      .filter((m) => m && m.company === company && m.approvalStatus !== 'orphan_rejected' && m.approvalStatus !== 'pending')
      .forEach((m) => {
        const dig = isCheckableTaxNo(m.taxNo);
        if (!dig) return;
        let row = byTax.get(dig);
        if (!row) {
          row = {
            taxNo: dig,
            name: m.partyName || '—',
            side: m.side || 'unknown',
            customer: null,
            supplier: null,
            balance: 0,
            lastDate: '',
            movementCount: 0,
          };
          byTax.set(dig, row);
        }
        row.balance += movementNet(m);
        row.movementCount += 1;
        if (m.date && (!row.lastDate || m.date > row.lastDate)) row.lastDate = m.date;
        if (!row.name && m.partyName) row.name = m.partyName;
      });

    // Bakiye hareketlerden (kart tlBalance üzerine yazmadan hesapla)
    byTax.forEach((row, dig) => {
      row.balance = balanceForTaxNo(movements, company, dig);
    });

    return Array.from(byTax.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.name.localeCompare(b.name, 'tr'));
  }

  /**
   * Kart kimlik alanlarına dokunmadan yalnızca tlBalance güncelle.
   */
  function syncCardBalancesOnly(company, customers, suppliers, movements) {
    const digs = new Set();
    (movements || []).forEach((m) => {
      if (m && m.company === company) {
        const d = isCheckableTaxNo(m.taxNo);
        if (d) digs.add(d);
      }
    });
    digs.forEach((dig) => {
      const bal = balanceForTaxNo(movements, company, dig);
      (customers || []).forEach((c) => {
        if (c && c.company === company && digitsOnly(c.taxNo) === dig) c.tlBalance = bal;
      });
      (suppliers || []).forEach((s) => {
        if (s && s.company === company && digitsOnly(s.taxNo) === dig) s.tlBalance = bal;
      });
    });
  }

  function createManualMovement(opts) {
    const dig = isCheckableTaxNo(opts.taxNo);
    if (!dig) return { ok: false, reason: 'Vergi numarası 10 veya 11 hane olmalı.' };
    const debit = Math.max(0, parseMoney(opts.debit));
    const credit = Math.max(0, parseMoney(opts.credit));
    if (debit <= 0 && credit <= 0) return { ok: false, reason: 'Borç veya alacak tutarı girin.' };
    if (debit > 0 && credit > 0) return { ok: false, reason: 'Borç ve alacak aynı anda girilemez.' };
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const docNo = String(opts.docNo || '').trim();
    const description = String(opts.description || '').trim();
    const externalKey = buildExternalKey({
      company: opts.company,
      taxNo: dig,
      date,
      docNo,
      debit,
      credit,
      description,
    });
    return {
      ok: true,
      movement: {
        id: uid('CM'),
        company: opts.company,
        taxNo: dig,
        partyKey: opts.partyKey || '',
        partyName: opts.partyName || '',
        side: opts.side || 'unknown',
        date,
        docNo,
        docType: opts.docType || 'other',
        description,
        debit,
        credit,
        currency: opts.currency || 'TRY',
        source: 'manual',
        externalKey,
        importBatchId: null,
        approvalStatus: 'linked',
        createdAt: new Date().toISOString(),
      },
    };
  }

  function parseWorkbookToPreview(wb, company, customers, suppliers, existingMovements) {
    const sheetName =
      wb.SheetNames.find((n) => /hareket|ekstre|fiş|fis|işlem|islem|transaction/i.test(n)) ||
      wb.SheetNames.find((n) => /müşteri|musteri|cari|tedarik/i.test(n)) ||
      wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const XLSX = global.XLSX;
    if (!XLSX) return { ok: false, reason: 'XLSX yok', rows: [] };
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    const existingKeys = new Set((existingMovements || []).map((m) => m.externalKey).filter(Boolean));
    const pendingByTax = new Map();
    const rows = [];
    let matched = 0;
    let pendingNew = 0;
    let skipped = 0;
    let noTax = 0;

    raw.forEach((row, idx) => {
      const name = String(
        pickCol(row, ['Müşteri/tedarikçi ismi', 'Cari', 'Cari Ünvan', 'Unvan', 'Ünvan', 'isim', 'adı', 'adi', 'Firma', 'Firma Adı']) || ''
      ).trim();
      const taxRaw = pickCol(row, [
        'Vergi numarası/TC kimlik no',
        'Vergi numarası/TC',
        'Vergi No',
        'Vergi numarası',
        'vergi no',
        'vkn',
        'tckn',
        'TC',
      ]);
      const dig = isCheckableTaxNo(taxRaw);
      if (!dig) {
        if (name || pickCol(row, ['Borç', 'Alacak', 'TL Bakiye', 'Bakiye'])) noTax += 1;
        return;
      }

      const date = excelDateToIso(pickCol(row, ['Tarih', 'İşlem Tarihi', 'Fiş Tarihi', 'Belge Tarihi', 'Date']));
      const docNo = String(pickCol(row, ['Belge No', 'Fiş No', 'Fatura No', 'Evrak No', 'No', 'Document']) || '').trim();
      const description = String(pickCol(row, ['Açıklama', 'Aciklama', 'Description', 'Not', 'Açıklamalar']) || '').trim();
      let debit = parseMoney(pickCol(row, ['Borç', 'Borc', 'Debit', 'Borç Tutarı']));
      let credit = parseMoney(pickCol(row, ['Alacak', 'Credit', 'Alacak Tutarı']));
      const balanceOnly = parseMoney(pickCol(row, ['TL Bakiye', 'Bakiye', 'TRY Bakiye', 'Kalan']));

      let docType = 'other';
      if (!debit && !credit && balanceOnly) {
        // Tek satırlık bakiye → açılış hareketi
        if (balanceOnly > 0) debit = balanceOnly;
        else credit = Math.abs(balanceOnly);
        docType = 'opening';
      } else if (debit > 0 && credit > 0) {
        // İkisi doluysa netle
        const net = debit - credit;
        debit = net > 0 ? net : 0;
        credit = net < 0 ? Math.abs(net) : 0;
      }

      if (debit <= 0 && credit <= 0) {
        skipped += 1;
        return;
      }

      const externalKey = buildExternalKey({
        company,
        taxNo: dig,
        date: date || 'nodate',
        docNo: docNo || `r${idx}`,
        debit,
        credit,
        description: description || name,
      });
      if (existingKeys.has(externalKey)) {
        skipped += 1;
        rows.push({
          selected: false,
          status: 'skip',
          reason: 'Mükerrer',
          taxNo: dig,
          name,
          date,
          docNo,
          description,
          debit,
          credit,
          docType,
          externalKey,
        });
        return;
      }

      const hit = findPartyByTaxNo(company, dig, customers, suppliers);
      let status = 'matched';
      let side = 'unknown';
      if (hit.customer && hit.supplier) side = 'both';
      else if (hit.customer) side = 'customer';
      else if (hit.supplier) side = 'supplier';
      else {
        status = 'pending_new';
        side = balanceOnly < 0 || credit > debit ? 'supplier' : 'customer';
        if (!pendingByTax.has(dig)) {
          pendingByTax.set(dig, {
            taxNo: dig,
            suggestedName: name || `Vergi no ${dig}`,
            suggestedRole: side === 'supplier' ? 'supplier' : 'customer',
            movementCount: 0,
          });
        }
        const p = pendingByTax.get(dig);
        if (name && (!p.suggestedName || p.suggestedName.startsWith('Vergi'))) p.suggestedName = name;
        p.movementCount += 1;
      }

      if (status === 'matched') matched += 1;
      else pendingNew += 1;

      rows.push({
        selected: status !== 'skip',
        status,
        reason: status === 'matched' ? 'Eşleşti' : 'Yeni cari — onay gerekli',
        taxNo: dig,
        name: hit.customer?.name || hit.supplier?.name || name,
        date: date || new Date().toISOString().slice(0, 10),
        docNo,
        description: description || (docType === 'opening' ? 'Paraşüt bakiyesi (açılış)' : ''),
        debit,
        credit,
        docType,
        externalKey,
        side,
        partyName: hit.customer?.name || hit.supplier?.name || name,
      });
    });

    return {
      ok: true,
      sheetName,
      rows,
      pendingParties: Array.from(pendingByTax.values()),
      stats: { matched, pendingNew, skipped, noTax, total: rows.length },
    };
  }

  function applyPreviewImport(previewRows, company, movements, pendingApprovals, importBatchId) {
    const batch = importBatchId || uid('IMP');
    let added = 0;
    let pendingMoves = 0;
    const existingKeys = new Set((movements || []).map((m) => m.externalKey).filter(Boolean));
    const selected = (previewRows || []).filter((r) => r.selected && r.status !== 'skip');

    selected.forEach((r) => {
      if (existingKeys.has(r.externalKey)) return;
      const isPending = r.status === 'pending_new';
      const mov = {
        id: uid('CM'),
        company,
        taxNo: r.taxNo,
        partyKey: '',
        partyName: r.partyName || r.name || '',
        side: r.side || 'unknown',
        date: r.date || new Date().toISOString().slice(0, 10),
        docNo: r.docNo || '',
        docType: r.docType || 'other',
        description: r.description || '',
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        currency: 'TRY',
        source: 'parasut_excel',
        externalKey: r.externalKey,
        importBatchId: batch,
        approvalStatus: isPending ? 'pending' : 'linked',
        createdAt: new Date().toISOString(),
      };
      movements.push(mov);
      existingKeys.add(r.externalKey);
      added += 1;
      if (isPending) pendingMoves += 1;
    });

    // Pending approval kayıtları
    const pendingTaxes = new Set(
      selected.filter((r) => r.status === 'pending_new').map((r) => r.taxNo)
    );
    pendingTaxes.forEach((dig) => {
      const exists = (pendingApprovals || []).find(
        (p) => p.company === company && digitsOnly(p.taxNo) === dig && p.status === 'pending'
      );
      if (exists) {
        exists.movementCount = (movements || []).filter(
          (m) => m.company === company && digitsOnly(m.taxNo) === dig && m.approvalStatus === 'pending'
        ).length;
        exists.sampleBalance = balanceForTaxNo(movements, company, dig);
        return;
      }
      const sample = selected.find((r) => r.taxNo === dig);
      pendingApprovals.push({
        id: uid('PCA'),
        company,
        taxNo: dig,
        suggestedName: sample?.partyName || sample?.name || `Vergi no ${dig}`,
        suggestedRole: sample?.side === 'supplier' ? 'supplier' : sample?.side === 'both' ? 'both' : 'customer',
        suggestedCategory: 'Hammadde',
        movementCount: (movements || []).filter(
          (m) => m.company === company && digitsOnly(m.taxNo) === dig && m.approvalStatus === 'pending'
        ).length,
        sampleBalance: balanceForTaxNo(movements, company, dig),
        status: 'pending',
        createdAt: new Date().toISOString(),
        importBatchId: batch,
      });
    });

    return { ok: true, added, pendingMoves, batch };
  }

  /**
   * Onay: minimal kart oluştur (mevcut kart varsa alanlarına dokunma).
   */
  function approvePendingCari(pending, opts, customers, suppliers, movements, buildPartyKeyFn, guessShortNameFn) {
    if (!pending || pending.status !== 'pending') return { ok: false, reason: 'Geçersiz onay kaydı' };
    const company = pending.company;
    const dig = isCheckableTaxNo(pending.taxNo);
    if (!dig) return { ok: false, reason: 'Vergi no geçersiz' };
    const role = opts.role || pending.suggestedRole || 'customer';
    const name = String(opts.name || pending.suggestedName || '').trim() || `Vergi no ${dig}`;
    const category = opts.category || pending.suggestedCategory || 'Hammadde';
    const partyKey = typeof buildPartyKeyFn === 'function' ? buildPartyKeyFn(dig, name) : dig;
    const shortName = typeof guessShortNameFn === 'function' ? guessShortNameFn(name) : '';
    const hit = findPartyByTaxNo(company, dig, customers, suppliers);

    let customer = hit.customer;
    let supplier = hit.supplier;
    const created = { customer: false, supplier: false };

    if ((role === 'customer' || role === 'both') && !customer) {
      customer = {
        company,
        name,
        shortName,
        taxNo: dig,
        taxOffice: '',
        partyKey,
        address: '',
        phone: '',
        currency: '₺',
        paymentTerms: '30 gün',
        notifyPrefs: { whatsapp: true, email: true },
        contacts: [],
        cariRole: role,
        source: 'parasut_excel_approved',
        tlBalance: 0,
      };
      customers.push(customer);
      created.customer = true;
    } else if (customer) {
      // Kimlik alanlarına dokunma — sadece cariRole / bakiye senkronu sonra
      if (!customer.cariRole) customer.cariRole = role;
    }

    if ((role === 'supplier' || role === 'both') && !supplier) {
      supplier = {
        company,
        name,
        shortName,
        taxNo: dig,
        taxOffice: '',
        partyKey,
        address: '',
        phone: '',
        email: '',
        whatsapp: '',
        contact: '',
        bank: '',
        iban: '',
        category,
        materialGroups: [],
        fasonServices: [],
        fasonMfgServices: [],
        contacts: [],
        cariRole: role,
        source: 'parasut_excel_approved',
        tlBalance: 0,
      };
      suppliers.push(supplier);
      created.supplier = true;
    } else if (supplier) {
      if (!supplier.cariRole) supplier.cariRole = role;
    }

    // Orphan hareketleri bağla
    (movements || []).forEach((m) => {
      if (m.company === company && digitsOnly(m.taxNo) === dig && m.approvalStatus === 'pending') {
        m.approvalStatus = 'linked';
        m.partyName = customer?.name || supplier?.name || name;
        m.side = role === 'both' ? 'both' : role;
        m.partyKey = partyKey;
      }
    });

    pending.status = 'approved';
    pending.approvedAt = new Date().toISOString();
    pending.approvedName = name;
    pending.approvedRole = role;

    syncCardBalancesOnly(company, customers, suppliers, movements);

    return { ok: true, created, customer, supplier };
  }

  function rejectPendingCari(pending, movements) {
    if (!pending || pending.status !== 'pending') return { ok: false, reason: 'Geçersiz' };
    const dig = digitsOnly(pending.taxNo);
    (movements || []).forEach((m) => {
      if (m.company === pending.company && digitsOnly(m.taxNo) === dig && m.approvalStatus === 'pending') {
        m.approvalStatus = 'orphan_rejected';
      }
    });
    pending.status = 'rejected';
    pending.rejectedAt = new Date().toISOString();
    return { ok: true };
  }

  global.BtdAccounting = {
    DOC_TYPES,
    digitsOnly,
    isCheckableTaxNo,
    parseMoney,
    buildExternalKey,
    findPartyByTaxNo,
    movementNet,
    balanceForTaxNo,
    companyMovementSummary,
    movementsForTaxNo,
    withRunningBalance,
    buildAccountsIndex,
    syncCardBalancesOnly,
    createManualMovement,
    parseWorkbookToPreview,
    applyPreviewImport,
    approvePendingCari,
    rejectPendingCari,
    uid,
  };
})(typeof window !== 'undefined' ? window : globalThis);
