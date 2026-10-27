/* Marka kimliği: Technomac, Bluemac, TE-CA, DEVORIAS.
   Teklif ve iş emri çıktısında logo, renk ve antet buradan gelir.
   Yasal ünvan, adres ve vergi bilgisi markanın tüzel kişiliğinden (ENTITIES) gelir.
   Telefon, web, e-posta ve MERSİS Volkan bildirene kadar "Bilinmiyor" basılır. Banka bilgisi firmadan gelir.
   TE-CA ve DEVORIAS Bluemac tüzel kişiliğiyle çalışır; antette Bluemac ünvanı ve vergi bilgisi basılır. */
(function (root) {
  // Firma kaydındaki (firmalar) ünvan ve vergi no bunlardan farklı olabilir; teklif ve iş emri anteti buradakini basar.
  const ENTITIES = {
    technomac: {
      legal: 'TECHNOMAC MAKİNE SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
      address: 'Velibaba Mahallesi Mimarsinan Caddesi Velibaba San. Sitesi 15/6 B2 No:5, Pendik / İstanbul',
      taxOffice: 'Pendik Vergi Dairesi',
      taxNo: '8331201835',
    },
    bluemac: {
      legal: 'BLUEMAC MAKİNE SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
      address: 'Velibaba Mahallesi Mimarsinan Caddesi Velibaba San. Sitesi 15/6 B2 No:5, Pendik / İstanbul',
      taxOffice: 'Pendik Vergi Dairesi',
      taxNo: '1780735480',
    },
  };

  const BRANDS = [
    {
      key: 'technomac',
      name: 'Technomac',
      company: 'Technomac',
      entity: 'technomac',
      logo: 'assets/logos/brands/technomac.svg',
      palette: { primary: '#393536', onPrimary: '#FFFFFF', accent: '#00ADEF', ink: '#393536' },
    },
    {
      key: 'bluemac',
      name: 'Bluemac',
      company: 'Bluemac',
      entity: 'bluemac',
      logo: 'assets/logos/brands/bluemac.svg',
      palette: { primary: '#393536', onPrimary: '#FFFFFF', accent: '#00ADEF', ink: '#393536' },
    },
    {
      key: 'teca',
      name: 'TE-CA',
      company: 'Bluemac',
      entity: 'bluemac',
      logo: 'assets/logos/brands/teca.svg',
      palette: { primary: '#110F0D', onPrimary: '#FFFFFF', accent: '#ED1C24', ink: '#110F0D' },
      letterhead: {
        note: 'TE-CA · Technological Camping Equipment · Bluemac tescilli markası',
      },
      // Bluemac belgesinde müşteri adı veya ürün metninde biri geçerse TE-CA seçilir.
      keywords: ['te-ca', 'teca', 'karavan', 'caravan', 'motokaravan', 'motorhome', 'camping', 'treyler', 'trailer', 'römork', 'leveling', 'dengeleme', 'mobil yaşam', 'mobil klinik', 'yayın aracı', 'komuta aracı'],
    },
    {
      key: 'devorias',
      name: 'DEVORIAS',
      company: 'Devorias',
      entity: 'bluemac',
      // Logo siyah zemin üzerine tasarlanmış; zemin logonun parçası.
      logo: 'assets/logos/brands/devorias.png',
      palette: { primary: '#000000', onPrimary: '#BCA281', accent: '#BCA281', ink: '#000000' },
    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function absUrl(src) {
    try { return new URL(src, root.location.href).href; } catch (_) { return src; }
  }

  function fold(s) {
    return String(s == null ? '' : s).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
  }

  // Kısa anahtar tam kelime olmalı (teca ≠ tecavüz); uzunu ek alabilir (karavanlar, karavanı).
  function mentions(text, words) {
    return (words || []).some((w) => {
      const word = fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tail = w.length <= 4 ? '(?![0-9a-zçğöşü])' : '';
      return new RegExp(`(^|[^0-9a-zçğöşü])${word}${tail}`).test(text);
    });
  }

  function forCompany(company) {
    return BRANDS.filter((b) => b.company === company);
  }

  function infer(company, customer, texts) {
    const own = forCompany(company);
    const hay = fold([customer].concat(texts || []).join('\n'));
    return own.find((b) => mentions(hay, b.keywords)) || own[0] || null;
  }

  function docTexts(doc) {
    const items = (doc.items || []).map((it) => `${it.partNo || ''} ${it.desc || ''}`);
    const parts = (doc.parts || []).map((p) => p.name || '');
    return items.concat(parts);
  }

  /** Belgenin markası: kayıtlı marka → bağlı belgenin (iş emrinin teklifi) markası → müşteri/ürün tahmini. */
  function resolveDoc(doc, linked) {
    if (!doc) return null;
    const own = forCompany(doc.company);
    const carried = linked && linked.company === doc.company ? resolveDoc(linked) : null;
    return own.find((b) => b.key === doc.brand)
      || carried
      || infer(doc.company, doc.customer, docTexts(doc));
  }

  function letterhead(info, brand) {
    if (!brand) return info;
    const lh = brand.letterhead || {};
    return Object.assign({}, info, ENTITIES[brand.entity], {
      logo: brand.logo,
      // TODO(Volkan): telefon, web, e-posta ve MERSİS gelince buraya yaz.
      phone: 'Bilinmiyor',
      website: 'Bilinmiyor',
      email: 'Bilinmiyor',
      mersis: 'Bilinmiyor',
      note: lh.note || '',
    });
  }

  function printStyle(brand) {
    const p = brand.palette;
    const s = `.brand-${brand.key}`;
    const ink = ['.brand-name', '.legal-name', '.firm-meta strong', '.title-band h1', '.title-row h1', '.meta-grid .ref', '.meta-box .ref',
      '.section-label', '.cust-table .v', '.item-title', '.kv .v', '.totals .val', '.words strong', '.signatures .label', '.signatures .co',
      '.info-card strong', '.part-code', '.part-name', '.sign-col .label'].map((sel) => `${s} ${sel}`).join(', ');
    return `<style>
  ${s} .head-rule, ${s} .letterhead-sub { border-top-color: ${p.accent}; }
  ${ink} { color: ${p.ink}; }
  ${s} table.items th, ${s} table.steps th, ${s} .totals .grand td { background: ${p.primary}; color: ${p.onPrimary}; }
  ${s} .totals .grand .val { color: ${p.onPrimary}; }
  ${s} .totals .grand .lab { color: ${p.onPrimary}; opacity: .85; }
  ${s} .totals { border-color: ${p.primary}; }
  ${s} .brand-note { margin: 2pt 0 5pt; font-size: 7.5pt; font-weight: 700; letter-spacing: .3pt; color: ${p.ink}; }
  ${s} .brand-logo-ph { width: 100%; height: 100%; box-sizing: border-box; border: 0.8pt dashed ${p.accent}; border-radius: 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1.1; color: ${p.ink}; }
  ${s} .brand-logo-ph b { font-size: 15pt; letter-spacing: 1pt; }
  ${s} .logo-box .brand-logo-ph b { font-size: 8pt; letter-spacing: .3pt; }
  ${s} .brand-logo-ph small { margin-top: 1mm; font-size: 5.5pt; font-weight: 700; letter-spacing: .4pt; text-transform: uppercase; color: #94a3b8; }
</style>`;
  }

  /** Çıktı şablonu için marka parçaları: antet bilgisi, logo, kapsam sınıfı ve renk stili. */
  function printParts(doc, info, linked) {
    const brand = resolveDoc(doc, linked);
    const merged = letterhead(info, brand);
    const name = brand ? brand.name : doc.company;
    return {
      brand,
      name,
      info: merged,
      scope: brand ? `brand-${brand.key}` : '',
      style: brand ? printStyle(brand) : '',
      logo: merged.logo
        ? `<img src="${esc(absUrl(merged.logo))}" alt="${esc(name)}" />`
        : `<div class="brand-logo-ph"><b>${esc(name)}</b><small>logo bekleniyor</small></div>`,
    };
  }

  function swatch(color) {
    return `<span class="inline-block w-3 h-3 rounded-full border border-black/10" style="background:${esc(color)}"></span>`;
  }

  function chipsHtml(own, key, status) {
    const chips = own.map((b) => {
      const on = b.key === key;
      const logo = b.logo
        ? `<img src="${esc(b.logo)}" alt="" class="max-w-full max-h-full object-contain" />`
        : '<span class="text-[9px] font-bold text-steel-400 leading-none">LOGO YOK</span>';
      return `<button type="button" role="radio" aria-checked="${on}" data-brand-key="${esc(b.key)}" class="flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${on ? 'border-navy bg-navy/5 ring-2 ring-navy/20' : 'border-steel-200 bg-white hover:border-navy/30'}">
        <span class="w-16 h-8 rounded-lg bg-white border border-steel-200 flex items-center justify-center p-1 shrink-0">${logo}</span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-steel-800 leading-tight">${esc(b.name)}</span>
          <span class="flex items-center gap-1 mt-1">${swatch(b.palette.primary)}${swatch(b.palette.accent)}${b.logo ? '' : '<span class="ml-1 text-[10px] font-semibold text-amber-700">logo bekleniyor</span>'}</span>
        </span>
      </button>`;
    }).join('');
    const sel = own.find((b) => b.key === key);
    const entity = sel && sel.entity !== sel.key ? BRANDS.find((b) => b.key === sel.entity) : null;
    const owner = entity
      ? `<p class="text-[10.5px] text-steel-400 mt-2">${esc(sel.name)} antetinde ${esc(entity.name)} ünvanı, adresi ve vergi bilgisi basılır.</p>`
      : '';
    return `<div class="rounded-xl border border-steel-200 p-3">
      <div class="flex items-center justify-between gap-2 mb-2">
        <p class="text-[11px] font-semibold text-steel-500 uppercase tracking-wide">Marka kimliği</p>
        <span class="text-[10.5px] text-steel-400">${status}</span>
      </div>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Marka kimliği">${chips}</div>
      ${owner}
    </div>`;
  }

  function compactHtml(own, key) {
    const label = '<span class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">Marka</span>';
    if (own.length === 1) {
      return `<span class="flex items-center gap-2">${label}<span class="text-sm font-semibold text-steel-700">${esc(own[0].name)}</span></span>`;
    }
    const options = own.map((b) => `<option value="${esc(b.key)}" ${b.key === key ? 'selected' : ''}>${esc(b.name)}${b.logo ? '' : ' · logo bekleniyor'}</option>`).join('');
    return `<label class="flex items-center gap-2">${label}<select data-brand-select class="rounded-xl border border-steel-200 px-3 py-2 text-sm text-steel-800 bg-white focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy">${options}</select></label>`;
  }

  /**
   * BrandIdentitySelector. Firmanın markalarını listeler.
   * Marka kayıtlı, bağlı tekliften gelmiş veya elle seçilmiş değilse infer() müşteri ve ürün metninden günceller.
   * compact: önizleme altbilgisi için açılır liste.
   */
  const LOCKED = { manual: 'Elle seçildi', stored: 'Kayıtlı marka', linked: 'Bağlı tekliften' };

  function selector(mount, opts) {
    const o = opts || {};
    const st = { company: '', key: '', source: 'auto' };
    function paint() {
      if (!mount) return;
      const own = forCompany(st.company);
      const status = LOCKED[st.source] || 'Otomatik · müşteri ve ürüne göre';
      mount.innerHTML = !own.length ? '' : (o.compact ? compactHtml(own, st.key) : chipsHtml(own, st.key, status));
    }
    function choose(key) {
      if (!forCompany(st.company).some((b) => b.key === key)) return;
      st.key = key;
      st.source = 'manual';
      paint();
      if (typeof o.onChange === 'function') o.onChange(key);
    }
    if (mount) {
      mount.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-brand-key]');
        if (btn) choose(btn.dataset.brandKey);
      });
      mount.addEventListener('change', (e) => {
        if (e.target.matches('[data-brand-select]')) choose(e.target.value);
      });
    }
    return {
      get value() { return st.key; },
      reset(company, brandKey, linked) {
        const own = forCompany(company);
        const fixed = own.find((b) => b.key === brandKey);
        const carried = !fixed && linked && linked.company === company ? resolveDoc(linked) : null;
        st.company = company || '';
        st.source = fixed ? 'stored' : carried ? 'linked' : 'auto';
        st.key = (fixed || carried || own[0] || {}).key || '';
        paint();
      },
      infer(ctx) {
        if (st.source !== 'auto') return;
        const b = infer(st.company, ctx && ctx.customer, ctx && ctx.texts);
        if (b && b.key !== st.key) {
          st.key = b.key;
          paint();
        }
      },
    };
  }

  root.BtdBrands = { BRANDS, forCompany, resolveDoc, printParts, selector };
})(typeof window !== 'undefined' ? window : globalThis);
