/* Firma bazlı iç görev listesi. Kalıcı kayıt: public.gorevler (010_gorevler.sql). */
(function (root) {
  const STATUSES = ['Açık', 'Devam', 'Bitti', 'İptal'];
  let filter = 'Tümü';
  let cloudNote = '';

  function api() {
    return root.BtdTasksApi || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    if (typeof root.fmtDate === 'function') return root.fmtDate(iso);
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return d && m && y ? `${d}.${m}.${y}` : iso;
  }

  function tasks() {
    return api().tasks || [];
  }

  function people(company) {
    const list = api().personnel || [];
    return list.filter((p) => p.company === company && p.status !== 'Pasif');
  }

  function nextCode(company) {
    const prefix = { Technomac: 'TM', Bluemac: 'BM', Devorias: 'DV' }[company] || 'XX';
    const re = new RegExp(`^GV-${prefix}-(\\d+)$`);
    let max = 0;
    tasks().forEach((t) => {
      if (t.company !== company) return;
      const m = String(t.id || '').match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `GV-${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  function overdue(task) {
    if (!task.due || task.status === 'Bitti' || task.status === 'İptal') return false;
    return task.due < todayIso();
  }

  function statusClass(status) {
    if (status === 'Bitti') return 'text-blue-700 bg-blue-50';
    if (status === 'Devam') return 'text-emerald-700 bg-emerald-50';
    if (status === 'İptal') return 'text-red-700 bg-red-50';
    return 'text-amber-700 bg-amber-50';
  }

  function toast(msg, kind) {
    if (typeof api().toast === 'function') api().toast(msg, kind);
  }

  async function persist(task) {
    const save = root.BtdCloud && root.BtdCloud.saveTask;
    if (typeof save !== 'function') return;
    const res = await save(task, api().companies);
    if (res && res.ok === false) {
      const reason = String(res.reason || '');
      if (/gorevler|schema cache|does not exist|PGRST|relation/i.test(reason)) {
        cloudNote = 'Görev bu oturumda duruyor. Kalıcı kayıt için Supabase SQL editöründe supabase/010_gorevler.sql dosyasını çalıştırın.';
        render();
      } else {
        toast('Görev buluta yazılamadı.', 'error');
      }
    } else if (res && res.ok) {
      cloudNote = '';
    }
  }

  async function remove(task) {
    const list = tasks();
    const idx = list.findIndex((t) => t === task || (t.id === task.id && t.company === task.company));
    if (idx === -1) return;
    list.splice(idx, 1);
    render();
    const del = root.BtdCloud && root.BtdCloud.deleteTask;
    if (task.dbId && typeof del === 'function') {
      const res = await del(task);
      if (res && res.ok === false) toast('Buluttan silinemedi.', 'error');
    }
    toast('Görev silindi.', 'success');
  }

  function visible(company) {
    return tasks().filter((t) => t.company === company && (filter === 'Tümü' || t.status === filter));
  }

  function rowCells(task) {
    const late = overdue(task);
    const options = STATUSES.map((s) => `<option value="${esc(s)}" ${s === task.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
    return `
      <td class="px-4 py-3 font-semibold text-navy mono text-xs">${esc(task.id)}</td>
      <td class="px-4 py-3">
        <p class="text-sm text-steel-800">${esc(task.title)}</p>
        ${task.note ? `<p class="text-[11px] text-steel-400 mt-0.5">${esc(task.note)}</p>` : ''}
      </td>
      <td class="px-4 py-3 text-sm text-steel-600">${esc(task.assignee || '—')}</td>
      <td class="px-4 py-3 text-sm ${late ? 'text-red-600 font-semibold' : 'text-steel-600'}">${fmtDate(task.due)}${late ? ' · gecikti' : ''}</td>
      <td class="px-4 py-3">
        <select data-task-status="${esc(task.id)}" class="text-[11px] font-bold px-2 py-1 rounded-full border-0 ${statusClass(task.status)}">${options}</select>
      </td>
      <td class="px-4 py-3 text-right">
        <button type="button" data-task-del="${esc(task.id)}" class="text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg">Sil</button>
      </td>`;
  }

  function card(task) {
    const late = overdue(task);
    const options = STATUSES.map((s) => `<option value="${esc(s)}" ${s === task.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
    return `<article class="border border-steel-200 rounded-xl p-3">
      <p class="text-sm font-semibold text-steel-800">${esc(task.title)}</p>
      <p class="text-[11px] text-steel-400 mt-1">${esc(task.assignee || 'Atanmadı')} · ${fmtDate(task.due)}${late ? ' · gecikti' : ''}</p>
      <div class="flex items-center justify-between gap-2 mt-2">
        <select data-task-status="${esc(task.id)}" class="text-[11px] font-bold px-2 py-1 rounded-full border-0 ${statusClass(task.status)}">${options}</select>
        <button type="button" data-task-del="${esc(task.id)}" class="text-[11px] font-semibold text-red-600 bg-red-50 px-2.5 py-1.5 rounded-lg">Sil</button>
      </div>
    </article>`;
  }

  function render() {
    const mount = document.getElementById('tasksMount');
    if (!mount) return;
    const company = api().company || '';
    const list = visible(company);
    const all = tasks().filter((t) => t.company === company);
    const staff = people(company);
    const assigneeOptions = staff.length
      ? staff.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} · ${esc(p.dept || '')}</option>`).join('')
      : '<option value="">Personel yok</option>';
    const filters = ['Tümü', ...STATUSES].map((name) => {
      const on = filter === name;
      return `<button type="button" data-task-filter="${esc(name)}" class="text-xs font-semibold px-3 py-1.5 rounded-full border ${on ? 'bg-navy text-white border-navy' : 'bg-white text-steel-600 border-steel-200'}">${esc(name)}</button>`;
    }).join('');
    const empty = list.length
      ? ''
      : `<tr><td colspan="6" class="px-5 py-10 text-center text-sm text-steel-400">${all.length ? 'Bu durumda görev yok.' : 'Bu firmada görev yok. Yukarıdan ekleyin.'}</td></tr>`;
    const banner = cloudNote
      ? `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">${esc(cloudNote)}</p>`
      : '';

    mount.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-bold text-steel-800 tracking-tight">Görevler <span class="text-steel-400 font-medium">/ İç takip</span></h1>
          <p class="text-sm text-steel-400 mt-1">Atanan, termin ve durum · <span class="font-semibold text-navy">${esc(company)}</span></p>
        </div>
      </div>
      ${banner}
      <form id="taskForm" class="bg-white rounded-2xl border border-steel-200 shadow-sm p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <label class="block lg:col-span-2">
          <span class="text-[11px] font-semibold text-steel-400 uppercase">Başlık</span>
          <input name="title" required class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" placeholder="Ne yapılacak" />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase">Atanan</span>
          <select name="assignee" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm bg-white">${assigneeOptions}</select>
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase">Termin</span>
          <input name="due" type="date" required value="${todayIso()}" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" />
        </label>
        <label class="block">
          <span class="text-[11px] font-semibold text-steel-400 uppercase">Durum</span>
          <select name="status" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm bg-white">${STATUSES.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
        </label>
        <button type="submit" class="bg-navy hover:bg-navy-light text-white text-sm font-semibold px-4 py-2.5 rounded-xl">Görev ekle</button>
        <label class="block lg:col-span-6">
          <span class="text-[11px] font-semibold text-steel-400 uppercase">Not</span>
          <input name="note" class="mt-1 w-full rounded-xl border border-steel-200 px-3 py-2.5 text-sm" placeholder="İsteğe bağlı" />
        </label>
      </form>
      <div class="flex flex-wrap gap-2 mb-4">${filters}</div>
      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Açık</p><p class="text-xl font-bold text-amber-600">${all.filter((t) => t.status === 'Açık').length}</p></div>
        <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Devam</p><p class="text-xl font-bold text-emerald-600">${all.filter((t) => t.status === 'Devam').length}</p></div>
        <div class="bg-white rounded-xl border border-steel-200 px-3 py-2.5"><p class="text-[11px] text-steel-400 font-semibold uppercase">Geciken</p><p class="text-xl font-bold text-red-600">${all.filter(overdue).length}</p></div>
      </div>
      <div class="bg-white rounded-2xl border border-steel-200 shadow-sm overflow-hidden">
        <div class="overflow-x-auto desktop-table-only">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-steel-50 text-left text-[11px] uppercase tracking-wide text-steel-400 font-semibold">
                <th class="px-4 py-3">Kod</th>
                <th class="px-4 py-3">Görev</th>
                <th class="px-4 py-3">Atanan</th>
                <th class="px-4 py-3">Termin</th>
                <th class="px-4 py-3">Durum</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>${list.length ? list.map((t) => `<tr class="border-t border-steel-100">${rowCells(t)}</tr>`).join('') : empty}</tbody>
          </table>
        </div>
        <div class="mobile-cards-only p-3 space-y-2">${list.length ? list.map(card).join('') : '<p class="text-sm text-steel-400 text-center py-6">Bu durumda görev yok.</p>'}</div>
      </div>`;

    if (!mount.dataset.bound) {
      mount.dataset.bound = '1';
      mount.addEventListener('submit', (e) => {
        const form = e.target.closest('#taskForm');
        if (!form) return;
        e.preventDefault();
        const firm = api().company || '';
        const data = new FormData(form);
        const title = String(data.get('title') || '').trim();
        const due = String(data.get('due') || '');
        if (!title || !due) {
          toast('Başlık ve termin gerekli.', 'error');
          return;
        }
        const task = {
          id: nextCode(firm),
          company: firm,
          title,
          assignee: String(data.get('assignee') || '').trim(),
          due,
          status: String(data.get('status') || 'Açık'),
          note: String(data.get('note') || '').trim(),
        };
        tasks().push(task);
        toast(`${task.id} eklendi.`, 'success');
        render();
        persist(task);
      });
      mount.addEventListener('click', (e) => {
        const firm = api().company || '';
        const filterBtn = e.target.closest('[data-task-filter]');
        if (filterBtn) {
          filter = filterBtn.getAttribute('data-task-filter') || 'Tümü';
          render();
          return;
        }
        const del = e.target.closest('[data-task-del]');
        if (!del) return;
        const task = tasks().find((t) => t.company === firm && t.id === del.getAttribute('data-task-del'));
        if (!task) return;
        if (!root.confirm(`${task.title} silinsin mi?`)) return;
        remove(task);
      });
      mount.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-task-status]');
        if (!sel) return;
        const firm = api().company || '';
        const task = tasks().find((t) => t.company === firm && t.id === sel.getAttribute('data-task-status'));
        if (!task || task.status === sel.value) return;
        task.status = sel.value;
        render();
        persist(task);
      });
    }
  }

  root.BtdTasks = { render };
})(typeof window !== 'undefined' ? window : globalThis);
