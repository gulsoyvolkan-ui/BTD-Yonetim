/* Demo liste fiyatı. Teklif ekranı bu sabitleri okur; sayfaya ikinci kez yazılmaz.
   Resmi tarife değildir. urunler boşsa aynı satırlar yerel demo kataloğuna kopyalanır. */
(function (root) {
  const PATH_LUMI_WALL = 'lumi-wall';
  const PATH_CNC = 'technomac-cnc';
  const CURRENCY = '€';
  const VAT_RATE = 20;

  const LUMI_WALL_BRILLIANT_EUR_M2 = 86;
  const LUMI_WALL_MATTE_EUR_M2 = 74;
  const LUMI_WALL_MARBLE_EUR_M2 = 98;
  const LUMI_WALL_PREMIUM_EUR_M2 = 124;
  const LUMI_WALL_LUMI_EUR_M2 = 112;

  const CNC_FREZE_EUR_SAAT = 45;
  const CNC_TORNA_EUR_SAAT = 38;
  const CNC_5EKSEN_EUR_SAAT = 72;

  const LUMI_WALL = [
    { code: 'LW-BRILLIANT', name: 'Lumi-Wall Brilliant', unit: 'm²', unitPrice: LUMI_WALL_BRILLIANT_EUR_M2 },
    { code: 'LW-MATTE', name: 'Lumi-Wall Matte', unit: 'm²', unitPrice: LUMI_WALL_MATTE_EUR_M2 },
    { code: 'LW-MARBLE', name: 'Lumi-Wall Marble', unit: 'm²', unitPrice: LUMI_WALL_MARBLE_EUR_M2 },
    { code: 'LW-PREMIUM', name: 'Lumi-Wall Premium', unit: 'm²', unitPrice: LUMI_WALL_PREMIUM_EUR_M2 },
    { code: 'LW-LUMI', name: 'Lumi-Wall Lumi', unit: 'm²', unitPrice: LUMI_WALL_LUMI_EUR_M2 },
  ];

  const CNC = [
    { code: 'CNC-FREZE', name: 'CNC Freze', unit: 'saat', unitPrice: CNC_FREZE_EUR_SAAT },
    { code: 'CNC-TORNA', name: 'CNC Torna', unit: 'saat', unitPrice: CNC_TORNA_EUR_SAAT },
    { code: 'CNC-5EKSEN', name: 'CNC 5 Eksen', unit: 'saat', unitPrice: CNC_5EKSEN_EUR_SAAT },
  ];

  function pathForCompany(company) {
    if (company === 'Devorias') return PATH_LUMI_WALL;
    if (company === 'Technomac') return PATH_CNC;
    return '';
  }

  function catalog(company) {
    const path = pathForCompany(company);
    const rows = path === PATH_LUMI_WALL ? LUMI_WALL : path === PATH_CNC ? CNC : [];
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      unit: row.unit,
      unitPrice: row.unitPrice,
      currency: CURRENCY,
      path,
      company,
    }));
  }

  function productRow(row, company, path) {
    return {
      id: `UR-${row.code}`,
      company,
      code: row.code,
      name: row.name,
      unit: row.unit,
      unitPrice: row.unitPrice,
      currency: CURRENCY,
      note: path === PATH_LUMI_WALL ? 'Lumi-Wall seri · demo liste' : 'Technomac CNC · demo liste',
      active: true,
    };
  }

  function demoProducts() {
    return [
      ...LUMI_WALL.map((row) => productRow(row, 'Devorias', PATH_LUMI_WALL)),
      ...CNC.map((row) => productRow(row, 'Technomac', PATH_CNC)),
    ];
  }

  /* Yerel diziye ekler. Bulut, urunler doluysa bu diziyi değiştirir; boşsa mevcut hydrate yazar. */
  function mergeDemoProducts(list) {
    if (!Array.isArray(list)) return;
    demoProducts().forEach((row) => {
      const exists = list.some((p) => p.company === row.company && String(p.code).toLowerCase() === row.code.toLowerCase());
      if (!exists) list.push(row);
    });
  }

  function lineGross(qty, unitPrice) {
    const q = Number(qty);
    const p = Number(unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q < 0 || p < 0) return 0;
    return q * p;
  }

  function clampDiscount(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function discountAmount(grossSum, pct) {
    return lineGross(1, grossSum) * clampDiscount(pct) / 100;
  }

  root.BtdPrices = {
    PATH_LUMI_WALL,
    PATH_CNC,
    CURRENCY,
    VAT_RATE,
    LUMI_WALL_BRILLIANT_EUR_M2,
    LUMI_WALL_MATTE_EUR_M2,
    LUMI_WALL_MARBLE_EUR_M2,
    LUMI_WALL_PREMIUM_EUR_M2,
    LUMI_WALL_LUMI_EUR_M2,
    CNC_FREZE_EUR_SAAT,
    CNC_TORNA_EUR_SAAT,
    CNC_5EKSEN_EUR_SAAT,
    pathForCompany,
    catalog,
    demoProducts,
    mergeDemoProducts,
    lineGross,
    clampDiscount,
    discountAmount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
