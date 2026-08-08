/**
 * BTD Core · Andon TV (salt okunur)
 * Düzen: localStorage btd_andon_layout_v1 (MES Andon sayfasından ayarlanır)
 */
(function (global) {
  'use strict';

  const REFRESH_MS = 30000;
  const LAYOUT_KEY = 'btd_andon_layout_v1';

  const VIEWS = {
    overview: { id: 'overview', title: 'Genel Özet', href: 'tv-dashboard.html' },
    cnc1: { id: 'cnc1', title: 'CNC Atölyesi 1', subtitle: 'İşleme merkezi · EDM', href: 'tv-cnc1.html', accent: 'navy' },
    cnc2: { id: 'cnc2', title: 'CNC Atölyesi 2', subtitle: 'İşleme merkezi', href: 'tv-cnc2.html', accent: 'navy' },
    universal: { id: 'universal', title: 'Universal Atölyesi', subtitle: 'Torna · taşlama · freze', href: 'tv-universal.html', accent: 'amber' },
    kaynak: { id: 'kaynak', title: 'Kaynak / Montaj', subtitle: 'Kaynak · kesim · montaj', href: 'tv-kaynak.html', accent: 'emerald' },
    print3d: { id: 'print3d', title: '3D Baskı Atölyesi', subtitle: 'FDM yazıcılar', href: 'tv-3d.html', accent: 'violet', isPrint: true },
  };

  const WORKSHOP_SEEDS = {
    cnc1: [
      { name: 'MITSUBISHI MV 2400 R', sub: 'EDM' },
      { name: 'HERMLE 600 V', sub: 'İşleme Merkezi' },
      { name: 'MICROCUT M1050', sub: 'Divizörlü' },
    ],
    cnc2: [
      { name: 'MICROCUT M1050', sub: 'İşleme Merkezi' },
      { name: 'MICROCUT M1200', sub: 'İşleme Merkezi' },
      { name: 'MICROCUT M1050 B', sub: 'İşleme Merkezi' },
    ],
    universal: [
      { name: 'ELB', sub: 'Satıh Taşlama' },
      { name: 'TOS', sub: 'Universal Torna' },
      { name: 'TOS', sub: 'Takım Bileme' },
      { name: 'FIRST', sub: 'Kalıpçı Freze' },
    ],
    kaynak: [
      { name: 'ESAB', sub: 'AC/DC TIG' },
      { name: 'GEKA', sub: 'Gazaltı' },
      { name: 'Oksijen Kaynak', sub: 'Kesim' },
      { name: 'Montaj Hattı', sub: 'Montaj' },
    ],
    print3d: [
      { name: 'Bambulab H2D', sub: 'FDM' },
      { name: 'Bambulab H2S', sub: 'FDM' },
      { name: 'Bambulab P2S', sub: 'FDM' },
    ],
  };

  const JOB_POOL = [
    { wo: 'IE-2608-014', part: 'Gövde Flanşı B-12', project: 'TM-408 / Bluemac' },
    { wo: 'IE-2608-019', part: 'Mil Muhafaza KM-4', project: 'TM-412 / Technomac' },
    { wo: 'IE-2608-021', part: 'Kapak Plakası TP-7', project: 'BM-088 / Bluemac' },
    { wo: 'IE-2608-008', part: 'Bağlantı Kolu BR-3', project: 'TM-401 / Technomac' },
    { wo: 'IE-2608-025', part: 'Şasi Kaynak Grubu', project: 'DV-015 / Devorias' },
    { wo: 'IE-2608-031', part: 'Montaj Aparatı M-2', project: 'TM-419 / Technomac' },
    { wo: 'IE-2608-033', part: 'Prototip Kasa V2', project: 'DV-018 / Devorias' },
    { wo: 'IE-2608-034', part: 'Kılavuz Jig P-1', project: 'BM-091 / Bluemac' },
    { wo: 'IE-2608-036', part: 'Sensor Braket', project: 'TM-422 / Technomac' },
  ];

  let lastFetchAt = Date.now();
  let cache = null;

  function rand(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }
  function pick(arr) {
    return arr[rand(0, arr.length - 1)];
  }

  function loadLayout() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.screens ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function machinesForScreen(wid) {
    const layout = loadLayout();
    const scr = layout?.screens?.[wid];
    if (scr?.machines?.length) {
      return scr.machines.map((m) => ({ name: m.name, sub: m.sub || '' }));
    }
    return (WORKSHOP_SEEDS[wid] || []).map((m) => ({ ...m }));
  }

  function screenChrome(wid) {
    const layout = loadLayout();
    const scr = layout?.screens?.[wid] || {};
    return {
      cardSize: scr.cardSize || 'm',
      cols: Number(scr.cols) || 3,
    };
  }

  function applyShellChrome(viewId) {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    if (viewId === 'overview') {
      shell.dataset.cardSize = 'm';
      shell.dataset.cols = '5';
      return;
    }
    const chrome = screenChrome(viewId);
    shell.dataset.cardSize = chrome.cardSize;
    shell.dataset.cols = String(chrome.cols);
    shell.style.setProperty('--cols', String(chrome.cols));
  }

  function statusMeta(state) {
    if (state === 'busy') return { label: 'Aktif', cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500 pulse-dot' };
    if (state === 'planned') return { label: 'Beklemede', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
    return { label: 'Boş', cls: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500' };
  }

  function formatRemain(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h <= 0 ? `${m} dk` : `${h}s ${String(m).padStart(2, '0')}dk`;
  }

  async function fetchAndonSnapshot() {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    const usedJobs = new Set();
    const workshops = {};

    Object.keys(WORKSHOP_SEEDS).forEach((wid) => {
      const seedList = machinesForScreen(wid);
      const machines = seedList.map((m) => {
        const roll = Math.random();
        let state = 'idle';
        if (roll > 0.55) state = 'busy';
        else if (roll > 0.32) state = 'planned';

        let job = null;
        if (state !== 'idle') {
          let tries = 0;
          do {
            job = pick(JOB_POOL);
            tries += 1;
          } while (usedJobs.has(job.wo) && tries < 12);
          usedJobs.add(job.wo);
        }

        const row = {
          name: m.name,
          sub: m.sub,
          state,
          wo: job?.wo || null,
          part: job?.part || null,
          project: job?.project || null,
          pct: state === 'idle' ? 0 : rand(12, 96),
        };

        if (wid === 'print3d') {
          row.nozzle = state === 'idle' ? null : rand(195, 255);
          row.bed = state === 'idle' ? null : rand(50, 100);
          row.remainMin = state === 'idle' ? null : rand(20, 220);
        }
        return row;
      });

      const busy = machines.filter((x) => x.state === 'busy').length;
      const planned = machines.filter((x) => x.state === 'planned').length;
      const idle = machines.length - busy - planned;
      const activeJobs = machines.filter((x) => x.wo).map((x) => ({
        wo: x.wo,
        part: x.part,
        project: x.project,
        machine: x.name,
        pct: x.pct,
        state: x.state,
      }));

      workshops[wid] = {
        id: wid,
        meta: VIEWS[wid],
        machines,
        activeJobs,
        kpi: { total: machines.length, busy, planned, idle },
        chrome: screenChrome(wid),
      };
    });

    return { fetchedAt: Date.now(), workshops };
  }

  function navHtml(activeId) {
    const items = ['overview', 'cnc1', 'cnc2', 'universal', 'kaynak', 'print3d'];
    return items.map((id) => {
      const v = VIEWS[id];
      const on = id === activeId;
      const short = id === 'overview' ? 'Özet'
        : id === 'cnc1' ? 'CNC 1'
          : id === 'cnc2' ? 'CNC 2'
            : id === 'universal' ? 'Universal'
              : id === 'kaynak' ? 'Kaynak'
                : '3D';
      return `<a href="${v.href}" class="nav-chip ${on ? 'nav-chip-on' : ''}">${short}</a>`;
    }).join('');
  }

  function kpiStrip(kpi) {
    return `
      <div class="kpi-grid">
        <div class="kpi-card"><p class="kpi-label">Tezgâh</p><p class="kpi-val text-steel-800">${kpi.total}</p></div>
        <div class="kpi-card"><p class="kpi-label">Aktif</p><p class="kpi-val text-green-600">${kpi.busy}</p></div>
        <div class="kpi-card"><p class="kpi-label">Beklemede</p><p class="kpi-val text-amber-600">${kpi.planned}</p></div>
        <div class="kpi-card"><p class="kpi-label">Boş</p><p class="kpi-val text-red-500">${kpi.idle}</p></div>
      </div>`;
  }

  function machineCard(m, isPrint) {
    const st = statusMeta(m.state);
    const border = (st.cls.match(/border-\S+/) || ['border-steel-200'])[0];
    const progress = m.state === 'idle' ? '' : `
      <div class="mt-auto pt-2">
        <div class="flex items-end justify-between mb-1">
          <span class="text-xs font-semibold text-steel-400 uppercase tracking-wide">İlerleme</span>
          <span class="mono text-2xl font-bold text-steel-800 leading-none pct-val">${m.pct}%</span>
        </div>
        <div class="h-2 rounded-full bg-steel-100 overflow-hidden">
          <div class="h-full rounded-full bg-navy transition-all" style="width:${Math.max(4, m.pct)}%"></div>
        </div>
      </div>`;

    const jobBlock = m.state === 'idle' ? `
      <p class="text-sm text-steel-400 mt-3">Atanmış iş yok</p>
    ` : `
      <div class="mt-3 space-y-1 min-w-0">
        <p class="text-[11px] font-semibold text-steel-400 uppercase tracking-wide">İş Emri</p>
        <p class="mono text-xl font-bold text-navy leading-tight wo-val">${m.wo}</p>
        <p class="text-base font-semibold text-steel-800 truncate part-val">${m.part}</p>
        <p class="text-sm text-steel-500 truncate">${m.project || ''}</p>
      </div>`;

    const printExtra = isPrint && m.state !== 'idle' ? `
      <div class="mt-2 flex gap-3 text-sm flex-wrap">
        <span class="font-semibold text-steel-600">Nozul <span class="mono text-navy">${m.nozzle}°</span></span>
        <span class="font-semibold text-steel-600">Yatak <span class="mono text-navy">${m.bed}°</span></span>
        <span class="font-semibold text-green-700 pulse-soft">Kalan ${formatRemain(m.remainMin)}</span>
      </div>` : '';

    return `
      <article class="machine-card border ${border}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-lg font-bold text-steel-800 truncate leading-tight name-val">${m.name}</p>
            <p class="text-sm text-steel-400">${m.sub || ''}</p>
          </div>
          <span class="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full border ${st.cls}">
            <span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${st.label}
          </span>
        </div>
        ${jobBlock}
        ${printExtra}
        ${progress}
      </article>`;
  }

  function jobsTable(jobs) {
    if (!jobs.length) {
      return `<div class="empty-panel">Bu atölyede aktif / planlı iş emri yok.</div>`;
    }
    return `
      <div class="table-wrap">
        <table class="andon-table">
          <thead>
            <tr>
              <th>İş Emri</th>
              <th>Parça</th>
              <th>Proje</th>
              <th>Tezgâh</th>
              <th>Durum</th>
              <th class="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.map((j) => {
              const st = statusMeta(j.state);
              return `<tr>
                <td class="mono font-bold text-navy">${j.wo}</td>
                <td class="font-semibold text-steel-800">${j.part}</td>
                <td class="text-steel-500">${j.project || '—'}</td>
                <td>${j.machine}</td>
                <td><span class="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${st.cls}"><span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${st.label}</span></td>
                <td class="text-right mono font-bold">${j.pct}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderWorkshopPage(viewId, data) {
    const ws = data.workshops[viewId];
    if (!ws) return `<p class="p-8 text-steel-500">Atölye verisi yok.</p>`;
    const isPrint = !!ws.meta.isPrint;
    const cols = ws.chrome?.cols || 3;
    return `
      ${kpiStrip(ws.kpi)}
      <div class="section-head">
        <h2 class="section-title">Tezgâhlar / Makineler</h2>
        <p class="section-sub">İş ataması ve anlık durum · kart boyutu ${(ws.chrome?.cardSize || 'm').toUpperCase()}</p>
      </div>
      <div class="machine-grid" style="--cols:${cols}">
        ${ws.machines.length
          ? ws.machines.map((m) => machineCard(m, isPrint)).join('')
          : `<div class="empty-panel col-span-full">Bu ekrana henüz makine atanmadı. MES → Andon TV’den düzenleyin.</div>`}
      </div>
      <div class="section-head mt-3">
        <h2 class="section-title">İş Emirleri / Projeler</h2>
        <p class="section-sub">Bu atölyeye atanmış işler</p>
      </div>
      ${jobsTable(ws.activeJobs)}
    `;
  }

  function overviewCard(ws) {
    const m = ws.meta;
    const k = ws.kpi;
    const top = ws.activeJobs.slice(0, 2);
    return `
      <a href="${m.href}" class="overview-card">
        <div class="flex items-start justify-between gap-2 mb-3">
          <div>
            <p class="text-[11px] font-bold text-navy uppercase tracking-wider">Atölye</p>
            <h3 class="text-xl font-bold text-steel-800 leading-tight">${m.title}</h3>
            <p class="text-sm text-steel-400">${m.subtitle || ''}</p>
          </div>
          <span class="text-xs font-semibold text-navy bg-navy/10 px-2 py-1 rounded-lg">Aç →</span>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div class="mini-kpi"><span class="text-green-600">${k.busy}</span><small>Aktif</small></div>
          <div class="mini-kpi"><span class="text-amber-600">${k.planned}</span><small>Bekleyen</small></div>
          <div class="mini-kpi"><span class="text-red-500">${k.idle}</span><small>Boş</small></div>
        </div>
        ${top.length ? top.map((j) => `
          <div class="border-t border-steel-100 pt-2 mt-2">
            <p class="mono text-sm font-bold text-navy">${j.wo}</p>
            <p class="text-sm text-steel-700 truncate">${j.part} · ${j.machine}</p>
          </div>`).join('') : `<p class="text-sm text-steel-400">Aktif iş yok</p>`}
      </a>`;
  }

  function renderOverview(data) {
    const order = ['cnc1', 'cnc2', 'universal', 'kaynak', 'print3d'];
    const all = order.map((id) => data.workshops[id]);
    const sum = all.reduce((a, w) => ({
      total: a.total + w.kpi.total,
      busy: a.busy + w.kpi.busy,
      planned: a.planned + w.kpi.planned,
      idle: a.idle + w.kpi.idle,
    }), { total: 0, busy: 0, planned: 0, idle: 0 });

    return `
      ${kpiStrip(sum)}
      <div class="section-head">
        <h2 class="section-title">Atölye Özeti</h2>
        <p class="section-sub">Detay için ilgili TV adresine geçin</p>
      </div>
      <div class="overview-grid">
        ${all.map(overviewCard).join('')}
      </div>`;
  }

  function updateClock() {
    const el = document.getElementById('andonClock');
    const upd = document.getElementById('andonUpdated');
    if (!el) return;
    const now = new Date();
    el.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, '0')).join(':');
    const ago = Math.max(0, Math.floor((Date.now() - lastFetchAt) / 1000));
    if (upd) upd.textContent = ago < 1 ? 'az önce' : `${ago} sn önce`;
  }

  function paint(viewId, data) {
    const root = document.getElementById('andonRoot');
    const title = document.getElementById('andonTitle');
    const sub = document.getElementById('andonSubtitle');
    const nav = document.getElementById('andonNav');
    if (!root) return;

    applyShellChrome(viewId);
    const meta = VIEWS[viewId] || VIEWS.overview;
    if (title) title.textContent = meta.title;
    if (sub) {
      sub.textContent = viewId === 'overview'
        ? 'Tüm atölyelerin özet görünümü · salt okunur'
        : (meta.subtitle || 'Tezgâh ve iş atamaları');
    }
    if (nav) nav.innerHTML = navHtml(viewId);

    root.innerHTML = viewId === 'overview'
      ? renderOverview(data)
      : renderWorkshopPage(viewId, data);
  }

  async function refresh() {
    try {
      const data = await fetchAndonSnapshot();
      cache = data;
      lastFetchAt = data.fetchedAt;
      const viewId = global.BTD_ANDON_VIEW || 'overview';
      paint(viewId, data);
      updateClock();
    } catch (e) {
      console.warn('[Andon]', e);
      const upd = document.getElementById('andonUpdated');
      if (upd) upd.textContent = 'bağlantı hatası';
    }
  }

  function boot() {
    const viewId = global.BTD_ANDON_VIEW || 'overview';
    document.title = `BTD Andon · ${VIEWS[viewId]?.title || 'TV'}`;
    refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(updateClock, 1000);
    // Başka sekmeden düzen kaydı gelirse yenile
    window.addEventListener('storage', (e) => {
      if (e.key === LAYOUT_KEY) refresh();
    });
    document.addEventListener('dblclick', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });
    if (navigator.wakeLock) {
      const ask = () => navigator.wakeLock.request('screen').catch(() => {});
      ask();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ask();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.BtdAndon = { VIEWS, refresh, loadLayout };
})(typeof window !== 'undefined' ? window : globalThis);
