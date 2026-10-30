/* Teklifler sayfasındaki seri teklif. Fiyat BtdPrices sabitinden gelir. */
(function (root) {
  const TERMS = ['Peşin', '7 gün', '15 gün', '30 gün', '45 gün', '60 gün', '90 gün'];
  const state = {
    company: '',
    customer: '',
    discountPct: 0,
    paymentTerms: '30 gün',
    lines: [],
  };

  function prices() {
    return root.BtdPrices;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n, currency) {
    if (typeof root.fmtMoneyFixed === 'function') return root.fmtMoneyFixed(n, currency);
    return `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || '€'}`;
  }

  function page() {
    return root.BtdPage || {};
  }

  function customersFor(company) {
    const list = page().customers;
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c.company === company);
  }

  function pathLabel(company) {
    const api = prices();
    if (!api) return '';
    if (api.pathForCompany(company) === api.PATH_LUMI_WALL) return 'Lumi-Wall';
    if (api.pathForCompany(company) === api.PATH_CNC) return 'Technomac CNC';
    return '';
  }

  function catalog() {
    const api = prices();
    if (!api) return [];
    return api.catalog(state.company);
  }

  function buildDraft() {
    const api = prices();
    const company = state.company;
    const rows = catalog();
    const byCode = {};
    rows.forEach((row) => { byCode[row.code] = row; });
    const pct = api ? api.clampDiscount(state.discountPct) : 0;
    const items = [];
    let grossSum = 0;
    state.lines.forEach((line) => {
      const row = byCode[line.code];
      if (!row) return;
      const qty = Number(line.qty) || 0;
      const gross = api.lineGross(qty, row.unitPrice);
      grossSum += gross;
      items.push({
        partNo: row.code,
        desc: `${row.name} · ${row.unit}`,
        unit: row.unit,
        qty,
        unitPrice: row.unitPrice,
        note: '',
        _gross: gross,
      });
    });
    const discount = api ? api.discountAmount(grossSum, pct) : 0;
    if (discount) {
      items.push({
        partNo: 'ISK',
        desc: `İskonto %${pct}`,
        unit: '—',
        qty: 1,
        unitPrice: -discount,
        note: '',
      });
    }
    const cust = customersFor(company).find((c) => c.name === state.customer) || null;
    const contact = (cust && cust.contacts && cust.contacts[0] && cust.contacts[0].name) || '';
    const prefs = typeof root.getCustomerQuotePrefs === 'function'
      ? root.getCustomerQuotePrefs(cust)
      : { leadTimeDays: 15, manufacturingType: 'Malzemeli', terms: '' };
    const paymentTerms = state.paymentTerms || '30 gün';
    const manufacturingType = api && api.pathForCompany(company) === api.PATH_CNC ? 'Malzemesiz' : prefs.manufacturingType;
    const terms = typeof root.buildQuoteTermsText === 'function'
      ? root.buildQuoteTermsText({ leadTimeDays: prefs.leadTimeDays, paymentTerms, manufacturingType })
      : prefs.terms;
    const code = (page().companyCode && page().companyCode[company]) || 'XX';
    const defs = typeof root.companyQuoteDefaults === 'function' ? root.companyQuoteDefaults(company) : {};
    return {
      id: `${code}-ONIZ-2026`,
      company,
      customer: state.customer || '—',
      contact,
      date: new Date().toISOString().slice(0, 10),
      currency: (api && api.CURRENCY) || '€',
      items: items.map(({ _gross, ...item }) => item),
      grossSum,
      discount,
      discountPct: pct,
      paymentTerms,
      paymentType: typeof root.paymentTypeLabel === 'function' ? root.paymentTypeLabel(paymentTerms) : paymentTerms,
      leadTimeDays: prefs.leadTimeDays || 15,
      manufacturingType,
      validityDays: 15,
      vatRate: (api && api.VAT_RATE) || 20,
      terms,
      deliveryPlace: defs.deliveryPlace,
      warranty: defs.warranty,
      status: 'Taslak',
    };
  }

  function totals(draft) {
    if (typeof root.quoteMoneyBreakdown === 'function') return root.quoteMoneyBreakdown(draft);
    const subtotal = draft.grossSum - draft.discount;
    const vatRate = draft.vatRate;
    const vat = Math.round(subtotal * vatRate) / 100;
    return { subtotal, vatRate, vat, grand: subtotal + vat };
  }

  function shellHtml() {
    const label = pathLabel(state.company);
    if (!label) {
      return `<section class="bg-white rounded-2xl border border-steel-200 shadow-sm p-4 sm:p-5">
        <p class="text-sm font-semibold text-steel-800">Seri teklif</p>
        <p class="text-xs text-steel-400 mt-1">Lumi-Wall fiyatı Devorias, CNC fiyatı Technomac firmasındadır. Üstten firmayı değiştirin.</p>
      </section>`;
    }
    const rows = catalog();
    const options = rows.map((row) => `<option value="${esc(row.code)}">${esc(row.name)} · ${esc(money(row.unitPrice, row.currency))}/${esc(row.unit)}</option>`).join('');
    const termOptions = TERMS.map((t) => `<option value="${esc(t)}" ${t === state.paymentTerms ? 'selected' : ''}>${esc(t)}</option>`).join('');
    return `<section class="bg-white rounded-2xl border border-steel-200 shadow-sm p-4 sm:p-5">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div>
          <p class="text-sm font-semibold text-steel-800">Seri teklif</p>
          <p class="text-xs text-steel-400 mt-0.5">Fiyat yolu: ${esc(label)} · <span id="pqCompany" class="font-semibold text-navy">${esc(state.company)}</span></p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">Müşteri</span>
          <select id="pqCustomer" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm text-steel-800 bg-white focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy"></select>
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">Vade</span>
          <select id="pqTerms" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm text-steel-800 bg-white focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy">${termOptions}</select>
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">İskonto %</span>
          <input id="pqDiscount" type="number" min="0" max="100" step="0.01" value="${esc(state.discountPct)}" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm text-steel-800 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy" />
        </label>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_8rem_auto] gap-3 items-end mb-4">
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">Ürün</span>
          <select id="pqProduct" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm text-steel-800 bg-white focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy">${options}</select>
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">Miktar</span>
          <input id="pqQty" type="number" min="0.01" step="0.01" value="1" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm text-steel-800 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy" />
        </label>
        <button type="button" id="pqAdd" class="bg-navy hover:bg-navy-light text-white text-sm font-semibold px-4 py-2.5 rounded-xl">Kalem ekle</button>
      </div>
      <div class="overflow-x-auto border border-steel-200 rounded-xl mb-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-steel-50/80 text-left text-[11px] text-steel-400 font-semibold uppercase tracking-wide">
              <th class="px-3 py-2">Ürün</th>
              <th class="px-3 py-2">Miktar</th>
              <th class="px-3 py-2">Birim fiyat</th>
              <th class="px-3 py-2">Satır tutarı</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody id="pqLines"></tbody>
        </table>
      </div>
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div class="text-sm text-steel-600 space-y-1">
          <p>Ara toplam <span id="pqSubtotal" class="font-semibold text-steel-800 mono">—</span></p>
          <p>İskonto <span id="pqDiscountAmt" class="font-semibold text-steel-800 mono">—</span></p>
          <p>KDV <span id="pqVat" class="font-semibold text-steel-800 mono">—</span></p>
          <p>Genel toplam <span id="pqGrand" class="font-semibold text-navy mono">—</span></p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" id="pqSave" class="bg-white border border-steel-200 hover:border-navy/30 text-steel-800 text-sm font-semibold px-4 py-2.5 rounded-xl">Teklifi kaydet</button>
          <button type="button" id="pqOrder" class="bg-navy hover:bg-navy-light text-white text-sm font-semibold px-4 py-2.5 rounded-xl">Siparişe dönüştür</button>
          <button type="button" id="pqPreview" class="bg-white border border-steel-200 hover:border-navy/30 text-steel-800 text-sm font-semibold px-4 py-2.5 rounded-xl">Müşteri önizlemesi</button>
        </div>
      </div>
    </section>`;
  }

  function fillCustomers(mount) {
    const sel = mount.querySelector('#pqCustomer');
    if (!sel) return;
    const list = customersFor(state.company);
    const prev = state.customer;
    sel.innerHTML = list.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    if (!list.length) {
      sel.innerHTML = '<option value="">Bu firmada müşteri yok</option>';
      state.customer = '';
      return;
    }
    const keep = list.some((c) => c.name === prev) ? prev : list[0].name;
    state.customer = keep;
    sel.value = keep;
  }

  function paint(mount) {
    const body = mount.querySelector('#pqLines');
    if (!body) return;
    const draft = buildDraft();
    const cur = draft.currency;
    const rows = catalog();
    const byCode = {};
    rows.forEach((row) => { byCode[row.code] = row; });
    if (!state.lines.length) {
      body.innerHTML = '<tr><td colspan="5" class="px-3 py-6 text-center text-sm text-steel-400">Henüz kalem yok.</td></tr>';
    } else {
      body.innerHTML = state.lines.map((line, i) => {
        const row = byCode[line.code];
        const gross = row && prices() ? prices().lineGross(line.qty, row.unitPrice) : 0;
        return `<tr>
          <td class="px-3 py-2 text-steel-800">${esc(row ? row.name : line.code)}</td>
          <td class="px-3 py-2 text-steel-600">${esc(line.qty)} ${esc(row ? row.unit : '')}</td>
          <td class="px-3 py-2 mono text-steel-700">${esc(row ? money(row.unitPrice, cur) : '—')}</td>
          <td class="px-3 py-2 mono font-semibold text-steel-800">${esc(money(gross, cur))}</td>
          <td class="px-3 py-2 text-right"><button type="button" data-pq-del="${i}" class="text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg">Sil</button></td>
        </tr>`;
      }).join('');
    }
    const moneyRow = totals(draft);
    const set = (id, text) => {
      const el = mount.querySelector(id);
      if (el) el.textContent = text;
    };
    set('#pqSubtotal', money(draft.grossSum, cur));
    set('#pqDiscountAmt', money(draft.discount, cur));
    set('#pqVat', money(moneyRow.vat, cur));
    set('#pqGrand', money(moneyRow.grand, cur));
  }

  function bind(mount) {
    mount.querySelector('#pqCustomer')?.addEventListener('change', (e) => {
      state.customer = e.target.value;
    });
    mount.querySelector('#pqTerms')?.addEventListener('change', (e) => {
      state.paymentTerms = e.target.value;
      paint(mount);
    });
    mount.querySelector('#pqDiscount')?.addEventListener('input', (e) => {
      const clamped = prices() ? prices().clampDiscount(e.target.value) : 0;
      state.discountPct = clamped;
      if (e.target.value !== '' && Number(e.target.value) !== clamped) e.target.value = String(clamped);
      paint(mount);
    });
    mount.querySelector('#pqAdd')?.addEventListener('click', () => {
      const code = mount.querySelector('#pqProduct')?.value || '';
      const qty = Number(mount.querySelector('#pqQty')?.value);
      if (!code || !(qty > 0)) {
        if (typeof root.showToast === 'function') root.showToast('Ürün ve adet gerekli.', 'error');
        return;
      }
      state.lines.push({ code, qty });
      paint(mount);
    });
    mount.querySelector('#pqLines')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pq-del]');
      if (!btn) return;
      state.lines.splice(Number(btn.dataset.pqDel), 1);
      paint(mount);
    });
    function draftOrWarn() {
      if (!state.lines.length) {
        if (typeof root.showToast === 'function') root.showToast('Önce kalem ekleyin.', 'error');
        return null;
      }
      if (!state.customer) {
        if (typeof root.showToast === 'function') root.showToast('Müşteri seçin.', 'error');
        return null;
      }
      return buildDraft();
    }
    mount.querySelector('#pqSave')?.addEventListener('click', () => {
      const draft = draftOrWarn();
      if (!draft || typeof root.saveSeriesQuote !== 'function') return;
      root.saveSeriesQuote(draft, { asOrder: false });
      resetLines();
    });
    mount.querySelector('#pqOrder')?.addEventListener('click', () => {
      const draft = draftOrWarn();
      if (!draft || typeof root.saveSeriesQuote !== 'function') return;
      root.saveSeriesQuote(draft, { asOrder: true });
      resetLines();
    });
    mount.querySelector('#pqPreview')?.addEventListener('click', () => {
      const draft = draftOrWarn();
      if (!draft || typeof root.openQuotePreview !== 'function') return;
      root.openQuotePreview(draft);
    });
  }

  function render() {
    const mount = document.getElementById('priceQuoteMount');
    if (!mount || !prices()) return;
    const company = page().company || '';
    if (mount.dataset.company !== company) {
      state.company = company;
      state.lines = [];
      state.discountPct = 0;
      state.paymentTerms = '30 gün';
      state.customer = '';
      mount.dataset.company = company;
      mount.innerHTML = shellHtml();
      bind(mount);
    } else {
      const name = mount.querySelector('#pqCompany');
      if (name) name.textContent = company;
    }
    fillCustomers(mount);
    paint(mount);
  }

  function resetLines() {
    state.lines = [];
    const mount = document.getElementById('priceQuoteMount');
    if (mount) paint(mount);
  }

  root.BtdPriceQuote = { render, buildDraft, resetLines };
})(typeof window !== 'undefined' ? window : globalThis);
