/* İmalat sayfası: firma hattına göre tezgâh yükü.
   Technomac CNC, Bluemac montaj, DEVORIAS baskı kuyruğu.
   Kayıt mevcut iş emri tablolarına gider. Yeni kolon yok. */
(function (root) {
  const LANES = {
    Technomac: {
      title: 'CNC tezgâh yükü',
      kicker: 'Technomac',
      blurb: 'CNC ve universal tezgâhlardaki çalışan ve planlı işler.',
      workshops: ['CNC İmalat Atölyesi', 'Universal Atölyesi'],
      stepLabel: 'CNC işleme',
    },
    Bluemac: {
      title: 'Montaj yükü',
      kicker: 'Bluemac',
      blurb: 'Kaynak ve montaj hattındaki çalışan ve planlı işler.',
      workshops: ['Kaynak Montaj Atölyesi'],
      stepLabel: 'Montaj',
    },
    Devorias: {
      title: 'Baskı kuyruğu',
      kicker: 'DEVORIAS',
      blurb: '3D yazıcı kuyruğu. Liste fiyatı değildir.',
      workshops: ['3D Baskı Atölyesi'],
      stepLabel: 'Baskı',
    },
  };

  function api() {
    return root.BtdFloorApi || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function laneFor(company) {
    return LANES[company] || null;
  }

  function laneMachines(company) {
    const lane = laneFor(company);
    const park = api().machinePark || [];
    const labelFn = api().machineLabel;
    if (!lane || typeof labelFn !== 'function') return [];
    const out = [];
    park.forEach((ws) => {
      if (!lane.workshops.includes(ws.workshop)) return;
      (ws.machines || []).forEach((m) => {
        out.push({ workshop: ws.workshop, label: labelFn(m) });
      });
    });
    return out;
  }

  function pushJob(jobs, row) {
    jobs.push(row);
  }

  function jobsFromOrders() {
    const orders = api().activeWorkOrders || (api().workOrders || []).filter((w) => w.company === (api().company || '') && w.status === 'Aktif');
    const jobs = [];
    orders.forEach((wo) => {
      (wo.parts || []).forEach((part) => {
        const active = part.activeCam || 0;
        (part.cam || []).forEach((step, idx) => {
          if (!step || idx < active) return;
          const finished = step.finishedAt || step.endedAt;
          const running = !!(step.machine && step.startedAt && !finished);
          const planned = step.plannedMachine || (!step.startedAt ? step.machine : null);
          const base = {
            woId: wo.id,
            customer: wo.customer || '—',
            part: part.name || '—',
            step: step.label || 'İşlem',
            minutes: Number(step.durationMin) || 0,
            sample: false,
          };
          if (running) {
            pushJob(jobs, Object.assign({}, base, { machine: step.machine, kind: 'run' }));
            return;
          }
          if (planned) {
            pushJob(jobs, Object.assign({}, base, { machine: planned, kind: 'queue' }));
            return;
          }
          if (idx === active) {
            pushJob(jobs, Object.assign({}, base, { machine: null, kind: 'open' }));
          }
        });
      });
    });
    return { orders, jobs };
  }

  function sampleJobs(company, machines) {
    const labels = machines.map((m) => m.label);
    const pick = (pred, fallback) => labels.find(pred) || fallback || labels[0] || null;
    if (company === 'Bluemac') {
      return [
        { woId: 'BM-ÖRNEK-1', customer: 'Karavan Sistemleri A.Ş.', part: 'TE-CA kaldırma şasesi', step: 'Montaj', machine: pick((l) => /montaj/i.test(l)), kind: 'run', minutes: 90, sample: true },
        { woId: 'BM-ÖRNEK-2', customer: 'Mavi Hat Makine', part: 'Vidalı kriko gövdesi', step: 'Kaynak', machine: pick((l) => /^ESAB/.test(l), labels[1]), kind: 'queue', minutes: 0, sample: true },
      ];
    }
    if (company === 'Devorias') {
      return [
        { woId: 'DV-ÖRNEK-1', customer: 'Lumi-Wall Showroom', part: 'Brilliant panel', step: 'Baskı', machine: pick((l) => /H2D/.test(l)), kind: 'run', minutes: 180, sample: true },
        { woId: 'DV-ÖRNEK-2', customer: 'İç Mekan Atölyesi', part: 'Matte köşe profili', step: 'Baskı', machine: pick((l) => /P2S/.test(l), labels[labels.length - 1]), kind: 'queue', minutes: 0, sample: true },
        { woId: 'DV-ÖRNEK-3', customer: 'İç Mekan Atölyesi', part: 'Marble numune', step: 'Baskı', machine: null, kind: 'open', minutes: 0, sample: true },
      ];
    }
    return [];
  }

  function kindLabel(kind) {
    if (kind === 'run') return 'Çalışıyor';
    if (kind === 'queue') return 'Kuyrukta';
    return 'Atanmamış';
  }

  function kindClass(kind) {
    if (kind === 'run') return 'bg-emerald-50 text-emerald-700';
    if (kind === 'queue') return 'bg-amber-50 text-amber-700';
    return 'bg-steel-100 text-steel-600';
  }

  function jobLine(job) {
    const min = job.minutes > 0 ? ` · ${job.minutes} dk` : '';
    return `<li class="border border-steel-100 rounded-lg px-2.5 py-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold mono text-navy">${esc(job.woId)}</span>
        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${kindClass(job.kind)}">${kindLabel(job.kind)}</span>
      </div>
      <p class="text-xs text-steel-800 mt-1">${esc(job.part)}</p>
      <p class="text-[11px] text-steel-400">${esc(job.step)} · ${esc(job.customer)}${esc(min)}</p>
    </li>`;
  }

  function render() {
    const mount = document.getElementById('mfgLoadMount');
    if (!mount) return;
    const company = api().company || '';
    const lane = laneFor(company);
    if (!lane) {
      mount.innerHTML = '';
      return;
    }
    const machines = laneMachines(company);
    const labels = new Set(machines.map((m) => m.label));
    const real = jobsFromOrders();
    const sampleList = sampleJobs(company, machines);
    const useSample = real.orders.length === 0 && sampleList.length > 0;
    const jobs = useSample ? sampleList : real.jobs;
    const onLane = jobs.filter((j) => j.machine && labels.has(j.machine));
    const offLane = jobs.filter((j) => j.machine && !labels.has(j.machine));
    const open = jobs.filter((j) => !j.machine);
    const running = onLane.filter((j) => j.kind === 'run').length;
    const queued = onLane.filter((j) => j.kind === 'queue').length;
    const idle = machines.filter((m) => !onLane.some((j) => j.machine === m.label)).length;

    const legend = Object.keys(LANES).map((name) => {
      const item = LANES[name];
      const on = name === company;
      return `<button type="button" data-lane-company="${esc(name)}" class="text-xs font-semibold px-3 py-1.5 rounded-full border ${on ? 'bg-navy text-white border-navy' : 'bg-white text-steel-600 border-steel-200 hover:border-navy/30'}">${esc(item.kicker)} · ${esc(item.title)}</button>`;
    }).join('');

    const machineCards = machines.map((m) => {
      const rows = onLane.filter((j) => j.machine === m.label);
      const run = rows.some((j) => j.kind === 'run');
      const dot = run ? 'bg-emerald-500' : rows.length ? 'bg-amber-500' : 'bg-steel-300';
      const body = rows.length
        ? `<ul class="space-y-1.5">${rows.map(jobLine).join('')}</ul>`
        : '<p class="text-xs text-steel-400">Boş</p>';
      return `<article class="bg-white rounded-2xl border border-steel-200 shadow-sm p-4">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-steel-800 truncate">${esc(m.label)}</p>
            <p class="text-[11px] text-steel-400">${esc(m.workshop)}</p>
          </div>
          <span class="w-2.5 h-2.5 rounded-full ${dot} shrink-0 mt-1"></span>
        </div>
        ${body}
      </article>`;
    }).join('');

    const options = machines.map((m) => `<option value="${esc(m.label)}">${esc(m.label)}</option>`).join('');
    const sampleNote = useSample
      ? '<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">Örnek kuyruk. Bu firmada aktif iş emri yok. Kuyruğa al, kaydı mevcut iş emri tablosuna yazar.</p>'
      : (real.orders.length === 0
        ? '<p class="text-xs text-steel-500 bg-white border border-steel-200 rounded-xl px-3 py-2 mb-4">Bu firmada aktif iş emri yok. Kuyruğa al, kaydı mevcut iş emri tablosuna yazar.</p>'
        : '');
    const offBlock = offLane.length
      ? `<div class="bg-white rounded-2xl border border-steel-200 p-4 mt-4">
          <p class="text-sm font-semibold text-steel-800 mb-2">Bu hatta değil</p>
          <ul class="space-y-1.5">${offLane.map(jobLine).join('')}</ul>
        </div>`
      : '';
    const openBlock = `<div class="bg-white rounded-2xl border border-steel-200 p-4 mt-4">
      <p class="text-sm font-semibold text-steel-800 mb-2">Atanmamış <span class="text-steel-400 font-medium">${open.length}</span></p>
      ${open.length ? `<ul class="space-y-1.5">${open.map(jobLine).join('')}</ul>` : '<p class="text-xs text-steel-400">Atanmamış aktif adım yok.</p>'}
    </div>`;

    mount.innerHTML = `
      <section class="bg-steel-50/80 rounded-2xl border border-steel-200 p-4 sm:p-5">
        <div class="flex flex-wrap gap-2 mb-3">${legend}</div>
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
          <div>
            <h2 class="text-lg font-bold text-steel-800">${esc(lane.title)}</h2>
            <p class="text-xs text-steel-400 mt-0.5">${esc(lane.blurb)}</p>
          </div>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Çalışan</p><p class="text-xl font-bold text-emerald-600">${running}</p></div>
          <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Kuyrukta</p><p class="text-xl font-bold text-amber-600">${queued}</p></div>
          <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Boş tezgâh</p><p class="text-xl font-bold text-steel-800">${idle}</p></div>
          <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Atanmamış</p><p class="text-xl font-bold text-steel-800">${open.length}</p></div>
        </div>
        ${sampleNote}
        <form id="mfgEnqueue" class="bg-white rounded-2xl border border-steel-200 p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <label class="block">
            <span class="text-[11px] font-semibold text-steel-400 uppercase">Müşteri</span>
            <input name="customer" required class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" placeholder="Müşteri ünvanı" />
          </label>
          <label class="block">
            <span class="text-[11px] font-semibold text-steel-400 uppercase">Parça</span>
            <input name="part" required class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" placeholder="Parça adı" />
          </label>
          <label class="block">
            <span class="text-[11px] font-semibold text-steel-400 uppercase">Tezgâh</span>
            <select name="machine" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm bg-white">${options}</select>
          </label>
          <label class="block">
            <span class="text-[11px] font-semibold text-steel-400 uppercase">Süre dk</span>
            <input name="minutes" type="number" min="0" step="1" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" placeholder="İsteğe bağlı" />
          </label>
          <button type="submit" class="bg-navy hover:bg-navy-light text-white text-sm font-semibold px-4 py-2.5 rounded-xl">Kuyruğa al</button>
        </form>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">${machineCards}</div>
        ${openBlock}
        ${offBlock}
      </section>`;

    mount.querySelectorAll('[data-lane-company]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-lane-company');
        if (name && name !== company && typeof api().switchCompany === 'function') api().switchCompany(name);
      });
    });
    const form = mount.querySelector('#mfgEnqueue');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const enqueue = api().enqueue;
      if (typeof enqueue !== 'function') return;
      const ok = enqueue({
        customer: data.get('customer'),
        part: data.get('part'),
        machine: data.get('machine'),
        minutes: data.get('minutes'),
      });
      if (ok) form.reset();
    });
  }

  root.BtdLoad = { render, laneFor };
})(typeof window !== 'undefined' ? window : globalThis);
